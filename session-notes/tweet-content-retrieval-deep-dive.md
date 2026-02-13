# Tweet Content Retrieval Deep Dive

> **Generated:** 2026-01-05
> **Purpose:** Educational documentation for understanding tweet, thread, and bookmark retrieval in the bird codebase

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Call Chain](#call-chain)
3. [Singleton vs Bulk Collection](#singleton-vs-bulk-collection)
4. [Available Data Fields](#available-data-fields)
5. [Specific Topics](#specific-topics)
   - [Bookmark Pagination](#bookmark-pagination)
   - [Single Tweet vs Thread](#single-tweet-vs-thread)
   - [Retweets and Quote Tweets](#retweets-and-quote-tweets)
   - [Language Flags](#language-flags)
   - [Available Metrics](#available-metrics)
6. [Essential Files](#essential-files)
7. [Key Patterns for Contributors](#key-patterns-for-contributors)
8. [Deep Dive: Pagination System](#deep-dive-pagination-system)
   - [Cursor-Based Pagination](#how-twitters-cursor-based-pagination-works)
   - [The Pagination Loop](#the-pagination-loop-getbookmarkspaged)
   - [Cursor Extraction](#cursor-extraction)
   - [Retry Logic with Backoff](#retry-logic-with-backoff)
9. [Deep Dive: GraphQL Query ID Management](#deep-dive-graphql-query-id-management)
   - [The Three-Layer Solution](#the-three-layer-solution)
   - [Query ID Resolution](#query-id-resolution)
   - [Runtime Query ID Discovery](#runtime-query-id-discovery)
10. [Complete Fetch Flow Diagram](#diagram-complete-fetch-flow-with-all-defenses)
11. [Summary: Key Takeaways](#summary-key-takeaways)

---

## Architecture Overview

The codebase uses a **mixin-based architecture** where the `TwitterClient` is assembled from multiple domain-specific mixins:

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

Each `withX()` function is a mixin that takes a base class and returns a new class with added methods. This creates a single unified client with all capabilities while keeping code organized by domain.

---

## Call Chain

```
┌──────────────────────────────────────────────────────────────┐
│  CLI Commands (src/commands/*.ts)                           │
│    bird bookmarks, bird read, bird thread                   │
└─────────────────────────┬────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  TwitterClient (assembled via mixins)                        │
│    withTimelines → withTweetDetails → withSearch → Base      │
└─────────────────────────┬────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Shared Parsing Layer (twitter-client-utils.ts)              │
│    parseTweetsFromInstructions() → mapTweetResult()          │
└─────────────────────────┬────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  GraphQL API (X/Twitter)                                     │
│    TweetDetail, Bookmarks, SearchTimeline queries            │
└──────────────────────────────────────────────────────────────┘
```

### Key Insight

Bookmarks don't reuse single-tweet methods directly - they use the same **parsing utilities** but different GraphQL queries. All tweet data normalization happens in one place (`mapTweetResult()`), regardless of source.

---

## Singleton vs Bulk Collection

| Aspect | Single Tweet (`bird read`) | Bulk (`bird bookmarks`) |
|--------|----------------------------|-------------------------|
| **GraphQL Query** | `TweetDetail` | `Bookmarks` |
| **Pagination** | None | Cursor-based |
| **Returns** | One `TweetData` | Array of `TweetData` |
| **Response Path** | `data.tweetResult.result` | `data.bookmark_timeline_v2.timeline.instructions[]` |
| **Deduplication** | Not needed | Yes (via `Set<id>`) |

### Thread Uses Single Tweet's Query

Both `getTweet()` and `getThread()` call the same method internally:

```typescript
const response = await this.fetchTweetDetail(tweetId);
```

But they parse differently:
- **Single**: Extracts focal tweet only
- **Thread**: Parses ALL tweets, filters by `conversationId`, sorts chronologically

Twitter's `TweetDetail` query always returns thread context, even when fetching one tweet. The codebase leverages this by reusing the same API call for both operations.

---

## Available Data Fields

### TweetData Interface

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Tweet ID |
| `text` | string | Full text (handles regular, notes, articles) |
| `author.username` | string | @handle |
| `author.name` | string | Display name |
| `authorId` | string | User ID |
| `createdAt` | string | ISO timestamp |
| `conversationId` | string | Thread root ID |
| `inReplyToStatusId` | string | Parent tweet ID |
| `replyCount` | number | Reply count |
| `retweetCount` | number | Retweet count |
| `likeCount` | number | Like count |
| `quotedTweet` | TweetData | Nested (depth-limited) |
| `media[]` | array | Photos, videos, GIFs |
| `_raw` | object | Raw GraphQL response (with `--json-full`) |

### Media Structure

```typescript
interface TweetMedia {
    type: 'photo' | 'video' | 'animated_gif';
    url: string;         // Full image URL
    previewUrl?: string; // Thumbnail
    videoUrl?: string;   // MP4 for videos/GIFs
    width?: number;
    height?: number;
    durationMs?: number; // Video duration
}
```

### Text Content Extraction Hierarchy

The `extractTweetText()` function tries sources in priority order:

1. **Article Tweets** - Long-form articles (`article.article_results.result`)
2. **Note Tweets** - Long tweets >280 chars (`note_tweet.note_tweet_results.result.text`)
3. **Regular Tweets** - Standard tweets (`legacy.full_text`)

---

## Specific Topics

### Bookmark Pagination

**How `--all` Works:**

```
bird bookmarks --all --max-pages 5

Loop:
  1. Fetch page (20 tweets hardcoded)
  2. Parse tweets, deduplicate by ID
  3. Extract "Bottom" cursor from response
  4. Check termination conditions:
     - No cursor? → stop
     - Cursor unchanged? → stop
     - No tweets returned? → stop
     - --max-pages reached? → stop, save cursor for resume
  5. Otherwise → fetch next page with cursor
```

**Resume Capability:**

```bash
# First run stops at page 5
bird bookmarks --all --max-pages 5 --json
# Output includes: "nextCursor": "ABC123..."

# Resume from where you left off
bird bookmarks --all --cursor "ABC123..."
```

**Implementation Location:** `src/lib/twitter-client-timelines.ts` lines 198-357

### Single Tweet vs Thread

| Operation | Method | Parsing |
|-----------|--------|---------|
| Single Tweet | `getTweet()` | Extract from `tweetResult.result` |
| Thread | `getThread()` | Parse all from instructions, filter by `conversationId` |
| Replies | `getReplies()` | Parse all, filter by `inReplyToStatusId` |

All three use the same `fetchTweetDetail()` GraphQL call but parse the response differently.

### Retweets and Quote Tweets

**Quote Tweets:**
- Extracted from `quoted_status_result.result`
- Recursive parsing with depth limit (default: 1 level)
- Configurable via `--quote-depth` CLI flag
- At depth 0, quoted tweets are ignored

**Retweets:**
- Detected via `__typename` field in GraphQL response
- Unwrapped via `unwrapTweetResult()` to get original tweet
- Retweet metadata (who retweeted, when) is NOT currently exposed in `TweetData`

### Language Flags

**Status:** Not currently implemented

The field likely exists in the raw API response (`legacy.lang`). To verify:

```bash
bird read <tweet-id> --json-full | jq '._raw.legacy.lang'
```

**To Add Language Support:**
1. Update `TweetData` interface to include `language?: string`
2. Extract from `result.legacy?.lang` in `mapTweetResult()`

### Available Metrics

**Currently Extracted:**
- `replyCount` - Number of replies
- `retweetCount` - Number of retweets
- `likeCount` - Number of likes

**In GraphQL but NOT Extracted:**
- View count (enabled in features but not mapped)
- Quote count
- Bookmark count

**To Discover All Available Fields:**

```bash
bird read <tweet-id> --json-full > tweet.json
# Examine the _raw field for complete GraphQL response
```

---

## Essential Files

### Priority Order for Learning

1. **`src/lib/twitter-client-types.ts`** - All type definitions; understand data shapes first
2. **`src/lib/twitter-client-utils.ts`** - All parsing logic; `mapTweetResult()` is central
3. **`src/lib/twitter-client-tweet-detail.ts`** - Single tweets, threads, replies
4. **`src/lib/twitter-client-timelines.ts`** - Bookmarks, likes, pagination engine
5. **`src/lib/twitter-client-base.ts`** - Base class, query ID management, HTTP handling
6. **`src/lib/twitter-client.ts`** - Mixin assembly, final client class
7. **`src/commands/read.ts`** - CLI for read, replies, thread commands
8. **`src/commands/bookmarks.ts`** - CLI for bookmark command
9. **`src/lib/twitter-client-constants.ts`** - Query IDs, API endpoints
10. **`src/lib/twitter-client-features.ts`** - GraphQL feature flags

---

## Key Patterns for Contributors

### 1. Centralized Parsing

All GraphQL responses flow through the same normalization pipeline:

```
GraphqlTweetResult (raw API response)
    ↓
mapTweetResult() → extracts and normalizes
    ↓
TweetData (clean, typed interface)
```

Never parse GraphQL responses directly in command handlers.

### 2. Defensive Coding

Extensive use of optional chaining because Twitter's API structure changes unpredictably:

```typescript
const username = userResult?.legacy?.screen_name ?? userResult?.core?.screen_name;
```

### 3. Multiple Fallbacks for Query IDs

Twitter rotates GraphQL query IDs frequently. The system has three layers:

1. **Fallback IDs** - Hardcoded in `twitter-client-constants.ts`
2. **Baked-in IDs** - From `query-ids.json`, updated via `pnpm run graphql:update`
3. **Runtime Cache** - From `~/.config/bird/query-ids-cache.json`, auto-refreshed on 404

### 4. Deduplication is Standard

All bulk operations deduplicate by tweet ID:

```typescript
const seen = new Set<string>();
for (const tweet of page.tweets) {
    if (seen.has(tweet.id)) continue;
    seen.add(tweet.id);
    tweets.push(tweet);
}
```

Twitter's paginated responses can return duplicates across page boundaries.

### 5. Raw Response Access

The `--json-full` flag adds `_raw` field with complete GraphQL response. Use this to:
- Discover new fields to extract
- Debug parsing issues
- Understand API structure changes

---

## Adding New Fields (Example)

To add view count to `TweetData`:

```typescript
// 1. In twitter-client-types.ts
export interface TweetData {
    // ... existing fields
    viewCount?: number;  // Add this
}

// 2. In twitter-client-utils.ts, mapTweetResult()
const tweetData: TweetData = {
    // ... existing extractions
    viewCount: result.views?.count,  // Add extraction
};
```

---

## Debugging Tips

### Debug Flags

```bash
# Bookmark debugging - shows query IDs, cursors, counts
BIRD_DEBUG_BOOKMARKS=1 bird bookmarks --all

# Article debugging - shows article payload structure
BIRD_DEBUG_ARTICLE=1 bird read <article-tweet-id>
```

### Live Testing

```bash
BIRD_LIVE=1 pnpm vitest run --no-file-parallelism tests/live/live.test.ts
```

Requires real Twitter credentials.

---

## Quick Reference: GraphQL Queries

| Operation | Query Name | File |
|-----------|-----------|------|
| Single Tweet | `TweetDetail` | twitter-client-tweet-detail.ts |
| Thread | `TweetDetail` | twitter-client-tweet-detail.ts |
| Replies | `TweetDetail` | twitter-client-tweet-detail.ts |
| Bookmarks | `Bookmarks` | twitter-client-timelines.ts |
| Bookmark Folder | `BookmarkFolderTimeline` | twitter-client-timelines.ts |
| Likes | `Likes` | twitter-client-timelines.ts |
| Search | `SearchTimeline` | twitter-client-search.ts |

---

## Deep Dive: Pagination System

The pagination system is one of the most sophisticated parts of the codebase. Understanding it is essential for working with any bulk data retrieval.

### How Twitter's Cursor-Based Pagination Works

Twitter uses **opaque cursor strings** for pagination rather than page numbers or offsets. Each API response includes cursor entries that point to the next/previous pages.

```
Page 1 Response:
  tweets: [A, B, C, D, E, F, G, H, I, J]  (20 tweets)
  cursors: [
    { type: "Top", value: "cursor-to-newer" },
    { type: "Bottom", value: "cursor-to-older" }
  ]

Page 2 Request (using Bottom cursor):
  variables: { cursor: "cursor-to-older", count: 20 }

Page 2 Response:
  tweets: [K, L, M, N, O, P, Q, R, S, T]
  cursors: [
    { type: "Top", value: "cursor-back-to-page1" },
    { type: "Bottom", value: "cursor-to-page3" }
  ]
```

### The Pagination Loop: `getBookmarksPaged()`

**Location:** `src/lib/twitter-client-timelines.ts:198-357`

Here's the annotated flow:

```typescript
private async getBookmarksPaged(limit: number, options: TimelinePaginationOptions = {}): Promise<SearchResult> {
  // SETUP PHASE
  const pageSize = 20;                        // Hardcoded page size
  const seen = new Set<string>();             // Deduplication tracker
  const tweets: TweetData[] = [];             // Accumulated results
  let cursor: string | undefined = options.cursor;  // Starting cursor (or undefined for first page)
  let nextCursor: string | undefined;         // For resume capability
  let pagesFetched = 0;

  // LOOP PHASE
  const unlimited = !Number.isFinite(limit);  // --all mode sets limit = Infinity

  while (unlimited || tweets.length < limit) {
    // Calculate how many to request this page
    const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);

    // Fetch with automatic query ID refresh on 404
    const page = await fetchWithRefresh(pageCount, cursor);
    if (!page.success) {
      return { success: false, error: page.error };
    }
    pagesFetched += 1;

    // DEDUPLICATION - Twitter can return duplicates across pages
    for (const tweet of page.tweets) {
      if (seen.has(tweet.id)) continue;  // Skip if already seen
      seen.add(tweet.id);
      tweets.push(tweet);
      if (!unlimited && tweets.length >= limit) break;
    }

    // TERMINATION CONDITIONS
    const pageCursor = page.cursor;
    if (!pageCursor ||                    // No cursor = end of data
        pageCursor === cursor ||          // Cursor unchanged = stuck
        page.tweets.length === 0) {       // Empty page = end of data
      nextCursor = undefined;
      break;
    }
    if (maxPages && pagesFetched >= maxPages) {  // --max-pages limit reached
      nextCursor = pageCursor;            // Save cursor for resume!
      break;
    }

    // ADVANCE TO NEXT PAGE
    cursor = pageCursor;
    nextCursor = pageCursor;
  }

  return { success: true, tweets, nextCursor };
}
```

### Cursor Extraction

**Location:** `src/lib/twitter-client-utils.ts:452-471`

Cursors are embedded in the `instructions` array alongside tweet entries:

```typescript
export function extractCursorFromInstructions(
  instructions: Array<{ entries?: Array<{ content?: unknown }> }> | undefined,
  cursorType = 'Bottom',  // 'Bottom' = next page, 'Top' = previous page
): string | undefined {
  for (const instruction of instructions ?? []) {
    for (const entry of instruction.entries ?? []) {
      const content = entry.content as { cursorType?: unknown; value?: unknown };
      if (content?.cursorType === cursorType &&
          typeof content.value === 'string' &&
          content.value.length > 0) {
        return content.value;
      }
    }
  }
  return undefined;
}
```

### Retry Logic with Backoff

**Location:** `src/lib/twitter-client-timelines.ts:540-565`

The pagination loop uses a retry wrapper for transient failures:

```typescript
private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const maxRetries = 2;           // 3 total attempts
  const baseDelayMs = 500;        // Starting delay
  const retryable = new Set([429, 500, 502, 503, 504]);  // Which errors to retry

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await this.fetchWithTimeout(url, init);

    // Success or non-retryable error = return immediately
    if (!retryable.has(response.status) || attempt === maxRetries) {
      return response;
    }

    // BACKOFF CALCULATION
    // 1. Check for Retry-After header (rate limit guidance)
    const retryAfter = response.headers?.get?.('retry-after');
    const retryAfterMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : Number.NaN;

    // 2. Fall back to exponential backoff with jitter
    // attempt 0: 500-1000ms, attempt 1: 1000-1500ms, attempt 2: 2000-2500ms
    const backoffMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs);

    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  return this.fetchWithTimeout(url, init);  // Final attempt
}
```

**Why jitter?** Random delay prevents "thundering herd" - if many clients retry at exactly the same time, they'd all hit the server simultaneously again.

### Bookmark Folder Pagination Quirk

**Location:** `src/lib/twitter-client-timelines.ts:472-486`

The `BookmarkFolderTimeline` query has inconsistent variable support across versions:

```typescript
let attempt = await tryOnce(buildVariables(pageCount, pageCursor, true));

// Some API versions reject the "count" variable
if (!attempt.success && attempt.error?.includes('Variable "$count"')) {
  attempt = await tryOnce(buildVariables(pageCount, pageCursor, false));  // Retry without count
}

// Some versions reject cursor parameter
if (!attempt.success && attempt.error?.includes('Variable "$cursor"') && pageCursor) {
  return {
    success: false,
    error: 'Bookmark folder pagination rejected the cursor parameter',
    had404: attempt.had404,
  };
}
```

This adaptive approach handles API version differences gracefully.

---

## Deep Dive: GraphQL Query ID Management

This is perhaps the most interesting defensive mechanism in the codebase. Twitter rotates GraphQL query IDs frequently (sometimes daily), which would break any hardcoded implementation.

### The Problem

Twitter's GraphQL endpoints look like:
```
https://x.com/i/api/graphql/{queryId}/{operationName}
```

For example:
```
https://x.com/i/api/graphql/97JF30KziU00483E_8elBA/TweetDetail
```

The `queryId` changes when Twitter deploys new versions. Using an old ID results in 404 errors.

### The Three-Layer Solution

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Runtime Cache                                     │
│  ~/.config/bird/query-ids-cache.json                        │
│  - Auto-discovered from x.com JavaScript bundles            │
│  - Refreshed on 404 errors or manually                      │
│  - TTL: 24 hours                                            │
│  Priority: HIGHEST                                          │
└─────────────────────────────────────────────────────────────┘
                          ↓ fallback
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Baked-in IDs                                      │
│  src/lib/query-ids.json                                     │
│  - Updated via: pnpm run graphql:update                     │
│  - Committed to repo                                        │
│  Priority: MEDIUM                                           │
└─────────────────────────────────────────────────────────────┘
                          ↓ fallback
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Fallback IDs                                      │
│  src/lib/twitter-client-constants.ts                        │
│  - Hardcoded in source code                                 │
│  - Last resort                                              │
│  Priority: LOWEST                                           │
└─────────────────────────────────────────────────────────────┘
```

### Query ID Resolution

**Location:** `src/lib/twitter-client-base.ts:44-47`

```typescript
protected async getQueryId(operationName: OperationName): Promise<string> {
  // First: check runtime cache
  const cached = await runtimeQueryIds.getQueryId(operationName);
  // Fall back to baked-in + fallback IDs
  return cached ?? QUERY_IDS[operationName];
}
```

### Multiple Fallback IDs Per Operation

**Location:** `src/lib/twitter-client-base.ts:60-68` and `twitter-client-timelines.ts:48-61`

Some operations have multiple known query IDs to try:

```typescript
protected async getTweetDetailQueryIds(): Promise<string[]> {
  const primary = await this.getQueryId('TweetDetail');
  return Array.from(new Set([
    primary,                        // From runtime cache or baked-in
    '97JF30KziU00483E_8elBA',      // Known working ID #1
    'aFvUsJm2c-oDkJV75blV6g'       // Known working ID #2
  ]));
}

private async getBookmarksQueryIds(): Promise<string[]> {
  const primary = await this.getQueryId('Bookmarks');
  return Array.from(new Set([
    primary,
    'RV1g3b8n_SGOHwkqKYSCFw',
    'tmd4ifV8RHltzn8ymGg1aw'
  ]));
}
```

### The Fetch Loop with 404 Detection

Every API call follows this pattern:

```typescript
const queryIds = await this.getBookmarksQueryIds();  // Get list of IDs to try
let had404 = false;

for (const queryId of queryIds) {
  const url = `${TWITTER_API_BASE}/${queryId}/Bookmarks?${params}`;
  const response = await this.fetchWithRetry(url, { method: 'GET', headers });

  if (response.status === 404) {
    had404 = true;      // Remember we got a 404
    continue;           // Try next query ID
  }

  if (response.ok) {
    return { success: true, tweets: parsedTweets };
  }
}

// If ALL query IDs returned 404, refresh and retry
if (had404) {
  await this.refreshQueryIds();
  // ... retry the whole loop
}
```

### Runtime Query ID Discovery

**Location:** `src/lib/runtime-query-ids.ts`

The `refresh()` function discovers fresh query IDs by:

1. **Fetching x.com pages** to find JavaScript bundle URLs:
   ```typescript
   const DISCOVERY_PAGES = [
     'https://x.com/?lang=en',
     'https://x.com/explore',
     'https://x.com/notifications',
     'https://x.com/settings/profile',
   ];
   ```

2. **Extracting bundle URLs** using regex:
   ```typescript
   const BUNDLE_URL_REGEX = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;
   ```

3. **Parsing JavaScript bundles** for query ID patterns:
   ```typescript
   const OPERATION_PATTERNS = [
     {
       regex: /e\.exports=\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/gs,
       operationGroup: 2,
       queryIdGroup: 1,
     },
     // ... more patterns for different code styles
   ];
   ```

4. **Caching results** with 24-hour TTL:
   ```typescript
   const snapshot: RuntimeQueryIdSnapshot = {
     fetchedAt: new Date().toISOString(),
     ttlMs: 24 * 60 * 60 * 1000,  // 24 hours
     ids: { TweetDetail: 'abc123', Bookmarks: 'def456', ... },
     discovery: { pages: [...], bundles: [...] }
   };
   await writeSnapshotToDisk(cachePath, snapshot);
   ```

### Cache Structure

**Location:** `~/.config/bird/query-ids-cache.json`

```json
{
  "fetchedAt": "2026-01-05T10:30:00.000Z",
  "ttlMs": 86400000,
  "ids": {
    "TweetDetail": "97JF30KziU00483E_8elBA",
    "Bookmarks": "RV1g3b8n_SGOHwkqKYSCFw",
    "SearchTimeline": "M1jEez78PEfVfbQLvlWMvQ",
    ...
  },
  "discovery": {
    "pages": ["https://x.com/?lang=en", ...],
    "bundles": ["main.abc123.js", "vendor.def456.js", ...]
  }
}
```

### Manual Refresh

```bash
# Force refresh query IDs
bird query-ids --fresh

# View current cached IDs
bird query-ids
```

### Why This Design?

| Challenge | Solution |
|-----------|----------|
| Query IDs change frequently | Three-layer fallback system |
| Can't predict new IDs | Runtime discovery from JS bundles |
| Discovery is slow (~5-10s) | Cache with 24h TTL |
| Cache can become stale | Auto-refresh on 404 |
| Single ID might fail | Multiple IDs tried in sequence |

This design means the CLI almost never fails due to query ID rotation - it self-heals by discovering new IDs automatically.

---

## Diagram: Complete Fetch Flow with All Defenses

```
User runs: bird bookmarks --all

        │
        ▼
┌───────────────────────────────────────────┐
│  CLI parses options                       │
│  limit = Infinity, maxPages = undefined   │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│  getBookmarksPaged(Infinity, {})          │
│  Initialize: seen=Set(), tweets=[]        │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│  PAGINATION LOOP (while tweets < limit)   │◄──────────────┐
└───────────────────────────────────────────┘               │
        │                                                    │
        ▼                                                    │
┌───────────────────────────────────────────┐               │
│  getBookmarksQueryIds()                   │               │
│  Returns: [primary, fallback1, fallback2] │               │
└───────────────────────────────────────────┘               │
        │                                                    │
        ▼                                                    │
┌───────────────────────────────────────────┐               │
│  QUERY ID LOOP (for each queryId)         │◄────────┐    │
└───────────────────────────────────────────┘         │    │
        │                                              │    │
        ▼                                              │    │
┌───────────────────────────────────────────┐         │    │
│  fetchWithRetry(url)                      │         │    │
│  Try up to 3 times with backoff           │         │    │
└───────────────────────────────────────────┘         │    │
        │                                              │    │
        ├─── 429/500/502/503/504 ─── retry ───┐       │    │
        │                                      │       │    │
        │    ┌─────────────────────────────────┘       │    │
        │    │ Exponential backoff + jitter           │    │
        │    └─────────────────────────────────┐       │    │
        │                                      │       │    │
        ├─── 404 ─── mark had404 ─────────────────────┘    │
        │            try next queryId                       │
        │                                                   │
        ├─── 200 OK ─────────────────────┐                  │
        │                                │                  │
        ▼                                ▼                  │
┌────────────────────┐    ┌──────────────────────────────┐ │
│  All IDs got 404?  │    │  Parse response              │ │
│  had404 = true     │    │  parseTweetsFromInstructions │ │
└────────────────────┘    │  extractCursorFromInstructions│ │
        │                 └──────────────────────────────┘ │
        ▼                                │                  │
┌────────────────────┐                   ▼                  │
│  refreshQueryIds() │    ┌──────────────────────────────┐ │
│  Discover from     │    │  Deduplicate by ID           │ │
│  x.com JS bundles  │    │  seen.add(tweet.id)          │ │
└────────────────────┘    └──────────────────────────────┘ │
        │                                │                  │
        ▼                                ▼                  │
┌────────────────────┐    ┌──────────────────────────────┐ │
│  Retry with new    │    │  Check termination:          │ │
│  query IDs         │    │  - No cursor? STOP           │ │
└────────────────────┘    │  - Cursor unchanged? STOP    │ │
                          │  - Empty page? STOP          │ │
                          │  - maxPages reached? STOP    │ │
                          │  Otherwise: cursor = next    │ │
                          └──────────────────────────────┘ │
                                         │                  │
                                         └──────────────────┘
                                                   │
                                                   ▼
                                    ┌──────────────────────────┐
                                    │  Return { tweets, cursor }│
                                    └──────────────────────────┘
```

---

## Summary: Key Takeaways

### Pagination
1. **Cursor-based** - Opaque strings, not page numbers
2. **Deduplication required** - Twitter returns duplicates across pages
3. **Multiple termination conditions** - No cursor, unchanged cursor, empty page, max pages
4. **Resume capability** - `nextCursor` returned for continuation
5. **Retry with backoff** - Handles rate limits and transient errors

### Query ID Management
1. **Three-layer fallback** - Runtime cache → Baked-in → Hardcoded
2. **Auto-discovery** - Parses x.com JavaScript bundles
3. **Auto-refresh** - 404 triggers discovery of new IDs
4. **Multiple IDs per operation** - Tries several before giving up
5. **24-hour cache** - Balances freshness with performance

### Design Principles
1. **Self-healing** - Automatically adapts to API changes
2. **Defensive** - Multiple fallbacks at every level
3. **Transparent** - Debug flags reveal what's happening
4. **Resumable** - Long operations can be interrupted and continued
