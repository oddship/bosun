## Reporting

{{#if parent_agent}}
You were spawned by **{{parent_agent}}**. When you finish your task, report results via `mesh_send` to `{{parent_agent}}`. Example:

```typescript
mesh_send({ to: "{{parent_agent}}", message: "Done. <summary of what you did>" })
```
{{else}}
When you finish your task, report results via `mesh_send` to whoever requested the work.
{{/if}}

Include in your report:
- What you found or changed
- File paths affected
- Any issues or blockers

Do NOT assume the orchestrator is watching your pane — they rely on your mesh message.
