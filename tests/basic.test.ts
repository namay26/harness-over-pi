import { describe, expect, it } from "vitest";
import { runBasicChecks } from "../src/verify/basic.ts";

/** Fake docker compose. `failOn` makes the first command containing that text fail. */
function fakeExec(failOn?: string, output = "boom") {
  const calls: string[] = [];
  const exec = async (_dir: string, args: string[]) => {
    const line = args.join(" ");
    calls.push(line);
    if (failOn && line.includes(failOn)) return { code: 1, output };
    return { code: 0, output: line.includes("drizzle-kit") ? "[✓] Changes applied" : "" };
  };
  return { exec, calls };
}
const answers = (status: number) => async () => ({ url: "http://localhost:3000", status });

describe("runBasicChecks", () => {
  it("runs the real tools in order and never an npm script", async () => {
    const f = fakeExec();
    await expect(runBasicChecks("/p", f.exec, answers(200))).resolves.toEqual({ ok: true, url: "http://localhost:3000" });
    expect(f.calls).toEqual([
      "up -d --wait db",
      "run --rm shell npm install",
      "run --rm shell npx --no-install drizzle-kit push --force",
      "run --rm shell npx --no-install tsc --noEmit",
      "run --rm shell npx --no-install next build",
      "up -d --force-recreate web",
    ]);
    expect(f.calls.join()).not.toMatch(/npm run/);
  });
  it("stops at the first failure and keeps the last 4000 characters", async () => {
    const f = fakeExec("tsc", `START${"x".repeat(5000)}END`);
    const result = await runBasicChecks("/p", f.exec, answers(200));
    expect(result).toMatchObject({ ok: false, step: "npx --no-install tsc --noEmit" });
    if (result.ok) return;
    expect(result.output).toHaveLength(4000);
    expect(result.output.endsWith("END")).toBe(true);
    expect(f.calls.join()).not.toContain("next build");
  });
  it("fails when the database push exits 0 without applying the schema", async () => {
    const exec = async () => ({ code: 0, output: "severity: 'ERROR', code: '22P02'" });
    await expect(runBasicChecks("/p", exec, answers(200)))
      .resolves.toMatchObject({ ok: false, step: "npx --no-install drizzle-kit push --force" });
  });
  it("fails with the server log when the home page returns an error", async () => {
    const exec = async (_d: string, args: string[]) =>
      ({ code: 0, output: args[0] === "logs" ? "TypeError in page" : "[i] No changes detected" });
    const result = await runBasicChecks("/p", exec, answers(500));
    expect(result).toMatchObject({ ok: false, step: "GET / returned 500" });
    if (!result.ok) expect(result.output).toContain("TypeError in page");
  });
  it("throws for docker problems instead of asking the builder to fix them", async () => {
    await expect(runBasicChecks("/p", fakeExec("force-recreate", "port is already allocated").exec, answers(200)))
      .rejects.toThrow("port is already allocated");
  });
});
