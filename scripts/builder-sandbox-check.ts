// No model requests: checks the builder's shell and that a failed database push is detected.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { containerBash } from "../src/agents/builder.ts";
import { compose } from "../src/sandbox/docker.ts";
import { createProject } from "../src/sandbox/project.ts";

const { dir, appDir } = createProject(process.argv[2] ?? "demo");
await compose(dir, ["up", "-d", "--wait", "shell"]);
const bash = containerBash(dir);
const show = async (command: string, timeout?: number) => {
  let output = "";
  try {
    const { exitCode } = await bash.exec(command, appDir, { onData: (d) => { output += d; }, timeout, env: process.env });
    console.log(`$ ${command}  -> exit ${exitCode}\n${output.trim().slice(-700)}`);
  } catch (error) {
    console.log(`$ ${command}  -> ${(error as Error).message}`);
  }
};
await show('pwd; echo "key=[$OPENROUTER_API_KEY]"');
await show("sleep 30", 2);

const schema = join(appDir, "src/db/schema.ts");
const original = readFileSync(schema, "utf8");
try {
  writeFileSync(schema, 'import { sql } from "drizzle-orm";\nimport { integer, pgTable } from "drizzle-orm/pg-core";\nexport const broken = pgTable("broken", { n: integer("n").default(sql`\'abc\'`) });\n');
  await show("npx --no-install drizzle-kit push --force");
  writeFileSync(schema, "export const x = (;\n");
  await show("npx --no-install drizzle-kit push --force");
} finally {
  writeFileSync(schema, original);
}
