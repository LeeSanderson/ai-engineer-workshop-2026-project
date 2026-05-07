#!/bin/bash

issues=$(cat issues/*.md 2>/dev/null || echo "No issues found")
commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
prompt=$(cat ralph/prompt.md)

claude --print --verbose --output-format stream-json --permission-mode acceptEdits <<EOF \
  | jq --unbuffered -rf ralph/format.jq
Previous commits: $commits

Issues: $issues

$prompt
EOF
