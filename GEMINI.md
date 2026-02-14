# GEMINI.md

## Session Continuity (READ THIS FIRST)

Session summaries for this project are stored in `session-notes/`, not `docs/`. At the start of every new session, check:

```bash
ls -t session-notes/session-*.md | head -1
```

Read the most recent file before doing any other work. Save new session summaries to `session-notes/session-YYYY-MM-DD-{short-descriptor}.md`.

## Project Overview

`bird` is a fast X (Twitter) CLI client for tweeting, replying, and reading. It utilizes X/Twitter’s undocumented web GraphQL API and authenticates using browser cookies.

### Main Technologies
- **Language:** TypeScript (ESM)
- **Runtime:** Node.js (>=22), Bun (for binary compilation)
- **CLI Framework:** [Commander.js](https://github.com/tj/commander.js)
- **Authentication:** Cookie-based (`auth_token`, `ct0`), extracted via `@steipete/sweet-cookie`.
- **Testing:** [Vitest](https://vitest.dev/)
- **Linting/Formatting:** [Biome](https://biomejs.dev/) and [Oxlint](https://oxlint.js.org/)
- **Package Manager:** pnpm

### Architecture

#### Mixin-Based Client Composition
The `TwitterClient` is built using TypeScript mixins for modularity. Each mixin adds a domain of functionality:

```
TwitterClientBase (src/lib/twitter-client-base.ts)
    ↓ withMedia (media uploads)
    ↓ withPosting (tweet/reply)
    ↓ withTweetDetails (read single tweet)
    ↓ withSearch (search, mentions)
    ↓ withTimelines (bookmarks, likes)
    ↓ withLists (list operations)
    ↓ withUsers (following, followers, whoami)
    = TwitterClient (src/lib/twitter-client.ts)
```

#### Structure
- **Entry Points:** 
  - `src/cli.ts`: CLI entry point (argument normalization).
  - `src/index.ts`: Library entry point (re-exports from `src/lib/index.ts`).
- **CLI Structure:**
  - `src/cli/program.ts`: Defines the Commander program and registers commands.
  - `src/commands/`: Individual command implementations.
  - `src/cli/shared.ts`: Shared CLI context (colors, config, output).
- **GraphQL Discovery:**
  The system has three layers for managing rotating GraphQL query IDs:
  1. **Baked-in IDs** (`src/lib/query-ids.json`): Baseline mapping.
  2. **Runtime cache** (`~/.config/bird/query-ids-cache.json`): Refreshed automatically on 404s or via `bird query-ids --fresh`.
  3. **Fallback IDs**: Hardcoded alternatives for critical operations (e.g., `TweetDetail`, `SearchTimeline`).

## Building and Running

### Installation & Global Link
```bash
pnpm install
pnpm run build:dist
npm link --force      # Makes 'bird' command available globally
```

### Build Commands
- `pnpm run build`: Full build (compiles TS and creates a Bun binary).
- `pnpm run build:dist`: Compiles TS to `dist/` and copies assets.
- `pnpm run build:binary`: Creates a standalone `bird` binary using Bun.

### Development
- `pnpm run dev -- <args>`: Runs the CLI directly from source using `tsx`.
- `pnpm run graphql:update`: Scrapes and updates the baked-in `query-ids.json`.

### Testing
- `pnpm run test`: Runs the Vitest test suite.
- `pnpm run test:watch`: Runs Vitest in watch mode.
- `BIRD_LIVE=1 pnpm vitest run --no-file-parallelism tests/live/live.test.ts`: Live integration tests (requires valid cookies).
- `pnpm vitest run tests/filename.test.ts`: Run a specific test file.

### Linting
- `pnpm run lint`: Runs both Biome and Oxlint checks.
- `pnpm run lint:fix`: Automatically fixes linting issues where possible.

## Git Strategy
- **`main`**: Clean and in sync with remote. Never commit directly to `main`.
- **`dev`**: Primary working branch. All implementations and fixes land here first.
- **Feature/fix branches**: Created off `dev` to isolate work before PR.
- **Flow**: `feature-branch` → `dev` (test/validate) → `main`.

## Code Style & Conventions
- **ESM Requirement**: All imports must use `.js` extensions (e.g., `import { x } from './y.js'`).
- **Formatting**: Biome (single quotes, semicolons, 120 line width).
- **Linting**: Biome and Oxlint. Avoid `any` types.
- **Best Practices**: Use `for...of` instead of `forEach`.
- **Coverage**: Aim for 90% statements/lines/functions, 80% branches.
- **Mixin Pattern**: Add new API functionality via mixins in `src/lib/twitter-client-<feature>.ts`.
- **Error Handling**: Use the `success` field in result objects.
- **Output**: Use `ctx.colors` for consistent CLI themes.
