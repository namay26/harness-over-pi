import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Spec, State } from "./types.ts";

export function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

/** Write through a temp file so an interrupted run never leaves half a file. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${file}.tmp`, file);
}

const stateFile = (dir: string) => join(dir, ".builder", "state.json");
const specFile = (dir: string) => join(dir, ".builder", "spec.json");
const draftFile = (dir: string) => join(dir, ".builder", "draft.json");

export function loadState(dir: string): State {
  return readJson<State>(stateFile(dir)) ?? {
    stage: "spec", round: 0, specVersion: 0, results: [], sessions: {}, messages: [], lastFailure: null,
  };
}

export const saveState = (dir: string, state: State) => writeJson(stateFile(dir), state);
export const loadSpec = (dir: string) => readJson<Spec>(specFile(dir));
export const saveSpec = (dir: string, spec: Spec) => writeJson(specFile(dir), spec);
/** A draft waiting for approval. spec.json only ever holds what the user approved. */
export const loadDraft = (dir: string) => readJson<Spec>(draftFile(dir));
export const saveDraft = (dir: string, spec: Spec) => writeJson(draftFile(dir), spec);
