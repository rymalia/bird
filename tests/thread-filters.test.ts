import { describe, expect, it } from 'vitest';
import { addThreadMetadata, filterAuthorChain, filterAuthorOnly, filterFullChain } from '../src/lib/thread-filters.js';
import type { TweetData } from '../src/lib/twitter-client-types.js';

const makeTweet = (
  id: string,
  createdAt: string,
  inReplyToStatusId?: string,
  conversationId = '1',
  username = 'alice',
): TweetData => ({
  id,
  text: id,
  author: { username, name: username },
  createdAt,
  inReplyToStatusId,
  conversationId,
});

describe('filterAuthorChain', () => {
  it('returns connected self-reply chain from anchor (up and down)', () => {
    // alice posts thread: 1 -> 2 -> 3, bob replies to 2
    const tweets = [
      makeTweet('1', '2020-01-01T00:00:00Z'), // root
      makeTweet('2', '2020-01-02T00:00:00Z', '1'), // alice self-reply
      makeTweet('3', '2020-01-03T00:00:00Z', '2'), // alice self-reply
      makeTweet('4', '2020-01-04T00:00:00Z', '2', '1', 'bob'), // bob's reply (excluded)
      makeTweet('5', '2020-01-05T00:00:00Z', '3'), // alice self-reply to 3
    ];
    const anchor = tweets[1]; // tweet 2
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map((t) => t.id)).toEqual(['1', '2', '3', '5']);
  });

  it('stops at non-author tweet in chain (walking up)', () => {
    // alice -> bob -> alice (disconnected)
    const tweets = [
      makeTweet('1', '2020-01-01T00:00:00Z'), // alice
      makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', 'bob'), // bob
      makeTweet('3', '2020-01-03T00:00:00Z', '2'), // alice replies to bob
      makeTweet('4', '2020-01-04T00:00:00Z', '3'), // alice self-reply to 3
    ];
    const anchor = tweets[2]; // tweet 3
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map((t) => t.id)).toEqual(['3', '4']); // only alice's chain starting from 3
  });

  it('includes descendants of anchor by same author', () => {
    const tweets = [
      makeTweet('1', '2020-01-01T00:00:00Z'),
      makeTweet('2', '2020-01-02T00:00:00Z', '1'),
      makeTweet('3', '2020-01-03T00:00:00Z', '2'),
    ];
    const anchor = tweets[0]; // root
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('respects different-author interruptions in descendants', () => {
    // alice: 1 -> 2, bob: 3 (reply to 2), alice: 4 (reply to 3, disconnected)
    const tweets = [
      makeTweet('1', '2020-01-01T00:00:00Z'), // alice root
      makeTweet('2', '2020-01-02T00:00:00Z', '1'), // alice self-reply
      makeTweet('3', '2020-01-03T00:00:00Z', '2', '1', 'bob'), // bob interrupts
      makeTweet('4', '2020-01-04T00:00:00Z', '3'), // alice replies to bob (not connected chain)
    ];
    const anchor = tweets[0]; // root
    const result = filterAuthorChain(tweets, anchor);
    // 4 is excluded: it replies to bob's tweet, not to an alice tweet in the chain
    expect(result.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('returns only the anchor for a standalone tweet', () => {
    const tweets = [makeTweet('1', '2020-01-01T00:00:00Z')];
    const anchor = tweets[0];
    const result = filterAuthorChain(tweets, anchor);
    expect(result.map((t) => t.id)).toEqual(['1']);
  });
});

describe('filterAuthorOnly', () => {
  it('returns all tweets by anchor author regardless of connection', () => {
    const tweets = [
      makeTweet('1', '2020-01-01T00:00:00Z'), // alice
      makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', 'bob'), // bob
      makeTweet('3', '2020-01-03T00:00:00Z', '2'), // alice replies to bob
      makeTweet('4', '2020-01-04T00:00:00Z', '1', '1', 'charlie'), // charlie
    ];
    const anchor = tweets[0]; // alice
    const result = filterAuthorOnly(tweets, anchor);
    expect(result.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('returns empty array when no author matches (unlikely but safe)', () => {
    const tweets = [makeTweet('1', '2020-01-01T00:00:00Z', undefined, '1', 'bob')];
    const anchor = makeTweet('2', '2020-01-02T00:00:00Z'); // alice
    const result = filterAuthorOnly(tweets, anchor);
    expect(result).toEqual([]);
  });
});

describe('addThreadMetadata', () => {
  const alice = 'alice';
  const bob = 'bob';

  it('labels a root tweet with self-replies as "root"', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z', undefined, '1', alice);
    const reply = makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', alice);
    const result = addThreadMetadata(root, [root, reply]);
    expect(result.threadPosition).toBe('root');
    expect(result.isThread).toBe(true);
    expect(result.hasSelfReplies).toBe(true);
    expect(result.threadRootId).toBe('1');
  });

  it('labels a root tweet without self-replies as "standalone"', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z', undefined, '1', alice);
    const otherReply = makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', bob);
    const result = addThreadMetadata(root, [root, otherReply]);
    expect(result.threadPosition).toBe('standalone');
    expect(result.isThread).toBe(false);
    expect(result.hasSelfReplies).toBe(false);
  });

  it('labels a mid-thread tweet with self-replies as "middle"', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z', undefined, '1', alice);
    const mid = makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', alice);
    const end = makeTweet('3', '2020-01-03T00:00:00Z', '2', '1', alice);
    const result = addThreadMetadata(mid, [root, mid, end]);
    expect(result.threadPosition).toBe('middle');
    expect(result.isThread).toBe(true);
    expect(result.hasSelfReplies).toBe(true);
  });

  it('labels an end-of-chain tweet as "end"', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z', undefined, '1', alice);
    const end = makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', alice);
    const result = addThreadMetadata(end, [root, end]);
    expect(result.threadPosition).toBe('end');
    expect(result.isThread).toBe(true);
    expect(result.hasSelfReplies).toBe(false);
  });

  it('only considers self-replies from the same author', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z', undefined, '1', alice);
    const bobReply = makeTweet('2', '2020-01-02T00:00:00Z', '1', '1', bob); // bob replies, not self-reply
    const result = addThreadMetadata(root, [root, bobReply]);
    expect(result.threadPosition).toBe('standalone');
    expect(result.hasSelfReplies).toBe(false);
  });
});

describe('filterFullChain', () => {
  it('returns ancestors + descendants from the bookmark only', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z');
    const replyA = makeTweet('2', '2020-01-02T00:00:00Z', '1');
    const bookmark = makeTweet('3', '2020-01-03T00:00:00Z', '2');
    const childA = makeTweet('4', '2020-01-04T00:00:00Z', '3');
    const childB = makeTweet('7', '2020-01-05T00:00:00Z', '4');
    const siblingOfAncestor = makeTweet('5', '2020-01-06T00:00:00Z', '2');
    const siblingOfRoot = makeTweet('6', '2020-01-07T00:00:00Z', '1');

    const tweets = [siblingOfAncestor, childB, root, siblingOfRoot, bookmark, childA, replyA];

    const result = filterFullChain(tweets, bookmark);
    expect(result.map((tweet) => tweet.id)).toEqual(['1', '2', '3', '4', '7']);
  });

  it('includes ancestor branches when requested', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z');
    const replyA = makeTweet('2', '2020-01-02T00:00:00Z', '1');
    const bookmark = makeTweet('3', '2020-01-03T00:00:00Z', '2');
    const childA = makeTweet('4', '2020-01-04T00:00:00Z', '3');
    const childB = makeTweet('7', '2020-01-05T00:00:00Z', '4');
    const siblingOfAncestor = makeTweet('5', '2020-01-06T00:00:00Z', '2');
    const siblingOfRoot = makeTweet('6', '2020-01-07T00:00:00Z', '1');

    const tweets = [siblingOfRoot, childA, replyA, childB, bookmark, root, siblingOfAncestor];

    const result = filterFullChain(tweets, bookmark, { includeAncestorBranches: true });
    expect(result.map((tweet) => tweet.id)).toEqual(['1', '2', '3', '4', '7', '5', '6']);
  });
});
