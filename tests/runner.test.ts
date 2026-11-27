import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintTests, missingTests, removeTests, runTests, toResults } from "../src/verify/runner.ts";
import { spec } from "./helpers.ts";

const two = spec([], {
  deliverables: ["D1", "D2"].map((id) => ({ id, does: id, source: "said" as const, check: id })),
});
const run = (title: string, status: string, message?: string) => ({
  title, tests: [{ status, results: [{ error: message ? { message } : undefined }] }],
});
const report = (...specs: unknown[]) => ({ suites: [{ suites: [{ specs }] }] });

function e2e(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"));
  mkdirSync(join(dir, "tests"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "tests", name), body);
  return dir;
}
const GOOD = 'import { expect, test } from "../fixtures";\ntest("[D1] a", async () => { expect(1).toBe(1); });\n';

describe("toResults", () => {
  const statusOf = (r: unknown) => toResults(r, two).map((x) => x.status);
  it("marks a deliverable without a test as untested", () => {
    expect(statusOf(report(run("[D1] a", "expected")))).toEqual(["pass", "untested"]);
  });
  it("fails on any failing test and keeps the error", () => {
    const [d1] = toResults(report(run("[D1] a", "expected"), run("[D1] b", "unexpected", "no such button")), two);
    expect(d1).toMatchObject({ status: "fail", evidence: expect.stringContaining("no such button") });
  });
  it("treats skipped as untested and flaky as failed", () => {
    expect(statusOf(report(run("[D1] a", "skipped"), run("[D2] b", "flaky")))).toEqual(["untested", "fail"]);
  });
  it("matches the tag on a surrounding describe block", () => {
    const tagged = { suites: [{ title: "[D1] habits", specs: [run("adds one", "expected")] }] };
    expect(toResults(tagged, two)[0]!.status).toBe("pass");
  });
  it("never passes a test that is expected to fail", () => {
    const inverted = run("[D1] a", "expected");
    Object.assign(inverted.tests[0]!, { expectedStatus: "failed" });
    expect(toResults(report(inverted), two)[0]!.status).toBe("fail");
  });
  it("reports load errors as evidence for untested deliverables", () => {
    const [d1] = toResults({ suites: [], errors: [{ message: "SyntaxError in d1.spec.ts" }] }, two);
    expect(d1).toMatchObject({ status: "untested", evidence: expect.stringContaining("SyntaxError") });
  });
});

describe("lintTests", () => {
  it("accepts a normal test", () => expect(lintTests(e2e({ "a.spec.ts": GOOD }))).toEqual([]));
  it.each(["test.skip(", "test.fixme(", "test.only(", "test.fail(", "test.describe.skip("])("flags %s", (call) => {
    expect(lintTests(e2e({ "a.spec.ts": `${GOOD}${call}"x");` }))).not.toEqual([]);
  });
  it("flags bypassing the shared fixtures", () => {
    expect(lintTests(e2e({ "a.spec.ts": GOOD.replace("../fixtures", "@playwright/test") }))).not.toEqual([]);
  });
  it("flags a second browser context, which would skip the error checks", () => {
    expect(lintTests(e2e({ "a.spec.ts": `${GOOD}await browser.newContext();` }))).not.toEqual([]);
  });
  it("flags a file that asserts nothing", () => {
    expect(lintTests(e2e({ "a.spec.ts": GOOD.replace("expect(1).toBe(1);", "") }))).not.toEqual([]);
  });
});

describe("missingTests", () => {
  it("lists deliverables no test is tagged with", () => {
    expect(missingTests(e2e({ "a.spec.ts": GOOD }), two)).toEqual(["D2"]);
  });
});

describe("removeTests", () => {
  it("deletes only test files tagged with the given deliverables", () => {
    const dir = e2e({ "d1.spec.ts": GOOD, "d2.spec.ts": GOOD.replace("[D1]", "[D2]") });
    removeTests(dir, ["D1"]);
    expect([existsSync(join(dir, "tests", "d1.spec.ts")), existsSync(join(dir, "tests", "d2.spec.ts"))])
      .toEqual([false, true]);
  });
});

describe("runTests", () => {
  it("empties the test tables before each test file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    mkdirSync(join(dir, "e2e", "tests"), { recursive: true });
    mkdirSync(join(dir, "e2e", "node_modules"));
    writeFileSync(join(dir, "e2e", "tests", "d1.spec.ts"), GOOD);
    writeFileSync(join(dir, "e2e", "tests", "d2.spec.ts"), GOOD.replace("[D1]", "[D2]"));
    const steps: string[] = [];
    const results = await runTests(dir, two, async (_d, args) => {
      const line = args.join(" ");
      if (line.includes("TRUNCATE")) steps.push("empty");
      const file = line.match(/playwright test (\S+)/)?.[1];
      if (file) {
        steps.push(file);
        const id = file.includes("d1") ? "[D1] a" : "[D2] b";
        writeFileSync(join(dir, "e2e", "results.json"), JSON.stringify(report(run(id, "expected"))));
      }
      return { code: 0, output: "Changes applied" };
    });
    expect(steps).toEqual(["empty", "tests/d1.spec.ts", "empty", "tests/d2.spec.ts"]);
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    mkdirSync(join(dir, "e2e", "tests"), { recursive: true });
    mkdirSync(join(dir, "e2e", "node_modules"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "e2e", "tests", name), body);
    return dir;
  };

  it("does not count a test that breaks the rules, but still runs the others", async () => {
    const dir = project({ "d1.spec.ts": GOOD, "d2.spec.ts": `${GOOD.replace("[D1]", "[D2]")}await page.request.post("/x");` });
    const results = await runTests(dir, two, async (_d, args) => {
      if (args.includes("playwright")) {
        writeFileSync(join(dir, "e2e", "results.json"), JSON.stringify(report(run("[D1] a", "expected"), run("[D2] b", "expected"))));
      }
      return { code: 0, output: "Changes applied" };
    });
    expect(results.map((r) => r.status)).toEqual(["pass", "untested"]);
    expect(results[1]!.evidence).toContain("API");
  });
  it("never reads a report left over from an earlier run", async () => {
    const dir = project({ "a.spec.ts": GOOD });
    const stale = join(dir, "e2e", "results.json");
    writeFileSync(stale, JSON.stringify(report(run("[D1] a", "expected"))));
    await expect(runTests(dir, two, async () => ({ code: 1, output: "browser crashed" })))
      .rejects.toThrow("browser crashed");
    expect(existsSync(stale)).toBe(false);
  });
});
