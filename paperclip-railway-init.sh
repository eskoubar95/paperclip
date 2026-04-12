#!/usr/bin/env bash
# Run inside the Railway container (railway ssh) when UI asks for bootstrap but
# config.json is missing. Installed as /usr/local/bin/paperclip-railway-init
set -euo pipefail

export HOME="${HOME:-/paperclip}"
export PAPERCLIP_HOME="${PAPERCLIP_HOME:-/paperclip}"

# SSH shells often do not inherit the app's env; copy from PID 1 (the running server).
if [[ -r /proc/1/environ ]]; then
  while IFS= read -r -d '' line; do
    [[ -n "${line}" ]] || continue
    export "$line"
  done < /proc/1/environ
fi

exec npx --yes paperclipai onboard --yes --bind lan
