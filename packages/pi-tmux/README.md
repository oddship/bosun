# pi-tmux

Terminal power tools for [Pi](https://github.com/badlogic/pi-mono) — split panes, send keystrokes, capture screen content, list windows.

## Install

```bash
pi install npm:pi-tmux
```

## Tools

| Tool | Description |
|------|-------------|
| `split_pane` | Open a command in a new tmux split pane |
| `send_keys` | Send text/keystrokes to a window or pane |
| `capture_pane` | Read screen content from a window or pane |
| `list_windows` | List all tmux windows in the session |

Requires running inside tmux. Auto-detects from `$TMUX` env var.

## License

MIT
