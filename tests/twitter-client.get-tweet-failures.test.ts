import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

// Fixtures are real TweetDetail responses captured on 2026-10-28 (focal id sanitized to FOCAL_ID).
// Each id's verdict was cross-checked against the X API v2 lookup.
const FOCAL_ID = '1000000000000000001';

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const httpError = (status: number, body = '') => ({ ok: false, status, text: async () => body });

const tweetResult = (id: string) => ({
  rest_id: id,
  legacy: {
    full_text: 'visible text',
    created_at: '2024-01-01T00:00:00Z',
    reply_count: 0,
    retweet_count: 0,
    favorite_count: 0,
  },
  core: { user_results: { result: { legacy: { screen_name: 'someone', name: 'Someone' } } } },
});

const conversation = (entries: unknown[]) => ({
  data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries }] } },
});

const focalEntry = (tweetResults: unknown, id = FOCAL_ID) => ({
  entryId: `tweet-${id}`,
  content: { itemContent: { tweet_results: tweetResults } },
});

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient getTweet failure classification', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  const read = async (id = FOCAL_ID) => new TwitterClient({ cookies: validCookies }).getTweet(id);

  describe('content verdicts from X', () => {
    it('classifies an empty focal tweet_results as not_found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(loadFixture('tweet-detail-missing.json')));

      const result = await read();

      expect(result.success).toBe(false);
      expect(result.failure).toMatchObject({ kind: 'not_found', reason: 'Missing' });
      expect(result.error).toBe(result.failure?.message);
    });

    it('classifies a protected-account tombstone as unavailable', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(loadFixture('tweet-detail-tombstone-protected.json')));

      const result = await read();

      expect(result.failure).toMatchObject({ kind: 'unavailable', reason: 'Protected' });
      expect(result.failure?.message).toContain('limits who can view their Posts');
      expect(result.failure?.message).not.toContain('Learn more');
    });

    it('classifies a suspended-account tombstone as unavailable', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(loadFixture('tweet-detail-tombstone-suspended.json')));

      const result = await read();

      expect(result.failure).toMatchObject({ kind: 'unavailable', reason: 'Suspended' });
      expect(result.failure?.message).toBe('This Post is from a suspended account.');
    });

    it('classifies a deleted tombstone as not_found', async () => {
      const tombstone = {
        __typename: 'TweetTombstone',
        tombstone: {
          __typename: 'TextTombstone',
          text: { text: 'This Post was deleted by the Post author. Learn more' },
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([focalEntry({ result: tombstone })])));

      expect((await read()).failure).toMatchObject({ kind: 'not_found', reason: 'Deleted' });
    });

    it('classifies a TweetUnavailable result using its reason', async () => {
      const unavailable = { __typename: 'TweetUnavailable', reason: 'NsfwLoggedOut' };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([focalEntry({ result: unavailable })])));

      expect((await read()).failure).toMatchObject({ kind: 'unavailable', reason: 'NsfwLoggedOut' });
    });

    it('reads a focal tweet wrapped in TweetWithVisibilityResults', async () => {
      const wrapped = { __typename: 'TweetWithVisibilityResults', tweet: tweetResult(FOCAL_ID) };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([focalEntry({ result: wrapped })])));

      const result = await read();

      expect(result.success).toBe(true);
      expect(result.tweet?.id).toBe(FOCAL_ID);
    });
  });

  describe('ambiguous responses never become not_found', () => {
    it('classifies a response without the focal entry as parse', async () => {
      const other = focalEntry({ result: tweetResult('2') }, '2');
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([other])));

      expect((await read()).failure).toMatchObject({ kind: 'parse' });
    });

    it('classifies an unmappable focal tweet as parse', async () => {
      const broken = { __typename: 'Tweet', rest_id: FOCAL_ID };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([focalEntry({ result: broken })])));

      expect((await read()).failure).toMatchObject({ kind: 'parse' });
    });

    it('classifies GraphQL errors without data as transient', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(loadFixture('tweet-detail-graphql-errors.json')));

      const result = await read();

      expect(result.failure).toMatchObject({ kind: 'transient' });
      expect(result.failure?.message).toContain('strconv.ParseInt');
    });

    it('classifies a persistent endpoint 404 as transient, not not_found', async () => {
      mockFetch.mockResolvedValue(httpError(404, 'Not Found'));

      const result = await read();

      expect(result.failure).toMatchObject({ kind: 'transient', status: 404 });
      expect(result.error).toContain('HTTP 404');
    });
  });

  describe('review regressions', () => {
    it('does not trust an empty focal slot when X also returned GraphQL errors', async () => {
      const body = {
        ...(loadFixture('tweet-detail-missing.json') as object),
        errors: [{ message: 'Internal error', code: 131 }],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(body));

      expect((await read()).failure).toMatchObject({ kind: 'transient', message: 'Internal error' });
    });

    it('prefers a matching tweet elsewhere over an empty focal placeholder', async () => {
      const placeholder = focalEntry({});
      const real = {
        entryId: 'conversationthread-1',
        content: { itemContent: { tweet_results: { result: tweetResult(FOCAL_ID) } } },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([placeholder, real])));

      const result = await read();

      expect(result.success).toBe(true);
      expect(result.tweet?.id).toBe(FOCAL_ID);
    });

    it('rejects a focal entry whose unwrapped tweet has a different id', async () => {
      const wrapped = { __typename: 'TweetWithVisibilityResults', tweet: tweetResult('2') };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([focalEntry({ result: wrapped })])));

      const result = await read();

      expect(result.success).toBe(false);
      expect(result.failure).toMatchObject({ kind: 'parse' });
    });

    it('does not treat a tombstone about a deleted account as a deleted tweet', async () => {
      const tombstone = {
        __typename: 'TweetTombstone',
        tombstone: { text: { text: 'This Post is from an account that no longer exists or was deleted. Learn more' } },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(conversation([focalEntry({ result: tombstone })])));

      expect((await read()).failure).toMatchObject({ kind: 'unavailable', reason: 'Tombstone' });
    });

    it('classifies a 403 carrying rate-limit code 88 as rate_limited', async () => {
      mockFetch.mockResolvedValueOnce(httpError(403, '{"errors":[{"message":"Rate limit exceeded","code":88}]}'));

      expect((await read()).failure).toMatchObject({ kind: 'rate_limited', status: 403 });
    });

    it('classifies a locked account (code 326) as auth', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ errors: [{ message: 'Account is temporarily locked', code: 326 }] }),
      );

      expect((await read()).failure).toMatchObject({ kind: 'auth' });
    });
  });

  describe('transport failures', () => {
    it('classifies HTTP 429 as rate_limited', async () => {
      mockFetch.mockResolvedValueOnce(httpError(429, 'Rate limit exceeded'));

      expect((await read()).failure).toMatchObject({ kind: 'rate_limited', status: 429 });
    });

    it('classifies GraphQL error code 88 as rate_limited', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Rate limit exceeded', code: 88 }] }));

      expect((await read()).failure).toMatchObject({ kind: 'rate_limited' });
    });

    it('classifies HTTP 401 as auth', async () => {
      mockFetch.mockResolvedValueOnce(
        httpError(401, '{"errors":[{"message":"Could not authenticate you","code":32}]}'),
      );

      expect((await read()).failure).toMatchObject({ kind: 'auth', status: 401 });
    });

    it('classifies HTTP 403 as auth', async () => {
      mockFetch.mockResolvedValueOnce(httpError(403, '{"errors":[{"message":"Forbidden","code":353}]}'));

      expect((await read()).failure).toMatchObject({ kind: 'auth', status: 403 });
    });

    it('classifies HTTP 5xx as transient', async () => {
      mockFetch.mockResolvedValueOnce(httpError(503, 'Over capacity'));

      expect((await read()).failure).toMatchObject({ kind: 'transient', status: 503 });
    });

    it('classifies an aborted request as transient Timeout', async () => {
      mockFetch.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));

      expect((await read()).failure).toMatchObject({ kind: 'transient', reason: 'Timeout' });
    });

    it('classifies a network error as transient Network', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      expect((await read()).failure).toMatchObject({ kind: 'transient', reason: 'Network' });
    });

    it('classifies an unparseable body as parse', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      });

      expect((await read()).failure).toMatchObject({ kind: 'parse' });
    });
  });
});
