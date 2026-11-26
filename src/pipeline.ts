// TypeScript owns the stages. Agents only draft and build.
import type { Agents, UI } from "./agents/types.ts";
import { diffSpec, renderChanges, type SpecDiff } from "./spec/diff.ts";
import { pickQuestions } from "./spec/questions.ts";
import { loadDraft, loadSpec, loadState, saveDraft, saveSpec, saveState } from "./state.ts";
import type { Result, Spec, Stage, State } from "./types.ts";
import type { CheckResult } from "./verify/basic.ts";
import { renderResults, verifyDeliverables } from "./verify/stage.ts";

export interface Deps {
  dir: string;
  agents: Agents;
  ui: UI;
  checks: (dir: string) => Promise<CheckResult>;
  tests: {
    missing(dir: string, spec: Spec): string[];
    remove(dir: string, ids: string[]): void;
    run(dir: string, spec: Spec): Promise<Result[]>;
  };
}

const RESUME = ["", "continue"];
const MAX_FIX_ROUNDS = 3;

export function renderSpec(spec: Spec): string {
  return [
    `Idea: ${spec.idea}`,
    "",
    "Deliverables:",
    ...spec.deliverables.flatMap((d) => [
      `  ${d.id}. ${d.does}${d.source === "assumed" ? " (assumed)" : ""}`,
      `      check: ${d.check}`,
    ]),
    "",
    "How I read it:",
    ...spec.areas.map((a) => `  ${a.area}: ${a.guess}`),
    "",
    `Not building: ${spec.notBuilding.join(", ") || "nothing listed"}`,
    ...(spec.constraints.length ? [`Constraints: ${spec.constraints.join(", ")}`] : []),
  ].join("\n");
}

export async function handleMessage(deps: Deps, message: string): Promise<void> {
  const state = loadState(deps.dir);
  const text = message.trim();
  const resume = RESUME.includes(text.toLowerCase());

  const before = state.stage;
  if (resume) {
    const waiting = state.stage === "approval" ? loadDraft(deps.dir) : null;
    if (waiting) return approve(deps, state, waiting);
    if (["build", "checks", "verify"].includes(state.stage)) return build(deps, state);
    // A run stopped mid-draft (for example at the request limit) picks up from the saved messages.
    if (state.stage !== "spec" || state.messages.length === 0) {
      deps.ui.say("Nothing to continue.");
      return;
    }
  } else {
    state.messages.push(text);
    state.stage = "spec";
    saveState(deps.dir, state);
  }

  let spec = await draft(deps, state, before);
  if (!spec) return;

  const questions = pickQuestions(spec, state.messages);
  if (questions.length > 0) {
    for (const q of questions) {
      const answer = await deps.ui.ask(`${q.question}\n  (the other option: ${q.other})`, q.guess);
      state.messages.push(`Question: ${q.question}\nAnswer: ${answer}`);
      saveState(deps.dir, state);
    }
    spec = await draft(deps, state, before);
    if (!spec) return;
  }

  await approve(deps, state, spec, before);
}

/** Returns nothing when the spec agent only replied, which changes no stage. */
async function draft(deps: Deps, state: State, before: Stage): Promise<Spec | undefined> {
  const previous = state.specVersion > 0 ? loadSpec(deps.dir) : null;
  const turn = await deps.agents.spec({ messages: state.messages, previous });
  if (turn.spec) return turn.spec;
  if (!previous || !turn.reply) throw new Error("The spec agent returned no spec.");
  deps.ui.say(turn.reply);
  state.messages.pop(); // a question is not part of what the app should do
  state.stage = before === "spec" ? "done" : before;
  saveState(deps.dir, state);
  return undefined;
}

async function approve(deps: Deps, state: State, first: Spec, before: Stage = state.stage): Promise<void> {
  let spec: Spec | undefined = first;
  while (spec) {
    const previous = state.specVersion > 0 ? loadSpec(deps.dir) : null;
    const diff = previous ? diffSpec(previous, spec) : null;
    saveDraft(deps.dir, spec);
    state.stage = "approval";
    saveState(deps.dir, state);
    deps.ui.say(renderSpec(spec));
    if (diff) deps.ui.say(`Changes:\n${renderChanges(diff)}`);

    const answer = (await deps.ui.ask("Approve? Enter to approve, type a correction, or 'no' to stop", "yes")).trim();
    if (["no", "n"].includes(answer.toLowerCase())) {
      deps.ui.say("Not approved. Type a correction when you are ready.");
      return;
    }
    if (["yes", "y", ""].includes(answer.toLowerCase())) {
      accept(deps, state, spec, diff);
      deps.ui.say("Approved and saved. Building now; this takes a few minutes.");
      return build(deps, state);
    }
    state.messages.push(answer);
    state.stage = "spec";
    saveState(deps.dir, state);
    spec = await draft(deps, state, before);
  }
}

function accept(deps: Deps, state: State, spec: Spec, diff: SpecDiff | null): void {
  saveSpec(deps.dir, spec);
  if (diff) deps.tests.remove(deps.dir, [...diff.changed, ...diff.removed].map((d) => d.id));
  state.specVersion++;
  Object.assign(state, { round: 0, lastFailure: null, results: [], changes: diff ? renderChanges(diff) : null });
  enter(deps, state, "build");
}

/** Build, check and verify, sending failures back to the builder at most MAX_FIX_ROUNDS times. */
async function build(deps: Deps, state: State): Promise<void> {
  const spec = loadSpec(deps.dir);
  if (!spec) throw new Error("There is no approved spec to build.");
  if (state.round >= MAX_FIX_ROUNDS) state.round = 0; // the user asked to try again

  for (;;) {
    if (state.stage === "build") {
      await deps.agents.build({ spec, failure: state.lastFailure, changes: state.changes ?? null });
      enter(deps, state, "checks");
    }
    const failure = await judge(deps, state, spec);
    if (failure === null) return;
    state.lastFailure = failure;
    if (state.round >= MAX_FIX_ROUNDS) {
      saveState(deps.dir, state);
      deps.ui.say(`Still failing after ${MAX_FIX_ROUNDS} fix rounds. Type 'continue' to try again.\n\n${failure}`);
      if (state.results.length) deps.ui.say(renderResults(spec, state.results));
      return;
    }
    state.round++;
    enter(deps, state, "build");
    deps.ui.say(`Fix round ${state.round} of ${MAX_FIX_ROUNDS}.`);
  }
}

function enter(deps: Deps, state: State, stage: Stage): void {
  state.stage = stage;
  saveState(deps.dir, state);
}

/** Returns what the builder must fix, or null when there is nothing more for it to do. */
async function judge(deps: Deps, state: State, spec: Spec): Promise<string | null> {
  state.results = [];
  deps.ui.say("Running checks: install, database, types, build, preview.");
  const checked = await deps.checks(deps.dir);
  if (!checked.ok) {
    enter(deps, state, "checks");
    deps.ui.say(`${checked.step} failed.`);
    return `${checked.step} failed:\n${checked.output}`;
  }

  enter(deps, state, "verify");
  state.results = await verifyDeliverables(deps, spec);
  const failed = state.results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    saveState(deps.dir, state);
    return `Browser tests failed:\n${failed.map((r) => `${r.id}: ${r.evidence}`).join("\n\n")}`;
  }

  const passed = state.results.every((r) => r.status === "pass");
  if (passed) Object.assign(state, { lastFailure: null, changes: null });
  enter(deps, state, passed ? "done" : "verify");
  const headline = passed
    ? "Done. Every deliverable passed in a browser."
    : "Not finished: some deliverables could not be tested. Type 'continue' to try again.";
  deps.ui.say(`${headline}\n${renderResults(spec, state.results)}\nPreview: ${checked.url}`);
  return null;
}
