# Skill Templates

Copy-paste ready templates for creating skills.

## Basic Skill (SKILL.md only)

```markdown
---
name: <skill-name>
description: <What it does>. Use when <trigger scenarios>.
license: MIT
compatibility: pi
metadata:
  author: <your-name>
  version: "1.0"
---

# <Skill Title>

## What I Do

- <Action 1>
- <Action 2>
- <Action 3>

## When to Use Me

Use this skill when:
- <Scenario 1>
- <Scenario 2>
- <Scenario 3>

Do NOT use this skill for:
- <Anti-pattern 1>
- <Anti-pattern 2>

## Instructions

<Step-by-step instructions for the agent>

### Step 1: <First Step>

<Details and examples>

### Step 2: <Second Step>

<Details and examples>

## Examples

### Example 1: <Title>

**Input:** <what user asks>

**Output:** <what agent does>

### Example 2: <Title>

**Input:** <what user asks>

**Output:** <what agent does>
```

## Skill with References

For larger skills, split content:

```
my-skill/
├── SKILL.md                    # Main file (< 500 lines)
├── references/
│   ├── DETAILED-GUIDE.md       # In-depth documentation
│   ├── API-REFERENCE.md        # API details
│   └── TROUBLESHOOTING.md      # Common issues
└── assets/
    └── config-template.json    # Template files
```

**SKILL.md:**
```markdown
---
name: my-skill
description: Does X for Y. Use when working with Z.
---

# My Skill

## What I Do

- Brief action list

## When to Use Me

- Brief trigger list

## Quick Start

Essential instructions here...

## Detailed References

- [Detailed Guide](references/DETAILED-GUIDE.md) - Full documentation
- [API Reference](references/API-REFERENCE.md) - API details
- [Troubleshooting](references/TROUBLESHOOTING.md) - Common issues
```

## Skill with Scripts

For skills that run code:

```
data-processor/
├── SKILL.md
├── scripts/
│   ├── process.py
│   └── validate.sh
└── references/
    └── SCRIPT-USAGE.md
```

**SKILL.md:**
```markdown
---
name: data-processor
description: Process and validate data files. Use when transforming CSV, JSON, or XML data.
compatibility: Requires python3, jq
---

# Data Processor

## What I Do

- Transform data between formats
- Validate data against schemas
- Clean and normalize data

## Scripts

### process.py

Transform data between formats:

```bash
python scripts/process.py input.csv output.json
```

### validate.sh

Validate data against schema:

```bash
./scripts/validate.sh data.json schema.json
```

## Instructions

1. Identify the input format and desired output
2. Run the appropriate script
3. Check output for errors
```

## Domain-Specific Skill

Example for a specific technology:

```markdown
---
name: kubernetes-troubleshoot
description: Diagnose and fix Kubernetes issues. Use when pods fail, services don't connect, or deployments hang.
compatibility: Requires kubectl configured
metadata:
  category: devops
  version: "1.0"
---

# Kubernetes Troubleshooting

## What I Do

- Diagnose pod failures and crashes
- Debug service connectivity issues
- Investigate deployment problems
- Check resource constraints

## When to Use Me

Use this skill when:
- Pods are in CrashLoopBackOff or Error state
- Services aren't reachable
- Deployments are stuck
- Resource limits are being hit

Do NOT use for:
- Initial cluster setup (use kubernetes-setup skill)
- Helm chart development
- CI/CD pipeline configuration

## Quick Diagnostics

### Pod Issues

```bash
# Get pod status
kubectl get pods -n <namespace>

# Describe problem pod
kubectl describe pod <pod-name> -n <namespace>

# Check logs
kubectl logs <pod-name> -n <namespace> --previous
```

### Service Issues

```bash
# Check endpoints
kubectl get endpoints <service-name> -n <namespace>

# Test connectivity
kubectl run debug --rm -it --image=busybox -- wget -qO- <service>:<port>
```

## Common Issues

### CrashLoopBackOff

1. Check logs: `kubectl logs <pod> --previous`
2. Check resources: `kubectl describe pod <pod>`
3. Verify image: Check image name and pull policy
4. Check probes: Liveness/readiness probe issues

### ImagePullBackOff

1. Verify image exists: `docker pull <image>`
2. Check secrets: `kubectl get secrets`
3. Verify registry auth

See [Detailed Troubleshooting](references/TROUBLESHOOTING.md) for more.
```

## Minimal Utility Skill

For simple, focused skills:

```markdown
---
name: json-format
description: Format and validate JSON. Use when JSON needs pretty-printing or validation.
---

# JSON Format

Format and validate JSON data.

## Usage

### Pretty Print
```bash
cat file.json | jq '.'
```

### Validate
```bash
jq empty file.json && echo "Valid" || echo "Invalid"
```

### Extract Field
```bash
cat file.json | jq '.field.nested'
```

### Filter Array
```bash
cat file.json | jq '.items[] | select(.active == true)'
```
```
