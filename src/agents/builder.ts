import { type BashOperations, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Budget } from "../budget.ts";
import { hashFolder } from "../files.ts";
import { compose } from "../sandbox/docker.ts";
import { createRoleSession } from "./session.ts";
import { appLogsTool, describeSpec, fileBlocks } from "./shared.ts";
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

export function createBuilderAgent(o: {
  projectDir: string;
  budget: Budget;
  exec?: typeof compose;
  createSession?: typeof createRoleSession;
  onTool?: (line: string) => void;
}): Agents["build"] {
  const exec = o.exec ?? compose;
  const appDir = join(o.projectDir, "app");
  const appHash = () => hashFolder(appDir, ["node_modules", ".next", "next-env.d.ts", "tsconfig.tsbuildinfo"]);

  return async ({ spec, failure, changes }) => {
    const up = await exec(o.projectDir, ["up", "-d", "--wait", "shell"], { timeoutMs: 600_000 });
    if (up.code !== 0) throw new Error(`Could not start the sandbox:\n${up.output.slice(-2000)}`);

    const bash = createBashToolDefinition(appDir, {
      operations: containerBash(o.projectDir, exec), exposeSessionEnvironment: false,
    });
    const appLogs = appLogsTool(o.projectDir, exec);

    const session = await (o.createSession ?? createRoleSession)({
      role: "builder", projectDir: o.projectDir, root: appDir, containerRoot: "/app", systemPrompt: PROMPT,
      tools: ["read", "write", "edit", "bash", "app_logs"], customTools: [bash, appLogs],
      resume: true, budget: o.budget, onTool: o.onTool,
    });
    /** Runs a task and insists that it changes the app, so "done" is never just a claim. */
    const mustChange = async (task: string, before: string) => {
      await session.run(task);
      if (appHash() !== before) return;
      await session.run("You have not changed any file. Make the change now using the write and edit tools.");
      if (appHash() === before) throw new Error("The builder finished without changing the app. Try again or change the model.");
    };

    try {
      if (failure) {
        await mustChange(
          `A check failed after your last change. Find the cause and fix it.\n\n${failure}\n\nThe spec:\n${describeSpec(spec)}`,
          appHash());
        return;
      }
      // The baseline outlives an interrupted run, so work done before the interruption still counts.
      const marker = join(o.projectDir, ".builder", "build-baseline");
      const job = createHash("sha256").update(JSON.stringify([spec, changes])).digest("hex");
      const saved = existsSync(marker) ? readFileSync(marker, "utf8").split("\n") : [];
      const interrupted = saved[0] === job;
      const before = interrupted ? saved[1]! : appHash();
      if (!interrupted) {
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, `${job}\n${before}`);
      }
      const task = changes
        ? `Change the existing app. What changed:\n${changes}\n\nThe full spec now:\n${describeSpec(spec)}\n\nCurrent files:\n`
        : `Build this app.\n\n${describeSpec(spec)}\n\nThe starter files, so you do not need to read them:\n`;
      await mustChange(interrupted
        ? `You were interrupted partway. Do not read files again that you have already seen. Finish, then run the checks.\n\n${describeSpec(spec)}`
        : task + fileBlocks(appDir, STARTER_FILES), before);
      rmSync(marker);
    } finally {
      session.dispose();
    }
  };
}
