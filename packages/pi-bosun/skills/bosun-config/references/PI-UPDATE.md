# Pi Update

Safe upgrade workflow for Pi and its ecosystem packages.

## When to Use

- User asks to update/upgrade Pi
- After a Pi update to check for breakages
- When investigating breaking changes between versions

## Quick Reference

### Packages We Track

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | Core Pi agent |
| `pi-spawn_agent` | Subagent orchestration |
| `pi-mcp-adapter` | MCP tool integration |
| `pi-interactive-shell` | Interactive shell tool |
| `pi-mesh` | Multi-agent coordination |

### Check Current Version

```bash
node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)"
```

### Check Available Version

```bash
npm info @mariozechner/pi-coding-agent version
```

## Update Workflow

### 1. Pre-flight: Read the Changelog

Use `gh` CLI to fetch release notes for versions between current and latest.
Do NOT update blindly.

```bash
# Get current version
CURRENT=$(node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)")

# Fetch recent releases from GitHub
gh api repos/badlogic/pi-mono/releases --jq '.[:10][] | "\(.tag_name) - \(.published_at)\n\(.body)\n---"'
```

Review each release between current and latest for:
- **Breaking Changes** section (highest priority)
- Extension API changes
- Settings/config format changes
- Model catalog changes

### 2. Assess Impact

Check our config files against breaking changes:

```bash
# Check for custom models.json (breaking in 0.52.7)
cat ..bosun-home/.config/pi/models.json 2>/dev/null || echo "No custom models.json"

# Check settings for affected fields
cat .pi/settings.json | jq '.'

# List our extensions (breaking changes often hit these)
ls .pi/extensions/

# Check extension entry points for affected APIs
grep -r "ctx\.\|pi\." .pi/extensions/ --include="*.ts" | head -20
```

### 3. Run the Update

This CAN be done from inside the sandbox:

```bash
bun update @mariozechner/pi-coding-agent
```

To update all pi packages at once:

```bash
bun update @mariozechner/pi-coding-agent pi-spawn_agent pi-mcp-adapter pi-interactive-shell pi-mesh
```

### 4. Restart Pi

User must exit and restart: `just start`

If using session resume, the conversation can continue after restart.

### 5. Post-Update Verification

After restarting, verify:

```bash
# Confirm new version
node -e "console.log(require('./node_modules/@mariozechner/pi-coding-agent/package.json').version)"

# Check daemon is running
daemon({ action: "status" })

# Check extensions loaded (look for errors in startup)
# Check skills loaded
```

### 6. Commit the Update

```bash
git add package.json bun.lock
git commit -m "build: update pi-coding-agent to vX.Y.Z"
```

## Known Pain Points (History)

### Extension Signature Changes (0.51.0)

Pi 0.51.0 changed extension tool signatures. All 4 extensions broke.
Symptom: Extensions fail to load on startup.
Fix: Update extension function signatures to match new API.

### models.json Merge Behavior (0.52.7)

Changed from full replacement to merge-by-id for provider models.
Impact: Only if you have custom provider model lists in models.json.
Our setup: No custom models.json, only `enabledModels` glob in settings.json - no impact.

### Skill Frontmatter Validation

Pi periodically tightens frontmatter validation.
Symptom: Skills fail to load with parsing errors.
Fix: Check skill YAML frontmatter against current spec.

### Dot-Prefixed Path Fix (0.52.9)

Paths like `.pi/extensions/foo.ts` were misclassified as git URLs.
Fixed in 0.52.9 - positive change for our setup.

## Do NOT

- Update without reading the changelog first
- Assume updates are safe just because the semver is a patch
- Forget to restart Pi after updating (changes only take effect on restart)
- Skip verifying extensions and skills load correctly after update
