/**
 * Hermes (hermes_local) — curated OpenRouter models + declarative config schema.
 * Injected at Docker build; see apply-hermes-registry-patch.mjs.
 */

import type { AdapterConfigSchema, AdapterModel } from "@paperclipai/adapter-utils";
import { agentConfigurationDoc as hermesAgentConfigurationDocBase } from "hermes-paperclip-adapter";

/**
 * Appended to upstream Hermes adapter docs so the model stops minting JWTs with
 * PAPERCLIP_AGENT_JWT_SECRET (wrong + unsafe) and uses the agent API key instead.
 */
const HERMES_PAPERCLIP_HTTP_API_MD = `

## Paperclip HTTP API (curl from Hermes terminal)

When you call this Paperclip instance over HTTP (\`/api/...\`):

- **Authentication:** use only \`Authorization: Bearer $PAPERCLIP_API_KEY\`. The key is the agent API key (\`pcp_…\`) — set in Paperclip and passed into the Hermes shell via \`terminal.env_passthrough\` in \`~/.hermes/config.yaml\`.
- **Do not** create JWTs, use HMAC, read \`PAPERCLIP_AGENT_JWT_SECRET\`, or run Node/\`crypto\` to sign tokens. That secret is for the server, not for agent shell scripts.
- **Base URL:** \`$PAPERCLIP_API_URL\` (no trailing slash before paths; build URLs as \`"$PAPERCLIP_API_URL/api/..."\`).
- **IDs:** \`$PAPERCLIP_AGENT_ID\`, \`$PAPERCLIP_COMPANY_ID\`, and \`$PAPERCLIP_RUN_ID\` are available in the same environment when configured.
- **Mutations (PATCH/POST on \`/api/issues/...\`):** agents using an API key must also send \`-H "x-paperclip-run-id: $PAPERCLIP_RUN_ID"\` on every such request (GET list/read needs only Bearer). Issue comments expect JSON field \`body\` (not \`content\`).

Example (issues assigned to this agent):

\`\`\`bash
curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \\
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?assigneeAgentId=$PAPERCLIP_AGENT_ID"
\`\`\`

If piping is blocked by policy, write the body to a file (\`curl ... -o /tmp/pc.json\`) and parse with \`jq\` (in this image) or \`python3 -m json.tool /tmp/pc.json\`. Long \`python3 -c\` one-liners are easy for models to corrupt — prefer \`jq\` for arrays.

If you use a custom \`promptTemplate\`, keep the same rules: **Bearer + \`$PAPERCLIP_API_KEY\`** on all \`/api/\` requests, plus **\`x-paperclip-run-id: $PAPERCLIP_RUN_ID\`** on agent issue mutations.

## Local Ollama (provider \`custom\`)

- Set **Provider** to **Local Ollama (OpenAI-compatible)** and **Model** to \`qwen3:8b\` (or another tag pulled in Ollama).
- Set **Ollama base URL (OpenAI-compatible)** to the API root, e.g. \`http://host.docker.internal:11434/v1\` when Paperclip runs in **Docker** on Windows and **Ollama** runs on the host. Use \`http://127.0.0.1:11434/v1\` for native/local Hermes on the same machine as Ollama.
- **Toolsets:** for small local models, prefer a narrow set (e.g. \`web,file,terminal\`) before \`hermes-cli\` or \`all\` — vision/browser-heavy toolsets need cloud keys or stronger models.
- Ensure the model is pulled: \`ollama pull qwen3:8b\`.

## Hermes toolsets (\`-t\` / \`toolsets\` in adapter config)

Pass a **comma-separated** list of Hermes toolset names (see \`hermes chat --help\` and \`toolsets.py\` in Hermes). Special value **\`all\`** enables every registered toolset. **\`hermes-cli\`** is the bundled “full interactive CLI” set (terminal, file, web, browser, vision, skills, code execution, cronjob, etc.). MCP tools need \`mcp\` extra + \`mcp_servers\` in \`~/.hermes/config.yaml\`; names like \`mcp\`/\`creative\`/\`productivity\` in some docs are categories or plugins — use valid toolset names from Hermes or \`all\`.
`;

/** Full markdown shown in the Paperclip UI for Hermes agents (upstream + Railway auth). */
export const hermesAgentConfigurationDoc = hermesAgentConfigurationDocBase + HERMES_PAPERCLIP_HTTP_API_MD;

/** OpenRouter model ids + short labels for the Paperclip Model dropdown. */
export const HERMES_OPENROUTER_MODELS: AdapterModel[] = [
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)" },
  { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder (free)" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super (free)" },
  { id: "sourceful/riverflow-v2-pro", label: "Riverflow v2 Pro" },
  { id: "z-ai/glm-5.1", label: "GLM 5.1" },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { id: "perplexity/sonar-deep-research", label: "Sonar Deep Research" },
  { id: "perplexity/sonar", label: "Sonar" },
  { id: "perplexity/sonar-pro-search", label: "Sonar Pro Search" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
  { id: "qwen3:8b", label: "Local Ollama: qwen3:8b" },
];

/**
 * Extra adapter fields (provider, toolsets, max turns). Model stays on the main
 * Paperclip Model dropdown — we intentionally omit `model` here to avoid duplicate fields.
 */
export function getHermesLocalConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        hint: "OpenRouter: set OPENROUTER_API_KEY. Local Ollama: set Provider to Local Ollama, Base URL, and model qwen3:8b.",
        default: "openrouter",
        options: [
          { label: "Auto (Hermes decides)", value: "auto" },
          { label: "OpenRouter", value: "openrouter" },
          { label: "Local Ollama (OpenAI-compatible)", value: "custom" },
          { label: "Anthropic", value: "anthropic" },
          { label: "Nous", value: "nous" },
          { label: "OpenAI Codex", value: "openai-codex" },
          { label: "GitHub Copilot", value: "copilot" },
          { label: "Z.AI (GLM)", value: "zai" },
          { label: "Kimi (Moonshot)", value: "kimi-coding" },
          { label: "MiniMax", value: "minimax" },
          { label: "MiniMax (China)", value: "minimax-cn" },
          { label: "Hugging Face", value: "huggingface" },
          { label: "Kilo Code", value: "kilocode" },
        ],
      },
      {
        key: "baseUrl",
        label: "Ollama base URL (OpenAI-compatible API root)",
        type: "text",
        default: "http://host.docker.internal:11434/v1",
        hint: "When Paperclip runs in Docker on Windows, use host.docker.internal to reach Ollama on the host. Example: http://host.docker.internal:11434/v1. Native (no Docker): http://127.0.0.1:11434/v1. The adapter passes this to Hermes as OPENROUTER_BASE_URL (and OPENAI_BASE_URL); Hermes reads the former for custom OpenAI-compatible endpoints.",
      },
      {
        key: "contextLength",
        label: "Context length (Ollama / local, optional)",
        type: "number",
        default: 32768,
        hint: "Optional. Some stacks use this for Ollama context hints; may be ignored depending on Hermes version.",
      },
      {
        key: "toolsets",
        label: "Hermes toolsets",
        type: "text",
        default: "hermes-cli",
        hint:
          "Comma-separated toolsets passed to Hermes as -t (e.g. terminal,file,web,browser,code_execution,vision). Default hermes-cli = Hermes’ full standard CLI bundle. Use all to enable every registered toolset (widest surface). MCP servers need mcp in pip + mcp_servers in ~/.hermes/config.yaml.",
      },
      {
        key: "maxTurnsPerRun",
        label: "Max tool rounds per run",
        type: "number",
        default: 50,
        hint: "Maps to Hermes --max-turns (agent tool-calling iterations per heartbeat).",
      },
    ],
  };
}
