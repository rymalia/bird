---
session_id: 657f39f3-6faa-425c-adc3-a43a5fcdc488
date: 2026-10-28
time: "10:16 AM PDT – 10:45 AM PDT"
project: bird
branch: dev
---

# Session Summary: Machine-Readable `bird read` Failure Classification

## Overview

Picked up the baton `.baton/2026-10-28-read-failure-classification-for-dewey.md` (Part A, bird side). `bird read --json/--json-full` now prints `{"error":{"kind","reason","status","message"}}` on stdout and exits 1 on failure, so the dewey hydration pipeline can tell a deleted tweet from a suspended or protected author, a rate limit or bad cookies, instead of recording every failure as `deleted`. The work was merged to `dev` with `--no-ff` (`ac5f306`). Part B (dewey) goes to the user's dewey session.

## How We Got Here

1. **Verified the baton against git.** bird matched: `dev` at `40fc843`, with only the `.gitignore` `.baton/` line uncommitted. dewey had **moved**: HEAD was `467ff79`, not the baton's `871a284`.
2. **Captured real TweetDetail payloads** with a fetch-wrapping script over `dist/` (in the scratchpad, not committed). The tweet ids came from dewey's `corpus.jsonl` rows whose X API v2 errors were already known (`Not Found Error` / `Authorization Error`). Results:
   - **Deleted** (`Not Found Error`), and also id `1`: HTTP 200, and the focal entry `entryId: "tweet-<id>"` comes back with `tweet_results: {}`.
   - **Protected:** a `TweetTombstone` with the text "…this account owner limits who can view their Posts. Learn more".
   - **Suspended:** a `TweetTombstone` with the text "This Post is from a suspended account. Learn more".
   - Tombstones have **no `reason` field and no `rest_id`**.
   - **Out-of-range id:** HTTP 200 with `data: {}` and a `strconv.ParseInt` error in `errors[]`.
   - **Bogus cookies:** HTTP 401 `{"errors":[{"message":"Could not authenticate you","code":32}]}`.
3. **The baton's example "deleted" tweet was wrong.** `1736835665952686502` is a **protected-account** tombstone, not a deletion.
4. **TDD sequence:**
   - wrote a plan and ran a Codex plan validation in the background;
   - meanwhile wrote failing tests: 22 red, then implemented to green;
   - ran two rounds of Codex review and fixes.

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| **An empty focal `tweet_results` in a clean response maps to `not_found`** | It's the only deletion signal X gives in TweetDetail. 3 X-API-confirmed deletions plus id `1` all have this shape, so without it bird could never report a deletion. Codex review 1 flagged it as "not explicit"; I declined that, kept the rule, and added guards. |
| **Guards: partial GraphQL errors, or the tweet's `rest_id` anywhere else in the response, downgrade `not_found`** | A false `not_found` is the costliest error: dewey treats it as permanent and rechecks only through the paid X API. A false retryable result costs only a free bird call. |
| **Locate the focal entry by `entryId` (`tweet-<id>`) and unwrap `TweetWithVisibilityResults`** | Tombstones and visibility wrappers carry no top-level `rest_id`, so `findTweetInInstructions` misses them. As a side effect, visibility-wrapped focal tweets now read instead of failing. The fallback is accepted only if `mapped.id === tweetId`. |
| **Tombstone text drives `unavailable` reasons (`Suspended`/`Protected`/`Withheld`/`Tombstone`)** | X gives no machine-readable reason. Deletion is matched narrowly (`Post was/has been deleted`). A tombstone with no text maps to `parse`. |
| **403 handling: no code or an auth code (32/89/239/326/353) → `auth`; code 88 → `rate_limited`; any other code → `transient`** | My first rule was "every 403 is `auth`". Two independent Codex passes argued that a per-tweet 403, such as a code 226 anti-automation challenge, shouldn't stop a whole run. |
| **Endpoint 404 → `transient` (`QueryIdNotFound`)** | A TweetDetail 404 means the query id rotated, not that the tweet is missing. |
| **Exit code stays 1 for every failure; the JSON goes on stdout only under `--json` flags** | Exit 2 already means a usage error elsewhere. stdout stays one JSON document per call, and stderr keeps the human line. |
| **Not byte-identical stderr accepted** | The error message is now more accurate (it carries the tombstone text). The baton's byte-identical requirement covers success output only. |
| **Declined: id-check on the root `tweetResult` path; exposing `failure` from paged replies/thread** | The first would risk breaking reads that succeed today. The second is out of scope. |
| **Fixture ids sanitized to `1000000000000000001`, cursors stripped** | Some captured tweets belong to protected accounts. |
| **Part B is done by the user's dewey session, not this one** | User's decision: one agent per repo, and the dewey session owns `stage2_hydrate.py` history. The user adopts the Codex plan with changes: drop the migration tool (`--retry deleted` already covers it), and on `auth` leave the current row `pending`. |

## Changes Made

| Change | Detail |
|--------|--------|
| **`.gitignore`** (`6faaa2b`) | `.baton/` ignored. The line was written by the previous session; I committed it. |
| **Classifier module** (`f8178f4`, `b8ef09b`) | New `src/lib/tweet-read-failure.ts` with these functions: `classifyHttpFailure`, `classifyGraphqlErrors`, `classifyThrownError`, `findFocalTweetEntry`, `responseMentionsTweet`, `classifyMissingTweet`. |
| **Types / exports** | `TweetReadFailureKind` and `TweetReadFailure` added in `src/lib/twitter-client-types.ts`. `GetTweetResult.failure` is optional. Both types are exported from `src/lib/index.ts`. |
| **`fetchTweetDetail` / `getTweet`** | In `src/lib/twitter-client-tweet-detail.ts`, each failure site returns a `failure`, and the success branch carries `partialErrors`. `getTweet` now does the focal-entry lookup, the unwrap, and the `not_found` guards. |
| **CLI** | In `src/commands/read.ts`, `printReadFailureJson` handles both read failures and missing credentials (`auth`/`MissingCredentials`) under JSON flags. Other commands are unchanged. |
| **Tests** | New `tests/twitter-client.get-tweet-failures.test.ts` and a `read command failures` block in `tests/commands.read.test.ts`. 4 new fixtures: `tests/fixtures/tweet-detail-{missing,tombstone-protected,tombstone-suspended,graphql-errors}.json`. |
| **Docs** | README "Output" section: the failure contract and a kind table. `CHANGELOG.md`: an Unreleased entry. |
| **Merge** | `ac5f306`: `--no-ff` merge of `fix/read-error-classification` into `dev`. |
| **Installed CLI** | Rebuilt with `pnpm run build:dist`. The installed `bird` reported `0.8.1 (b8ef09bc)`, the branch tip, which has the same content as `dev`. |
| **Baton retired** | Deleted `.baton/2026-10-28-read-failure-classification-for-dewey.md`. The Codex Part B plan is kept locally (gitignored) as `.baton/2026-10-28-dewey-partB-codex-plan.md`. |

## Testing / Research Performed

- **Unit suite:** 485 passed / 43 skipped. Run after the final fixes, and again on `dev` after the merge. `tsc --noEmit` and `pnpm run lint` (Biome and oxlint) were clean.
- **TDD:** the new tests were red first: 22 failed and 13 passed. The one non-trivial early pass was "keeps stdout empty without a JSON flag", which already held.
- **Live CLI checks**, on the installed builds `f8178f4d` and `b8ef09bc`, output piped through Python:
  - `1742927063911461267` → `not_found/Missing`;
  - `1744534677162000701` and `1736835665952686502` → `unavailable/Protected`;
  - `1744714737575993486` → `unavailable/Suspended`;
  - bogus cookies → `auth`, status 401;
  - `1721327891751817714` succeeds with `quotedTweet.id = 1721174295160725735`, and `_raw` is present under `--json-full`;
  - exit code 1 on failure;
  - human mode prints 0 bytes to stdout;
  - JSON arrived complete through a pipe, which checks the review's concern that stdout could be cut off before `process.exit`.
- **Codex luna runs (6), all read-only:**
  - **Plan validation** (`gpt-5.6-luna` xhigh): REVISE. Accepted: the partial-error guard, narrowing the deletion regex, 403+88 → `rate_limited`, code 326 → `auth`, and the id check on the unwrap fallback.
  - **Diff review 1** (`gpt-5.6-luna` xhigh): FIX. Accepted: the 403 split and textless tombstone → `parse`. Declined: the empty-slot verdict, stderr byte-identity, and the root id-check.
  - **False-`not_found` audit** (`gpt-6-luna` high): FIX. Accepted: the deep-scan guard for conversation modules. Declined two inferred scenarios: a root tombstone belonging to a different tweet, and a mislabelled focal slot.
  - **Review of the fixes** (`gpt-6-luna` high): FIX, on one P2. A deleted tweet whose id survives as an embedded quote or retweet snapshot gets `parse` instead of `not_found`. Accepted as the intended safe-direction trade-off.
  - **Research** over sibling projects: none of them holds a captured tombstone, a `TweetUnavailable`, or a numeric GraphQL error, so this session's captures are the only empirical evidence. Code 226 (anti-automation) was confirmed as a 403-style challenge. The first launch failed because `~/projects` isn't a git repo; I relaunched from inside bird rather than add `--skip-git-repo-check`.
  - **dewey Part B plan** (`gpt-5.6-luna` xhigh), against dewey's code.

## Summary Statistics

- Commits this session: 4 (`6faaa2b`, `f8178f4`, `b8ef09b`, merge `ac5f306`).
- New tests: 34 (29 in the failure test file plus 5 CLI tests). Suite went from 451 (previous session) to 485 passing.
- Real payloads captured: 12 tweet ids plus 1 bogus-auth probe. 4 sanitized fixtures committed.
- Failure kinds: 6. Unavailable reasons recognized: 4 (`Suspended`, `Protected`, `Withheld`, plus `TweetUnavailable.reason` passed through).
- Codex review findings: 15 raised across 4 review passes. 9 accepted (fully or partly), 6 declined with rationale. 1 finding (Codex plan #2) turned out to be already handled.

## Discoveries / Handoff Notes

- **X's TweetDetail verdicts.** Deleted: an empty focal `tweet_results: {}`. Protected or suspended: a `TweetTombstone` with display text only. No observed tombstone says "deleted" on the focal slot; deletion tombstones are only expected for thread parents.
- **`findTweetInInstructions` skips visibility-wrapped results and tombstones** because it matches on top-level `rest_id`. `getReplies`/`getThread` still use `parseTweetsFromInstructions` unchanged.
- **Old dewey `deleted` marks are untrustworthy and identifiable**: the old bird path wrote `deleted` without a `hydration_error`, while the xurl path always writes one. The user will recheck these with `--retry deleted` rather than a migration tool.
- The scratchpad capture script, `capture.mjs`, is session-local. To re-capture, wrap `globalThis.fetch` around `TwitterClient.getTweet` from `dist/index.js`.

## Current State

- `dev` clean, **5 commits ahead of `origin/dev`**: 3 branch commits, the merge `ac5f306`, and this summary commit. The user pushes. Suggested: `git push origin dev` and, if the branch should exist remotely, `git push -u origin fix/read-error-classification`.
- Local branch `fix/read-error-classification` still exists, at `b8ef09b`.
- The installed `bird` is `0.8.1 (b8ef09bc)`, the same content as `dev`.

### Unfinished Work

- **Part B (dewey)** belongs to the user's dewey session, using the plan in `.baton/2026-10-28-dewey-partB-codex-plan.md` with the user's two amendments:
  - no migration tool;
  - on `auth`, the current row stays `pending`.
- **User pushes:** `dev` and, optionally, the feature branch.
- **Optional, out of scope:** paged `replies`/`thread` drop `failure`; the Followers 404 parked from 2026-10-27.
