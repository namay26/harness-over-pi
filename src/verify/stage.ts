import type { Deps } from "../pipeline.ts";
import type { Result, Spec } from "../types.ts";

/** Writes missing tests, runs them all, and lets the verifier correct a wrong test once. */
export async function verifyDeliverables(deps: Deps, spec: Spec): Promise<Result[]> {
  const ids = deps.tests.missing(deps.dir, spec);
  if (ids.length > 0) {
    deps.ui.say(`Writing browser tests for ${ids.join(", ")}.`);
    await deps.agents.writeTests({ spec, ids });
  }
  deps.ui.say("Running browser tests.");
  const results = await deps.tests.run(deps.dir, spec);
  const failures = results.filter((r) => r.status !== "pass");
  if (failures.length === 0) return results;

  const { testsChanged, notes } = await deps.agents.triage({ spec, failures });
  if (notes) deps.ui.say(`Verifier: ${notes}`);
  return testsChanged ? deps.tests.run(deps.dir, spec) : results;
}

export function renderResults(spec: Spec, results: Result[]): string {
  return spec.deliverables.map((d) => {
    const result = results.find((r) => r.id === d.id);
    const line = `  ${d.id}. ${d.does}: ${result?.status ?? "untested"}`;
    return result?.evidence ? `${line}\n      ${result.evidence.split("\n")[0]!.slice(0, 200)}` : line;
  }).join("\n");
}
