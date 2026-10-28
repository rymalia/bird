import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import {
  type FeatureOverrides,
  getFeatureOverridesSnapshot,
  refreshFeatureOverridesCache,
} from '../lib/runtime-features.js';
import { runtimeQueryIds } from '../lib/runtime-query-ids.js';
import { TARGET_QUERY_ID_OPERATIONS } from '../lib/twitter-client-constants.js';

function countFeatureOverrides(overrides: FeatureOverrides): number {
  let count = 0;
  if (overrides.global) {
    count += Object.keys(overrides.global).length;
  }
  if (overrides.sets) {
    for (const setOverrides of Object.values(overrides.sets)) {
      count += Object.keys(setOverrides).length;
    }
  }
  return count;
}

export function registerQueryIdsCommand(program: Command, ctx: CliContext): void {
  program
    .command('query-ids')
    .description('Show or refresh cached Twitter GraphQL query IDs')
    .option('--json', 'Output as JSON')
    .option('--fresh', 'Force refresh (downloads X client bundles)', false)
    .action(async (cmdOpts: { json?: boolean; fresh?: boolean }) => {
      const operations = [
        'CreateTweet',
        'CreateRetweet',
        'FavoriteTweet',
        'TweetDetail',
        'SearchTimeline',
        'UserArticlesTweets',
        'Bookmarks',
        'Following',
        'Followers',
        'Likes',
      ];

      if (cmdOpts.fresh) {
        console.error(`${ctx.p('info')}Refreshing GraphQL query IDs…`);
        let cookieHeader: string | undefined;
        try {
          const opts = program.opts();
          const { cookies } = await ctx.resolveCredentialsFromOptions(opts);
          cookieHeader = cookies.cookieHeader ?? undefined;
        } catch {
          // Anonymous discovery remains available.
        }
        if (!cookieHeader) {
          console.error(`${ctx.p('warn')}Credentials unavailable; trying anonymous discovery.`);
        }
        try {
          const targets = [...new Set([...operations, ...TARGET_QUERY_ID_OPERATIONS])];
          const before = await runtimeQueryIds.getSnapshotInfo();
          const refreshed = await runtimeQueryIds.refresh(targets, {
            force: true,
            cookieHeader,
          });
          const found =
            refreshed?.snapshot.fetchedAt !== before?.snapshot.fetchedAt
              ? (refreshed?.snapshot.discovery.foundOperations?.length ?? 0)
              : 0;
          console.error(`${ctx.p('info')}Found ${found}/${targets.length} operations.`);
          if (found === 0) {
            console.error(`${ctx.p('warn')}No query IDs were discovered; existing cache was left unchanged.`);
            process.exitCode = 1;
          }
        } catch (error) {
          console.error(
            `${ctx.p('err')}Query ID refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          console.error(
            `${ctx.p('info')}Found 0/${new Set([...operations, ...TARGET_QUERY_ID_OPERATIONS]).size} operations.`,
          );
          console.error(`${ctx.p('warn')}Existing query ID cache was left unchanged.`);
          process.exitCode = 1;
        }
        console.error(`${ctx.p('info')}Refreshing feature overrides…`);
        await refreshFeatureOverridesCache();
      }

      const featureSnapshot = getFeatureOverridesSnapshot();
      const info = await runtimeQueryIds.getSnapshotInfo();
      if (!info) {
        if (cmdOpts.json) {
          console.log(
            JSON.stringify(
              {
                cached: false,
                cachePath: runtimeQueryIds.cachePath,
                featuresPath: featureSnapshot.cachePath,
                features: featureSnapshot.overrides,
              },
              null,
              2,
            ),
          );
          return;
        }
        console.log(`${ctx.p('warn')}No cached query IDs yet.`);
        console.log(`${ctx.p('info')}Run: bird query-ids --fresh`);
        console.log(`features_path: ${featureSnapshot.cachePath}`);
        return;
      }

      if (cmdOpts.json) {
        console.log(
          JSON.stringify(
            {
              cached: true,
              cachePath: info.cachePath,
              fetchedAt: info.snapshot.fetchedAt,
              isFresh: info.isFresh,
              ageMs: info.ageMs,
              ids: info.snapshot.ids,
              discovery: info.snapshot.discovery,
              featuresPath: featureSnapshot.cachePath,
              features: featureSnapshot.overrides,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`${ctx.p('ok')}GraphQL query IDs cached`);
      console.log(`path: ${info.cachePath}`);
      console.log(`fetched_at: ${info.snapshot.fetchedAt}`);
      console.log(`fresh: ${info.isFresh ? 'yes' : 'no'}`);
      console.log(`ops: ${Object.keys(info.snapshot.ids).length}`);
      console.log(`features_path: ${featureSnapshot.cachePath}`);
      console.log(`features: ${countFeatureOverrides(featureSnapshot.overrides)}`);
    });
}
