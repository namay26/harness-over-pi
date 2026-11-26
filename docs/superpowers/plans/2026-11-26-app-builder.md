# App Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terminal chat that turns a request into an agreed deliverables list, builds a Next.js + Postgres app, previews it locally and verifies each deliverable.

**Architecture:** A TypeScript pipeline owns stages, state and pass/fail. It drives three pi sessions (spec, builder, verifier) through one `Agents` interface, so the pipeline is tested with fakes. Generated code only ever runs inside Docker; pi runs on the host with guarded tools.

**Tech Stack:** Node 24, TypeScript (ESM), `@earendil-works/pi-coding-agent` 1.5.0, TypeBox (`typebox`), Vitest, tsx, Docker Compose, Postgres 16, Next.js 16 App Router, Tailwind, Drizzle, Playwright 1.65.1.

**Spec:** `docs/superpowers/specs/2026-11-26-app-builder-design.md`

## Global Constraints

- Free OpenRouter models only: primary `nvidia/nemotron-3-ultra-550b-a55b:free`, fallback `google/gemma-4-31b-it:free`.
- Limits: 20 requests per minute, 50 per day (UTC day). `DAILY_REQUEST_LIMIT` overrides 50.
- `OPENROUTER_API_KEY` is read from `.env`. It is never printed, committed, or passed to a container.
- At most 3 questions, each with a default. At most 3 fix rounds.
- Local only. No deploy.
- Neither the builder nor the verifier can change `spec.json`. Only TypeScript records results.
- pi global extensions, skills, context files, settings and auth are not loaded.
- Exploratory pass is off by default.
- Unit tests make no model requests.

## Review Focus

1. A symlink or `..` path inside `app/` pointing at `.env`: file tools must refuse it (Task 4).
2. Daily limit hit mid-build: stop cleanly, state saved, next start resumes the same stage (Tasks 4, 6).
3. Model ends its turn without calling the required tool: one reminder, then a clear error, never a silent success (Task 4).
4. Builder rewrites `package.json` scripts to `true`: checks must still run the real tools (Task 6).
5. Tests rerun on a database that already has data: they still pass (Task 7).

## Layout

```
config/models.json        free model registration
src/types.ts state.ts     shared types, persistence
src/spec/                 submit_spec schema, question rule
src/budget.ts             request counting and throttling
src/sandbox/              path guard, docker, project creation
src/agents/               session factory, spec, builder, verifier, prompts/
src/verify/               basic checks, test runner
src/pipeline.ts cli.ts    stages, terminal UI
template/                 app/, e2e/, compose.yaml
tests/                    vitest
workspaces/<name>/        app/ (builder), e2e/ (verifier), compose.yaml, .builder/ (harness)
```

---

### Task 1: Scaffold and prove the model works

This is a gate. If neither model calls tools reliably, stop and tell the user.

**Files:** Create `package.json`, `tsconfig.json`, `.gitignore`, `config/models.json`, `src/config.ts`, `scripts/smoke.ts`

**Interfaces — Produces:**
- `type Role = "spec" | "builder" | "verifier"`
- `config.models: Record<Role, string>`, `config.fallbackModel: string`, each overridable by `MODEL_SPEC`, `MODEL_BUILDER`, `MODEL_VERIFIER`

- [ ] **Step 1:** `git init`. `.gitignore`: `.env`, `node_modules/`, `workspaces/`, `.pi-home/`. Run `git status --porcelain` and confirm `.env` is absent.
- [ ] **Step 2:** `npm init`, set `"type": "module"`, install `@earendil-works/pi-coding-agent@1.5.0 typebox` and dev `typescript tsx vitest @types/node`. Scripts: `test` = `vitest run`, `typecheck` = `tsc --noEmit`, `start` = `node --env-file=.env --import tsx src/cli.ts`.
- [ ] **Step 3:** `config/models.json`: provider `openrouter`, `apiKey: "$OPENROUTER_API_KEY"`, both model ids under `models` with `reasoning: true`, zero `cost`, `contextWindow` 1000000 and 262144.
- [ ] **Step 4:** `scripts/smoke.ts`: build `ModelRuntime.create({ modelsPath: "config/models.json", authPath: ".pi-home/auth.json" })`, get the model with `getModel("openrouter", id)`, create a session with `SessionManager.inMemory()`, `noTools: "builtin"` and one `defineTool` named `report_number({ n: number })`. Prompt "Call report_number with 7 times 6." Print PASS only if the tool received 42. Count `before_provider_request` events from an inline extension and print the count.
- [ ] **Step 5:** Run `node --env-file=.env --import tsx scripts/smoke.ts` for both models. Expected: `PASS`, request count 1 or 2. This confirms the hook, `defineTool` and the model setup; check `SettingsManager.inMemory()` exists in the type definitions for Task 4.
- [ ] **Step 6:** Put the better model in `config.ts`. Commit: `chore: scaffold and model smoke test`.

### Task 2: Types, state and the question rule

**Files:** Create `src/types.ts`, `src/state.ts`, `src/spec/schema.ts`, `src/spec/questions.ts`; test `tests/questions.test.ts`, `tests/state.test.ts`

**Interfaces — Produces:**

```ts
type AreaName = "users" | "visibility" | "data" | "services" | "core";
interface Area { area: AreaName; guess: string; other: string;
  builtDifferently: boolean; settledBy: string | null; question: string }
interface Deliverable { id: string; does: string; source: "said"|"asked"|"assumed"; check: string }
interface Spec { idea: string; areas: Area[]; deliverables: Deliverable[];
  notBuilding: string[]; constraints: string[]; needsAccounts: boolean }
type Status = "pass" | "fail" | "untested";
interface Result { id: string; status: Status; evidence: string }
type Stage = "spec" | "approval" | "build" | "checks" | "verify" | "done";
interface State { stage: Stage; round: number; specVersion: number; results: Result[];
  sessions: Partial<Record<Role, string>>; messages: string[]; lastFailure: string | null }
```
- `SpecSchema` (TypeBox mirror of `Spec`)
- `pickQuestions(spec: Spec, userMessages: string[]): Area[]`
- `validateSpec(spec: Spec, previous?: Spec): string[]` (list of problems)
- `loadState(dir): State`, `saveState(dir, state)`, `loadSpec(dir): Spec | null`, `saveSpec(dir, spec)`, all under `<dir>/.builder/`

- [ ] **Step 1:** Write failing tests:

```ts
// area(name, over) returns an Area with builtDifferently: true, settledBy: null
it("asks only unsettled areas that change the build", () => {
  const s = spec([area("users"), area("data", { builtDifferently: false }),
                  area("services", { settledBy: "no emails" })]);
  expect(pickQuestions(s, ["tracker, no emails"]).map(a => a.area)).toEqual(["users"]);
});
it("ignores a settledBy quote the user never typed", () => {
  const s = spec([area("users", { settledBy: "just for me" })]);
  expect(pickQuestions(s, ["habit tracker"])).toHaveLength(1);
});
it("caps at 3 in order users, visibility, data, services, core", () => {
  const s = spec(["core","services","data","visibility","users"].map(n => area(n)));
  expect(pickQuestions(s, []).map(a => a.area)).toEqual(["users","visibility","data"]);
});
it("rejects duplicate ids, empty checks, no deliverables, and reused ids", () => { /* one expect each:
  validateSpec(...).length > 0; "reused" = same id as previous with a different `does` */ });
it("round-trips state and returns a fresh state when none exists", () => { /* stage "spec", round 0 */ });
```
- [ ] **Step 2:** `npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement. Quote match is case-insensitive substring. Writes go to a temp file then rename.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS. Commit: `feat: spec types, state and question rule`.

### Task 3: Template and sandbox preview

**Files:** Create `template/app/` (Next.js starter with Tailwind, Drizzle `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`), `template/e2e/` (`package.json`, `playwright.config.ts`, `fixtures.ts`, `tests/`), `template/compose.yaml`, `template/db-init.sql`, `src/sandbox/project.ts`, `src/sandbox/docker.ts`; test `tests/project.test.ts`

**Interfaces — Produces:**
- `createProject(name: string, root?: string): { dir, appDir, e2eDir }` (keeps an existing project)
- `compose(dir, args: string[], opts?: { onData?, signal?, timeoutMs? }): Promise<{ code: number; output: string }>`
- `startDb(dir)`, `restartWeb(dir): Promise<string /* preview URL */>`, `logs(dir, service, lines): Promise<string>`

Compose services: `db` (`postgres:16`, healthcheck, init script creating role `reader` with SELECT only), `shell` (`node:24`, `sleep infinity`, mounts `./app:/app`), `web` (same image and mount, `npx next start -H 0.0.0.0`, published on `127.0.0.1` only), `e2e` (`mcr.microsoft.com/playwright:v1.65.1-noble`, mounts `./e2e`, profile `e2e`, `BASE_URL=http://web:3000`). `shell`, `web` and `e2e` run as the host uid:gid with `HOME=/tmp`. No service gets the repo root or `.env`. No auth library in the template; the builder adds Better Auth when `needsAccounts` is true.

- [ ] **Step 1:** Failing tests: `createProject` produces `app/package.json`, `e2e/fixtures.ts`, `compose.yaml`; a second call keeps an edited file; names outside `^[a-z0-9-]{1,40}$` throw; the compose file contains neither `OPENROUTER` nor `env_file`.
- [ ] **Step 2:** Run → FAIL. Implement template and both modules.
- [ ] **Step 3:** `npm test` → PASS.
- [ ] **Step 4:** Real run (also pre-pulls the large Playwright image, so start it early): create `workspaces/demo`, then in order `docker compose run --rm shell npm install`, `npx drizzle-kit push --force`, `npx tsc --noEmit`, `npx next build`, `up -d web`, and `curl -sf` the preview URL. Expected: HTTP 200. `docker compose run --rm e2e npm install` exits 0.
- [ ] **Step 5:** Commit: `feat: app template and docker sandbox`.

### Task 4: Guard, budget and session factory

**Files:** Create `src/sandbox/guard.ts`, `src/budget.ts`, `src/agents/session.ts`; test `tests/guard.test.ts`, `tests/budget.test.ts`, `tests/session.test.ts`

**Interfaces — Produces:**
- `isAllowed(path: string, root: string): boolean` — resolves against `root`, follows symlinks (for a new file, of the nearest existing parent)
- `class Budget { constructor(file: string, limit: number, now?: () => number); take(): Promise<void>; used(): number }`, `class BudgetExhausted extends Error`
- `createRoleSession(o: { role: Role; projectDir: string; root: string; systemPrompt: string; tools: string[]; customTools: ToolDefinition[]; resume: boolean; budget: Budget }): Promise<RoleSession>`
- `interface RoleSession { run(prompt: string): Promise<void>; sessionFile: string | undefined; dispose(): void }`
- `runUntilTool<T>(session: Pick<RoleSession,"run">, prompt: string, captured: () => T | undefined, toolName: string): Promise<T>`

- [ ] **Step 1:** Failing tests:

```ts
it.each(["../.env", "/etc/passwd", "link-to-outside/secret", "dirlink/new-file"])
  ("refuses %s", p => expect(isAllowed(p, root)).toBe(false));   // links made in a tmp dir
it("allows new and existing files inside", () => expect(isAllowed("src/a.ts", root)).toBe(true));
it("throws at the daily limit, persists across instances, resets next UTC day", async () => {});
it("waits when 20 requests fall inside one minute", async () => {});   // fake timers
it("reminds once then throws if the tool is never called", async () => {
  const prompts: string[] = [];
  const s = { run: async (p: string) => { prompts.push(p); } };
  await expect(runUntilTool(s, "go", () => undefined, "submit_spec")).rejects.toThrow("submit_spec");
  expect(prompts).toHaveLength(2);
});
```
- [ ] **Step 2:** Run → FAIL. Implement. The factory uses `DefaultResourceLoader` with `noExtensions`, `noSkills`, `noContextFiles`, `noPromptTemplates`, `systemPrompt`, `agentDir: ".pi-home"`; `SessionManager.create/continueRecent` with session dir `<project>/.builder/sessions/<role>`; an inline extension that (a) blocks `read`/`write`/`edit`/`grep`/`find`/`ls` in `tool_call` when `isAllowed` is false, (b) calls `budget.take()` in `before_provider_request`, aborting the session on `BudgetExhausted` so `run` rethrows it.
- [ ] **Step 3:** On a 429 from `after_provider_response`, retry the run once with `config.fallbackModel` after 30 s; if that also fails, throw with the status.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS. Commit: `feat: guarded sessions and request budget`.

### Task 5: Spec stage and CLI (first demo)

**Files:** Create `src/agents/types.ts`, `src/agents/spec.ts`, `src/agents/prompts/spec.md`, `src/pipeline.ts`, `src/cli.ts`; test `tests/pipeline-spec.test.ts`, `tests/fakes.ts`

**Interfaces — Produces:**

```ts
interface SpecTurn { spec?: Spec; reply?: string }
interface Agents {
  spec(i: { messages: string[]; previous: Spec | null }): Promise<SpecTurn>;
  build(i: { spec: Spec; failure: string | null }): Promise<void>;
  writeTests(i: { spec: Spec; ids: string[] }): Promise<void>;
  triage(i: { spec: Spec; failures: Result[] }): Promise<{ testsChanged: boolean; notes: string }>;
}
interface UI { say(text: string): void; ask(question: string, fallback: string): Promise<string>;
  confirm(text: string): Promise<boolean> }
function handleMessage(deps: Deps, message: string): Promise<void>;
// Deps = { dir, agents: Agents, ui: UI, checks, tests }  (checks: Task 6, tests: Task 7)
```

The spec session has only the `submit_spec` tool (`SpecSchema`); invalid specs are returned to the model as a tool error listing `validateSpec` problems. A plain reply without the tool is allowed only when a spec already exists and the message asks no change; otherwise apply `runUntilTool`. The prompt must say: fill all five areas; a second reading counts only if a typical person with this request might mean it; `settledBy` is an exact quote; walk one person using the app instead of brainstorming extras; each `check` is something a browser can observe.

- [ ] **Step 1:** Failing tests with a fake agent and UI: unsettled `users` area → `ui.ask` called with `guess` as fallback; answers are appended to `messages` and the spec redrafted once (no second round of questions); a detailed request with all areas settled → zero `ask` calls; declining approval leaves stage `approval` and `agents.build` uncalled; typing a correction redrafts.
- [ ] **Step 2:** Run → FAIL. Implement. The draft prints idea, numbered deliverables with `(assumed)` marks, and not-building.
- [ ] **Step 3:** `npm test` → PASS.
- [ ] **Step 4:** Real run: `npm start -- demo`, type `build me a habit tracker`. Expected: 1–3 questions, then a draft, and `workspaces/demo/.builder/spec.json`. Record requests used.
- [ ] **Step 5:** Commit: `feat: spec stage and terminal chat`.

### Task 6: Builder, basic checks and the fix loop (second demo)

**Files:** Create `src/agents/builder.ts`, `src/agents/prompts/builder.md`, `src/verify/basic.ts`; modify `src/pipeline.ts`; test `tests/basic.test.ts`, `tests/pipeline-build.test.ts`

**Interfaces — Produces:**
- `runBasicChecks(dir, exec?: typeof compose): Promise<{ ok: true; url: string } | { ok: false; step: string; output: string }>`

Builder tools: pi `read`, `write`, `edit` rooted at `app/`; `bash` replaced by `createBashTool(appDir, { operations })` whose `exec` runs in the `shell` service (never on the host); `app_logs`. The spec goes in the prompt as text. Session resumes.

- [ ] **Step 1:** Failing tests: checks run `npm install`, `npx drizzle-kit push --force`, `npx tsc --noEmit`, `npx next build`, restart web, GET `/`, in that order, and **never `npm run`**; first failure stops and returns the last 4000 characters. Pipeline: a failed check feeds `failure` to the next `build`; after 3 fix rounds it stops with stage `checks` and says what fails; `BudgetExhausted` from `build` saves stage `build` and the next `handleMessage` (empty or `continue`) resumes there without calling `agents.spec`.
- [ ] **Step 2:** Run → FAIL. Implement.
- [ ] **Step 3:** `npm test` → PASS.
- [ ] **Step 4:** Real run on `demo` through to a preview URL. Check by hand that the app opens, and that `echo $OPENROUTER_API_KEY` via the builder's bash operations prints empty.
- [ ] **Step 5:** Commit: `feat: builder session, basic checks and fix loop`.

### Task 7: Verifier (third demo)

**Files:** Create `src/agents/verifier.ts`, `src/agents/prompts/verifier.md`, `src/verify/runner.ts`; modify `src/pipeline.ts`, `template/e2e/fixtures.ts`; test `tests/runner.test.ts`, `tests/pipeline-verify.test.ts`

**Interfaces — Produces:**
- `lintTests(e2eDir): string[]`
- `toResults(report: unknown /* Playwright JSON */, spec: Spec): Result[]`
- `runTests(dir, spec): Promise<Result[]>`

Verifier tools: `read` (project `app/` and `e2e/`), `write`/`edit` (`e2e/tests/` only), `page_snapshot(path)` (aria snapshot via the e2e container), `app_logs`, `db_query(sql)` as role `reader`. No bash. Fresh session each time. Each test title starts with `[D<n>]`, imports `test`/`expect` from `../fixtures` (which fails on console errors and 5xx), creates its own uniquely named data, and reloads before asserting persistence. With accounts, one test signs in as a second user and must not see the first user's data.

- [ ] **Step 1:** Failing tests: `toResults` — no test for an id → `untested`; any failure → `fail` with the error text; skipped → `untested`; all passed → `pass`; flaky (passed only on retry) → `fail`. `lintTests` flags `test.skip`, `test.fixme`, `test.only`, and imports from `@playwright/test`. Pipeline: failures → `triage` → rerun once if `testsChanged` → otherwise `build` with evidence → checks → tests, max 3 rounds; final report lists every deliverable with its status; "done" is said only if all are `pass`.
- [ ] **Step 2:** Run → FAIL. Implement. `playwright.config.ts` and `fixtures.ts` sit outside the verifier's write root.
- [ ] **Step 3:** `npm test` → PASS.
- [ ] **Step 4:** Real run on `demo`. Then run the saved tests a second time without resetting the database. Expected: same passes.
- [ ] **Step 5:** Commit: `feat: verifier and browser test loop`.

### Task 8: Follow-up requests

**Files:** Modify `src/pipeline.ts`, `src/cli.ts`; test `tests/pipeline-followup.test.ts`

- [ ] **Step 1:** Failing tests: a change request redrafts with `previous`, keeps unchanged ids, shows added/changed/removed and needs approval; `writeTests` receives only new or changed ids; all saved tests run; tests tagged with removed ids are deleted; a question gets a reply and triggers no build.
- [ ] **Step 2:** Run → FAIL. Implement; add `/status` (stage, results, requests used today) and `/preview`.
- [ ] **Step 3:** `npm test` → PASS. Commit: `feat: follow-up requests`.

### Task 9: Check the harness itself

**Files:** Create `evals/prompts.json`, `evals/intent.ts`, `evals/broken-app.ts`, `README.md`

- [ ] **Step 1:** Five prompts from vague to detailed, the last being "personal habit tracker, no login, daily only, no emails". `intent.ts` runs the spec stage only and prints the questions per prompt. Expected: the detailed one asks none.
- [ ] **Step 2:** `broken-app.ts` copies a working project, removes the database write for one deliverable, runs `runTests`. Expected: that deliverable is `fail`.
- [ ] **Step 3:** README: setup, commands, how intent and verification work, known gaps (no deploy). Commit: `docs: evals and readme`.

### Task 10 (optional): Exploratory pass

**Files:** Modify `src/agents/verifier.ts`, `src/pipeline.ts`; test `tests/pipeline-explore.test.ts`

**Interfaces — Produces:** `Agents.explore(i: { spec: Spec }): Promise<string[]>`, run only with `/explore`, with a `browse(steps)` tool.

- [ ] **Step 1:** Failing test: findings are shown to the user; `spec.json` and results are unchanged; it never runs unprompted.
- [ ] **Step 2:** Implement, `npm test` → PASS. Commit: `feat: exploratory pass`.
