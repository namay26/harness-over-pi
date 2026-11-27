import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Every file under a folder, sorted; empty if the folder does not exist. */
export function listFiles(dir: string, skip: string[] = []): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !relative(dir, file).split(sep).some((part) => skip.includes(part)))
    .sort();
}

/** Fingerprint of a folder's file names and contents, used to detect whether an agent changed it. */
export function hashFolder(dir: string, skip: string[] = []): string {
  const hash = createHash("sha256");
  for (const file of listFiles(dir, skip)) hash.update(relative(dir, file)).update(readFileSync(file));
  return hash.digest("hex");
}
