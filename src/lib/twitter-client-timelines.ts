import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildBookmarksFeatures, buildLikesFeatures } from './twitter-client-features.js';
import type { GraphqlTweetResult, SearchResult } from './twitter-client-types.js';
import { parseTweetsFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientTimelineMethods {
  getBookmarks(count?: number): Promise<SearchResult>;
  getLikes(count?: number): Promise<SearchResult>;
  getBookmarkFolderTimeline(folderId: string, count?: number): Promise<SearchResult>;
}

export function withTimelines<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientTimelineMethods> {
  abstract class TwitterClientTimelines extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getBookmarksQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Bookmarks');
      return Array.from(new Set([primary, 'RV1g3b8n_SGOHwkqKYSCFw', 'tmd4ifV8RHltzn8ymGg1aw']));
    }

    private async getBookmarkFolderQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('BookmarkFolderTimeline');
      return Array.from(new Set([primary, 'KJIQpsvxrTfRIlbaRIySHQ']));
    }

    private async getLikesQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Likes');
      return Array.from(new Set([primary, 'JR2gceKucIKcVNB_9JkhsA']));
    }

    /**
     * Get the authenticated user's bookmarks
     */
    async getBookmarks(count = 20): Promise<SearchResult> {
      const variables = {
        count,
        includePromotedContent: false,
        withDownvotePerspective: false,
        withReactionsMetadata: false,
        withReactionsPerspective: false,
      };

      const features = buildBookmarksFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarksQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Bookmarks?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
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
                bookmark_timeline_v2?: {
                  timeline?: {
                    instructions?: Array<{
                      entries?: Array<{
                        content?: {
                          itemContent?: {
                            tweet_results?: {
                              result?: GraphqlTweetResult;
                            };
                          };
                        };
                      }>;
                    }>;
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.bookmark_timeline_v2?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, this.quoteDepth);

            return { success: true as const, tweets, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmarks', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, tweets: firstAttempt.tweets };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, tweets: secondAttempt.tweets };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }

    /**
     * Get the authenticated user's liked tweets
     */
    async getLikes(count = 20): Promise<SearchResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const variables = {
        userId: userResult.user.id,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
      };

      const features = buildLikesFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getLikesQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Likes?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
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
                user?: {
                  result?: {
                    timeline?: {
                      timeline?: {
                        instructions?: Array<{
                          entries?: Array<{
                            content?: {
                              itemContent?: {
                                tweet_results?: {
                                  result?: GraphqlTweetResult;
                                };
                              };
                            };
                          }>;
                        }>;
                      };
                    };
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, this.quoteDepth);

            return { success: true as const, tweets, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching likes', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, tweets: firstAttempt.tweets };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, tweets: secondAttempt.tweets };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }

    /**
     * Get the authenticated user's bookmark folder timeline
     */
    async getBookmarkFolderTimeline(folderId: string, count = 20): Promise<SearchResult> {
      const variablesWithCount = {
        bookmark_collection_id: folderId,
        includePromotedContent: true,
        count,
      };

      const variablesWithoutCount = {
        bookmark_collection_id: folderId,
        includePromotedContent: true,
      };

      const features = buildBookmarksFeatures();

      const tryOnce = async (variables: Record<string, unknown>) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarkFolderQueryIds();

        const params = new URLSearchParams({
          variables: JSON.stringify(variables),
          features: JSON.stringify(features),
        });

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/BookmarkFolderTimeline?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
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
                bookmark_collection_timeline?: {
                  timeline?: {
                    instructions?: Array<{
                      entries?: Array<{
                        content?: {
                          itemContent?: {
                            tweet_results?: {
                              result?: GraphqlTweetResult;
                            };
                          };
                        };
                      }>;
                    }>;
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.bookmark_collection_timeline?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, this.quoteDepth);

            return { success: true as const, tweets, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmark folder', had404 };
      };

      let firstAttempt = await tryOnce(variablesWithCount);
      if (!firstAttempt.success && firstAttempt.error?.includes('Variable "$count"')) {
        firstAttempt = await tryOnce(variablesWithoutCount);
      }
      if (firstAttempt.success) {
        return { success: true, tweets: firstAttempt.tweets };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        let secondAttempt = await tryOnce(variablesWithCount);
        if (!secondAttempt.success && secondAttempt.error?.includes('Variable "$count"')) {
          secondAttempt = await tryOnce(variablesWithoutCount);
        }
        if (secondAttempt.success) {
          return { success: true, tweets: secondAttempt.tweets };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }
  }

  return TwitterClientTimelines;
}
