#!/bin/bash
# Fast eval runner using pre-baked Docker images.
# Skips Harbor entirely — runs pi directly in containers, then runs verifiers.
#
# Usage:
#   ./run-fast.sh plain                          # All 10, Haiku
#   ./run-fast.sh weaver                         # All 10, Haiku
#   ./run-fast.sh both                           # Both variants
#   ./run-fast.sh plain regex-log                # Single task
#   MODEL=claude-sonnet-4-6 ./run-fast.sh both   # Sonnet
set -euo pipefail

MODE="${1:-both}"
SINGLE_TASK="${2:-}"
MODEL="${MODEL:-claude-haiku-4-5}"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TASK_CACHE="${REPO_ROOT}/.bosun-home/.cache/harbor/tasks"
RESULTS_DIR="${REPO_ROOT}/workspace/harbor-jobs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Fresh auth — injected at runtime, not baked into image
AUTH_JSON=$(cat "${REPO_ROOT}/.bosun-home/.pi/agent/auth.json")

# Collect task list
declare -A TASKS
for task_dir in "$TASK_CACHE"/*/; do
  task_name=$(ls "$task_dir")
  TASKS["$task_name"]="$task_dir$task_name"
done

run_task() {
  local task_name="$1"
  local variant="$2"  # "plain" or "weaver"
  local task_dir="${TASKS[$task_name]}"
  local instruction
  instruction=$(cat "$task_dir/instruction.md")

  local image_prefix
  if [ "$variant" = "weaver" ]; then
    image_prefix="tb-pi-weaver"
  else
    image_prefix="tb-pi"
  fi
  local image="${image_prefix}/${task_name}:2.0"

  local job_dir="${RESULTS_DIR}/fast-${variant}-${TIMESTAMP}/${task_name}"
  mkdir -p "$job_dir/agent" "$job_dir/verifier"

  echo "  ⏳ $task_name ($variant)..."
  local start_time=$SECONDS

  # Run the agent
  local pi_cmd
  if [ "$variant" = "weaver" ]; then
    pi_cmd="pi -p -e /installed-agent/weaver/index.ts"
  else
    pi_cmd="pi -p"
  fi

  # Start container
  local cid
  cid=$(docker run -d \
    --cpus=2 --memory=2g \
    "$image" sleep infinity)

  # Clean up logs dirs
  docker exec "$cid" bash -c "mkdir -p /logs/agent /logs/verifier; chmod 777 /logs/agent /logs/verifier" 2>/dev/null || true

  # Write instruction to a temp file, copy it in, so no shell escaping issues
  local tmpfile
  tmpfile=$(mktemp)
  echo "$instruction" > "$tmpfile"
  docker cp "$tmpfile" "$cid:/tmp/instruction.txt"
  docker exec "$cid" chmod 644 /tmp/instruction.txt
  rm -f "$tmpfile"

  # Inject fresh auth + model settings at runtime (tokens rotate, model may differ)
  local authtmp settingstmp
  authtmp=$(mktemp)
  settingstmp=$(mktemp)
  echo "$AUTH_JSON" > "$authtmp"
  echo "{\"defaultProvider\":\"anthropic\",\"defaultModel\":\"$MODEL\"}" > "$settingstmp"
  docker cp "$authtmp" "$cid:/tmp/auth.json"
  docker cp "$settingstmp" "$cid:/tmp/settings.json"
  docker exec "$cid" bash -c '
    cp /tmp/auth.json /home/agent/.pi/agent/auth.json
    cp /tmp/settings.json /home/agent/.pi/agent/settings.json
    chown agent:agent /home/agent/.pi/agent/auth.json /home/agent/.pi/agent/settings.json
    chmod 600 /home/agent/.pi/agent/auth.json
  '
  rm -f "$authtmp" "$settingstmp"

  # Run pi as agent user with timeout
  local agent_timeout=900
  docker exec -u agent "$cid" bash -c '
    export PATH="$HOME/.bun/bin:$PATH"
    export CI=1
    cd /app 2>/dev/null || cd ~
    INSTRUCTION=$(cat /tmp/instruction.txt)
    timeout '"${agent_timeout}"' '"${pi_cmd}"' -- "$INSTRUCTION" 2>&1 | tee /logs/agent/pi.txt
    cp -r ~/.pi/agent/sessions/ /logs/agent/sessions/ 2>/dev/null || true
  ' > "$job_dir/agent/stdout.txt" 2>&1 || true

  local elapsed=$(( SECONDS - start_time ))

  # Copy agent logs out
  docker cp "$cid:/logs/agent/." "$job_dir/agent/" 2>/dev/null || true

  # Run verifier (test.sh + test_outputs.py)
  # Terminal-Bench verifiers run as root, write reward to /logs/verifier/reward.txt
  local verifier_result="fail"
  local test_script="$task_dir/tests/test.sh"
  local test_outputs="$task_dir/tests/test_outputs.py"

  if [ -f "$test_script" ]; then
    docker cp "$test_script" "$cid:/tmp/test.sh"
    docker exec "$cid" chmod +x /tmp/test.sh
    # Copy all test files to /tests/ (test.sh expects them there)
    docker exec "$cid" mkdir -p /tests
    for testfile in "$task_dir/tests/"*; do
      docker cp "$testfile" "$cid:/tests/$(basename "$testfile")"
    done
    # Run verifier as root (it does apt-get, pip installs)
    docker exec "$cid" bash -c "cd /app 2>/dev/null || cd ~; /tmp/test.sh" > "$job_dir/verifier/stdout.txt" 2>&1 || true

    # Check reward
    local reward
    reward=$(docker exec "$cid" cat /logs/verifier/reward.txt 2>/dev/null || echo "0")
    if [ "$reward" = "1" ]; then
      verifier_result="pass"
    fi
  fi

  # Cleanup container
  docker rm -f "$cid" >/dev/null 2>&1

  # Write result
  echo "{\"task\":\"$task_name\",\"variant\":\"$variant\",\"result\":\"$verifier_result\",\"elapsed_sec\":$elapsed}" > "$job_dir/result.json"

  local icon="❌"
  [ "$verifier_result" = "pass" ] && icon="✅"
  echo "  $icon $task_name: $verifier_result (${elapsed}s)"
}

run_variant() {
  local variant="$1"
  echo ""
  echo "=== $variant ($(date)) ==="

  local pass=0
  local total=0

  if [ -n "$SINGLE_TASK" ]; then
    run_task "$SINGLE_TASK" "$variant"
  else
    for task_name in "${!TASKS[@]}"; do
      run_task "$task_name" "$variant"
      result=$(jq -r .result "${RESULTS_DIR}/fast-${variant}-${TIMESTAMP}/${task_name}/result.json")
      [ "$result" = "pass" ] && pass=$((pass + 1))
      total=$((total + 1))
    done
  fi

  echo ""
  echo "=== $variant: $pass/$total ==="
}

echo "=== Fast eval (pre-baked images) at $(date) ==="
echo "=== Model: $MODEL ==="

if [ "$MODE" = "both" ]; then
  run_variant "plain"
  run_variant "weaver"
elif [ "$MODE" = "plain" ] || [ "$MODE" = "weaver" ]; then
  run_variant "$MODE"
else
  echo "Usage: $0 [plain|weaver|both] [task-name]"
  exit 1
fi

echo ""
echo "=== Results in: $RESULTS_DIR/fast-*-$TIMESTAMP/ ==="
