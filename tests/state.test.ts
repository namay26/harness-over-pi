import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSpec, loadState, saveSpec, saveState } from "../src/state.ts";
import { spec } from "./helpers.ts";

const dir = () => mkdtempSync(join(tmpdir(), "state-"));

describe("state", () => {
  it("returns a fresh state when none exists", () => {
    expect(loadState(dir())).toMatchObject({ stage: "spec", round: 0, specVersion: 0, messages: [], results: [] });
  });
  it("round-trips state and spec", () => {
    const d = dir();
    saveState(d, { ...loadState(d), stage: "build", messages: ["hi"] });
    saveSpec(d, spec());
    expect(loadState(d)).toMatchObject({ stage: "build", messages: ["hi"] });
    expect(loadSpec(d)).toEqual(spec());
  });
  it("returns null when there is no spec", () => expect(loadSpec(dir())).toBeNull());
});
