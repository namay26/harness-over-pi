import { describe, expect, it } from "vitest";
import { runUntilTool, runWithFallback } from "../src/agents/session.ts";
import { BudgetExhausted } from "../src/budget.ts";

describe("runUntilTool", () => {
  it("reminds once then throws if the tool is never called", async () => {
    const prompts: string[] = [];
    const session = { run: async (p: string) => { prompts.push(p); } };
    await expect(runUntilTool(session, "go", () => undefined, "submit_spec")).rejects.toThrow("submit_spec");
    expect(prompts).toHaveLength(2);
  });
  it("returns the captured value without a reminder", async () => {
    const prompts: string[] = [];
    const session = { run: async (p: string) => { prompts.push(p); } };
    await expect(runUntilTool(session, "go", () => 7, "t")).resolves.toBe(7);
    expect(prompts).toEqual(["go"]);
  });
});

const driver = (errors: (string | undefined)[]) => {
  const calls: string[] = [];
  return {
    calls,
    prompt: async (text: string) => { calls.push(text); return errors.shift(); },
    useFallback: async () => { calls.push("<fallback>"); },
  };
};
const noWait = async () => {};

describe("runWithFallback", () => {
  it("switches to the fallback model once on a 429", async () => {
    const d = driver(["429: throttled upstream", undefined]);
    await runWithFallback(d, "go", noWait);
    expect(d.calls.slice(0, 2)).toEqual(["go", "<fallback>"]);
    expect(d.calls).toHaveLength(3);
  });
  it("throws with the status if the fallback also fails", async () => {
    await expect(runWithFallback(driver(["429: a", "429: b"]), "go", noWait)).rejects.toThrow("429");
  });
  it("treats the daily free limit as exhausted, without switching", async () => {
    const d = driver(["429: Rate limit exceeded: free-models-per-day"]);
    await expect(runWithFallback(d, "go", noWait)).rejects.toThrow(BudgetExhausted);
    expect(d.calls).toEqual(["go"]);
  });
  it("retries a stalled request once on the same model", async () => {
    const d = driver(["stalled: no reply", undefined]);
    await runWithFallback(d, "go", noWait);
    expect(d.calls).toHaveLength(2);
    expect(d.calls).not.toContain("<fallback>");
    await expect(runWithFallback(driver(["stalled: a", "stalled: b"]), "go", noWait)).rejects.toThrow("stalled");
  });
  it("never reports other model errors as success", async () => {
    await expect(runWithFallback(driver(["500: boom"]), "go", noWait)).rejects.toThrow("boom");
  });
});
