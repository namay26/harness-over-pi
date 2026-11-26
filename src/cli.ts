import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createSpecAgent } from "./agents/spec.ts";
import type { Agents, UI } from "./agents/types.ts";
import { Budget, BudgetExhausted } from "./budget.ts";
import { config } from "./config.ts";
import { handleMessage } from "./pipeline.ts";
import { createProject } from "./sandbox/project.ts";
import { loadState } from "./state.ts";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set. Put it in .env and start with: npm start -- <project>");
  process.exit(1);
}

const { dir } = createProject(process.argv[2] ?? "app");
const budget = new Budget(resolve("workspaces", ".usage.json"), config.dailyRequestLimit);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function read(prompt: string): Promise<string | null> {
  process.stdout.write(prompt);
  const next = await lines.next();
  return next.done ? null : next.value;
}

const ui: UI = {
  say: (text) => console.log(`\n${text}`),
  async ask(question, fallback) {
    const answer = await read(`\n${question}\n[Enter = ${fallback}] > `);
    if (answer === null) throw new Error("Input closed before the question was answered.");
    return answer.trim() || fallback;
  },
  async confirm(text) {
    return (await read(`\n${text} [yes/no] > `))?.trim().toLowerCase() === "yes";
  },
};

const later = async (): Promise<never> => {
  throw new Error("Building and verifying are not implemented yet.");
};
const agents: Agents = {
  spec: createSpecAgent({ projectDir: dir, budget }),
  build: later, writeTests: later, triage: later,
};

const used = () => `${budget.used()}/${budget.limit} model requests used today`;
console.log(`Project: ${join("workspaces", process.argv[2] ?? "app")}  (${used()})`);
console.log("Describe the app you want. Commands: continue, /status, /exit");

for (;;) {
  const message = await read("\n> ");
  if (message === null || message.trim() === "/exit") break;
  if (message.trim() === "/status") {
    console.log(`stage: ${loadState(dir).stage}, ${used()}`);
    continue;
  }
  try {
    await handleMessage({ dir, agents, ui }, message);
  } catch (error) {
    console.log(`\n${error instanceof BudgetExhausted ? `${error.message} Type 'continue' after that.` : `Error: ${(error as Error).message}`}`);
  }
  console.log(`\n(${used()})`);
}
rl.close();
