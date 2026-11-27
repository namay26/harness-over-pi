import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchStall } from "../src/agents/watchdog.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchStall", () => {
  it("fires after a quiet spell, and activity restarts the clock", () => {
    const stalled = vi.fn();
    const dog = watchStall(1000, stalled);
    vi.advanceTimersByTime(900);
    dog.see("message_update");
    vi.advanceTimersByTime(900);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(stalled).toHaveBeenCalledOnce();
  });
  it("waits while tools are running, which have their own limits", () => {
    const stalled = vi.fn();
    const dog = watchStall(1000, stalled);
    dog.see("tool_execution_start");
    dog.see("tool_execution_start");
    dog.see("tool_execution_end");
    vi.advanceTimersByTime(5000);
    expect(stalled).not.toHaveBeenCalled();
    dog.see("tool_execution_end");
    vi.advanceTimersByTime(1100);
    expect(stalled).toHaveBeenCalledOnce();
  });
  it("stays silent once stopped", () => {
    const stalled = vi.fn();
    watchStall(1000, stalled).stop();
    vi.advanceTimersByTime(5000);
    expect(stalled).not.toHaveBeenCalled();
  });
});
