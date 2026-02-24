# Git Workflow Guide

Detailed guidance on branching strategies and workflows.

## Branching Strategies

### Git Flow

Best for: Projects with scheduled releases

```
main (production)
  └── develop (integration)
        ├── feature/xyz (new features)
        ├── release/1.0 (release prep)
        └── hotfix/bug (urgent fixes)
```

**Workflow:**
1. Create feature branches from `develop`
2. Merge features back to `develop`
3. Create release branch when ready
4. Merge release to both `main` and `develop`
5. Hotfixes branch from `main`, merge to both `main` and `develop`

### GitHub Flow

Best for: Continuous deployment, simpler projects

```
main (always deployable)
  └── feature-branch (all changes)
```

**Workflow:**
1. Branch from `main`
2. Make changes, commit often
3. Open pull request
4. Review and discuss
5. Merge to `main`
6. Deploy

### Trunk-Based Development

Best for: Experienced teams, CI/CD heavy environments

```
main (trunk)
  └── short-lived feature branches (< 2 days)
```

**Rules:**
- Branches live < 2 days
- Feature flags for incomplete work
- Continuous integration required
- Small, frequent commits

## Merge vs Rebase

### When to Merge

Use merge when:
- Working on shared/public branches
- You want to preserve complete history
- Multiple people are working on the branch
- You need to maintain branch context

```bash
git checkout main
git merge feature-branch
```

Creates a merge commit that ties histories together.

### When to Rebase

Use rebase when:
- Cleaning up local commits before pushing
- Updating a feature branch with main
- You want linear history
- Working on personal/private branches

```bash
git checkout feature-branch
git rebase main
```

Replays your commits on top of main.

### Interactive Rebase

For cleaning up commits before sharing:

```bash
git rebase -i HEAD~3  # Last 3 commits
```

Commands in interactive mode:
- `pick` - keep commit as-is
- `reword` - change commit message
- `squash` - combine with previous commit
- `fixup` - like squash but discard message
- `drop` - remove commit
- `edit` - pause to amend commit

### Golden Rule

**Never rebase commits that have been pushed to a shared repository.**

This rewrites history and causes problems for others who have pulled those commits.

## Common Workflows

### Starting a New Feature

```bash
git checkout main
git pull origin main
git checkout -b feature/my-feature
# Make changes
git add .
git commit -m "feat: add my feature"
git push -u origin feature/my-feature
# Open pull request
```

### Updating Feature Branch with Main

```bash
# Option 1: Rebase (cleaner history)
git checkout feature/my-feature
git fetch origin
git rebase origin/main

# Option 2: Merge (preserves history)
git checkout feature/my-feature
git merge main
```

### Squashing Before Merge

```bash
git checkout feature/my-feature
git rebase -i main
# Mark commits as 'squash' except first one
# Edit combined commit message
git push --force-with-lease  # Only if already pushed
```

### Cherry-picking

Apply specific commits to another branch:

```bash
git checkout main
git cherry-pick abc123  # Single commit
git cherry-pick abc123 def456  # Multiple commits
git cherry-pick abc123..xyz789  # Range of commits
```

## Stashing

Temporarily save work without committing:

```bash
# Basic stash
git stash

# Stash with message
git stash save "work in progress on login"

# Stash including untracked files
git stash -u

# List stashes
git stash list

# Apply most recent stash (keep in list)
git stash apply

# Apply and remove from list
git stash pop

# Apply specific stash
git stash apply stash@{2}

# Drop a stash
git stash drop stash@{0}

# Clear all stashes
git stash clear
```

## Tags

Mark important points in history:

```bash
# Lightweight tag
git tag v1.0.0

# Annotated tag (recommended)
git tag -a v1.0.0 -m "Release version 1.0.0"

# Tag a specific commit
git tag -a v1.0.0 abc123 -m "Release version 1.0.0"

# Push tags
git push origin v1.0.0
git push origin --tags  # All tags

# Delete tag
git tag -d v1.0.0
git push origin --delete v1.0.0
```
