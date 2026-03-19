---
name: skill-loading-patterns
description: When and how to load skills proactively. Use when starting any task to avoid missing conventions, especially for git, file operations, or project-specific work.
---

# Skill Loading Patterns

Guidance on proactively loading skills to avoid missing project conventions and making incorrect assumptions.

## The Core Problem

**Skills aren't just "how to" — they're also "where to" and "what conventions to follow".**

Common failure pattern:
1. Receive task (e.g., "clone repo X")
2. Load narrow skill (e.g., `github` for GitHub)
3. Guess conventions from filesystem patterns
4. Put things in wrong place

Correct pattern:
1. Receive task (e.g., "clone repo X")
2. Load ALL relevant skills (e.g., `github` AND `git`)
3. Read conventions from skills
4. Follow documented patterns

## Skill Loading Rules

### Rule 1: Operation-Based Loading

| Operation | Load These Skills |
|-----------|-------------------|
| Cloning repos | `git` + platform skill (`github`) |
| Creating worktrees | `git` |
| Starting dev servers | Project skill + `background-processes` |
| Working on a project | Project-specific skill FIRST |
| Git operations (any) | `git` (always!) |
| Browser automation | `cdp-browser` |
| Complex tasks (3+ files, multi-step) | `context-management` (mandatory planning!) |

### Rule 2: Project Skills First

When working on a known project, **load its skill before doing anything**. Project skills contain:
- **Worktree locations** (critical!)
- Directory conventions
- Dev server startup patterns
- Build commands
- Common pitfalls

### Rule 3: Don't Pattern-Match Conventions

**WRONG**: Inferring paths from filesystem structure
```
Saw: /home/user/Code/github.com/bosun
Inferred: /home/user/Code/github.com/org/repo
Result: Wrong location, outside workspace
```

**RIGHT**: Reading conventions from skills
```
Loaded: git skill
Read: "workspace/code/{host}/{group}/{repo}"
Result: workspace/code/github.com/org/repo
```

### Rule 4: Ask When Creating in New Locations

When an operation will create files/directories in a new location:
1. Check if a skill defines the convention
2. If no skill exists, **ask the user**
3. Never guess based on surrounding filesystem

## Keyword → Skill Mapping

Scan the user's request for these keywords and load the corresponding skills:

| Keywords in Request | Load Skill |
|---------------------|------------|
| refactor, redesign, migrate, rewrite, multi-file, architecture | `context-management` |
| worktree, clone, branch, commit, rebase, merge, git | `git` |
| github, pull request, PR, gh | `github` |
| dev server, background, long-running | `background-processes` |
| browser, click, screenshot, web page, form, automate | `cdp-browser` |
| session, export, jq, session analysis, trimming | `session-analysis` |
| blog, documentation, readme, editorial, review prose | `editorial-review` |
| AI writing, humanize, voice patterns, writing quality | `humanizer` |
| logs, query logs, debug logs | Project-specific log skill |

**Load multiple skills when keywords overlap.** E.g., "analyze worktree for myproject" → load both project skill AND `git`.

## Skill Categories

### Always Load for Git Operations
- **git**: Repo layout, worktrees, commits, conventions

### Load for Platform Operations
- **github**: GitHub PRs, issues, actions

### Load for Background Processes
- **background-processes**: Dev servers, long-running commands

### Load for Session Analysis
- **session-analysis**: Session export, jq patterns, trimming, deliverable verification

### Load for Content Review
- **editorial-review**: Blog posts, documentation, READMEs, prose quality
- **humanizer**: AI writing pattern detection and removal

### Load for Browser Automation
- **cdp-browser**: CDP CLI workflow, selectors, troubleshooting

## Anti-Patterns

### 1. Selective Skill Loading
```
# BAD: Only loaded github because "it's a GitHub repo"
skill({ name: "github" })
gh repo clone org/repo

# GOOD: Cloning is a git operation too
skill({ name: "github" })
skill({ name: "git" })  # Contains repo layout conventions!
gh repo clone org/repo
```

### 2. Assuming Based on Current Directory
```
# BAD: PWD is /foo/bar/bosun, so repo goes to /foo/bar/org/repo
# This is pattern matching, not following conventions

# GOOD: Check git skill → workspace/code/{host}/{group}/{repo}
```

### 3. Skipping Project Skills
```
# BAD: Just start the dev server
yarn dev  # Blocks terminal!

# GOOD: Load project skill first — it says use background processes
createBackgroundProcess({ command: "yarn dev", name: "dev-server" })
```

### 4. Browser Automation Without Skill
```bash
# BAD: Jump into CDP without loading skill
cdp click ".some-button"

# GOOD: Load skill, follow workflow
skill({ name: "cdp-browser" })
# snapshot → waitfor → click → screenshot
```

## Checklist Before Operations

- [ ] Scan request for keywords → Check mapping table above
- [ ] Is this a git operation? → Load `git` skill
- [ ] Is this platform-specific? → Load platform skill
- [ ] Am I working on a known project? → Load project skill
- [ ] Will this create files in new locations? → Check conventions or ask
- [ ] Am I starting a long-running process? → Load `background-processes`
- [ ] Am I doing browser automation? → Load `cdp-browser`
- [ ] Does this touch 3+ files? → Load `context-management` and **plan first**

**Do NOT explore filesystem to guess paths. Skills have the answers.**
