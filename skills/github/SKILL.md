---
name: github
description: Use when working with GitHub via CLI - pull requests, issues, code reviews, or repository operations. Also load for first-time gh CLI authentication setup.
---

# GitHub CLI (gh)

Use `gh` to interact with GitHub from the command line - pull requests, issues, and repository operations.

## Quick Check

First, verify if gh is already authenticated:

```bash
gh auth status
```

If `github.com` shows "Logged in" - you're ready to go.

If not authenticated, follow the [Setup Guide](references/SETUP.md).

## Common Commands

### Pull Requests

```bash
# List open PRs
gh pr list --repo owner/repo

# View specific PR details
gh pr view 123 --repo owner/repo

# View PR diff
gh pr diff 123 --repo owner/repo

# Checkout PR locally (from forks too!)
gh pr checkout 123 --branch pr-123-feature-name

# Create PR from current branch
gh pr create --title "feat: description" --base main
```

### Issues

```bash
# List open issues
gh issue list --repo owner/repo --state open

# View issue details
gh issue view 123 --repo owner/repo

# Create issue
gh issue create --title "Bug: description" --body "Details..."

# Close issue
gh issue close 123 --repo owner/repo
```

### Repository Info

```bash
# View repo
gh repo view owner/repo

# Clone repo
gh repo clone owner/repo

# Fork repo
gh repo fork owner/repo
```

### API Access

```bash
# Generic API call
gh api repos/owner/repo/pulls/123/comments

# Get PR review comments
gh api repos/owner/repo/pulls/123/reviews
```

## PR Review Workflow

For thorough code reviews with worktrees, see [PR Review Guide](references/PR-REVIEW.md).

Quick version:
```bash
# 1. Checkout PR branch
gh pr checkout 4 --branch pr-4-feature-name

# 2. Create worktree for isolated review
git worktree add ../worktrees/repo/pr-4 pr-4-feature-name

# 3. Use review agent for structured analysis
# (via Task tool with agent: review)
```

## Important Notes

- Token is stored in `..bosun-home/.config/gh/hosts.yml`
- OAuth login works in sandbox: `gh auth login --web`
- For fork PRs, `gh pr checkout` fetches the fork's branch automatically

## References

- [Setup Guide](references/SETUP.md) - First-time authentication setup
- [PR Review Guide](references/PR-REVIEW.md) - Worktree-based code review workflow
