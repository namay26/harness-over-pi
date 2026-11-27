// No model requests: runs the real test runner, page snapshot and database query against a built project.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { queryDatabase } from "../src/agents/verifier.ts";
import { compose } from "../src/sandbox/docker.ts";
import { createProject } from "../src/sandbox/project.ts";
import { loadSpec } from "../src/state.ts";
import { runBasicChecks } from "../src/verify/basic.ts";
import { runTests } from "../src/verify/runner.ts";

const { dir, e2eDir } = createProject(process.argv[2] ?? "demo");
const spec = loadSpec(dir)!;
console.log("basic checks:", (await runBasicChecks(dir)).ok);

const head = 'import { expect, test } from "../fixtures";\n';
const add = `const name = "Probe " + Date.now();
  await page.goto("/");
  await page.getByRole("button", { name: "Add Habit" }).click();
  await page.getByPlaceholder("Habit name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.reload();
  await expect(page.getByText(name)).toBeVisible();`;
const second = `test("[D1] second visitor", async ({ page, otherPage }) => {
  await page.goto("/");
  await otherPage.goto("/");
  await expect(otherPage.getByRole("button", { name: "Add Habit" })).toBeVisible();
});\n`;
const files = {
  "zz-good.spec.ts": `${head}test("[D4] adds a habit", async ({ page }) => {\n  ${add}\n});\n`,
  "zz-second.spec.ts": head + second,
  "zz-bad.spec.ts": `${head}test("[D3] impossible streak", async ({ page }) => {\n  await page.goto("/");\n  await expect(page.getByText("999 day streak")).toBeVisible({ timeout: 3000 });\n});\n`,
};
const previewCount = async () => (await compose(dir, ["exec", "-T", "db", "psql", "-U", "app", "-d", "app", "-tAc", "select count(*) from habits"])).output.trim();
try {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(e2eDir, "tests", name), body);
  const before = await previewCount();
  for (const round of [1, 2]) {
    console.log(`run ${round}:`);
    for (const r of await runTests(dir, spec)) console.log(`  ${r.id} ${r.status} ${r.evidence.split("\n")[0]!.slice(0, 110)}`);
  }
  console.log("preview rows before/after tests:", before, await previewCount());
  const snapshot = await compose(dir, ["run", "--rm", "-T", "e2e", "node", "snapshot.mjs", "/"]);
  console.log("snapshot:", snapshot.output.split("\n").filter((l) => /HTTP|heading|button "Add/.test(l)).join(" / "));
  console.log((await queryDatabase(dir, "select count(*) as test_rows from habits")).trim());
  console.log((await queryDatabase(dir, "delete from habits")).trim().split("\n").at(-1));
} finally {
  for (const name of Object.keys(files)) rmSync(join(e2eDir, "tests", name), { force: true });
}
