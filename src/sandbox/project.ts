import { cpSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = fileURLToPath(new URL("../../template", import.meta.url));
const HARNESS_OWNED = ["e2e/package.json", "e2e/playwright.config.ts", "e2e/fixtures.ts", "e2e/snapshot.mjs"];

export interface Project {
  dir: string;
  appDir: string;
  e2eDir: string;
}

export function createProject(name: string, root = "workspaces"): Project {
  if (!/^[a-z0-9-]{1,40}$/.test(name)) {
    throw new Error(`Project name must be lowercase letters, digits or "-", up to 40 characters: ${name}`);
  }
  const dir = resolve(root, name);
  if (!existsSync(join(dir, "compose.yaml"))) {
    cpSync(TEMPLATE, dir, { recursive: true, filter: (src) => !["node_modules", ".next"].includes(basename(src)) });
  }
  for (const file of HARNESS_OWNED) cpSync(join(TEMPLATE, file), join(dir, file));
  return { dir, appDir: join(dir, "app"), e2eDir: join(dir, "e2e") };
}
