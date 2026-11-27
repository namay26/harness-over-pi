import { defineTool } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { Budget } from "../budget.ts";
import { validateSpec } from "../spec/questions.ts";
import { SpecSchema } from "../spec/schema.ts";
import type { Spec } from "../types.ts";
import { createRoleSession, runUntilTool } from "./session.ts";
import { textResult } from "./shared.ts";
import type { Agents, SpecTurn } from "./types.ts";

const PROMPT = readFileSync(new URL("./prompts/spec.md", import.meta.url), "utf8");
const MAX_INVALID = 3;

export function createSpecAgent(o: {
  projectDir: string;
  budget: Budget;
  createSession?: typeof createRoleSession;
}): Agents["spec"] {
  return async ({ messages, previous }) => {
    let turn: SpecTurn | undefined;
    let problems: string[] = [];
    let invalid = 0;
    const submit = defineTool({
      name: "submit_spec", label: "Submit spec", description: "Submit the complete spec.",
      parameters: SpecSchema,
      async execute(_id, params) {
        const spec = params as Spec;
        problems = validateSpec(spec, previous ?? undefined);
        if (problems.length > 0) {
          // Stop a model that cannot get it right from burning the daily requests.
          if (++invalid >= MAX_INVALID) return { ...textResult("Giving up."), isError: true, terminate: true };
          throw new Error(`Fix these and submit again:\n- ${problems.join("\n- ")}`);
        }
        turn = { spec };
        return { ...textResult("Spec received."), terminate: true };
      },
    });
    // Answering is a tool call too: a model that only chats must not drop a change request.
    const reply = defineTool({
      name: "reply_only", label: "Reply only",
      description: "Answer a question or small talk. Use only if the user asked for no change at all.",
      parameters: Type.Object({ text: Type.String() }),
      async execute(_id, { text }) {
        turn = { reply: text };
        return { ...textResult("Sent."), terminate: true };
      },
    });
    const tools = previous ? [submit, reply] : [submit];

    const session = await (o.createSession ?? createRoleSession)({
      role: "spec", projectDir: o.projectDir, root: join(o.projectDir, ".builder"), systemPrompt: PROMPT,
      tools: tools.map((t) => t.name), customTools: tools, resume: true, budget: o.budget,
    });
    try {
      const prompt = [
        "Everything the user has said, oldest first:",
        ...messages.map((m, i) => `<message n="${i + 1}">\n${m}\n</message>`),
        previous ? `The approved spec so far:\n${JSON.stringify(previous, null, 2)}` : "There is no spec yet.",
      ].join("\n\n");
      const answered = () => {
        if (invalid >= MAX_INVALID) throw new Error(`The model kept sending an invalid spec: ${problems.join("; ")}`);
        return turn;
      };
      return await runUntilTool(session, prompt, answered, previous ? "submit_spec or reply_only" : "submit_spec");
    } finally {
      session.dispose();
    }
  };
}
