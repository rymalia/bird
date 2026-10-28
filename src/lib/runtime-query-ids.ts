import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_CACHE_FILENAME = 'query-ids-cache.json';
const DEFAULT_TTL_MS: number = 24 * 60 * 60 * 1000;
const DEFAULT_DISCOVERY_DEADLINE_MS = 20_000;
const MAX_LAZY_CHUNKS = 600;
const DEFAULT_FETCH_CONCURRENCY = 12;
const DEFAULT_LOCK_MAX_AGE_MS = 2 * 60 * 1000;

const DISCOVERY_PAGES: string[] = [
  'https://x.com/?lang=en',
  'https://x.com/explore',
  'https://x.com/notifications',
  'https://x.com/settings/profile',
];

const BUNDLE_URL_REGEX = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;
const QUERY_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const CHUNK_MAP_REGEX =
  /\(\s*\(?\s*(\{[^{}]*\})\s*\)?\s*\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.\s*["']\s*\+\s*\((\{[^{}]*\})\)\[e\]/g;
const CHUNK_ENTRY_REGEX = /(?:^|[,{}])\s*(\d+)\s*:\s*["']([^"']+)["']/g;
const SKIPPED_CHUNK_REGEX = /^(i18n\/|icons|emoji|countries)/i;
const PRIORITY_CHUNK_REGEX = /\/(?:bundle\.|shared~|loader\.|ondemand\.)/;
const JSON_SUFFIX_REGEX = /\.json$/i;

const OPERATION_PATTERNS = [
  {
    regex: /e\.exports=\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/gs,
    operationGroup: 2,
    queryIdGroup: 1,
  },
  {
    regex: /e\.exports=\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']/gs,
    operationGroup: 1,
    queryIdGroup: 2,
  },
  {
    regex: /operationName\s*[:=]\s*["']([^"']+)["'](.{0,4000}?)queryId\s*[:=]\s*["']([^"']+)["']/gs,
    operationGroup: 1,
    queryIdGroup: 3,
  },
  {
    regex: /queryId\s*[:=]\s*["']([^"']+)["'](.{0,4000}?)operationName\s*[:=]\s*["']([^"']+)["']/gs,
    operationGroup: 3,
    queryIdGroup: 1,
  },
] as const;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export type RuntimeQueryIdSnapshot = {
  fetchedAt: string;
  ttlMs: number;
  ids: Record<string, string>;
  discovery: {
    pages: string[];
    bundles: string[];
    foundOperations?: string[];
  };
};

export type RuntimeQueryIdSnapshotInfo = {
  snapshot: RuntimeQueryIdSnapshot;
  cachePath: string;
  ageMs: number;
  isFresh: boolean;
};

export type RuntimeQueryIdsOptions = {
  cachePath?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  discoveryDeadlineMs?: number;
  fetchConcurrency?: number;
  lockMaxAgeMs?: number;
};

export type DiscoverQueryIdsOptions = {
  fetchImpl?: typeof fetch;
  cookieHeader?: string;
  targets: string[];
  deadlineMs?: number;
  concurrency?: number;
};

export type DiscoveredQueryId = { queryId: string; bundle: string };

export type RuntimeQueryIdStore = {
  cachePath: string;
  ttlMs: number;
  getSnapshotInfo: () => Promise<RuntimeQueryIdSnapshotInfo | null>;
  getQueryId: (operationName: string) => Promise<string | null>;
  refresh: (
    operationNames: string[],
    opts?: { force?: boolean; cookieHeader?: string },
  ) => Promise<RuntimeQueryIdSnapshotInfo | null>;
  autoRefresh: (operationNames: string[], cookieHeader: string) => Promise<void>;
  clearRefreshBackoff: () => Promise<void>;
  clearMemory: () => void;
};

async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
  redirect?: RequestInit['redirect'],
): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { ...HEADERS, ...extraHeaders },
    signal,
    redirect,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 120)}`);
  }
  return response.text();
}

function resolveDefaultCachePath(): string {
  const override = process.env.BIRD_QUERY_IDS_CACHE;
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.join(homedir(), '.config', 'bird', DEFAULT_CACHE_FILENAME);
}

function parseSnapshot(raw: unknown): RuntimeQueryIdSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const fetchedAt = typeof record.fetchedAt === 'string' ? record.fetchedAt : null;
  const ttlMs = typeof record.ttlMs === 'number' && Number.isFinite(record.ttlMs) ? record.ttlMs : null;
  const ids = record.ids && typeof record.ids === 'object' ? (record.ids as Record<string, unknown>) : null;
  const discovery =
    record.discovery && typeof record.discovery === 'object' ? (record.discovery as Record<string, unknown>) : null;

  if (!fetchedAt || !ttlMs || !ids || !discovery) {
    return null;
  }
  const pages = Array.isArray(discovery.pages) ? discovery.pages : null;
  const bundles = Array.isArray(discovery.bundles) ? discovery.bundles : null;
  if (!pages || !bundles) {
    return null;
  }

  const normalizedIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(ids)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      normalizedIds[key] = value.trim();
    }
  }

  return {
    fetchedAt,
    ttlMs,
    ids: normalizedIds,
    discovery: {
      pages: pages.filter((p) => typeof p === 'string') as string[],
      bundles: bundles.filter((b) => typeof b === 'string') as string[],
      ...(Array.isArray(discovery.foundOperations)
        ? { foundOperations: discovery.foundOperations.filter((op) => typeof op === 'string') as string[] }
        : {}),
    },
  };
}

async function readSnapshotFromDisk(cachePath: string): Promise<RuntimeQueryIdSnapshot | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeSnapshotToDisk(cachePath: string, snapshot: RuntimeQueryIdSnapshot): Promise<void> {
  await writeFileAtomic(cachePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(tempPath, contents, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

type DiscoveryContext = {
  signal: AbortSignal;
  deadline: Promise<void>;
  deadlineReached: () => boolean;
};

async function fetchForDiscovery(
  fetchImpl: typeof fetch,
  url: string,
  context: DiscoveryContext,
  headers: Record<string, string> = {},
  redirect?: RequestInit['redirect'],
): Promise<string> {
  return Promise.race([
    fetchText(fetchImpl, url, headers, context.signal, redirect),
    context.deadline.then(() => {
      throw new Error('Query ID discovery deadline exceeded');
    }),
  ]);
}

export function parseLazyChunkUrls(html: string): string[] {
  const objects = [...html.matchAll(CHUNK_MAP_REGEX)];
  const urls: string[] = [];
  for (const match of objects) {
    try {
      const parseMap = (source: string): Record<string, string> => {
        const entries: Record<string, string> = {};
        for (const entry of source.matchAll(CHUNK_ENTRY_REGEX)) {
          const id = entry[1];
          const value = entry[2];
          if (id && value) {
            entries[id] = value;
          }
        }
        return entries;
      };
      const nameMap = match[1];
      const hashMap = match[2];
      if (!nameMap || !hashMap) {
        continue;
      }
      const names = parseMap(nameMap);
      const hashes = parseMap(hashMap);
      for (const [id, hash] of Object.entries(hashes)) {
        const name = names[id] ?? id;
        if (SKIPPED_CHUNK_REGEX.test(name)) {
          continue;
        }
        urls.push(`https://abs.twimg.com/responsive-web/client-web/${name}.${hash}a.js`);
      }
    } catch {
      // Ignore malformed chunk maps and continue scanning other maps.
    }
  }
  return [...new Set(urls)];
}

function sortLazyChunks(urls: string[]): string[] {
  return urls.sort((a, b) => Number(!PRIORITY_CHUNK_REGEX.test(a)) - Number(!PRIORITY_CHUNK_REGEX.test(b)));
}

async function discoverBundles(
  fetchImpl: typeof fetch,
  context: DiscoveryContext,
  cookieHeader?: string,
): Promise<{ bundles: string[]; pages: string[]; lazyChunks: string[] }> {
  if (cookieHeader) {
    try {
      const html = await fetchForDiscovery(
        fetchImpl,
        'https://x.com/home',
        context,
        { cookie: cookieHeader },
        'manual',
      );
      const bundles = [...new Set([...html.matchAll(BUNDLE_URL_REGEX)].map((match) => match[0]))];
      if (bundles.length > 0) {
        bundles.sort((a, b) => Number(a.includes('vendor.')) - Number(b.includes('vendor.')));
        return {
          bundles,
          pages: ['https://x.com/home'],
          lazyChunks: sortLazyChunks(parseLazyChunkUrls(html)).slice(0, MAX_LAZY_CHUNKS),
        };
      }
    } catch {
      // Fall back to anonymous discovery.
    }
  }
  const bundles = new Set<string>();
  for (const page of DISCOVERY_PAGES) {
    if (context.deadlineReached()) {
      break;
    }
    try {
      const html = await fetchForDiscovery(fetchImpl, page, context);
      for (const match of html.matchAll(BUNDLE_URL_REGEX)) {
        bundles.add(match[0]);
      }
    } catch {
      // ignore discovery page failures; other pages often work
    }
  }
  const discovered = [...bundles].sort((a, b) => Number(a.includes('vendor.')) - Number(b.includes('vendor.')));
  if (discovered.length === 0) {
    throw new Error('No client bundles discovered; x.com layout may have changed.');
  }
  return { bundles: discovered, pages: [...DISCOVERY_PAGES], lazyChunks: [] };
}

function extractOperations(
  bundleContents: string,
  bundleLabel: string,
  targets: Set<string>,
  discovered: Map<string, { queryId: string; bundle: string }>,
): void {
  for (const pattern of OPERATION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    while (true) {
      const match = pattern.regex.exec(bundleContents);
      if (match === null) {
        break;
      }
      const operationName = match[pattern.operationGroup];
      const queryId = match[pattern.queryIdGroup];
      if (!operationName || !queryId) {
        continue;
      }
      if (!targets.has(operationName)) {
        continue;
      }
      if (!QUERY_ID_REGEX.test(queryId)) {
        continue;
      }
      if (discovered.has(operationName)) {
        continue;
      }
      discovered.set(operationName, { queryId, bundle: bundleLabel });
      if (discovered.size === targets.size) {
        return;
      }
    }
  }
}

async function fetchAndExtract(
  fetchImpl: typeof fetch,
  bundleUrls: string[],
  targets: Set<string>,
  context: DiscoveryContext,
  concurrency: number,
): Promise<Map<string, { queryId: string; bundle: string }>> {
  const discovered = new Map<string, { queryId: string; bundle: string }>();
  const contents = new Map<string, string>();

  for (let i = 0; i < bundleUrls.length; i += concurrency) {
    if (context.deadlineReached()) {
      break;
    }
    const chunk = bundleUrls.slice(i, i + concurrency);
    await Promise.race([
      Promise.all(
        chunk.map(async (url) => {
          try {
            contents.set(url, await fetchForDiscovery(fetchImpl, url, context));
          } catch {
            // Ignore failed bundles and continue with the remaining sources.
          }
        }),
      ),
      context.deadline,
    ]);
    for (const url of chunk) {
      const js = contents.get(url);
      if (js) {
        const label = url.split('/').at(-1) ?? url;
        extractOperations(js, label, targets, discovered);
      }
    }
    if (discovered.size === targets.size) {
      break;
    }
  }

  return discovered;
}

export async function discoverQueryIds(options: DiscoverQueryIdsOptions): Promise<{
  discovered: Map<string, DiscoveredQueryId>;
  pages: string[];
  bundles: string[];
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let deadlineHit = false;
  let resolveDeadline = (): void => undefined;
  const deadline = new Promise<void>((resolve) => {
    resolveDeadline = resolve;
  });
  const timer = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
    resolveDeadline();
  }, options.deadlineMs ?? DEFAULT_DISCOVERY_DEADLINE_MS);
  const context = { signal: controller.signal, deadline, deadlineReached: () => deadlineHit };
  try {
    const source = await discoverBundles(fetchImpl, context, options.cookieHeader);
    const targets = new Set(options.targets);
    const discovered = await fetchAndExtract(
      fetchImpl,
      [...source.bundles, ...source.lazyChunks],
      targets,
      context,
      options.concurrency ?? DEFAULT_FETCH_CONCURRENCY,
    );
    return {
      discovered,
      pages: source.pages,
      bundles: [...source.bundles, ...source.lazyChunks].map((url) => url.split('/').at(-1) ?? url),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createRuntimeQueryIdStore(options: RuntimeQueryIdsOptions = {}): RuntimeQueryIdStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cachePath = options.cachePath ? path.resolve(options.cachePath) : resolveDefaultCachePath();
  const discoveryDeadlineMs = options.discoveryDeadlineMs ?? DEFAULT_DISCOVERY_DEADLINE_MS;
  const fetchConcurrency = options.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY;
  const lockMaxAgeMs = options.lockMaxAgeMs ?? DEFAULT_LOCK_MAX_AGE_MS;
  const lockPath = `${cachePath.replace(JSON_SUFFIX_REGEX, '')}.refresh-lock`;
  const writeLockPath = `${cachePath.replace(JSON_SUFFIX_REGEX, '')}.write-lock`;

  let memorySnapshot: RuntimeQueryIdSnapshot | null = null;
  let loadOnce: Promise<RuntimeQueryIdSnapshot | null> | null = null;
  let snapshotWriteQueue: Promise<void> = Promise.resolve();
  const refreshInFlight = new Map<string, Promise<RuntimeQueryIdSnapshotInfo | null>>();
  let autoRefreshAttemptAt: number | null = null;
  const now = options.now ?? Date.now;
  const refreshStatePath = `${cachePath.replace(JSON_SUFFIX_REGEX, '')}.refresh-state.json`;

  const loadSnapshot = async (): Promise<RuntimeQueryIdSnapshot | null> => {
    if (memorySnapshot) {
      return memorySnapshot;
    }
    if (!loadOnce) {
      loadOnce = (async () => {
        const fromDisk = await readSnapshotFromDisk(cachePath);
        memorySnapshot = fromDisk;
        return fromDisk;
      })();
    }
    return loadOnce;
  };

  const getSnapshotInfo = async (): Promise<RuntimeQueryIdSnapshotInfo | null> => {
    const snapshot = await loadSnapshot();
    if (!snapshot) {
      return null;
    }
    const fetchedAtMs = new Date(snapshot.fetchedAt).getTime();
    const ageMs = Number.isFinite(fetchedAtMs) ? Math.max(0, now() - fetchedAtMs) : Number.POSITIVE_INFINITY;
    const effectiveTtl = Number.isFinite(snapshot.ttlMs) ? snapshot.ttlMs : ttlMs;
    const isFresh = ageMs <= effectiveTtl;
    return { snapshot, cachePath, ageMs, isFresh };
  };

  const persistMergedSnapshot = async (
    snapshot: RuntimeQueryIdSnapshot,
    discovered: Map<string, DiscoveredQueryId>,
  ): Promise<RuntimeQueryIdSnapshot> => {
    let releaseWrite: () => void = () => undefined;
    const previousWrite = snapshotWriteQueue;
    snapshotWriteQueue = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    await previousWrite;
    let writeLock: Awaited<ReturnType<typeof open>> | null = null;
    try {
      await mkdir(path.dirname(writeLockPath), { recursive: true });
      while (!writeLock) {
        try {
          writeLock = await open(writeLockPath, 'wx');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
          }
          const lockStat = await stat(writeLockPath).catch(() => null);
          if (lockStat && now() - lockStat.mtimeMs > lockMaxAgeMs) {
            await unlink(writeLockPath).catch(() => undefined);
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      const diskSnapshot = await readSnapshotFromDisk(cachePath);
      const ids: Record<string, string> = { ...diskSnapshot?.ids };
      for (const [name, entry] of discovered) {
        ids[name] = entry.queryId;
      }
      // Keep the newer timestamp so a slower concurrent refresh never makes the cache look older.
      const diskFetchedAt = diskSnapshot ? new Date(diskSnapshot.fetchedAt).getTime() : Number.NaN;
      const fetchedAt =
        diskSnapshot && diskFetchedAt > new Date(snapshot.fetchedAt).getTime()
          ? diskSnapshot.fetchedAt
          : snapshot.fetchedAt;
      const mergedSnapshot = { ...snapshot, fetchedAt, ids };
      await writeSnapshotToDisk(cachePath, mergedSnapshot);
      memorySnapshot = mergedSnapshot;
      return mergedSnapshot;
    } finally {
      if (writeLock) {
        await writeLock.close();
        await unlink(writeLockPath).catch(() => undefined);
      }
      releaseWrite();
    }
  };

  const getQueryId = async (operationName: string): Promise<string | null> => {
    const info = await getSnapshotInfo();
    if (!info) {
      return null;
    }
    return info.snapshot.ids[operationName] ?? null;
  };

  const refresh = async (
    operationNames: string[],
    opts: { force?: boolean; cookieHeader?: string; refreshFresh?: boolean } = {},
  ): Promise<RuntimeQueryIdSnapshotInfo | null> => {
    const key = `${[...operationNames].sort().join(',')}|${Boolean(opts.force)}`;
    const inFlight = refreshInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const current = await getSnapshotInfo();
      if (!opts.force && !opts.refreshFresh && current?.isFresh) {
        return current;
      }

      const result = await discoverQueryIds({
        fetchImpl,
        cookieHeader: opts.cookieHeader,
        targets: operationNames,
        deadlineMs: discoveryDeadlineMs,
        concurrency: fetchConcurrency,
      });
      const discovered = result.discovered;
      if (discovered.size === 0) {
        return current ?? null;
      }

      const snapshot: RuntimeQueryIdSnapshot = {
        fetchedAt: new Date().toISOString(),
        ttlMs,
        ids: {},
        discovery: {
          pages: result.pages,
          bundles: result.bundles,
          foundOperations: [...discovered.keys()],
        },
      };

      await persistMergedSnapshot(snapshot, discovered);
      await clearRefreshBackoff().catch(() => undefined);

      return getSnapshotInfo();
    })().finally(() => {
      refreshInFlight.delete(key);
    });
    refreshInFlight.set(key, task);
    return task;
  };

  const clearRefreshBackoff = async (): Promise<void> => {
    await writeFileAtomic(refreshStatePath, `${JSON.stringify({ failures: 0, nextAttemptAt: 0 })}\n`);
    autoRefreshAttemptAt = null;
  };

  const claimRefreshLock = async (): Promise<Awaited<ReturnType<typeof open>> | null> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await open(lockPath, 'wx');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        const lockStat = await stat(lockPath).catch(() => null);
        if (lockStat && now() - lockStat.mtimeMs <= lockMaxAgeMs) {
          return null;
        }
        await unlink(lockPath).catch(() => undefined);
      }
    }
    return null;
  };

  const autoRefresh = async (operationNames: string[], cookieHeader: string): Promise<void> => {
    if (process.env.BIRD_QUERY_IDS_AUTO_REFRESH === '0') {
      return;
    }
    const attemptWindowMs = 60 * 60 * 1000;
    if (autoRefreshAttemptAt !== null && now() - autoRefreshAttemptAt < attemptWindowMs) {
      return;
    }
    try {
      const raw = await readFile(refreshStatePath, 'utf8').catch(() => '');
      let state: { failures?: number; nextAttemptAt?: number } = {};
      if (raw) {
        try {
          state = JSON.parse(raw) as { failures?: number; nextAttemptAt?: number };
        } catch {
          state = {};
        }
      }
      const diskSnapshot = await readSnapshotFromDisk(cachePath);
      if (diskSnapshot) {
        memorySnapshot = diskSnapshot;
        loadOnce = Promise.resolve(diskSnapshot);
        const diskFetchedAt = new Date(diskSnapshot.fetchedAt).getTime();
        const diskAge = Number.isFinite(diskFetchedAt) ? Math.max(0, now() - diskFetchedAt) : Number.POSITIVE_INFINITY;
        if (diskAge <= diskSnapshot.ttlMs) {
          return;
        }
      }
      if (typeof state.nextAttemptAt === 'number' && state.nextAttemptAt > now()) {
        return;
      }
      await mkdir(path.dirname(lockPath), { recursive: true });
      const lock = await claimRefreshLock();
      if (!lock) {
        return;
      }
      try {
        // Another process may have finished a refresh between our freshness check and claiming the lock.
        const lockedSnapshot = await readSnapshotFromDisk(cachePath);
        if (lockedSnapshot) {
          const lockedFetchedAt = new Date(lockedSnapshot.fetchedAt).getTime();
          if (Number.isFinite(lockedFetchedAt) && now() - lockedFetchedAt <= lockedSnapshot.ttlMs) {
            memorySnapshot = lockedSnapshot;
            loadOnce = Promise.resolve(lockedSnapshot);
            return;
          }
        }
        const failures = Math.max(0, state.failures ?? 0) + 1;
        const delay = Math.min(
          24 * 60 * 60 * 1000,
          failures === 1 ? 60 * 60 * 1000 : failures === 2 ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
        );
        await mkdir(path.dirname(refreshStatePath), { recursive: true });
        await writeFileAtomic(refreshStatePath, `${JSON.stringify({ failures, nextAttemptAt: now() + delay })}\n`);
        autoRefreshAttemptAt = now();
        const beforeRefresh = await getSnapshotInfo();
        const info = await refresh(operationNames, { cookieHeader, refreshFresh: true });
        if (
          !info?.snapshot.discovery.foundOperations?.length ||
          info.snapshot.fetchedAt === beforeRefresh?.snapshot.fetchedAt
        ) {
          return;
        }
        await clearRefreshBackoff();
      } finally {
        await lock.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch {
      // Auto-refresh must never affect callers.
    }
  };

  return {
    cachePath,
    ttlMs,
    getSnapshotInfo,
    getQueryId,
    refresh,
    autoRefresh,
    clearRefreshBackoff,
    clearMemory() {
      memorySnapshot = null;
      loadOnce = null;
    },
  };
}

export const runtimeQueryIds = createRuntimeQueryIdStore();
