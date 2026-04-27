# MCP OAuth Implementation Plan

## User Requirement (Final)
**Goal:** Admin i Paperclip UI (Settings) skal kunne:
1. **"Connect" til OAuth MCP-tjenester** (Supabase, Notion, Context7) via board — browser-flow i Paperclip.
2. **Se status** (green/red badge): forbindelse bekræftet / udløbet.
3. **Generere/opdatere** `cursor-mcp.json` bundle automatisk når tokens refreshes.
4. **Trigger sync** (script på server eller lokal sync) så **Cursor CLI** kan læse det opdaterede bundle.

**Kriterie:** Efter "Connect" i UI er agent **garanteret** at have gyldig MCP-adgang når den kører — uden at dev skal gennem browser hver gang.

---

## Architecture

### 1. DB Schema (extend `0062_company_mcp.sql`)

**Add to `company_mcp_integrations`:**
```sql
ALTER TABLE company_mcp_integrations
ADD COLUMN oauth_state TEXT, -- PKCE state for pending flows
ADD COLUMN oauth_provider VARCHAR(50), -- 'supabase', 'notion', 'context7'
ADD COLUMN refresh_token_secret_id UUID REFERENCES company_secrets(id),
ADD COLUMN access_token_cache TEXT, -- ephemeral; regenerated from refresh
ADD COLUMN token_expires_at TIMESTAMPTZ;
```

**Rationale:**
- `refresh_token_secret_id` → long-lived refresh token in vault (encrypted).
- `access_token_cache` → short-lived access token (plain text in DB; regenerated before each bundle build).
- `oauth_state` → CSRF protection during redirect.

### 2. OAuth Providers Config

**File:** `server/src/services/mcp-oauth-providers.ts`

```typescript
export interface OAuthProviderConfig {
  id: string; // 'supabase', 'notion', 'context7'
  displayName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string;
  usePKCE: boolean;
}

export const MCP_OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  supabase: {
    id: 'supabase',
    displayName: 'Supabase',
    authorizationEndpoint: 'https://mcp.supabase.com/oauth/authorize',
    tokenEndpoint: 'https://mcp.supabase.com/oauth/token',
    scopes: 'mcp:read mcp:execute',
    usePKCE: true,
  },
  notion: {
    id: 'notion',
    displayName: 'Notion',
    authorizationEndpoint: 'https://mcp.notion.com/oauth/authorize',
    tokenEndpoint: 'https://mcp.notion.com/oauth/token',
    scopes: 'mcp:pages:read mcp:pages:write',
    usePKCE: true,
  },
  context7: {
    id: 'context7',
    displayName: 'Context7',
    authorizationEndpoint: 'https://api.context7.com/oauth/authorize',
    tokenEndpoint: 'https://api.context7.com/oauth/token',
    scopes: 'mcp:docs:read',
    usePKCE: true,
  },
};
```

### 3. OAuth Flow (Backend)

**Routes:** `server/src/routes/company-mcp-oauth.ts`

#### Initiate OAuth (`POST /api/companies/:id/mcp/oauth/connect`)
```typescript
// Request body: { providerId: 'supabase', integrationId: '<uuid>' }
// 1. Generate PKCE code_verifier + code_challenge
// 2. Store state + verifier in session or DB (company_mcp_integrations.oauth_state as JSON)
// 3. Build authorization URL with redirect_uri = https://<board>/api/companies/:id/mcp/oauth/callback/:providerId
// 4. Return { authUrl: '...' } → frontend opens popup or new tab
```

#### OAuth Callback (`GET /api/companies/:id/mcp/oauth/callback/:providerId`)
```typescript
// Query params: ?code=...&state=...
// 1. Verify state matches stored oauth_state
// 2. Exchange code for tokens (POST to tokenEndpoint with code_verifier)
// 3. Store refresh_token in company_secrets (encrypted)
// 4. Store access_token_cache + expires_at in company_mcp_integrations
// 5. Update integration: enabled=true, lastVerifiedAt=now, oauth_state=null
// 6. Redirect to /company/settings?mcp_connected=supabase (success page)
```

#### Token Refresh (`POST /api/companies/:id/mcp/oauth/refresh/:integrationId`)
```typescript
// 1. Load refresh_token from vault
// 2. POST to provider's tokenEndpoint with grant_type=refresh_token
// 3. Update access_token_cache + expires_at
// 4. Return { ok: true, expiresAt }
```

### 4. Background Token Refresh (Cron / Heartbeat)

**File:** `server/src/services/mcp-token-refresher.ts`

```typescript
export function startMcpTokenRefresher(db: Db) {
  setInterval(async () => {
    const expiringSoon = await db
      .select()
      .from(companyMcpIntegrations)
      .where(
        and(
          isNotNull(companyMcpIntegrations.refreshTokenSecretId),
          or(
            isNull(companyMcpIntegrations.tokenExpiresAt),
            sql`${companyMcpIntegrations.tokenExpiresAt} < NOW() + INTERVAL '10 minutes'`
          )
        )
      );

    for (const integration of expiringSoon) {
      await mcpOAuthService.refreshAccessToken(integration.companyId, integration.id);
    }
  }, 5 * 60 * 1000); // every 5 minutes
}
```

**Hook into `server/src/index.ts` startup** (alongside heartbeat scheduler).

### 5. Bundle Generation (inject fresh tokens)

**Update:** `server/src/services/company-mcp.ts` → `buildCursorMcpJson()`

```typescript
async buildCursorMcpJson(companyId: string) {
  const integrations = await this.list(companyId);
  const mcpServers: Record<string, unknown> = {};

  for (const integration of integrations) {
    if (!integration.enabled) continue;

    let token = integration.tokenSecretId
      ? await getTokenValue(companyId, integration.tokenSecretId)
      : null;

    // If OAuth integration: use cached access_token (already refreshed by cron)
    if (integration.oauthProvider && integration.accessTokenCache) {
      token = integration.accessTokenCache;
    }

    const entry = buildMcpServerEntry(integration.providerKey, token, integration.config);
    mcpServers[integration.key] = entry;
  }

  return { mcpServers };
}
```

### 6. UI Changes (`ui/src/components/CompanyMcpSettings.tsx`)

#### Add "Connect" Button for OAuth Providers
```tsx
{OAUTH_PROVIDERS.includes(providerKey) && (
  <Button
    size="sm"
    onClick={() => initiateOAuth(providerKey)}
    disabled={connectMutation.isPending}
  >
    Connect with {PROVIDERS.find(p => p.id === providerKey)?.label}
  </Button>
)}
```

#### OAuth Initiate Mutation
```tsx
const connectMutation = useMutation({
  mutationFn: (providerId: string) =>
    companyMcpApi.initiateOAuth(companyId, providerId, integrationId),
  onSuccess: (data) => {
    // Open popup or new tab
    window.open(data.authUrl, 'oauth', 'width=600,height=700');
    // Poll for callback completion (or use WebSocket / SSE)
    pollConnectionStatus(integrationId);
  },
});
```

#### Status Badge (Green/Red)
```tsx
{integration.oauthProvider && (
  <span className={cn(
    "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded",
    integration.tokenExpiresAt && new Date(integration.tokenExpiresAt) > new Date()
      ? "bg-green-100 text-green-700"
      : "bg-red-100 text-red-700"
  )}>
    {integration.tokenExpiresAt && new Date(integration.tokenExpiresAt) > new Date()
      ? "Connected"
      : "Expired"}
  </span>
)}
```

#### "Refresh Now" Button
```tsx
<Button
  size="sm"
  variant="outline"
  onClick={() => refreshMutation.mutate(integration.id)}
>
  Refresh Token
</Button>
```

### 7. Sync Script Enhancement (`scripts/windows/Sync-PaperclipMcp.ps1`)

**No changes needed** — script already fetches `cursor-mcp.json`; backend now injects fresh OAuth tokens automatically.

Optional: add **webhook** or **SSE** so script can **watch** for bundle updates and auto-sync.

---

## Implementation Phases

### Phase 1: Supabase OAuth (Pilot)
1. Add DB columns (`oauth_provider`, `refresh_token_secret_id`, `access_token_cache`, `token_expires_at`).
2. Implement OAuth routes for **Supabase only**.
3. UI: "Connect Supabase" button → popup → callback → green badge.
4. Test: admin connects → sync script runs → Cursor CLI uses token.

**Deliverable:** Supabase OAuth working end-to-end.

### Phase 2: Token Refresh + Cron
1. Build `mcp-token-refresher.ts` (background cron).
2. Update `buildCursorMcpJson()` to inject `accessTokenCache`.
3. Test: token expires → cron refreshes → bundle updates → sync script pulls new bundle.

**Deliverable:** Tokens stay fresh without manual re-auth.

### Phase 3: Notion + Context7
1. Add provider configs for Notion, Context7.
2. UI: "Connect" buttons for each.
3. Test multi-provider setup.

**Deliverable:** All three OAuth providers supported.

### Phase 4: Polish
1. "Disconnect" button (revoke refresh token, clear cache).
2. Last verified timestamp + error messages.
3. Webhook/SSE for real-time sync updates (optional).

---

## Security Considerations

1. **PKCE (Proof Key for Code Exchange):** Required for public clients (Paperclip board = SPA).
2. **State parameter:** CSRF protection (random string tied to session).
3. **Refresh token storage:** Encrypted in `company_secrets` (same vault as other secrets).
4. **Access token cache:** Plain text in DB (acceptable; short-lived, regenerated frequently).
5. **Redirect URI validation:** Must match exactly what provider expects (`https://<board>/api/companies/:id/mcp/oauth/callback/:providerId`).

---

## Success Criteria

✅ Admin clicks "Connect Supabase" in Paperclip Settings → browser opens → logs in → green badge appears.  
✅ Sync script (`Sync-PaperclipMcp.ps1`) fetches updated `cursor-mcp.json` with valid access token.  
✅ Cursor CLI agent run uses Supabase MCP without browser prompt.  
✅ Token expires in 1 hour → cron refreshes → new bundle available within 5 minutes.  
✅ Multi-provider: Supabase + Notion + Context7 all connected, all green badges.

---

## Estimated Effort

- **Phase 1 (Supabase pilot):** 2–3 days (DB migration, OAuth routes, UI, testing).
- **Phase 2 (Token refresh cron):** 1–2 days.
- **Phase 3 (Notion + Context7):** 1 day (mostly config).
- **Phase 4 (Polish):** 1 day.

**Total:** ~5–7 days for full OAuth MCP in Paperclip.

---

## Next Steps (If Approved)

1. Create `feat/mcp-oauth` branch in `paperclip/`.
2. Write DB migration (`0063_mcp_oauth_columns.sql`).
3. Implement Supabase OAuth routes + UI (Phase 1).
4. Test end-to-end: Connect → Bundle → Sync → Cursor CLI.
5. Add token refresh cron (Phase 2).
6. Extend to Notion + Context7 (Phase 3).
7. Commit, push, bump `PAPERCLIP_GIT_REF`, rebuild Docker.
