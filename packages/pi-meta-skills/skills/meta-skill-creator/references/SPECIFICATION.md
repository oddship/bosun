# Skill Specification

Full specification for agent skills following the [Agent Skills spec](https://agentskills.io/specification).

> **Note**: This is the Markdown-first approach. For TypeScript-based skills/agents
> with dynamic behavior, see the [pi extensions](https://github.com/code-yeongyu/pi extensions)
> approach which compiles everything into a plugin.

## Frontmatter Fields

### Required Fields

```yaml
---
name: skill-name           # Required: 1-64 chars, must match directory
description: <description> # Required: 1-1024 chars
---
```

### Optional Fields

```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents.
license: Apache-2.0
compatibility: Requires python3, poppler-utils
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Bash(jq:*) Read
---
```

### Field Reference

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | Max 64 chars. Lowercase letters, numbers, hyphens only. |
| `description` | Yes | Max 1024 chars. What skill does + when to use it. |
| `license` | No | License name or reference to LICENSE file. |
| `compatibility` | No | Max 500 chars. Environment requirements. |
| `metadata` | No | String-to-string map for additional properties. |
| `allowed-tools` | No | Space-delimited pre-approved tools (experimental). |

## Name Field Rules

The `name` must:
- Be 1-64 characters long
- Use only lowercase alphanumeric characters and hyphens
- Not start or end with a hyphen
- Not contain consecutive hyphens (`--`)
- Match the parent directory name exactly
- Be unique across all skill locations

**Valid regex:** `^[a-z0-9]+(-[a-z0-9]+)*$`

**Valid examples:** `git-release`, `code-review`, `api-docs`, `test-runner`
**Invalid examples:** `Git-Release`, `code--review`, `-api-docs`, `test-runner-`

## Description Guidelines

The description should:
- Describe what the skill does
- Explain when to use it
- Include keywords for agent selection

**Good:**
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
```

**Poor:**
```yaml
description: Helps with PDFs.
```

## Allowed-Tools Field

Pre-approve tools the skill may use (experimental):

```yaml
allowed-tools: Bash(git:*) Bash(jq:*) Read Write
```

Support varies between agent implementations.

## Directory Structure

### scripts/

Executable code that agents can run:

```
skill-name/
└── scripts/
    ├── extract.py        # Python script
    ├── process.sh        # Shell script
    └── validate.js       # JavaScript
```

Scripts should:
- Be self-contained or document dependencies
- Include helpful error messages
- Handle edge cases gracefully

### references/

Additional documentation loaded on demand:

```
skill-name/
└── references/
    ├── REFERENCE.md      # Detailed technical reference
    ├── api-guide.md      # API usage examples
    └── troubleshooting.md
```

Keep reference files focused - smaller files = less context usage.

### assets/

Static resources:

```
skill-name/
└── assets/
    ├── template.json     # Configuration templates
    ├── schema.json       # Data schemas
    └── lookup.csv        # Lookup tables
```

## File References

Use relative paths from skill root:

```markdown
See [the reference guide](references/REFERENCE.md) for details.

Run the extraction script:
scripts/extract.py
```

## Discovery Mechanism

Skills are discovered from:
1. Project-local: `.pi/skills/<name>/SKILL.md`
2. Global: `~/.pi/agent/skill/<name>/SKILL.md`
3. Claude-compatible: `.claude/skills/<name>/SKILL.md`

For project-local, the agent walks up from CWD to git worktree root.

## How Agents Use Skills

Agents see available skills via tool description:

```xml
<available_skills>
  <skill>
    <name>git-release</name>
    <description>Create consistent releases and changelogs</description>
  </skill>
</available_skills>
```

Loading a skill:
```
skill({ name: "git-release" })
```

## Validation

Use the [skills-ref](https://github.com/agentskills/agentskills) library:

```bash
skills-ref validate ./my-skill
```

## Troubleshooting

If a skill doesn't show up:

1. **Verify filename**: Must be `SKILL.md` (ALL CAPS)
2. **Check frontmatter**: Must have `name` and `description`
3. **Verify name match**: Frontmatter name = directory name
4. **Check uniqueness**: Names must be unique across locations
5. **Check permissions**: `deny` permission hides skills
6. **Check structure**: Must be `skill/<name>/SKILL.md`
