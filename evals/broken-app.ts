// Breaks a copy of a built project and confirms the saved tests notice. Costs no requests.
// Usage: npm run eval:broken -- <project> <file under app/> <text to find> <replacement> <D-id>
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compose } from "../src/sandbox/docker.ts";
import { loadSpec } from "../src/state.ts";
import { runBasicChecks } from "../src/verify/basic.ts";
import { runTests } from "../src/verify/runner.ts";

const [name, file, find, replacement, id] = process.argv.slice(2);
if (!name || !file || !find || replacement === undefined || !id) {
  throw new Error("usage: <project> <file under app/> <text to find> <replacement> <D-id>");
}
process.env.WEB_PORT ??= "3001";
const source = resolve("workspaces", name);
const copy = resolve("workspaces", `${name}-broken`);
rmSync(copy, { recursive: true, force: true });
cpSync(source, copy, { recursive: true, filter: (path) => !path.endsWith("/.next") });
try {
  const target = join(copy, "app", file);
  const original = readFileSync(target, "utf8");
  if (!original.includes(find)) throw new Error(`"${find}" is not in ${file}`);
  writeFileSync(target, original.replace(find, replacement));

  const checked = await runBasicChecks(copy);
  if (!checked.ok) throw new Error(`The broken copy does not build, so the tests were not exercised: ${checked.step}`);
  const results = await runTests(copy, loadSpec(copy)!);
  for (const r of results) console.log(`${r.id} ${r.status}`);
  const caught = results.find((r) => r.id === id)?.status === "fail";
  console.log(caught ? `CAUGHT: ${id} fails on the broken app` : `MISSED: ${id} did not fail`);
  process.exitCode = caught ? 0 : 1;
} finally {
  await compose(copy, ["down", "-v"]);
  rmSync(copy, { recursive: true, force: true });
}
