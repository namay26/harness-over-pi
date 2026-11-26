import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RoleSessionOptions } from "../src/agents/session.ts";
import { createVerifierAgent, queryDatabase } from "../src/agents/verifier.ts";
import { Budget } from "../src/budget.ts";
import { projectDir } from "./fakes.ts";
import { spec } from "./helpers.ts";

function verifierWith(onRun: (dir: string, call: number) => void) {
  const dir = projectDir();
  mkdirSync(join(dir, "app", "src"), { recursive: true });
  mkdirSync(join(dir, "e2e", "tests"), { recursive: true });
  writeFileSync(join(dir, "app", "src", "page.tsx"), "APP_SOURCE_MARKER");
  const prompts: string[] = [];
  let options!: RoleSessionOptions;
  const agents = createVerifierAgent({
    projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
    exec: async () => ({ code: 0, output: "- button 'Add'" }),
    createSession: async (o) => {
      options = o;
      return {
        sessionFile: undefined, dispose() {}, lastText: () => "the app is wrong",
        async run(prompt) { prompts.push(prompt); onRun(dir, prompts.length); },
      };
    },
  });
  return { dir, agents, prompts, options: () => options };
}
const write = (dir: string, body: string) => writeFileSync(join(dir, "e2e", "tests", "d1.spec.ts"), body);

describe("verifier agent", () => {
  it("can write only tests, has no shell, and starts fresh", async () => {
    const v = verifierWith((dir) => write(dir, 'test("[D1] a")'));
    await v.agents.writeTests({ spec: spec(), ids: ["D1"] });
    expect(v.options()).toMatchObject({
      role: "verifier", resume: false, root: v.dir,
      readable: [join(v.dir, "app"), join(v.dir, "e2e")], writable: [join(v.dir, "e2e", "tests")],
    });
    expect(v.options().tools).toEqual(["read", "write", "edit", "page_snapshot", "app_logs", "db_query"]);
    expect(v.prompts[0]).toContain("APP_SOURCE_MARKER");
    expect(v.prompts[0]).toContain("button 'Add'");
  });
  it("reminds once about deliverables left without a test", async () => {
    const v = verifierWith(() => {});
    await v.agents.writeTests({ spec: spec(), ids: ["D1"] });
    expect(v.prompts).toHaveLength(2);
    expect(v.prompts[1]).toContain("D1");
  });
  it("measures whether triage changed a test instead of trusting the model", async () => {
    const failures = [{ id: "D1", status: "fail" as const, evidence: "boom" }];
    const untouched = verifierWith(() => {});
    await expect(untouched.agents.triage({ spec: spec(), failures }))
      .resolves.toEqual({ testsChanged: false, notes: "the app is wrong" });
    const edited = verifierWith((dir) => write(dir, "fixed"));
    await expect(edited.agents.triage({ spec: spec(), failures })).resolves.toMatchObject({ testsChanged: true });
    expect(readFileSync(join(edited.dir, ".builder", "triage.log"), "utf8")).toContain("the app is wrong");
  });
});

describe("queryDatabase", () => {
  it("runs as the read-only role", async () => {
    let args: string[] = [];
    await queryDatabase("/p", "select 1", async (_d, a) => { args = a; return { code: 0, output: "1" }; });
    expect(args).toEqual(["exec", "-T", "-e", "PGPASSWORD=reader", "db",
      "psql", "-h", "127.0.0.1", "-U", "reader", "-d", "app", "-c", "select 1"]);
  });
  it("refuses psql commands, which can run a shell or switch user", async () => {
    await expect(queryDatabase("/p", "\\! id", async () => ({ code: 0, output: "" }))).rejects.toThrow("SQL only");
  });
});
