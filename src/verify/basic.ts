// Plain code checks, no model. The real tools are called directly so that an
// edited package.json script cannot turn a check into a no-op.
import { PUSH_SCHEMA, schemaApplied } from "../sandbox/database.ts";
import { compose, waitForWeb } from "../sandbox/docker.ts";

export type CheckResult = { ok: true; url: string } | { ok: false; step: string; output: string };

const TAIL = 4000;
const APP_STEPS = [
  ["npm", "install"],
  PUSH_SCHEMA,
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
    const failed = code !== 0 || (command === PUSH_SCHEMA && !schemaApplied(output));
    if (failed) return { ok: false, step: command.join(" "), output: output.slice(-TAIL) };
  }
  await must(["up", "-d", "--force-recreate", "web"]);
  const { url, status } = await probe();
  if (status >= 200 && status < 400) return { ok: true, url };
  const { output } = await run(["logs", "--no-color", "--tail", "60", "web"]);
  const step = status === 0 ? "preview did not answer" : `GET / returned ${status}`;
  return { ok: false, step, output: output.slice(-TAIL) };
}
