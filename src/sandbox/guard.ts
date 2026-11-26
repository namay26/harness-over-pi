// The agents' file tools run on the host, so every path is checked before pi touches it.
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[  -   　]/g;

/** The same rewrites pi applies to a path before opening it. */
function asPiSees(input: string, root: string): string {
  let path = input.replace(UNICODE_SPACES, " ");
  if (path.startsWith("@")) path = path.slice(1);
  if (path === "~") path = homedir();
  else if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
  if (path.startsWith("file://")) path = fileURLToPath(path);
  return isAbsolute(path) ? resolve(path) : resolve(root, path);
}

/** pi's read tool tries these look-alike spellings when a file is missing. */
function spellings(path: string): string[] {
  const curly = (p: string) => p.replace(/'/g, "’");
  return [path, path.replace(/ (AM|PM)\./g, " $1."), path.normalize("NFD"), curly(path), curly(path.normalize("NFD"))];
}

/** Resolve every symlink, including dangling ones, for a path that may not exist yet. */
function realTarget(path: string, depth = 0): string {
  if (depth > 40) throw new Error("too many links");
  try {
    return realpathSync(path);
  } catch {
    let isLink = false;
    try {
      isLink = lstatSync(path).isSymbolicLink();
    } catch {}
    if (isLink) return realTarget(resolve(dirname(path), readlinkSync(path)), depth + 1);
    const parent = dirname(path);
    if (parent === path) return path;
    return join(realTarget(parent, depth + 1), path.slice(parent.length).replace(/^[/\\]/, ""));
  }
}

export function isAllowed(path: string, root: string): boolean {
  try {
    const realRoot = realpathSync(root);
    return spellings(asPiSees(path, root)).every((candidate) => {
      const rel = relative(realRoot, realTarget(candidate));
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    });
  } catch {
    return false;
  }
}
