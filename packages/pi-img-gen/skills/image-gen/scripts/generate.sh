#!/usr/bin/env bash
# Generate an image using Gemini's image generation API
#
# Usage: generate.sh <prompt> <output_path> [model] [ref_image...]
#
# Arguments:
#   prompt           — Text prompt describing the image to generate
#   output_path      — Where to save the generated image
#   model            — Model name (optional, default from config or gemini-2.5-flash-image)
#   ref_image...     — One or more reference images for style transfer / editing
#
# Models:
#   gemini-2.5-flash-image         — Nano Banana, fast + good quality (default)
#   gemini-3.1-flash-image-preview — Nano Banana 2, latest, up to 4K
#   gemini-3-pro-image-preview     — Nano Banana Pro, highest fidelity
#   nano-banana-pro-preview        — alias for Pro
#
# Requirements: curl, jq, base64

set -euo pipefail

PROMPT="${1:?Usage: generate.sh <prompt> <output_path> [model] [ref_image...]}"
OUTPUT="${2:?Usage: generate.sh <prompt> <output_path> [model] [ref_image...]}"
MODEL="${3:-}"
shift 3 2>/dev/null || shift $#
# Remaining args are reference images
REF_IMAGES=("$@")

# --- Resolve config from .pi/pi-img-gen.json ---
CONFIG_JSON=""
search_dir="$(pwd)"
while [ "$search_dir" != "/" ]; do
  if [ -f "$search_dir/.pi/pi-img-gen.json" ]; then
    CONFIG_JSON="$search_dir/.pi/pi-img-gen.json"
    break
  fi
  search_dir="$(dirname "$search_dir")"
done

# --- Resolve API key ---
if [ -z "${GEMINI_API_KEY:-}" ] && [ -n "$CONFIG_JSON" ]; then
  GEMINI_API_KEY=$(jq -r '.gemini_api_key // empty' "$CONFIG_JSON" 2>/dev/null || true)
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  search_dir="$(pwd)"
  while [ "$search_dir" != "/" ]; do
    if [ -f "$search_dir/config.toml" ]; then
      key=$(grep 'gemini_api_key' "$search_dir/config.toml" 2>/dev/null | head -1 | sed 's/.*= *"//' | sed 's/".*//')
      if [ -n "$key" ]; then
        GEMINI_API_KEY="$key"
        break
      fi
    fi
    search_dir="$(dirname "$search_dir")"
  done
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "ERROR: No Gemini API key found." >&2
  echo "Set GEMINI_API_KEY, or add [img_gen] gemini_api_key to config.toml and run 'just init'" >&2
  exit 1
fi

# --- Resolve default model ---
if [ -z "$MODEL" ] && [ -n "$CONFIG_JSON" ]; then
  MODEL=$(jq -r '.default_model // empty' "$CONFIG_JSON" 2>/dev/null || true)
fi
MODEL="${MODEL:-gemini-2.5-flash-image}"

# --- Ensure output directory exists ---
mkdir -p "$(dirname "$OUTPUT")"

# --- Helper: get MIME type from extension ---
get_mime() {
  local ext
  ext=$(echo "${1##*.}" | tr '[:upper:]' '[:lower:]')
  case "$ext" in
    jpg|jpeg) echo "image/jpeg" ;;
    png)      echo "image/png" ;;
    webp)     echo "image/webp" ;;
    gif)      echo "image/gif" ;;
    *)        echo "image/png" ;;
  esac
}

# --- Build request payload ---
PAYLOAD_FILE=$(mktemp)
trap "rm -f $PAYLOAD_FILE" EXIT

PROMPT_ESC=$(printf '%s' "$PROMPT" | jq -Rs .)

if [ ${#REF_IMAGES[@]} -gt 0 ]; then
  # Build JSON with inline base64 images via streaming writes
  # Structure: { contents: [{ parts: [image1, image2, ..., text] }], generationConfig: ... }
  printf '{"contents":[{"parts":[' > "$PAYLOAD_FILE"

  first=true
  for ref in "${REF_IMAGES[@]}"; do
    if [ ! -f "$ref" ]; then
      echo "WARNING: Reference image not found: $ref" >&2
      continue
    fi
    mime=$(get_mime "$ref")
    if [ "$first" = true ]; then first=false; else printf ',' >> "$PAYLOAD_FILE"; fi
    printf '{"inlineData":{"mimeType":"%s","data":"' "$mime" >> "$PAYLOAD_FILE"
    base64 -w0 "$ref" >> "$PAYLOAD_FILE"
    printf '"}}' >> "$PAYLOAD_FILE"
    echo "Reference: $ref ($mime)" >&2
  done

  printf ',{"text":%s}]}],"generationConfig":{"responseModalities":["IMAGE","TEXT"]}}' "$PROMPT_ESC" >> "$PAYLOAD_FILE"
else
  # Text-only prompt
  jq -n --arg prompt "$PROMPT" '{
    contents: [{parts: [{text: $prompt}]}],
    generationConfig: {responseModalities: ["IMAGE", "TEXT"]}
  }' > "$PAYLOAD_FILE"
fi

echo "Model: $MODEL" >&2
echo "Prompt: ${PROMPT:0:120}$([ ${#PROMPT} -gt 120 ] && echo '...')" >&2
echo "Output: $OUTPUT" >&2

# --- Call API ---
RESP=$(curl -s --max-time 120 \
  "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d @"$PAYLOAD_FILE")

# --- Check for errors ---
ERROR=$(echo "$RESP" | jq -r '.error.message // empty' 2>/dev/null)
if [ -n "$ERROR" ]; then
  echo "ERROR: $ERROR" >&2
  exit 1
fi

# --- Extract image ---
IMAGE_DATA=$(echo "$RESP" | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' 2>/dev/null)
if [ -z "$IMAGE_DATA" ]; then
  echo "ERROR: No image in response" >&2
  echo "$RESP" | jq -r '.candidates[0].content.parts[] | select(.text) | .text' 2>/dev/null >&2
  exit 1
fi

echo "$IMAGE_DATA" | base64 -d > "$OUTPUT"

# --- Report ---
TEXT=$(echo "$RESP" | jq -r '.candidates[0].content.parts[] | select(.text) | .text' 2>/dev/null)
[ -n "$TEXT" ] && echo "Note: $TEXT" >&2

SIZE=$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT" 2>/dev/null)
echo "Saved: $OUTPUT ($(( SIZE / 1024 ))KB)" >&2

echo "$OUTPUT"
