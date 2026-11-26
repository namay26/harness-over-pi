# App Builder

A terminal tool that builds full-stack web apps from a chat, in the style of Lovable or Bolt. It is built in TypeScript on top of the [pi](https://pi.dev) coding agent.

You describe the app you want. It asks a few questions, agrees a list of deliverables with you, builds a Next.js and Postgres app, and runs it locally.

The project focuses on two problems:

- **Intent:** working out what the user wants from what they typed.
- **Verification:** checking that what was built works.

## How it works

1. **Spec.** One agent drafts a spec from your message. Each deliverable has a check that can be done in a browser. Anything the agent filled in is marked as assumed.
2. **Questions.** It asks only where your words leave two likely readings that would be built differently. There are at most 3 questions, each with a default.
3. **Approval.** You approve the draft or type a correction. Nothing is built before approval.
4. **Build.** A second agent writes the app inside a Docker sandbox.
5. **Checks.** Plain code installs packages, applies the database schema, checks types, builds the app and loads the home page. Failures go back to the builder, up to 3 times.
6. **Preview.** The app runs at http://localhost:3000.

TypeScript controls the stages and records the results. The agents only draft and build.

## Status

| Part | State |
|---|---|
| Spec, questions and approval | Working |
| Build, basic checks and local preview | Implemented. A full run has not yet finished with a real model |
| Browser verification of each deliverable | Not built yet. Every deliverable is reported as untested |
| Follow-up changes to a built app | Partly in place, not tested |
| Deployment to production | Not built yet |

## Setup

You need:

- Node.js 22.19 or newer
- Docker with Docker Compose, with the Docker daemon running
- An [OpenRouter](https://openrouter.ai) API key

It has been run on Linux only.

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Create a file named `.env` in the project root:

   ```
   OPENROUTER_API_KEY=your-key-here
   ```

   `.env` is ignored by git. The key is not passed into the Docker containers.

3. Start the builder with a project name (lowercase letters, digits and hyphens):

   ```bash
   npm start -- habits
   ```

The first build downloads the Docker images and the app's packages, so it takes longer than later ones.

## Using it

At the `>` prompt, describe your app, for example `build me a habit tracker`. Press Enter at a question to accept the default.

| Command | What it does |
|---|---|
| `continue` | Resumes a run that stopped, for example at the request limit |
| `/status` | Shows the current stage and requests used today |
| `/exit` | Quits |

Each project is stored in `workspaces/<name>/`:

| Path | Contents |
|---|---|
| `app/` | The generated app |
| `.builder/spec.json` | The approved deliverables |
| `.builder/state.json` | The current stage, used to resume |
| `.builder/sessions/` | Transcripts of the agent sessions |

The preview keeps running after you quit. To stop it:

```bash
cd workspaces/habits
docker compose -p builder-habits down
```

Add `-v` to also delete the app's database.

## Development

```bash
npm test
npm run typecheck
```

The tests use fake agents and make no model requests.