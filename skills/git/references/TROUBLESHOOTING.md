# Git Troubleshooting

Guide for resolving conflicts, recovering from mistakes, and repository maintenance.

## Conflict Resolution

### Step-by-step

1. **Identify conflicts**: 
   ```bash
   git status
   ```

2. **Open conflicted files** and look for markers:
   ```
   <<<<<<< HEAD
   Your changes
   =======
   Their changes
   >>>>>>> branch-name
   ```

3. **Edit to resolve**: Remove markers, keep desired code

4. **Stage resolved files**:
   ```bash
   git add <file>
   ```

5. **Continue**:
   ```bash
   git merge --continue
   # or
   git rebase --continue
   ```

### Abort if Needed

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```

### Using a Merge Tool

```bash
git mergetool
```

Configure your preferred tool:
```bash
git config --global merge.tool vimdiff
# or: vscode, meld, kdiff3, etc.
```

### Strategies for Complex Conflicts

**Ours vs Theirs:**
```bash
# Keep our version of a file
git checkout --ours <file>

# Keep their version
git checkout --theirs <file>
```

**See all versions:**
```bash
git show :1:<file>  # Common ancestor
git show :2:<file>  # Ours (HEAD)
git show :3:<file>  # Theirs (incoming)
```

## Undo Operations

### Undo Last Commit

```bash
# Keep changes staged
git reset --soft HEAD~1

# Keep changes unstaged
git reset HEAD~1

# Discard changes completely
git reset --hard HEAD~1
```

### Undo Staged Changes

```bash
git reset HEAD <file>
# or
git restore --staged <file>
```

### Undo Unstaged Changes

```bash
git checkout -- <file>
# or
git restore <file>
```

### Undo a Pushed Commit

**Safe method** (creates revert commit):
```bash
git revert <commit-hash>
git push
```

**Dangerous method** (rewrites history):
```bash
git reset --hard HEAD~1
git push --force  # Only if you MUST and know consequences
```

## Recovery

### "Detached HEAD" State

```bash
# Save your work to a branch
git checkout -b my-work

# Or return to a branch
git checkout main
```

### Committed to Wrong Branch

```bash
# Move commits to correct branch
git checkout correct-branch
git cherry-pick <commit-hash>

# Remove from wrong branch
git checkout wrong-branch
git reset --hard HEAD~1
```

### Lost Commits After Reset

```bash
# Find lost commits in reflog
git reflog

# Recover by checking out or cherry-picking
git checkout <commit-hash>
# or
git cherry-pick <commit-hash>
```

### Accidentally Deleted Branch

```bash
# Find the branch tip in reflog
git reflog

# Recreate the branch
git branch <branch-name> <commit-hash>
```

### Recover Deleted File

```bash
# Find when file was deleted
git log --diff-filter=D --summary -- <filepath>

# Restore from commit before deletion
git checkout <commit-hash>^ -- <filepath>
```

## Repository Maintenance

### Clean Up Branches

```bash
# Delete local branch
git branch -d branch-name      # Safe (only if merged)
git branch -D branch-name      # Force delete

# Delete remote branch
git push origin --delete branch-name

# Prune stale remote refs
git fetch --prune

# List merged branches (safe to delete)
git branch --merged main
```

### Garbage Collection

```bash
git gc                    # Standard cleanup
git gc --aggressive       # Thorough (slow)
git gc --prune=now        # Remove unreachable objects immediately
```

### Find Large Files in History

```bash
# List largest objects
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  sort -k3 -n -r | head -20
```

### Remove Large Files from History

**Using git-filter-repo** (recommended):
```bash
pip install git-filter-repo
git filter-repo --path <file-to-remove> --invert-paths
```

**Using BFG Repo Cleaner**:
```bash
bfg --delete-files <filename>
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

## Worktree Issues

### "fatal: not a git repository" in Worktree

**Symptom**: Worktree exists but git commands fail with:
```
fatal: not a git repository: /path/to/parent/.git/worktrees/branch-name
```

**Cause**: The worktree's `.git` file points to a parent repo that is inaccessible (often due to sandbox boundaries).

**Diagnosis**:
```bash
# Check what the worktree points to
cat /path/to/worktree/.git
# Output: gitdir: /path/to/parent/.git/worktrees/branch-name

# Verify if parent is accessible
ls -la /path/to/parent/.git
```

**Fix (if parent repo still exists elsewhere)**:
1. Re-clone the parent repo inside the workspace
2. Copy your changes to the new location
3. Remove the broken worktree

```bash
# Clone inside workspace
git clone git@github.com:myorg/repo.git $BOSUN_ROOT/workspace/code/github.com/myorg/repo

# Create new branch and copy files
cd $BOSUN_ROOT/workspace/code/github.com/myorg/repo
git checkout -b your-branch
cp -r /path/to/broken-worktree/your-changes/* .

# Remove broken worktree
rm -rf /path/to/broken-worktree
```

**Prevention**: Always clone repos AND create worktrees inside `$BOSUN_ROOT/workspace/`. See the Repo Layout section in the main skill file.

### Worktree Points to Wrong Location

**Fix the `.git` file** (if parent repo was moved):
```bash
# Edit the worktree's .git file
echo "gitdir: /new/path/to/parent/.git/worktrees/branch-name" > /path/to/worktree/.git

# Also update the parent's worktree config
echo "/path/to/worktree" > /new/path/to/parent/.git/worktrees/branch-name/gitdir
```

### List and Clean Up Worktrees

```bash
# List all worktrees
git worktree list

# Remove a worktree
git worktree remove /path/to/worktree

# Prune stale worktree entries (if directory was deleted)
git worktree prune
```

## Common Errors

### "Your branch has diverged"

```bash
# Option 1: Rebase on top of remote
git pull --rebase

# Option 2: Merge remote changes
git pull

# Option 3: Force push (dangerous, only for personal branches)
git push --force-with-lease
```

### "Cannot pull with rebase: You have unstaged changes"

```bash
git stash
git pull --rebase
git stash pop
```

### "Permission denied (publickey)"

```bash
# Check SSH key
ssh -T git@github.com

# Add SSH key to agent
ssh-add ~/.ssh/id_rsa
```

### "fatal: refusing to merge unrelated histories"

```bash
git pull origin main --allow-unrelated-histories
```

### "error: failed to push some refs"

Usually means remote has commits you don't have:
```bash
git pull --rebase
git push
```

## Configuration Tips

### Useful Aliases

```bash
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.st status
git config --global alias.lg "log --oneline --graph --decorate"
```

### Better Defaults

```bash
# Auto-stash before rebase
git config --global rebase.autoStash true

# Use patience diff algorithm
git config --global diff.algorithm patience

# Show branch in prompt
git config --global bash.showDirtyState true
```

### Per-Repository Settings

```bash
# Different email for work repos
git config user.email "work@company.com"

# Different signing key
git config user.signingkey ABC123
```
