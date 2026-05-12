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

mkdir -p logs

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# jq filter to extract final result
final_result='select(.type == "result").result // empty'

for ((i=1; i<=iterations; i++)); do
  : > "$tmpfile"
  iter_log="logs/iter-$i.jsonl"
  iter_err="logs/iter-$i.stderr"

  echo "=== Iteration $i / $iterations @ $(date -Iseconds) ===" >&2

  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
  issues=$(cat issues/*.md 2>/dev/null || echo "No issues found")
  prompt=$(cat ralph/prompt.md)

  echo "Prompt: $(printf '%s' "$prompt" | wc -c)B  Issues: $(printf '%s' "$issues" | wc -c)B  Commits: $(printf '%s\n' "$commits" | wc -l) lines" >&2

  # Pipeline:
  #   docker -> tee raw JSONL log -> keep only JSON lines -> tee for result extraction -> jq pretty-print
  # `set +e` + PIPESTATUS so we can see the docker exit code even when later
  # stages of the pipeline (grep/jq) fail to find anything.
  set +e
  docker sandbox run claude . -- \
      --verbose \
      --print \
      --output-format stream-json \
      2> >(tee "$iter_err" >&2) <<EOF \
    | tee "$iter_log" \
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
    echo "Iteration $i produced no JSON output. See $iter_log and $iter_err." >&2
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
