#!/usr/bin/env bash
#
# Bosun Onboard — first-time project setup.
#
# Two modes:
#   Local      — running inside the bosun repo
#   Dependency — bosun installed via bun add github:oddship/bosun
#
# Usage:
#   ./scripts/onboard.sh          (local mode)
#   npx bosun onboard             (dependency mode, via bin entry)
#   npx bosun doctor              (check config drift + tools)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(pwd)"

# Detect mode
if [[ -d "$PROJECT_ROOT/node_modules/bosun/packages" ]] && [[ ! -f "$PROJECT_ROOT/packages/pi-bosun/package.json" ]]; then
  MODE="dependency"
  BOSUN_PKG="$PROJECT_ROOT/node_modules/bosun"
else
  MODE="local"
  BOSUN_PKG="$PROJECT_ROOT"
fi

# --- Commands ---

cmd_onboard() {
  echo "=== Bosun Onboarding ($MODE mode) ==="
  echo ""

  # 1. Create config.toml from sample
  if [[ ! -f "$PROJECT_ROOT/config.toml" ]]; then
    cp "$BOSUN_PKG/config.sample.toml" "$PROJECT_ROOT/config.toml"
    echo "✓ Created config.toml from sample"
    echo "  Edit it with your API keys: vim config.toml"
  else
    echo "○ config.toml already exists"
  fi

  # 2. Create directory structure
  mkdir -p "$PROJECT_ROOT/.pi/agents" "$PROJECT_ROOT/.pi/skills" "$PROJECT_ROOT/.pi/slots"
  mkdir -p "$PROJECT_ROOT/workspace/users"
  mkdir -p "$PROJECT_ROOT/.bosun-home/.pi/agent"
  echo "✓ Created directory structure"

  # 3. Dependency mode: generate downstream justfile
  if [[ "$MODE" == "dependency" ]]; then
    if [[ ! -f "$PROJECT_ROOT/justfile" ]]; then
      cat > "$PROJECT_ROOT/justfile" << 'JUSTFILE'
# Project justfile — imports bosun's recipes
# Override any recipe by defining it below the import.

export BOSUN_PKG := justfile_directory() / "node_modules/bosun"
import "node_modules/bosun/justfile"
JUSTFILE
      echo "✓ Generated justfile (imports bosun's recipes)"
    else
      echo "○ justfile already exists"
    fi
  fi

  # 4. Run init
  echo ""
  bun "$BOSUN_PKG/scripts/init.ts"

  # 5. Next steps
  echo ""
  echo "=== Next Steps ==="
  echo "  1. Edit config.toml with your API keys"
  echo "  2. Login to pi:"
  echo "     PI_CODING_AGENT_DIR=$PROJECT_ROOT/.bosun-home/.pi/agent pi /login"
  echo "  3. Start: just start"
  echo ""
  if [[ "$MODE" == "dependency" ]]; then
    echo "To override an agent:"
    echo "  cp node_modules/bosun/packages/pi-bosun/agents/bosun.md .pi/agents/bosun.md"
    echo "  # edit .pi/agents/bosun.md"
    echo ""
  fi
}

cmd_doctor() {
  echo "=== Bosun Doctor ==="
  echo ""

  # Check tools
  local ok=true
  for cmd in bash tmux bun pi git rg jq; do
    if command -v "$cmd" &>/dev/null; then
      printf "  ✓ %-10s %s\n" "$cmd" "$(command -v "$cmd")"
    else
      printf "  ✗ %-10s missing\n" "$cmd"
      ok=false
    fi
  done
  if command -v bwrap &>/dev/null; then
    printf "  ✓ %-10s %s\n" "bwrap" "$(command -v bwrap)"
  else
    printf "  ○ %-10s missing (optional — needed for sandboxed mode)\n" "bwrap"
  fi
  echo ""

  # Check config drift
  if [[ -f "$PROJECT_ROOT/config.toml" ]] && [[ -f "$BOSUN_PKG/config.sample.toml" ]]; then
    # Extract section headers from both files
    local sample_sections current_sections
    sample_sections=$(grep '^\[' "$BOSUN_PKG/config.sample.toml" | sort)
    current_sections=$(grep '^\[' "$PROJECT_ROOT/config.toml" | sort)

    local missing
    missing=$(comm -23 <(echo "$sample_sections") <(echo "$current_sections"))
    if [[ -n "$missing" ]]; then
      echo "⚠ config.toml is missing sections from the latest sample:"
      echo "$missing" | sed 's/^/    /'
      echo ""
      echo "  These sections use defaults. To customize, copy them from:"
      echo "  $BOSUN_PKG/config.sample.toml"
      echo ""
    else
      echo "✓ config.toml has all sections from sample"
    fi
  fi

  # Show version
  if [[ -f "$BOSUN_PKG/package.json" ]]; then
    local version
    version=$(grep '"version"' "$BOSUN_PKG/package.json" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
    echo "Bosun version: $version ($MODE mode)"
  fi

  echo ""
  $ok && echo "All good." || echo "Install missing tools first."
}

# --- Main ---

case "${1:-onboard}" in
  onboard) cmd_onboard ;;
  doctor)  cmd_doctor ;;
  *)
    echo "Usage: bosun [onboard|doctor]"
    echo ""
    echo "Commands:"
    echo "  onboard    First-time project setup"
    echo "  doctor     Check tools and config drift"
    exit 1
    ;;
esac
