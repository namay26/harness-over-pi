import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agents, SpecTurn, UI } from "../src/agents/types.ts";
import type { Spec } from "../src/types.ts";

export const projectDir = () => mkdtempSync(join(tmpdir(), "pipe-"));

/** Each spec call takes the next turn; the last one repeats. */
export function fakeAgents(turns: (SpecTurn | Spec)[]) {
  const specCalls: { messages: string[]; previous: Spec | null }[] = [];
  let builds = 0;
  const agents: Agents = {
    async spec(input) {
      specCalls.push(structuredClone(input));
      const turn = turns.length > 1 ? turns.shift()! : turns[0]!;
      return "idea" in turn ? { spec: turn } : turn;
    },
    async build() { builds++; },
    async writeTests() {},
    async triage() { return { testsChanged: false, notes: "" }; },
  };
  return { agents, specCalls, builds: () => builds };
}

/** Answers in order; once they run out, behaves like pressing Enter. */
export function fakeUI(answers: string[] = []) {
  const asked: { question: string; fallback: string }[] = [];
  const said: string[] = [];
  const ui: UI = {
    say: (text) => { said.push(text); },
    async ask(question, fallback) {
      asked.push({ question, fallback });
      return answers.shift() || fallback;
    },
    async confirm() { return true; },
  };
  return { ui, asked, said };
}
