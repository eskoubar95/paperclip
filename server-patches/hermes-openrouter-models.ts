/**
 * Hermes (hermes_local) — curated OpenRouter models + declarative config schema.
 * Injected at Docker build; see apply-hermes-registry-patch.mjs.
 */

import type { AdapterConfigSchema, AdapterModel } from "@paperclipai/adapter-utils";

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
];

/**
 * Extra adapter fields (provider, max turns). Model stays on the main Paperclip
 * Model dropdown — we intentionally omit `model` here to avoid duplicate fields.
 */
export function getHermesLocalConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        hint: "Use OpenRouter with OPENROUTER_API_KEY (Railway env or ~/.hermes/.env).",
        default: "openrouter",
        options: [
          { label: "Auto (Hermes decides)", value: "auto" },
          { label: "OpenRouter", value: "openrouter" },
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
        key: "maxTurnsPerRun",
        label: "Max tool rounds per run",
        type: "number",
        default: 50,
        hint: "Maps to Hermes --max-turns (agent tool-calling iterations per heartbeat).",
      },
    ],
  };
}
