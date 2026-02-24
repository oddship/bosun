# External Scripts Integration

Call Python, shell, and other scripts from Pi tools.

## Python Scripts

### Basic Python Call

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "python_analyze",
    label: "Python Analyze",
    description: "Analyze data using Python script",
    parameters: Type.Object({
      data: Type.String({ description: "Data to analyze" }),
    }),

    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      const result = await Bun.$`python3 scripts/analyze.py ${params.data}`.text();
      return { content: [{ type: "text", text: result.trim() }] };
    },
  });
}
```

**Python script** (`scripts/analyze.py`):
```python
#!/usr/bin/env python3
import sys
import json

data = sys.argv[1] if len(sys.argv) > 1 else ""
result = {"input": data, "length": len(data), "words": len(data.split())}
print(json.dumps(result, indent=2))
```

### Python with stdin

```typescript
async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
  const proc = Bun.spawn(["python3", "scripts/process.py"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  
  proc.stdin.write(JSON.stringify(params.data));
  proc.stdin.end();
  
  const output = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  
  if (error) {
    return { content: [{ type: "text", text: `Error: ${error}` }], isError: true };
  }
  
  return { content: [{ type: "text", text: output.trim() }] };
}
```

**Python script** (`scripts/process.py`):
```python
#!/usr/bin/env python3
import sys
import json

data = json.loads(sys.stdin.read())
# Process data...
result = {"processed": True, "data": data}
print(json.dumps(result))
```

## Shell Scripts

### Basic Shell Call

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "git_info",
    label: "Git Info",
    description: "Get git repository info via shell script",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _onUpdate, _ctx, _signal) {
      const result = await Bun.$`bash scripts/git-info.sh`.text();
      return { content: [{ type: "text", text: result.trim() }] };
    },
  });
}
```

**Shell script** (`scripts/git-info.sh`):
```bash
#!/bin/bash
echo "Branch: $(git branch --show-current)"
echo "Commits: $(git rev-list --count HEAD)"
echo "Last commit: $(git log -1 --format='%s')"
echo "Status: $(git status --short | wc -l) files changed"
```

### Shell with Arguments

```typescript
async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
  const result = await Bun.$`bash scripts/search.sh ${params.pattern} ${params.directory}`.text();
  return { content: [{ type: "text", text: result.trim() }] };
}
```

**Shell script** (`scripts/search.sh`):
```bash
#!/bin/bash
pattern=$1
directory=${2:-.}

echo "Searching for '$pattern' in $directory"
grep -r "$pattern" "$directory" --include="*.ts" --include="*.js" | head -20
```

## Using pi.exec()

For more control, use `pi.exec()`:

```typescript
async execute(_toolCallId, params, _onUpdate, _ctx, signal) {
  const result = await pi.exec("python3", ["scripts/analyze.py", params.input], {
    signal,
    timeout: 30000,  // 30 second timeout
  });
  
  if (result.code !== 0) {
    return {
      content: [{ type: "text", text: `Error (exit ${result.code}): ${result.stderr}` }],
      isError: true,
    };
  }
  
  return { content: [{ type: "text", text: result.stdout.trim() }] };
}
```

## Node.js Scripts

### Child Process

```typescript
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
  try {
    const { stdout, stderr } = await execAsync(`node scripts/process.js ${params.input}`);
    if (stderr) {
      return { content: [{ type: "text", text: `Warning: ${stderr}\n${stdout}` }] };
    }
    return { content: [{ type: "text", text: stdout.trim() }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
}
```

## Error Handling

### Timeout and Cancellation

```typescript
async execute(_toolCallId, params, _onUpdate, _ctx, signal) {
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  // Combine with external signal
  signal?.addEventListener("abort", () => controller.abort());
  
  try {
    const proc = Bun.spawn(["python3", "scripts/slow.py"], {
      signal: controller.signal,
      stdout: "pipe",
    });
    
    const output = await new Response(proc.stdout).text();
    return { content: [{ type: "text", text: output }] };
  } catch (error: any) {
    if (error.name === "AbortError") {
      return { content: [{ type: "text", text: "Cancelled or timed out" }] };
    }
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  } finally {
    clearTimeout(timeout);
  }
}
```

### Streaming Output

```typescript
async execute(_toolCallId, params, onUpdate, _ctx, _signal) {
  const proc = Bun.spawn(["python3", "scripts/progress.py"], {
    stdout: "pipe",
  });
  
  const reader = proc.stdout.getReader();
  let output = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = new TextDecoder().decode(value);
    output += text;
    
    // Stream progress to UI
    onUpdate?.({ content: [{ type: "text", text: output }] });
  }
  
  return { content: [{ type: "text", text: output }] };
}
```

## Best Practices

1. **Use absolute paths** or paths relative to project root
2. **Handle errors** - check exit codes and stderr
3. **Set timeouts** - prevent hanging scripts
4. **Respect cancellation** - check signal.aborted
5. **Sanitize inputs** - escape shell arguments
6. **Stream long output** - use onUpdate for progress
7. **Truncate output** - don't overflow context

## Script Location

Store scripts in:
- `.pi/extensions/<name>/scripts/` - extension-specific
- `scripts/` - project-wide
- Use `project root` env var for absolute paths
