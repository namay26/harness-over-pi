// Runs a project's saved browser tests and prints the results. Costs no requests.
import { createProject } from "../src/sandbox/project.ts";
import { loadSpec } from "../src/state.ts";
import { runTests } from "../src/verify/runner.ts";

const { dir } = createProject(process.argv[2] ?? "demo");
for (const r of await runTests(dir, loadSpec(dir)!)) console.log(`${r.id} ${r.status}\n${r.evidence.slice(0, 700)}`);
