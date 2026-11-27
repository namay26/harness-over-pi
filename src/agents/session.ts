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
import { RunLimits } from "./limits.ts";
import { watchStall } from "./watchdog.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PI_HOME = join(REPO, ".pi-home");
const FILE_TOOLS = ["read", "write", "edit", "grep", "find", "ls"];
const NEEDS_PATH = ["read", "write", "edit"];

export interface RoleSession {
  run(prompt: string): Promise<void>;
  sessionFile: string | undefined;
  lastText(): string | undefined;
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
  } else if (error?.startsWith("stalled")) {
    error = check(await driver.prompt("The last request got no reply. Continue the task where you left off."));
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

export function guardExtension(o: {
  root: string;
  readable?: string[];
  writable?: string[];
  /** Where `root` appears inside the container, so that paths copied from the shell still work. */
  containerRoot?: string;
  budget: Budget;
  limits?: RunLimits;
  onExhausted: (error: BudgetExhausted) => void;
  onCapped?: () => void;
}) {
  const limits = o.limits ?? new RunLimits(Number.POSITIVE_INFINITY);

  /** Why a file call must be refused, if it must. */
  function refusal(toolName: string, input: { path?: unknown }): string | undefined {
    if (!FILE_TOOLS.includes(toolName)) return;
    if (input.path === undefined && !NEEDS_PATH.includes(toolName)) return;
    const inside = o.containerRoot;
    if (inside && typeof input.path === "string" && (input.path === inside || input.path.startsWith(`${inside}/`))) {
      input.path = `.${input.path.slice(inside.length)}`; // still checked below
    }
    const folders = ["write", "edit"].includes(toolName) ? o.writable : o.readable;
    if (typeof input.path !== "string" || !isAllowed(input.path, o.root, folders)) {
      return `Refused: ${String(input.path)} is outside the project folder you may use.`;
    }
  }

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", (event) => {
      const input = event.input as { path?: unknown };
      const reason = refusal(event.toolName, input);
      // Reading again or re-running a check is normal; the same write or any refusal repeated is a loop.
      const risky = reason !== undefined || ["write", "edit"].includes(event.toolName);
      const loop = risky && limits.isLoop(event.toolName, input, reason !== undefined);
      if (reason) return { block: true, reason, terminate: loop };
      if (loop) return { block: true, reason: "You already did exactly this. Stop.", terminate: true };
    });
    pi.on("before_provider_request", async (_event, ctx) => {
      if (!limits.takeRequest()) {
        o.onCapped?.();
        ctx.abort();
        return;
      }
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

const FILE_TOOL_FACTORIES: Record<string, (root: string) => ToolDefinition<any, any>> = {
  read: createReadToolDefinition,
  write: createWriteToolDefinition,
  edit: createEditToolDefinition,
};

/** pi resolves paths from the session's cwd, so each file tool is handed `root` as its cwd. */
export function rootedFileTools(names: string[], root: string, finished?: () => boolean): ToolDefinition<any, any>[] {
  return names.flatMap((name) => {
    const tool = FILE_TOOL_FACTORIES[name]?.(root);
    if (!tool) return [];
    const execute: typeof tool.execute = async (id, params, signal, update, ctx) => {
      const result = await tool.execute(id, params, signal, update, { ...ctx, cwd: root });
      return name !== "read" && finished?.() ? { ...result, terminate: true } : result;
    };
    return { ...tool, execute };
  });
}

/** pi appends the session folder to the prompt; show the agent its own folder instead. */
export function hideSessionFolder(shown: string) {
  return (pi: ExtensionAPI) => {
    pi.on("before_agent_start", (event) => ({
      systemPrompt: event.systemPrompt.replace(/<cwd>[\s\S]*?<\/cwd>/, `<cwd>\n${shown}\n</cwd>`),
    }));
  };
}

export interface RoleSessionOptions {
  role: Role;
  projectDir: string;
  /** Relative paths resolve from here; file tools may touch only this folder unless narrowed below. */
  root: string;
  readable?: string[];
  writable?: string[];
  containerRoot?: string;
  systemPrompt: string;
  tools: string[];
  customTools: ToolDefinition<any, any>[];
  resume: boolean;
  budget: Budget;
  /** Checked after each write: true ends the run without another request. */
  finished?: () => boolean;
  /** One short line per tool call, so a long run is visibly doing something. */
  onTool?: (line: string) => void;
}

export async function createRoleSession(o: RoleSessionOptions): Promise<RoleSession> {
  // The session lives in a harness folder so that nothing the builder writes is ever loaded by pi.
  const home = join(o.projectDir, ".builder");
  const sessionDir = join(home, "sessions", o.role);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(PI_HOME, { recursive: true });

  const modelRuntime = await ModelRuntime.create({
    modelsPath: config.modelsFile ?? join(REPO, "config/models.json"),
    modelsStorePath: join(PI_HOME, "models-store.json"),
    authPath: join(PI_HOME, "auth.json"),
  });
  const model = (id: string) => {
    const found = modelRuntime.getModel("openrouter", id);
    if (!found) throw new Error(`Model not registered in config/models.json: ${id}`);
    return found;
  };

  let exhausted: BudgetExhausted | undefined;
  let capped = false;
  const limits = new RunLimits(config.maxRequestsPerRun[o.role]);
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: home, agentDir: PI_HOME, settingsManager,
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    systemPrompt: o.systemPrompt,
    extensionFactories: [hideSessionFolder(o.containerRoot ?? "."), guardExtension({
      root: o.root, readable: o.readable, writable: o.writable, containerRoot: o.containerRoot, budget: o.budget, limits,
      onExhausted: (e) => { exhausted = e; }, onCapped: () => { capped = true; },
    })],
  });
  await resourceLoader.reload();

  const customTools = [...rootedFileTools(o.tools, o.root, o.finished), ...o.customTools];

  const { session } = await createAgentSession({
    cwd: home, agentDir: PI_HOME, modelRuntime, model: model(config.models[o.role]),
    settingsManager, resourceLoader, noTools: "builtin", tools: o.tools, customTools,
    sessionManager: o.resume ? SessionManager.continueRecent(home, sessionDir) : SessionManager.create(home, sessionDir),
  });

  session.subscribe((event) => {
    if (event.type !== "tool_execution_start") return;
    const args = event.args as { command?: string; path?: string } | undefined;
    const detail = (args?.command ?? args?.path ?? "").replace(/\s+/g, " ").slice(0, 100);
    o.onTool?.(`${event.toolName} ${detail}`.trim());
  });

  const driver: Driver = {
    async prompt(text) {
      if (o.budget.used() >= o.budget.limit) throw new BudgetExhausted();
      exhausted = undefined;
      capped = false;
      limits.reset();
      let stalled = false;
      const watch = watchStall(config.stallMs, () => {
        stalled = true;
        o.onTool?.("no reply from the model, cancelling the request");
        void session.abort();
      });
      const unwatch = session.subscribe((event) => watch.see(event.type));
      try {
        await session.prompt(text);
      } finally {
        watch.stop();
        unwatch();
      }
      if (exhausted) throw exhausted;
      if (stalled) return `stalled: no reply from the model for ${config.stallMs / 1000} seconds`;
      if (capped) {
        // Not a failure: the checks and tests judge whatever was done.
        o.onTool?.("stopped: this step reached its request limit");
        return undefined;
      }
      const last = [...session.messages].reverse().find((m) => m.role === "assistant");
      return last?.role === "assistant" ? last.errorMessage : undefined;
    },
    useFallback: () => session.setModel(model(config.fallbackModel)),
  };

  return {
    run: (prompt) => runWithFallback(driver, prompt),
    sessionFile: session.sessionFile,
    lastText: () => session.getLastAssistantText(),
    dispose: () => session.dispose(),
  };
}
