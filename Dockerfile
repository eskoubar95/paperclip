# Paperclip + Hermes Agent for Railway (or any Docker host).
# Upstream Paperclip already registers `hermes_local`; the stock image omits the `hermes` CLI.
# See: https://github.com/paperclipai/paperclip — https://github.com/NousResearch/hermes-agent

FROM node:lts-trixie-slim AS base
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates gosu curl git wget ripgrep python3 python3-venv jq \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && wget -nv -O/etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && mkdir -p -m 755 /etc/apt/sources.list.d \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

# Hermes CLI — isolated venv (never pip install onto Debian system python; that caused uninstall-no-record-file on Railway).
# Minimal extras: terminal/file-style tools without heavy optional stacks. Pin tag for reproducible builds.
# Local quick check (saves waiting on full Paperclip build): docker build --target base -t pc-base .
ARG HERMES_GIT_REF=v2026.4.8
COPY server-patches/patch-hermes-cli-quiet-metrics.py /tmp/patch-hermes-cli-quiet-metrics.py
COPY server-patches/patch-hermes-cli-provider-custom-choices.py /tmp/patch-hermes-cli-provider-custom-choices.py
RUN python3 -m venv /opt/hermes-venv \
 && /opt/hermes-venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
 && /opt/hermes-venv/bin/pip install --no-cache-dir \
    "hermes-agent[cli,pty,mcp,cron] @ git+https://github.com/NousResearch/hermes-agent.git@${HERMES_GIT_REF}" \
 && /opt/hermes-venv/bin/python /tmp/patch-hermes-cli-quiet-metrics.py \
 && /opt/hermes-venv/bin/python /tmp/patch-hermes-cli-provider-custom-choices.py \
 && ln -sf /opt/hermes-venv/bin/hermes /usr/local/bin/hermes \
 && test -x /usr/local/bin/hermes

# Cursor Agent CLI — install *before* `usermod ... -d /paperclip` so the official installer
# (which uses passwd home) writes to /home/node, not /paperclip. The local Windows launcher
# mounts a named volume on /paperclip at runtime, which would hide ~/.local if home were already /paperclip.
# https://cursor.com/docs/cli/installation
RUN su -s /bin/bash node -c 'curl https://cursor.com/install -fsS | bash' \
 && test -x /home/node/.local/bin/agent \
 && ln -sf /home/node/.local/bin/agent /usr/local/bin/agent \
 && /usr/local/bin/agent --version

RUN usermod -u $USER_UID --non-unique node \
 && groupmod -g $USER_GID --non-unique node \
 && usermod -g $USER_GID -d /paperclip node

# Paperclip source: clone fork at a fixed ref. Railway (and some CI) do not ship git submodule contents in the
# Docker build context, so COPY paperclip would be empty — use git clone instead. Override via build args when bumping.
FROM base AS deps
ARG PAPERCLIP_GIT_URL=https://github.com/eskoubar95/paperclip-core.git
# Must be a ref that exists on PAPERCLIP_GIT_URL. After merging app changes, bump to match: `cd paperclip && git rev-parse HEAD`
# (uncommitted work in `paperclip/` is not in the image until it is on the remote and this ref is updated).
ARG PAPERCLIP_GIT_REF=b0c2350b4722bff2c3ba9eaa79d62884c9b81801
# Do not `rm -rf /app` while WORKDIR is /app — git fails with "Unable to read current working directory".
WORKDIR /tmp
RUN rm -rf /app /tmp/paperclip-src \
 && git clone "${PAPERCLIP_GIT_URL}" /tmp/paperclip-src \
 && cd /tmp/paperclip-src \
 && git checkout -q "${PAPERCLIP_GIT_REF}" \
 && mv /tmp/paperclip-src /app
WORKDIR /app
# Curated OpenRouter models in the Model dropdown + getConfigSchema (provider / max turns).
COPY server-patches/hermes-openrouter-models.ts /app/server/src/adapters/hermes-openrouter-models.ts
COPY server-patches/apply-hermes-registry-patch.mjs /tmp/apply-hermes-registry-patch.mjs
RUN node /tmp/apply-hermes-registry-patch.mjs
RUN pnpm install --frozen-lockfile
COPY server-patches/hermes-default-prompt-inner.txt /tmp/hermes-default-prompt-inner.txt
COPY server-patches/apply-hermes-execute-patches.mjs /tmp/apply-hermes-execute-patches.mjs
RUN node /tmp/apply-hermes-execute-patches.mjs
# Include references/, scripts/, assets/ when SKILL.md is at import root (dirname ".").
COPY server-patches/apply-company-skills-package-root-patch.mjs /tmp/apply-company-skills-package-root-patch.mjs
RUN node /tmp/apply-company-skills-package-root-patch.mjs

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/plugin-paperclip-slack build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
ARG USER_UID=1000
ARG USER_GID=1000
WORKDIR /app
COPY --chown=node:node --from=build /app /app
RUN mkdir -p /paperclip/.paperclip/plugins \
 && cp -a /app/packages/plugins/paperclip-slack /paperclip/.paperclip/plugins/paperclip-slack \
 && chown -R node:node /paperclip/.paperclip
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai \
 && mkdir -p /paperclip \
 && chown node:node /paperclip

COPY railway-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY paperclip-railway-init.sh /usr/local/bin/paperclip-railway-init
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/paperclip-railway-init

ENV NODE_ENV=production \
 HOME=/paperclip \
 HOST=0.0.0.0 \
 PORT=3100 \
 SERVE_UI=true \
 PAPERCLIP_HOME=/paperclip \
 PAPERCLIP_INSTANCE_ID=default \
 USER_UID=${USER_UID} \
 USER_GID=${USER_GID} \
 PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
 PAPERCLIP_DEPLOYMENT_MODE=authenticated \
 PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
 OPENCODE_ALLOW_ALL_MODELS=true \
 PATH=/paperclip/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
