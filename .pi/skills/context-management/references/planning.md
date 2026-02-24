# Planning Workflow

Full workflow for structured task planning in Zero.

## When to Plan

| Task Complexity | Planning Approach |
|-----------------|-------------------|
| Simple (quick fixes) | Minimal - brief inline plan |
| Medium (feature additions) | Detailed plan with steps |
| Complex (architecture changes) | Comprehensive plan with phases |

## The Five Phases

### Phase 1: Initial Context Gathering

1. **Quick Assessment**: Understand the basic nature of the request

2. **Search for Prior Context**:
   ```bash
   rg -l "keyword" workspace/users/$USER/sessions/
   rg -C3 "keyword" workspace/users/$USER/
   ```

3. **Gather Basic Context**:
   - Check git status and branch
   - Use `rg` for fast codebase searches
   - Review configuration files
   - Check dependencies and build setup

4. **Ask Clarifying Questions**:
   - What are the success criteria?
   - Are there any constraints or requirements?
   - What is the scope of changes?
   - Are there existing patterns to follow?

5. **Load Relevant Skills**:
   ```
   skill({ name: "frontend" })    # Frontend work
   skill({ name: "backend" })       # Backend work
   skill({ name: "background-processes" })  # Dev servers
   ```

### Phase 2: Plan Creation

1. **Generate Plan Name**: Descriptive, kebab-case (e.g., `add-user-auth`)

2. **Create Plan Document**:
   ```
   workspace/users/{username}/plans/{YYYY-MM}/{DD-HH-MM-plan-name}.md
   ```

3. **Plan Structure**: See templates in `templates.md`

4. **Present Plan**: Show path, ask for review

### Phase 3: Plan Verification & Iteration

1. **Collaborate**: Ask user to review, request feedback
2. **Iterate**: Update based on feedback until approved
3. **Confirm**: Get explicit approval before execution

### Phase 4: Execution

1. **Ask Permission**: Wait for explicit confirmation
2. **Execute Systematically**:
   - Follow plan step-by-step
   - Provide status updates at each phase gate
   - Keep user informed of milestones
3. **Handle Issues**: Explain problems, propose solutions
4. **Verify Success**: Check against success criteria, run tests
5. **Iterate**: Fix issues, continue until goals achieved

### Phase 5: Completion

1. **Summarize Results**: What was accomplished, deviations, follow-ups
2. **Update Plan**: Add "Execution Summary" section

## Multi-Phase Execution with Gates

**CRITICAL: Run verify and review spawn_agent before EVERY commit.**

For multi-phase plans, execute autonomously with gates at each checkpoint:

```
Multi-Phase Execution Loop (AUTONOMOUS):

1. Pick current phase from plan
2. Complete phase/checkpoint work
3. spawn_agent({ agent: "verify", ... })
     - PASS: continue to step 4
     - FAIL: fix in place, re-verify (loop)
4. spawn_agent({ agent: "review", ... })
     - APPROVE: continue to step 5
     - REQUEST_CHANGES: fix in place, re-review
5. Commit changes for this phase
     - Only after BOTH gates pass
     - Use conventional commit format
     - Do NOT create separate "fix" commits
6. Brief status: "Phase N complete, continuing to N+1"
7. Repeat from step 1 until all phases done

Continue autonomously between phases:
- Don't wait for user approval after each commit
- DO provide brief status updates
- ONLY pause if genuinely blocked or need clarification
```

**Key rules:**
- Gate each phase independently (don't batch gates at the end)
- Both gates must pass before committing
- Fix issues in place, then re-run the failed gate
- Continue autonomously after gates pass, with brief status updates
- Only pause for user if genuinely blocked or need clarification

### Using spawn_agent() for Gates

Use `spawn_agent()` with `agentScope: "project"` to invoke gate agents.

**verify** - Invoke after completing each phase/checkpoint:

```typescript
spawn_agent({
  agent: "verify",
  agentScope: "project",
  task: `Verify Phase 2 of plan.

Plan: workspace/users/$USER/plans/2026-01/08-15-50-my-plan.md
Checkpoint: Phase 2 - Create skill structure

Success criteria:
1. SKILL.md exists with valid frontmatter
2. Scripts are executable and return expected output
3. No regressions in existing functionality

Files changed:
- .pi/skills/context-management/SKILL.md
- .pi/skills/context-management/scripts/list.ts`
})
```

**review** - Invoke after verify passes, before committing:

```typescript
spawn_agent({
  agent: "review",
  agentScope: "project",
  task: `Review Phase 2 changes.

Context: Created skill structure for context-management as part of:
workspace/users/$USER/plans/2026-01/08-15-50-my-plan.md

Files to review:
- .pi/skills/context-management/SKILL.md
- .pi/skills/context-management/scripts/list.ts

Focus on: code quality, naming conventions, error handling`
})
```

### Gate Results Decision Table

| Verify Result | Review Result | Action |
|---------------|---------------|--------|
| PASS | APPROVE | Commit and continue to next phase |
| PASS | REQUEST_CHANGES | Fix in place, re-run review |
| FAIL | (skip) | Fix in place, re-run verify first |

## Progressive Disclosure

For complex plans, group phases into milestones with dry checks:

```
Milestone A (Phases 1-3): Core primitives
  Gate: unit tests pass for core modules
  Dry check: manual test of basic functionality

Milestone B (Phases 4-6): Integration
  Gate: extension loads, hooks fire correctly
  Dry check: end-to-end test in real environment

Milestone C (Phases 7-8): Polish + docs
  Gate: all tests pass, docs complete
  Dry check: full workflow validation
```

Pause at each milestone for a dry check before building more on top. This catches integration issues early.

## Best Practices

### Context Gathering
- Be efficient - don't over-gather for simple tasks
- Focus on relevant context
- Look for existing patterns and conventions

### Planning
- Be specific and actionable
- Consider edge cases and error handling
- Include rollback strategies for risky changes
- Keep plans proportional to task complexity

### Execution
- Follow the approved plan
- Provide status updates at each phase gate
- Test as you go
- Document deviations from the plan
