import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dockerEnv } from "../src/sandbox/docker.ts";
import { createProject } from "../src/sandbox/project.ts";

const root = () => mkdtempSync(join(tmpdir(), "ws-"));

describe("createProject", () => {
  it("copies the template", () => {
    const p = createProject("demo", root());
    for (const f of ["app/package.json", "e2e/fixtures.ts", "compose.yaml", "db-init.sql"]) {
      expect(existsSync(join(p.dir, f)), f).toBe(true);
    }
  });
  it("keeps an existing project", () => {
    const r = root();
    const p = createProject("demo", r);
    writeFileSync(join(p.appDir, "package.json"), "edited");
    createProject("demo", r);
    expect(readFileSync(join(p.appDir, "package.json"), "utf8")).toBe("edited");
  });
  it.each(["../x", "A", "a/b", "", "x".repeat(41)])("rejects the name %j", (name) => {
    expect(() => createProject(name, root())).toThrow();
  });
  it("gives containers no key and no env file", () => {
    const compose = readFileSync(join(createProject("demo", root()).dir, "compose.yaml"), "utf8");
    expect(compose).not.toMatch(/OPENROUTER|env_file/);
  });
});

describe("dockerEnv", () => {
  it("does not hand the model key to docker", () => {
    const env = dockerEnv({ PATH: "/bin", OPENROUTER_API_KEY: "secret" });
    expect(env.PATH).toBe("/bin");
    expect(JSON.stringify(env)).not.toContain("secret");
  });
});
