---
name: image-gen
description: >-
  Generate images using Gemini's image generation API (Nano Banana models).
  Use when generating blog images, illustrations, diagrams, or any visual
  content. Supports gemini-2.5-flash-image, Nano Banana Pro, and Nano Banana 2.
license: MIT
compatibility: pi
metadata:
  audience: developers
  category: content
---

# Image Generation with Gemini

Generate images using Google's Gemini native image generation models via the REST API.

## Available Models

| Model ID | Alias | Best For |
|----------|-------|----------|
| `gemini-2.5-flash-image` | Nano Banana | Fast generation, blog images (default) |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | Latest, up to 4K resolution |
| `gemini-3-pro-image-preview` | Nano Banana Pro | Complex layouts, text rendering |
| `nano-banana-pro-preview` | — | Same as Pro (alias) |

## Configuration

The package reads `.pi/pi-img-gen.json` for settings (generated from `config.toml` by `just init`).

### config.toml

```toml
[img_gen]
gemini_api_key = "AIza..."          # required — or set GEMINI_API_KEY env var
default_model = "gemini-2.5-flash-image"  # optional
```

### Generated .pi/pi-img-gen.json

```json
{
  "gemini_api_key": "AIza...",
  "default_model": "gemini-2.5-flash-image"
}
```

## Script

The generate script is at `scripts/generate.sh` relative to this skill directory.

```bash
# Resolve from skill location
bun <skill-dir>/scripts/generate.ts "<prompt>" "<output_path>" [model] [ref_image...]

# Shell script also available (same interface)
bash <skill-dir>/scripts/generate.sh "<prompt>" "<output_path>" [model] [ref_image...]
```

### Arguments

| Arg | Required | Description |
|-----|----------|-------------|
| `prompt` | Yes | Image generation prompt |
| `output_path` | Yes | Where to save the PNG |
| `model` | No | Model ID (overrides config default) |
| `ref_image...` | No | One or more reference images for style transfer or editing |

### API Key Resolution Order

1. `GEMINI_API_KEY` environment variable
2. `.pi/pi-img-gen.json` → `gemini_api_key`
3. `config.toml` → `[img_gen] gemini_api_key` (fallback search upward from cwd)

## Examples

```bash
# Generate a simple illustration
bash scripts/generate.sh \
  "A minimalist line art illustration of a lighthouse, clean design" \
  ./output/lighthouse.png

# Use Nano Banana Pro for complex scenes
bash scripts/generate.sh \
  "A detailed architectural diagram of a microservices system with labels" \
  ./output/architecture.png \
  gemini-3-pro-image-preview

# Style transfer: restyle a reference image
bun scripts/generate.ts \
  "Transform this into a retro Indian Doordarshan-style illustration. Keep the same composition and pose." \
  ./output/restyled.png \
  gemini-3-pro-image-preview \
  ./reference/original-meme.webp

# Multiple reference images (e.g. style from one, composition from another)
bun scripts/generate.ts \
  "Combine the style of the first image with the layout of the second" \
  ./output/combined.png \
  gemini-3-pro-image-preview \
  ./reference/style.png \
  ./reference/layout.png
```

### Reference Images

One or more reference images can be passed as trailing arguments. They're sent alongside the text prompt. Useful for:

- **Style transfer**: "Transform this photo into a watercolor illustration"
- **Composition reference**: "Generate an image with the same layout as this, but with different subjects"
- **Meme restyling**: "Recreate this meme in a different art style"
- **Multi-reference**: Combine style from one image with content/layout from another

Supported formats: PNG, JPEG, WebP, GIF. Images are base64-encoded and sent as inline data parts.

## Prompt Crafting Tips

Good prompts produce better images. Include:

- **Style direction**: "minimalist line art", "watercolor", "flat design", "isometric"
- **Purpose context**: "suitable as a blog header", "icon for documentation"
- **Color guidance**: "black and white", "muted earth tones", "vibrant neon"
- **Composition**: "centered subject", "wide landscape", "close-up detail"

### For blog/article images

- Keep it simple — avoid photorealism unless the topic demands it
- Match the tone of the writing (playful → cartoonish, serious → clean/minimal)
- Think about what visual metaphor captures the article's central idea

### For technical content

- Use "diagram" or "schematic" in the prompt for technical layouts
- Specify "with labels" if you want text in the image
- Use Nano Banana Pro (`gemini-3-pro-image-preview`) for text-heavy images

## Integration Workflow

1. **Read the source content** (page, article, README) to understand the topic
2. **Craft a prompt** that captures the central idea as a visual
3. **Generate** with the script
4. **Review** the output — iterate on the prompt if needed
5. **Place** the image in the correct directory for your project
6. **Reference** it from your content (e.g., `![alt](/images/name.png)`)

## When NOT to Use

- Pages that already have good images
- Short content that doesn't benefit from visuals
- Cases where a screenshot or actual diagram tool (Excalidraw, Mermaid) would be more appropriate
