// TypeScript owns the stages. Agents only draft and build.
import type { Agents, UI } from "./agents/types.ts";
import { pickQuestions } from "./spec/questions.ts";
import { loadDraft, loadSpec, loadState, saveDraft, saveSpec, saveState } from "./state.ts";
import type { Spec, Stage, State } from "./types.ts";
import type { CheckResult } from "./verify/basic.ts";

export interface Deps {
  dir: string;
  agents: Agents;
  ui: UI;
  checks: (dir: string) => Promise<CheckResult>;
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
    if (state.stage === "build" || state.stage === "checks") return build(deps, state);
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
    saveDraft(deps.dir, spec);
    state.stage = "approval";
    saveState(deps.dir, state);
    deps.ui.say(renderSpec(spec));

    const answer = (await deps.ui.ask("Approve? Enter to approve, type a correction, or 'no' to stop", "yes")).trim();
    if (["no", "n"].includes(answer.toLowerCase())) {
      deps.ui.say("Not approved. Type a correction when you are ready.");
      return;
    }
    if (["yes", "y", ""].includes(answer.toLowerCase())) {
      saveSpec(deps.dir, spec);
      state.specVersion++;
      Object.assign(state, { stage: "build", round: 0, lastFailure: null, results: [] });
      saveState(deps.dir, state);
      deps.ui.say("Approved and saved. Building now; this takes a few minutes.");
      return build(deps, state);
    }
    state.messages.push(answer);
    state.stage = "spec";
    saveState(deps.dir, state);
    spec = await draft(deps, state, before);
  }
}

/** Build, check, and send failures back to the builder, at most MAX_FIX_ROUNDS times. */
async function build(deps: Deps, state: State): Promise<void> {
  const spec = loadSpec(deps.dir);
  if (!spec) throw new Error("There is no approved spec to build.");
  if (state.round >= MAX_FIX_ROUNDS) state.round = 0; // the user asked to try again

  for (;;) {
    if (state.stage === "build") {
      await deps.agents.build({ spec, failure: state.lastFailure });
      state.stage = "checks";
      saveState(deps.dir, state);
    }
    deps.ui.say("Running checks: install, database, types, build, preview.");
    const result = await deps.checks(deps.dir);
    if (result.ok) {
      state.stage = "done";
      state.lastFailure = null;
      state.results = spec.deliverables.map((d) => ({ id: d.id, status: "untested", evidence: "" }));
      saveState(deps.dir, state);
      deps.ui.say([
        `The app builds and the home page loads. Preview: ${result.url}`,
        "No deliverable has been verified in a browser yet:",
        ...spec.deliverables.map((d) => `  ${d.id}. ${d.does}: untested`),
      ].join("\n"));
      return;
    }
    state.lastFailure = `${result.step} failed:\n${result.output}`;
    if (state.round >= MAX_FIX_ROUNDS) {
      saveState(deps.dir, state);
      deps.ui.say(`Still failing after ${MAX_FIX_ROUNDS} fix rounds. Type 'continue' to try again.\n\n${state.lastFailure}`);
      return;
    }
    state.round++;
    state.stage = "build";
    saveState(deps.dir, state);
    deps.ui.say(`${result.step} failed. Fix round ${state.round} of ${MAX_FIX_ROUNDS}.`);
  }
}
