# Thread Retrieval & Bookmark Thread Expansion Guide

> **Generated:** 2026-02-02
> **Purpose:** Usage documentation for `bird thread` and bookmark thread expansion flags
> **Audience:** Developers integrating bird into other programs

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [The `thread` Command](#the-thread-command)
3. [Bookmark Thread Expansion](#bookmark-thread-expansion)
4. [Default Behavior (No Flags)](#default-behavior-no-flags)
5. [Thread Filtering Flags](#thread-filtering-flags)
6. [Programmatic Usage Examples](#programmatic-usage-examples)
7. [JSON Schema for Thread Data](#json-schema-for-thread-data)
8. [Important Caveats](#important-caveats)
9. [Integration Guide: Downloading Bookmarked Tweet Threads](#integration-guide-downloading-bookmarked-tweet-threads)

---

## Quick Reference

```bash
# Thread command - fetches FULL conversation (all participants)
bird thread <tweet-id-or-url> --json

# Bookmarks - NO thread expansion by default (just the bookmarked tweets)
bird bookmarks --json

# Bookmarks with author self-thread chain
bird bookmarks --author-chain --json

# Bookmarks with all author tweets in thread
bird bookmarks --author-only --json
```

---

## The `thread` Command

### Basic Usage

```bash
bird thread <tweet-id-or-url> [options]
```

### What It Does

The `thread` command fetches the **full conversation thread** containing a tweet. This includes:

- The target tweet
- All ancestor tweets (parents going back to the conversation root)
- **All replies from ALL participants** (not just the original author)

### Implementation Detail

From `src/lib/twitter-client-tweet-detail.ts:353-374`:

```typescript
// 1. Fetch TweetDetail GraphQL endpoint
const response = await this.fetchTweetDetail(tweetId);

// 2. Parse ALL tweets from the response
const tweets = parseTweetsFromInstructions(instructions, { quoteDepth, includeRaw });

// 3. Filter by conversationId (includes ALL participants)
const target = tweets.find((t) => t.id === tweetId);
const rootId = target?.conversationId || tweetId;
const thread = tweets.filter((tweet) => tweet.conversationId === rootId);

// 4. Sort chronologically
thread.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
```

### Options

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON array |
| `--json-full` | Include raw GraphQL response in `_raw` field |
| `--all` | Paginate through long threads |
| `--max-pages <n>` | Limit pagination to N pages |
| `--cursor <string>` | Resume from a previous pagination cursor |
| `--delay <ms>` | Delay between page fetches (default: 1000ms) |

### Example Output (JSON)

```bash
bird thread 1234567890 --json
```

```json
{
  "tweets": [
    {
      "id": "1234567890",
      "text": "This is the start of my thread...",
      "author": { "username": "alice", "name": "Alice" },
      "conversationId": "1234567890",
      "createdAt": "2026-01-15T10:00:00.000Z"
    },
    {
      "id": "1234567891",
      "text": "Thread continues here (self-reply)",
      "author": { "username": "alice", "name": "Alice" },
      "conversationId": "1234567890",
      "inReplyToStatusId": "1234567890",
      "createdAt": "2026-01-15T10:01:00.000Z"
    },
    {
      "id": "1234567899",
      "text": "Random person's reply is ALSO included",
      "author": { "username": "bob", "name": "Bob" },
      "conversationId": "1234567890",
      "inReplyToStatusId": "1234567890",
      "createdAt": "2026-01-15T10:05:00.000Z"
    }
  ]
}
```

### Key Limitation

**There is no `--author-only` flag for `bird thread`.** To get only the author's self-thread, you must:
1. Use `bird thread --json` and post-process, OR
2. Use bookmarks with `--author-chain` (if the tweet is bookmarked)

---

## Bookmark Thread Expansion

### Default Behavior (No Flags)

**By default, `bird bookmarks` does NOT expand threads.** It returns only the bookmarked tweets themselves.

```bash
bird bookmarks --json
```

Returns:
```json
{
  "tweets": [
    { "id": "111", "text": "Bookmarked tweet 1", ... },
    { "id": "222", "text": "Bookmarked tweet 2", ... }
  ]
}
```

**No thread context is fetched.** Each bookmark is returned as a standalone tweet.

### When Thread Expansion Occurs

Thread expansion is triggered by ANY of these flags:

| Flag | Effect |
|------|--------|
| `--expand-root-only` | Expand threads only when bookmark is the conversation root |
| `--author-chain` | Expand and filter to author's connected self-reply chain |
| `--author-only` | Expand and filter to all author tweets in thread |
| `--full-chain-only` | Expand and keep entire reply chain connected to bookmark |
| `--thread-meta` | Fetch thread to compute metadata (doesn't expand output) |

From `src/commands/bookmarks.ts:129-131`:

```typescript
const shouldAttemptExpand =
  expandRootOnly || filterAuthorChainFlag || filterAuthorOnlyFlag || filterFullChainFlag;
const shouldFetchThread = shouldAttemptExpand || includeMeta;
```

---

## Thread Filtering Flags

### `--author-chain` (Most Likely What You Want)

Returns only the **connected self-reply chain** by the bookmarked tweet's author.

**Algorithm** (from `src/lib/thread-filters.ts:10-47`):

1. Start at the bookmarked tweet
2. Walk UP the reply chain, collecting tweets by the same author
3. Stop when hitting a tweet by a different author
4. Walk DOWN from the bookmarked tweet, collecting self-replies by the author
5. Return all collected tweets, sorted chronologically

**Example:**

```
Thread structure:
  [A] Root by Alice           ← included (author chain continues)
    └─[B] Reply by Alice      ← included (author chain continues)
        └─[C] Reply by Bob    ← NOT included (different author)
        └─[D] Reply by Alice  ← included (same author, reply to B)
            └─[E] Reply by Alice ← included (self-reply chain)
```

If tweet D is bookmarked with `--author-chain`:
- Included: A, B, D, E
- Excluded: C (different author)

```bash
bird bookmarks --author-chain --json
```

### `--author-only`

Returns **all tweets by the bookmarked author** within the thread, regardless of position.

**Algorithm** (from `src/lib/thread-filters.ts:49-52`):

```typescript
const author = bookmarkedTweet.author.username;
return tweets.filter((tweet) => tweet.author.username === author);
```

**Key Difference from `--author-chain`:**
- `--author-chain`: Only tweets in a **connected** self-reply chain
- `--author-only`: **All** author tweets, even if disconnected in the thread

**Example:**

```
Thread structure:
  [A] Root by Alice
    └─[B] Reply by Bob
        └─[C] Reply by Alice   ← disconnected from A
    └─[D] Reply by Alice       ← connected to A
```

With `--author-only`: A, C, D all included
With `--author-chain` (if D is bookmarked): Only A, D included (C is disconnected)

### `--full-chain-only`

Returns the **entire reply chain** connected to the bookmarked tweet (all authors).

**Algorithm** (from `src/lib/thread-filters.ts:54-118`):

1. Start at bookmarked tweet
2. Walk UP to collect all ancestors
3. Walk DOWN from bookmarked tweet to collect all descendants
4. Optionally include sibling branches with `--include-ancestor-branches`

```bash
bird bookmarks --full-chain-only --json
bird bookmarks --full-chain-only --include-ancestor-branches --json
```

### `--expand-root-only`

Only expand threads when the bookmarked tweet is the **root** (has no parent).

```bash
bird bookmarks --expand-root-only --author-chain --json
```

If you bookmark a mid-thread reply, it won't be expanded - only root tweets get expansion.

### `--include-parent`

Always include the **direct parent** tweet, even if it's by a different author.

```bash
bird bookmarks --author-chain --include-parent --json
```

Useful for context when the bookmark is a reply.

---

## Additional Flags

### `--thread-meta`

Adds metadata fields to each tweet indicating its position in the thread:

```bash
bird bookmarks --thread-meta --json
```

```json
{
  "id": "123",
  "text": "...",
  "isThread": true,
  "threadPosition": "root",
  "hasSelfReplies": true,
  "threadRootId": "123"
}
```

| Field | Type | Values |
|-------|------|--------|
| `isThread` | boolean | Tweet is part of a thread |
| `threadPosition` | string | `"root"`, `"middle"`, `"end"`, `"standalone"` |
| `hasSelfReplies` | boolean | Author has replied to this tweet |
| `threadRootId` | string | Conversation root tweet ID |

### `--sort-chronological`

Sort all output tweets oldest-to-newest globally (default preserves bookmark order).

```bash
bird bookmarks --author-chain --sort-chronological --json
```

---

## Programmatic Usage Examples

### From Another Program (Shell)

```bash
# Get all bookmarks with author self-threads expanded
bird bookmarks --all --author-chain --json > bookmarks.json

# Process with jq
bird bookmarks --author-chain --json | jq '.tweets[] | select(.threadPosition == "root")'
```

### Filtering Author Self-Thread from `bird thread` Output

Since `bird thread` doesn't have `--author-only`, post-process:

```bash
# Get thread, filter to author's tweets only
bird thread 1234567890 --json | jq '
  .tweets as $all |
  ($all[0].author.username) as $author |
  { tweets: [$all[] | select(.author.username == $author)] }
'
```

### Rate Limiting Considerations

When expanding threads, bird makes additional API calls. There's a built-in 1-second delay between expansions:

```typescript
const delayBetweenExpansionsMs = 1000;
```

For bulk operations, use `--max-pages` to limit:

```bash
bird bookmarks --all --max-pages 5 --author-chain --json
```

---

## JSON Schema for Thread Data

### TweetData (Standard Output)

```typescript
interface TweetData {
  id: string;
  text: string;
  author: {
    username: string;
    name: string;
  };
  authorId?: string;
  createdAt?: string;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  conversationId?: string;      // Thread root ID
  inReplyToStatusId?: string;   // Parent tweet ID (if reply)
  quotedTweet?: TweetData;      // Nested quote (depth-limited)
  media?: TweetMedia[];
  _raw?: object;                // With --json-full only
}
```

### TweetWithMeta (With `--thread-meta`)

```typescript
interface TweetWithMeta extends TweetData {
  isThread: boolean;
  threadPosition: 'root' | 'middle' | 'end' | 'standalone';
  hasSelfReplies: boolean;
  threadRootId: string | null;
}
```

### Paginated Response

When using `--all`, `--cursor`, or `--max-pages`:

```json
{
  "tweets": [...],
  "nextCursor": "cursor-string-for-resume"
}
```

---

## Important Caveats

### 1. Thread Expansion Makes Additional API Calls

Each bookmarked tweet triggers a separate `TweetDetail` call when expansion flags are used. For 100 bookmarks, that's 100 additional API requests (with 1s delays).

### 2. Thread Cache Prevents Duplicate Fetches

If multiple bookmarks are in the same conversation, the thread is fetched once and cached:

```typescript
const threadCache = new Map<string, TweetData[]>();
```

### 3. `--author-chain` vs `--author-only` Decision Guide

| Use Case | Recommended Flag |
|----------|------------------|
| "Get the author's complete self-thread" | `--author-chain` |
| "Get all tweets by this author in conversation" | `--author-only` |
| "Author started thread, others replied, author replied to them" | `--author-only` captures disconnected responses |

### 4. No Thread Filtering in `bird thread` Command

The `thread` command has NO equivalent to `--author-chain` or `--author-only`. You must:
- Post-process the JSON output, OR
- Use bookmarks with these flags

### 5. Conversation ID is Key

The `conversationId` field identifies which thread a tweet belongs to. It equals the root tweet's ID. This is how bird groups tweets into threads.

---

## Summary: Flag Behavior Matrix

| Flags | Threads Fetched? | What's Returned |
|-------|------------------|-----------------|
| (none) | No | Bookmarked tweets only |
| `--thread-meta` | Yes | Bookmarked tweets + metadata |
| `--author-chain` | Yes | Author's connected self-reply chain |
| `--author-only` | Yes | All author's tweets in thread |
| `--full-chain-only` | Yes | Entire connected reply tree |
| `--expand-root-only` | Only for roots | Depends on other flags |
| `--include-parent` | If needed | Adds parent tweet |

---

## Related Files

- `src/commands/bookmarks.ts` - Bookmark command with expansion logic
- `src/commands/read.ts` - Thread command implementation
- `src/lib/thread-filters.ts` - Filter algorithms
- `src/lib/twitter-client-tweet-detail.ts` - Thread fetching logic
- `src/lib/twitter-client-types.ts` - TypeScript interfaces

---

## Integration Guide: Downloading Bookmarked Tweet Threads

This section is specifically for developers calling `bird` from another program to download bookmarked tweets with their author's self-threads.

### The Recommended Command

```bash
bird bookmarks --all --author-chain --json
```

**What this does:**
- `--all` — Fetches all bookmarks (paginated automatically)
- `--author-chain` — Expands each bookmark to include the author's connected self-reply chain
- `--json` — Outputs structured JSON for parsing

### Complete Integration Example

#### Basic: Fetch All Bookmarks with Threads

```bash
bird bookmarks --all --author-chain --json > bookmarks.json
```

**Output structure:**
```json
{
  "tweets": [
    {
      "id": "1234567890",
      "text": "Start of a thread I bookmarked",
      "author": { "username": "alice", "name": "Alice" },
      "conversationId": "1234567890",
      "createdAt": "2026-01-15T10:00:00.000Z"
    },
    {
      "id": "1234567891",
      "text": "Thread continues (author's self-reply)",
      "author": { "username": "alice", "name": "Alice" },
      "conversationId": "1234567890",
      "inReplyToStatusId": "1234567890",
      "createdAt": "2026-01-15T10:01:00.000Z"
    },
    {
      "id": "9999999999",
      "text": "Different bookmark, standalone tweet",
      "author": { "username": "bob", "name": "Bob" },
      "conversationId": "9999999999",
      "createdAt": "2026-01-16T08:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

#### With Pagination Control (Large Collections)

For large bookmark collections, control the pace with `--max-pages`:

```bash
# Fetch 5 pages at a time (roughly 100 bookmarks per batch)
bird bookmarks --all --max-pages 5 --author-chain --json
```

**Output includes a cursor for resumption:**
```json
{
  "tweets": [...],
  "nextCursor": "DAACCgACGd..."
}
```

**Resume from cursor:**
```bash
bird bookmarks --cursor "DAACCgACGd..." --max-pages 5 --author-chain --json
```

#### With Thread Position Metadata

Add `--thread-meta` to know each tweet's position in its thread:

```bash
bird bookmarks --all --author-chain --thread-meta --json
```

**Enhanced output:**
```json
{
  "tweets": [
    {
      "id": "1234567890",
      "text": "Start of a thread",
      "author": { "username": "alice", "name": "Alice" },
      "isThread": true,
      "threadPosition": "root",
      "hasSelfReplies": true,
      "threadRootId": "1234567890"
    },
    {
      "id": "1234567891",
      "text": "Thread continues",
      "author": { "username": "alice", "name": "Alice" },
      "inReplyToStatusId": "1234567890",
      "isThread": true,
      "threadPosition": "end",
      "hasSelfReplies": false,
      "threadRootId": "1234567890"
    }
  ]
}
```

**`threadPosition` values:**
| Value | Meaning |
|-------|---------|
| `root` | First tweet in thread, has self-replies |
| `middle` | Mid-thread, has self-replies following it |
| `end` | Last tweet in self-reply chain |
| `standalone` | Not part of a thread |

### Code Examples

#### Python

```python
import subprocess
import json

def get_bookmarks_with_threads(max_pages=None, cursor=None):
    """Fetch bookmarks with author self-threads expanded."""
    cmd = ["bird", "bookmarks", "--all", "--author-chain", "--json"]

    if max_pages:
        cmd.extend(["--max-pages", str(max_pages)])
    if cursor:
        cmd.extend(["--cursor", cursor])

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise Exception(f"bird failed: {result.stderr}")

    return json.loads(result.stdout)

def get_all_bookmarks_with_threads():
    """Paginate through all bookmarks."""
    all_tweets = []
    cursor = None

    while True:
        data = get_bookmarks_with_threads(max_pages=5, cursor=cursor)
        all_tweets.extend(data.get("tweets", []))

        cursor = data.get("nextCursor")
        if not cursor:
            break

    return all_tweets

# Group tweets by thread
def group_by_thread(tweets):
    """Group tweets by their conversationId (thread root)."""
    threads = {}
    for tweet in tweets:
        thread_id = tweet.get("conversationId", tweet["id"])
        if thread_id not in threads:
            threads[thread_id] = []
        threads[thread_id].append(tweet)

    # Sort each thread chronologically
    for thread_id in threads:
        threads[thread_id].sort(key=lambda t: t.get("createdAt", ""))

    return threads
```

#### Node.js / TypeScript

```typescript
import { execSync } from 'child_process';

interface Tweet {
  id: string;
  text: string;
  author: { username: string; name: string };
  conversationId?: string;
  inReplyToStatusId?: string;
  createdAt?: string;
  // With --thread-meta
  isThread?: boolean;
  threadPosition?: 'root' | 'middle' | 'end' | 'standalone';
  hasSelfReplies?: boolean;
  threadRootId?: string | null;
}

interface BookmarksResult {
  tweets: Tweet[];
  nextCursor?: string | null;
}

function getBookmarksWithThreads(options: {
  maxPages?: number;
  cursor?: string;
} = {}): BookmarksResult {
  const args = ['bird', 'bookmarks', '--all', '--author-chain', '--json'];

  if (options.maxPages) {
    args.push('--max-pages', String(options.maxPages));
  }
  if (options.cursor) {
    args.push('--cursor', options.cursor);
  }

  const output = execSync(args.join(' '), { encoding: 'utf-8' });
  return JSON.parse(output);
}

async function getAllBookmarksWithThreads(): Promise<Tweet[]> {
  const allTweets: Tweet[] = [];
  let cursor: string | undefined;

  do {
    const result = getBookmarksWithThreads({ maxPages: 5, cursor });
    allTweets.push(...result.tweets);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);

  return allTweets;
}
```

#### Shell Script

```bash
#!/bin/bash

# Fetch all bookmarks with author threads, handling pagination
OUTPUT_FILE="all_bookmarks.json"
TEMP_FILE=$(mktemp)
CURSOR=""

echo '{"tweets":[]}' > "$OUTPUT_FILE"

while true; do
    if [ -z "$CURSOR" ]; then
        RESULT=$(bird bookmarks --all --max-pages 5 --author-chain --json 2>/dev/null)
    else
        RESULT=$(bird bookmarks --cursor "$CURSOR" --max-pages 5 --author-chain --json 2>/dev/null)
    fi

    if [ $? -ne 0 ]; then
        echo "Error fetching bookmarks" >&2
        exit 1
    fi

    # Merge tweets into output file
    echo "$RESULT" | jq -s '.[0].tweets + .[1].tweets | {tweets: .}' "$OUTPUT_FILE" - > "$TEMP_FILE"
    mv "$TEMP_FILE" "$OUTPUT_FILE"

    # Get next cursor
    CURSOR=$(echo "$RESULT" | jq -r '.nextCursor // empty')

    if [ -z "$CURSOR" ]; then
        break
    fi

    echo "Fetched page, continuing with cursor..."
    sleep 1  # Be nice to the API
done

echo "Done! Saved to $OUTPUT_FILE"
TWEET_COUNT=$(jq '.tweets | length' "$OUTPUT_FILE")
echo "Total tweets: $TWEET_COUNT"
```

### Error Handling

**Exit codes:**
| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error (network, auth, API error) |
| `2` | Invalid usage (bad flags, invalid IDs) |

**Common errors to handle:**

```python
# Check stderr for error messages
result = subprocess.run(cmd, capture_output=True, text=True)

if result.returncode == 1:
    if "Missing required credentials" in result.stderr:
        # Auth issue - cookies expired or not configured
        raise AuthError("Twitter credentials not available")
    elif "429" in result.stderr:
        # Rate limited - back off and retry
        time.sleep(60)
        return retry()
    else:
        raise RuntimeError(f"bird error: {result.stderr}")
```

### Rate Limiting Considerations

1. **Thread expansion adds latency**: Each bookmarked tweet triggers a separate API call with a 1-second delay between calls.

2. **Estimate time for large collections**:
   - 100 bookmarks × 1 second delay = ~2 minutes
   - Plus network latency and processing

3. **Use `--max-pages` for controlled batching**:
   ```bash
   # Process in chunks, allowing your program to checkpoint
   bird bookmarks --max-pages 3 --author-chain --json
   ```

4. **The `nextCursor` allows resumption** if your process is interrupted.

### Deduplication

Bird automatically deduplicates tweets in the output. If multiple bookmarks are in the same thread, each tweet appears only once:

```typescript
// From src/commands/bookmarks.ts:222
const uniqueTweets = Array.from(
  new Map(finalResults.map((tweet) => [tweet.id, tweet])).values()
);
```

### Choosing the Right Flags for Your Use Case

| Goal | Command |
|------|---------|
| Just bookmarked tweets (no threads) | `bird bookmarks --all --json` |
| Bookmarks + author's self-thread | `bird bookmarks --all --author-chain --json` |
| Bookmarks + all author tweets in conversation | `bird bookmarks --all --author-only --json` |
| Bookmarks + entire reply tree | `bird bookmarks --all --full-chain-only --json` |
| Add thread position metadata | Add `--thread-meta` to any above |
| Chronological order (oldest first) | Add `--sort-chronological` |
| Include parent for context | Add `--include-parent` |

### Using as a Library (TypeScript/JavaScript)

Instead of shelling out, you can import bird directly:

```typescript
import { TwitterClient, resolveCredentials } from '@steipete/bird';
import { filterAuthorChain } from '@steipete/bird/lib/thread-filters';

async function getBookmarksWithAuthorThreads() {
  const { cookies } = await resolveCredentials({ cookieSource: 'safari' });
  const client = new TwitterClient({ cookies });

  // Get all bookmarks
  const bookmarksResult = await client.getAllBookmarks({ includeRaw: false });
  if (!bookmarksResult.success) throw new Error(bookmarksResult.error);

  const expandedTweets = [];

  for (const bookmark of bookmarksResult.tweets) {
    // Fetch thread for each bookmark
    const threadResult = await client.getThread(bookmark.id);
    if (!threadResult.success) continue;

    // Filter to author's chain
    const authorChain = filterAuthorChain(threadResult.tweets, bookmark);
    expandedTweets.push(...authorChain);

    // Rate limit ourselves
    await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate
  const unique = [...new Map(expandedTweets.map(t => [t.id, t])).values()];
  return unique;
}
```

**Note:** The library approach gives you more control but requires understanding the internal APIs. The CLI is the stable interface.
