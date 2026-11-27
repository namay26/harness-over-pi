import { describe, expect, it } from "vitest";
import type { RoleSessionOptions } from "../src/agents/session.ts";
import { createSpecAgent } from "../src/agents/spec.ts";
import { Budget } from "../src/budget.ts";
import type { AreaName, Spec } from "../src/types.ts";
import { projectDir } from "./fakes.ts";
import { area, spec } from "./helpers.ts";

const good = spec((["users", "visibility", "data", "services", "core"] as AreaName[]).map((n) => area(n)));

type Move = Spec | { reply: string };

/** A fake model: on each run it calls the matching real tool with the next move, or only talks. */
function agentWith(moves: Move[]) {
  const errors: string[] = [];
  const results: unknown[] = [];
  const prompts: string[] = [];
  let options!: RoleSessionOptions;
  const dir = projectDir();
  const run = createSpecAgent({
    projectDir: dir, budget: new Budget(`${dir}/usage.json`, 50),
    createSession: async (o) => {
      options = o;
      return {
        sessionFile: undefined, dispose() {}, lastText: () => "Sure, I'll add it.",
        async run(prompt) {
          prompts.push(prompt);
          const next = moves.shift();
          if (!next) return;
          const tool = o.customTools.find((t) => t.name === ("reply" in next ? "reply_only" : "submit_spec"))!;
          const args = "reply" in next ? { text: next.reply } : next;
          try {
            results.push(await tool.execute("id", args as never, undefined, undefined, {} as never));
          } catch (error) {
            errors.push((error as Error).message);
          }
        },
      };
    },
  });
  return { run, errors, results, prompts, options: () => options };
}

describe("spec agent", () => {
  it("ends the run once the spec is accepted", async () => {
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
  it("accepts a reply only through reply_only, when a spec exists", async () => {
    const a = agentWith([{ reply: "It tracks habits." }]);
    await expect(a.run({ messages: ["what is it?"], previous: good })).resolves.toEqual({ reply: "It tracks habits." });
    expect(a.options().tools).toEqual(["submit_spec", "reply_only"]);
  });
  it("never treats plain text as an answer, so a change request is not dropped", async () => {
    const a = agentWith([]);
    await expect(a.run({ messages: ["add delete"], previous: good })).rejects.toThrow("submit_spec");
    expect(a.prompts).toHaveLength(2);
  });
  it("stops at once, with the reason, after repeated invalid specs", async () => {
    const bad = { ...good, deliverables: [] };
    let attempts = 0;
    const run = createSpecAgent({
      projectDir: projectDir(), budget: new Budget(`${projectDir()}/usage.json`, 50),
      createSession: async (o) => ({
        sessionFile: undefined, dispose() {}, lastText: () => "",
        async run() {
          for (let i = 0; i < 3; i++) {
            attempts++;
            await o.customTools[0]!.execute("id", bad as never, undefined, undefined, {} as never).catch(() => {});
          }
        },
      }),
    });
    await expect(run({ messages: ["tracker"], previous: null })).rejects.toThrow("no deliverables");
    expect(attempts).toBe(3);
  });
});
