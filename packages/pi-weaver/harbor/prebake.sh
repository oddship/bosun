#!/bin/bash
# Pre-bake Terminal-Bench images with bun + pi pre-installed.
# Creates tagged images like: tb-pi/regex-log:2.0
# Cuts ~60s install overhead per task down to ~0.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TASK_CACHE="${REPO_ROOT}/.bosun-home/.cache/harbor/tasks"
PI_AUTH_JSON=${PI_AUTH_JSON:-$(bun -e "
const data = JSON.parse(require('fs').readFileSync('${REPO_ROOT}/.bosun-home/.pi/agent/auth.json','utf8'));
console.log(JSON.stringify({anthropic: data['anthropic']}));
")}

WEAVER_DIR="$(cd "$(dirname "$0")/../extension" && pwd)"

prebake_image() {
  local task_name="$1"
  local src_image="$2"
  local plain_tag="tb-pi/${task_name}:2.0"
  local weaver_tag="tb-pi-weaver/${task_name}:2.0"

  # Skip if already baked
  if docker image inspect "$plain_tag" &>/dev/null && docker image inspect "$weaver_tag" &>/dev/null; then
    echo "✓ $task_name (already baked)"
    return 0
  fi

  echo "⏳ Baking $task_name from $src_image..."

  # Pull source image if needed
  docker pull "$src_image" 2>/dev/null || true

  # Start container
  local cid
  cid=$(docker run -d "$src_image" sleep infinity)

  # Install system deps as root
  docker exec "$cid" bash -c '
    if command -v apk &> /dev/null; then
      apk add --no-cache curl bash git nodejs npm ripgrep
    elif command -v apt-get &> /dev/null; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update && apt-get install -y curl git unzip ripgrep
    elif command -v yum &> /dev/null; then
      yum install -y curl git ripgrep
    fi
  ' 2>&1 | tail -1

  # Create agent user if needed (Harbor uses "agent" user)
  docker exec "$cid" bash -c '
    id agent &>/dev/null || useradd -m -s /bin/bash agent
    mkdir -p /installed-agent /logs/agent /logs/verifier
    chmod 777 /installed-agent /logs/agent /logs/verifier
  '

  # Install bun + pi as agent user
  docker exec -u agent "$cid" bash -c '
    set -euo pipefail
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    ln -sf $(which bun) $HOME/.bun/bin/node
    bun add -g @mariozechner/pi-coding-agent
    pi --version
  '

  # Write auth + settings
  docker exec -u agent "$cid" bash -c "
    mkdir -p ~/.pi/agent
    echo '${PI_AUTH_JSON}' > ~/.pi/agent/auth.json
    chmod 600 ~/.pi/agent/auth.json
    echo '{\"defaultProvider\":\"anthropic\",\"defaultModel\":\"claude-haiku-4-5\"}' > ~/.pi/agent/settings.json
  "

  # Commit as plain pi image
  docker commit "$cid" "$plain_tag"
  echo "  ✓ $plain_tag"

  # Now add weaver extension
  docker exec "$cid" bash -c 'mkdir -p /installed-agent/weaver'
  docker cp "$WEAVER_DIR/index.ts" "$cid:/installed-agent/weaver/index.ts"
  docker cp "$WEAVER_DIR/prompt.ts" "$cid:/installed-agent/weaver/prompt.ts"
  docker exec "$cid" chown -R agent:agent /installed-agent/weaver

  # Commit as weaver image
  docker commit "$cid" "$weaver_tag"
  echo "  ✓ $weaver_tag"

  # Cleanup
  docker rm -f "$cid" >/dev/null
}

echo "=== Pre-baking Terminal-Bench images with Pi ==="
echo ""

for task_dir in "$TASK_CACHE"/*/; do
  task_name=$(ls "$task_dir")
  toml="$task_dir$task_name/task.toml"
  src_image=$(grep 'docker_image' "$toml" | sed 's/.*= *"\(.*\)"/\1/')
  prebake_image "$task_name" "$src_image"
done

echo ""
echo "=== Done! ==="
docker images | grep "tb-pi"
