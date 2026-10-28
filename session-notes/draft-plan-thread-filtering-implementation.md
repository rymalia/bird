# Plan: Implementing Thread Filtering Options in `bird thread`

> **⚠️ Superseded draft — not what shipped.** `bird thread` shipped exactly four flags in v0.8.1 (commit `5c9fad5`): `--author-chain`, `--author-only`, `--rooted-thread` (replaces the proposed `--full-chain-only`), and `--thread-meta`. `--include-parent` and `--include-ancestor-branches` did not ship for `bird thread`. See `CHANGELOG.md` and `src/commands/read.ts` for the real behavior.

> **Date:** 2026-02-24
> **Goal:** Align `bird thread` functionality with the advanced filtering and metadata options available in `bird bookmarks`.

## Final Strategic Plan

### 1. CLI Enhancement (`src/commands/read.ts`)
We will register the following new options for the `thread` command:
- `--author-chain`: Only include author self-reply chains connected to the target tweet.
- `--author-only`: Include all tweets from the target tweet's author in the thread.
- `--full-chain-only`: Show only the direct reply path (ancestors/descendants) for the target tweet.
- `--include-ancestor-branches`: Include side-branches of ancestors (requires `--full-chain-only`).
- `--include-parent`: Ensure the direct parent of the target tweet is included regardless of the filter.
- `--thread-meta`: Annotate tweets with position metadata (root, middle, end).

### 2. Execution Logic
Inside the thread action, after fetching results (via getThread or getThreadPaged):  

  1. Identify Focal Tweet: Find the tweet matching the user's input ID within the result.tweets array.
  2. Apply Filters:
      - If `--author-chain`: Apply `filterAuthorChain(tweets, focalTweet)`.
      - If `--author-only`: Apply `filterAuthorOnly(tweets, focalTweet)`.
      - If `--full-chain-only`: Apply `filterFullChain(tweets, focalTweet, { includeAncestorBranches })`.
  3. Parent Context: If `--include-parent` is set and the parent isn't in the filtered set, fetch/add it.
  4. Metadata: If `--thread-meta` is set, apply `addThreadMetadata(tweet, fullThreadContext)`.
  5. Warnings: Implement the redundancy warnings identified in the Feb 2nd plan (e.g., `--author-chain` makes `--author-only` redundant).

### 3. Test Backfilling
Before implementing the CLI changes, I will backfill the missing unit tests for `filterAuthorChain` and `filterAuthorOnly` in `tests/thread-filters.test.ts`. This ensures the core logic is verified before being exposed.


### 4. Integration Verification
I will add new integration tests in `tests/commands.read.test.ts` to verify that:
- Flags are correctly parsed and passed.
- Output is correctly filtered based on different thread structures.
- Metadata is present when requested.


## Implementation Plan

### 1. Research & Analysis (Completed)
- Identified existing filter logic in `src/lib/thread-filters.ts`.
- Analyzed `bird thread` data flow in `src/commands/read.ts`.
- Reviewed previous plans (Feb 2nd and Feb 24th) to ensure maximum feature coverage and robust CLI logic.

### 2. Phase 1: Test Backfilling
Before modifying the CLI, ensure the core filter logic is robust.
- **File**: `tests/thread-filters.test.ts`
- **Tasks**:
  - Add unit tests for `filterAuthorChain`.
  - Add unit tests for `filterAuthorOnly`.
  - Verify existing `filterFullChain` tests pass.

### 3. Phase 2: CLI Implementation
Integrate the filters into the `thread` command.
- **File**: `src/commands/read.ts`
- **Tasks**:
  - Add new options to the `thread` command registration.
  - Update command handler to find the "Anchor Tweet" (the focal tweet requested by the user).
  - Apply filter functions based on user flags.
  - Implement `--include-parent` logic for additional context.
  - Apply `addThreadMetadata` when `--thread-meta` is requested.
  - Add redundancy warnings for conflicting flags.

### 4. Phase 3: Integration Testing & Documentation
Verify the end-to-end experience.
- **Files**:
  - `tests/commands.read.test.ts` (Integration tests for new flags)
  - `tests/help-output.test.ts` (Verify help documentation)
  - `README.md` (Update usage instructions)

### 5. Success Criteria
- `bird thread <id> --author-chain` returns only the author's connected self-reply chain.
- `bird thread <id> --thread-meta` includes `threadPosition` and `isThread` in JSON output.
- All filtering works correctly with paginated results (`--all`).
- Redundancy warnings trigger correctly.
