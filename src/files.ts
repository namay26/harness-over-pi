import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Every file under a folder, sorted; empty if the folder does not exist. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** Fingerprint of a folder's file names and contents, used to detect whether an agent changed it. */
export function hashFolder(dir: string): string {
  const hash = createHash("sha256");
  for (const file of listFiles(dir)) hash.update(relative(dir, file)).update(readFileSync(file));
  return hash.digest("hex");
}
