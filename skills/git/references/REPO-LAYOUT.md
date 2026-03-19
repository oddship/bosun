# Repository Layout

Standardized directory structure for cloned repositories and worktrees.

## Why Standardize?

- **Predictable locations**: Always know where repos live
- **Mirror remote structure**: Path reflects the git URL
- **Easy navigation**: `cd workspace/code/github.com/org/repo`
- **Worktree isolation**: Branches get their own directories
- **Tool compatibility**: Scripts can assume consistent paths

## Directory Structure

```
workspace/
└── code/
    ├── {host}/                    # Git host (github.com, github.com)
    │   └── {group}/               # Organization/group/user
    │       └── {repo}/            # Repository (main branch)
    │
    └── worktrees/                 # All worktrees under here
        └── {host}/
            └── {group}/
                └── {repo}/
                    └── {branch}/  # Each branch in its own dir
```

## Cloning Repositories

### Standard Clone

```bash
# Pattern
mkdir -p workspace/code/{host}/{group}
git clone {url} workspace/code/{host}/{group}/{repo}

# Examples
mkdir -p workspace/code/github.com/myorg
git clone git@github.com:myorg/myrepo.git workspace/code/github.com/myorg/myrepo

mkdir -p workspace/code/github.com/myorg
git clone git@github.com:myorg/mylib-go.git workspace/code/github.com/myorg/mylib-go
```

### Helper Function (optional)

Add to your shell config:

```bash
# Clone with automatic path structure
gclone() {
  local url="$1"
  local host group repo path
  
  # Extract components from URL
  if [[ "$url" =~ git@([^:]+):(.+)/(.+)\.git ]]; then
    host="${BASH_REMATCH[1]}"
    group="${BASH_REMATCH[2]}"
    repo="${BASH_REMATCH[3]}"
  elif [[ "$url" =~ https://([^/]+)/(.+)/(.+)(\.git)? ]]; then
    host="${BASH_REMATCH[1]}"
    group="${BASH_REMATCH[2]}"
    repo="${BASH_REMATCH[3]%.git}"
  else
    echo "Could not parse URL: $url"
    return 1
  fi
  
  path="workspace/code/$host/$group"
  mkdir -p "$path"
  git clone "$url" "$path/$repo"
}

# Usage: gclone git@github.com:myorg/myrepo.git
```

## Working with Worktrees

Git worktrees let you have multiple branches checked out simultaneously in different directories.

### Why Use Worktrees?

- **Parallel development**: Work on feature and hotfix simultaneously
- **No stashing**: Switch context without stashing changes
- **Independent state**: Each worktree has its own index/staging
- **Shared objects**: All worktrees share the same .git objects (disk efficient)

### Creating Worktrees

```bash
# From the main repo, create a worktree for a branch
cd workspace/code/github.com/myorg/myrepo

# Create worktree directory structure
mkdir -p workspace/code/worktrees/github.com/myorg/myrepo

# Add worktree for existing remote branch
git fetch origin feature-branch
git worktree add \
  workspace/code/worktrees/github.com/myorg/myrepo/feature-branch \
  feature-branch

# Add worktree for new branch (based on current HEAD)
git worktree add \
  workspace/code/worktrees/github.com/myorg/myrepo/my-new-feature \
  -b my-new-feature
```

### Managing Worktrees

```bash
# List all worktrees
git worktree list

# Remove a worktree (after merging/done)
git worktree remove workspace/code/worktrees/github.com/myorg/myrepo/feature-branch

# Prune stale worktree references
git worktree prune
```

### Worktree Workflow Example

```bash
# You're working on main feature
cd workspace/code/github.com/myorg/myrepo
# ... coding ...

# Urgent hotfix needed! Don't stash, create worktree
git worktree add \
  workspace/code/worktrees/github.com/myorg/myrepo/hotfix-123 \
  -b hotfix-123 origin/master

# Work on hotfix in separate directory
cd workspace/code/worktrees/github.com/myorg/myrepo/hotfix-123
# ... fix, commit, push ...

# Back to main feature (your changes are still there!)
cd workspace/code/github.com/myorg/myrepo

# Clean up after hotfix is merged
git worktree remove workspace/code/worktrees/github.com/myorg/myrepo/hotfix-123
```

## Best Practices

1. **Always use the standardized path structure** - makes automation and navigation predictable
2. **Keep main branch in the primary location** - worktrees are for temporary branch work
3. **Clean up worktrees** - remove them after branches are merged
4. **Don't nest repos** - each repo gets its own path, never clone inside another repo
5. **Use consistent host names** - `github.com` not `www.github.com`

## Common Mistakes

### Mistake 1: Cloning into random locations

```bash
# Bad - no organization
git clone git@github.com:org/repo.git ~/projects/repo
git clone git@github.com:org/other.git ~/code/other

# Good - consistent structure
git clone git@github.com:org/repo.git workspace/code/github.com/org/repo
git clone git@github.com:org/other.git workspace/code/github.com/org/other
```

### Mistake 2: Creating worktrees inside the main repo

```bash
# Bad - worktree inside repo directory
cd workspace/code/github.com/org/repo
git worktree add ./branches/feature feature  # Creates nested mess

# Good - worktrees in separate tree
git worktree add workspace/code/worktrees/github.com/org/repo/feature feature
```

### Mistake 3: Forgetting to clean up worktrees

```bash
# After branch is merged, remove the worktree
git worktree remove workspace/code/worktrees/github.com/org/repo/merged-branch

# Periodically prune stale references
git worktree prune
```

## Source

Derived from session: `workspace/users/alice/sessions/2026-01/06-cloning-myrepo.md`
