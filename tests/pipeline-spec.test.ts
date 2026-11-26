import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/pipeline.ts";
import { loadSpec, loadState } from "../src/state.ts";
import { fakeAgents, fakeUI, projectDir } from "./fakes.ts";
import { area, spec } from "./helpers.ts";

const open = spec([area("users")]);
const settled = spec([area("users", { builtDifferently: false })]);
const approvals = (asked: { question: string }[]) => asked.filter((a) => a.question.startsWith("Approve"));

describe("spec stage", () => {
  it("asks about an unsettled area with the guess as default, then redrafts once", async () => {
    const dir = projectDir();
    const { agents, specCalls } = fakeAgents([open]);
    const { ui, asked } = fakeUI(["people sign up"]);
    await handleMessage({ dir, agents, ui }, "habit tracker");

    expect(asked[0]).toMatchObject({ fallback: "users guess" });
    expect(asked[0]!.question).toContain("users?");
    expect(specCalls).toHaveLength(2);
    expect(specCalls[1]!.messages.join("\n")).toContain("people sign up");
    expect(asked).toHaveLength(2); // one question, one approval: no second round
    expect(approvals(asked)).toHaveLength(1);
  });

  it("asks nothing when everything is settled", async () => {
    const { agents, specCalls } = fakeAgents([settled]);
    const { ui, asked } = fakeUI();
    await handleMessage({ dir: projectDir(), agents, ui }, "personal tracker, no login");
    expect(asked).toHaveLength(1);
    expect(approvals(asked)).toHaveLength(1);
    expect(specCalls).toHaveLength(1);
  });

  it("saves the deliverables on approval and shows which were assumed", async () => {
    const dir = projectDir();
    const { ui, said } = fakeUI();
    await handleMessage({ dir, agents: fakeAgents([settled]).agents, ui }, "tracker");
    expect(loadSpec(dir)).toEqual(settled);
    expect(loadState(dir)).toMatchObject({ stage: "build", specVersion: 1 });
    expect(said.join("\n")).toMatch(/D1.*check off a habit.*\(assumed\)/);
  });

  it("does not save or build when approval is declined", async () => {
    const dir = projectDir();
    const fake = fakeAgents([settled]);
    await handleMessage({ dir, agents: fake.agents, ui: fakeUI(["no"]).ui }, "tracker");
    expect(loadState(dir).stage).toBe("approval");
    expect(loadSpec(dir)).toBeNull();
    expect(fake.builds()).toBe(0);
  });

  it("redrafts from a typed correction", async () => {
    const fake = fakeAgents([settled]);
    await handleMessage({ dir: projectDir(), agents: fake.agents, ui: fakeUI(["add a notes field"]).ui }, "tracker");
    expect(fake.specCalls).toHaveLength(2);
    expect(fake.specCalls[1]!.messages).toContain("add a notes field");
  });

  it("shows the saved draft again on 'continue' without a model call", async () => {
    const dir = projectDir();
    await handleMessage({ dir, agents: fakeAgents([settled]).agents, ui: fakeUI(["no"]).ui }, "tracker");
    const fake = fakeAgents([settled]);
    await handleMessage({ dir, agents: fake.agents, ui: fakeUI().ui }, "continue");
    expect(fake.specCalls).toHaveLength(0);
    expect(loadSpec(dir)).toEqual(settled);
  });

  it("prints a plain reply and changes nothing when no change was asked", async () => {
    const dir = projectDir();
    await handleMessage({ dir, agents: fakeAgents([settled]).agents, ui: fakeUI().ui }, "tracker");
    const { ui, said, asked } = fakeUI();
    await handleMessage({ dir, agents: fakeAgents([{ reply: "It tracks habits." }]).agents, ui }, "what is this?");
    expect(said).toContain("It tracks habits.");
    expect(asked).toHaveLength(0);
    expect(loadState(dir).specVersion).toBe(1);
  });
});
