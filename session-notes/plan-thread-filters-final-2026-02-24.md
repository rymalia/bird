# Plan: Thread Filter Flags for `bird thread` — Final Implementation Plan

> **Created:** 2026-02-24
> **Status:** Ready for implementation
> **Supersedes:** `draft-plan-thread-author-filters-2026-02-02.md`, `draft-plan-thread-filter-flags-2026-02-24.md`, `draft-plan-thread-filtering-implementation.md`

---

## Summary

Add four filtering/metadata flags to `bird thread` by reusing the pure filter functions in `src/lib/thread-filters.ts`. The thread command already fetches the full conversation; these flags let users narrow or annotate the output.

### Flags

| Flag | Maps To | Description |
|------|---------|-------------|
| `--author-chain` | `filterAuthorChain()` | Connected self-reply chain by the focal tweet's author |
| `--author-only` | `filterAuthorOnly()` | All tweets by the focal tweet's author |
| `--rooted-thread` | `filterFullChain()` | Reply chain from root through focal tweet + all descendants |
| `--thread-meta` | `addThreadMetadata()` | Enriches each tweet with `isThread`, `threadPosition`, `hasSelfReplies`, `threadRootId` |

### Deferred / Skipped

| Flag | Status | Notes |
|------|--------|-------|
| `--include-parent` | Deferred | Only useful after `--author-chain` strips a non-author parent. Parent is always in `getThread()` results — trivial to add later if users request it. |
| `--include-ancestor-branches` | Skipped | Coupled to bookmarks' `--full-chain-only`. Not applicable with the renamed `--rooted-thread`. |

### Naming: `--rooted-thread` vs `--full-chain-only`

The bookmarks command uses `--full-chain-only`. For the thread command this name is confusing:
- In bookmarks, the default is one tweet → the flag **expands** output
- In thread, the default is the full conversation → the flag **narrows** output

`--rooted-thread` communicates the intent: "the rooted path from conversation root through my focal tweet, plus its descendants."

---

## Architecture

### Key Design Decision

**Filtering happens in the CLI layer** (`src/commands/read.ts`), not in client methods. This:
- Keeps `getThread()` / `getThreadPaged()` as pure data fetchers
- Ensures filters run after all pages are collected (critical for `--author-chain` which needs the full reply graph)
- Matches the bookmarks command pattern

### Why Simpler Than Bookmarks

Bookmarks processes **multiple** bookmarks across **multiple** conversations — needing thread caching, per-bookmark fetches, and cross-bookmark dedup. The thread command fetches **one** conversation. No cache, no loop, no secondary API calls.

### Data Flow

```
bird thread <id> [--author-chain | --rooted-thread | --author-only] [--thread-meta]
        │
        ▼
client.getThread(tweetId) or client.getThreadPaged(tweetId, ...)
        │
        ▼
allConversationTweets = result.tweets   ← frozen snapshot (pre-filter)
filteredTweets = result.tweets          ← working copy
        │
        ▼
focalTweet = allConversationTweets.find(t => t.id === tweetId)
  └─ if not found + any filter flag → warn, skip filtering
        │
        ▼
Filter priority (--author-chain wins all conflicts):
  1. --author-chain  → filterAuthorChain(all, focal)
  2. else:
     a. --rooted-thread → filterFullChain(all, focal)
     b. --author-only   → filterAuthorOnly(filteredTweets, focal)
        │                   ↑ operates on rooted output if both set
        ▼
--thread-meta → filteredTweets.map(t => addThreadMetadata(t, allConversationTweets))
                                                              ↑ always pre-filter set
        │
        ▼
ctx.printTweetsResult({ tweets: finalTweets, nextCursor: result.nextCursor }, ...)
```

---

## Implementation Phases

### Phase 1: Test Backfilling

**Goal:** Ensure the core filter logic has proper coverage before exposing it through new CLI flags.

**File:** `tests/thread-filters.test.ts`

Currently `filterAuthorChain` and `filterAuthorOnly` have **zero** test coverage. `filterFullChain` has 2 tests. `addThreadMetadata` has none.

**`filterAuthorChain` test cases:**

| # | Scenario | Anchor | Expected |
|---|----------|--------|----------|
| 1 | Connected self-reply chain (all same author) | Mid-chain tweet | Full chain root→anchor→leaves |
| 2 | Chain stops at non-author tweet going up | Reply to different author | Only anchor + descendants |
| 3 | Descendants of anchor by same author included | Root tweet | Root + all self-replies down |
| 4 | Different-author interruptions respected | Tweet after gap | Only the sub-chain from anchor |
| 5 | Single tweet (no replies, no parent) | Standalone | Just the anchor |

**`filterAuthorOnly` test cases:**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Mixed-author thread | All tweets by anchor author, others excluded |
| 2 | No matching tweets in array | Empty array |

**`addThreadMetadata` test cases:**

| # | Scenario | Expected `threadPosition` |
|---|----------|--------------------------|
| 1 | Root with self-replies | `"root"` |
| 2 | Standalone tweet (root, no replies) | `"standalone"` |
| 3 | Mid-thread with self-replies | `"middle"` |
| 4 | End of chain (no self-replies) | `"end"` |

### Phase 2: CLI Implementation

**Goal:** Wire the filter functions into the `bird thread` command.

**File:** `src/commands/read.ts` (single file, ~35 lines added)

#### Step 1 — New imports (top of file)

```typescript
import { addThreadMetadata, filterAuthorChain, filterAuthorOnly, filterFullChain } from '../lib/thread-filters.js';
import type { TweetData, TweetWithMeta } from '../lib/twitter-client-types.js';
```

#### Step 2 — Option registration (after `--json-full` on the thread command)

```typescript
.option('--author-chain', 'Filter to the connected self-reply chain anchored at the focal tweet')
.option('--author-only', 'Include all tweets from the focal tweet author')
.option('--rooted-thread', 'Keep the full reply chain from root through the focal tweet and its descendants')
.option('--thread-meta', 'Add thread metadata fields (isThread, threadPosition, hasSelfReplies, threadRootId)')
```

#### Step 3 — cmdOpts type extension

```typescript
cmdOpts: {
  all?: boolean;
  maxPages?: string;
  delay?: string;
  cursor?: string;
  json?: boolean;
  jsonFull?: boolean;
  authorChain?: boolean;    // NEW
  authorOnly?: boolean;     // NEW
  rootedThread?: boolean;   // NEW
  threadMeta?: boolean;     // NEW
}
```

#### Step 4 — Filtering block (after `result` assignment, before `const isJson`)

```typescript
// --- Thread filter flags ---
const useAuthorChain = Boolean(cmdOpts.authorChain);
const useAuthorOnly = Boolean(cmdOpts.authorOnly);
const useRootedThread = Boolean(cmdOpts.rootedThread);
const useThreadMeta = Boolean(cmdOpts.threadMeta);

if (useAuthorChain && (useAuthorOnly || useRootedThread)) {
  console.error(
    `${ctx.p('warn')}--author-chain already limits to the connected self-reply chain; ` +
      'other filter flags are redundant.',
  );
}
if (useRootedThread && useAuthorOnly && !useAuthorChain) {
  console.error(
    `${ctx.p('warn')}--rooted-thread and --author-only are both active; ` +
      '--rooted-thread will run first, --author-only will then filter its output.',
  );
}

let filteredTweets: TweetData[] = result.tweets ?? [];
const allConversationTweets: TweetData[] = result.tweets ?? [];

if (useAuthorChain || useAuthorOnly || useRootedThread) {
  const focalTweet = allConversationTweets.find((t) => t.id === tweetId);
  if (!focalTweet) {
    console.error(
      `${ctx.p('warn')}Focal tweet ${tweetId} not found in thread results; filter flags have no effect.`,
    );
  } else {
    if (useAuthorChain) {
      filteredTweets = filterAuthorChain(allConversationTweets, focalTweet);
    } else {
      if (useRootedThread) {
        filteredTweets = filterFullChain(allConversationTweets, focalTweet);
      }
      if (useAuthorOnly) {
        filteredTweets = filterAuthorOnly(filteredTweets, focalTweet);
      }
    }
  }
}

let finalTweets: Array<TweetData | TweetWithMeta> = filteredTweets;
if (useThreadMeta) {
  finalTweets = filteredTweets.map((tweet) => addThreadMetadata(tweet, allConversationTweets));
}
// --- End thread filter flags ---
```

#### Step 5 — Update output call

Replace `ctx.printTweetsResult(result, {` with:

```typescript
ctx.printTweetsResult(
  { tweets: finalTweets as TweetData[], nextCursor: result.nextCursor },
  {
```

The `as TweetData[]` cast is safe because `TweetWithMeta extends TweetData`. Matches the bookmarks pattern at `bookmarks.ts:234`.

### Phase 3: Integration Testing & Documentation

**Goal:** Verify end-to-end behavior and update docs.

#### Integration tests (`tests/commands.read.test.ts`)

| Test | Validates |
|------|-----------|
| `--author-chain` filters output to author's connected chain | Filter wiring + focal tweet resolution |
| `--author-only` filters to author's tweets | Filter wiring |
| `--rooted-thread` narrows to connected subtree | `filterFullChain` wiring |
| `--thread-meta` adds metadata fields to output | `addThreadMetadata` wiring |
| `--author-chain --author-only` emits warning | Conflict detection |
| Focal tweet not in results emits warning | Edge case handling |

#### Help output test (`tests/help-output.test.ts`)

Verify `--author-chain`, `--author-only`, `--rooted-thread`, `--thread-meta` appear in `bird thread --help`.

#### README update

Update the `bird thread` line in the Commands section:

```
- `bird thread <tweet-id-or-url> [--all] [--max-pages n] [--cursor string] [--delay ms] [--author-chain] [--author-only] [--rooted-thread] [--thread-meta] [--json]` — show the full conversation thread; `--author-chain` filters to the author's connected self-reply chain; `--author-only` includes all tweets from the target tweet's author; `--rooted-thread` keeps the reply chain from root through the target and descendants; `--thread-meta` adds thread position metadata fields.
```

#### Manual verification

```bash
# Basic flags
pnpm run dev thread <thread-root-id> --author-chain --json
pnpm run dev thread <thread-root-id> --author-only --json
pnpm run dev thread <mid-thread-reply-id> --rooted-thread --json
pnpm run dev thread <thread-root-id> --thread-meta --json

# Combinations
pnpm run dev thread <id> --author-chain --thread-meta --json
pnpm run dev thread <id> --rooted-thread --author-only --json

# Conflict warnings
pnpm run dev thread <id> --author-chain --author-only --json

# Pagination + filters
pnpm run dev thread <id> --all --max-pages 2 --author-chain --json

# Compare filtered vs unfiltered counts
pnpm run dev thread <id> --json | jq '.tweets | length'
pnpm run dev thread <id> --author-only --json | jq '.tweets | length'
```

---

## Files Modified

| File | Phase | Changes |
|------|-------|---------|
| `tests/thread-filters.test.ts` | 1 | Add `filterAuthorChain`, `filterAuthorOnly`, `addThreadMetadata` test suites |
| `src/commands/read.ts` | 2 | 2 imports, 4 options, 4 type fields, ~35-line filter block, 1 output call update |
| `tests/commands.read.test.ts` | 3 | Integration tests for new flags |
| `tests/help-output.test.ts` | 3 | Verify flags in help output |
| `README.md` | 3 | Update thread command documentation |

## Files NOT Modified

| File | Why |
|------|-----|
| `src/lib/thread-filters.ts` | Functions work as-is; `bookmarkedTweet` param name is cosmetic |
| `src/lib/twitter-client-tweet-detail.ts` | No changes to data fetching layer |
| `src/lib/twitter-client-types.ts` | `TweetWithMeta extends TweetData` already exists |
| `src/commands/bookmarks.ts` | No changes; bookmarks keeps its own flag names |

---

## Conflict Warning Matrix

| Flags Active | Warning | Behavior |
|---|---|---|
| `--author-chain` + `--author-only` | "other filter flags are redundant" | `--author-chain` wins |
| `--author-chain` + `--rooted-thread` | "other filter flags are redundant" | `--author-chain` wins |
| `--rooted-thread` + `--author-only` | "both active; --rooted-thread runs first" | Valid combo: rooted then author-filtered |

---

## Edge Cases

| Case | Handling |
|------|----------|
| Focal tweet not in results | Warn + return unfiltered (not fatal) |
| `--author-chain` where focal author ≠ root author | Returns only the focal author's sub-chain |
| `--rooted-thread` on root tweet | Returns root + all descendants (≈ full conversation) |
| Empty result after filtering | `printTweetsResult` handles empty arrays |
| Pagination (`--all`) + filters | Correct — filters run after all pages collected |
| `--thread-meta` alone | Enriches all tweets with metadata, no filtering |
| `--thread-meta` + filter flags | Metadata computed from pre-filter set, applied to post-filter set |

---

## Success Criteria

- [ ] `filterAuthorChain` and `filterAuthorOnly` have unit test coverage
- [ ] `addThreadMetadata` has unit test coverage for all four `threadPosition` values
- [ ] `bird thread <id> --author-chain --json` returns only the author's connected chain
- [ ] `bird thread <id> --author-only --json` returns all author tweets
- [ ] `bird thread <id> --rooted-thread --json` returns the connected subtree
- [ ] `bird thread <id> --thread-meta --json` includes metadata fields
- [ ] All filters work correctly with `--all` pagination
- [ ] Conflict warnings fire for redundant flag combos
- [ ] `pnpm test` passes with coverage thresholds met
- [ ] `pnpm run lint` passes
- [ ] README updated

---

## Usage Examples

```bash
# Author's self-thread (connected chain through focal tweet)
bird thread 1234567890 --author-chain --json

# All tweets by the focal tweet's author
bird thread 1234567890 --author-only --json

# Reply chain from root through focal tweet + descendants
bird thread 1234567890 --rooted-thread --json

# Thread position metadata
bird thread 1234567890 --thread-meta --json

# Combine: author chain with metadata
bird thread 1234567890 --author-chain --thread-meta --json

# Rooted thread filtered to author only
bird thread 1234567890 --rooted-thread --author-only --json

# With pagination
bird thread 1234567890 --all --max-pages 3 --author-chain --json
```
