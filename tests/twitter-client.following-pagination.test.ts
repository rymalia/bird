import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import type { TwitterClientPrivate } from './twitter-client-fixtures.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

const makeUserEntry = (id: string, username: string, name: string) => ({
  content: {
    itemContent: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: id,
          legacy: {
            screen_name: username,
            name,
            followers_count: 10,
            friends_count: 5,
            profile_image_url_https: 'https://img/test_normal.jpg',
          },
          is_blue_verified: false,
          core: {
            screen_name: username,
            name,
          },
        },
      },
    },
  },
});

describe('TwitterClient following pagination', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('paginates following results with cursor', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          makeUserEntry('1', 'alice', 'Alice'),
                          { content: { cursorType: 'Bottom', value: 'cursor-2' } },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [makeUserEntry('2', 'bob', 'Bob')],
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    clientPrivate.getFollowingQueryIds = async () => ['q1'];
    clientPrivate.getFollowingViaRest = vi.fn();

    const result = await client.getFollowing('user-id', 3);

    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(2);
    expect(result.users?.[0].username).toBe('alice');
    expect(result.users?.[1].username).toBe('bob');
    expect(result.nextCursor).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns error when a later page fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          makeUserEntry('1', 'alice', 'Alice'),
                          { content: { cursorType: 'Bottom', value: 'cursor-2' } },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'boom',
      });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    clientPrivate.getFollowingQueryIds = async () => ['q1'];
    clientPrivate.getFollowingViaRest = vi.fn().mockResolvedValue({ success: false, error: 'rest fail' });

    const result = await client.getFollowing('user-id', 3);

    expect(result.success).toBe(false);
    expect(result.users).toHaveLength(1);
    expect(result.error).toContain('500');
    expect(result.nextCursor).toBe('cursor-2');
  });
});
