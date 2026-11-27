import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/pipeline.ts";
import { loadState } from "../src/state.ts";
import type { Result } from "../src/types.ts";
import { fakeAgents, fakeChecks, fakeTests, fakeUI, projectDir } from "./fakes.ts";
import { area, spec } from "./helpers.ts";

const settled = spec([area("users", { builtDifferently: false })]);
const pass: Result[] = [{ id: "D1", status: "pass", evidence: "" }];
const fail: Result[] = [{ id: "D1", status: "fail", evidence: "streak shows 0" }];
const untested: Result[] = [{ id: "D1", status: "untested", evidence: "no test" }];

async function drive(o: { runs: Result[][]; testsChanged?: boolean; missing?: string[] }) {
  const dir = projectDir();
  const fake = fakeAgents([settled]);
  let triaged = 0;
  fake.agents.triage = async () => { triaged++; return { testsChanged: !!o.testsChanged, notes: "looked" }; };
  const written: string[][] = [];
  fake.agents.writeTests = async ({ ids }) => { written.push(ids); };
  const tests = fakeTests(o.runs, o.missing);
  const checks = fakeChecks();
  const { ui, said } = fakeUI();
  await handleMessage({ dir, agents: fake.agents, ui, checks: checks.checks, tests }, "tracker");
  return { state: loadState(dir), fake, said: said.join("\n"), written, tests, checks, triaged: () => triaged };
}

describe("verify stage", () => {
  it("writes missing tests, and says done only when everything passes", async () => {
    const r = await drive({ runs: [pass], missing: ["D1"] });
    expect(r.written).toEqual([["D1"]]);
    expect(r.state).toMatchObject({ stage: "done", results: pass });
    expect(r.said).toMatch(/Done.*\n.*D1.*pass/);
    expect(r.triaged()).toBe(0);
  });
  it("reruns once without building when triage corrected a test", async () => {
    const r = await drive({ runs: [fail, pass], testsChanged: true });
    expect(r.tests.runs()).toBe(2);
    expect(r.fake.builds()).toBe(1);
    expect(r.state.stage).toBe("done");
    expect(r.state.results[0]!.evidence).toContain("rewrote");
    expect(r.said).toMatch(/D1.*pass\n.*rewrote/);
  });
  it("sends app failures to the builder with evidence, then checks again", async () => {
    const r = await drive({ runs: [fail, pass] });
    expect(r.fake.buildInputs[1]!.failure).toContain("streak shows 0");
    expect(r.checks.runs()).toBe(2);
    expect(r.state.stage).toBe("done");
  });
  it("stops after 3 fix rounds, lists statuses and never says done", async () => {
    const r = await drive({ runs: [fail] });
    expect(r.fake.builds()).toBe(4);
    expect(r.state).toMatchObject({ stage: "verify", round: 3 });
    expect(r.said).toMatch(/D1.*fail/);
    expect(r.said).not.toContain("Done");
  });
  it("does not blame the builder for deliverables that could not be tested", async () => {
    const r = await drive({ runs: [untested] });
    expect(r.fake.builds()).toBe(1);
    expect(r.state.stage).toBe("verify");
    expect(r.said).toMatch(/D1.*untested/);
    expect(r.said).not.toContain("Done");
  });
});
