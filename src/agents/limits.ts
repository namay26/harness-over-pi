const REPEAT_LIMIT = 3;

/** Stops one agent step from spending the day's requests on a loop. */
export class RunLimits {
  private requests = 0;
  private refusals = 0;
  private seen = new Map<string, number>();

  constructor(private maxRequests: number) {}

  reset(): void {
    this.requests = 0;
    this.refusals = 0;
    this.seen.clear();
  }

  takeRequest(): boolean {
    return ++this.requests <= this.maxRequests;
  }

  isLoop(tool: string, input: unknown, refused: boolean): boolean {
    const key = `${tool} ${JSON.stringify(input)}`;
    const times = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, times);
    if (refused) this.refusals++;
    return times >= REPEAT_LIMIT || this.refusals >= REPEAT_LIMIT;
  }
}
