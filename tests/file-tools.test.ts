import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rootedFileTools } from "../src/agents/session.ts";

describe("rootedFileTools", () => {
  it("resolves relative paths from the given folder, not the session folder", async () => {
    const base = mkdtempSync(join(tmpdir(), "tools-"));
    const [root, session] = [join(base, "app"), join(base, ".builder")];
    mkdirSync(root);
    mkdirSync(session);
    const [write] = rootedFileTools(["write", "bash"], root);
    await write!.execute("1", { path: "spec.json", content: "x" } as never, undefined, undefined, { cwd: session } as never);
    expect(existsSync(join(root, "spec.json"))).toBe(true);
    expect(existsSync(join(session, "spec.json"))).toBe(false);
  });
});
