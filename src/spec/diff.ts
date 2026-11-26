import type { Deliverable, Spec } from "../types.ts";

export interface SpecDiff {
  added: Deliverable[];
  changed: Deliverable[];
  removed: Deliverable[];
}

/** Compares deliverables by id; ids are stable across follow-ups. */
export function diffSpec(previous: Spec, next: Spec): SpecDiff {
  const find = (spec: Spec, id: string) => spec.deliverables.find((d) => d.id === id);
  return {
    added: next.deliverables.filter((d) => !find(previous, d.id)),
    changed: next.deliverables.filter((d) => {
      const old = find(previous, d.id);
      return old && (old.does !== d.does || old.check !== d.check);
    }),
    removed: previous.deliverables.filter((d) => !find(next, d.id)),
  };
}

export function renderChanges(diff: SpecDiff): string {
  const lines = (["added", "changed", "removed"] as const)
    .flatMap((kind) => diff[kind].map((d) => `  ${kind} ${d.id}: ${d.does}`));
  return lines.join("\n") || "  no change to the deliverables";
}
