import type { Area, Spec } from "../types.ts";
import { AREA_NAMES } from "./schema.ts";

const MAX_QUESTIONS = 3;

/** An area is settled only if the quoted words really appear in what the user typed. */
function isSettled(area: Area, userMessages: string[]): boolean {
  const quote = area.settledBy?.trim().toLowerCase();
  return !!quote && userMessages.some((m) => m.toLowerCase().includes(quote));
}

export function pickQuestions(spec: Spec, userMessages: string[]): Area[] {
  return AREA_NAMES.flatMap((name) => spec.areas.find((a) => a.area === name) ?? [])
    .filter((a) => a.builtDifferently && !isSettled(a, userMessages))
    .slice(0, MAX_QUESTIONS);
}

export function validateSpec(spec: Spec, previous?: Spec): string[] {
  const problems: string[] = [];
  for (const name of AREA_NAMES) {
    if (!spec.areas.some((a) => a.area === name)) problems.push(`missing area: ${name}`);
  }
  if (spec.deliverables.length === 0) problems.push("no deliverables");
  const seen = new Set<string>();
  for (const d of spec.deliverables) {
    if (!/^D[1-9]\d*$/.test(d.id)) problems.push(`id must look like D1: ${d.id}`);
    if (seen.has(d.id)) problems.push(`duplicate id: ${d.id}`);
    seen.add(d.id);
    if (!d.does.trim()) problems.push(`${d.id}: empty description`);
    if (!d.check.trim()) problems.push(`${d.id}: empty check`);
    const old = previous?.deliverables.find((p) => p.id === d.id);
    if (old && old.does !== d.does) problems.push(`${d.id} was "${old.does}"; give a different deliverable a new id`);
  }
  return problems;
}
