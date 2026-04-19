# Build Paperclip from this repository

## Layout

- **`paperclip/`** — full [Paperclip](https://github.com/paperclipai/paperclip) monorepo (use your **fork** as the remote so you can push core changes: avatar upload, Slack plugin, Hermes tweaks).
- **Docker** — [Dockerfile](../Dockerfile) expects `paperclip/` in the build context and copies it with `COPY paperclip /app` (no `git clone` inside the image).

## Git submodule (recommended)

From the repo root:

```bash
git submodule add https://github.com/YOUR_ORG/paperclip.git paperclip
git submodule update --init --recursive
```

Point the submodule at your fork URL. To sync upstream later (inside `paperclip/`):

```bash
cd paperclip
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream
git merge upstream/master   # or rebase
cd ..
git add paperclip
git commit -m "Bump paperclip submodule"
```

## Docker build

```bash
docker build -t paperclip-custom .
```

CI must run `git submodule update --init --recursive` before `docker build` so `paperclip/` is populated.

## Slack plugin

The Slack integration lives at [`paperclip/packages/plugins/paperclip-slack`](../paperclip/packages/plugins/paperclip-slack). The production image copies the built package to `$HOME/.paperclip/plugins/paperclip-slack` (`HOME=/paperclip`) so the host discovers it on startup.

**End-to-end checklist**

1. Build/run Paperclip with the plugin present (Docker copies it automatically; locally run `pnpm paperclipai plugin install ./packages/plugins/paperclip-slack` from `paperclip/` and restart the server).
2. Configure an agent avatar in the Paperclip UI (upload image) so the agent has a public `avatarUrl`.
3. In the Slack app: set **Event Subscriptions → Request URL** to  
   `https://<host>/api/plugins/paperclip-slack/webhooks/slack-events`, subscribe to `app_mention` and `message.im`, and install the app with the scopes listed in the [plugin README](../paperclip/packages/plugins/paperclip-slack/README.md).
4. In Paperclip plugin settings, set `publicApiBase`, `companyId`, `routerAgentId`, and secret refs for the Slack signing secret and bot token.
5. Mention the bot or DM it; the acknowledgement message should use **custom username** and **`icon_url`** aligned with the agent’s name and avatar (via `@paperclipai/shared` `resolveSlackAgentAvatarUrl`).

See the plugin README for troubleshooting (signature errors, scopes, duplicate events).
