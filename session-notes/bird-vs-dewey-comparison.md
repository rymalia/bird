# Bird vs Dewey: Tweet Data Collection Comparison

> **Generated:** 2026-01-05
> **Purpose:** Compare and contrast tweet data collection methods between the Bird CLI and Dewey Chrome Extension

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Tool Overview](#tool-overview)
3. [Access Vector Comparison](#access-vector-comparison)
4. [Feature Parity Matrix](#feature-parity-matrix)
5. [Data Collection Methods](#data-collection-methods)
   - [Single Tweet Retrieval](#single-tweet-retrieval)
   - [Thread Collection](#thread-collection)
   - [Bulk Bookmark Collection](#bulk-bookmark-collection)
6. [Technical Differences](#technical-differences)
7. [Use Case Recommendations](#use-case-recommendations)
8. [Questions for Dewey Code Deep Dive](#questions-for-dewey-code-deep-dive)

---

## Executive Summary

| Aspect | Bird (CLI) | Dewey (Chrome Extension) |
|--------|------------|--------------------------|
| **Primary Purpose** | CLI tool for fetching tweets on-demand | Browser extension for real-time bookmark sync to cloud |
| **Access Method** | Extracts cookies from browsers, makes direct API calls | Intercepts live browser requests, reuses active session |
| **Data Storage** | Local (stdout/JSON files) | Remote (getdewey.co backend server) |
| **Trigger** | User runs CLI command | Automatic on user action (bookmark) or manual "Grab" |
| **Multi-Platform** | X/Twitter only | X, Bluesky, LinkedIn, Reddit, TikTok, Instagram, Threads, Truth |

### Key Insight

**Bird** is an *extraction tool* - you query Twitter's API on-demand and get data back locally.

**Dewey** is a *sync tool* - it watches your browser activity and automatically syncs bookmarks to a cloud service for organization/search.

---

## Tool Overview

### Bird

```
User runs command
       │
       ▼
Bird extracts cookies from browser (Safari/Chrome/Firefox)
       │
       ▼
Bird constructs GraphQL API requests with auth headers
       │
       ▼
Twitter API returns data
       │
       ▼
Bird normalizes to TweetData and outputs JSON/text
```

**Key characteristics:**
- Standalone CLI tool
- Cookie-based authentication (extracted from browsers)
- Self-contained - no external service dependencies
- Query-based: fetch what you ask for
- Supports query ID auto-discovery and fallback

### Dewey

```
User browses X in Chrome
       │
       ├──► Extension passively captures auth tokens (webRequest.onSendHeaders)
       │
       ├──► User bookmarks a tweet
       │         │
       │         ▼
       │    Extension intercepts CreateBookmark request (webRequest.onBeforeRequest)
       │         │
       │         ▼
       │    callbacks.createBookmark() fetches full tweet details
       │         │
       │         ▼
       │    Normalized tweet POSTed to getdewey.co
       │
       └──► User clicks "Grab Bookmarks"
                 │
                 ▼
            Bulk scrape all bookmarks → POST to server
```

**Key characteristics:**
- Browser extension (Chrome Manifest V3)
- Passive credential capture (reuses browser's active session)
- Real-time event detection (bookmark create/delete)
- Cloud sync to getdewey.co backend
- Multi-platform support

---

## Access Vector Comparison

### How Authentication Works

| Aspect | Bird | Dewey |
|--------|------|-------|
| **Token Source** | Extracts `auth_token` and `ct0` cookies from browser databases | Intercepts from live requests via `webRequest.onSendHeaders` |
| **Token Storage** | Passed at runtime or from config file | Stored in `chrome.storage.local` |
| **Token Refresh** | Manual (re-extract if expired) | Automatic (passively captured as user browses) |
| **CSRF Token** | Extracted from cookies | Intercepted from request headers |
| **Additional Headers** | `x-client-uuid`, `x-client-transaction-id` generated | Captured from live requests (`x-client-uuid`, transaction IDs) |

### GraphQL Query ID Handling

| Aspect | Bird | Dewey |
|--------|------|-------|
| **ID Source** | Three-layer system: runtime cache → baked-in → fallback | Captured from live requests via URL interception |
| **On 404** | Auto-discovers new IDs from x.com JS bundles | Uses whatever ID the browser is using (always current) |
| **Maintenance** | Requires update mechanism | Self-maintaining (browser always has current IDs) |

**Insight:** Dewey has a significant advantage here - it intercepts the *actual* GraphQL URLs the browser uses, so query IDs are always current. Bird must actively discover IDs, though its auto-refresh mechanism makes this mostly transparent.

---

## Feature Parity Matrix

### Tweet Retrieval Features

| Feature | Bird | Dewey | Notes |
|---------|------|-------|-------|
| Single tweet by ID | Yes (`bird read`) | Yes (via `fetchTweetDetailsFromAPI`) | Both use TweetDetail GraphQL |
| Tweet thread | Yes (`bird thread`) | Yes (`parseTweetsOfThread`) | Different thread detection logic |
| Reply tweets | Yes (`bird replies`) | Limited | Dewey focuses on author's thread |
| Bookmarks list | Yes (`bird bookmarks`) | Yes (`scrapeBookmarks`) | Both support pagination |
| Bookmark folders | Yes (`--folder-id`) | Yes (Blue Lobby/Folder modes) | Both support X Premium folders |
| Likes timeline | Yes (`bird likes`) | Yes | Dewey also syncs likes |
| Search | Yes (`bird search`) | No | Bird only |
| User following/followers | Yes | No | Bird only |
| Post/reply tweets | Yes (`bird post`, `bird reply`) | No | Bird only |

### Data Fields Captured

| Field | Bird (`TweetData`) | Dewey (normalized object) |
|-------|--------------------|-----------------------|
| `id` | Yes | Yes |
| `text` / `full_text` | Yes | Yes |
| `createdAt` | Yes | Yes |
| `author` / `user` | Yes (username, name) | Yes (+ followers, verified) |
| `replyCount` | Yes | Yes |
| `retweetCount` | Yes | Yes |
| `likeCount` | Yes | No (not captured) |
| `conversationId` | Yes | Yes |
| `inReplyToStatusId` | Yes | No (not exposed) |
| `quotedTweet` | Yes (recursive, depth-limited) | Yes (recursive) |
| `media[]` | Yes (type, url, videoUrl) | Yes (type, url, video_src[]) |
| `is_self_thread` | No | Yes |
| `sort_order` | No | Yes (timeline position) |
| Raw response (`_raw`) | Yes (with `--json-full`) | No |

### Unique to Bird
- `likeCount` extraction
- `inReplyToStatusId` for reply chain tracking
- View count (in raw, not extracted)
- Raw API response access

### Unique to Dewey
- `is_self_thread` flag for thread detection
- `sort_order` for timeline ordering
- User engagement metrics (followers_count, friends_count, favourites_count)
- `verified` status

---

## Data Collection Methods

### Single Tweet Retrieval

#### Bird

```typescript
// src/lib/twitter-client-tweet-detail.ts
async getTweet(tweetId: string, options = {}): Promise<GetTweetResult> {
    const response = await this.fetchTweetDetail(tweetId);
    const tweetResult = response.data.tweetResult?.result ??
        findTweetInInstructions(response.data.threaded_conversation_with_injections_v2?.instructions, tweetId);
    return { success: true, tweet: mapTweetResult(tweetResult, { quoteDepth, includeRaw }) };
}
```

**Flow:**
1. Call `TweetDetail` GraphQL endpoint
2. Extract focal tweet from `tweetResult.result` or search instructions
3. Map to normalized `TweetData` via `mapTweetResult()`
4. Recursively parse quoted tweets up to `quoteDepth` limit

#### Dewey

```javascript
// scripts/grabber/x/factory.js
parseSpecificTweet: async (tweet_api_data) => {
    const instructions = tweet_api_data.threaded_conversation_with_injections_v2?.instructions;
    const entry = instructions.find(i => i.type == "TimelineAddEntries")
        .entries.filter(e => e.entryId.startsWith('tweet-')).at(-1);
    return await this.utils._parseSpecificTweet(entry.sortIndex, main_obj);
}
```

**Flow:**
1. Call `TweetDetail` GraphQL endpoint (using captured URL)
2. Extract from `TimelineAddEntries` instruction
3. Parse via `_parseSpecificTweet()` - **async, makes extra API call for quoted tweets**
4. Returns normalized tweet object

**Key Difference:** Dewey makes a **separate API call** for each quoted tweet to ensure complete data, while Bird uses inline `quoted_status_result` with depth limiting.

---

### Thread Collection

#### Bird

```typescript
// src/lib/twitter-client-tweet-detail.ts
async getThread(tweetId: string, options = {}): Promise<SearchResult> {
    const response = await this.fetchTweetDetail(tweetId);
    const instructions = response.data.threaded_conversation_with_injections_v2?.instructions;
    const tweets = parseTweetsFromInstructions(instructions, { quoteDepth, includeRaw });

    // Find target tweet to get conversationId
    const target = tweets.find((t) => t.id === tweetId);
    const rootId = target?.conversationId || tweetId;

    // Filter all tweets belonging to this conversation
    const thread = tweets.filter((tweet) => tweet.conversationId === rootId);

    // Sort chronologically
    thread.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    return { success: true, tweets: thread };
}
```

**Logic:**
- Parse ALL tweets from response
- Filter by `conversationId` matching root
- Include all participants (not just author)
- Sort chronologically

#### Dewey

```javascript
// scripts/grabber/x/factory.js
parseTweetsOfThread: async (tweet_api_data) => {
    // Get owner_id from root tweet
    const owner_id = base_path.core.user_results.result.rest_id;

    // Filter entries: conversationthread-* where first tweet author == owner_id
    const entries = tmp.entries.filter(e =>
        e.entryId.startsWith('conversationthread-') &&
        first_tweet_user_id == owner_id
    );

    // Collect consecutive tweets by same author only
    for (let entry of entries) {
        for (let item of entry.content.items) {
            if (item_user_id == owner_id) {
                threads.push(await _parseSpecificTweet(...));
            } else {
                break;  // Stop when hitting reply by someone else
            }
        }
    }
    return threads;
}
```

**Logic:**
- Find original author's `owner_id`
- Filter for `conversationthread-*` entries
- **Only include author's tweets** (stops at first non-author reply)
- Result is author's "self-thread" only

**Key Difference:**

| Aspect | Bird | Dewey |
|--------|------|-------|
| **Definition of "thread"** | All tweets in conversation | Author's self-thread only |
| **Includes replies from others** | Yes | No |
| **Uses** | `conversationId` filtering | `owner_id` + `entryId` pattern matching |
| **Use case** | Full conversation view | Author's continuous thread capture |

---

### Bulk Bookmark Collection

#### Bird

```typescript
// src/lib/twitter-client-timelines.ts
private async getBookmarksPaged(limit: number, options = {}): Promise<SearchResult> {
    const pageSize = 20;
    const seen = new Set<string>();
    const tweets: TweetData[] = [];
    let cursor = options.cursor;

    while (unlimited || tweets.length < limit) {
        const page = await fetchWithRefresh(pageCount, cursor);

        // Deduplicate
        for (const tweet of page.tweets) {
            if (seen.has(tweet.id)) continue;
            seen.add(tweet.id);
            tweets.push(tweet);
        }

        // Termination conditions
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0) break;
        if (maxPages && pagesFetched >= maxPages) break;

        cursor = pageCursor;
    }
    return { success: true, tweets, nextCursor };
}
```

#### Dewey

```javascript
// scripts/grabber/x/factory.js - scrapeBookmarks()
const doThatFetch = async (url, fetch_counter, is_folder_mode = false) => {
    const json = await this.services.fetchBookmarksFromAPI(url);

    // Retry logic (up to 3 times, 5s delay)
    if (fetch_counter < 3 && has_errors) {
        await new Promise(r => setTimeout(r, 5000));
        return await doThatFetch(url, fetch_counter + 1, is_folder_mode);
    }

    // Parse (synchronous - uses inline quoted tweet data)
    let tweets_list = this.utils.parseTweetsFromJsonAPI(json, 'Bookmarks', is_folder_mode);

    // Deduplicate
    const tweetIds = new Set();
    tweets_list = tweets_list.filter(tweet => {
        if (tweetIds.has(tweet.id)) return false;
        tweetIds.add(tweet.id);
        return true;
    });

    // Delta sync: stop if we reach already-imported tweet
    if (this.last_tweet_id) {
        const index = tweets_list.findIndex(t => BigInt(t.id) === BigInt(this.last_tweet_id));
        if (index > -1) {
            tweets_list = tweets_list.slice(0, index);
            cursor = null;  // Stop pagination
        }
    }

    // Extract cursor
    cursor = json.data.bookmark_timeline_v2.timeline.instructions[0]
        .entries.find(e => e.entryId.startsWith('cursor-bottom-'))?.content?.value;

    return { list: tweets_list, next_cursor: cursor };
};
```

**Comparison:**

| Aspect | Bird | Dewey |
|--------|------|-------|
| **Page size** | 20 (hardcoded) | 100 (configurable in URL) |
| **Retry logic** | Exponential backoff on 429/5xx | 3 retries, 5s fixed delay |
| **Deduplication** | Yes (by tweet ID) | Yes (by tweet ID) |
| **Delta sync** | No (fetches all, user can use cursor) | Yes (`last_imported_tweet_id` stops early) |
| **Folder support** | Yes (`--folder-id`) | Yes (3 modes: Regular, Blue Lobby, Blue Folder) |
| **Resume capability** | Yes (`--cursor`) | No (starts fresh each time) |
| **Query ID handling** | Multi-ID fallback + auto-refresh | Uses captured URL (always current) |

---

## Technical Differences

### Parsing: Sync vs Async

| Parsing Path | Bird | Dewey |
|-------------|------|-------|
| **Single tweet** | Sync (uses inline `quoted_status_result`) | Async (extra API call for quoted tweets) |
| **Bulk** | Sync (uses inline data) | Sync (uses inline data) |

**Dewey's tradeoff documented in `tweet-parsing.md`:**
> "When you bookmark a tweet in real-time: The extension calls `fetchTweetDetailsFromAPI(quoted_status_id_str)` for each quoted tweet. This ensures 100% complete data capture. Tradeoff: Slower (one extra API call per quote-tweet)"
>
> "When you bulk-scrape all bookmarks: The extension uses whatever `quoted_status_result` data is inline in the bulk response. Tradeoff: Quoted tweets may have truncated text, missing media, or be absent entirely"

**Bird's approach:** Always uses inline data, with configurable `quoteDepth` (default: 1) to limit recursion.

### Real-Time Event Detection (Dewey Only)

Dewey can detect when you bookmark/unbookmark a tweet in real-time:

```javascript
// sw.js - webRequest.onBeforeRequest listener
// Watches for POST to /i/api/graphql/.../CreateBookmark
// Triggers callbacks.createBookmark(tweet_id)
```

**Bird has no equivalent** - it's purely on-demand query-based.

### Thread Save Options (Dewey Only)

Dewey offers user-configurable thread handling:

| Mode | Value | Behavior |
|------|-------|----------|
| `Prompt` | 0 | Ask user "Do you want to save the entire thread?" |
| `Auto` | 1 | Automatically save threads without prompting |
| `NoPrompt` | 2 | Never save threads, only the single bookmarked tweet |

**Bird always returns thread data** when using `bird thread` - no filtering options.

### Error Handling Patterns

| Pattern | Bird | Dewey |
|---------|------|-------|
| **Query ID 404** | Try multiple IDs → auto-refresh from JS bundles → retry | N/A (uses live browser URLs) |
| **Rate limit (429)** | Exponential backoff + jitter, respects Retry-After | Fixed 5s delay, 3 retries |
| **API errors** | Returns error in result object | Shows UI message, retries |
| **Network timeout** | Configurable `--timeout` | No explicit timeout handling |

---

## Use Case Recommendations

### When to Use Bird

1. **Ad-hoc querying**: You want to fetch specific tweets, threads, or search results on-demand
2. **Scripting/automation**: You need CLI integration for pipelines
3. **Local data storage**: You want data saved locally without cloud sync
4. **Full conversation threads**: You need all participants, not just author's thread
5. **Search functionality**: Dewey doesn't support search
6. **Reply/post functionality**: Only Bird can create tweets
7. **Following/followers lists**: Only Bird supports user relationship data
8. **Raw API access**: You need `--json-full` for debugging or custom field extraction

### When to Use Dewey

1. **Continuous sync**: You want bookmarks automatically synced as you browse
2. **Cloud organization**: You want to search/organize bookmarks via getdewey.co
3. **Real-time capture**: You want tweets captured the moment you bookmark
4. **Complete quoted tweet data**: Real-time path ensures full quoted content
5. **Multi-platform**: You need to sync bookmarks from X, Bluesky, LinkedIn, etc.
6. **Author's self-threads**: You specifically want the author's continuous thread
7. **Zero-maintenance auth**: Credentials captured passively as you browse

### Complementary Usage

The tools serve different purposes and can be used together:

- **Dewey** for ongoing bookmark sync and cloud organization
- **Bird** for ad-hoc queries, search, posting, and data extraction

---

## Questions for Dewey Code Deep Dive

When we explore Dewey's source code in detail, here are questions to investigate:

### Architecture & Flow

1. **How does `webRequest.onSendHeaders` capture credentials?**
   - Which specific headers are captured?
   - How are different request types (GraphQL, REST) handled?
   - What happens if credentials expire mid-session?

2. **How does `webRequest.onBeforeRequest` detect bookmark actions?**
   - What URL patterns are watched?
   - How is the tweet ID extracted from the request body?
   - Are there race conditions between detection and fetch?

3. **How does the service worker coordinate with content scripts?**
   - What message types flow between them?
   - How are async responses handled?
   - What happens if the service worker is killed mid-operation?

### Parsing & Data

4. **What is the exact structure of the normalized tweet object?**
   - Are there platform-specific variations?
   - How are media types mapped?
   - What fields are optional vs required?

5. **How does `parseTweetsFromJsonAPI` handle edge cases?**
   - Deleted tweets?
   - Suspended accounts?
   - Sensitive content?
   - TweetWithVisibilityResults type?

6. **How does the inline vs fetched quote-tweet tradeoff manifest?**
   - What exactly is truncated in bulk mode?
   - Are there workarounds for completeness?

### Pagination & Sync

7. **How does delta sync work end-to-end?**
   - Where is `last_imported_tweet_id` stored server-side?
   - How are race conditions handled (new bookmarks during sync)?
   - What happens if a bookmark is deleted between syncs?

8. **How does folder detection and mode selection work?**
   - How are folder IDs discovered?
   - What determines Regular vs Blue Lobby vs Blue Folder mode?
   - Can a user override the auto-detection?

### Multi-Platform

9. **How much code is shared between platforms?**
   - Is there a common parsing interface?
   - How are platform-specific quirks handled?
   - What's the effort to add a new platform?

### Server Communication

10. **What is the full API contract with getdewey.co?**
    - Request/response schemas for all endpoints?
    - Error handling and retry policies?
    - Rate limiting on the server side?

---

## Summary

| Dimension | Bird | Dewey | Winner (context-dependent) |
|-----------|------|-------|---------------------------|
| **Ease of setup** | Requires cookie extraction | Just install extension | Dewey |
| **Auth maintenance** | Manual if cookies expire | Automatic | Dewey |
| **Query ID handling** | Sophisticated auto-discovery | Uses live browser URLs | Dewey (simpler) |
| **Real-time capture** | Not supported | Built-in | Dewey |
| **Ad-hoc queries** | Full CLI support | Not supported | Bird |
| **Local-first** | Yes (no external deps) | No (requires server) | Bird |
| **Thread definition** | Full conversation | Author's self-thread | Depends on use case |
| **Quoted tweet completeness** | Inline only | Extra API calls (real-time) | Dewey (real-time) |
| **Search** | Yes | No | Bird |
| **Post/reply** | Yes | No | Bird |
| **Multi-platform** | X only | 8+ platforms | Dewey |
| **Scripting/automation** | Designed for it | Not supported | Bird |

**Bottom line:**
- **Bird** = power tool for developers who want on-demand data extraction
- **Dewey** = consumer tool for users who want automatic bookmark organization
