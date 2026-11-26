import type { Area, AreaName, Spec } from "../src/types.ts";

export const area = (name: AreaName, over: Partial<Area> = {}): Area => ({
  area: name, guess: `${name} guess`, other: `${name} other`,
  builtDifferently: true, settledBy: null, question: `${name}?`, ...over,
});

export const spec = (areas: Area[] = [], over: Partial<Spec> = {}): Spec => ({
  idea: "track habits", areas,
  deliverables: [{ id: "D1", does: "check off a habit", source: "assumed", check: "check, reload, still checked" }],
  notBuilding: [], constraints: [], needsAccounts: false, ...over,
});
