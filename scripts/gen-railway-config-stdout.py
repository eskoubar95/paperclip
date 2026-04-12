#!/usr/bin/env python3
"""Emit Paperclip config JSON to stdout from Railway-linked service env (railway run)."""
import datetime
import json
import subprocess
import urllib.parse


def gv(k: str, default=None):
    try:
        return subprocess.check_output(
            ["railway", "run", "-s", "paperclip", "--", "printenv", k],
            text=True,
        ).strip()
    except subprocess.CalledProcessError:
        return default


def main() -> None:
    db_url = gv("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL missing")
    public_url = gv("PAPERCLIP_PUBLIC_URL") or gv("PAPERCLIP_AUTH_PUBLIC_BASE_URL")
    if not public_url:
        raise SystemExit("public URL missing")
    port = int(gv("PORT", "8080"))
    allowed_raw = gv("PAPERCLIP_ALLOWED_HOSTNAMES", "")
    host = urllib.parse.urlparse(public_url).hostname
    allowed = [h.strip().lower() for h in allowed_raw.split(",") if h.strip()]
    if host and host.lower() not in allowed:
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
    print(json.dumps(cfg, indent=2))


if __name__ == "__main__":
    main()
