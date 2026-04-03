# pi-img-gen

Generate images using Gemini's native image generation models (Nano Banana family).

## Setup

Add to `config.toml`:

```toml
[img_gen]
gemini_api_key = "AIza..."                        # required
default_model = "gemini-2.5-flash-image"          # optional
```

Then run `just init` to generate `.pi/pi-img-gen.json`.

## What's Included

| Resource | Description |
|----------|-------------|
| **Skill: `image-gen`** | Instructions, model reference, prompt crafting tips |
| **Prompt: `/gen-image`** | Slash command to generate images interactively |
| **Script: `generate.sh`** | Standalone bash script for the Gemini API call |

## Usage

### Slash command

```
/gen-image A minimalist illustration of a lighthouse at sunset, save to ./images/lighthouse.png
/gen-image path/to/article.md
```

### Script directly

```bash
bash packages/pi-img-gen/skills/image-gen/scripts/generate.sh "your prompt" output.png [model]
```

## Models

| Model | ID | Notes |
|-------|----|-------|
| Nano Banana | `gemini-2.5-flash-image` | Default — fast, good quality |
| Nano Banana 2 | `gemini-3.1-flash-image-preview` | Latest, up to 4K |
| Nano Banana Pro | `gemini-3-pro-image-preview` | Best fidelity, text rendering |

## Requirements

- `curl`, `jq`, `base64`
- A Gemini API key with image generation access
