#!/usr/bin/env python3
"""
After `pip install hermes-agent`, add `custom` to `hermes chat --provider` choices
so Ollama / OpenAI-compatible local endpoints work (use with OPENAI_BASE_URL, e.g. Ollama /v1).

The adapter (hermes-paperclip-apply) already passes --provider custom and sets OPENAI_BASE_URL;
this fixes: invalid choice: 'custom' from argparse.

Idempotent: skips if marker is already present in the line.
"""
from __future__ import annotations

import sys
from pathlib import Path

MARKER = "kilocode"  # we insert ", \"custom\"" before the closing paren of choices if missing

# Exact snippet from hermes_cli/main.py (Hermes v2026.4.8) — update if CLI changes.
OLD = (
    '        choices=["auto", "openrouter", "nous", "openai-codex", "copilot-acp", "copilot", '
    '"anthropic", "gemini", "huggingface", "zai", "kimi-coding", "minimax", "minimax-cn", "kilocode"],'
)

NEW = (
    '        choices=["auto", "openrouter", "nous", "openai-codex", "copilot-acp", "copilot", '
    '"anthropic", "gemini", "huggingface", "zai", "kimi-coding", "minimax", "minimax-cn", "kilocode", "custom"],'
)


def main() -> int:
    vpy = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/hermes-venv/bin/python")
    if not vpy.is_file():
        print("patch-hermes-cli-provider-custom-choices: python not found:", vpy, file=sys.stderr)
        return 1
    import subprocess

    r = subprocess.run(
        [str(vpy), "-c", "import hermes_cli.main as m; import pathlib; print(pathlib.Path(m.__file__).resolve())"],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        print("patch-hermes-cli-provider-custom-choices: could not locate hermes_cli.main:", r.stderr, file=sys.stderr)
        return 1
    main_path = Path(r.stdout.strip())
    if not main_path.is_file():
        print("patch-hermes-cli-provider-custom-choices: not a file:", main_path, file=sys.stderr)
        return 1

    text = main_path.read_text(encoding="utf8")
    if '"custom"' in text and "chat_parser.add_argument" in text and "choices=" in text:
        # Heuristic: already patched or upstream added custom
        idx = text.find(OLD)
        if idx == -1 and '"kilocode", "custom"' in text:
            print("patch-hermes-cli-provider-custom-choices: already applied (custom in choices):", main_path)
            return 0
    if NEW in text:
        print("patch-hermes-cli-provider-custom-choices: already applied:", main_path)
        return 0
    if OLD not in text:
        print(
            "patch-hermes-cli-provider-custom-choices: expected choices line not found — Hermes CLI changed; update OLD in",
            Path(__file__).resolve(),
            file=sys.stderr,
        )
        return 1
    main_path.write_text(text.replace(OLD, NEW, 1), encoding="utf8")
    print("patch-hermes-cli-provider-custom-choices: added provider choice custom in", main_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
