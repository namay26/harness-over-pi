import { describe, expect, it } from "vitest";
import { pickQuestions, validateSpec } from "../src/spec/questions.ts";
import type { AreaName } from "../src/types.ts";
import { area, spec } from "./helpers.ts";

describe("pickQuestions", () => {
  it("asks only unsettled areas that change the build", () => {
    const s = spec([area("users"), area("data", { builtDifferently: false }),
      area("services", { settledBy: "no emails" })]);
    expect(pickQuestions(s, ["tracker, no emails"]).map((a) => a.area)).toEqual(["users"]);
  });
  it("ignores a settledBy quote the user never typed", () => {
    const s = spec([area("users", { settledBy: "just for me" })]);
    expect(pickQuestions(s, ["habit tracker"])).toHaveLength(1);
  });
  it("ignores an empty settledBy quote", () => {
    expect(pickQuestions(spec([area("users", { settledBy: "  " })]), ["habit tracker"])).toHaveLength(1);
  });
  it("matches quotes without regard to case", () => {
    expect(pickQuestions(spec([area("users", { settledBy: "Just For Me" })]), ["just for me"])).toHaveLength(0);
  });
  it("caps at 3 in order users, visibility, data, services, core", () => {
    const names: AreaName[] = ["core", "services", "data", "visibility", "users"];
    expect(pickQuestions(spec(names.map((n) => area(n))), []).map((a) => a.area))
      .toEqual(["users", "visibility", "data"]);
  });
});

describe("validateSpec", () => {
  const all = (["users", "visibility", "data", "services", "core"] as AreaName[]).map((n) => area(n));
  const d = { id: "D1", does: "a", source: "said" as const, check: "see a" };

  it("accepts a complete spec", () => expect(validateSpec(spec(all))).toEqual([]));
  it("requires every area", () => expect(validateSpec(spec(all.slice(1))).join()).toContain("users"));
  it("rejects no deliverables", () => expect(validateSpec(spec(all, { deliverables: [] }))).not.toEqual([]));
  it("rejects duplicate ids", () => expect(validateSpec(spec(all, { deliverables: [d, d] }))).not.toEqual([]));
  it("rejects empty checks", () =>
    expect(validateSpec(spec(all, { deliverables: [{ ...d, check: " " }] }))).not.toEqual([]));
  it("rejects ids that are not D<n>", () =>
    expect(validateSpec(spec(all, { deliverables: [{ ...d, id: "x" }] }))).not.toEqual([]));
  it("rejects an id reused for a different deliverable", () => {
    const previous = spec(all, { deliverables: [d] });
    expect(validateSpec(spec(all, { deliverables: [{ ...d, does: "something else" }] }), previous)).not.toEqual([]);
  });
});
