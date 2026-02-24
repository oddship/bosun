# pi-question

Enhanced interactive question tool for [Pi](https://github.com/badlogic/pi-mono) with TUI, multiple selection, and custom input.

## Install

```bash
pi install npm:pi-question
```

## Features

- **Options list** with optional descriptions
- **Header** display for context (e.g., "Priority", "Triage")
- **Multiple selection** mode (Space to toggle, Enter to confirm)
- **Free-form input** via "Type something" option
- **Custom TUI rendering** with call/result views

## Usage

The LLM calls the `question` tool:

```
question({
  header: "Priority",
  question: "How urgent is this issue?",
  options: [
    { label: "P0 - Critical", description: "System down, data loss" },
    { label: "P1 - High", description: "Major functionality broken" },
    { label: "P2 - Medium", description: "Important but workaround exists" },
    { label: "P3 - Low", description: "Nice to have" }
  ]
})
```

Multiple selection:

```
question({
  question: "Which items should we archive?",
  options: [
    { label: "Task A" },
    { label: "Task B" },
    { label: "Task C" }
  ],
  multiple: true
})
```

## License

MIT
