---
session_id: 9d5b9ee6-3b6b-4bdf-b019-c9c0fe1c822c
date: 2026-10-27
time: "5:55 PM PDT – 6:54 PM PDT"
project: bird
branch: dev
---

# Session Summary: Query-ID Discovery Fix, TTL Auto-Refresh, pnpm 12 Migration

## Overview

A routine "refresh the query IDs" turned out to be broken discovery: X moved its **logged-out** web client to a new Relay/Vite build, so the bundle scraper (runtime refresh and `scripts/update-query-ids.ts`) found nothing. Bird still worked only because a 2026-05-11 cache was still being accepted. Discovery now reads the **logged-in** legacy client, the 24h cache TTL is enforced with a durable cross-process backoff, the baked-in IDs are refreshed, pnpm 12 works again, and items 3–5 of the 2026-10-27 catch-up list are closed (stale draft notes, push, translation branch).

## How We Got Here

1. `pnpm run graphql:update` failed with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` (separate pnpm 12 problem, fixed at the end). Running the script directly via `./node_modules/.bin/tsx` gave `No client bundles discovered`.
2. Logged-out `x.com` HTML now references only `abs.twimg.com/x-web/x-web/entry-client-logged-out-*.js`, a Rolldown/Vite ESM build with Relay persisted queries (`params:{id,name,operationKind}`). Its operations have different names and documents (`bookmarksQuery`, `createTweetMutation`). A Codex trace confirmed it sends `/graphql/<id>/<relayName>` with **no `features` param** and has no mapping back to legacy names, so its IDs can't be used with bird's requests.
3. The live check showed bird still working (whoami, bookmarks, read) on the May cache, so the server still accepts the legacy operations.
4. An authenticated GET of `https://x.com/home` returned the **legacy webpack client** (`responsive-web/client-web/main.<hash>.js`). The existing `e.exports={queryId,operationName}` patterns found 17 of 21 target ops in `main.js`. `Bookmarks` and `BookmarkFolderTimeline` live in a lazy chunk (`shared~bundle.BookmarkFolders~bundle.Bookmarks`), reachable through the inline webpack chunk-map function `name + "." + hash + "a.js"`.
5. The new IDs were tested live through an isolated `BIRD_QUERY_IDS_CACHE` with a fetch-tracing preload: 8 of 9 commands returned 200. Followers 404s on every ID, including the May cache (it was already broken before today).

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Use the logged-in legacy client, not the new Relay client** | Relay IDs name different query documents, and Relay sends no `features`; the legacy ops bird replicates are still served and still work. |
| **Synchronous refresh-on-stale with a sidecar backoff (1h/6h/24h), exclusive lock file, and disk re-read** | A consumer audit showed every consumer (smaug, x-bookmarks, dewey pipeline, birdclaw) runs one bird **subprocess** per call, so backoff and stampede protection must persist across processes. A fire-and-forget background refresh would be killed when a short-lived CLI process exits. |
| **Skip, don't wait, when another process holds the lock** | A stale ID almost always still works, and the forced 404-retry path covers the rare case where it doesn't. Waiting would add latency to every concurrent call. |
| **Merge discovered IDs over the on-disk snapshot** | The old `refresh()` replaced the ids map. AboutAccountQuery, CreateFriendship and DestroyFriendship are absent from the legacy client and would have been dropped. |
| **Trigger auto-refresh on stale/missing snapshot only, not on a missing op** | Undiscoverable ops would otherwise rerun full discovery on every `bird about` call. |
| **20s global deadline, concurrency 12, partial results kept** | Because 3 targets are undiscoverable, "all targets found" never fires and every refresh scans all ~600 lazy chunks. |
| **Real `/home` chunk-runtime snippet as the parser regression fixture** | The first implementation's regex matched zero maps on the real page while its synthetic-fixture test passed. That was caught only by counting live fetches. |
| **Delegate implementation to Codex `gpt-6-luna` high (mode 4); reviews with `gpt-5.6-luna` xhigh** | The user explicitly authorized liberal use of Codex luna agents. Claude conducted, verified, and made the small final edits itself. |
| **Followers 404 parked** | It predates this work, isn't an ID or host problem (`api.x.com` tested), and bird's REST fallback still returns followers. |
| **Translation branch archived as a tag, not merged** | Per the user's instruction. The Codex assessment (verified) found 1 commit, 11 files (+879/−6), one conflict hunk in `src/commands/read.ts`, and salvageable provider code. |
| **pnpm: migrate config instead of disabling `verifyDepsBeforeRun`** | The check was reporting a real problem: a fresh install would have silently skipped the sweet-cookie patch, which fixes Chrome cookie reading on macOS. |
| **Banners on the stale draft notes rather than deleting them** | Deleting untracked files is irreversible. Banners stop downstream docs copying flags that never shipped. |

## Changes Made

| Change | Detail |
|--------|--------|
| **Session notes committed** (`1d9b66a`) | The 4 untracked 2026-02-24 notes; the 3 drafts carry a "superseded" banner naming what shipped in `5c9fad5`; `temp/` gitignored (39 local fixture files, no credentials per the Codex scan). |
| **Discovery + TTL fix** (`b3a3284`) | `src/lib/runtime-query-ids.ts`: authenticated `/home` discovery (cookie only to `x.com/home`, `redirect: 'manual'`), chunk-map parser (`parseLazyChunkUrls`), shared deadline, deterministic priority, merge-on-write, atomic temp+rename writes, keyed in-flight dedupe, `autoRefresh` with sidecar `*.refresh-state.json` + lock, exported `discoverQueryIds`. `src/lib/twitter-client-base.ts`: stale-only auto-refresh; cookies passed on the forced 404 path. `src/commands/query-ids.ts`: honours global credential flags, prints `Found N/M operations`, exits 1 on zero results, no stack trace. `scripts/update-query-ids.ts`: reuses `discoverQueryIds`. Tests + `tests/fixtures/x-home-chunk-runtime.js` + `tests/setup.ts` (`BIRD_QUERY_IDS_AUTO_REFRESH=0`). |
| **Baked-in IDs refreshed** (`6dbde46`) | `src/lib/query-ids.json`: 18 updated; CreateFriendship, DestroyFriendship and AboutAccountQuery kept (not in the legacy client). |
| **Merge to dev** (`65efcc3`) | `--no-ff` merge of `fix/query-id-discovery`. |
| **pnpm 12 migration** (`1cb9ee9`) | `patchedDependencies` moved from `package.json` and `autoInstallPeers` from `.npmrc` (deleted) into `pnpm-workspace.yaml`; `onlyBuiltDependencies` → `allowBuilds` (written by `pnpm approve-builds esbuild`). Lockfile byte-identical. |
| **Rebuilt `dist/`** | `pnpm run build:dist`; installed `bird` reports `0.8.1 (1cb9ee9f)`. |
| **Real runtime cache refreshed** | `~/.config/bird/query-ids-cache.json`: 26 ops, fetched 2026-10-28T01:36Z UTC (2026-10-27 6:36 PM PDT). |
| **Translation branch archived** | Annotated tag `archive/feat-translation-service` at `c997785` (message has the restore command); local branch deleted. The user pushed the tag and deleted the remote branch. |
| **Pushes / cleanup (by the user)** | The user pushed `dev`, the tag and the fix branch, then deleted `fix/query-id-discovery` locally and on origin. `dev` confirmed in sync with `origin/dev`. |

## Testing / Research Performed

- **Unit suite (local, authoritative):** 451 passed / 43 skipped (52 files); `tsc --noEmit`, Biome and oxlint (`--deny-warnings`) clean. Also passes under **pnpm 10.34.8** (the CI pin, `ci.yml:19`) in a throwaway worktree: frozen-lockfile install, patch applied (`patch_hash=4ff44e9d…`), tests green.
- **Coverage:** the 90% threshold fails, but was **already failing**: a `HEAD` worktree baseline measured 71.54% statements / 61.5% branches, and the branch measured ~71.8%.
- **Live discovery timing** (`discoverQueryIds` with real cookies): before the fixes, 3 fetches and 18/29 ops (parser bug). After: **5.4s, 603 fetches, 26/29 ops**.
- **End-to-end CLI on an isolated stale cache** (fetch-tracing preload): the first `read` did one `/home` discovery, then a 200 on the new TweetDetail ID; the second `read` and two `about` calls did no discovery; `bookmarks` returned 200 via a lazy-chunk ID.
- **Stampede test:** 8 concurrent `bird read` processes on a stale cache produced exactly **1** discovery (run twice, before and after the lock edits). Valid JSON, 26 ids, no leftover lock file.
- **Installed-binary smoke test:** read / bookmarks / search / likes all returned 200 on the refreshed IDs; `bird query-ids --fresh` exited 0 via the `~/.local/bin/bird` launcher (Node v26.12.1).
- **Codex luna runs (12):**
  - Research (6): Relay request-format trace, TTL design plan, draft-notes audit, translation-branch assessment, downstream consumer audit, Followers 404 diagnosis.
  - Implementation (2): an initial pass, then a resumed pass fixing A–L.
  - Reviews (4): a spec review (REVISE), diff review 1 (FIX), diff review 2 (FIX), and a review of the conductor's own follow-up edits (FIX on one item).
  - Three findings were dropped after verification:
    - "credentials resolved but not used": `cookieHeader` is always set when tokens exist (`cookies.ts:133,204,231`);
    - a 25-minute worst-case estimate: theoretical, and moot because of the parser bug;
    - "invalid writer timestamp": the writer's `fetchedAt` is always `new Date().toISOString()` (`runtime-query-ids.ts:562`).

## Summary Statistics

- Commits by this session on `dev`: 5 (`1d9b66a`, `b3a3284`, `6dbde46`, `65efcc3`, `1cb9ee9`); 1 annotated tag.
- Ops discoverable: 18/29 (first implementation) → 26/29 (final); 3 ops are permanently absent from the legacy client.
- Verified defects fixed in the implementation: 12 (A–L), plus 3 follow-ups from review 2 (post-lock freshness recheck, newer-`fetchedAt` merge, vendor-last anonymous ordering).
- Consumers audited: 4 (smaug, x-bookmarks, dewey corpus pipeline, birdclaw).

## Discoveries / Handoff Notes

- **X runs two web clients.** Logged-out visitors get the Relay/Vite `x-web` build; logged-in users get the legacy webpack `responsive-web/client-web` build. Legacy query IDs are only discoverable with cookies. Fetching the legacy `main.js` and chunks needs no cookie; only `/home` does.
- **Chunk-map syntax** in the inline runtime: `t.u=e=>(({id:"name",...})[e]||e)+"."+({id:"hash",...})[e]+"a.js"`, with the name map wrapped in its own parens. Chunk URL = `https://abs.twimg.com/responsive-web/client-web/<name>.<hash>a.js`. If discovery regresses again, count the fetches first: 3 fetches means the chunk map wasn't parsed.
- **Not in the legacy client:** AboutAccountQuery (only in the Relay client), CreateFriendship, DestroyFriendship. They rely on baked-in IDs; `about` still works.
- **Followers GraphQL returns 404 on every ID** (legacy-client `KLLQR3852iPAj8J32VMdXQ`, the May cache ID, and the hardcoded fallback), on both `x.com/i/api` and `api.x.com`. The Codex trace found the legacy client calls it exactly like Following, which works. The cause is still unknown; the REST fallback covers it.
- **Auto-refresh knobs:** `BIRD_QUERY_IDS_AUTO_REFRESH=0` disables it. Sidecar state lives next to the cache as `query-ids-cache.refresh-state.json`; delete it to clear the backoff.
- **pnpm 11+/12:** reads settings only from `pnpm-workspace.yaml`; `.npmrc` is auth-only; build-script approval uses `allowBuilds`. The new layout works on pnpm 10 too.
- **`~/.local/bin/bird`** is a stable launcher that runs this checkout's `dist/` with nvm's default Node. Rebuild with `pnpm build:dist` after changes; birdclaw's launchd jobs depend on it.
- `ls -t session-notes/session-*.md` sorts by mtime, so it can surface an older note than the newest filename date.

## Current State

- Branch `dev` at `1cb9ee9`, in sync with `origin/dev`; working tree clean apart from this summary.
- `fix/query-id-discovery` merged and deleted (local and origin). `feat/translation-service` exists only as the tag `archive/feat-translation-service`.
- Installed `bird` = `0.8.1 (1cb9ee9f)`; runtime cache fresh as of 2026-10-27 6:36 PM PDT.

### Unfinished Work

- **Followers GraphQL 404:** separate investigation. The next step is to capture a real logged-in browser request for Followers and diff it against bird's (headers, `fieldToggles`, `withGrokTranslatedBio`, any client transaction header).
- **Coverage threshold** (90% configured, ~72% actual) predates this session; decide whether to raise coverage or lower the threshold.
- **Optional:** the catch-up hub statements in `~/projects/tweets` (hub lines 73 and 78 per `docs/catchup-briefing-2026-10-27.md`) can now say bird is v0.8.1 with TTL-enforced auto-refresh.
