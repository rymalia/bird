# Plan: Add Filter Flags to `bird thread` Command

> **⚠️ Superseded draft — not what shipped.** `bird thread` shipped exactly four flags in v0.8.1 (commit `5c9fad5`): `--author-chain`, `--author-only`, `--rooted-thread` (replaces the proposed `--full-chain-only`), and `--thread-meta`. `--include-parent` and `--include-ancestor-branches` did not ship for `bird thread`. See `CHANGELOG.md` and `src/commands/read.ts` for the real behavior.

> **Created:** 2026-02-24
> **Status:** Plan complete, awaiting approval
> **Supersedes:** `plan-thread-author-filters-2026-02-02.md` (partially — that plan lacked `--rooted-thread` and `--include-parent`)

---

## Summary

Add four filtering/metadata flags to the `bird thread` command by reusing the existing pure filter functions from `src/lib/thread-filters.ts`. The thread command already fetches the full conversation; these flags let users narrow or annotate the output.

## Flags

| Flag | Maps To | Description |
|------|---------|-------------|
| `--author-chain` | `filterAuthorChain()` | Connected self-reply chain by the focal tweet's author |
| `--author-only` | `filterAuthorOnly()` | All tweets by the focal tweet's author |
| `--rooted-thread` | `filterFullChain()` | Reply chain from root through focal tweet + all descendants |
| `--thread-meta` | `addThreadMetadata()` | Enriches each tweet with `isThread`, `threadPosition`, `hasSelfReplies`, `threadRootId` |

### Deferred Flags

| Flag | Status | Notes |
|------|--------|-------|
| `--include-parent` | Deprioritized | Only useful after `--author-chain` strips a non-author parent. The parent is always in `getThread()` results, so implementation is trivial when needed. Not a priority — add in a later phase if users request it. |
| `--include-ancestor-branches` | Skipped | Sub-flag of `--full-chain-only` in bookmarks. Not applicable since we renamed to `--rooted-thread`. |

### Naming Note: `--rooted-thread` vs `--full-chain-only`

The bookmarks command uses `--full-chain-only`. For the thread command, this name is confusing because:
- In bookmarks, the default is one tweet → the flag **expands** output
- In thread, the default is the full conversation → the flag **narrows** output

`--rooted-thread` better communicates the intent: "give me the rooted path from the conversation root through my focal tweet, plus its descendants."

---

## Architecture

### Key Design Decision

**Filtering happens in the CLI layer** (`src/commands/read.ts`), not in client methods. This:
- Keeps `getThread()` / `getThreadPaged()` as pure data fetchers
- Ensures filters run after all pages are collected (critical for `--author-chain` which needs the full reply graph)
- Matches the bookmarks pattern

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

### Why This Is Simpler Than Bookmarks

The bookmarks pipeline needs thread caching, per-bookmark fetches, and cross-bookmark dedup because it processes **multiple** bookmarks across **multiple** conversations. The thread command fetches exactly **one** conversation — no cache, no loop, no secondary API calls.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/commands/read.ts` | Add imports, register 4 options, extend cmdOpts type, insert ~35-line filtering block, update printTweetsResult call |
| `tests/thread-filters.test.ts` | Add unit tests for `filterAuthorChain` and `filterAuthorOnly` (currently zero coverage) |
| `README.md` | Update thread command docs in Commands section |

### Files NOT Modified

| File | Why |
|------|-----|
| `src/lib/thread-filters.ts` | Functions work as-is. The `bookmarkedTweet` parameter name is cosmetic — renaming it would break bookmarks call sites for no benefit. |
| `src/lib/twitter-client-tweet-detail.ts` | No changes to data fetching layer |
| `src/lib/twitter-client-types.ts` | Types already support everything needed (`TweetWithMeta extends TweetData`) |

---

## Code Changes

### 1. `src/commands/read.ts` — New Imports (top of file)

```typescript
import { addThreadMetadata, filterAuthorChain, filterAuthorOnly, filterFullChain } from '../lib/thread-filters.js';
import type { TweetData, TweetWithMeta } from '../lib/twitter-client-types.js';
```

### 2. `src/commands/read.ts` — Option Registration (after `--json-full`)

```typescript
.option('--author-chain', 'Filter to the connected self-reply chain anchored at the focal tweet')
.option('--author-only', 'Include all tweets from the focal tweet author')
.option('--rooted-thread', 'Keep the full reply chain from root through the focal tweet and its descendants')
.option('--thread-meta', 'Add thread metadata fields (isThread, threadPosition, hasSelfReplies, threadRootId)')
```

### 3. `src/commands/read.ts` — cmdOpts Type Extension

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

### 4. `src/commands/read.ts` — Filtering Block (after `result` assignment, before `const isJson`)

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

### 5. `src/commands/read.ts` — Update Output Call

Replace `ctx.printTweetsResult(result, {` with:

```typescript
ctx.printTweetsResult(
  { tweets: finalTweets as TweetData[], nextCursor: result.nextCursor },
  {
```

---

## Conflict Warnings

| Flags Active | Warning | Behavior |
|---|---|---|
| `--author-chain` + `--author-only` | "other filter flags are redundant" | `--author-chain` wins |
| `--author-chain` + `--rooted-thread` | "other filter flags are redundant" | `--author-chain` wins |
| `--rooted-thread` + `--author-only` | "both active; --rooted-thread runs first" | Valid combo: rooted then author-filtered |

---

## Edge Cases

| Case | Handling |
|------|----------|
| Focal tweet not in results | Warn + return unfiltered (not a fatal error) |
| `--author-chain` where focal author ≠ root author | Returns only the focal author's sub-chain, excluding upstream non-author tweets |
| `--rooted-thread` on root tweet | Returns root + all descendants (≈ no-op, full conversation) |
| Empty result after filtering | `printTweetsResult` handles empty arrays naturally |
| Pagination + filters | Correct — filters run after all pages collected |
| `--thread-meta` alone (no filter flags) | Enriches all tweets with metadata, no filtering |
| `--thread-meta` + filter flags | Metadata computed from pre-filter set, applied to post-filter set |

---

## Test Plan

### Unit Tests: `tests/thread-filters.test.ts`

Add coverage for `filterAuthorChain` and `filterAuthorOnly` (currently at zero):

**`filterAuthorChain` cases:**
1. Connected self-reply chain from root (all same author)
2. Chain stops at non-author tweet going up
3. Descendants of anchor by same author included
4. Different-author interruptions respected
5. Single tweet (no replies) returns just the anchor

**`filterAuthorOnly` cases:**
1. Returns all author tweets, excludes others
2. Returns empty when no author matches in array

**`addThreadMetadata` cases:**
1. Root with self-replies → `threadPosition: "root"`
2. Standalone tweet → `threadPosition: "standalone"`
3. Mid-thread with self-replies → `threadPosition: "middle"`
4. End of chain → `threadPosition: "end"`

### Manual Verification

```bash
# Author chain (connected self-thread)
pnpm run dev thread <thread-root-id> --author-chain --json

# Author only (all author tweets)
pnpm run dev thread <thread-root-id> --author-only --json

# Rooted thread (connected subtree)
pnpm run dev thread <mid-thread-reply-id> --rooted-thread --json

# Thread metadata
pnpm run dev thread <thread-root-id> --thread-meta --json

# Combination
pnpm run dev thread <id> --author-chain --thread-meta --json

# Warning: conflicting flags
pnpm run dev thread <id> --author-chain --author-only --json  # should warn

# Pagination + filters
pnpm run dev thread <id> --all --max-pages 2 --author-chain --json
```

---

## Usage Examples (Post-Implementation)

```bash
# Get author's self-thread (connected chain through focal tweet)
bird thread 1234567890 --author-chain --json

# Get all tweets by the focal tweet's author in the conversation
bird thread 1234567890 --author-only --json

# Get only the reply chain connected to the focal tweet (root→focal→descendants)
bird thread 1234567890 --rooted-thread --json

# Annotate tweets with thread position metadata
bird thread 1234567890 --thread-meta --json

# Combine: author's connected chain with metadata annotations
bird thread 1234567890 --author-chain --thread-meta --json

# Rooted thread filtered to author only
bird thread 1234567890 --rooted-thread --author-only --json

# With pagination
bird thread 1234567890 --all --max-pages 3 --author-chain --json
```

---

## README Update

Update the `bird thread` line in the Commands section:

```
- `bird thread <tweet-id-or-url> [--all] [--max-pages n] [--cursor string] [--delay ms] [--author-chain] [--author-only] [--rooted-thread] [--thread-meta] [--json]` — show the full conversation thread; `--author-chain` filters to the author's connected self-reply chain; `--author-only` includes all tweets from the target tweet's author; `--rooted-thread` keeps the reply chain from root through the target and descendants; `--thread-meta` adds thread position metadata fields.
```
