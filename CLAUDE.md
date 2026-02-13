# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Continuity (Override)

Session summaries for this project are stored in `session-notes/`, not `docs/`. At the start of every new session, check:

```bash
ls -t session-notes/session-*.md | head -1
```

Read the most recent file before doing any other work. Save new session summaries to `session-notes/session-YYYY-MM-DD-{short-descriptor}.md`.

## Git Branch Strategy

- **`main`** — Clean and in sync with remote. Never commit directly to `main`.
- **`dev`** — Primary working branch. All documentation, experimental fixes, and implementations land here first.
- **Feature/fix branches** — Created off `dev` as needed to isolate work before PR.

Flow: `feature-branch` → `dev` (test/validate) → `main` (when ready to merge)

## Overview

`bird` is a CLI and library for interacting with X/Twitter via their undocumented web GraphQL API. It uses cookie-based authentication extracted from browsers (Safari, Chrome, Firefox) or provided manually.

## Install from Source

The npm release may lag behind the repository. To use the latest features (e.g., bookmark pagination with `--all`):

```bash
pnpm install
pnpm run build:dist
npm link --force      # Makes 'bird' command available globally
bird --version        # Verify: should show commit hash
```

## Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Full build: TypeScript + Bun binary
pnpm run build:dist   # TypeScript only (faster for dev)
pnpm test             # Run all tests
pnpm run test:watch   # Watch mode
pnpm run lint         # Run both Biome and oxlint
pnpm run lint:fix     # Auto-fix lint issues
pnpm run dev <args>   # Run CLI in dev mode (e.g., pnpm run dev whoami)
```

Run a single test file:
```bash
pnpm vitest run tests/cookies.test.ts
```

Live tests (requires real credentials):
```bash
BIRD_LIVE=1 pnpm vitest run --no-file-parallelism tests/live/live.test.ts
```

Update baked-in GraphQL query IDs:
```bash
pnpm run graphql:update
```

## Architecture

### Mixin-Based Client Composition

The TwitterClient is built using TypeScript mixins for modularity. Each mixin adds a domain of functionality:

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

Each mixin file (`twitter-client-*.ts`) extends the base with methods for a specific API domain. This pattern allows functionality to be split across files while maintaining a single unified client class.

### CLI Structure

- `src/cli.ts` - Entry point, argument normalization
- `src/cli/program.ts` - Commander.js setup, registers all commands
- `src/cli/shared.ts` - Shared CLI context (colors, config, output settings)
- `src/commands/*.ts` - Individual command implementations

### Library Exports

`src/index.ts` re-exports from `src/lib/index.ts`. Key exports:
- `TwitterClient` - Main API client
- `resolveCredentials` - Cookie extraction from browsers
- `runtimeQueryIds` - Runtime query ID management

### GraphQL Query IDs

X rotates GraphQL query IDs frequently. The system has three layers:
1. **Baked-in IDs** (`src/lib/query-ids.json`) - Baseline, updated via `pnpm run graphql:update`
2. **Runtime cache** (`~/.config/bird/query-ids-cache.json`) - Refreshed automatically or via `bird query-ids --fresh`
3. **Fallback IDs** - Hardcoded alternatives for critical operations (TweetDetail, SearchTimeline)

On 404 errors, the client auto-refreshes query IDs and retries.

## Code Style

- Uses Biome for formatting and linting (single quotes, semicolons, 120 line width)
- Uses oxlint for additional type-aware linting
- All imports must use `.js` extensions (ESM requirement)
- Avoid `any` types (Biome enforces this)
- Use `for...of` instead of `forEach`
- Coverage thresholds: 90% statements/lines/functions, 80% branches
