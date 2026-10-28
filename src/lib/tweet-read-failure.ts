import type { GraphqlTweetResult, TweetReadFailure } from './twitter-client-types.js';

// Classification is deliberately conservative: only an explicit verdict from X becomes
// not_found. Consumers treat not_found as "deleted" and stop retrying, so anything
// ambiguous must fall into a retryable kind instead.

type TimelineEntry = {
  entryId?: string;
  content?: { itemContent?: { tweet_results?: { result?: GraphqlTweetResult } } };
};

type TombstoneResult = {
  __typename?: string;
  reason?: string;
  tombstone?: { text?: { text?: string } };
};

// 32/89/239: bad or expired credentials; 353: ct0 mismatch; 326: account locked
const AUTH_ERROR_CODES = new Set([32, 89, 239, 326, 353]);
const RATE_LIMIT_ERROR_CODE = 88;

// Tombstones carry no machine-readable reason; X's display text is the only signal.
const LEARN_MORE_SUFFIX = /\s*Learn more\s*$/;
const SUSPENDED_TOMBSTONE = /suspended/i;
const PROTECTED_TOMBSTONE = /limits who can view|protected/i;
const WITHHELD_TOMBSTONE = /withheld/i;
const DELETED_TOMBSTONE = /\bPost (?:was|has been) deleted\b/i;

function parseErrorCodes(body: string): number[] {
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ code?: number }> };
    return (parsed.errors ?? []).map((e) => e.code).filter((code): code is number => typeof code === 'number');
  } catch {
    return [];
  }
}

/** Classify a non-2xx TweetDetail response. A 404 here is the endpoint (stale query id), not the tweet. */
export function classifyHttpFailure(status: number, body: string): TweetReadFailure {
  const trimmed = body.trim();
  const message = trimmed ? `HTTP ${status}: ${trimmed.slice(0, 200)}` : `HTTP ${status}`;
  if (status === 429) {
    return { kind: 'rate_limited', status, message };
  }
  if (status === 401) {
    return { kind: 'auth', status, message };
  }
  if (status === 403) {
    // A 403 with no code is almost always a rejected session; a non-auth code may be per-tweet, so retry it.
    const codes = parseErrorCodes(body);
    if (codes.includes(RATE_LIMIT_ERROR_CODE)) {
      return { kind: 'rate_limited', status, message };
    }
    const isAuth = codes.length === 0 || codes.some((code) => AUTH_ERROR_CODES.has(code));
    return { kind: isAuth ? 'auth' : 'transient', status, message };
  }
  if (status === 404) {
    return { kind: 'transient', reason: 'QueryIdNotFound', status, message };
  }
  const codes = parseErrorCodes(body);
  if (codes.includes(RATE_LIMIT_ERROR_CODE)) {
    return { kind: 'rate_limited', status, message };
  }
  if (codes.some((code) => AUTH_ERROR_CODES.has(code))) {
    return { kind: 'auth', status, message };
  }
  return { kind: 'transient', status, message };
}

/** Classify a 200 response whose GraphQL `errors` left no usable data. */
export function classifyGraphqlErrors(errors: Array<{ message: string; code?: number }>): TweetReadFailure {
  const message = errors.map((e) => e.message).join(', ');
  const codes = errors.map((e) => e.code);
  if (codes.includes(RATE_LIMIT_ERROR_CODE)) {
    return { kind: 'rate_limited', message };
  }
  if (codes.some((code) => code !== undefined && AUTH_ERROR_CODES.has(code))) {
    return { kind: 'auth', message };
  }
  return { kind: 'transient', message };
}

/** Classify an exception thrown while fetching or decoding a response. */
export function classifyThrownError(error: unknown): TweetReadFailure {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { kind: 'transient', reason: 'Timeout', message };
  }
  if (error instanceof SyntaxError) {
    return { kind: 'parse', message };
  }
  return { kind: 'transient', reason: 'Network', message };
}

/** True if any object anywhere in the response carries this tweet's rest_id (modules included). */
export function responseMentionsTweet(data: unknown, tweetId: string): boolean {
  const stack: unknown[] = [data];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record.rest_id === tweetId) {
        return true;
      }
      stack.push(...Object.values(record));
    }
  }
  return false;
}

/** Find the focal tweet's timeline entry. Tombstones carry no rest_id, so match on entryId first. */
export function findFocalTweetEntry(
  instructions: Array<{ entries?: TimelineEntry[] }> | undefined,
  tweetId: string,
): TimelineEntry | undefined {
  const entries = (instructions ?? []).flatMap((instruction) => instruction.entries ?? []);
  return (
    entries.find((entry) => entry.entryId === `tweet-${tweetId}`) ??
    entries.find((entry) => {
      const result = entry.content?.itemContent?.tweet_results?.result;
      return result?.rest_id === tweetId || result?.tweet?.rest_id === tweetId;
    })
  );
}

function classifyTombstone(text: string): TweetReadFailure {
  const message = text.replace(LEARN_MORE_SUFFIX, '').trim();
  if (!message) {
    return { kind: 'parse', message: 'Tombstone without text' };
  }
  if (SUSPENDED_TOMBSTONE.test(text)) {
    return { kind: 'unavailable', reason: 'Suspended', message };
  }
  if (PROTECTED_TOMBSTONE.test(text)) {
    return { kind: 'unavailable', reason: 'Protected', message };
  }
  if (WITHHELD_TOMBSTONE.test(text)) {
    return { kind: 'unavailable', reason: 'Withheld', message };
  }
  if (DELETED_TOMBSTONE.test(text)) {
    return { kind: 'not_found', reason: 'Deleted', message };
  }
  return { kind: 'unavailable', reason: 'Tombstone', message };
}

/**
 * Explain why a successful TweetDetail response yielded no mappable tweet.
 * `result` is the focal result (if any); `hasFocalEntry` says whether X returned the focal slot at all.
 */
export function classifyMissingTweet(result: GraphqlTweetResult | undefined, hasFocalEntry: boolean): TweetReadFailure {
  const raw = result as TombstoneResult | undefined;
  if (raw?.__typename === 'TweetTombstone') {
    return classifyTombstone(raw.tombstone?.text?.text ?? '');
  }
  if (raw?.__typename === 'TweetUnavailable') {
    return { kind: 'unavailable', reason: raw.reason ?? 'Unavailable', message: 'Tweet is unavailable' };
  }
  if (!result && hasFocalEntry) {
    // X returns the focal slot with empty tweet_results for deleted or never-existing tweets.
    return { kind: 'not_found', reason: 'Missing', message: 'Tweet not found in response' };
  }
  if (result) {
    return { kind: 'parse', message: 'Tweet in response could not be parsed' };
  }
  return { kind: 'parse', message: 'Tweet not found in response' };
}
