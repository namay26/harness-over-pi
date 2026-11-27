import { compose } from "./docker.ts";
import { PUSH_SCHEMA, schemaApplied } from "./database.ts";

export const TEST_DB = "app_test";
export const TEST_SERVICE = "web-test";

/** Gives browser tests an empty database and their own server, leaving the preview's data alone. */
export async function resetTestApp(dir: string, exec = compose): Promise<void> {
  const run = async (args: string[], ok = (_output: string) => true) => {
    const { code, output } = await exec(dir, args, { timeoutMs: 600_000 });
    if (code !== 0 || !ok(output)) throw new Error(`Could not prepare the test app:\n${output.slice(-2000)}`);
  };
  const psql = (database: string, ...statements: string[]) => run(["exec", "-T", "db",
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "app", "-d", database, ...statements.flatMap((s) => ["-c", s])]);

  await run(["up", "-d", "--wait", "db"]);
  await psql("app", `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`, `CREATE DATABASE ${TEST_DB}`);
  await psql(TEST_DB, "GRANT USAGE ON SCHEMA public TO reader",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reader");
  await run(["run", "--rm", "-T", "-e", `DATABASE_URL=postgres://app:app@db:5432/${TEST_DB}`, "shell", ...PUSH_SCHEMA],
    schemaApplied);
  await run(["up", "-d", "--wait", "--force-recreate", TEST_SERVICE]);
}

const EMPTY_TABLES = `DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
  END LOOP;
END $$`;

export async function emptyTestTables(dir: string, exec = compose): Promise<void> {
  const { code, output } = await exec(dir,
    ["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "app", "-d", TEST_DB, "-c", EMPTY_TABLES]);
  if (code !== 0) throw new Error(`Could not empty the test database:\n${output.slice(-2000)}`);
}
