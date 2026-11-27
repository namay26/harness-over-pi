// Prints the questions each prompt would be asked. Costs one request per prompt: npm run eval:intent -- [n]
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSpecAgent } from "../src/agents/spec.ts";
import { Budget } from "../src/budget.ts";
import { config } from "../src/config.ts";
import { pickQuestions } from "../src/spec/questions.ts";

const cases: { prompt: string; maxQuestions?: number }[] =
  JSON.parse(readFileSync(new URL("./prompts.json", import.meta.url), "utf8"));
const only = Number(process.argv[2]) || null;
const budget = new Budget(resolve("workspaces", ".usage.json"), config.dailyRequestLimit);
let failed = false;

for (const [i, { prompt, maxQuestions }] of cases.entries()) {
  if (only && only !== i + 1) continue;
  const spec = createSpecAgent({ projectDir: mkdtempSync(join(tmpdir(), "eval-")), budget });
  const turn = await spec({ messages: [prompt], previous: null });
  const asked = pickQuestions(turn.spec!, [prompt]);
  const ok = maxQuestions === undefined || asked.length <= maxQuestions;
  failed ||= !ok;
  console.log(`\n${i + 1}. ${prompt}\n   ${asked.length} question(s)${ok ? "" : `  EXPECTED AT MOST ${maxQuestions}`}`);
  for (const q of asked) console.log(`   - ${q.question} [default: ${q.guess}]`);
  console.log(`   deliverables: ${turn.spec!.deliverables.map((d) => d.does).join("; ")}`);
}
console.log(`\nrequests used today: ${budget.used()}`);
process.exitCode = failed ? 1 : 0;
