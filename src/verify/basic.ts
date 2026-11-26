// Plain code checks, no model. The real tools are called directly so that an
// edited package.json script cannot turn a check into a no-op.
import { compose, waitForWeb } from "../sandbox/docker.ts";

export type CheckResult = { ok: true; url: string } | { ok: false; step: string; output: string };

const TAIL = 4000;
// drizzle-kit exits 0 even when the database rejects the change, so look for what success prints.
const PUSHED = /Changes applied|No changes detected/;
const APP_STEPS = [
  ["npm", "install"],
  ["npx", "--no-install", "drizzle-kit", "push", "--force"],
  ["npx", "--no-install", "tsc", "--noEmit"],
  ["npx", "--no-install", "next", "build"],
];

export async function runBasicChecks(dir: string, exec = compose, probe = waitForWeb): Promise<CheckResult> {
  const run = (args: string[]) => exec(dir, args, { timeoutMs: 900_000 });
  /** Docker itself failing is not something the builder can fix. */
  const must = async (args: string[]) => {
    const { code, output } = await run(args);
    if (code !== 0) throw new Error(`docker compose ${args.join(" ")} failed:\n${output.slice(-TAIL)}`);
  };

  await must(["up", "-d", "--wait", "db"]);
  for (const command of APP_STEPS) {
    const { code, output } = await run(["run", "--rm", "shell", ...command]);
    const failed = code !== 0 || (command.includes("drizzle-kit") && !PUSHED.test(output));
    if (failed) return { ok: false, step: command.join(" "), output: output.slice(-TAIL) };
  }
  await must(["up", "-d", "--force-recreate", "web"]);
  const { url, status } = await probe();
  if (status >= 200 && status < 400) return { ok: true, url };
  const { output } = await run(["logs", "--no-color", "--tail", "60", "web"]);
  const step = status === 0 ? "preview did not answer" : `GET / returned ${status}`;
  return { ok: false, step, output: output.slice(-TAIL) };
}
