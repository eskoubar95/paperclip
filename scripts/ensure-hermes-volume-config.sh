#!/usr/bin/env bash
# Apply Hermes headless fixes on Railway's /paperclip volume (Hermes HOME).
# Run:  railway ssh --service paperclip < scripts/ensure-hermes-volume-config.sh
# Or:   railway ssh --service paperclip 'bash -s' < scripts/ensure-hermes-volume-config.sh
set -euo pipefail
mkdir -p /paperclip/.hermes
cat >/paperclip/.hermes/config.yaml <<'EOF'
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
EOF
chown -R 1000:1000 /paperclip/.hermes
echo "Wrote /paperclip/.hermes/config.yaml"
cat /paperclip/.hermes/config.yaml
