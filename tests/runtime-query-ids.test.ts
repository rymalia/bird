import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRuntimeQueryIdStore,
  discoverQueryIds,
  parseLazyChunkUrls,
  runtimeQueryIds,
} from '../src/lib/runtime-query-ids.js';
import { TwitterClientBase } from '../src/lib/twitter-client-base.js';
import { QUERY_IDS } from '../src/lib/twitter-client-constants.js';
import type { CurrentUserResult, TwitterClientOptions } from '../src/lib/twitter-client-types.js';

describe('runtime-query-ids', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.BIRD_QUERY_IDS_CACHE;
    process.env.BIRD_QUERY_IDS_AUTO_REFRESH = '0';
  });

  it('refreshes IDs by scanning discovered bundles and persists cache', async () => {
    const cacheDir = path.join(os.tmpdir(), `bird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');

    const html = `
      <html>
        <script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>
      </html>
    `;
    const js = [
      `e.exports={queryId:"AAA",operationName:"CreateTweet"}`,
      `e.exports={queryId:"BBB",operationName:"CreateRetweet"}`,
      `e.exports={queryId:"CCC",operationName:"FavoriteTweet"}`,
      `e.exports={queryId:"DDD",operationName:"TweetDetail"}`,
      `e.exports={queryId:"EEE",operationName:"SearchTimeline"}`,
      `e.exports={queryId:"FFF",operationName:"UserArticlesTweets"}`,
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL) => {
      const asString = String(url);
      if (asString.startsWith('https://x.com/')) {
        return new Response(html, { status: 200 });
      }
      if (asString.startsWith('https://abs.twimg.com/')) {
        return new Response(js, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const store = createRuntimeQueryIdStore({
      cachePath,
      ttlMs: 1000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const info = await store.refresh(
      ['CreateTweet', 'CreateRetweet', 'FavoriteTweet', 'TweetDetail', 'SearchTimeline', 'UserArticlesTweets'],
      { force: true },
    );

    expect(info?.snapshot.ids.CreateTweet).toBe('AAA');
    expect(info?.snapshot.ids.TweetDetail).toBe('DDD');
    expect(info?.cachePath).toBe(cachePath);

    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as { ids?: Record<string, string> };
    expect(parsed.ids?.SearchTimeline).toBe('EEE');
  });

  it('uses env cache path override and returns fresh snapshot without refreshing', async () => {
    const cacheDir = path.join(os.tmpdir(), `bird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids-cache.json');
    process.env.BIRD_QUERY_IDS_CACHE = cachePath;

    const snapshot = {
      fetchedAt: new Date().toISOString(),
      ttlMs: 60_000,
      ids: { CreateTweet: 'AAA' },
      discovery: { pages: ['https://x.com/'], bundles: ['main.js'] },
    };
    await writeFile(cachePath, JSON.stringify(snapshot), 'utf8');

    const fetchMock = vi.fn();
    const store = createRuntimeQueryIdStore({ fetchImpl: fetchMock as unknown as typeof fetch });
    const info = await store.refresh(['CreateTweet']);

    expect(store.cachePath).toBe(cachePath);
    expect(info?.snapshot.ids.CreateTweet).toBe('AAA');
    expect(fetchMock).not.toHaveBeenCalled();

    store.clearMemory();
  });

  it('returns current snapshot when refresh finds no matching operations', async () => {
    const cacheDir = path.join(os.tmpdir(), `bird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');

    const snapshot = {
      fetchedAt: new Date(0).toISOString(),
      ttlMs: 1,
      ids: { CreateTweet: 'AAA' },
      discovery: { pages: ['https://x.com/'], bundles: ['main.test.js'] },
    };
    await writeFile(cachePath, JSON.stringify(snapshot), 'utf8');

    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>`;
    const js = 'console.log("no ops here")';

    const fetchMock = vi.fn(async (url: string | URL) => {
      const asString = String(url);
      if (asString.startsWith('https://x.com/')) {
        return new Response(html, { status: 200 });
      }
      if (asString.startsWith('https://abs.twimg.com/')) {
        return new Response(js, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const store = createRuntimeQueryIdStore({
      cachePath,
      ttlMs: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const info = await store.refresh(['CreateTweet']);
    expect(info?.snapshot.ids.CreateTweet).toBe('AAA');
  });

  it('throws when no bundles can be discovered', async () => {
    const cacheDir = path.join(os.tmpdir(), `bird-test-${randomUUID()}`);
    await mkdir(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, 'query-ids.json');

    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));

    const store = createRuntimeQueryIdStore({
      cachePath,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(store.refresh(['CreateTweet'], { force: true })).rejects.toThrow(
      'No client bundles discovered; x.com layout may have changed.',
    );
  });

  it('parses named, numeric fallback, and skipped lazy chunk entries', () => {
    return readFile(path.join(process.cwd(), 'tests/fixtures/x-home-chunk-runtime.js'), 'utf8').then((html) => {
      const urls = parseLazyChunkUrls(html);
      expect(urls).toContain('https://abs.twimg.com/responsive-web/client-web/bundle.Bookmarks.adec4597d6fda51da.js');
      expect(urls).toContain('https://abs.twimg.com/responsive-web/client-web/38.e1286bceaaaddc3da.js');
      expect(urls.some((url) => url.includes('/i18n/'))).toBe(false);
      expect(urls.some((url) => url.includes('/icons.'))).toBe(false);
    });
  });

  it('finds an authenticated operation in a lazy chunk', async () => {
    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>({34778:"shared~bundle.Bookmarks"}[e]||e)+"."+({34778:"abc"})[e]+"a.js"`;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value === 'https://x.com/home') {
        return new Response(html);
      }
      if (value.endsWith('/main.test.js')) {
        return new Response('main has no target');
      }
      if (value.endsWith('/shared~bundle.Bookmarks.abca.js')) {
        return new Response('e.exports={queryId:"LAZY",operationName:"Bookmarks"}');
      }
      return new Response('', { status: 404 });
    });
    const result = await discoverQueryIds({
      fetchImpl: fetchMock as unknown as typeof fetch,
      cookieHeader: 'auth_token=a; ct0=b',
      targets: ['Bookmarks'],
    });
    expect(result.discovered.get('Bookmarks')?.queryId).toBe('LAZY');
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === 'https://x.com/home' &&
          (init as RequestInit).headers &&
          (init as RequestInit).headers instanceof Object,
      ),
    ).toBe(true);
  });

  it('merges partial discoveries and leaves the cache untouched on empty discovery', async () => {
    const cachePath = path.join(os.tmpdir(), `bird-test-${randomUUID()}`, 'query-ids.json');
    await mkdir(path.dirname(cachePath), { recursive: true });
    const original = {
      fetchedAt: new Date(0).toISOString(),
      ttlMs: 1,
      ids: { Bookmarks: 'OLD', Following: 'KEEP' },
      discovery: { pages: [], bundles: [] },
    };
    await writeFile(cachePath, JSON.stringify(original), 'utf8');
    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>`;
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).startsWith('https://x.com/')
        ? new Response(html)
        : new Response('e.exports={queryId:"NEW",operationName:"Bookmarks"}'),
    );
    const store = createRuntimeQueryIdStore({ cachePath, fetchImpl: fetchMock as unknown as typeof fetch, ttlMs: 1 });
    const refreshed = await store.refresh(['Bookmarks'], { force: true });
    expect(refreshed?.snapshot.ids).toMatchObject({ Bookmarks: 'NEW', Following: 'KEEP' });
    const backoff = JSON.parse(await readFile(`${cachePath.replace('.json', '')}.refresh-state.json`, 'utf8')) as {
      nextAttemptAt: number;
    };
    expect(backoff.nextAttemptAt).toBe(0);

    const beforeEmpty = await readFile(cachePath, 'utf8');
    const empty = createRuntimeQueryIdStore({
      cachePath,
      fetchImpl: vi.fn(async (url: string | URL) =>
        String(url).startsWith('https://x.com/') ? new Response(html) : new Response('no operations'),
      ) as unknown as typeof fetch,
    });
    await empty.refresh(['MissingOperation'], { force: true });
    expect(await readFile(cachePath, 'utf8')).toBe(beforeEmpty);
  });

  it('keys concurrent refreshes by operation set', async () => {
    const cachePath = path.join(os.tmpdir(), `bird-test-${randomUUID()}`, 'query-ids.json');
    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>`;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.startsWith('https://x.com/')) {
        return new Response(html);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        'e.exports={queryId:"AAA",operationName:"CreateTweet"} e.exports={queryId:"BBB",operationName:"FavoriteTweet"}',
      );
    });
    const store = createRuntimeQueryIdStore({ cachePath, fetchImpl: fetchMock as unknown as typeof fetch });
    const secondStore = createRuntimeQueryIdStore({ cachePath, fetchImpl: fetchMock as unknown as typeof fetch });
    const [one, two] = await Promise.all([
      store.refresh(['CreateTweet'], { force: true }),
      secondStore.refresh(['FavoriteTweet'], { force: true }),
    ]);
    expect(one?.snapshot.ids.CreateTweet).toBe('AAA');
    expect(two?.snapshot.ids.FavoriteTweet).toBe('BBB');
    const saved = JSON.parse(await readFile(cachePath, 'utf8')) as { ids: Record<string, string> };
    expect(saved.ids).toMatchObject({ CreateTweet: 'AAA', FavoriteTweet: 'BBB' });
  });

  it('sends cookies only to authenticated HTML, never to bundle requests', async () => {
    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>`;
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url) === 'https://x.com/home'
        ? new Response(html)
        : new Response('e.exports={queryId:"AAA",operationName:"CreateTweet"}'),
    );
    await discoverQueryIds({
      fetchImpl: fetchMock as unknown as typeof fetch,
      cookieHeader: 'auth_token=secret; ct0=csrf',
      targets: ['CreateTweet'],
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ cookie: 'auth_token=secret; ct0=csrf' }),
      redirect: 'manual',
    });
    const bundleCookieHeaders = fetchMock.mock.calls
      .filter(([url]) => String(url).startsWith('https://abs.twimg.com/'))
      .map(([, init]) => (init as RequestInit).headers && new Headers(init?.headers).get('cookie'));
    expect(bundleCookieHeaders).toEqual([null]);
  });

  it('stops at the shared deadline while persisting already discovered IDs', async () => {
    const cachePath = path.join(os.tmpdir(), `bird-test-${randomUUID()}`, 'query-ids.json');
    const html = [
      '<script src="https://abs.twimg.com/responsive-web/client-web/1-main.test.js"></script>',
      '<script src="https://abs.twimg.com/responsive-web/client-web/2-slow.test.js"></script>',
    ].join('');
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.startsWith('https://x.com/')) {
        return new Response(html);
      }
      if (value.endsWith('1-main.test.js')) {
        return new Response('e.exports={queryId:"PARTIAL",operationName:"CreateTweet"}');
      }
      return new Promise<Response>(() => undefined);
    });
    const store = createRuntimeQueryIdStore({
      cachePath,
      fetchImpl: fetchMock as unknown as typeof fetch,
      discoveryDeadlineMs: 25,
      fetchConcurrency: 1,
    });
    await store.refresh(['CreateTweet', 'FavoriteTweet'], { force: true });
    const saved = JSON.parse(await readFile(cachePath, 'utf8')) as { ids: Record<string, string> };
    expect(saved.ids.CreateTweet).toBe('PARTIAL');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('2-slow.test.js'))).toBe(true);
  });

  it('skips discovery when another store owns the refresh lock', async () => {
    const cachePath = path.join(os.tmpdir(), `bird-test-${randomUUID()}`, 'query-ids.json');
    const lockPath = `${cachePath.replace('.json', '')}.refresh-lock`;
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(lockPath, 'busy', 'utf8');
    const fetchMock = vi.fn(async () => new Response('should not fetch'));
    const store = createRuntimeQueryIdStore({ cachePath, fetchImpl: fetchMock as unknown as typeof fetch });
    const autoSetting = process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    delete process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    await store.autoRefresh(['CreateTweet'], 'auth_token=a; ct0=b');
    expect(fetchMock).not.toHaveBeenCalled();
    if (autoSetting === undefined) {
      delete process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    } else {
      process.env.BIRD_QUERY_IDS_AUTO_REFRESH = autoSetting;
    }
  });

  it('does not auto-refresh for an operation missing from a fresh snapshot', async () => {
    class QueryIdClient extends TwitterClientBase {
      protected async getCurrentUser(): Promise<CurrentUserResult> {
        return { success: false };
      }

      queryId(operationName: 'FavoriteTweet') {
        return this.getQueryId(operationName);
      }
    }
    const options: TwitterClientOptions = {
      cookies: { authToken: 'a', ct0: 'b', cookieHeader: 'auth_token=a; ct0=b', source: null },
    };
    vi.spyOn(runtimeQueryIds, 'getSnapshotInfo').mockResolvedValue({
      snapshot: {
        fetchedAt: new Date().toISOString(),
        ttlMs: 60_000,
        ids: { CreateTweet: 'fresh' },
        discovery: { pages: [], bundles: [] },
      },
      cachePath: '/tmp/query-ids.json',
      ageMs: 0,
      isFresh: true,
    });
    vi.spyOn(runtimeQueryIds, 'getQueryId').mockResolvedValue(null);
    const autoRefresh = vi.spyOn(runtimeQueryIds, 'autoRefresh').mockResolvedValue();
    expect(await new QueryIdClient(options).queryId('FavoriteTweet')).toBe(QUERY_IDS.FavoriteTweet);
    expect(autoRefresh).not.toHaveBeenCalled();
  });

  it('auto-refreshes with the client cookie when the snapshot is stale', async () => {
    class QueryIdClient extends TwitterClientBase {
      protected async getCurrentUser(): Promise<CurrentUserResult> {
        return { success: false };
      }

      queryId(operationName: 'FavoriteTweet') {
        return this.getQueryId(operationName);
      }
    }
    const options: TwitterClientOptions = {
      cookies: { authToken: 'a', ct0: 'b', cookieHeader: 'auth_token=a; ct0=b', source: null },
    };
    vi.spyOn(runtimeQueryIds, 'getSnapshotInfo').mockResolvedValue({
      snapshot: {
        fetchedAt: new Date(0).toISOString(),
        ttlMs: 60_000,
        ids: { FavoriteTweet: 'stale' },
        discovery: { pages: [], bundles: [] },
      },
      cachePath: '/tmp/query-ids.json',
      ageMs: Number.POSITIVE_INFINITY,
      isFresh: false,
    });
    vi.spyOn(runtimeQueryIds, 'getQueryId').mockResolvedValue('refreshed');
    const autoRefresh = vi.spyOn(runtimeQueryIds, 'autoRefresh').mockResolvedValue();
    expect(await new QueryIdClient(options).queryId('FavoriteTweet')).toBe('refreshed');
    expect(autoRefresh).toHaveBeenCalledWith(expect.arrayContaining(['FavoriteTweet']), 'auth_token=a; ct0=b');
  });

  it('persists backoff across stores and lets forced refresh run', async () => {
    delete process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    const cachePath = path.join(os.tmpdir(), `bird-test-${randomUUID()}`, 'query-ids.json');
    const fetchMock = vi.fn(async () => new Response('failure', { status: 500 }));
    const options = { cachePath, fetchImpl: fetchMock as unknown as typeof fetch, now: () => 10_000_000 };
    const first = createRuntimeQueryIdStore(options);
    const second = createRuntimeQueryIdStore(options);
    await first.autoRefresh(['CreateTweet'], 'auth_token=a; ct0=b');
    const countAfterFirst = fetchMock.mock.calls.length;
    await second.autoRefresh(['CreateTweet'], 'auth_token=a; ct0=b');
    expect(fetchMock).toHaveBeenCalledTimes(countAfterFirst);
    await expect(second.refresh(['CreateTweet'], { force: true, cookieHeader: 'auth_token=a; ct0=b' })).rejects.toThrow(
      'No client bundles discovered',
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThan(countAfterFirst);
    process.env.BIRD_QUERY_IDS_AUTO_REFRESH = '0';
  });

  it('auto-refreshes a stale snapshot and returns the discovered ID from storage', async () => {
    const autoRefreshSetting = process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    delete process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    const cachePath = path.join(os.tmpdir(), `bird-test-${randomUUID()}`, 'query-ids.json');
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date(0).toISOString(),
        ttlMs: 1,
        ids: { CreateTweet: 'OLD' },
        discovery: { pages: [], bundles: [] },
      }),
      'utf8',
    );
    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.test.js"></script>`;
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).startsWith('https://x.com/')
        ? new Response(html)
        : new Response('e.exports={queryId:"NEW",operationName:"CreateTweet"}'),
    );
    const store = createRuntimeQueryIdStore({
      cachePath,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => Date.now(),
    });
    const before = await store.getSnapshotInfo();
    await store.autoRefresh(['CreateTweet'], 'auth_token=a; ct0=b');
    expect(await store.getQueryId('CreateTweet')).toBe('NEW');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://x.com/home')).toBe(true);
    expect((await store.getSnapshotInfo())?.snapshot.fetchedAt).not.toBe(before?.snapshot.fetchedAt);
    if (autoRefreshSetting === undefined) {
      delete process.env.BIRD_QUERY_IDS_AUTO_REFRESH;
    } else {
      process.env.BIRD_QUERY_IDS_AUTO_REFRESH = autoRefreshSetting;
    }
  });
});
