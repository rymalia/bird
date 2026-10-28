#!/usr/bin/env tsx
/** Fetch current Twitter/X GraphQL IDs and update src/lib/query-ids.json. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCredentials } from '../src/lib/cookies.js';
import { discoverQueryIds } from '../src/lib/runtime-query-ids.js';

const TARGET_OPERATIONS = [
  'CreateTweet',
  'CreateRetweet',
  'DeleteRetweet',
  'CreateFriendship',
  'DestroyFriendship',
  'FavoriteTweet',
  'UnfavoriteTweet',
  'CreateBookmark',
  'DeleteBookmark',
  'TweetDetail',
  'SearchTimeline',
  'Bookmarks',
  'BookmarkFolderTimeline',
  'Following',
  'Followers',
  'Likes',
  'ExploreSidebar',
  'ExplorePage',
  'GenericTimelineById',
  'TrendHistory',
  'AboutAccountQuery',
] as const;
type OperationName = (typeof TARGET_OPERATIONS)[number];
const QUERY_IDS_PATH = path.resolve(process.cwd(), 'src/lib/query-ids.json');

async function readExistingIds(): Promise<Record<OperationName, string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(QUERY_IDS_PATH, 'utf8')) as Record<string, string>;
    const result: Partial<Record<OperationName, string>> = {};
    for (const op of TARGET_OPERATIONS) {
      const value = parsed[op];
      if (typeof value === 'string' && value.trim()) {
        result[op] = value.trim();
      }
    }
    return result as Record<OperationName, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[warn] Failed to read existing query IDs:', error);
    }
    return {} as Record<OperationName, string>;
  }
}

async function writeIds(ids: Record<OperationName, string>): Promise<void> {
  const ordered: Partial<Record<OperationName, string>> = {};
  for (const op of TARGET_OPERATIONS) {
    if (ids[op]) {
      ordered[op] = ids[op];
    }
  }
  await fs.mkdir(path.dirname(QUERY_IDS_PATH), { recursive: true });
  await fs.writeFile(QUERY_IDS_PATH, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  console.log('[info] Discovering Twitter/X client bundles…');
  const { cookies, warnings } = await resolveCredentials({ cookieSource: ['chrome', 'safari', 'firefox'] });
  for (const warning of warnings) {
    console.warn(`[warn] ${warning}`);
  }
  if (!cookies.cookieHeader) {
    console.log('[info] No browser credentials found; using anonymous discovery');
  }
  const { discovered, bundles } = await discoverQueryIds({
    targets: [...TARGET_OPERATIONS],
    cookieHeader: cookies.cookieHeader ?? undefined,
  });
  console.log(`[info] Found ${bundles.length} bundles`);

  const existing = await readExistingIds();
  if (discovered.size === 0) {
    throw new Error('No query IDs discovered; extraction patterns may need an update.');
  }
  const nextIds: Record<OperationName, string> = { ...existing };
  for (const op of TARGET_OPERATIONS) {
    const found = discovered.get(op);
    if (found?.queryId) {
      nextIds[op] = found.queryId;
    }
  }
  await writeIds(nextIds);

  for (const op of TARGET_OPERATIONS) {
    const previous = existing[op];
    const current = nextIds[op];
    const source = discovered.get(op)?.bundle ?? 'existing file';
    if (previous && current && previous !== current) {
      console.log(`✅ ${op}: ${previous} → ${current} (${source})`);
    } else if (current) {
      console.log(`✅ ${op}: ${current} (${source})`);
    } else {
      console.warn(`⚠️  ${op}: not found (kept previous value if present)`);
    }
  }
  console.log(`[info] Updated ${QUERY_IDS_PATH}`);
}

main().catch((error) => {
  console.error('[error]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
