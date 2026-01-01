import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildSearchFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientSearchMethods {
  search(query: string, count?: number): Promise<SearchResult>;
}

export function withSearch<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientSearchMethods> {
  abstract class TwitterClientSearch extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Search for tweets matching a query
     */
    async search(query: string, count = 20): Promise<SearchResult> {
      const features = buildSearchFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;

      const fetchPage = async (pageCount: number, pageCursor?: string) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getSearchTimelineQueryIds();

        for (const queryId of queryIds) {
          const variables = {
            rawQuery: query,
            count: pageCount,
            querySource: 'typed_query',
            product: 'Latest',
            ...(pageCursor ? { cursor: pageCursor } : {}),
          };

          const params = new URLSearchParams({
            variables: JSON.stringify(variables),
          });

          const url = `${TWITTER_API_BASE}/${queryId}/SearchTimeline?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'POST',
              headers: this.getHeaders(),
              body: JSON.stringify({ features, queryId }),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
            }

            const data = (await response.json()) as {
              data?: {
                search_by_raw_query?: {
                  search_timeline?: {
                    timeline?: {
                      instructions?: Array<{
                        entries?: Array<{
                          content?: {
                            itemContent?: {
                              tweet_results?: {
                                result?: {
                                  rest_id?: string;
                                  legacy?: {
                                    full_text?: string;
                                    created_at?: string;
                                    reply_count?: number;
                                    retweet_count?: number;
                                    favorite_count?: number;
                                    in_reply_to_status_id_str?: string;
                                  };
                                  core?: {
                                    user_results?: {
                                      result?: {
                                        legacy?: {
                                          screen_name?: string;
                                          name?: string;
                                        };
                                      };
                                    };
                                  };
                                };
                              };
                            };
                          };
                        }>;
                      }>;
                    };
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
            const pageTweets = parseTweetsFromInstructions(instructions, this.quoteDepth);
            const nextCursor = extractCursorFromInstructions(instructions);

            return { success: true as const, tweets: pageTweets, cursor: nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching search results', had404 };
      };

      const fetchWithRefresh = async (pageCount: number, pageCursor?: string) => {
        const firstAttempt = await fetchPage(pageCount, pageCursor);
        if (firstAttempt.success) {
          return firstAttempt;
        }
        if (firstAttempt.had404) {
          await this.refreshQueryIds();
          const secondAttempt = await fetchPage(pageCount, pageCursor);
          if (secondAttempt.success) {
            return secondAttempt;
          }
          return { success: false as const, error: secondAttempt.error };
        }
        return { success: false as const, error: firstAttempt.error };
      };

      while (tweets.length < count) {
        const pageCount = Math.min(pageSize, count - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          if (tweets.length >= count) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }
  }

  return TwitterClientSearch;
}
