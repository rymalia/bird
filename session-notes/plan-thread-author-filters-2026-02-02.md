# Plan: Add --author-chain, --author-only, and --thread-meta flags to `bird thread` command

> **Created:** 2026-02-02
> **Status:** Planning complete, ready for implementation

## Summary

Add the existing author filtering and thread metadata capabilities from the `bookmarks` command to the `thread` command, enabling users to filter threads to only the author's tweets and annotate tweets with thread position metadata.

## Background

The author filter flags (`--author-chain`, `--author-only`) were added to `bookmarks` in v0.8.0 (PR #55 by @kkretschmer2). The implementation kept the `thread` command simple for "full conversation view" while `bookmarks` got filtering for "exploratory use cases." The filter functions in `thread-filters.ts` have **zero bookmarks-specific dependencies** and can be directly reused.

## Implementation Approach

**Apply filtering in the CLI layer** (matching the bookmarks pattern) rather than in client methods. This:
- Keeps client methods focused on data fetching
- Ensures filtering happens after all pages are collected (important for `--author-chain`)
- Makes it easy to add more filter options later

## Files to Modify

| File | Changes |
|------|---------|
| `src/commands/read.ts` | Add options, import filters, apply filtering after fetch |
| `tests/thread-filters.test.ts` | Add unit tests for `filterAuthorChain`, `filterAuthorOnly` (currently untested!) |
| `tests/commands.read.test.ts` | Add integration tests for new thread command flags |
| `tests/help-output.test.ts` | Verify new flags appear in thread command help |
| `README.md` | Document new flags in Commands section |

## Code Changes

### 1. Add import (src/commands/read.ts, top of file)

```typescript
import { addThreadMetadata, filterAuthorChain, filterAuthorOnly } from '../lib/thread-filters.js';
import type { TweetData, TweetWithMeta } from '../lib/twitter-client-types.js';
```

### 2. Add options to thread command (after line 135)

```typescript
.option('--author-chain', 'Only include author self-reply chains connected to the target tweet')
.option('--author-only', 'Include all tweets from the target tweet author in the thread')
.option('--thread-meta', 'Add thread metadata fields (isThread, threadPosition, etc.)')
```

### 3. Update cmdOpts type (lines 139-146)

```typescript
cmdOpts: {
  all?: boolean;
  maxPages?: string;
  delay?: string;
  cursor?: string;
  json?: boolean;
  jsonFull?: boolean;
  authorChain?: boolean;  // NEW
  authorOnly?: boolean;   // NEW
  threadMeta?: boolean;   // NEW
}
```

### 4. Add filtering and metadata logic (after line 180, before line 182)

```typescript
// Apply author filtering if requested
if (result.success && result.tweets && result.tweets.length > 0) {
  const useAuthorChain = Boolean(cmdOpts.authorChain);
  const useAuthorOnly = Boolean(cmdOpts.authorOnly);
  const useThreadMeta = Boolean(cmdOpts.threadMeta);

  if (useAuthorChain && useAuthorOnly) {
    console.error(
      `${ctx.p('warn')}--author-chain already limits to connected self-reply chain; ` +
        '--author-only is redundant.',
    );
  }

  // Store original tweets for metadata calculation (before filtering)
  const allTweets = result.tweets;

  if (useAuthorChain || useAuthorOnly) {
    // Find anchor tweet (the requested tweet)
    const anchorTweet = result.tweets.find((t) => t.id === tweetId);

    if (!anchorTweet) {
      console.error(
        `${ctx.p('warn')}Target tweet ${tweetId} not found in results; filters not applied.`,
      );
    } else if (useAuthorChain) {
      result.tweets = filterAuthorChain(result.tweets, anchorTweet);
    } else {
      result.tweets = filterAuthorOnly(result.tweets, anchorTweet);
    }
  }

  // Apply thread metadata if requested
  if (useThreadMeta) {
    const tweetsWithMeta: TweetWithMeta[] = result.tweets.map((tweet) =>
      addThreadMetadata(tweet, allTweets)
    );
    result.tweets = tweetsWithMeta as TweetData[];
  }
}
```

### 5. Update empty message (line 187)

```typescript
emptyMessage: (cmdOpts.authorChain || cmdOpts.authorOnly)
  ? 'No matching tweets found after filtering.'
  : 'No thread tweets found.',
```

## Edge Cases

| Case | Handling |
|------|----------|
| Both flags used | Warn, apply `--author-chain` only |
| Target tweet not in results | Warn, return unfiltered |
| Empty after filtering | Show "No matching tweets found" |
| With pagination | Works correctly (filters after collection) |

## Verification

### Manual Testing

```bash
# Basic functionality
pnpm run dev thread <tweet-id> --author-chain --json
pnpm run dev thread <tweet-id> --author-only --json
pnpm run dev thread <tweet-id> --thread-meta --json

# Compare with unfiltered
pnpm run dev thread <tweet-id> --json | jq '.tweets | length'
pnpm run dev thread <tweet-id> --author-only --json | jq '.tweets | length'

# Verify metadata fields
pnpm run dev thread <tweet-id> --thread-meta --json | jq '.tweets[0] | {isThread, threadPosition}'

# Combine filters with metadata
pnpm run dev thread <tweet-id> --author-chain --thread-meta --json

# With pagination
pnpm run dev thread <tweet-id> --all --author-chain --json

# Warning cases
pnpm run dev thread <tweet-id> --author-chain --author-only  # Should warn
```

### Automated Testing

```bash
pnpm test                    # Full test suite
pnpm vitest run tests/thread-filters.test.ts
pnpm vitest run tests/commands.read.test.ts
pnpm vitest run tests/help-output.test.ts
```

---

## Test Specifications

### 1. Unit Tests: `tests/thread-filters.test.ts`

**Note:** `filterAuthorChain` and `filterAuthorOnly` currently have ZERO test coverage.

```typescript
// Add to existing test file

describe('filterAuthorChain', () => {
  const makeTweet = (id: string, author: string, inReplyTo?: string): TweetData => ({
    id,
    text: `Tweet ${id}`,
    author: { username: author, name: author },
    createdAt: `2020-01-0${id}T00:00:00Z`,
    inReplyToStatusId: inReplyTo,
    conversationId: '1',
  });

  it('returns connected self-reply chain from anchor', () => {
    // alice posts thread: 1 -> 2 -> 3, bob replies to 2
    const tweets = [
      makeTweet('1', 'alice'),           // root
      makeTweet('2', 'alice', '1'),      // alice self-reply
      makeTweet('3', 'alice', '2'),      // alice self-reply
      makeTweet('4', 'bob', '2'),        // bob's reply (excluded)
    ];
    const anchor = tweets[1]; // tweet 2
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map(t => t.id)).toEqual(['1', '2', '3']);
  });

  it('stops at non-author tweet in chain', () => {
    // alice -> bob -> alice (disconnected)
    const tweets = [
      makeTweet('1', 'alice'),
      makeTweet('2', 'bob', '1'),
      makeTweet('3', 'alice', '2'),  // alice replies to bob
    ];
    const anchor = tweets[2]; // tweet 3
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map(t => t.id)).toEqual(['3']); // only tweet 3
  });

  it('includes descendants of anchor by same author', () => {
    const tweets = [
      makeTweet('1', 'alice'),
      makeTweet('2', 'alice', '1'),
      makeTweet('3', 'alice', '2'),
    ];
    const anchor = tweets[0]; // root
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map(t => t.id)).toEqual(['1', '2', '3']);
  });
});

describe('filterAuthorOnly', () => {
  it('returns all tweets by anchor author', () => {
    const tweets = [
      makeTweet('1', 'alice'),
      makeTweet('2', 'bob', '1'),
      makeTweet('3', 'alice', '2'),
      makeTweet('4', 'charlie', '1'),
    ];
    const anchor = tweets[0];
    const result = filterAuthorOnly(tweets, anchor);
    expect(result.map(t => t.id)).toEqual(['1', '3']);
  });

  it('returns empty array when no author matches', () => {
    const tweets = [makeTweet('1', 'bob')];
    const anchor = { ...makeTweet('2', 'alice') };
    const result = filterAuthorOnly(tweets, anchor);
    expect(result).toEqual([]);
  });
});
```

### 2. Integration Tests: `tests/commands.read.test.ts`

```typescript
// Add to 'thread command' describe block

it('applies --author-chain filter to results', async () => {
  const program = new Command();
  const printedTweets: TweetData[] = [];
  const ctx = {
    ...createMockContext(),
    printTweetsResult: (result: { tweets: TweetData[] }) => {
      printedTweets.push(...result.tweets);
    },
  } as unknown as CliContext;

  registerReadCommands(program, ctx);

  const mockTweets = [
    { id: '123', author: { username: 'alice', name: 'Alice' }, text: 'root' },
    { id: '124', author: { username: 'alice', name: 'Alice' }, text: 'reply', inReplyToStatusId: '123' },
    { id: '125', author: { username: 'bob', name: 'Bob' }, text: 'other', inReplyToStatusId: '123' },
  ];

  const spy = vi.spyOn(TwitterClient.prototype, 'getThread')
    .mockResolvedValue({ success: true, tweets: mockTweets });

  try {
    await program.parseAsync(['node', 'bird', 'thread', '123', '--author-chain', '--json']);
    // Should filter to alice's tweets only
    expect(printedTweets.every(t => t.author.username === 'alice')).toBe(true);
    expect(printedTweets.find(t => t.author.username === 'bob')).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it('warns when both --author-chain and --author-only are used', async () => {
  const program = new Command();
  registerReadCommands(program, createMockContext());

  const spy = vi.spyOn(TwitterClient.prototype, 'getThread')
    .mockResolvedValue({ success: true, tweets: [{ id: '123', author: { username: 'a', name: 'A' }, text: '' }] });
  const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    await program.parseAsync(['node', 'bird', 'thread', '123', '--author-chain', '--author-only', '--json']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redundant'));
  } finally {
    spy.mockRestore();
    warnSpy.mockRestore();
  }
});

it('adds metadata fields when --thread-meta is used', async () => {
  const program = new Command();
  const printedTweets: TweetWithMeta[] = [];
  const ctx = {
    ...createMockContext(),
    printTweetsResult: (result: { tweets: TweetWithMeta[] }) => {
      printedTweets.push(...result.tweets);
    },
  } as unknown as CliContext;

  registerReadCommands(program, ctx);

  const spy = vi.spyOn(TwitterClient.prototype, 'getThread')
    .mockResolvedValue({ success: true, tweets: [{ id: '123', author: { username: 'a', name: 'A' }, text: '' }] });

  try {
    await program.parseAsync(['node', 'bird', 'thread', '123', '--thread-meta', '--json']);
    expect(printedTweets[0]).toHaveProperty('isThread');
    expect(printedTweets[0]).toHaveProperty('threadPosition');
  } finally {
    spy.mockRestore();
  }
});
```

### 3. Help Output Test: `tests/help-output.test.ts`

```typescript
it('shows --author-chain, --author-only, and --thread-meta in thread command help', () => {
  const ctx = createCliContext([]);
  const program = createProgram(ctx);
  const cmd = program.commands.find((c) => c.name() === 'thread');
  if (!cmd) {
    throw new Error('Expected "thread" command to be registered');
  }

  let help = '';
  const output = {
    writeOut: (s: string) => { help += s; },
    writeErr: () => {},
  };
  program.configureOutput(output);
  cmd.configureOutput(output);
  cmd.outputHelp();

  expect(help).toContain('--author-chain');
  expect(help).toContain('--author-only');
  expect(help).toContain('--thread-meta');
});
```

### 4. README Update

Add to the Commands section under `bird thread`:

```markdown
- `bird thread <tweet-id-or-url> [--all] [--max-pages n] [--cursor string] [--delay ms] [--author-chain] [--author-only] [--thread-meta] [--json]` — show the full conversation thread; `--author-chain` filters to the author's connected self-reply chain; `--author-only` includes all tweets from the target tweet's author; `--thread-meta` adds thread position metadata fields.
```

## Usage Examples (Post-Implementation)

```bash
# Get author's self-thread (connected chain)
bird thread 1234567890 --author-chain --json

# Get all author's tweets in the conversation
bird thread 1234567890 --author-only --json

# Add thread position metadata
bird thread 1234567890 --thread-meta --json

# Combine: author chain with metadata
bird thread 1234567890 --author-chain --thread-meta --json

# With pagination
bird thread 1234567890 --all --max-pages 3 --author-chain --json
```

## Metadata Fields (--thread-meta)

| Field | Type | Description |
|-------|------|-------------|
| `isThread` | boolean | Tweet is part of a thread |
| `threadPosition` | string | `"root"`, `"middle"`, `"end"`, or `"standalone"` |
| `hasSelfReplies` | boolean | Author has replied to this tweet |
| `threadRootId` | string | Conversation root tweet ID |
