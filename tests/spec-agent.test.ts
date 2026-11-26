import { describe, expect, it } from "vitest";
import type { RoleSessionOptions } from "../src/agents/session.ts";
import { createSpecAgent } from "../src/agents/spec.ts";
import { Budget } from "../src/budget.ts";
import type { AreaName, Spec } from "../src/types.ts";
import { projectDir } from "./fakes.ts";
import { area, spec } from "./helpers.ts";

const good = spec((["users", "visibility", "data", "services", "core"] as AreaName[]).map((n) => area(n)));

/** A fake model: on each run it submits the next spec through the real tool, or just talks. */
function agentWith(submissions: Spec[]) {
  const errors: string[] = [];
  const results: unknown[] = [];
  let options!: RoleSessionOptions;
  const dir = projectDir();
  const run = createSpecAgent({
    projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
    createSession: async (o) => {
      options = o;
      return {
        sessionFile: undefined, dispose() {}, lastText: () => "just talking",
        async run() {
          const next = submissions.shift();
          if (!next) return;
          try {
            results.push(await o.customTools[0]!.execute("id", next as never, undefined, undefined, {} as never));
          } catch (error) {
            errors.push((error as Error).message);
          }
        },
      };
    },
  });
  return { run, errors, results, options: () => options };
}

describe("spec agent", () => {
  it("has only the submit tool, and ends the run once the spec is accepted", async () => {
    const a = agentWith([good]);
    await expect(a.run({ messages: ["tracker"], previous: null })).resolves.toEqual({ spec: good });
    expect(a.options().tools).toEqual(["submit_spec"]);
    expect(a.results[0]).toMatchObject({ terminate: true });
  });
  it("returns problems to the model as a tool error", async () => {
    const a = agentWith([{ ...good, deliverables: [] }, good]);
    await expect(a.run({ messages: ["tracker"], previous: null })).resolves.toEqual({ spec: good });
    expect(a.errors[0]).toContain("no deliverables");
  });
  it("allows a plain reply only when a spec already exists", async () => {
    await expect(agentWith([]).run({ messages: ["hi?"], previous: good })).resolves.toEqual({ reply: "just talking" });
    await expect(agentWith([]).run({ messages: ["tracker"], previous: null })).rejects.toThrow("submit_spec");
  });
});
