import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { guardExtension } from "../src/agents/session.ts";
import { Budget } from "../src/budget.ts";
import { isAllowed } from "../src/sandbox/guard.ts";

let root: string;
beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "guard-"));
  root = join(base, "app");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(base, "outside"));
  writeFileSync(join(base, ".env"), "KEY=1");
  writeFileSync(join(base, "outside", "secret"), "s");
  writeFileSync(join(root, "src", "a.ts"), "");
  symlinkSync(join(base, "outside"), join(root, "link-to-outside"));
  symlinkSync(join(base, "outside"), join(root, "dirlink"));
  symlinkSync(join(base, "outside", "not-yet"), join(root, "dangling"));
  symlinkSync(join(base, ".env"), join(root, "it’s"));
});

describe("isAllowed", () => {
  it.each([
    "../.env", "/etc/passwd", "link-to-outside/secret", "dirlink/new-file", "dangling",
    "~/x", `${homedir()}/x`, "@/etc/passwd", "@../.env", "file:///etc/passwd", "it's", "src/../../.env",
  ])("refuses %s", (p) => expect(isAllowed(p, root)).toBe(false));

  it.each(["src/a.ts", "src/new.ts", "new/dir/file.ts", ".", "@src/a.ts", "..notes"])(
    "allows %s", (p) => expect(isAllowed(p, root)).toBe(true));

  it("allows an absolute path inside", () => expect(isAllowed(join(root, "src/a.ts"), root)).toBe(true));
});

describe("guardExtension with a container folder", () => {
  function call(path: string) {
    let handler!: (event: unknown) => { block?: boolean } | undefined;
    const pi = { on: (name: string, fn: typeof handler) => { if (name === "tool_call") handler = fn; } };
    guardExtension({ root, containerRoot: "/app", budget: new Budget(join(root, "u.json"), 1), onExhausted() {} })(pi as never);
    const event = { toolName: "read", input: { path } };
    const result = handler(event);
    return { blocked: !!result?.block, path: event.input.path };
  }
  it("maps the container path of the app onto the host folder", () => {
    expect(call("/app/src/a.ts")).toEqual({ blocked: false, path: "./src/a.ts" });
    expect(call("/app")).toEqual({ blocked: false, path: "." });
  });
  it.each(["/app/../.env", "/app/link-to-outside/secret", "/apples/x", "/etc/passwd"])(
    "still refuses %s", (p) => expect(call(p).blocked).toBe(true));
});

describe("separate read and write folders", () => {
  it("limits a path to the given folders, resolved from the base", () => {
    const within = [join(root, "src")];
    expect(isAllowed("src/a.ts", root, within)).toBe(true);
    expect(isAllowed("other.ts", root, within)).toBe(false);
    expect(isAllowed("src/../other.ts", root, within)).toBe(false);
  });
});

describe("guardExtension loop protection", () => {
  it("ends the run when a refused call keeps coming", () => {
    let handler!: (event: unknown) => { block?: boolean; terminate?: boolean } | undefined;
    const pi = { on: (name: string, fn: typeof handler) => { if (name === "tool_call") handler = fn; } };
    guardExtension({ root, budget: new Budget(join(root, "u.json"), 1), onExhausted() {} })(pi as never);
    const attempt = () => handler({ toolName: "write", input: { path: "/etc/passwd" } });
    expect([attempt()?.terminate, attempt()?.terminate, attempt()?.terminate]).toEqual([false, false, true]);
  });
});
