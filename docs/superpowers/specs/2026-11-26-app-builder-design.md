# App builder: design (draft, awaiting approval)

Items marked **(proposed)** were filled in by Claude and have not been discussed.

## Intent
A Lovable/Bolt-style harness on top of pi. You chat in the terminal and ask for a full-stack web app; it builds it, and previews it locally. The task also requires pushing to production on request; that is deferred (see Deferred). Part 1 of a new-joinee task, due Fri 27 Nov 2026, with daily discussions.

The two things being judged:
- **Intent:** working out what the user wants from what they typed.
- **Verification:** checking that what was built actually works.

## Goals
- A spec with a deliverables list is agreed before any code is written.
- A separate agent validates the app against that list, with evidence.
- Follow-up requests update the list first, then the code, and old checks rerun.

**Non-goals (proposed):** web UI, other stacks, several projects at once, real third-party services such as payments or email (stubbed and reported as untested).

**Anti-goals (proposed):** "done" because it compiles; the builder grading itself; a long interview before anything happens.

## Approaches
| Decision | Chosen | Rejected, and why |
|---|---|---|
| Harness | pi | deepagents: built-in planning and subagents, but pi has shell and file tools and shares a language with the apps |
| Control flow | TypeScript pipeline running separate pi sessions | One agent with a long prompt: quicker, but can skip stages |
| Generated app | Next.js + Postgres | React + Express + SQLite: harder to host |
| Intent | Draft, then correct, with a few questions | Interview until full: tiring. Build first: wrong data model is costly |

## Pipeline
TypeScript owns the stages, the state and every pass/fail decision.

```
message → SPEC → user approves → BUILD → BASIC CHECKS → VERIFY → report → local preview
                                   ↑          │ fail        │ fail
                                   └──────────┴─────────────┘  max 3 rounds
```

## Sessions
Each is its own `createAgentSession` with its own system prompt and tool allowlist. **(proposed)**

| Session | Job | Can | Cannot |
|---|---|---|---|
| Spec | Draft the spec and deliverables, ask questions | Submit the spec through a typed tool | Touch code |
| Builder | Write the app and fix failures | Read, write and run commands in the project | Edit the spec or the tests |
| Verifier | Write browser tests, explore, report | Read code, logs, database; drive the browser; write tests | Edit app code |

## Intent stage
The spec session fills five areas: who uses it, who sees whose data, shape of the core data, outside services, and the core thing the app must get right. For each: best guess, other likely reading, and the user's words that settle it, if any.

TypeScript asks about an area only if nothing settles it and the two readings would be built differently. At most 3 questions, each with a default (Enter accepts). A reading counts only if a typical person with that request might mean it. Everything else is recorded as `assumed`. The user then corrects or approves the draft.

## Deliverables
`.builder/spec.json`, created before any action:

```json
{
  "idea": "track daily habits",
  "areas": [{ "area": "users", "guess": "single user", "other": "accounts", "settledBy": null }],
  "deliverables": [
    { "id": "D1", "does": "user checks off a habit for today",
      "source": "assumed", "check": "check it, reload, still checked" }
  ],
  "notBuilding": ["reminders"],
  "constraints": []
}
```

The builder and verifier both read it. Neither edits it. Results (`pass`, `fail`, `untested` plus evidence) are kept in state by TypeScript.

## Verification
1. **Basic checks**, plain code: install, typecheck, build, server responds.
2. **Browser tests:** the verifier writes a Playwright test per deliverable, tagged with its id. **TypeScript runs them** and reads the results, so the agent cannot claim a pass. A deliverable with no test is `untested`.
3. Tests check persistence after reload; with accounts, a second user must not see the first user's data. Console errors and 5xx responses fail the test. **(proposed)**
4. Failures go to the builder with evidence. If the test itself is wrong, only the verifier may change it, and the reason is logged. **(proposed)**
5. **Exploratory pass** for what the spec missed. Findings are reported to the user and do not change the deliverables on their own. **(proposed)**

Saved tests rerun after every later change.

## Sandbox
One Docker setup per project: app and Postgres, preview on localhost. pi itself runs on the host; shell commands are redirected into the container, and file tools are blocked outside the project folder, reads included. Model keys never enter the container. The verifier gets no general shell, only tools for tests, logs and read-only database queries. **(proposed)**

pi's global extensions, skills and context files are switched off so runs behave the same everywhere. **(proposed)**

## State
`.builder/state.json`: stage, round, spec version, results, session file paths. Written after each stage so a run can resume.

**To review later:** session lifetime. Default until then: spec and builder sessions resume across follow-ups, the verifier starts fresh each run, and all transcripts are saved under `.builder/sessions/`.

## Deferred: deploy
Not built for now; development is local only. When added: run by TypeScript, not by an agent; if any deliverable is `fail` or `untested`, list them, warn, and let the user override with an explicit yes; then check the live app.

## Template (proposed)
One fixed starter: Next.js App Router, TypeScript, Tailwind, Drizzle, Postgres, Playwright. Better Auth is added only when the spec needs accounts.

## Build order
1. Template running in the sandbox with a preview
2. Pipeline, state, spec stage and questions
3. Builder session and basic checks
4. Verifier, browser tests, fix loop
5. Exploratory pass (cut first if time runs short)

**Checking the harness:** about five prompts from vague to detailed (a detailed one should get no questions), and one deliberately broken app that the verifier must catch.

## Environment found
Node 24.11.1, pi 1.5.0, Docker running. pi lists two models, both through OpenRouter: `qwen/qwen3.8-flash` and `z-ai/glm-5.3-flash`. The folder is not a git repository.

## Left to the builder
Prompt wording, module layout, terminal formatting, timeouts.

## Models and request budget
Free OpenRouter models only: the key has no credit. Limits are 20 requests a minute and 50 a day.

- Model is a setting per session. Start with `nvidia/nemotron-3-ultra-550b-a55b:free`, fall back to `google/gemma-4-31b-it:free`. Neither is tested yet.
- TypeScript counts requests, shows the count, waits on per-minute limits, and stops cleanly at the daily limit so the run can resume from state. A fallback model does not help with the daily limit, which covers all free models.
- Fix rounds send only the failing evidence. The exploratory pass is off by default.
- The pipeline is developed against fake agent sessions, so debugging it costs no requests.
- First task: check that pi can run the chosen model and that it calls tools correctly.
