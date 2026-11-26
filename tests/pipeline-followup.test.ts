import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/pipeline.ts";
import { diffSpec, renderChanges } from "../src/spec/diff.ts";
import { loadSpec, loadState } from "../src/state.ts";
import type { Deliverable } from "../src/types.ts";
import { fakeAgents, fakeChecks, fakeTests, fakeUI, projectDir } from "./fakes.ts";
import { area, spec } from "./helpers.ts";

const d = (id: string, check = id): Deliverable => ({ id, does: `does ${id}`, source: "said", check });
const settled = [area("users", { builtDifferently: false })];
const first = spec(settled, { deliverables: [d("D1"), d("D2"), d("D3")] });
const next = spec(settled, { deliverables: [d("D1"), d("D2", "new check"), d("D4")] });

describe("diffSpec", () => {
  it("finds added, changed and removed deliverables", () => {
    const diff = diffSpec(first, next);
    expect([diff.added, diff.changed, diff.removed].map((list) => list.map((x) => x.id)))
      .toEqual([["D4"], ["D2"], ["D3"]]);
    expect(renderChanges(diff)).toContain("removed D3");
  });
});

/** Builds `first`, then returns what is needed to drive a follow-up on the same project. */
async function built() {
  const dir = projectDir();
  await handleMessage(
    { dir, agents: fakeAgents([first]).agents, ui: fakeUI().ui, checks: fakeChecks().checks, tests: fakeTests([allPass(first)]) },
    "tracker");
  return dir;
}
const allPass = (s: typeof first) => s.deliverables.map((x) => ({ id: x.id, status: "pass" as const, evidence: "" }));

describe("follow-up requests", () => {
  it("shows the changes, drops stale tests and tells the builder what changed", async () => {
    const dir = await built();
    const fake = fakeAgents([next]);
    const tests = fakeTests([allPass(next)]);
    const { ui, said } = fakeUI();
    await handleMessage({ dir, agents: fake.agents, ui, checks: fakeChecks().checks, tests }, "change streaks");

    expect(fake.specCalls[0]!.previous).toEqual(first);
    expect(said.join("\n")).toMatch(/added D4[\s\S]*changed D2[\s\S]*removed D3/);
    expect(tests.removed).toEqual([["D2", "D3"]]);
    expect(fake.buildInputs[0]!.changes).toContain("added D4");
    expect(loadState(dir)).toMatchObject({ stage: "done", specVersion: 2, changes: null });
  });

  it("changes nothing when the new draft is not approved", async () => {
    const dir = await built();
    const fake = fakeAgents([next]);
    const tests = fakeTests();
    await handleMessage({ dir, agents: fake.agents, ui: fakeUI(["no"]).ui, checks: fakeChecks().checks, tests }, "change it");
    expect(loadSpec(dir)).toEqual(first);
    expect(tests.removed).toEqual([]);
    expect(fake.builds()).toBe(0);
  });

  it("builds the whole app, not a change, the first time", async () => {
    const dir = projectDir();
    const fake = fakeAgents([first]);
    await handleMessage(
      { dir, agents: fake.agents, ui: fakeUI().ui, checks: fakeChecks().checks, tests: fakeTests([allPass(first)]) }, "tracker");
    expect(fake.buildInputs[0]!.changes).toBeNull();
  });
});
