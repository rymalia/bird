import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/cli/shared.js';
import { registerReadCommands } from '../src/commands/read.js';
import { TwitterClient } from '../src/lib/twitter-client.js';
import type { TweetData } from '../src/lib/twitter-client-types.js';

describe('replies command', () => {
  const createMockContext = () =>
    ({
      resolveTimeoutFromOptions: () => undefined,
      resolveQuoteDepthFromOptions: () => 1,
      extractTweetId: (input: string) => input,
      resolveCredentialsFromOptions: async () => ({
        cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
        warnings: [],
      }),
      p: () => '',
      printTweets: () => undefined,
      printTweetsResult: () => undefined,
    }) as unknown as CliContext;

  it('uses pagination when --max-pages is provided', async () => {
    const program = new Command();
    registerReadCommands(program, createMockContext());

    const pagedSpy = vi
      .spyOn(TwitterClient.prototype, 'getRepliesPaged')
      .mockResolvedValue({ success: true, tweets: [], nextCursor: undefined });
    const unpagedSpy = vi.spyOn(TwitterClient.prototype, 'getReplies').mockResolvedValue({ success: true, tweets: [] });

    try {
      await program.parseAsync(['node', 'bird', 'replies', '123', '--max-pages', '2', '--json']);
      expect(pagedSpy).toHaveBeenCalledTimes(1);
      expect(unpagedSpy).toHaveBeenCalledTimes(0);
    } finally {
      pagedSpy.mockRestore();
      unpagedSpy.mockRestore();
    }
  });

  it('validates --max-pages is a positive integer', async () => {
    const program = new Command();
    registerReadCommands(program, createMockContext());

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        program.parseAsync(['node', 'bird', 'replies', '123', '--all', '--max-pages', '-1']),
      ).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --max-pages'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('validates --delay is a non-negative integer', async () => {
    const program = new Command();
    registerReadCommands(program, createMockContext());

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'replies', '123', '--all', '--delay', '-100'])).rejects.toThrow(
        'exit 1',
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --delay'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('thread command', () => {
  const createMockContext = () =>
    ({
      resolveTimeoutFromOptions: () => undefined,
      resolveQuoteDepthFromOptions: () => 1,
      extractTweetId: (input: string) => input,
      resolveCredentialsFromOptions: async () => ({
        cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
        warnings: [],
      }),
      p: () => '',
      printTweets: () => undefined,
      printTweetsResult: () => undefined,
    }) as unknown as CliContext;

  it('uses pagination when --max-pages is provided', async () => {
    const program = new Command();
    registerReadCommands(program, createMockContext());

    const pagedSpy = vi
      .spyOn(TwitterClient.prototype, 'getThreadPaged')
      .mockResolvedValue({ success: true, tweets: [], nextCursor: undefined });
    const unpagedSpy = vi.spyOn(TwitterClient.prototype, 'getThread').mockResolvedValue({ success: true, tweets: [] });

    try {
      await program.parseAsync(['node', 'bird', 'thread', '123', '--max-pages', '2', '--json']);
      expect(pagedSpy).toHaveBeenCalledTimes(1);
      expect(unpagedSpy).toHaveBeenCalledTimes(0);
    } finally {
      pagedSpy.mockRestore();
      unpagedSpy.mockRestore();
    }
  });

  it('validates --max-pages is a positive integer', async () => {
    const program = new Command();
    registerReadCommands(program, createMockContext());

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'thread', '123', '--all', '--max-pages', '0'])).rejects.toThrow(
        'exit 1',
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --max-pages'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('validates --delay is a non-negative integer', async () => {
    const program = new Command();
    registerReadCommands(program, createMockContext());

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(program.parseAsync(['node', 'bird', 'thread', '123', '--all', '--delay', 'abc'])).rejects.toThrow(
        'exit 1',
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --delay'));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('thread command filter flags', () => {
  const makeTweet = (id: string, username: string, inReplyToStatusId?: string): TweetData => ({
    id,
    text: `tweet ${id}`,
    author: { username, name: username },
    createdAt: `2020-01-0${id}T00:00:00Z`,
    conversationId: '1',
    inReplyToStatusId,
  });

  // Conversation: alice:1 -> alice:2 -> bob:3 -> alice:4, alice:5 (reply to 2)
  const threadTweets: TweetData[] = [
    makeTweet('1', 'alice'),
    makeTweet('2', 'alice', '1'),
    makeTweet('3', 'bob', '2'),
    makeTweet('4', 'alice', '3'),
    makeTweet('5', 'alice', '2'),
  ];

  const createMockContext = () => {
    const printTweetsResultFn = vi.fn();
    return {
      ctx: {
        resolveTimeoutFromOptions: () => undefined,
        resolveQuoteDepthFromOptions: () => 1,
        extractTweetId: (input: string) => input,
        resolveCredentialsFromOptions: async () => ({
          cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
          warnings: [],
        }),
        p: (type: string) => `[${type}] `,
        printTweets: () => undefined,
        printTweetsResult: printTweetsResultFn,
      } as unknown as CliContext,
      printTweetsResultFn,
    };
  };

  it('--author-chain filters to connected self-reply chain', async () => {
    const { ctx, printTweetsResultFn } = createMockContext();
    const program = new Command();
    registerReadCommands(program, ctx);

    const spy = vi
      .spyOn(TwitterClient.prototype, 'getThread')
      .mockResolvedValue({ success: true, tweets: [...threadTweets] });

    try {
      await program.parseAsync(['node', 'bird', 'thread', '2', '--author-chain', '--json']);
      expect(printTweetsResultFn).toHaveBeenCalledTimes(1);
      const printed = printTweetsResultFn.mock.calls[0][0].tweets as TweetData[];
      const ids = printed.map((t) => t.id);
      // anchor=2, walk up to 1 (alice), walk down to 5 (alice reply to 2); 3 is bob, 4 replies to bob
      expect(ids).toEqual(['1', '2', '5']);
    } finally {
      spy.mockRestore();
    }
  });

  it('--author-only filters to all tweets by focal author', async () => {
    const { ctx, printTweetsResultFn } = createMockContext();
    const program = new Command();
    registerReadCommands(program, ctx);

    const spy = vi
      .spyOn(TwitterClient.prototype, 'getThread')
      .mockResolvedValue({ success: true, tweets: [...threadTweets] });

    try {
      await program.parseAsync(['node', 'bird', 'thread', '1', '--author-only', '--json']);
      expect(printTweetsResultFn).toHaveBeenCalledTimes(1);
      const printed = printTweetsResultFn.mock.calls[0][0].tweets as TweetData[];
      const ids = printed.map((t) => t.id);
      expect(ids).toEqual(['1', '2', '4', '5']);
    } finally {
      spy.mockRestore();
    }
  });

  it('--rooted-thread keeps connected subtree through focal tweet', async () => {
    const { ctx, printTweetsResultFn } = createMockContext();
    const program = new Command();
    registerReadCommands(program, ctx);

    const spy = vi
      .spyOn(TwitterClient.prototype, 'getThread')
      .mockResolvedValue({ success: true, tweets: [...threadTweets] });

    try {
      // Focal tweet = 3 (bob's reply to 2): ancestors = 2, 1; descendants = 4
      await program.parseAsync(['node', 'bird', 'thread', '3', '--rooted-thread', '--json']);
      expect(printTweetsResultFn).toHaveBeenCalledTimes(1);
      const printed = printTweetsResultFn.mock.calls[0][0].tweets as TweetData[];
      const ids = printed.map((t) => t.id);
      expect(ids).toEqual(['1', '2', '3', '4']);
    } finally {
      spy.mockRestore();
    }
  });

  it('--thread-meta adds metadata fields', async () => {
    const { ctx, printTweetsResultFn } = createMockContext();
    const program = new Command();
    registerReadCommands(program, ctx);

    const spy = vi
      .spyOn(TwitterClient.prototype, 'getThread')
      .mockResolvedValue({ success: true, tweets: [...threadTweets] });

    try {
      await program.parseAsync(['node', 'bird', 'thread', '1', '--thread-meta', '--json']);
      expect(printTweetsResultFn).toHaveBeenCalledTimes(1);
      const printed = printTweetsResultFn.mock.calls[0][0].tweets;
      expect(printed[0]).toHaveProperty('isThread');
      expect(printed[0]).toHaveProperty('threadPosition');
      expect(printed[0]).toHaveProperty('hasSelfReplies');
      expect(printed[0]).toHaveProperty('threadRootId');
    } finally {
      spy.mockRestore();
    }
  });

  it('--author-chain with --author-only emits redundancy warning', async () => {
    const { ctx } = createMockContext();
    const program = new Command();
    registerReadCommands(program, ctx);

    const spy = vi
      .spyOn(TwitterClient.prototype, 'getThread')
      .mockResolvedValue({ success: true, tweets: [...threadTweets] });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await program.parseAsync(['node', 'bird', 'thread', '1', '--author-chain', '--author-only', '--json']);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('other filter flags are redundant'));
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('warns when focal tweet not found in results', async () => {
    const { ctx } = createMockContext();
    const program = new Command();
    registerReadCommands(program, ctx);

    const spy = vi
      .spyOn(TwitterClient.prototype, 'getThread')
      .mockResolvedValue({ success: true, tweets: [...threadTweets] });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // '999' doesn't exist in threadTweets
      await program.parseAsync(['node', 'bird', 'thread', '999', '--author-chain', '--json']);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Focal tweet 999 not found'));
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('read command failures', () => {
  const createMockContext = (cookies = { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' }) =>
    ({
      resolveTimeoutFromOptions: () => undefined,
      resolveQuoteDepthFromOptions: () => 1,
      extractTweetId: (input: string) => input,
      resolveCredentialsFromOptions: async () => ({ cookies, warnings: [] }),
      p: () => '',
      printTweets: () => undefined,
    }) as unknown as CliContext;

  const runRead = async (args: string[], ctx = createMockContext()) => {
    const program = new Command();
    registerReadCommands(program, ctx);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(program.parseAsync(['node', 'bird', 'read', ...args])).rejects.toThrow('exit 1');
      return {
        stdout: logSpy.mock.calls.map((call) => String(call[0])),
        stderr: errorSpy.mock.calls.map((call) => String(call[0])),
      };
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  };

  const failure = {
    kind: 'unavailable' as const,
    reason: 'Suspended',
    message: 'This Post is from a suspended account.',
  };

  it.each([['--json'], ['--json-full']])('prints a JSON error object on stdout with %s', async (flag) => {
    const spy = vi
      .spyOn(TwitterClient.prototype, 'getTweet')
      .mockResolvedValue({ success: false, error: failure.message, failure });

    try {
      const { stdout, stderr } = await runRead(['123', flag]);
      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0])).toEqual({
        error: { kind: 'unavailable', reason: 'Suspended', status: null, message: failure.message },
      });
      expect(stderr).toContain(`Failed to read tweet: ${failure.message}`);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps stdout empty without a JSON flag', async () => {
    const spy = vi
      .spyOn(TwitterClient.prototype, 'getTweet')
      .mockResolvedValue({ success: false, error: failure.message, failure });

    try {
      const { stdout, stderr } = await runRead(['123']);
      expect(stdout).toEqual([]);
      expect(stderr).toContain(`Failed to read tweet: ${failure.message}`);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to transient when a failure has no classification', async () => {
    const spy = vi.spyOn(TwitterClient.prototype, 'getTweet').mockResolvedValue({ success: false, error: 'boom' });

    try {
      const { stdout } = await runRead(['123', '--json']);
      expect(JSON.parse(stdout[0])).toEqual({
        error: { kind: 'transient', reason: null, status: null, message: 'boom' },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('reports missing credentials as an auth error', async () => {
    const { stdout, stderr } = await runRead(
      ['123', '--json'],
      createMockContext({ authToken: '', ct0: '', cookieHeader: '' }),
    );

    expect(JSON.parse(stdout[0])).toEqual({
      error: { kind: 'auth', reason: 'MissingCredentials', status: null, message: 'Missing required credentials' },
    });
    expect(stderr).toContain('Missing required credentials');
  });
});
