// TypeScript owns the stages. Agents only draft and build.
import type { Agents, UI } from "./agents/types.ts";
import { pickQuestions } from "./spec/questions.ts";
import { loadDraft, loadSpec, loadState, saveDraft, saveSpec, saveState } from "./state.ts";
import type { Spec, State } from "./types.ts";

export interface Deps {
  dir: string;
  agents: Agents;
  ui: UI;
}

const RESUME = ["", "continue"];

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

  if (resume) {
    const waiting = state.stage === "approval" ? loadDraft(deps.dir) : null;
    if (waiting) return approve(deps, state, waiting);
    // A run stopped mid-draft (for example at the request limit) picks up from the saved messages.
    if (state.stage !== "spec" || state.messages.length === 0) {
      deps.ui.say(state.stage === "build" ? "Spec approved. Building comes in the next step." : "Nothing to continue.");
      return;
    }
  } else {
    state.messages.push(text);
    state.stage = "spec";
    saveState(deps.dir, state);
  }

  let spec = await draft(deps, state);
  if (!spec) return;

  const questions = pickQuestions(spec, state.messages);
  if (questions.length > 0) {
    for (const q of questions) {
      const answer = await deps.ui.ask(`${q.question}\n  (the other option: ${q.other})`, q.guess);
      state.messages.push(`Question: ${q.question}\nAnswer: ${answer}`);
      saveState(deps.dir, state);
    }
    spec = await draft(deps, state);
    if (!spec) return;
  }

  await approve(deps, state, spec);
}

/** Returns nothing when the spec agent only replied, which changes no stage. */
async function draft(deps: Deps, state: State): Promise<Spec | undefined> {
  const previous = state.specVersion > 0 ? loadSpec(deps.dir) : null;
  const turn = await deps.agents.spec({ messages: state.messages, previous });
  if (turn.spec) return turn.spec;
  if (!previous || !turn.reply) throw new Error("The spec agent returned no spec.");
  deps.ui.say(turn.reply);
  state.messages.pop(); // a question is not part of what the app should do
  state.stage = "build";
  saveState(deps.dir, state);
  return undefined;
}

async function approve(deps: Deps, state: State, first: Spec): Promise<void> {
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
      state.stage = "build";
      saveState(deps.dir, state);
      deps.ui.say("Approved and saved. Building comes in the next step.");
      return;
    }
    state.messages.push(answer);
    state.stage = "spec";
    saveState(deps.dir, state);
    spec = await draft(deps, state);
  }
}
