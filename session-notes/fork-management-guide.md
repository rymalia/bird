# Fork Management: Syncing Main & Preserving Your Work

A guide for managing forked repositories where you want to:
- Keep `main` in sync with the upstream (original) repository
- Preserve your own work on separate feature branches

## Prerequisites

### Verify Your Remotes

```bash
git remote -v
```

You should see two remotes:
- **`origin`** → your fork (e.g., `github.com/rymalia/bird.git`)
- **`upstream`** → the original repo (e.g., `github.com/steipete/bird.git`)

### If Upstream Is Missing

```bash
git remote add upstream https://github.com/ORIGINAL_OWNER/REPO_NAME.git
```

## Scenario: Moving Existing Work to a Feature Branch

You've been committing directly to `main` in your fork, but now want to reorganize so `main` tracks upstream.

### Step 1: Assess the Situation

```bash
# Fetch latest from upstream
git fetch upstream

# See where you diverge from upstream
git log --oneline main ^upstream/main    # Your commits not in upstream
git log --oneline upstream/main ^main    # Upstream commits you don't have
```

Example output:
```
$ git log --oneline main ^upstream/main
c997785 feat: add pluggable translation service for tweets

$ git log --oneline upstream/main ^main
4635108 Update README.md
```

This shows you have 1 commit upstream doesn't have, and upstream has 1 commit you don't have.

### Step 2: Save Uncommitted Changes (If Any)

```bash
# Check for uncommitted work
git status

# If you have changes, stash them
git stash push -m "WIP: description of what you were working on"

# Verify stash was saved
git stash list
```

### Step 3: Create a Branch for Your Work

```bash
# Create branch at current position (without switching to it)
git branch feat/your-feature-name

# Verify it was created
git branch -v
```

### Step 4: Reset Main to Match Upstream

```bash
# Reset your main to upstream's main
git reset --hard upstream/main

# Verify
git log --oneline -3
```

### Step 5: Push Changes to Your Fork

```bash
# Update main on your fork (force required since history changed)
git push origin main --force

# Push your feature branch
git push -u origin feat/your-feature-name
```

### Step 6: Switch to Feature Branch & Restore Work

```bash
# Switch to your feature branch
git checkout feat/your-feature-name

# If you stashed changes, restore them
git stash pop
```

## Ongoing: Keeping Main in Sync

After initial setup, periodically sync your main:

```bash
# Make sure you're on main
git checkout main

# Fetch and merge upstream changes
git fetch upstream
git merge upstream/main

# Push to your fork
git push origin main
```

Or as a one-liner:
```bash
git checkout main && git fetch upstream && git merge upstream/main && git push origin main
```

## Updating Feature Branches with Latest Main

When upstream has new changes you want in your feature branch:

```bash
# First, sync your main (see above)

# Then rebase your feature branch
git checkout feat/your-feature-name
git rebase main

# Force push if you've already pushed the branch
git push --force-with-lease
```

## Quick Reference: Stash Commands

| Command | Description |
|---------|-------------|
| `git stash` | Stash changes with auto-generated message |
| `git stash push -m "message"` | Stash with descriptive message |
| `git stash list` | Show all stashed changes |
| `git stash pop` | Restore most recent stash and delete it |
| `git stash apply` | Restore most recent stash but keep it |
| `git stash drop` | Delete most recent stash |
| `git stash show -p` | View contents of most recent stash |

## Troubleshooting

### "Your branch and 'origin/main' have diverged"

This is expected after resetting main. Use `git push --force` to update origin.

### Stash Conflicts on Pop

If `git stash pop` has conflicts:
1. Resolve the conflicts in the affected files
2. `git add` the resolved files
3. The stash is not automatically dropped on conflict, so run `git stash drop` after resolving

### Accidentally Reset Without Stashing

If you lost uncommitted changes:
- Unfortunately, uncommitted changes are not recoverable
- Committed work can be recovered via `git reflog`

```bash
# Find the commit you were at before reset
git reflog

# Recover by creating a branch at that commit
git branch recovery-branch abc1234
```
