export type { Role } from "./config.ts";
import type { Role } from "./config.ts";

export type AreaName = "users" | "visibility" | "data" | "services" | "core";

export interface Area {
  area: AreaName;
  guess: string;
  other: string;
  builtDifferently: boolean;
  settledBy: string | null;
  question: string;
}

export interface Deliverable {
  id: string;
  does: string;
  source: "said" | "asked" | "assumed";
  check: string;
}

export interface Spec {
  idea: string;
  areas: Area[];
  deliverables: Deliverable[];
  notBuilding: string[];
  constraints: string[];
  needsAccounts: boolean;
}

export type Status = "pass" | "fail" | "untested";

export interface Result {
  id: string;
  status: Status;
  evidence: string;
}

export type Stage = "spec" | "approval" | "build" | "checks" | "verify" | "done";

export interface State {
  stage: Stage;
  round: number;
  specVersion: number;
  results: Result[];
  sessions: Partial<Record<Role, string>>;
  messages: string[];
  lastFailure: string | null;
  changes: string | null;
}
