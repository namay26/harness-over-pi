import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containerBash, createBuilderAgent } from "../src/agents/builder.ts";
import type { RoleSessionOptions } from "../src/agents/session.ts";
import { Budget } from "../src/budget.ts";
import { projectDir } from "./fakes.ts";
import { spec } from "./helpers.ts";

describe("containerBash", () => {
  const run = (code: number, timeout?: number) => {
    const calls: string[][] = [];
    const ops = containerBash("/p", async (_dir, args) => { calls.push(args); return { code, output: "" }; });
    const result = ops.exec("echo hi", "/host/path", {
      onData: () => {}, timeout, env: { OPENROUTER_API_KEY: "secret" },
    });
    return { calls, result };
  };
  it("runs inside the shell container with a time limit and no host environment", async () => {
    const { calls, result } = run(0);
    await expect(result).resolves.toEqual({ exitCode: 0 });
    expect(calls[0]).toEqual(["exec", "-T", "shell", "timeout", "-k", "5", "600", "bash", "-c", "echo hi"]);
    expect(JSON.stringify(calls)).not.toContain("secret");
  });
  it("reports a timeout the way pi expects", async () => {
    await expect(run(124, 3).result).rejects.toThrow("timeout:3");
  });
});

/** A fake model that optionally writes a source file on each run. */
function builderWith(writes: boolean[]) {
  const dir = projectDir();
  mkdirSync(join(dir, "app", "src", "db"), { recursive: true });
  writeFileSync(join(dir, "app", "src", "db", "schema.ts"), "export const STARTER_SCHEMA = 1;");
  const prompts: string[] = [];
  let options!: RoleSessionOptions;
  const build = createBuilderAgent({
    projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
    exec: async () => ({ code: 0, output: "" }),
    createSession: async (o) => {
      options = o;
      return {
        sessionFile: undefined, dispose() {}, lastText: () => "done",
        async run(prompt) {
          prompts.push(prompt);
          if (writes.shift()) writeFileSync(join(dir, "app", "src", "page.tsx"), `v${prompts.length}`);
        },
      };
    },
  });
  return { build, prompts, options: () => options, dir };
}

describe("builder agent", () => {
  it("works only in app/ with file, shell and log tools, and gets the deliverables", async () => {
    const b = builderWith([true]);
    await b.build({ spec: spec(), failure: null, changes: null });
    expect(b.options()).toMatchObject({ role: "builder", root: join(b.dir, "app"), resume: true });
    expect(b.options().tools).toEqual(["read", "write", "edit", "bash", "app_logs"]);
    expect(b.prompts[0]).toContain("check off a habit");
  });
  it("includes the starter files so the model need not read them", async () => {
    const b = builderWith([true]);
    await b.build({ spec: spec(), failure: null, changes: null });
    expect(b.prompts[0]).toContain("STARTER_SCHEMA");
    expect(b.options().containerRoot).toBe("/app");
  });
  it("accepts a resumed build that was already written before the interruption", async () => {
    const dir = projectDir();
    mkdirSync(join(dir, "app", "src"), { recursive: true });
    const prompts: string[] = [];
    let interrupt = true;
    const build = createBuilderAgent({
      projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
      exec: async () => ({ code: 0, output: "" }),
      createSession: async () => ({
        sessionFile: undefined, dispose() {}, lastText: () => "",
        async run(prompt) {
          prompts.push(prompt);
          if (!interrupt) return;
          writeFileSync(join(dir, "app", "src", "page.tsx"), "built");
          throw new Error("request limit");
        },
      }),
    });
    await expect(build({ spec: spec(), failure: null, changes: null })).rejects.toThrow("request limit");
    interrupt = false;
    await expect(build({ spec: spec(), failure: null, changes: null })).resolves.toBeUndefined();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("interrupted");
  });
  it("describes a follow-up as a change to the existing app", async () => {
    const b = builderWith([true]);
    await b.build({ spec: spec(), failure: null, changes: "added D4: export" });
    expect(b.prompts[0]).toContain("Change the existing app");
    expect(b.prompts[0]).toContain("added D4: export");
  });
  it("does not resume an interrupted build once the spec has changed", async () => {
    const dir = projectDir();
    mkdirSync(join(dir, "app", "src"), { recursive: true });
    const prompts: string[] = [];
    let interrupt = true;
    const build = createBuilderAgent({
      projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
      exec: async () => ({ code: 0, output: "" }),
      createSession: async () => ({
        sessionFile: undefined, dispose() {}, lastText: () => "",
        async run(prompt) {
          prompts.push(prompt);
          writeFileSync(join(dir, "app", "src", "page.tsx"), `v${prompts.length}`);
          if (interrupt) throw new Error("request limit");
        },
      }),
    });
    await expect(build({ spec: spec(), failure: null, changes: null })).rejects.toThrow();
    interrupt = false;
    await build({ spec: spec(), failure: null, changes: "added D2: export" });
    expect(prompts[1]).toContain("added D2: export");
    expect(prompts[1]).not.toContain("interrupted");
  });
  it("reminds once, then fails, if it ends without changing the app", async () => {
    const b = builderWith([false, false]);
    await expect(b.build({ spec: spec(), failure: null, changes: null })).rejects.toThrow("without changing the app");
    expect(b.prompts).toHaveLength(2);
  });
  it("passes the failure on a fix round", async () => {
    const b = builderWith([true]);
    await b.build({ spec: spec(), failure: "tsc: Cannot find name 'x'", changes: null });
    expect(b.prompts).toHaveLength(1);
    expect(b.prompts[0]).toContain("Cannot find name 'x'");
  });
  it("reminds once, then fails, if a fix round changes nothing", async () => {
    const b = builderWith([false, false]);
    await expect(b.build({ spec: spec(), failure: "boom", changes: null })).rejects.toThrow("without changing the app");
    expect(b.prompts).toHaveLength(2);
  });
  it("counts a fix outside src as a change, but not installed packages", async () => {
    const dir = projectDir();
    mkdirSync(join(dir, "app", "node_modules"), { recursive: true });
    const writes = ["node_modules/x.js", "package.json"];
    let runs = 0;
    const build = createBuilderAgent({
      projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
      exec: async () => ({ code: 0, output: "" }),
      createSession: async () => ({
        sessionFile: undefined, dispose() {}, lastText: () => "",
        async run() { writeFileSync(join(dir, "app", writes[runs++]!), "x"); },
      }),
    });
    await build({ spec: spec(), failure: "boom", changes: null });
    expect(runs).toBe(2);
  });
});
