#!/bin/sh
# Railway persistent volumes are often mounted root-owned. Upstream Paperclip
# entrypoint only chowns when UID/GID remap runs, so first boot hits EACCES on mkdir.
set -e

PUID=${USER_UID:-1000}
PGID=${USER_GID:-1000}

if [ "$(id -u node)" -ne "$PUID" ]; then
  echo "Updating node UID to $PUID"
  usermod -o -u "$PUID" node
fi

if [ "$(id -g node)" -ne "$PGID" ]; then
  echo "Updating node GID to $PGID"
  groupmod -o -g "$PGID" node
  usermod -g "$PGID" node
fi

if [ "$(id -u)" = "0" ]; then
  mkdir -p /paperclip
  chown -R node:node /paperclip
fi

# Hermes (HOME=/paperclip): Paperclip spawner `hermes` uden TTY. Uden denne fil kan
# (a) approvals/Tirith afvise `curl | python3` fra default-prompten, og
# (b) terminal-værktøjet strippe PAPERCLIP_* så curl mod API får 401.
# Passthrough lister bevidst IKKE PAPERCLIP_AGENT_JWT_SECRET — agenter skal bruge
# PAPERCLIP_API_KEY (Bearer), ikke minte JWT med server-secret.
# Opret kun hvis der ikke allerede er en config — så `hermes model` m.m. ikke overskrives.
if [ ! -f /paperclip/.hermes/config.yaml ]; then
  mkdir -p /paperclip/.hermes
  # shellcheck disable=SC2016
  cat <<'HERMESYAML' >/paperclip/.hermes/config.yaml
approvals:
  mode: off
terminal:
  env_passthrough:
    - PAPERCLIP_API_KEY
    - PAPERCLIP_API_URL
    - PAPERCLIP_AGENT_ID
    - PAPERCLIP_COMPANY_ID
    - PAPERCLIP_RUN_ID
    - OPENROUTER_API_KEY
    - GH_TOKEN
    - GITHUB_TOKEN
HERMESYAML
  if [ "$(id -u)" = "0" ]; then
    chown node:node /paperclip/.hermes/config.yaml
  fi
fi

# Private GitHub over HTTPS: git clone in Paperclip (managed workspace) and agent terminals
# need a credential. Set GH_TOKEN or GITHUB_TOKEN in Railway to a fine-grained PAT (repo read/write
# for the target repos). Do not put the token in the workspace repoUrl in the UI.
if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
  _GH_FOR_GIT="${GH_TOKEN:-$GITHUB_TOKEN}"
  HOME=/paperclip gosu node git config --global \
    "url.https://x-access-token:${_GH_FOR_GIT}@github.com/.insteadOf" \
    "https://github.com/" \
    || true
fi

exec gosu node "$@"
