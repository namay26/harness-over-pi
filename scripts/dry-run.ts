// Drives the real builder and verifier sessions with a scripted local model. Costs no requests.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Call = [tool: string, args: Record<string, unknown>];
let script: Call[] = [];
const bodies: { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] }[] = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    bodies.push(JSON.parse(body));
    const next = script.shift();
    const delta = next
      ? { tool_calls: [{ index: 0, id: `call_${bodies.length}`, type: "function",
          function: { name: next[0], arguments: JSON.stringify(next[1]) } }] }
      : { content: "finished" };
    const chunk = (d: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(chunk({ role: "assistant", ...delta }, null) + chunk({}, next ? "tool_calls" : "stop") + "data: [DONE]\n\n");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

const tmp = mkdtempSync(join(tmpdir(), "dry-"));
const models = JSON.parse(readFileSync("config/models.json", "utf8"));
Object.assign(models.providers.openrouter, { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: "fake" });
writeFileSync(join(tmp, "models.json"), JSON.stringify(models));
process.env.MODELS_FILE = join(tmp, "models.json");

const { createBuilderAgent } = await import("../src/agents/builder.ts");
const { createVerifierAgent } = await import("../src/agents/verifier.ts");
const { Budget } = await import("../src/budget.ts");
const { compose } = await import("../src/sandbox/docker.ts");
const { createProject } = await import("../src/sandbox/project.ts");

const project = createProject("dryrun");
const budget = new Budget(join(tmp, "usage.json"), 100);
const spec = {
  idea: "dry run", areas: [], notBuilding: [], constraints: [], needsAccounts: false,
  deliverables: [{ id: "D1", does: "show a heading", source: "said" as const, check: "see it" }],
};
const toolResults = () => bodies.at(-1)!.messages.filter((m) => m.role === "tool").map((m) => JSON.stringify(m.content).slice(0, 160));
const show = (label: string) => {
  console.log(`\n== ${label}\ntools offered: ${bodies.at(-1)!.tools?.map((t) => t.function.name).join(", ")}`);
  for (const r of toolResults()) console.log("  ->", r);
};

try {
  script = [
    ["write", { path: "/app/src/app/dry.tsx", content: "export const dry = 1;" }],
    ["read", { path: "../compose.yaml" }],
    ["bash", { command: 'pwd; ls src/app/dry.tsx; echo "key=[$OPENROUTER_API_KEY]"' }],
  ];
  await createBuilderAgent({ projectDir: project.dir, budget })({ spec, failure: null, changes: null });
  show("builder");
  const system = JSON.stringify(bodies[0]!.messages[0]!.content);
  console.log("system prompt chars:", system.length, "| mentions harness folder:", system.includes(".builder"));
  console.log(system.slice(-400));

  script = [
    ["write", { path: "e2e/tests/d1.spec.ts", content: 'import { expect, test } from "../fixtures";\ntest("[D1] x", async () => { expect(1).toBe(1); });\n' }],
    ["write", { path: "app/src/app/hacked.tsx", content: "x" }],
    ["write", { path: "e2e/fixtures.ts", content: "x" }],
    ["read", { path: ".builder/state.json" }],
    ["read", { path: "app/src/app/dry.tsx" }],
  ];
  const verifier = createVerifierAgent({ projectDir: project.dir, budget, exec: async () => ({ code: 0, output: "- heading" }) });
  await verifier.writeTests({ spec, ids: ["D1"] });
  show("verifier");
  console.log("app untouched:", !existsSync(join(project.appDir, "src/app/hacked.tsx")), "| test written:", existsSync(join(project.e2eDir, "tests/d1.spec.ts")));
  console.log("requests counted:", budget.used(), "served:", bodies.length);
} finally {
  server.close();
  await compose(project.dir, ["down", "-v"]);
}
