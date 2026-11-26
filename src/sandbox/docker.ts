import { spawn } from "node:child_process";
import { basename } from "node:path";

const PASSED_THROUGH = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "WEB_PORT"];

/** Only what docker needs. The model key must never reach docker or a container. */
export function dockerEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOST_UID: String(process.getuid?.() ?? 1000),
    HOST_GID: String(process.getgid?.() ?? 1000),
  };
  for (const key of PASSED_THROUGH) if (source[key]) env[key] = source[key];
  return env;
}

export interface ComposeOptions {
  onData?: (data: Buffer) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function compose(dir: string, args: string[], opts: ComposeOptions = {}): Promise<{ code: number; output: string }> {
  return new Promise((done, fail) => {
    const child = spawn("docker", ["compose", "-p", `builder-${basename(dir)}`, ...args], {
      cwd: dir, env: dockerEnv(), signal: opts.signal, timeout: opts.timeoutMs, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (data: Buffer) => {
      output = (output + data.toString()).slice(-200_000);
      opts.onData?.(data);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

async function must(dir: string, args: string[]): Promise<string> {
  const { code, output } = await compose(dir, args, { timeoutMs: 600_000 });
  if (code !== 0) throw new Error(`docker compose ${args.join(" ")} failed:\n${output.slice(-2000)}`);
  return output;
}

export async function startDb(dir: string): Promise<void> {
  await must(dir, ["up", "-d", "--wait", "db"]);
}

/** Restart the preview server and wait until it answers. */
export async function restartWeb(dir: string): Promise<string> {
  await must(dir, ["up", "-d", "--force-recreate", "web"]);
  const url = `http://localhost:${process.env.WEB_PORT ?? 3000}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(5000) });
      return url;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Preview did not answer at ${url}:\n${await logs(dir, "web", 40)}`);
}

export async function logs(dir: string, service: string, lines: number): Promise<string> {
  return must(dir, ["logs", "--no-color", "--tail", String(lines), service]);
}
