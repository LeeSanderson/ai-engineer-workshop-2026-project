#!/bin/bash
set -eo pipefail

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>   (set DEBUG=1 for set -x tracing)" >&2
  exit 1
fi

iterations=$1

if [ "$DEBUG" = "1" ]; then
  set -x
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
env_file="$script_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Error: $env_file not found. Create one with ANTHROPIC_API_KEY=..." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. "$env_file"
set +a

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Error: ANTHROPIC_API_KEY is not set in .env" >&2
  exit 1
fi

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# `docker sandbox run` allocates a TTY and swallows the agent's stdout in
# --print mode, so we use `exec -i` against a pre-created sandbox instead.
sandbox_name="claude-$(basename "$PWD")"
if ! docker sandbox ls -q 2>/dev/null | grep -qx "$sandbox_name"; then
  echo "Creating sandbox $sandbox_name..." >&2
  docker sandbox create claude --name "$sandbox_name" >&2
fi

# jq filter to extract final result
final_result='select(.type == "result").result // empty'

for ((i=1; i<=iterations; i++)); do
  : > "$tmpfile"

  echo "=== Iteration $i / $iterations @ $(date -Iseconds) ===" >&2

  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
  issues=$(cat issues/*.md 2>/dev/null || echo "No issues found")
  prompt=$(cat ralph/prompt.md)

  echo "Prompt: $(printf '%s' "$prompt" | wc -c)B  Issues: $(printf '%s' "$issues" | wc -c)B  Commits: $(printf '%s\n' "$commits" | wc -l) lines" >&2

  # `set +e` + PIPESTATUS so we can see the docker exit code even when later
  # stages of the pipeline (grep/jq) fail to find anything.
  set +e
  docker sandbox exec -i -e "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" "$sandbox_name" claude \
      --verbose \
      --print \
      --output-format stream-json <<EOF \
    | { grep --line-buffered '^{' || true; } \
    | tee "$tmpfile" \
    | jq --unbuffered -rf ralph/format.jq
Previous commits: $commits

Issues: $issues

$prompt
EOF
  pipestatus=("${PIPESTATUS[@]}")
  set -e

  claude_exit=${pipestatus[0]}
  echo "claude exit=$claude_exit  pipestatus=[${pipestatus[*]}]" >&2

  if [ ! -s "$tmpfile" ]; then
    echo "Iteration $i produced no JSON output." >&2
    if [ "$claude_exit" -ne 0 ]; then
      echo "Aborting: claude exited non-zero with no output." >&2
      exit "$claude_exit"
    fi
    continue
  fi

  result=$(jq -r "$final_result" "$tmpfile" 2>/dev/null || true)
  echo "Result preview: ${result:0:200}" >&2

  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations." >&2
    exit 0
  fi
done
