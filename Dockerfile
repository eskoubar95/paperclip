# Paperclip + Hermes Agent for Railway (or any Docker host).
# Upstream Paperclip already registers `hermes_local`; the stock image omits the `hermes` CLI.
# See: https://github.com/paperclipai/paperclip — https://github.com/NousResearch/hermes-agent

FROM node:lts-trixie-slim AS base
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates gosu curl git wget ripgrep python3 python3-pip \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && wget -nv -O/etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
 && echo "20e0125d6f6e077a9ad46f03371bc26d90b04939fb95170f5a1905099cc6bcc0 /etc/apt/keyrings/githubcli-archive-keyring.gpg" | sha256sum -c - \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && mkdir -p -m 755 /etc/apt/sources.list.d \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

# Hermes CLI (spawned by Paperclip's hermes_local adapter)
RUN python3 -m pip install --break-system-packages --upgrade pip setuptools wheel \
 && python3 -m pip install --break-system-packages \
    "hermes-agent[cli,pty,mcp,cron,honcho] @ git+https://github.com/NousResearch/hermes-agent.git"

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
RUN pnpm install --frozen-lockfile

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

COPY --from=upstream /src/scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

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

VOLUME ["/paperclip"]
EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
