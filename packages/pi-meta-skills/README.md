# pi-meta-skills

Meta skills for [Pi](https://github.com/badlogic/pi-mono) — teach agents how to create new skills, extensions, tools, and prompt templates.

## Install

```bash
pi install npm:pi-meta-skills
```

## Skills included

| Skill | Description |
|-------|-------------|
| `meta-skill-creator` | Create new skills with proper SKILL.md structure and frontmatter |
| `meta-extension-creator` | Create extensions with event handling, commands, and hooks |
| `meta-tool-creator` | Create custom tools via extensions (TypeBox schemas, execute) |
| `meta-command-creator` | Create prompt templates (slash commands with arguments) |

## Usage

Skills are loaded automatically by Pi and available to agents on-demand. Ask the agent to create a skill/extension/tool/command and it will use the appropriate meta-skill.

## License

MIT
