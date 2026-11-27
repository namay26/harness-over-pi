import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { listFiles } from "../files.ts";
import { compose } from "../sandbox/docker.ts";
import { resetTestApp } from "../sandbox/testApp.ts";
import type { Result, Spec } from "../types.ts";

const TEST_FILE = /\.(spec|test)\.[cm]?[jt]s$/;
const BYPASS = /\btest(?:\.describe)?(?:\.(?:serial|parallel))?\.(skip|fixme|only|fail)\b/;

const testSources = (e2eDir: string) => listFiles(join(e2eDir, "tests"))
  .filter((file) => /\.[cm]?[jt]s$/.test(file))
  .map((file) => ({ name: relative(e2eDir, file), isTest: TEST_FILE.test(file), body: readFileSync(file, "utf8") }));

/** Rejects tests that could report success without checking anything. */
export function lintTests(e2eDir: string): string[] {
  return testSources(e2eDir).flatMap(({ name, isTest, body }) => {
    const problems: string[] = [];
    const bypass = body.match(BYPASS);
    if (bypass) problems.push(`${name}: test.${bypass[1]} is not allowed`);
    if (body.includes("@playwright/test")) problems.push(`${name}: import test and expect from "../fixtures"`);
    if (/\bnewContext\b/.test(body)) problems.push(`${name}: use the otherPage fixture for a second user`);
    if (isTest && !/\bexpect\s*[(.]/.test(body)) problems.push(`${name}: asserts nothing`);
    return problems;
  });
}

export function missingTests(e2eDir: string, spec: Spec): string[] {
  const bodies = testSources(e2eDir).filter((s) => s.isTest).map((s) => s.body);
  return spec.deliverables.map((d) => d.id).filter((id) => !bodies.some((body) => body.includes(`[${id}]`)));
}

/** Drops tests for deliverables that changed or were removed, so they get rewritten or forgotten. */
export function removeTests(e2eDir: string, ids: string[]): void {
  for (const source of testSources(e2eDir)) {
    if (source.isTest && ids.some((id) => source.body.includes(`[${id}]`))) rmSync(join(e2eDir, source.name));
  }
}

interface ReportSpec {
  title: string;
  tests: { status: string; expectedStatus?: string; results: { error?: { message?: string } }[] }[];
}
interface Suite { title?: string; suites?: Suite[]; specs?: ReportSpec[] }
interface Report { suites: Suite[]; errors?: { message?: string }[] }

/** Specs with the titles of their describe blocks prefixed, so a tag on either one counts. */
const specsIn = (suite: Suite, titles = ""): ReportSpec[] => {
  const path = `${titles} ${suite.title ?? ""}`;
  return [
    ...(suite.specs ?? []).map((s) => ({ ...s, title: `${path} ${s.title}`.trim() })),
    ...(suite.suites ?? []).flatMap((child) => specsIn(child, path)),
  ];
};
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500);
const untestedAll = (spec: Spec, evidence: string): Result[] =>
  spec.deliverables.map((d) => ({ id: d.id, status: "untested", evidence }));

/** Turns a Playwright JSON report into one result per deliverable, matched by the [D<n>] title tag. */
export function toResults(report: unknown, spec: Spec): Result[] {
  const { suites, errors } = report as Report;
  const specs = suites.flatMap((suite) => specsIn(suite));
  const loadErrors = plain((errors ?? []).map((e) => e.message).join("\n"));

  return spec.deliverables.map(({ id }) => {
    const tagged = specs.filter((s) => s.title.includes(`[${id}]`));
    const runs = tagged.flatMap((s) => s.tests.map((t) => ({ title: s.title, ...t })));
    // A test that only passes on retry is unreliable, so it counts as a failure.
    const failed = runs.filter((t) =>
      t.status === "unexpected" || t.status === "flaky" || (t.expectedStatus ?? "passed") === "failed");
    if (failed.length > 0) {
      const evidence = failed.map((t) => {
        const message = t.results.find((r) => r.error?.message)?.error?.message ?? t.status;
        return `${t.title} (${t.status}): ${plain(message)}`;
      }).join("\n");
      return { id, status: "fail", evidence };
    }
    if (runs.length === 0) return { id, status: "untested", evidence: loadErrors || "No test for this deliverable." };
    if (runs.some((t) => t.status !== "expected")) return { id, status: "untested", evidence: "A test was skipped." };
    return { id, status: "pass", evidence: "" };
  });
}

export async function ensureTestPackages(dir: string, exec = compose): Promise<void> {
  if (existsSync(join(dir, "e2e", "node_modules"))) return;
  const { code, output } = await exec(dir, ["run", "--rm", "-T", "e2e", "npm", "install"], { timeoutMs: 900_000 });
  if (code !== 0) throw new Error(`Could not install the test packages:\n${output.slice(-2000)}`);
}

/** Runs the saved tests; TypeScript, not the verifier, decides what passed. */
export async function runTests(dir: string, spec: Spec, exec = compose): Promise<Result[]> {
  const e2eDir = join(dir, "e2e");
  const problems = lintTests(e2eDir);
  if (problems.length > 0) return untestedAll(spec, `Tests not run:\n${problems.join("\n")}`);

  const reportFile = join(e2eDir, "results.json");
  rmSync(reportFile, { force: true });
  await ensureTestPackages(dir, exec);
  await resetTestApp(dir, exec);
  const { output } = await exec(
    dir, ["run", "--rm", "-T", "e2e", "npx", "--no-install", "playwright", "test"], { timeoutMs: 900_000 });
  if (!existsSync(reportFile)) throw new Error(`The tests did not produce a report:\n${output.slice(-2000)}`);
  return toResults(JSON.parse(readFileSync(reportFile, "utf8")), spec);
}
