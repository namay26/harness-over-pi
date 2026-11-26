import { describe, expect, it } from "vitest";
import { BudgetExhausted } from "../src/budget.ts";
import { handleMessage } from "../src/pipeline.ts";
import { loadState } from "../src/state.ts";
import type { CheckResult } from "../src/verify/basic.ts";
import { fakeAgents, fakeChecks, fakeTests, fakeUI, projectDir } from "./fakes.ts";
import { area, spec } from "./helpers.ts";

const settled = spec([area("users", { builtDifferently: false })]);
const bad: CheckResult = { ok: false, step: "tsc", output: "type error here" };

describe("build stage", () => {
  it("feeds a failed check back to the builder, then shows the preview", async () => {
    const dir = projectDir();
    const fake = fakeAgents([settled]);
    const checks = fakeChecks([bad, { ok: true, url: "http://localhost:3000" }]);
    const { ui, said } = fakeUI();
    await handleMessage({ dir, agents: fake.agents, ui, checks: checks.checks, tests: fakeTests() }, "tracker");

    expect(fake.buildInputs.map((i) => i.failure)).toEqual([null, "tsc failed:\ntype error here"]);
    expect(loadState(dir)).toMatchObject({ stage: "done", lastFailure: null });
    expect(said.join("\n")).toContain("http://localhost:3000");
  });

  it("stops after 3 fix rounds and says what fails", async () => {
    const dir = projectDir();
    const fake = fakeAgents([settled]);
    const { ui, said } = fakeUI();
    await handleMessage({ dir, agents: fake.agents, ui, checks: fakeChecks([bad]).checks, tests: fakeTests() }, "tracker");
    expect(fake.builds()).toBe(4);
    expect(loadState(dir)).toMatchObject({ stage: "checks", round: 3 });
    expect(said.at(-1)).toContain("type error here");
  });

  it("on 'continue' after giving up, checks first and allows new rounds", async () => {
    const dir = projectDir();
    await handleMessage({ dir, agents: fakeAgents([settled]).agents, ui: fakeUI().ui, checks: fakeChecks([bad]).checks, tests: fakeTests() }, "tracker");
    const fake = fakeAgents([settled]);
    const checks = fakeChecks([{ ok: true, url: "u" }]);
    await handleMessage({ dir, agents: fake.agents, ui: fakeUI().ui, checks: checks.checks, tests: fakeTests() }, "continue");
    expect(fake.builds()).toBe(0);
    expect(loadState(dir).stage).toBe("done");
  });

  it("resumes the build after the request limit without drafting again", async () => {
    const dir = projectDir();
    const limited = fakeAgents([settled]);
    limited.agents.build = async () => { throw new BudgetExhausted(); };
    const checks = fakeChecks([{ ok: true, url: "u" }]);
    await expect(handleMessage({ dir, agents: limited.agents, ui: fakeUI().ui, checks: checks.checks, tests: fakeTests() }, "tracker"))
      .rejects.toThrow(BudgetExhausted);
    expect(loadState(dir).stage).toBe("build");

    const fake = fakeAgents([settled]);
    await handleMessage({ dir, agents: fake.agents, ui: fakeUI().ui, checks: checks.checks, tests: fakeTests() }, "continue");
    expect(fake.specCalls).toHaveLength(0);
    expect(fake.builds()).toBe(1);
    expect(loadState(dir).stage).toBe("done");
  });

  it("keeps the stage when a follow-up is only a question", async () => {
    const dir = projectDir();
    const checks = fakeChecks().checks;
    await handleMessage({ dir, agents: fakeAgents([settled]).agents, ui: fakeUI().ui, checks, tests: fakeTests() }, "tracker");
    const fake = fakeAgents([{ reply: "It tracks habits." }]);
    await handleMessage({ dir, agents: fake.agents, ui: fakeUI().ui, checks, tests: fakeTests() }, "what is it?");
    expect(loadState(dir).stage).toBe("done");
    expect(fake.builds()).toBe(0);
  });
});
