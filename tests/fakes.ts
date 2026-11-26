import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agents, SpecTurn, UI } from "../src/agents/types.ts";
import type { Result, Spec } from "../src/types.ts";
import type { CheckResult } from "../src/verify/basic.ts";

export const projectDir = () => mkdtempSync(join(tmpdir(), "pipe-"));

/** Each spec call takes the next turn; the last one repeats. */
export function fakeAgents(turns: (SpecTurn | Spec)[]) {
  const specCalls: { messages: string[]; previous: Spec | null }[] = [];
  const buildInputs: { spec: Spec; failure: string | null }[] = [];
  const agents: Agents = {
    async spec(input) {
      specCalls.push(structuredClone(input));
      const turn = turns.length > 1 ? turns.shift()! : turns[0]!;
      return "idea" in turn ? { spec: turn } : turn;
    },
    async build(input) { buildInputs.push(structuredClone(input)); },
    async writeTests() {},
    async triage() { return { testsChanged: false, notes: "" }; },
  };
  return { agents, specCalls, buildInputs, builds: () => buildInputs.length };
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

/** Each run takes the next result; the last one repeats. */
export function fakeChecks(results: CheckResult[] = [{ ok: true, url: "http://localhost:3000" }]) {
  let runs = 0;
  const checks = async () => {
    runs++;
    return results.length > 1 ? results.shift()! : results[0]!;
  };
  return { checks, runs: () => runs };
}

/** Each run takes the next result set; the last one repeats. By default everything passes. */
export function fakeTests(results: Result[][] = [[{ id: "D1", status: "pass", evidence: "" }]], missing: string[] = []) {
  let runs = 0;
  return {
    missing: () => missing,
    async run() {
      runs++;
      return results.length > 1 ? results.shift()! : results[0]!;
    },
    runs: () => runs,
  };
}
