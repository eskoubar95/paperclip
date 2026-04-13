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
RUN python3 -m venv /opt/hermes-venv \
 && /opt/hermes-venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
 && /opt/hermes-venv/bin/pip install --no-cache-dir \
    "hermes-agent[cli,pty,mcp,cron] @ git+https://github.com/NousResearch/hermes-agent.git@${HERMES_GIT_REF}" \
 && ln -sf /opt/hermes-venv/bin/hermes /usr/local/bin/hermes \
 && test -x /usr/local/bin/hermes

RUN usermod -u $USER_UID --non-unique node \
 && groupmod -g $USER_GID --non-unique node \
 && usermod -g $USER_GID -d /paperclip node

FROM base AS upstream
WORKDIR /src
ARG PAPERCLIP_REF=master
RUN git clone --depth 1 --branch "${PAPERCLIP_REF}" https://github.com/paperclipai/paperclip.git .

FROM base AS deps
WORKDIR /app
COPY --from=upstream /src /app
# Curated OpenRouter models in the Model dropdown + getConfigSchema (provider / max turns).
COPY server-patches/hermes-openrouter-models.ts /app/server/src/adapters/hermes-openrouter-models.ts
COPY server-patches/apply-hermes-registry-patch.mjs /tmp/apply-hermes-registry-patch.mjs
RUN node /tmp/apply-hermes-registry-patch.mjs
RUN pnpm install --frozen-lockfile
COPY server-patches/hermes-default-prompt-inner.txt /tmp/hermes-default-prompt-inner.txt
COPY server-patches/apply-hermes-execute-patches.mjs /tmp/apply-hermes-execute-patches.mjs
RUN node /tmp/apply-hermes-execute-patches.mjs

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
ARG USER_UID=1000
ARG USER_GID=1000
WORKDIR /app
COPY --chown=node:node --from=build /app /app
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
 PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
