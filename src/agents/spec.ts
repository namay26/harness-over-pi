import { defineTool } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Budget } from "../budget.ts";
import { validateSpec } from "../spec/questions.ts";
import { SpecSchema } from "../spec/schema.ts";
import type { Spec } from "../types.ts";
import { createRoleSession, runUntilTool } from "./session.ts";
import type { Agents } from "./types.ts";

const PROMPT = readFileSync(new URL("./prompts/spec.md", import.meta.url), "utf8");
const MAX_INVALID = 3;

export function createSpecAgent(o: {
  projectDir: string;
  budget: Budget;
  createSession?: typeof createRoleSession;
}): Agents["spec"] {
  return async ({ messages, previous }) => {
    let captured: Spec | undefined;
    let invalid = 0;
    const submit = defineTool({
      name: "submit_spec", label: "Submit spec", description: "Submit the complete spec.",
      parameters: SpecSchema,
      async execute(_id, params) {
        const spec = params as Spec;
        const problems = validateSpec(spec, previous ?? undefined);
        if (problems.length > 0) {
          // Stop a model that cannot get it right from burning the daily requests.
          if (++invalid >= MAX_INVALID) {
            return { content: [{ type: "text", text: "Giving up." }], details: {}, isError: true, terminate: true };
          }
          throw new Error(`Fix these and submit again:\n- ${problems.join("\n- ")}`);
        }
        captured = spec;
        return { content: [{ type: "text", text: "Spec received." }], details: {}, terminate: true };
      },
    });

    const session = await (o.createSession ?? createRoleSession)({
      role: "spec", projectDir: o.projectDir, root: join(o.projectDir, ".builder"), systemPrompt: PROMPT,
      tools: ["submit_spec"], customTools: [submit], resume: true, budget: o.budget,
    });
    try {
      const prompt = [
        "Everything the user has said, oldest first:",
        ...messages.map((m, i) => `<message n="${i + 1}">\n${m}\n</message>`),
        previous ? `The approved spec so far:\n${JSON.stringify(previous, null, 2)}` : "There is no spec yet.",
      ].join("\n\n");

      if (previous) {
        await session.run(prompt);
        const reply = session.lastText();
        if (!captured && !invalid && reply) return { reply };
        if (captured) return { spec: captured };
      }
      const spec = await runUntilTool(
        session, previous ? "Submit the updated spec." : prompt, () => captured, "submit_spec");
      return { spec };
    } finally {
      session.dispose();
    }
  };
}
