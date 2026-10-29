import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/cli/shared.js';
import { registerBookmarksCommand } from '../src/commands/bookmarks.js';
import { TwitterClient } from '../src/lib/twitter-client.js';
import type { TweetData } from '../src/lib/twitter-client-types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bookmarks command', () => {
  it('requires --all or --cursor when --max-pages is provided', async () => {
    const program = new Command();
    const ctx = {
      resolveTimeoutFromOptions: () => undefined,
      resolveCredentialsFromOptions: async () => ({
        cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
        warnings: [],
      }),
      p: () => '',
      printTweets: () => undefined,
    } as unknown as CliContext;

    registerBookmarksCommand(program, ctx);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'bookmarks', '--max-pages', '2'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--max-pages requires --all or --cursor'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it.each([
    '--expand-root-only',
    '--author-chain',
    '--author-only',
    '--full-chain-only',
  ])('keeps bookmarkedAt only on the original bookmark with %s', async (expansionFlag) => {
    const bookmark: TweetData = {
      id: 'bookmark',
      text: 'saved root',
      author: { username: 'alice', name: 'Alice' },
      bookmarkedAt: '2026-10-29T01:01:29.239Z',
      conversationId: 'bookmark',
    };
    const threadAnchor: TweetData = { ...bookmark };
    delete threadAnchor.bookmarkedAt;
    const threadReply: TweetData = {
      id: 'reply',
      text: 'thread reply',
      author: { username: 'alice', name: 'Alice' },
      conversationId: 'bookmark',
      inReplyToStatusId: 'bookmark',
    };
    const printTweetsResult = vi.fn();
    const ctx = {
      resolveTimeoutFromOptions: () => undefined,
      resolveCredentialsFromOptions: async () => ({
        cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
        warnings: [],
      }),
      p: () => '',
      printTweets: vi.fn(),
      printTweetsResult,
    } as unknown as CliContext;

    vi.spyOn(TwitterClient.prototype, 'getBookmarks').mockResolvedValue({ success: true, tweets: [bookmark] });
    vi.spyOn(TwitterClient.prototype, 'getThread').mockResolvedValue({
      success: true,
      tweets: [threadAnchor, threadReply],
    });

    const program = new Command();
    registerBookmarksCommand(program, ctx);
    await program.parseAsync(['node', 'bird', 'bookmarks', expansionFlag, '--json']);

    const printed = printTweetsResult.mock.calls[0][0].tweets as TweetData[];
    expect(printed.map((tweet) => tweet.id)).toEqual(['bookmark', 'reply']);
    expect(printed.find((tweet) => tweet.id === 'bookmark')?.bookmarkedAt).toBe(bookmark.bookmarkedAt);
    expect(printed.find((tweet) => tweet.id === 'reply')).not.toHaveProperty('bookmarkedAt');
  });

  it('does not mark a parent added by --include-parent as bookmarked', async () => {
    const bookmark: TweetData = {
      id: 'bookmark',
      text: 'saved reply',
      author: { username: 'alice', name: 'Alice' },
      bookmarkedAt: '2026-10-29T01:01:29.239Z',
      conversationId: 'root',
      inReplyToStatusId: 'parent',
    };
    const parent: TweetData = {
      id: 'parent',
      text: 'parent tweet',
      author: { username: 'bob', name: 'Bob' },
      conversationId: 'root',
    };
    const printTweetsResult = vi.fn();
    const ctx = {
      resolveTimeoutFromOptions: () => undefined,
      resolveCredentialsFromOptions: async () => ({
        cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
        warnings: [],
      }),
      p: () => '',
      printTweets: vi.fn(),
      printTweetsResult,
    } as unknown as CliContext;

    vi.spyOn(TwitterClient.prototype, 'getBookmarks').mockResolvedValue({ success: true, tweets: [bookmark] });
    vi.spyOn(TwitterClient.prototype, 'getTweet').mockResolvedValue({ success: true, tweet: parent });

    const program = new Command();
    registerBookmarksCommand(program, ctx);
    await program.parseAsync(['node', 'bird', 'bookmarks', '--include-parent', '--json']);

    const printed = printTweetsResult.mock.calls[0][0].tweets as TweetData[];
    expect(printed.map((tweet) => tweet.id)).toEqual(['parent', 'bookmark']);
    expect(printed.find((tweet) => tweet.id === 'parent')).not.toHaveProperty('bookmarkedAt');
    expect(printed.find((tweet) => tweet.id === 'bookmark')?.bookmarkedAt).toBe(bookmark.bookmarkedAt);
  });
});
