// Go/no-go check: can pi run this model, and does the model call a tool correctly?
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";

const id = process.argv[2];
if (!id) throw new Error("usage: smoke.ts <model-id>");

const modelRuntime = await ModelRuntime.create({ modelsPath: resolve("config/models.json"), authPath: resolve(".pi-home/auth.json") });
const model = modelRuntime.getModel("openrouter", id);
if (!model) throw new Error(`model not registered: ${id} (${modelRuntime.getError() ?? "no error"})`);

let received: number | undefined;
let requests = 0;
const statuses: number[] = [];
const tool = defineTool({
  name: "report_number", label: "Report number", description: "Report the computed number.",
  parameters: Type.Object({ n: Type.Number() }),
  async execute(_id, params) {
    received = params.n;
    return { content: [{ type: "text", text: "recorded" }], details: {} };
  },
});

const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: resolve(".pi-home"), settingsManager,
  noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
  extensionFactories: [(pi) => {
    pi.on("before_provider_request", () => { requests++; });
    pi.on("after_provider_response", (e) => { statuses.push(e.status); });
  }],
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  agentDir: resolve(".pi-home"), modelRuntime, model, settingsManager, resourceLoader,
  sessionManager: SessionManager.inMemory(), noTools: "builtin", customTools: [tool],
});
console.log("active tools:", session.getActiveToolNames().join(", "));
session.subscribe((e) => {
  if (e.type === "message_end" && e.message.role === "assistant" && e.message.errorMessage) console.log("model error:", e.message.errorMessage.slice(0, 400));
});
await session.prompt("Call report_number with 7 times 6.");
console.log(received === 42 ? "PASS" : "FAIL", { id, received, requests, statuses });
console.log("last text:", session.getLastAssistantText()?.slice(0, 200));
session.dispose();
