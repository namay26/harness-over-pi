import { type BashOperations, createBashToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Type } from "typebox";
import type { Budget } from "../budget.ts";
import { compose } from "../sandbox/docker.ts";
import type { Spec } from "../types.ts";
import { createRoleSession } from "./session.ts";
import type { Agents } from "./types.ts";

const PROMPT = readFileSync(new URL("./prompts/builder.md", import.meta.url), "utf8");
const DEFAULT_TIMEOUT_S = 600;
// Sent with the first task: each file the model has to read itself costs one of the daily requests.
const STARTER_FILES = [
  "package.json", "src/db/schema.ts", "src/db/index.ts", "src/app/layout.tsx", "src/app/page.tsx",
  "src/app/globals.css", "drizzle.config.ts", "tsconfig.json",
];

/** pi's bash tool, executed in the shell container. The host environment is never forwarded. */
export function containerBash(dir: string, exec = compose): BashOperations {
  return {
    async exec(command, _cwd, { onData, signal, timeout }) {
      const seconds = timeout ?? DEFAULT_TIMEOUT_S;
      // The limit is enforced inside the container: killing the docker client would leave the process running.
      const { code } = await exec(
        dir, ["exec", "-T", "shell", "timeout", "-k", "5", String(seconds), "bash", "-c", command], { onData, signal });
      if (code === 124) throw new Error(`timeout:${seconds}`);
      return { exitCode: code };
    },
  };
}

/** Fingerprint of the app's source, to catch a builder that stops without building anything. */
export function sourceHash(appDir: string): string {
  const src = join(appDir, "src");
  const hash = createHash("sha256");
  if (!existsSync(src)) return "";
  const files = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  for (const file of files) hash.update(relative(appDir, file)).update(readFileSync(file));
  return hash.digest("hex");
}

function starter(appDir: string): string {
  return STARTER_FILES.filter((file) => existsSync(join(appDir, file)))
    .map((file) => `<file path="${file}">\n${readFileSync(join(appDir, file), "utf8")}</file>`)
    .join("\n");
}

function describe(spec: Spec): string {
  return [
    `Idea: ${spec.idea}`,
    "Deliverables:",
    ...spec.deliverables.map((d) => `- ${d.id}: ${d.does}\n  check: ${d.check}`),
    `Decisions: ${spec.areas.map((a) => `${a.area}: ${a.guess}`).join("; ")}`,
    `People sign in: ${spec.needsAccounts ? "yes" : "no"}`,
    `Not building: ${spec.notBuilding.join(", ") || "-"}`,
    `Constraints: ${spec.constraints.join(", ") || "-"}`,
  ].join("\n");
}

export function createBuilderAgent(o: {
  projectDir: string;
  budget: Budget;
  exec?: typeof compose;
  createSession?: typeof createRoleSession;
  onTool?: (line: string) => void;
}): Agents["build"] {
  const exec = o.exec ?? compose;
  const appDir = join(o.projectDir, "app");

  return async ({ spec, failure }) => {
    const up = await exec(o.projectDir, ["up", "-d", "--wait", "shell"], { timeoutMs: 600_000 });
    if (up.code !== 0) throw new Error(`Could not start the sandbox:\n${up.output.slice(-2000)}`);

    const bash = createBashToolDefinition(appDir, {
      operations: containerBash(o.projectDir, exec), exposeSessionEnvironment: false,
    });
    const appLogs = defineTool({
      name: "app_logs", label: "App logs", description: "Show the last lines of the preview server log.",
      parameters: Type.Object({ lines: Type.Optional(Type.Number()) }),
      async execute(_id, { lines }) {
        const { output } = await exec(o.projectDir, ["logs", "--no-color", "--tail", String(lines ?? 60), "web"]);
        return { content: [{ type: "text", text: output.slice(-8000) || "(no log yet)" }], details: {} };
      },
    });

    const session = await (o.createSession ?? createRoleSession)({
      role: "builder", projectDir: o.projectDir, root: appDir, containerRoot: "/app", systemPrompt: PROMPT,
      tools: ["read", "write", "edit", "bash", "app_logs"], customTools: [bash, appLogs],
      resume: true, budget: o.budget, onTool: o.onTool,
    });
    try {
      if (failure) {
        await session.run(
          `A check failed after your last change. Find the cause and fix it.\n\n${failure}\n\nThe spec:\n${describe(spec)}`);
        return;
      }
      // The baseline outlives an interrupted run, so work done before the interruption still counts.
      const marker = join(o.projectDir, ".builder", "build-baseline");
      const interrupted = existsSync(marker);
      const before = interrupted ? readFileSync(marker, "utf8") : sourceHash(appDir);
      if (!interrupted) {
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, before);
      }
      await session.run(interrupted
        ? `You were interrupted partway. Do not read files again that you have already seen. Finish the app, then run the checks.\n\n${describe(spec)}`
        : `Build this app.\n\n${describe(spec)}\n\nThe starter files, so you do not need to read them:\n${starter(appDir)}`);
      if (sourceHash(appDir) === before) {
        await session.run("You have not changed any file in src/. Build the app now using the write and edit tools.");
        if (sourceHash(appDir) === before) {
          throw new Error("The builder finished without changing the app. Try again or change the model.");
        }
      }
      rmSync(marker);
    } finally {
      session.dispose();
    }
  };
}
