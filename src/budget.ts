import { readJson, writeJson } from "./state.ts";

const PER_MINUTE = 20;
const WINDOW_MS = 60_000;

export class BudgetExhausted extends Error {
  constructor(detail = "Daily free-model request limit reached. It resets at midnight UTC.") {
    super(detail);
    this.name = "BudgetExhausted";
  }
}

interface Usage { day: string; count: number; recent: number[] }

/** Counts model requests per UTC day and spaces them to the per-minute limit. */
export class Budget {
  constructor(private file: string, readonly limit: number, private now: () => number = () => Date.now()) {}

  private read(): Usage {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const saved = readJson<Usage>(this.file);
    const recent = (saved?.recent ?? []).filter((t) => this.now() - t < WINDOW_MS);
    return { day, count: saved?.day === day ? saved.count : 0, recent };
  }

  used(): number {
    return this.read().count;
  }

  async take(): Promise<void> {
    for (;;) {
      const usage = this.read();
      if (usage.count >= this.limit) throw new BudgetExhausted();
      if (usage.recent.length < PER_MINUTE) {
        writeJson(this.file, { day: usage.day, count: usage.count + 1, recent: [...usage.recent, this.now()] });
        return;
      }
      await new Promise((r) => setTimeout(r, usage.recent[0]! + WINDOW_MS - this.now()));
    }
  }
}
