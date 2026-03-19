# Blog Conventions

Platform-specific conventions for blog post review. Load when reviewing blog content.

## Zola (rohanverma.net)

### Directory Structure
```
content/blog/
├── _index.md           # Section config
├── YYYY-MM-DD-slug.md  # Date-prefixed posts (older)
└── slug-title.md       # Slug-only posts (recent)
```

### TOML Frontmatter
```toml
+++
title = "Post Title"
date = "2026-01-22T16:55:48+00:00"
path = "blog/2026/01/22/post-slug/"

[extra]
  author = "Rohan Verma"
  description = "Brief description for SEO/social"
  tags = ["tag1", "tag2"]
  draft = false
+++
```

### Required Fields
- `title` - Post title
- `date` - ISO8601 timestamp
- `path` - URL path (determines permalink)

### Optional Fields
- `[extra].author` - Author name
- `[extra].description` - Meta description
- `[extra].tags` - Array of tags
- `[extra].draft` - Boolean, hides from listing if true

### URL Convention
```
/blog/YYYY/MM/DD/post-slug/
```

### Checklist for Zola Posts
- [ ] Frontmatter uses TOML (`+++` delimiters)
- [ ] Date is valid ISO8601
- [ ] Path matches date in URL
- [ ] Tags are lowercase, hyphenated
- [ ] Draft is false for publication
- [ ] Description present for social sharing

## Voice Reference: Bosun Tech Blog

When matching Bosun tech blog voice:

**Characteristics:**
- Team perspective ("we")
- Longer, complex sentences with multiple clauses
- Explains business context and reasoning thoroughly
- Deep technical dives with code samples
- Formal transitions
- Story arc: problem → exploration → solution → lessons

**Example patterns:**
- "Considering all the facts..."
- "The major lesson here..."
- "We ended up..."

## Voice Reference: Personal Blog

When matching personal blog voice:

**Characteristics:**
- Individual perspective ("I")
- Short, punchy sentences with occasional fragments
- Assumes technical familiarity
- Process-focused narrative
- Direct, sparse transitions
- Method demonstration

**Example patterns:**
- "Here's what I learned..."
- "The interesting part..."
- "I kept running into..."

## Common Issues

### Frontmatter Errors
- Missing `+++` delimiters (YAML `---` won't work in Zola)
- Invalid date format
- Path doesn't match expected URL structure

### Content Issues
- Code blocks missing language identifier
- Images without alt text
- Broken relative links (use absolute paths)
- Inconsistent heading levels

### Publication Workflow
1. Create post in `content/blog/`
2. Set `draft = true` while editing
3. Review with editorial-review skill
4. Set `draft = false`
5. Commit and push to trigger build
