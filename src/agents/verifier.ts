import { defineTool } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Type } from "typebox";
import type { Budget } from "../budget.ts";
import { hashFolder, listFiles } from "../files.ts";
import { compose } from "../sandbox/docker.ts";
import { ensureTestPackages, missingTests } from "../verify/runner.ts";
import { createRoleSession, type RoleSession } from "./session.ts";
import { appLogsTool, describeSpec, fileBlocks, textResult } from "./shared.ts";
import type { Agents } from "./types.ts";

const PROMPT = readFileSync(new URL("./prompts/verifier.md", import.meta.url), "utf8");
const MAX_SOURCE_CHARS = 60_000;

/** Backslash commands are refused because psql can use them to run a shell or switch user. */
export async function queryDatabase(dir: string, sql: string, exec = compose): Promise<string> {
  if (sql.includes("\\")) throw new Error("SQL only: backslashes are not allowed.");
  const { output } = await exec(dir, ["exec", "-T", "-e", "PGPASSWORD=reader", "db",
    "psql", "-h", "127.0.0.1", "-U", "reader", "-d", "app", "-c", sql], { timeoutMs: 30_000 });
  return output.slice(-6000);
}

async function snapshotPage(dir: string, path: string, exec = compose): Promise<string> {
  if (!path.startsWith("/")) throw new Error('Give a path that starts with "/".');
  await ensureTestPackages(dir, exec);
  const { output } = await exec(dir, ["run", "--rm", "-T", "e2e", "node", "snapshot.mjs", path], { timeoutMs: 120_000 });
  return output.slice(-8000);
}

/** The app's source files, up to a size that fits comfortably in a prompt. */
function appSource(projectDir: string): string {
  const files = listFiles(join(projectDir, "app", "src"))
    .filter((file) => /\.(tsx?|css)$/.test(file))
    .map((file) => relative(projectDir, file));
  return fileBlocks(projectDir, files).slice(0, MAX_SOURCE_CHARS);
}

export function createVerifierAgent(o: {
  projectDir: string;
  budget: Budget;
  exec?: typeof compose;
  createSession?: typeof createRoleSession;
  onTool?: (line: string) => void;
}): Pick<Agents, "writeTests" | "triage"> {
  const { projectDir } = o;
  const exec = o.exec ?? compose;
  const testsDir = join(projectDir, "e2e", "tests");

  const tools = [
    defineTool({
      name: "page_snapshot", label: "Page snapshot", description: "Show the accessible content of an app page.",
      parameters: Type.Object({ path: Type.String({ description: 'For example "/"' }) }),
      async execute(_id, { path }) {
        return textResult(await snapshotPage(projectDir, path, exec));
      },
    }),
    appLogsTool(projectDir, exec),
    defineTool({
      name: "db_query", label: "Database query", description: "Run one read-only SQL query.",
      parameters: Type.Object({ sql: Type.String() }),
      async execute(_id, { sql }) {
        return textResult(await queryDatabase(projectDir, sql, exec));
      },
    }),
  ];

  async function withSession<T>(work: (session: RoleSession) => Promise<T>): Promise<T> {
    mkdirSync(testsDir, { recursive: true });
    const session = await (o.createSession ?? createRoleSession)({
      role: "verifier", projectDir, root: projectDir, systemPrompt: PROMPT,
      readable: [join(projectDir, "app"), join(projectDir, "e2e")], writable: [testsDir],
      tools: ["read", "write", "edit", ...tools.map((t) => t.name)], customTools: tools,
      resume: false, budget: o.budget, onTool: o.onTool,
    });
    try {
      return await work(session);
    } finally {
      session.dispose();
    }
  }

  return {
    writeTests: ({ spec, ids }) => withSession(async (session) => {
      const home = await snapshotPage(projectDir, "/", exec);
      await session.run([
        `Write tests for these deliverables: ${ids.join(", ")}.`,
        describeSpec(spec),
        `The home page right now:\n${home}`,
        `The app source:\n${appSource(projectDir)}`,
      ].join("\n\n"));
      const left = missingTests(join(projectDir, "e2e"), spec).filter((id) => ids.includes(id));
      if (left.length > 0) await session.run(`There is still no test for ${left.join(", ")}. Write them now.`);
    }),

    triage: ({ spec, failures }) => withSession(async (session) => {
      const before = hashFolder(testsDir);
      const tests = listFiles(testsDir).map((file) => relative(projectDir, file));
      await session.run([
        "These results did not pass. Decide whether the app or the test is wrong.",
        failures.map((f) => `${f.id} (${f.status}): ${f.evidence}`).join("\n\n"),
        describeSpec(spec),
        `Your tests:\n${fileBlocks(projectDir, tests)}`,
        `The app source:\n${appSource(projectDir)}`,
      ].join("\n\n"));
      const testsChanged = hashFolder(testsDir) !== before;
      const notes = session.lastText()?.trim() ?? "";
      mkdirSync(join(projectDir, ".builder"), { recursive: true });
      appendFileSync(join(projectDir, ".builder", "triage.log"),
        `${new Date().toISOString()} testsChanged=${testsChanged}\n${notes}\n\n`);
      return { testsChanged, notes };
    }),
  };
}
