# PR Review Workflow with Worktrees

A structured approach to reviewing GitHub pull requests using git worktrees and the review agent.

## Why Worktrees?

- **Isolation**: Review multiple PRs without switching branches
- **Comparison**: Keep main branch accessible for diffing
- **Parallel Reviews**: Review PR #4 and PR #5 simultaneously
- **Clean State**: Each worktree has its own working directory

## Standard Layout

```
workspace/code/{host}/{owner}/{repo}/                    # Main clone (master/main)
workspace/code/worktrees/{host}/{owner}/{repo}/{branch}  # PR worktrees
```

Example:
```
workspace/code/github.com/owner/repo/                    # master
workspace/code/worktrees/github.com/owner/repo/pr-4-fix  # PR #4
workspace/code/worktrees/github.com/owner/repo/pr-5-feat # PR #5
```

## Complete Workflow

### Step 1: Gather PR Information

```bash
# List open PRs
gh pr list --repo owner/repo --state open

# Get detailed PR info
gh pr view 4 --repo owner/repo

# Get PR branch info (especially for forks)
gh pr view 4 --repo owner/repo --json headRefName,headRepositoryOwner
```

### Step 2: Fetch and Checkout PR Branches

For PRs from forks, `gh pr checkout` handles fetching automatically:

```bash
cd workspace/code/github.com/owner/repo

# Fetch all remote refs
git fetch origin

# Checkout PR #4 with a local branch name
gh pr checkout 4 --branch pr-4-fix-api-endpoints

# Checkout PR #5
gh pr checkout 5 --branch pr-5-media-features

# Return to main branch
git checkout main
```

### Step 3: Create Worktrees

```bash
# Create worktree directory
mkdir -p workspace/code/worktrees/github.com/owner/repo

# Create worktree for PR #4
git worktree add $BOSUN_ROOT/workspace/code/worktrees/github.com/owner/repo/pr-4-fix-api-endpoints pr-4-fix-api-endpoints

# Create worktree for PR #5
git worktree add $BOSUN_ROOT/workspace/code/worktrees/github.com/owner/repo/pr-5-media-features pr-5-media-features

# Verify worktrees
git worktree list
```

### Step 4: Run Code Reviews

Use the `review` agent for structured analysis:

```typescript
task({
  description: "Code review PR #4",
  agent: "review",
  prompt: `Perform a thorough code review of PR #4.

**Worktree Location:** /path/to/worktrees/github.com/owner/repo/pr-4-fix-api-endpoints

**PR Context:**
- Title: "Fix API endpoints and add missing tools"
- Fixes Issue #1, #2, #3

**Files to Review:**
- src/module/file.py - Main changes
- tests/test_file.py - Test changes

**Review Focus:**
1. Correctness - Does it fix the stated issues?
2. Edge Cases - What's not handled?
3. Security - Any vulnerabilities?
4. Code Quality - Follows patterns?
5. Breaking Changes - API compatibility?

Compare against master at: /path/to/github.com/owner/repo

Return structured review with:
- Summary of changes
- Issues found (critical, major, minor)
- Recommendation (approve, request changes, comment)`
})
```

### Step 5: Review Output Structure

The review agent returns:

```markdown
## Review Summary

**Overall Assessment**: APPROVE | REQUEST_CHANGES | COMMENT

### Critical Issues (must fix)
1. [Security] Issue description - File:line
   - Fix: Suggested solution

### Improvements (should fix)
1. [Performance] Issue description
   - Suggestion: How to improve

### Minor Suggestions (nice to have)
1. [Style] Suggestion

### What's Good
- Positive feedback points

### Verdict
Final recommendation with reasoning
```

### Step 6: Post Review Actions

```bash
# Comment on PR with review
gh pr review 4 --repo owner/repo --comment --body "Review feedback..."

# Request changes
gh pr review 4 --repo owner/repo --request-changes --body "Please address..."

# Approve
gh pr review 4 --repo owner/repo --approve --body "LGTM!"

# Merge (if approved)
gh pr merge 4 --repo owner/repo --squash
```

### Step 7: Cleanup Worktrees

After review is complete:

```bash
cd workspace/code/github.com/owner/repo

# Remove worktree
git worktree remove workspace/code/worktrees/github.com/owner/repo/pr-4-fix-api-endpoints

# Or force remove if there are changes
git worktree remove --force workspace/code/worktrees/github.com/owner/repo/pr-4-fix-api-endpoints

# Prune stale worktree references
git worktree prune
```

## Parallel Review Example

Review multiple PRs simultaneously:

```typescript
// Launch reviews in parallel
task({
  description: "Review PR #4",
  agent: "review",
  prompt: "Review PR #4 at worktree path..."
})

task({
  description: "Review PR #5", 
  agent: "review",
  prompt: "Review PR #5 at worktree path..."
})
```

## Tips

1. **Name branches descriptively**: `pr-4-fix-api` not just `pr-4`
2. **Keep main clone clean**: Don't modify files in the main clone
3. **Use `$BOSUN_ROOT`**: For absolute paths in worktree commands
4. **Check for conflicts**: Before reviewing, ensure PR is mergeable
5. **Review diffs first**: `gh pr diff 4` before deep dive

## Common Issues

### "fatal: 'branch-name' is already checked out"
The branch is checked out in another worktree. Either remove that worktree or use a different branch name.

### PR from fork not found
Use `gh pr checkout` which handles fork refs automatically:
```bash
gh pr checkout 4 --branch local-branch-name
```

### Worktree path already exists
Remove the directory first or choose a different path:
```bash
rm -rf workspace/code/worktrees/github.com/owner/repo/pr-4
```
