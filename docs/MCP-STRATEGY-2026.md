# MCP Strategy 2026 – Research & Recommendation

## Problem Statement
After building company-scoped MCP integrations in Paperclip (vault + sync), we're uncertain if we've overcomplicated the solution for the **primary use cases**:
- Supabase (hosted project)
- PostgreSQL (self-hosted)
- Notion workspace
- Context7 documentation

## Research Findings (April 2026)

| Service | Official MCP | Auth Method | Token Format |
|---------|--------------|-------------|--------------|
| **Supabase (hosted)** | `https://mcp.supabase.com/mcp` | OAuth / dynamic client registration | Browser flow; no static key to paste |
| **PostgreSQL (self-hosted)** | `@modelcontextprotocol/server-postgres` | Static connection string | `postgresql://user:pass@host:5432/db` |
| **Notion (hosted)** | `https://mcp.notion.com/mcp` | OAuth (browser) | Browser flow |
| **Notion (internal integration)** | Local server with `NOTION_TOKEN` | Static internal integration token | API key you create in Notion settings |
| **Context7 (remote)** | `context7-remote` | OAuth (browser) | Browser flow |
| **Context7 (local)** | `context7` | Optional static API key | API key |

### Key Insight
**Hosted OAuth services** (Supabase, Notion remote, Context7 remote) **do not give you a token to paste**. Authentication happens **inside Cursor** when you first use a tool — Cursor opens your browser, you log in, and Cursor stores the session **locally** (not as a shareable credential).

**Self-hosted / API key services** (Postgres connection strings, Notion internal integrations, Context7 local with key) **do** provide static credentials you can share across a team.

## What We Built in Paperclip

- **Company vault**: secrets stored encrypted (`company_secrets`).
- **MCP integrations**: config + optional token reference.
- **Sync tokens**: `pcpmcp_…` for fetching `cursor-mcp.json` bundle.
- **Agent bindings**: per-agent MCP permissions (read/write/full).
- **Materialization**: `GET /api/companies/:id/mcp/cursor-mcp.json` outputs a bundle; local script writes `~/.cursor/mcp.json`.

### Strengths
- **Great for static credentials**: connection strings, API keys, PATs.
- **Company-wide policy**: admin controls which agents get which MCP access.
- **Secure sync**: one vault, many dev machines, no plaintext secrets in repo.

### Weaknesses for the Described Use Cases
1. **Supabase hosted** — OAuth; Paperclip can't capture the token without building a full OAuth redirect/callback flow in the board.
2. **Notion hosted** — OAuth; same problem.
3. **Context7 remote** — OAuth; same problem.

If users want **these** services, **Cursor's native MCP UI** (Settings > Tools & MCP > Add server) is **simpler**: paste the URL, Cursor handles OAuth, done.

## Recommended Strategy

### Option A: Hybrid (Recommended)
**Use Paperclip for static credentials; use Cursor native for OAuth services.**

| What | How |
|------|-----|
| **Self-hosted Postgres** | Paperclip `custom_stdio` with connection string in vault → company-wide sync |
| **Notion internal integration** | Paperclip `http_bearer` with `NOTION_TOKEN` → company-wide |
| **Supabase hosted** | **Cursor native**: each dev adds `https://mcp.supabase.com/mcp?project_ref=<ref>` in Settings; OAuth in browser |
| **Notion hosted** | **Cursor native**: add `https://mcp.notion.com/mcp`; OAuth in browser |
| **Context7 remote** | **Cursor native**: OAuth flow |
| **Context7 local (with key)** | Paperclip `custom_stdio` with `CONTEXT7_API_KEY` env → company-wide |

**Pros:**
- **Simple** for hosted OAuth (no browser-in-Paperclip complexity).
- **Powerful** for shared credentials (one admin setup, many devs).
- **No rework**: what we built is useful; we just clarify **when to use it**.

**Cons:**
- Devs configure OAuth services **twice** (once in Cursor UI; once in Paperclip if agent needs them) — **unless** agent runs locally where Cursor's `mcp.json` is already present. If agent is **on server** (Railway / Docker), it has no Cursor `mcp.json` → **no OAuth MCP access** unless we…

### Option B: Full OAuth in Paperclip (Complex)
Build redirect/callback in Paperclip board:
1. User clicks "Connect Supabase" in Paperclip Settings.
2. Redirect to `https://mcp.supabase.com/oauth/authorize`.
3. Callback to `https://<board>/api/companies/:id/mcp/oauth/callback?provider=supabase`.
4. Store **refresh token** in vault.
5. When syncing `cursor-mcp.json`, **refresh** access token and inject it.

**Pros:**
- True **company-wide** MCP for OAuth services.
- Works for **server-side agents** (Railway / Docker) that don't have a local Cursor `mcp.json`.

**Cons:**
- **Weeks of work**: OAuth discovery, PKCE, token refresh, per-provider adapters.
- **Maintenance**: each provider's OAuth differs (scopes, endpoints, refresh behavior).
- **Overkill** if the **primary agent workload is local dev** (where Cursor native already works).

### Option C: Document Limitations (Minimal)
Keep what we have; **document** that Paperclip MCP is for:
- Static API keys / connection strings.
- Self-hosted / internal integrations.

For **hosted OAuth** (Supabase, Notion, Context7 remote): use **Cursor native** and **do not** rely on Paperclip for those.

**Pros:**
- **No rework**.
- Clear **product boundaries**.

**Cons:**
- **Server-side agents** (cloud Paperclip deployments running agents in Docker) **cannot** use OAuth MCP services unless we add Option B later.

## Concrete Recommendation

**Go with Option A (Hybrid)** for now:

1. **Keep Paperclip MCP** as-is (it's good for static credentials).
2. **Update `doc/MCP-CONNECTORS.md`** with a **table** like the one above, showing:
   - **When to use Paperclip**: self-hosted Postgres, Notion internal token, Context7 with key.
   - **When to use Cursor native**: Supabase hosted, Notion hosted, Context7 remote (OAuth).
3. **Add UX copy** in `CompanyMcpSettings.tsx`:
   - Brief note at top: *"For hosted OAuth services (Supabase, Notion), configure them directly in Cursor Settings > MCP. Use Paperclip for static credentials you want to share company-wide."*

4. **If you later need OAuth** (e.g., for **server-based agent runs** in Railway Docker where no local Cursor exists):
   - Build **Option B** as a **separate feature**: "OAuth Connectors" (distinct from current "Custom MCP").
   - That keeps the **simple case** (static keys) clean.

## Next Steps (If Accepted)

1. Update **`doc/MCP-CONNECTORS.md`** with hybrid table.
2. Add **short UX note** to **`CompanyMcpSettings.tsx`** UI (3–4 lines).
3. **Test** the documented flow:
   - Postgres connection string in Paperclip → works.
   - Supabase in Cursor native → works.
   - Confirm that **local agent** in Cursor can use **both** (Paperclip-synced + Cursor-native).
4. **Optional** (if you want OAuth later): spike OAuth callback in a `feat/mcp-oauth` branch.

---

**Conclusion:** You were **right** to question complexity. For the **described tools**, a **hybrid** approach (Paperclip for keys, Cursor native for OAuth) is **simpler** and matches 2026 patterns. The work we did is **not wasted** — it's valuable for static credentials; we just need to **clarify scope** and **document when to use what**.
