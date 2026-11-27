import type { Result, Spec } from "../types.ts";

export interface SpecTurn {
  spec?: Spec;
  reply?: string;
}

export interface Agents {
  spec(input: { messages: string[]; previous: Spec | null }): Promise<SpecTurn>;
  build(input: { spec: Spec; failure: string | null; changes: string | null }): Promise<void>;
  writeTests(input: { spec: Spec; ids: string[] }): Promise<void>;
  triage(input: { spec: Spec; failures: Result[] }): Promise<{ testsChanged: boolean; notes: string }>;
}

export interface UI {
  say(text: string): void;
  ask(question: string, fallback: string): Promise<string>;
  confirm(text: string): Promise<boolean>;
}
