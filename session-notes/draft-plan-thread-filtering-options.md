# Plan: Adding Thread Filtering Options to `bird thread`

> **⚠️ Superseded draft — not what shipped.** `bird thread` shipped exactly four flags in v0.8.1 (commit `5c9fad5`): `--author-chain`, `--author-only`, `--rooted-thread` (replaces the proposed `--full-chain-only`), and `--thread-meta`. `--include-parent` and `--include-ancestor-branches` did not ship for `bird thread`. See `CHANGELOG.md` and `src/commands/read.ts` for the real behavior.

> **Date:** 2026-02-24
> **Goal:** Bring bookmark-style thread filtering to the `bird thread` command.

## Proposed Options
- `--author-chain`: Only include author self-reply chains connected to the target tweet.
- `--author-only`: Include all tweets from the target tweet's author in the thread.
- `--full-chain-only`: Show the direct reply chain path for the target tweet.
- `--include-ancestor-branches`: Include side-branches of ancestors (works with `--full-chain-only`).
- `--include-parent`: Ensure the direct parent of the target tweet is included.
- `--thread-meta`: Add metadata fields (`isThread`, `threadPosition`, etc.).

## Implementation Strategy
1. **Update CLI**: Register the new options in `src/commands/read.ts` for the `thread` command.
2. **Retrieve Thread**: Use existing `client.getThread()` or `client.getThreadPaged()`.
3. **Identify Target**: Find the specific tweet requested by the user within the result set.
4. **Apply Filters**: Use functions from `src/lib/thread-filters.ts`:
   - `filterAuthorChain`
   - `filterAuthorOnly`
   - `filterFullChain`
5. **Metadata Enrichment**: Apply `addThreadMetadata` if requested.
6. **Finalize**: Deduplicate and sort the results.

## Validation Steps (Ongoing)
- Verify `getThread` returns enough context for all filter types.
- Ensure `thread-filters.ts` functions are compatible with `TweetData` returned by `getThread`.
- Confirm `conversationId` behavior for different tweet types (Notes, Articles, Replies).
