#!/usr/bin/env bash
# Run on Railway: railway ssh -s paperclip < railway-bootstrap-remote.sh
set -euo pipefail
export HOME=/paperclip
export PAPERCLIP_HOME=/paperclip

python3 <<'PY'
import json
import os
import pathlib
import datetime
import urllib.parse


def req(k: str) -> str:
    v = os.environ.get(k, "").strip()
    if not v:
        raise SystemExit(f"missing env {k}")
    return v


db_url = req("DATABASE_URL")
public_url = (
    os.environ.get("PAPERCLIP_PUBLIC_URL", "").strip()
    or os.environ.get("PAPERCLIP_AUTH_PUBLIC_BASE_URL", "").strip()
)
if not public_url:
    raise SystemExit("missing PAPERCLIP_PUBLIC_URL")

host = urllib.parse.urlparse(public_url).hostname
if not host:
    raise SystemExit("bad public url")

port = int(os.environ.get("PORT", "8080").strip())

allowed = [
    h.strip().lower()
    for h in os.environ.get("PAPERCLIP_ALLOWED_HOSTNAMES", "").split(",")
    if h.strip()
]
if host.lower() not in allowed:
    allowed = list(dict.fromkeys(allowed + [host.lower()]))

now = (
    datetime.datetime.now(datetime.timezone.utc)
    .replace(microsecond=0)
    .isoformat()
    .replace("+00:00", "Z")
)

cfg = {
    "$meta": {"version": 1, "updatedAt": now, "source": "configure"},
    "database": {
        "mode": "postgres",
        "connectionString": db_url,
        "embeddedPostgresDataDir": "/paperclip/instances/default/db",
        "embeddedPostgresPort": 54329,
        "backup": {
            "enabled": True,
            "intervalMinutes": 60,
            "retentionDays": 7,
            "dir": "/paperclip/instances/default/data/backups",
        },
    },
    "logging": {"mode": "file", "logDir": "/paperclip/instances/default/logs"},
    "server": {
        "deploymentMode": "authenticated",
        "exposure": "public",
        "bind": "lan",
        "host": "0.0.0.0",
        "port": port,
        "allowedHostnames": allowed,
        "serveUi": True,
    },
    "auth": {
        "baseUrlMode": "explicit",
        "publicBaseUrl": public_url.rstrip("/"),
        "disableSignUp": False,
    },
    "telemetry": {"enabled": True},
    "storage": {
        "provider": "local_disk",
        "localDisk": {"baseDir": "/paperclip/instances/default/data/storage"},
        "s3": {
            "bucket": "paperclip",
            "region": "us-east-1",
            "prefix": "",
            "forcePathStyle": False,
        },
    },
    "secrets": {
        "provider": "local_encrypted",
        "strictMode": False,
        "localEncrypted": {
            "keyFilePath": "/paperclip/instances/default/secrets/master.key",
        },
    },
}

cfg_path = pathlib.Path("/paperclip/instances/default/config.json")
cfg_path.parent.mkdir(parents=True, exist_ok=True)
secrets_dir = pathlib.Path("/paperclip/instances/default/secrets")
secrets_dir.mkdir(parents=True, exist_ok=True)
key_path = secrets_dir / "master.key"
if not key_path.exists():
    key_path.write_bytes(os.urandom(32))

with cfg_path.open("w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print("wrote", cfg_path)
PY

chown -R node:node /paperclip
cd /tmp
exec npx --yes paperclipai auth bootstrap-ceo --config /paperclip/instances/default/config.json
