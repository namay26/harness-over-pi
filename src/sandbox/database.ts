// drizzle-kit exits 0 even when the database rejects the change, so look for what success prints.
export const PUSH_SCHEMA = ["npx", "--no-install", "drizzle-kit", "push", "--force"];
export const schemaApplied = (output: string) => /Changes applied|No changes detected/.test(output);
