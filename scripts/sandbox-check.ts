// Real end-to-end check of the sandbox for a project.
import { compose, restartWeb, startDb } from "../src/sandbox/docker.ts";
import { createProject } from "../src/sandbox/project.ts";

const { dir } = createProject(process.argv[2] ?? "demo");
async function step(args: string[]) {
  const { code, output } = await compose(dir, args, { timeoutMs: 900_000 });
  console.log(code === 0 ? "ok  " : "FAIL", args.join(" "));
  if (code !== 0) { console.log(output.slice(-3000)); process.exit(1); }
}
await startDb(dir);
console.log("ok   db");
for (const cmd of [["npm", "install"], ["npx", "--no-install", "drizzle-kit", "push", "--force"],
  ["npx", "--no-install", "tsc", "--noEmit"], ["npx", "--no-install", "next", "build"]]) {
  await step(["run", "--rm", "shell", ...cmd]);
}
const url = await restartWeb(dir);
console.log("preview", url, (await fetch(url)).status);
await step(["run", "--rm", "e2e", "npm", "install"]);
