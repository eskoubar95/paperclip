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

exec gosu node "$@"
