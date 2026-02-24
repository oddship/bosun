# Git Commit Guide

Detailed guidance on writing clear, meaningful commits following conventional commit format.

## Conventional Commit Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

## Types

| Type | Description | Semver | Example |
|------|-------------|--------|---------|
| `feat` | New feature | minor | `feat: add user authentication` |
| `fix` | Bug fix | patch | `fix: resolve login timeout issue` |
| `docs` | Documentation only | - | `docs: update API reference` |
| `style` | Formatting, no code change | - | `style: fix indentation in utils` |
| `refactor` | Code change, no new feature/fix | - | `refactor: extract validation logic` |
| `perf` | Performance improvement | patch | `perf: optimize database queries` |
| `test` | Adding/updating tests | - | `test: add unit tests for auth` |
| `build` | Build system/dependencies | - | `build: upgrade webpack to v5` |
| `ci` | CI configuration | - | `ci: add GitHub Actions workflow` |
| `chore` | Maintenance tasks | - | `chore: update .gitignore` |
| `revert` | Revert previous commit | - | `revert: revert "feat: add auth"` |

## Scope (Optional)

Indicates the area of the codebase affected:

```
feat(auth): add OAuth2 support
fix(api): handle null response
docs(readme): add installation steps
refactor(utils): simplify date formatting
```

Common scopes: `api`, `auth`, `ui`, `db`, `config`, `deps`, `core`

## Writing the Description

Rules:
1. **Use imperative mood**: "add feature" not "added feature"
2. **Don't capitalize**: Start with lowercase
3. **No period at end**: `feat: add login` not `feat: add login.`
4. **Keep under 50 characters**: Be concise
5. **Be specific**: "fix null pointer in user service" not "fix bug"

**Good examples:**
```
feat: add email verification for new users
fix: prevent crash when config file missing
refactor: extract database connection pooling
```

**Bad examples:**
```
Fixed stuff                    # Too vague
feat: Add new feature.         # Capitalized, has period
update                         # No type, too vague
WIP                           # Not descriptive
```

## Writing the Body

Use when the description isn't enough. Explain **what** and **why**, not how.

```
feat(auth): add rate limiting to login endpoint

Implement rate limiting to prevent brute force attacks.
Limits to 5 attempts per minute per IP address.

Uses Redis for distributed rate limit tracking across
multiple server instances.
```

Formatting:
- Separate from description with blank line
- Wrap at 72 characters
- Use bullet points for multiple items

## Footer

Used for:
- **Breaking changes**: `BREAKING CHANGE: description`
- **Issue references**: `Closes #123`, `Fixes #456`
- **Co-authors**: `Co-authored-by: Name <email>`

```
feat(api)!: change authentication to JWT

Migrate from session-based auth to JWT tokens.

BREAKING CHANGE: API now requires Bearer token in Authorization header.

Closes #234
Co-authored-by: Alice <alice@example.com>
```

Note: The `!` after scope also indicates breaking change.

## Commit Templates

### Feature
```
feat(<scope>): <what you added>

<Why this feature is needed>
<How it works at a high level>

Closes #<issue-number>
```

### Bug Fix
```
fix(<scope>): <what you fixed>

<What was the bug>
<What caused it>
<How this fixes it>

Fixes #<issue-number>
```

### Refactor
```
refactor(<scope>): <what you refactored>

<Why this refactor was needed>
<What approach you took>
```

### Breaking Change
```
feat(<scope>)!: <what changed>

<Description of the change>

BREAKING CHANGE: <what breaks and how to migrate>
```

## Commit Granularity

### Atomic Commits

Each commit should be:
- **Self-contained**: One logical change
- **Buildable**: Code compiles/runs after commit
- **Testable**: Tests pass after commit
- **Reversible**: Can be reverted independently

### When to Split

Split when you have:
- Multiple unrelated changes
- Refactoring + new feature
- Bug fix + new feature

```bash
# Instead of:
git commit -m "feat: add user profile and fix login bug and update docs"

# Split into:
git commit -m "fix(auth): resolve session timeout on login"
git commit -m "feat(user): add user profile page"
git commit -m "docs: update user management guide"
```

### When to Keep Together

Keep in one commit when:
- Changes are tightly coupled
- Splitting would break the build
- It's a single logical unit

## Staging and Committing

```bash
# Stage specific files
git add file1.ts file2.ts

# Stage parts of a file (interactive)
git add -p file.ts

# Stage all tracked files
git add -u

# Review what's staged
git diff --staged

# Commit with message
git commit -m "feat: add authentication"

# Commit with body (opens editor)
git commit

# Commit with inline body
git commit -m "feat: add auth" -m "Implements OAuth2 flow."
```

## Amending Commits

### Fix the last commit message
```bash
git commit --amend -m "feat: corrected message"
```

### Add forgotten files
```bash
git add forgotten-file.ts
git commit --amend --no-edit
```

**Important**: Only amend commits that haven't been pushed!

## Common Mistakes

1. **Vague messages**: "fix bug", "update code", "changes"
2. **Too many changes**: Giant commits with unrelated changes
3. **WIP commits**: Don't push "WIP" to shared branches
4. **No context**: Technical details without explaining why
5. **Wrong tense**: "added" instead of "add"
6. **Mixing concerns**: Refactoring + features + fixes in one commit

## Tooling

### Commitlint
Validates commit messages against conventional format.

### Commitizen
Interactive CLI for writing conventional commits:
```bash
npx cz
```

### Semantic Release
Automates versioning based on commit types:
- `fix` → patch (1.0.x)
- `feat` → minor (1.x.0)  
- `BREAKING CHANGE` → major (x.0.0)
