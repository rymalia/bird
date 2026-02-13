# Bird vs xc vs Dewey: Three-Way Comparison

> **Generated:** 2026-02-08
> **Purpose:** Comprehensive comparison of three X/Twitter data tools — Bird CLI, xc CLI, and Dewey Chrome Extension
> **Audience:** Developers evaluating or integrating these tools

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architectural DNA](#architectural-dna)
3. [Feature Parity Matrix](#feature-parity-matrix)
4. [Authentication Comparison](#authentication-comparison)
5. [Cost & Sustainability](#cost--sustainability)
6. [CLI Design Philosophy](#cli-design-philosophy)
7. [Testing Approaches](#testing-approaches)
8. [Where Each Tool Excels](#where-each-tool-excels)
9. [Complementary Usage Scenarios](#complementary-usage-scenarios)
10. [Deep Dive: Thread Handling](#deep-dive-thread-handling)
    - [What is a "Thread"? Three Different Answers](#what-is-a-thread-three-different-answers)
    - [Bird: Full Conversation Graph](#bird-full-conversation-graph)
    - [xc: Write-Only Thread Creation](#xc-write-only-thread-creation)
    - [Dewey: Author's Self-Thread Only](#dewey-authors-self-thread-only)
    - [Side-by-Side Thread Comparison](#side-by-side-thread-comparison)
    - [Thread Algorithm Walkthrough](#thread-algorithm-walkthrough)
    - [Architectural Implications](#architectural-implications)
11. [Summary](#summary)

---

## Executive Summary

| Aspect | **Bird** (CLI) | **xc** (CLI) | **Dewey** (Chrome Extension) |
|--------|---------------|--------------|------------------------------|
| **Primary Purpose** | CLI tool for fetching tweets on-demand | Official X API v2 CLI client | Browser extension for real-time bookmark sync to cloud |
| **API Layer** | Undocumented GraphQL (cookie auth) | Official X API v2 (OAuth 2.0 PKCE) | Undocumented GraphQL (intercepted session) |
| **Auth Method** | Browser cookie extraction | OAuth 2.0 with XDK SDK | Passive credential capture from live requests |
| **Cost** | Free (uses web session) | Pay-per-use (X API pricing) | Free (uses web session) |
| **Stability** | Fragile -- query IDs rotate, endpoints break | Stable -- official, versioned API | Moderate -- uses live browser URLs (always current) |
| **Data Storage** | Local (stdout/JSON) | Local (stdout/JSON) | Remote (getdewey.co cloud) |
| **Trigger** | User runs CLI command | User runs CLI command | Automatic on user action (bookmark) or manual "Grab" |
| **Multi-Platform** | X/Twitter only | X/Twitter only | X, Bluesky, LinkedIn, Reddit, TikTok, Instagram, Threads, Truth |
| **Runtime** | Node.js / Bun | Node.js (tsx/tsc) | Chrome Extension (Manifest V3) |

### Key Insight

- **Bird** is an *extraction tool* -- you query Twitter's internal API on-demand and get data back locally.
- **xc** is an *operations tool* -- you interact with the official paid API for reading, posting, streaming, and DMs.
- **Dewey** is a *sync tool* -- it watches your browser activity and automatically syncs bookmarks to a cloud service.

---

## Architectural DNA

These three tools represent three fundamentally different access strategies to the same platform:

1. **Bird** = reverse-engineered web client (scrapes internal GraphQL endpoints with extracted cookies)
2. **xc** = legitimate API consumer (uses the official paid SDK with proper OAuth)
3. **Dewey** = browser parasite (piggybacks on the user's active browser session to intercept and replay)

Each strategy has cascading consequences for auth, reliability, features, and cost.

### Bird -- Mixin-Based Client Composition

```
TwitterClientBase (cookie auth, query ID management)
    | withMedia, withPosting, withTweetDetails, withSearch,
      withTimelines, withLists, withUsers
    = TwitterClient
```

Bird builds its own HTTP client from scratch, managing cookies, CSRF tokens, and rotating GraphQL query IDs across a three-layer system (baked-in -> runtime cache -> fallback). The mixin pattern splits concerns across files while producing a single unified class.

### xc -- Proxy-Wrapped Official SDK

```
XDK Client (official SDK)
    | wrapClient() -- two-level Proxy
    | Intercepts: client.posts.searchRecent(...)
    | Injects: checkBudget() + logApiCall()
    = Instrumented Client
```

xc's most distinctive architectural pattern is the **two-level Proxy** in `api.ts`. When you call `client.posts.searchRecent()`, the first proxy intercepts the `.posts` namespace access and returns *another* proxy, which intercepts the `.searchRecent` method call to transparently run budget checks and cost logging. Commands never see this -- they just call SDK methods naturally.

### Dewey -- Event-Driven Interceptor

```
webRequest.onSendHeaders -> capture auth credentials
webRequest.onBeforeRequest -> detect bookmark actions
service worker <-> content scripts <-> dewey.co server
```

Dewey sits inside the browser, passively capturing credentials from live requests and reacting to user actions in real-time.

---

## Feature Parity Matrix

| Feature | Bird | xc | Dewey |
|---------|------|-----|-------|
| **Read tweet** | `bird read` | -- | via `fetchTweetDetailsFromAPI` |
| **Search** | `bird search` | `xc search` (recent/archive) | -- |
| **Post/Reply** | `bird tweet` / `bird reply` | `xc post` / `--reply` / `--quote` | -- |
| **Thread (read)** | `bird thread` (full conversation) | -- | `parseTweetsOfThread` (author-only) |
| **Thread (write)** | -- | `xc post --thread "1" "2" "3"` | -- |
| **Bookmarks (read)** | `bird bookmarks` (with expansion flags) | `xc bookmarks` | `scrapeBookmarks()` |
| **Bookmark create** | -- | `xc bookmark <id>` | Real-time interception |
| **Unbookmark** | `bird unbookmark` | `xc unbookmark` | Via server request |
| **Bookmark folders** | `--folder-id` | -- | Blue Lobby/Folder modes |
| **Likes (read)** | `bird likes` | -- | Yes |
| **Like/Unlike** | -- | `xc like` / `xc unlike` | -- |
| **Home timeline** | `bird home` | `xc timeline` | -- |
| **User timeline** | `bird user-tweets` | `xc timeline <user>` | -- |
| **Following/Followers** | `bird following` / `bird followers` | `xc followers` / `xc following` | -- |
| **Follow/Unfollow** | -- | `xc follow` / `xc unfollow` | -- |
| **Lists** | `bird lists` / `bird list-timeline` | `xc lists` / `xc list` | -- |
| **DMs** | -- | `xc dm send/list/history` | -- |
| **Media upload** | `bird tweet --media` | `xc media upload` / `xc post --media` | -- |
| **Streaming** | -- | `xc stream` (filtered stream) | -- |
| **News/Trending** | `bird news` | -- | -- |
| **Delete post** | -- | `xc delete` | -- |
| **User lookup** | `bird about` | `xc user` | -- |
| **Multi-account** | -- | `xc auth switch` / `--account` | -- |
| **Cost tracking** | -- | `xc cost` (JSONL logging) | -- |
| **Budget limits** | -- | `xc budget` (block/warn/confirm) | -- |
| **Multi-platform** | X only | X only | 8+ platforms |

### Unique to Each Tool

**Bird only:**
- Thread expansion with 5 filter modes (`--author-chain`, `--author-only`, `--full-chain-only`, etc.)
- Thread metadata enrichment (`--thread-meta`)
- News/trending from X Explore tabs
- GraphQL query ID auto-recovery (3-layer fallback system)
- `likeCount` extraction
- `inReplyToStatusId` for reply chain tracking
- Raw API response access (`--json-full`)

**xc only:**
- Streaming (filtered real-time stream with rules)
- Direct Messages (send/list/history)
- Follow/unfollow, like/unlike, delete post
- Multi-account support (named accounts)
- Cost tracking per API call (JSONL log)
- Budget enforcement with password lock (scrypt hashing)
- Full-archive search (Pro plan)
- Thread creation (`--thread` flag)

**Dewey only:**
- Real-time bookmark detection (webRequest interception)
- Multi-platform support (8+ social networks)
- Cloud sync to getdewey.co
- Thread save preferences (Prompt/Auto/NoPrompt)
- `is_self_thread` flag from X's native API field
- `sort_order` for timeline position
- User engagement metrics (followers_count, friends_count, favourites_count)
- Delta sync (stops at previously-imported tweets)

---

## Authentication Comparison

| Aspect | Bird | xc | Dewey |
|--------|------|-----|-------|
| **Method** | Cookie extraction from browser DBs | OAuth 2.0 PKCE via XDK | Passive interception from live requests |
| **Setup** | Zero (just have a logged-in browser) | Developer Portal app + OAuth flow | Install extension + login to dewey.co |
| **Token refresh** | Manual (re-extract if expired) | Automatic (within 60s of expiry) | Automatic (captured as user browses) |
| **Multi-account** | -- | Full support (named accounts) | -- |
| **Storage** | Runtime only (or config file) | `~/.xc/config.json` | `chrome.storage.local` |
| **Scopes** | Full web session (everything the browser can do) | Explicit scopes requested at login | Full web session |

### How Authentication Works

| Aspect | Bird | xc | Dewey |
|--------|------|-----|-------|
| **Token Source** | Extracts `auth_token` and `ct0` cookies from browser databases | OAuth 2.0 PKCE flow via XDK SDK | Intercepts from live requests via `webRequest.onSendHeaders` |
| **Token Storage** | Passed at runtime or from config file | `~/.xc/config.json` | `chrome.storage.local` |
| **Token Refresh** | Manual (re-extract if expired) | Automatic (within 60s of expiry via `getClient()`) | Automatic (passively captured as user browses) |
| **CSRF Token** | Extracted from cookies | Not needed (OAuth) | Intercepted from request headers |

### GraphQL Query ID Handling

| Aspect | Bird | xc | Dewey |
|--------|------|-----|-------|
| **ID Source** | Three-layer: runtime cache -> baked-in -> fallback | N/A (uses official REST API) | Captured from live requests via URL interception |
| **On 404** | Auto-discovers new IDs from x.com JS bundles | N/A | Uses whatever ID the browser is using (always current) |
| **Maintenance** | Requires update mechanism | N/A | Self-maintaining (browser always has current IDs) |

---

## Cost & Sustainability

| | Bird | xc | Dewey |
|--|------|-----|-------|
| **API cost** | $0 (web scraping) | Pay-per-use ($100/mo Basic, $5000/mo Pro) | $0 (web session) |
| **Risk** | Account suspension, breakage | Rate limits, API costs | Account suspension |
| **Cost tracking** | -- | Built-in JSONL logging + budget enforcement | -- |
| **Stability** | Low (undocumented API) | High (official, versioned) | Medium (piggybacking on live session) |

xc's cost tracking is a sophisticated system: a Proxy-based interception means command authors never think about cost -- it's handled at the infrastructure layer. The budget system with password-protected locks (scrypt hashing) prevents accidental overruns, especially valuable when used by AI agents or in automation pipelines.

---

## CLI Design Philosophy

| | Bird | xc |
|--|------|-----|
| **Framework** | Commander.js | Commander.js |
| **Entry** | `src/cli.ts` -> `src/cli/program.ts` | `src/cli.ts` |
| **Output** | `--json`, `--json-full`, `--plain` | `--json`, `--quiet` |
| **Global opts** | `--auth-token`, `--ct0`, `--cookie-source`, `--timeout` | `--quiet`, `--account` |
| **stdout vs stderr** | Mixed | Strict separation (data->stdout, diagnostics->stderr) |

xc follows a stricter Unix philosophy: data goes to stdout, everything else (cost footer, progress, diagnostics) goes to stderr. This makes xc easier to pipe and script. Bird mixes output channels, though `--plain` helps.

---

## Testing Approaches

| | Bird | xc | Dewey |
|--|------|-----|-------|
| **Framework** | Vitest | Vitest | -- |
| **Coverage** | 90% statements/lines/functions, 80% branches | No explicit thresholds | -- |
| **Test isolation** | Standard mocking | `vi.resetModules()` + temp dirs + dynamic `import()` | -- |
| **Live tests** | `BIRD_LIVE=1` for real API calls | -- | -- |

xc's testing pattern is notable: because config/cost modules bind `XC_CONFIG_DIR` at module level, each test creates a temp directory, sets the env var, resets modules, and dynamically re-imports. This ensures complete filesystem isolation.

---

## Where Each Tool Excels

### Bird Wins At:
- **Thread analysis** -- `--author-chain`, `--author-only`, `--full-chain-only` are unmatched
- **Bookmark expansion** -- Fetches thread context per bookmark with caching and dedup
- **News/Trending** -- AI-curated news from Explore tabs
- **No cost** -- Free to use (with associated risks)
- **GraphQL query ID auto-recovery** -- Three-layer fallback system

### xc Wins At:
- **Official API stability** -- Won't break when X changes internal endpoints
- **Write operations** -- Post, delete, like, follow, DM, thread creation all via official API
- **Streaming** -- Real-time filtered stream (Bird and Dewey can't do this)
- **DMs** -- Only tool with DM support
- **Cost awareness** -- Per-request cost tracking, budgets, spending limits
- **Multi-account** -- Named accounts with automatic token refresh
- **Full-archive search** -- Access to complete tweet history (Pro plan)

### Dewey Wins At:
- **Zero-friction auth** -- Credentials captured passively
- **Real-time sync** -- Instant bookmark capture as you browse
- **Multi-platform** -- 8+ social networks (X, Bluesky, LinkedIn, Reddit, etc.)
- **Cloud organization** -- Search/organize via getdewey.co
- **Always-current query IDs** -- Uses whatever the browser uses

---

## Complementary Usage Scenarios

These tools aren't competitors -- they serve different niches:

| Use Case | Best Tool |
|----------|-----------|
| Read threads with full context | **Bird** |
| Post tweets / threads safely | **xc** |
| Real-time bookmark sync | **Dewey** |
| Search tweets (free) | **Bird** |
| Search tweets (reliable, archive) | **xc** |
| Manage follows/lists/likes | **xc** |
| Send/read DMs programmatically | **xc** |
| Stream tweets in real-time | **xc** |
| Bulk export bookmarks with thread expansion | **Bird** |
| Multi-platform bookmark collection | **Dewey** |
| Cost-controlled automation | **xc** (with budget enforcement) |
| AI agent integration (with guardrails) | **xc** (budget locks prevent runaway) |
| News and trending analysis | **Bird** |

---

## Deep Dive: Thread Handling

### What is a "Thread"? Three Different Answers

The most fundamental difference is that each tool **defines "thread" differently**:

| | Bird | xc | Dewey |
|--|------|-----|-------|
| **Definition** | All tweets sharing the same `conversationId` (full conversation, all participants) | A sequence of posts you create via `--thread` (write-only concept) | Consecutive self-replies by the same author (`owner_id` matching) |
| **Scope** | Read + analyze | Write only | Read + sync to cloud |
| **Includes other authors** | Yes | N/A | No -- `break`s at first non-author reply |

These aren't just implementation differences -- they reflect fundamentally different mental models:
- **Bird** thinks of threads as *conversations* (the discussion graph)
- **xc** thinks of threads as *publications* (a multi-part post you author)
- **Dewey** thinks of threads as *monologues* (one author's continuous chain)

---

### Bird: Full Conversation Graph

#### Core Mechanism

Bird's thread model is built on X's `conversationId` field -- a value in every tweet's `legacy` object that points to the root tweet of its conversation. All tweets in a conversation share this ID.

**From `src/lib/twitter-client-tweet-detail.ts:353-374`:**
```typescript
async getThread(tweetId, options): Promise<SearchResult> {
    const response = await this.fetchTweetDetail(tweetId);
    const tweets = parseTweetsFromInstructions(instructions, ...);

    // Find root by looking at the target tweet's conversationId
    const target = tweets.find((t) => t.id === tweetId);
    const rootId = target?.conversationId || tweetId;

    // Filter ALL tweets that belong to this conversation
    const thread = tweets.filter((tweet) => tweet.conversationId === rootId);
    thread.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
```

This returns everything -- root, all replies by all authors, nested sub-conversations -- as long as they share the same `conversationId`.

#### The Reply Chain Data Model

Bird extracts two critical fields from every tweet via `mapTweetResult()` in `src/lib/twitter-client-utils.ts`:

```typescript
conversationId: result.legacy?.conversation_id_str,           // "which conversation?"
inReplyToStatusId: result.legacy?.in_reply_to_status_id_str,  // "replying to whom?"
```

Together these form a tree structure: `conversationId` groups tweets into conversations, and `inReplyToStatusId` creates parent->child edges.

#### Five Thread Filtering Strategies

Bird's real power is in `src/lib/thread-filters.ts` -- five distinct algorithms that slice the conversation tree differently:

##### 1. `filterAuthorChain()` -- Connected Self-Reply Chain

Walks **up** from the bookmarked tweet through `inReplyToStatusId` while the author matches, then walks **down** collecting self-replies. Uses iterative forward passes until no new tweets are added.

```
Thread:
  [Alice] Root          <- included (walk up)
    +--[Alice] Reply    <- included (walk up)
        +--[Bob] Reply  <- EXCLUDED (different author)
        +--[Alice]      <- BOOKMARKED
            +--[Alice]  <- included (walk down)
```

Result: `[Root, Reply, Bookmarked, Child]` -- only Alice's connected chain.

##### 2. `filterAuthorOnly()` -- All Author Tweets

Simple filter: include any tweet where `author.username === bookmarkedTweet.author.username`. Catches disconnected author tweets that `filterAuthorChain` misses.

##### 3. `filterFullChain()` -- Ancestor + Descendant Tree

Walks up to all ancestors, then recursively walks down to all descendants. All authors included. With `--include-ancestor-branches`: also includes sibling branches of ancestors.

##### 4. `--expand-root-only` -- Conditional Expansion

Only fetches the thread if the bookmarked tweet is the root (no `inReplyToStatusId`). Mid-thread bookmarks stay unexpanded.

##### 5. `--include-parent` -- Direct Parent Addition

Always includes the direct parent tweet, even if it's by a different author. Fetches it separately if not in the thread cache.

#### Thread Metadata Enrichment

`addThreadMetadata()` in `src/lib/thread-filters.ts:120-146` computes per-tweet position:

| Field | Type | Values |
|-------|------|--------|
| `isThread` | boolean | Has self-replies OR is a reply |
| `threadPosition` | string | `root`, `middle`, `end`, `standalone` |
| `hasSelfReplies` | boolean | Author replied to this tweet |
| `threadRootId` | string/null | The `conversationId` |

Position rules:
- **`standalone`**: No parent + no self-replies
- **`root`**: No parent + has self-replies
- **`middle`**: Has parent + has self-replies
- **`end`**: Has parent + no self-replies

#### Thread Expansion in Bookmarks

The bookmarks command (`src/commands/bookmarks.ts`) has the most sophisticated thread logic:

**Thread Cache** (prevents duplicate fetches):
```typescript
const threadCache = new Map<string, TweetData[]>();
// Key: conversationId -> Value: all tweets in that conversation
```

If two bookmarks share the same conversation, the thread is fetched once.

**Rate Limiting**: 1-second delay between thread expansions.

**Deduplication**: After expansion, `new Map(tweets.map(t => [t.id, t])).values()` removes duplicates from overlapping threads.

**Pagination interaction**: Bookmarks are paginated first, then each page's bookmarks are expanded. The thread cache persists across pages.

#### Edge Case Handling

| Edge Case | Bird's Behavior |
|-----------|----------------|
| Deleted tweet in thread | Skipped during parsing (no `tweetResult`) |
| Suspended account | Tweet skipped if user data is missing |
| `TweetWithVisibilityResults` | Unwrapped -- extracts inner tweet |
| Parent not in API response | Fetched separately with `client.getTweet()` when `--include-parent` used |
| GraphQL 404 | Auto-refreshes query IDs, retries with fallback IDs |

---

### xc: Write-Only Thread Creation

#### What xc Can Do

xc can **create** threads but cannot **read** them. The `--thread` flag in `src/commands/post.ts` chains multiple posts:

```typescript
const allTexts = [text, ...threadTexts];  // ["First", "Second", "Third"]

for (let i = 0; i < allTexts.length; i++) {
    const body = { text: allTexts[i] };
    if (replyToId) {
        body.reply = { inReplyToTweetId: replyToId };
    }
    const result = await client.posts.create(body);
    replyToId = postId;  // Chain: each post replies to the previous
}
```

Usage: `xc post "First" --thread "Second" "Third"`

#### What xc Cannot Do

| Thread Capability | Status | Why |
|-------------------|--------|-----|
| Read a thread by ID | No | No command exists |
| Show `conversationId` | No | Never requested in `TWEET_FIELDS` |
| Show `inReplyToStatusId` | No | Only used internally for posting |
| Expand bookmarks into threads | No | Bookmarks listed flat |
| Filter by author chain | No | No thread analysis code |
| Thread metadata | No | No concept of thread position |

#### What the X API v2 Could Provide (But xc Ignores)

The official API does expose thread-related fields:
- `conversation_id` -- available as a requestable tweet field
- `in_reply_to_user_id` -- who this tweet replies to
- `referenced_tweets` -- array of `{type: "replied_to"|"quoted", id}` objects

xc's `TWEET_FIELDS` across all commands only requests `["created_at", "public_metrics", "author_id"]` -- never conversation or reply fields.

This is a deliberate design choice. Thread *reading* via the official API would require expensive search queries like `conversation_id:12345` -- each call costs money. The GraphQL `TweetDetail` endpoint that Bird uses returns the entire conversation tree in one call for free. xc's cost-conscious architecture makes free-form thread analysis impractical.

**The fundamental tradeoff: Bird gets threads for free but risks breakage; xc would have to pay per query but gets stability.**

---

### Dewey: Author's Self-Thread Only

#### Core Mechanism

Dewey's thread detection is in `scripts/grabber/x/factory.js` and uses `owner_id` matching on the GraphQL response's entry structure.

**From `factory.js:655-690` (`parseTweetsOfThread`):**
```javascript
// Step 1: Get the root tweet author's internal ID
const owner_id = base_path.tweet?.core.user_results.result.rest_id
              || base_path.core.user_results.result.rest_id;

// Step 2: Filter entries to only "conversationthread-*" where FIRST tweet is by owner
const entries = tmp.entries.filter(e =>
    e.entryId.startsWith('conversationthread-') &&
    first_tweet_user_id == owner_id
);

// Step 3: Collect tweets, BREAK at first non-author tweet
for (let entry of entries) {
    for (let item of entry.content.items) {
        if (item_user_id == owner_id) {
            threads.push(await _parseSpecificTweet(item));
        } else {
            break;  // <-- THE CRITICAL LINE
        }
    }
}
```

#### The `break` Statement: Dewey's Defining Characteristic

That `break` is the single most important line for understanding Dewey's thread model. Consider this thread:

```
[Alice] "Here's my analysis..."        <- Root
  +--[Alice] "First, consider..."      <- Self-reply
      +--[Alice] "Second..."           <- Self-reply
          +--[Bob] "Great point!"      <- DIFFERENT AUTHOR
              +--[Alice] "Thanks Bob!" <- Alice replies to Bob
```

| Tool | Tweets Returned |
|------|----------------|
| **Bird** `getThread()` | All 5 tweets (full conversation) |
| **Bird** `--author-chain` | Alice's root + 2 self-replies (connected chain only) |
| **Bird** `--author-only` | All 4 Alice tweets (including disconnected "Thanks Bob!") |
| **Dewey** | Root + 2 self-replies only (stops at Bob, never sees "Thanks Bob!") |
| **xc** | Cannot read threads at all |

Dewey's `break` means it can lose author tweets that follow a reply from someone else. Bird's `filterAuthorChain` has the same limitation (connected chain only), but Bird's `filterAuthorOnly` catches these disconnected responses. Dewey has no equivalent.

#### Thread Save Modes

Dewey offers three user-configurable behaviors (`global.js:36-40`):

| Mode | Value | Behavior |
|------|-------|----------|
| `Prompt` | 0 | Popup asks "Do you want to save the entire thread?" |
| `Auto` | 1 | Thread automatically saved alongside bookmark |
| `NoPrompt` | 2 | Only the single bookmarked tweet is saved |

Bird and xc have no equivalent -- Bird always returns whatever you ask for; there's no preference system.

#### No Reply Chain Walking

Dewey does not walk the reply chain. It uses the TweetDetail API response's pre-structured `conversationthread-*` entries. The API already groups tweets into conversation threads -- Dewey just filters them by `owner_id`.

Bird also doesn't walk the chain for `getThread()` (it uses `conversationId` filtering on the same API response), but Bird's `filterAuthorChain` in `thread-filters.ts` **does** walk `inReplyToStatusId` pointers up and down to build the connected chain.

#### Quoted Tweet Handling in Threads

| Context | Dewey's Approach | Bird's Approach |
|---------|------------------|-----------------|
| **Real-time bookmark** | Extra API call per quoted tweet | Inline `quoted_status_result` only |
| **Bulk scrape** | Inline data only (may be truncated) | Inline `quoted_status_result` only |
| **Depth control** | No limit (1 level in practice) | Configurable `--quote-depth` (default: 1) |

#### The `is_self_thread` Flag

Dewey captures X's native `self_thread` property from the GraphQL response:

```javascript
is_self_thread: !!tweet.self_thread  // From legacy.self_thread in API response
```

This is a boolean X sets internally on tweets that are part of the author's self-thread. Bird doesn't use this field -- it computes thread membership from `conversationId` and `inReplyToStatusId` instead.

---

### Side-by-Side Thread Comparison

#### Data Fields

| Field | Bird | xc | Dewey |
|-------|------|-----|-------|
| `conversationId` | Extracted and used for grouping | Never requested | Extracted as `conversation_id` |
| `inReplyToStatusId` | Extracted and used for chain walking | Used only when posting | Not exposed |
| `is_self_thread` | Not used | Not available | Extracted from API |
| `threadPosition` | Computed (`root`/`middle`/`end`/`standalone`) | N/A | N/A |
| `hasSelfReplies` | Computed per-tweet | N/A | N/A |
| `threadRootId` | Set to `conversationId` | N/A | N/A |
| `sort_order` | N/A | N/A | Extracted (timeline position) |

#### Capabilities Matrix

| Capability | Bird | xc | Dewey |
|-----------|------|-----|-------|
| Fetch full conversation | `bird thread <id>` | -- | -- |
| Fetch author's self-thread | `--author-chain` on bookmarks | -- | `parseTweetsOfThread()` |
| Fetch all author tweets in convo | `--author-only` on bookmarks | -- | -- |
| Fetch ancestor+descendant tree | `--full-chain-only` on bookmarks | -- | -- |
| Post a multi-part thread | -- | `xc post --thread` | -- |
| Thread position metadata | `--thread-meta` | -- | -- |
| Thread save preference | -- | -- | Prompt/Auto/NoPrompt |
| Thread caching (avoid re-fetch) | `threadCache` Map by conversationId | -- | -- |
| Paginate through long threads | `--all --max-pages` | -- | -- |
| Direct parent inclusion | `--include-parent` | -- | -- |
| Real-time thread detection | -- | -- | On bookmark action via webRequest |

---

### Thread Algorithm Walkthrough

Given this thread structure:

```
[A1] Alice: "Let me explain..."           (root, conversationId=A1)
  +--[A2] Alice: "Point one..."           (reply to A1)
  |   +--[A3] Alice: "Point two..."       (reply to A2)
  |       +--[B1] Bob: "Interesting!"     (reply to A3)
  |           +--[A4] Alice: "Thanks!"    (reply to B1)
  +--[C1] Carol: "I disagree"             (reply to A1)
      +--[A5] Alice: "Here's why..."      (reply to C1)
```

**If A3 is the bookmarked tweet:**

| Tool / Mode | Tweets Returned | Count |
|-------------|----------------|-------|
| Bird `getThread()` | A1, A2, A3, B1, A4, C1, A5 | 7 |
| Bird `--author-chain` | A1, A2, A3 | 3 |
| Bird `--author-only` | A1, A2, A3, A4, A5 | 5 |
| Bird `--full-chain-only` | A1, A2, A3, B1, A4 | 5 |
| Bird `--full-chain-only --include-ancestor-branches` | A1, A2, A3, B1, A4, C1, A5 | 7 |
| Dewey `parseTweetsOfThread` | A2, A3 (stops at B1, skips A4) | 2 |
| xc | Cannot read threads | 0 |

**Key takeaway:** For the same bookmarked tweet, Bird can return anywhere from 3 to 7 tweets depending on flags, while Dewey always returns the narrowest possible slice (2 tweets). xc returns nothing.

#### Thread Metadata Output (Bird Only)

With `--thread-meta`, each tweet in the above example gets annotated:

| Tweet | `isThread` | `threadPosition` | `hasSelfReplies` | `threadRootId` |
|-------|-----------|-------------------|-------------------|----------------|
| A1 | true | root | true (A2 replies) | A1 |
| A2 | true | middle | true (A3 replies) | A1 |
| A3 | true | end | false | A1 |
| B1 | true | end | false | A1 |
| A4 | true | end | false | A1 |
| C1 | true | end | false | A1 |
| A5 | true | end | false | A1 |

---

### Architectural Implications

#### Why These Differences Exist

| Tool | Primary Use Case | Thread Consequence |
|------|-----------------|-------------------|
| **Bird** | Developer data extraction | Needs maximum flexibility -> 5 filter modes, metadata, caching |
| **xc** | Official API operations | Thread reading is expensive via paid API -> write-only threads |
| **Dewey** | Consumer bookmark sync | Needs clean author threads for organization -> narrow self-thread extraction |

#### What Each Could Learn From the Others

- **xc** could add `conversation_id` and `referenced_tweets` to its `TWEET_FIELDS` cheaply (no extra API calls, just requesting more fields on existing calls). This would at least expose thread context in output.
- **Bird** could adopt Dewey's `is_self_thread` field from the API response as a quick heuristic before doing expensive `filterAuthorChain` computation.
- **Dewey** could adopt Bird's `filterAuthorOnly` approach to catch disconnected author tweets after the `break`.

---

## Summary

| Dimension | Bird | xc | Dewey | Winner (context-dependent) |
|-----------|------|-----|-------|---------------------------|
| **Ease of setup** | Requires cookie extraction | Developer Portal + OAuth | Just install extension | Dewey |
| **Auth maintenance** | Manual if cookies expire | Automatic token refresh | Automatic | xc / Dewey |
| **API stability** | Low (undocumented GraphQL) | High (official v2) | Medium (live session) | xc |
| **Thread reading** | Full conversation + 5 filters | Not supported | Author self-thread only | Bird |
| **Thread writing** | -- | `--thread` flag | -- | xc |
| **Thread metadata** | `isThread`, `threadPosition`, etc. | -- | `is_self_thread` | Bird |
| **Real-time capture** | Not supported | Not supported | Built-in | Dewey |
| **Ad-hoc queries** | Full CLI support | Full CLI support | Not supported | Bird / xc |
| **Local-first** | Yes (no external deps) | Yes (no external deps) | No (requires server) | Bird / xc |
| **Search** | Yes (free, GraphQL) | Yes (paid, official) | No | Bird (free) / xc (reliable) |
| **Post/reply** | Yes (fragile) | Yes (official) | No | xc |
| **DMs** | No | Yes | No | xc |
| **Streaming** | No | Yes (filtered stream) | No | xc |
| **Multi-platform** | X only | X only | 8+ platforms | Dewey |
| **Cost tracking** | -- | Full (JSONL + budget) | -- | xc |
| **Scripting/automation** | Designed for it | Designed for it | Not supported | Bird / xc |

**Bottom line:**
- **Bird** = power tool for developers who want deep thread analysis and free on-demand data extraction
- **xc** = the "do it right" tool for official API operations, posting, streaming, DMs, with cost guardrails
- **Dewey** = consumer tool for automatic multi-platform bookmark sync to the cloud
