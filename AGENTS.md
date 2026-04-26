# AGENTS.md (repository root)

This repository is a **wrapper** around the [`paperclip/`](./paperclip) git submodule. It adds deployment assets (see root [`Dockerfile`](./Dockerfile)), [`server-patches/`](./server-patches), and Windows helpers under [`scripts/windows/`](./scripts/windows).

## Before you change anything

| Goal | Read first |
|------|------------|
| App features, API, UI, DB, tests | [`paperclip/AGENTS.md`](./paperclip/AGENTS.md), [`paperclip/doc/DEVELOPING.md`](./paperclip/doc/DEVELOPING.md) |
| Docker image, Railway, submodule SHA, “why does prod look old?” | [`docs/BUILD.md`](./docs/BUILD.md) |
| Local Docker on Windows + `DATABASE_URL` from your instance `.env` | [`scripts/windows/start-paperclip.ps1`](./scripts/windows/start-paperclip.ps1) (bind-mounts `%USERPROFILE%\.paperclip\instances\default`) |

## Golden rules

1. **Implementation work** happens in **`paperclip/`** (commit and push the fork). The root Dockerfile **clones by SHA**; bump **`PAPERCLIP_GIT_REF`** after meaningful app changes, or use [`scripts/sync-paperclip-docker-ref.ps1`](./scripts/sync-paperclip-docker-ref.ps1).
2. **Do not** commit secrets. Use instance `.env` or host env vars.
3. **Shell scripts** consumed in Linux images: keep **LF** line endings (see root `.gitattributes`).
4. **Local behaviour vs production image:** the stock Docker `ENV` uses **`authenticated`** mode. [`scripts/windows/start-paperclip.ps1`](./scripts/windows/start-paperclip.ps1) overrides with **`PAPERCLIP_DEPLOYMENT_MODE=local_trusted`** so `/api/companies` works like `pnpm dev` without signing in. `pnpm dev` alone uses `local_trusted` by default unless `PAPERCLIP_DEPLOYMENT_MODE` or `config.json` says otherwise — if the UI shows no companies, check that first.
