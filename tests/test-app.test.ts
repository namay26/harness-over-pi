import { describe, expect, it } from "vitest";
import { resetTestApp } from "../src/sandbox/testApp.ts";

function fakeExec(pushOutput = "[✓] Changes applied") {
  const calls: string[] = [];
  const exec = async (_dir: string, args: string[]) => {
    const line = args.join(" ");
    calls.push(line);
    return { code: 0, output: line.includes("drizzle-kit") ? pushOutput : "" };
  };
  return { exec, calls };
}

describe("resetTestApp", () => {
  it("recreates only the test database, applies the schema and starts the test server", async () => {
    const f = fakeExec();
    await resetTestApp("/p", f.exec);
    const all = f.calls.join("\n");
    expect(all).toContain("DROP DATABASE IF EXISTS app_test WITH (FORCE)");
    expect(all).not.toMatch(/DROP DATABASE IF EXISTS app\b(?!_test)/);
    expect(all).toMatch(/run --rm -T -e DATABASE_URL=\S+\/app_test shell npx --no-install drizzle-kit push --force/);
    expect(f.calls.at(-1)).toBe("up -d --wait --force-recreate web-test");
  });
  it("fails if the schema did not apply", async () => {
    await expect(resetTestApp("/p", fakeExec("severity: ERROR").exec)).rejects.toThrow("severity: ERROR");
  });
});
