import { describe, expect, it } from "vitest";
import { RunLimits } from "../src/agents/limits.ts";

describe("RunLimits", () => {
  it("allows only the given number of requests per run", () => {
    const limits = new RunLimits(2);
    expect([limits.takeRequest(), limits.takeRequest(), limits.takeRequest()]).toEqual([true, true, false]);
    limits.reset();
    expect(limits.takeRequest()).toBe(true);
  });
  it("detects the same call made a third time", () => {
    const limits = new RunLimits(10);
    const call = () => limits.isLoop("write", { path: "run.sh", content: "x" }, false);
    expect([call(), call(), call()]).toEqual([false, false, true]);
    expect(limits.isLoop("write", { path: "other" }, false)).toBe(false);
  });
  it("stops after a third refused call even if each differs", () => {
    const limits = new RunLimits(10);
    expect(["a", "b", "c"].map((path) => limits.isLoop("write", { path }, true))).toEqual([false, false, true]);
  });
});
