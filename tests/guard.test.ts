import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
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
