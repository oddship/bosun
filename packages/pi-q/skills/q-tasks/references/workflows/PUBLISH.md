# Publish Workflow

Publish items from private to public.

## Usage

Can be invoked with explicit type and ID, or interactively.

## Steps

```bash
qt publish <id>   # for tasks
qp publish <id>   # for projects
qr publish <id>   # for roadmaps
```

## Interaction

If no type specified, ask:

```
question: "What do you want to publish?"
header: "Type"
options:
  - label: "Task"
    description: "Publish a specific task"
  - label: "Project"
    description: "Publish a project"
  - label: "Roadmap"
    description: "Publish a roadmap"
```

If no ID provided, list items of that type and ask user to select.

## Post-Publish

Update visibility index at `workspace/users/$USER/.visibility-index.md`

## Output

Confirm what was published and the public path.
