---
description: Generate an image using Gemini (Nano Banana models)
skill: image-gen
---

Generate an image using the Gemini image generation API. The user's request: $ARGUMENTS

## Instructions

1. **Parse the request.** The user may provide:
   - A description of what to generate + where to save it
   - A file path to read first (generate an image that matches the content)
   - A reference image to restyle or use as composition guide
   - Just a description (ask where to save, or default to `./generated-image.png`)

2. **If given a file path**, read it to understand the content, then craft an
   image prompt that captures the central theme or concept as a visual.

3. **Locate the generate script.** It's at:
   `packages/pi-img-gen/skills/image-gen/scripts/generate.sh`

4. **Generate the image:**
   ```bash
   bun packages/pi-img-gen/skills/image-gen/scripts/generate.ts "<prompt>" "<output_path>" [model] [ref_image...]
   ```

   Available models:
   - `gemini-2.5-flash-image` — default, fast + good quality
   - `gemini-3-pro-image-preview` — Nano Banana Pro, best for complex scenes and text
   - `gemini-3.1-flash-image-preview` — Nano Banana 2, latest

   Reference images (optional):
   - Pass one or more image file paths after the model argument
   - Images are sent alongside the prompt for style transfer or editing
   - Use for: restyling memes, matching composition, combining styles

5. **Show the user** the generated image path and prompt used so they can iterate.
