# Updated Three-Way Comparison: Bird vs xc vs Dewey

> **Generated:** 2026-02-09
> **Purpose:** Updated comparison focusing on bookmark download, thread handling, and language/translation capabilities
> **Supersedes:** `bird-vs-xc-vs-dewey-comparison.md` (2026-02-08)
> **Dewey version:** v5.7.9 | **Bird version:** 0.8.0 | **xc:** latest main

---

## Table of Contents

1. [What Changed Since the Prior Analysis](#what-changed-since-the-prior-analysis)
2. [Downloading All Bookmarked Tweets](#1-downloading-all-bookmarked-tweets)
3. [Thread Handling — Complete Comparison](#2-thread-handling--complete-comparison)
4. [Language Detection & Translation](#3-language-detection--translation)
5. [Updated Summary Matrix](#updated-summary-matrix)
6. [Recommendations](#recommendations)

---

## What Changed Since the Prior Analysis

| Area | Change | Tool |
|------|--------|------|
| **Language/translation** | Added `lang` (ISO 639-1) and `isTranslatable` fields to every tweet, plus a pluggable translation service (OpenAI/Anthropic) | Bird |
| **Thread API resilience** | v5.6.9 fixed `parseTweetsOfThread` to handle new API structure where tweet data is nested under a `tweet` property | Dewey |
| **Article parsing** | v5.7.8 added X/Twitter Article (long-form content) extraction from `article_results` | Dewey |
| **Defensive JSON parsing** | v5.7.8 wrapped all `response.json()` calls in try/catch across all 8 platforms | Dewey |
| **Logger system** | v5.7.4-v5.7.6 added structured logging with timestamped entries, network auto-detection, server-submittable batches | Dewey |
| **Free-tier enforcement** | v5.7.9 added single-network limit for free/trial users across all platforms | Dewey |
| **Partial error resilience** | Bird now handles partial API errors (e.g., `is_translatable` failures) alongside valid tweet data | Bird |
| **Rich content in threads** | Bird now supports X Articles via Draft.js rendering in thread output | Bird |
| **Unified pagination** | Bird unified `getRepliesPaged()` and `getThreadPaged()` under shared pagination helpers | Bird |

---

## 1. Downloading All Bookmarked Tweets

This is where the three tools diverge most sharply.

| Aspect | **Bird** | **xc** | **Dewey** |
|--------|----------|--------|-----------|
| **Full download** | `bird bookmarks --all --json` | Single API call only (no `--all`) | "Grab Bookmarks" button in browser |
| **Pagination** | Cursor-based, auto-paginating | **None** — single page, max 100 | Cursor-based, auto-paginating |
| **Page size** | 20 per page | Up to 100 (single call) | 100 per page |
| **Resume capability** | `--cursor <token>` to resume | None | None (starts fresh) |
| **Delta sync** | None (fetches all) | None | Yes — stops at `last_imported_tweet_id` |
| **Max pages control** | `--max-pages N` | N/A | None (runs to end) |
| **Bookmark folders** | `--folder-id <id>` | Not supported | Blue Lobby / Blue Folder modes |
| **Deduplication** | `Set<id>` per page + `Map<id>` across expansions | N/A | `Set<id>` across pages |
| **Retry logic** | Exponential backoff (429, 5xx), max 2 retries | None | 3 retries, 5s fixed delay |
| **Cursor-loop detection** | Terminates on duplicate cursor | N/A | Yes — breaks on repeated cursor |
| **Rate limiting** | Respects `Retry-After` header | SDK-managed | 5s between retries |
| **Data destination** | Local stdout / file | Local stdout / file | Remote (getdewey.co server) |
| **Thread expansion** | Per-bookmark, 5 filter strategies | None | Per-bookmark (author self-thread, configurable) |
| **Query ID resilience** | 4 fallback IDs + auto-refresh on 404 | N/A (official API) | Uses live browser URLs (always current) |

**Bottom line:** Bird is the only tool designed for comprehensive local bookmark archival. xc can only fetch a single page of bookmarks (max 100). Dewey fetches everything but sends it to a cloud server, not locally.

### Bird's Full Bookmark Download Pipeline

```bash
# Most comprehensive download:
bird bookmarks --all --full-chain-only --thread-meta --sort-chronological --json
```

This executes:
1. Paginate all bookmarks (20/page, unlimited pages)
2. For each bookmark, fetch its full conversation thread via `TweetDetail`
3. Cache threads by `conversationId` (avoids re-fetching)
4. Apply filter (`--full-chain-only` = entire reply tree)
5. Enrich with metadata (`threadPosition`, `isThread`, etc.)
6. Deduplicate globally by tweet ID
7. Sort chronologically
8. Output as JSON

**Pagination termination conditions:**
- No cursor returned from API
- Same cursor returned twice (no new data)
- Page returns 0 tweets
- No new tweets added to result
- Reached `--max-pages` limit

### Dewey's Bookmark Download Pipeline

```
User clicks "Grab Bookmarks" → scrapeBookmarks()
  → Fetch 100 bookmarks per page via GraphQL Bookmarks endpoint
  → For each tweet: optionally fetch thread (author self-thread only)
  → Delta sync: stop if reaching last_imported_tweet_id
  → POST each batch to getdewey.co/tweets/bookmarks/add/
  → Handle Blue Lobby / Blue Folder modes for premium users
```

Three folder modes:
- **Regular**: Standard bookmark pagination
- **Blue Lobby**: Fetches regular bookmarks first, then processes each folder
- **Blue Folder**: Per-folder pagination via `BookmarkFolderTimelineUrl`

### xc's Bookmark Download

```bash
xc bookmarks              # Single API call, max 100 tweets, no expansion
xc bookmarks --limit 50   # Limit to 50
```

No pagination, no thread expansion, no folders. The official API does support pagination tokens, but xc doesn't implement them.

---

## 2. Thread Handling — Complete Comparison

The three tools embody three fundamentally different "thread" mental models:

- **Bird**: Thread = the full conversation graph (all participants, filterable)
- **Dewey**: Thread = the author's monologue (consecutive self-replies only)
- **xc**: Thread = something you write (no reading capability)

| Capability | **Bird** | **xc** | **Dewey** |
|-----------|----------|--------|-----------|
| **Read full thread** | `bird thread <id>` — all participants | None | None |
| **Read author self-thread** | `--author-chain` on bookmarks | None | `parseTweetsOfThread()` |
| **All author tweets in convo** | `--author-only` on bookmarks | None | None |
| **Full reply tree** | `--full-chain-only` | None | None |
| **Create threads** | None | `xc post --thread "1" "2"` | None |
| **Thread metadata** | `--thread-meta` (position/root/end) | None | `is_self_thread` flag only |
| **Handles disconnected author replies** | `--author-only` catches them | N/A | **Misses them** (breaks at first non-author) |
| **Thread caching** | `Map<conversationId, tweets>` | N/A | None |
| **Paginated threads** | `--all --max-pages` | N/A | None |
| **Parent inclusion** | `--include-parent` | N/A | None |
| **`conversationId` in output** | Yes | No (not requested) | Yes |
| **`inReplyToStatusId` in output** | Yes | No | No |

### Dewey's Thread Handling — Current State (v5.7.9)

The v5.6.9 update fixed a structural issue where tweet data could be nested under a `tweet` property:

```javascript
// Before v5.6.9 — would crash on new API structure:
owner_id = base_path.core.user_results.result.rest_id;

// After v5.6.9 — handles both structures:
if (base_path.tweet) {
    owner_id = base_path.tweet.core.user_results.result.rest_id;
} else {
    owner_id = base_path.core.user_results.result.rest_id;
}
```

The core algorithm is unchanged:
1. Get root tweet author's `owner_id`
2. Filter entries matching `conversationthread-*` pattern
3. Only include entries where the first tweet is by `owner_id`
4. Within each entry, collect tweets by `owner_id` — **`break` at first non-author tweet**
5. User preference: Prompt / Auto / NoPrompt

#### What Dewey Misses

Given this thread:
```
[Alice] Root
  └─[Alice] Self-reply 1
      └─[Alice] Self-reply 2
          └─[Bob] "Great point!"
              └─[Alice] "Thanks!" ← LOST by Dewey
```

| Tool / Mode | Tweets Returned |
|-------------|----------------|
| Dewey | Root, Self-reply 1, Self-reply 2 (stops at Bob) |
| Bird `--author-chain` | Root, Self-reply 1, Self-reply 2 (same — connected chain) |
| Bird `--author-only` | Root, Self-reply 1, Self-reply 2, "Thanks!" (catches disconnected) |
| Bird `--full-chain-only` | All 5 tweets (full tree) |

### Bird's Thread Handling — Current State

No changes to the core filter algorithms since the prior analysis. Recent improvements:
- Better resilience for partial API errors (e.g., `is_translatable` failures alongside valid data)
- Rich content support in threads (X Articles via Draft.js rendering)
- Unified pagination helpers for `getRepliesPaged()` and `getThreadPaged()`

**Five filter strategies (unchanged):**

| Algorithm | Flag | Behavior |
|-----------|------|----------|
| **Author chain** | `--author-chain` | Walk UP collecting same-author tweets, walk DOWN collecting self-replies. Stop at different author. Connected chain only. |
| **Author only** | `--author-only` | All tweets by the bookmarked author in the thread, even if disconnected. |
| **Full chain** | `--full-chain-only` | Entire reply tree connected to the bookmarked tweet (all authors). Optional `--include-ancestor-branches`. |
| **Expand root only** | `--expand-root-only` | Only expand if bookmarked tweet is root. |
| **Include parent** | `--include-parent` | Add direct parent tweet for non-root bookmarks. |

**Thread metadata (`--thread-meta`):**

| Field | Values |
|-------|--------|
| `threadPosition` | `root`, `middle`, `end`, `standalone` |
| `isThread` | Whether the tweet is part of a multi-tweet thread |
| `hasSelfReplies` | Whether the author replied to this tweet |
| `threadRootId` | The conversation root tweet ID |

### xc — Still No Thread Reading

xc still does not request `conversation_id` in any `TWEET_FIELDS` array. The official API v2 does support it, but expanding threads would cost ~$0.01-0.02 per conversation search — making Bird's free "expand everything" model impractical with paid API calls.

---

## 3. Language Detection & Translation

This is the area with the **biggest change** since the prior analysis.

| Capability | **Bird** | **xc** | **Dewey** |
|-----------|----------|--------|-----------|
| **`lang` field in output** | **Yes** — `lang` (ISO 639-1) | No (not requested) | **No** (not extracted) |
| **`isTranslatable` flag** | **Yes** | No | No |
| **Translation service** | **Yes** — pluggable (OpenAI, Anthropic) | No | No |
| **Translation in output** | `translatedText`, `translatedTo`, `translationProvider` | N/A | N/A |
| **API availability** | GraphQL `legacy.lang` + `is_translatable` | Official API has `lang` tweet field | GraphQL has `lang` in response (not extracted) |

### Gap Analysis: Available but Unexploited

Both Dewey and xc have access to the `lang` field in their respective APIs but don't extract it:

- **Dewey**: The GraphQL response's `legacy` object contains `lang` — the same field Bird extracts — but `_parseSpecificTweet()` never reads it. The API even returns `graphql_is_translatable_rweb_tweet_is_translatable_enabled` in feature flags.
- **xc**: The official X API v2 supports `lang` as a requestable `tweet.field`, but xc's `TWEET_FIELDS` only requests `["created_at", "public_metrics", "author_id"]`.

### Bird's Translation System (New)

Bird now has a full translation pipeline in a feature branch (feat/translation-service, commit `c997785`, 2026-01-20):

```bash
# Identify non-English tweets:
bird bookmarks --all --json | jq '.tweets[] | select(.lang != "en")'

# Translate non-English bookmarks:
bird bookmarks --all --translate --translation-provider openai --json

# Translate with Anthropic:
bird read <tweet-url> --translate --translation-provider anthropic
```

The system:
1. Extracts `lang` (ISO 639-1) and `isTranslatable` from every tweet
2. Supports pluggable providers: OpenAI (`gpt-4o-mini` default), Anthropic (`claude-sonnet` default)
3. Adds `translatedText`, `translatedTo`, `translationProvider` to output
4. Configurable via CLI flags: `--translate`, `--translation-provider`, `--translation-api-key`, `--translation-model`

### How to Identify Non-English Tweets Today

| Approach | Tool | Method |
|----------|------|--------|
| **Best** | Bird | `bird bookmarks --all --json` → filter by `.lang != "en"` |
| **With translation** | Bird | `bird bookmarks --all --translate --json` |
| **Possible but not implemented** | Dewey | `lang` exists in GraphQL response but not extracted |
| **Possible but not implemented** | xc | `lang` is an available tweet field but not requested |

---

## Updated Summary Matrix

| Dimension | Bird | xc | Dewey |
|-----------|------|-----|-------|
| **Full bookmark download** | **Best** — `--all` with pagination, resume, folders | Single page only (max 100) | Full — but cloud-only destination |
| **Thread reading** | **Best** — 5 filter algorithms + metadata + caching | None | Author self-thread only (with `break`) |
| **Thread expansion on bookmarks** | **Best** — per-bookmark with caching + dedup | None | Per-bookmark (author self-thread only) |
| **Language detection** | **Best** — `lang` + `isTranslatable` on every tweet | Not implemented (available in API) | Not implemented (available in response) |
| **Translation** | **Best** — pluggable OpenAI/Anthropic service | None | None |
| **Delta sync** | None (re-fetches all) | None | **Best** — stops at last imported |
| **Data locality** | **Best** — local stdout/JSON | Local stdout/JSON | Cloud only (getdewey.co) |
| **Setup effort** | Medium (cookie extraction) | High (Developer Portal) | **Best** — install extension |
| **API resilience** | Good (fallback IDs + auto-refresh) | **Best** (official API) | Good (live browser URLs) |
| **Real-time capture** | None | None | **Best** — auto-detect on bookmark |
| **Multi-platform** | X only | X only | **Best** — 8+ platforms |
| **Article/long-form content** | **Best** — full Draft.js Markdown rendering | Limited (official API text) | Partial (article text + media, no Markdown) |
| **Posting stability** | Fragile (GraphQL, error 226 risk) | **Best** (official API) | None |
| **Cost** | Free | Pay-per-use (tracked) | Free |

---

## Recommendations

### For downloading all bookmarks with complete threads and language identification:

**Primary tool: Bird**

Bird is the only tool that covers all three requirements today:

```bash
# Full download with threads and language metadata:
bird bookmarks --all --full-chain-only --thread-meta --sort-chronological --json > bookmarks.json

# Filter non-English tweets:
cat bookmarks.json | jq '.tweets[] | select(.lang != "en") | {id, lang, author: .author.username, text: .text[:80]}'

# Download with automatic translation:
bird bookmarks --all --translate --translation-provider openai --json > bookmarks-translated.json
```

**Dewey complements** for real-time capture and delta sync — it captures bookmarks automatically as you browse, but lacks thread completeness and language detection.

**xc is not suited** for this workflow — no pagination, no threads, no language field.

### Complementary usage pattern:

| Step | Tool | Purpose |
|------|------|---------|
| 1. Real-time capture | Dewey | Auto-sync bookmarks to cloud as you browse |
| 2. Full local archive | Bird | `--all --full-chain-only --json` for complete local copy |
| 3. Language analysis | Bird | Filter by `lang` field, translate with `--translate` |
| 4. Official operations | xc | Post, DM, stream when needed |

---

## Dewey Parsed Tweet Data Structure (v5.7.9)

For reference, the complete data structure Dewey extracts per tweet:

```javascript
{
  id: string,                    // Tweet ID
  conversation_id: string,      // Thread conversation ID
  created_at: string,           // ISO timestamp
  full_text: string,            // Full text (includes note_tweet or article text)
  reply_count: number,
  retweet_count: number,
  is_self_thread: boolean,      // Part of author's self-thread
  user: {
    id: string,
    name: string,
    screen_name: string,
    profile_image_url: string,
    followers_count: number,
    favourites_count: number,
    friends_count: number,
    verified: boolean
  },
  medias: [{
    type: string,               // 'image', 'video', 'animated_gif'
    url: string,
    media_url: string,
    video_src: array,           // Video variants (for video/gif)
    width: number,              // For articles
    height: number              // For articles
  }],
  quote_status: object,         // Nested quoted tweet (recursive)
  sort_order: string            // Timeline sort index
}
```

**Notable absence:** No `lang`, `like_count`, or `isTranslatable` fields despite their availability in the GraphQL response.

---

## Related Documents

- `session-notes/bird-vs-xc-vs-dewey-comparison.md` — Original comparison (2026-02-08)
- `session-notes/verified-architecture-comparison-2026-02-08.md` — Architecture deep dive
- `session-notes/session-2026-02-08-three-way-comparison.md` — Prior session summary
- `/Users/rymalia/projects/xc/docs/xc-vs-bird-reference.md` — xc project's cross-reference
- `/Users/rymalia/projects/chrome-extensions/dewey-extension/CLAUDE.md` - Dewey project context  
- `/Users/rymalia/projects/chrome-extensions/dewey-extension/docs/dewey-current-context.md` - Dewey project context

