import {
  createAgentSession, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  DefaultResourceLoader, type ExtensionAPI, ModelRuntime, SessionManager, SettingsManager, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Budget, BudgetExhausted } from "../budget.ts";
import { config, type Role } from "../config.ts";
import { isAllowed } from "../sandbox/guard.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PI_HOME = join(REPO, ".pi-home");
const FILE_TOOLS = ["read", "write", "edit", "grep", "find", "ls"];
const NEEDS_PATH = ["read", "write", "edit"];

export interface RoleSession {
  run(prompt: string): Promise<void>;
  sessionFile: string | undefined;
  dispose(): void;
}

interface Driver {
  /** Resolves with the model error message, or undefined if the run succeeded. */
  prompt(text: string): Promise<string | undefined>;
  useFallback(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runWithFallback(driver: Driver, prompt: string, wait = sleep): Promise<void> {
  const check = (error: string | undefined) => {
    if (error?.includes("free-models-per-day")) throw new BudgetExhausted(error);
    return error;
  };
  let error = check(await driver.prompt(prompt));
  if (error?.startsWith("429")) {
    await wait(30_000);
    await driver.useFallback();
    error = check(await driver.prompt("The last request was throttled. Continue the task where you left off."));
  }
  if (error) throw new Error(`Model request failed: ${error.slice(0, 500)}`);
}

export async function runUntilTool<T>(
  session: Pick<RoleSession, "run">, prompt: string, captured: () => T | undefined, toolName: string,
): Promise<T> {
  await session.run(prompt);
  if (captured() === undefined) {
    await session.run(`You have not called ${toolName}. Call ${toolName} now with your answer. Do not reply in text.`);
  }
  const value = captured();
  if (value === undefined) throw new Error(`The model ended without calling ${toolName}. Try again or change the model.`);
  return value;
}

export function guardExtension(o: { root: string; budget: Budget; onExhausted: (error: BudgetExhausted) => void }) {
  return (pi: ExtensionAPI) => {
    pi.on("tool_call", (event) => {
      if (!FILE_TOOLS.includes(event.toolName)) return;
      const input = event.input as { path?: unknown };
      if (input.path === undefined && !NEEDS_PATH.includes(event.toolName)) return;
      if (typeof input.path !== "string" || !isAllowed(input.path, o.root)) {
        return { block: true, reason: `Refused: ${String(input.path)} is outside the project folder.` };
      }
    });
    pi.on("before_provider_request", async (_event, ctx) => {
      try {
        await o.budget.take();
      } catch (error) {
        if (!(error instanceof BudgetExhausted)) throw error;
        o.onExhausted(error);
        ctx.abort();
      }
    });
  };
}

export interface RoleSessionOptions {
  role: Role;
  projectDir: string;
  /** The only folder the file tools may touch. */
  root: string;
  systemPrompt: string;
  tools: string[];
  customTools: ToolDefinition<any, any>[];
  resume: boolean;
  budget: Budget;
}

export async function createRoleSession(o: RoleSessionOptions): Promise<RoleSession> {
  // The session lives in a harness folder so that nothing the builder writes is ever loaded by pi.
  const home = join(o.projectDir, ".builder");
  const sessionDir = join(home, "sessions", o.role);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(PI_HOME, { recursive: true });

  const modelRuntime = await ModelRuntime.create({
    modelsPath: join(REPO, "config/models.json"),
    modelsStorePath: join(PI_HOME, "models-store.json"),
    authPath: join(PI_HOME, "auth.json"),
  });
  const model = (id: string) => {
    const found = modelRuntime.getModel("openrouter", id);
    if (!found) throw new Error(`Model not registered in config/models.json: ${id}`);
    return found;
  };

  let exhausted: BudgetExhausted | undefined;
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: home, agentDir: PI_HOME, settingsManager,
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    systemPrompt: o.systemPrompt,
    extensionFactories: [guardExtension({ root: o.root, budget: o.budget, onExhausted: (e) => { exhausted = e; } })],
  });
  await resourceLoader.reload();

  const fileTools: Record<string, () => ToolDefinition<any, any>> = {
    read: () => createReadToolDefinition(o.root),
    write: () => createWriteToolDefinition(o.root),
    edit: () => createEditToolDefinition(o.root),
  };
  const customTools = [...o.tools.flatMap((name) => fileTools[name]?.() ?? []), ...o.customTools];

  const { session } = await createAgentSession({
    cwd: home, agentDir: PI_HOME, modelRuntime, model: model(config.models[o.role]),
    settingsManager, resourceLoader, noTools: "builtin", tools: o.tools, customTools,
    sessionManager: o.resume ? SessionManager.continueRecent(home, sessionDir) : SessionManager.create(home, sessionDir),
  });

  const driver: Driver = {
    async prompt(text) {
      if (o.budget.used() >= o.budget.limit) throw new BudgetExhausted();
      exhausted = undefined;
      await session.prompt(text);
      if (exhausted) throw exhausted;
      const last = [...session.messages].reverse().find((m) => m.role === "assistant");
      return last?.role === "assistant" ? last.errorMessage : undefined;
    },
    useFallback: () => session.setModel(model(config.fallbackModel)),
  };

  return {
    run: (prompt) => runWithFallback(driver, prompt),
    sessionFile: session.sessionFile,
    dispose: () => session.dispose(),
  };
}
