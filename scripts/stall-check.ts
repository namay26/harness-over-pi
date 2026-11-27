// A fake model that never answers: the request must be cancelled, retried once and reported. Costs nothing.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

let served = 0;
const server = createServer(() => { served++; });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const tmp = mkdtempSync(join(tmpdir(), "stall-"));
const models = JSON.parse(readFileSync("config/models.json", "utf8"));
Object.assign(models.providers.openrouter, { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: "fake" });
writeFileSync(join(tmp, "models.json"), JSON.stringify(models));
Object.assign(process.env, { MODELS_FILE: join(tmp, "models.json"), STALL_SECONDS: "3" });

const { createRoleSession } = await import("../src/agents/session.ts");
const { Budget } = await import("../src/budget.ts");
mkdirSync(join(tmp, "app"));
const session = await createRoleSession({
  role: "builder", projectDir: tmp, root: join(tmp, "app"), systemPrompt: "x", tools: ["read"], customTools: [],
  resume: false, budget: new Budget(join(tmp, "usage.json"), 10), onTool: (line) => console.log(" ", line),
});
const started = Date.now();
try {
  await session.run("hello");
  console.log("FAIL: returned without an error");
} catch (error) {
  console.log("threw:", (error as Error).message, `| after ${Math.round((Date.now() - started) / 1000)}s, requests ${served}`);
}
session.dispose();
server.closeAllConnections();
server.close();
