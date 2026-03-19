---
name: git
description: >-
  Proactively load this skill for ANY git-related operation including cloning,
  repo organization, worktrees, branching, commits, merging, rebasing, and
  troubleshooting. Use when working with git in any capacity - cloning repos,
  creating worktrees, writing commits, resolving conflicts, or any other git workflow.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: version-control
---

# Git

Comprehensive guidance for Git operations, commit messages, and best practices.

## What I Do

- Guide on branching strategies and workflows
- Help write well-structured commit messages (conventional commits)
- Assist with merge vs rebase decisions
- Help resolve conflicts and troubleshoot issues
- Recommend best practices for team collaboration

## When to Use Me

**Load this skill proactively for any git-related work.**

Use this skill when:
- Cloning repositories
- Organizing repo directory structure
- Creating or managing worktrees
- Writing commit messages
- Planning branching strategies
- Deciding between merge and rebase
- Resolving merge conflicts
- Troubleshooting Git issues
- Setting up Git workflows for teams

## Quick Reference

### Conventional Commit Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Example:**
```
feat(auth): add OAuth2 login support

Implements Google and GitHub OAuth providers.
Includes token refresh handling.

Closes #123
```

### Repo Layout

Use standardized paths that mirror the git remote URL structure:

```
# Cloned repositories (INSIDE workspace)
workspace/code/{host}/{group}/{repo}
workspace/code/github.com/myorg/myrepo
workspace/code/github.com/myorg/mylib-go

# Worktrees (INSIDE workspace, alongside clones)
workspace/code/worktrees/{host}/{group}/{repo}/{branch}
workspace/code/worktrees/github.com/myorg/myrepo/feature-rewrite
```

> **⚠️ CRITICAL: Sandbox Boundary Rule**
> 
> Both the **parent repo** AND **worktrees** MUST be inside `$BOSUN_ROOT/workspace/`.
> 
> Git worktrees contain a `.git` file that points to the parent repo's `.git/worktrees/` directory.
> If the parent repo is outside the sandbox, the worktree will be **broken** and inaccessible.
> 
> **WRONG** (causes broken worktree):
> ```
> Parent repo:  /home/user/code/mylib          # OUTSIDE sandbox
> Worktree:     $BOSUN_ROOT/workspace/code/worktrees/...  # INSIDE sandbox
> Result:       Worktree .git file points outside sandbox = BROKEN
> ```
> 
> **CORRECT** (both inside workspace):
> ```
> Parent repo:  $BOSUN_ROOT/workspace/code/github.com/myorg/mylib
> Worktree:     $BOSUN_ROOT/workspace/code/worktrees/github.com/myorg/mylib/feature-branch
> Result:       Both accessible from sandbox = WORKS
> ```

```bash
# Clone with proper structure (INSIDE workspace)
mkdir -p $BOSUN_ROOT/workspace/code/github.com/myorg
git clone git@github.com:myorg/myrepo.git $BOSUN_ROOT/workspace/code/github.com/myorg/myrepo

# Create worktree for a branch (parent repo must be in workspace too!)
cd $BOSUN_ROOT/workspace/code/github.com/myorg/myrepo
git worktree add $BOSUN_ROOT/workspace/code/worktrees/github.com/myorg/myrepo/feature-branch feature-branch
```

### Common Operations

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Amend last commit
git commit --amend -m "new message"

# Interactive rebase (squash, reorder)
git rebase -i HEAD~3

# Stash and restore
git stash && git stash pop

# Cherry-pick
git cherry-pick <commit-hash>
```

### Merge vs Rebase

| Use Merge | Use Rebase |
|-----------|------------|
| Shared/public branches | Local/private branches |
| Preserve complete history | Clean linear history |
| Multiple collaborators | Before pushing |

**Golden Rule**: Never rebase commits that have been pushed to a shared repository.

### Conflict Resolution

```bash
git status                    # See conflicts
# Edit files, remove markers (<<<<, ====, >>>>)
git add <resolved-files>
git merge --continue          # or: git rebase --continue
```

## Best Practices

1. **Commit often**: Small, focused, atomic commits
2. **Write good messages**: Use conventional commit format
3. **Pull before push**: `git pull --rebase` before pushing
4. **Use branches**: Never commit directly to main
5. **Review changes**: `git diff --staged` before committing
6. **Keep history clean**: Squash WIP commits before merging

### Branch Naming Convention

**Use hyphens, not slashes** in branch names:

```bash
# CORRECT
feat-user-authentication
debug-feed-freeze-h1
fix-payment-timeout

# WRONG - breaks Go tooling
feat/user-authentication
debug/feed-freeze-h1
fix/payment-timeout
```

**Why?** Go module tooling doesn't handle slashes in branch names:
```bash
go get github.com/foo/bar@feat-user-auth    # Works
go get github.com/foo/bar@feat/user-auth    # FAILS
```

Since we primarily use Go, we follow this pattern for **all** branching across our repos for consistency.

## Detailed References

For more detailed guidance, see:

- [Repo Layout](references/REPO-LAYOUT.md) - Standardized paths for clones and worktrees
- [Workflow Guide](references/WORKFLOW.md) - Branching strategies, merge vs rebase details
- [Commit Guide](references/COMMITS.md) - Conventional commits, message templates
- [Troubleshooting](references/TROUBLESHOOTING.md) - Conflict resolution, recovery, maintenance

## Related Skills

- **gh** - For GitLab-specific operations (merge requests, CI/CD, issues, API). Load with `skill({ name: "gh" })` when working with github.com.
