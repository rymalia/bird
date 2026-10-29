import { describe, expect, it } from 'vitest';
import type { GraphqlTweetResult } from '../src/lib/twitter-client-types.js';
import { mapTweetResult } from '../src/lib/twitter-client-utils.js';

describe('mapTweetResult language fields', () => {
  const makeUserResult = (screenName: string) => ({
    core: {
      user_results: {
        result: {
          rest_id: `u-${screenName}`,
          legacy: { screen_name: screenName, name: screenName },
        },
      },
    },
  });

  it('maps lang and isTranslatable for the tweet and its quoted tweet', () => {
    const result: GraphqlTweetResult = {
      rest_id: '1',
      is_translatable: false,
      legacy: { full_text: 'quoting this', lang: 'en' },
      ...makeUserResult('alice'),
      quoted_status_result: {
        result: {
          rest_id: '2',
          is_translatable: true,
          legacy: { full_text: '新年第一天', lang: 'zh' },
          ...makeUserResult('bob'),
        },
      },
    };

    const mapped = mapTweetResult(result, 1);
    expect(mapped?.lang).toBe('en');
    expect(mapped?.isTranslatable).toBe(false);
    expect(mapped?.quotedTweet?.lang).toBe('zh');
    expect(mapped?.quotedTweet?.isTranslatable).toBe(true);
  });

  it('leaves both fields out of JSON when X omits them', () => {
    const result: GraphqlTweetResult = {
      rest_id: '1',
      legacy: { full_text: 'hello' },
      ...makeUserResult('alice'),
    };

    const json = JSON.parse(JSON.stringify(mapTweetResult(result, 0)));
    expect(json).not.toHaveProperty('lang');
    expect(json).not.toHaveProperty('isTranslatable');
  });
});
