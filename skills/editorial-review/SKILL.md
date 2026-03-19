---
name: editorial-review
description: |
  Editorial review for written content (blog posts, documentation, READMEs).
  Use when reviewing prose for clarity, accuracy, voice, and structure.
  Complements code review - invoke via @review agent for written content.
---

# Editorial Review

Review written content for clarity, accuracy, voice consistency, and structure. Use for blog posts, documentation, READMEs, and other prose.

## When to Use

- Reviewing blog posts before publication
- Checking documentation for clarity and accuracy
- Validating READMEs and project descriptions
- Auditing changelogs and release notes
- Any prose that will be read by humans

## Review Checklist

### 1. Factual Accuracy
- [ ] Claims are verifiable or sourced
- [ ] Numbers and statistics are correct
- [ ] Links resolve and point to right content
- [ ] Code examples work (if applicable)
- [ ] Technical terms used correctly

### 2. Clarity and Structure
- [ ] Opening hooks the reader
- [ ] Main point is clear within first few paragraphs
- [ ] Logical flow between sections
- [ ] Conclusion provides value (not just summary)
- [ ] Headings accurately describe content

### 3. Voice and Authenticity
- [ ] Consistent voice throughout
- [ ] No AI writing patterns (load humanizer skill if needed)
- [ ] Appropriate tone for audience
- [ ] First-person used appropriately
- [ ] Personality present where fitting

### 4. Technical Quality
- [ ] Markdown renders correctly
- [ ] Images have alt text
- [ ] Code blocks have language tags
- [ ] No broken formatting
- [ ] Frontmatter/metadata complete

### 5. Audience Fit
- [ ] Assumes correct level of knowledge
- [ ] Explains necessary context
- [ ] Doesn't over-explain basics
- [ ] Actionable for target reader

## Review Process

### Step 1: Quick Scan
Read through once without stopping. Note:
- Does it hold attention?
- Is the main point clear?
- Any jarring moments?

### Step 2: Detailed Review
Go section by section:
```bash
# Check links
grep -oE 'https?://[^)]+' file.md | while read url; do
  curl -sI "$url" | head -1
done

# Check for AI patterns
# (invoke humanizer skill if concerned)
```

### Step 3: Verify Claims
For each factual claim:
- Can it be verified from source?
- Is the source cited or obvious?
- Are numbers/stats accurate?

### Step 4: Voice Check
- Read first paragraph, then last
- Do they sound like same author?
- Is tone consistent with purpose?

## Output Format

```markdown
## Editorial Review

**Content:** {title/description}
**Assessment:** [APPROVE / SUGGEST_CHANGES / NEEDS_REVISION]

### Accuracy Issues
1. **[Line X]** Claim: "{claim}" - Issue: {what's wrong}

### Clarity Issues
1. **[Section X]** {what's unclear and why}

### Voice Issues
1. **[Line X]** {pattern detected, suggestion}

### Positive Notes
- {what works well}

### Verdict
**[APPROVE]** Ready for publication.

OR

**[SUGGEST_CHANGES]** Minor improvements:
1. {suggestion}

OR

**[NEEDS_REVISION]** Address before publishing:
1. {required fix}
```

## Related Skills

- **humanizer** - For detecting and fixing AI writing patterns
- **session-analysis** - For verifying claims against session evidence

## References

Load context-specific patterns on demand:

- `references/blog-conventions.md` - Blog-specific patterns (Zola, frontmatter, etc.)
