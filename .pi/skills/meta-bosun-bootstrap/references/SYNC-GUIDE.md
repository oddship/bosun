# Upstream Sync Guide

How to keep your downstream project in sync with bosun upstream.

## Quick Sync

```bash
just sync-upstream
```

This runs:
1. `cd upstream && git fetch origin && git checkout main && git pull`
2. `bun install` (picks up new/changed packages)
3. `just init` (regenerates .pi/*.json)

Then review and commit:
```bash
git diff upstream       # see what changed
git add upstream
git commit -m "chore: sync upstream bosun"
```

## Safe Sync (Recommended)

Sync in a branch first, test before merging:

```bash
git checkout -b sync-upstream
just sync-upstream
just start              # verify everything works
git add -A
git commit -m "chore: sync upstream bosun to $(cd upstream && git rev-parse --short HEAD)"
git checkout main
git merge sync-upstream
git branch -d sync-upstream
```

## Pinning to a Specific Version

By default the submodule tracks a commit. To pin to a tag:

```bash
cd upstream
git fetch --tags
git checkout v0.2.0     # or any tag/commit
cd ..
git add upstream
git commit -m "chore: pin upstream bosun to v0.2.0"
```

## What to Check After Syncing

### 1. New Config Options

```bash
diff config.sample.toml upstream/config.sample.toml
```

If upstream added new sections (e.g., a new daemon rule, new sandbox option),
decide whether to adopt them in your `config.sample.toml` and `config.toml`.

### 2. New Packages

Check if upstream added new packages:
```bash
ls upstream/packages/
```

Compare against your `package.json` dependencies and `scripts/init.ts` package list.
Add new packages if you want them.

### 3. New Agents

```bash
ls upstream/.pi/agents/
```

New upstream agents are automatically discoverable if your `agentPaths` includes
`"./upstream/.pi/agents"`. No action needed unless you want to override them.

### 4. New/Updated Skills

```bash
# Skills in upstream that you don't have locally:
comm -23 <(ls upstream/.pi/skills/ | sort) <(ls .pi/skills/ | sort)

# Skills you have that may have upstream updates:
for skill in $(ls .pi/skills/); do
  if [ -d "upstream/.pi/skills/$skill" ]; then
    if ! diff -q ".pi/skills/$skill/SKILL.md" "upstream/.pi/skills/$skill/SKILL.md" >/dev/null 2>&1; then
      echo "Updated upstream: $skill"
    fi
  fi
done
```

To update a copied skill:
```bash
cp -r upstream/.pi/skills/git .pi/skills/
```

### 5. Breaking Changes

Check upstream's commit log since your last sync:
```bash
cd upstream
git log --oneline $(git rev-parse HEAD@{1})..HEAD
cd ..
```

Look for commits with `feat!:` or `BREAKING CHANGE` in the message.

### 6. init.ts Changes

If upstream's `scripts/init.ts` changed significantly (new config sections,
changed JSON structures), you may need to update your `scripts/init.ts` to match.

```bash
diff scripts/init.ts upstream/scripts/init.ts
```

Your init.ts doesn't need to be identical — it generates the same JSON files
but may reference different packages or add agentPaths. Focus on structural
changes (new JSON files, changed field names).

## Sync Cadence

- **Weekly** for active development — keeps drift small
- **Monthly** for stable projects — batch upstream improvements
- **On-demand** when you need a specific upstream fix or feature

## Handling Conflicts

Conflicts between your project and upstream should be rare because:
- You never edit files inside `upstream/`
- Your `.pi/agents/` overrides upstream by name collision
- Your `config.toml` is separate from upstream's

The only area where drift matters is:
- Your `scripts/init.ts` vs upstream's (structural changes to JSON generation)
- Your `justfile` vs upstream's (new lifecycle commands you might want)

For these, review upstream changes and manually port relevant improvements.
