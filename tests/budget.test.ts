import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget, BudgetExhausted } from "../src/budget.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "budget-")), "usage.json");
afterEach(() => vi.useRealTimers());

describe("Budget", () => {
  it("throws at the daily limit, persists, and resets the next UTC day", async () => {
    const f = file();
    let now = Date.parse("2026-11-26T23:00:00Z");
    const budget = new Budget(f, 2, () => now);
    await budget.take();
    await budget.take();
    await expect(budget.take()).rejects.toThrow(BudgetExhausted);
    expect(new Budget(f, 2, () => now).used()).toBe(2);
    now = Date.parse("2026-11-27T00:00:01Z");
    expect(new Budget(f, 2, () => now).used()).toBe(0);
    await expect(new Budget(f, 2, () => now).take()).resolves.toBeUndefined();
  });

  it("waits when 20 requests fall inside one minute", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-26T10:00:00Z") });
    const budget = new Budget(file(), 100);
    for (let i = 0; i < 20; i++) await budget.take();
    let done = false;
    const next = budget.take().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await next;
    expect(done).toBe(true);
  });
});
