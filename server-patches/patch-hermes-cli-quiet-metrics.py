#!/usr/bin/env python3
"""
After `pip install hermes-agent`, patch Hermes quiet single-query mode to print
lines that hermes-paperclip-adapter parseHermesOutput() can regex-match:
  tokens: N input / M output
  cost: $X.XXXXXX
  paperclip_model: <id>

Idempotent: skips if marker # paperclip_metrics is already present.
"""
from __future__ import annotations

import sys
from pathlib import Path


MARKER = "# paperclip_metrics:"

OLD = """                    print(f"\\nsession_id: {cli.session_id}")
                    
                    # Ensure proper exit code for automation wrappers
                    sys.exit(1 if isinstance(result, dict) and result.get("failed") else 0)"""

NEW = (
    """                    print(f"\\nsession_id: {cli.session_id}")
                    """
    + MARKER
    + """ token/cost/model for hermes-paperclip-adapter
                    if isinstance(result, dict):
                        _inp = int(result.get("input_tokens") or 0)
                        _out = int(result.get("output_tokens") or 0)
                        print(f"tokens: {_inp} input / {_out} output")
                        _cost = result.get("estimated_cost_usd")
                        if _cost is not None:
                            try:
                                print(f"cost: ${float(_cost):.6f}")
                            except (TypeError, ValueError):
                                pass
                        _model = result.get("model")
                        if _model:
                            print(f"paperclip_model: {_model}")
                    
                    # Ensure proper exit code for automation wrappers
                    sys.exit(1 if isinstance(result, dict) and result.get("failed") else 0)"""
)


def main() -> int:
    vpy = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/hermes-venv/bin/python")
    if not vpy.is_file():
        print("patch-hermes-cli-quiet-metrics: python not found:", vpy, file=sys.stderr)
        return 1

    import subprocess

    r = subprocess.run(
        [str(vpy), "-c", "import cli; import pathlib; print(pathlib.Path(cli.__file__).resolve())"],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        print("patch-hermes-cli-quiet-metrics: could not locate cli module:", r.stderr, file=sys.stderr)
        return 1
    cli_path = Path(r.stdout.strip())
    if not cli_path.is_file():
        print("patch-hermes-cli-quiet-metrics: not a file:", cli_path, file=sys.stderr)
        return 1

    text = cli_path.read_text(encoding="utf8")
    if MARKER in text:
        print("patch-hermes-cli-quiet-metrics: already applied:", cli_path)
        return 0
    if OLD not in text:
        print(
            "patch-hermes-cli-quiet-metrics: expected block not found — Hermes CLI changed; update OLD in",
            Path(__file__).resolve(),
            file=sys.stderr,
        )
        return 1
    cli_path.write_text(text.replace(OLD, NEW, 1), encoding="utf8")
    print("patch-hermes-cli-quiet-metrics: patched", cli_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
