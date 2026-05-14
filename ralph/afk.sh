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

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

for ((i=1; i<=iterations; i++)); do
  echo "=== Iteration $i / $iterations @ $(date -Iseconds) ===" >&2

  "$script_dir/once.sh" | tee "$tmpfile"

  if grep -q "<promise>NO MORE TASKS</promise>" "$tmpfile"; then
    echo "Ralph complete after $i iterations." >&2
    exit 0
  fi
done
