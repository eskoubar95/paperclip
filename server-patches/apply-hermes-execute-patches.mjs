#!/usr/bin/env node
/**
 * After pnpm install, patch hermes-paperclip-adapter dist/server/execute.js:
 * 1) Replace DEFAULT_PROMPT_TEMPLATE — Bearer on curls, jq (not long python -c) to avoid LLM mangling.
 * 2) Resolve adapter config from ctx.config first (merged env) — fixes wrapped env → [object Object] when only adapterConfig is used (hermes-paperclip-adapter#27).
 * 3) Unwrap Paperclip secret env shape { value } when merging into Hermes env.
 * 4) Map ctx.authToken → PAPERCLIP_API_KEY when the key is still unset (Paperclip JWT for API calls).
 * 5) delete env.PAPERCLIP_AGENT_JWT_SECRET before spawning Hermes.
 * 6) Extend parseHermesOutput: read paperclip_model line (from patched Hermes CLI) for actual model id;
 *    keep token/cost regexes compatible with quiet-mode footer printed by patch-hermes-cli-quiet-metrics.py.
 * 7) If Hermes --resume fails with "Session not found" (stale task session after rebuild), retry without
 *    --resume; on repeated failure return clearSession so Paperclip clears agentTaskSessions.
 *
 * Prompt body: hermes-default-prompt-inner.txt (same directory as this script, or /tmp in Docker).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || "/app";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPromptInner() {
  const innerPath = path.join(__dirname, "hermes-default-prompt-inner.txt");
  if (!fs.existsSync(innerPath)) {
    console.error("apply-hermes-execute-patches: missing", innerPath);
    process.exit(1);
  }
  let s = fs.readFileSync(innerPath, "utf8").replace(/\r\n/g, "\n").trimEnd();
  // execute.js uses `const DEFAULT_PROMPT_TEMPLATE = `...`;` — unescaped ` breaks the module.
  s = s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return s;
}

function findExecuteJs() {
  const direct = path.join(root, "node_modules/hermes-paperclip-adapter/dist/server/execute.js");
  if (fs.existsSync(direct)) return direct;
  try {
    const out = execFileSync(
      "find",
      [
        path.join(root, "node_modules"),
        "-path",
        "*/hermes-paperclip-adapter/dist/server/execute.js",
        "-type",
        "f",
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    return out[0] ?? null;
  } catch {
    return null;
  }
}

const PROMPT_START = "const DEFAULT_PROMPT_TEMPLATE = `";
const PROMPT_END = "`;\nfunction buildPrompt(ctx, config) {";
/** If missing, apply prompt patch (v3: jq for issue lists — avoids broken python -c from LLM). */
const PROMPT_V3_MARK = `jq -r '.[] | select(.status != "done"`;

/** Prefer merged ctx.config over raw adapterConfig (issue #27). */
const CONFIG_ADAPTER_ONLY = "const config = (ctx.agent?.adapterConfig ?? {});";
const CONFIG_WITH_CTX = "const config = (ctx.config ?? ctx.agent?.adapterConfig ?? {});";

/** Optional JWT API key from Paperclip runtime (before taskId / userEnv). */
const AUTH_TOKEN_SNIPPET = `    if (ctx.authToken && !env.PAPERCLIP_API_KEY)
        env.PAPERCLIP_API_KEY = ctx.authToken;
`;

const USERENV_ASSIGN_MARKER = `    if (userEnv && typeof userEnv === "object") {
        Object.assign(env, userEnv);
    }`;

const USERENV_UNWRAP_REPLACEMENT = `    if (userEnv && typeof userEnv === "object") {
        for (const [k, v] of Object.entries(userEnv)) {
            env[k] = v && typeof v === "object" && v !== null && "value" in v ? v.value : v;
        }
    }`;

const JWT_DELETE_LINE = "    delete env.PAPERCLIP_AGENT_JWT_SECRET;\n";

const RESOLVE_CWD_COMMENT = "    // ── Resolve working directory ──────────────────────────────────────────";

const executeJs = findExecuteJs();
if (!executeJs) {
  console.error("apply-hermes-execute-patches: could not find hermes-paperclip-adapter/dist/server/execute.js under", root);
  process.exit(1);
}

const PROMPT_INNER = loadPromptInner();
let text = fs.readFileSync(executeJs, "utf8");
let changed = false;

const p0 = text.indexOf(PROMPT_START);
const p1 = text.indexOf(PROMPT_END, p0);
if (p0 === -1 || p1 === -1) {
  console.error("apply-hermes-execute-patches: DEFAULT_PROMPT_TEMPLATE block not found — update patch");
  process.exit(1);
}
if (!text.includes(PROMPT_V3_MARK)) {
  text = text.slice(0, p0 + PROMPT_START.length) + PROMPT_INNER + text.slice(p1);
  changed = true;
  console.log("apply-hermes-execute-patches: replaced DEFAULT_PROMPT_TEMPLATE (v3 jq)");
} else {
  console.log("apply-hermes-execute-patches: prompt already v3 (jq lists)");
}

if (text.includes(CONFIG_ADAPTER_ONLY) && !text.includes(CONFIG_WITH_CTX)) {
  text = text.replace(CONFIG_ADAPTER_ONLY, CONFIG_WITH_CTX);
  changed = true;
  console.log("apply-hermes-execute-patches: use ctx.config ?? adapterConfig for Hermes config");
} else if (text.includes(CONFIG_WITH_CTX)) {
  console.log("apply-hermes-execute-patches: config merge already applied");
} else {
  console.error(
    "apply-hermes-execute-patches: expected adapter config line not found — update CONFIG_ADAPTER_ONLY / CONFIG_WITH_CTX",
  );
  process.exit(1);
}

if (!text.includes("ctx.authToken && !env.PAPERCLIP_API_KEY")) {
  const runIdNeedle = `    if (ctx.runId)
        env.PAPERCLIP_RUN_ID = ctx.runId;
`;
  if (!text.includes(runIdNeedle)) {
    console.error("apply-hermes-execute-patches: runId env block not found — cannot insert authToken mapping");
    process.exit(1);
  }
  text = text.replace(runIdNeedle, runIdNeedle + AUTH_TOKEN_SNIPPET);
  changed = true;
  console.log("apply-hermes-execute-patches: map ctx.authToken → PAPERCLIP_API_KEY when unset");
} else {
  console.log("apply-hermes-execute-patches: authToken mapping already present");
}

if (text.includes(USERENV_ASSIGN_MARKER)) {
  text = text.replace(USERENV_ASSIGN_MARKER, USERENV_UNWRAP_REPLACEMENT);
  changed = true;
  console.log("apply-hermes-execute-patches: unwrap Paperclip env values for Hermes");
} else if (text.includes('"value" in v')) {
  console.log("apply-hermes-execute-patches: userEnv unwrap already applied");
} else {
  console.error("apply-hermes-execute-patches: userEnv block not found — adapter execute.js changed; update patch");
  process.exit(1);
}

const PARSE_MODEL_BLOCK = `    if (costMatch?.[1]) {
        result.costUsd = parseFloat(costMatch[1]);
    }
    const PAPERCLIP_MODEL_REGEX = /^paperclip_model:\\s*(.+)$/m;
    const pcm = combined.match(PAPERCLIP_MODEL_REGEX);
    if (pcm?.[1]) {
        result.resolvedModel = pcm[1].trim();
    }
    // Check for error patterns in stderr`;

if (!text.includes("PAPERCLIP_MODEL_REGEX")) {
  if (!text.includes('if (costMatch?.[1]) {\n        result.costUsd = parseFloat(costMatch[1]);\n    }\n    // Check for error patterns in stderr')) {
    console.error("apply-hermes-execute-patches: costMatch block not found — cannot insert model parse");
    process.exit(1);
  }
  text = text.replace(
    `    if (costMatch?.[1]) {\n        result.costUsd = parseFloat(costMatch[1]);\n    }\n    // Check for error patterns in stderr`,
    PARSE_MODEL_BLOCK,
  );
  changed = true;
  console.log("apply-hermes-execute-patches: parse paperclip_model from Hermes output");
} else {
  console.log("apply-hermes-execute-patches: paperclip_model parse already applied");
}

const ER_MODEL_OLD = `        provider: provider || null,
        model: model || null,
    };`;
const ER_MODEL_NEW = `        provider: provider || null,
        model: parsed.resolvedModel || model || null,
    };`;
if (text.includes(ER_MODEL_OLD) && !text.includes("parsed.resolvedModel || model")) {
  text = text.replace(ER_MODEL_OLD, ER_MODEL_NEW);
  changed = true;
  console.log("apply-hermes-execute-patches: executionResult.model prefers Hermes-reported model");
} else if (text.includes("parsed.resolvedModel || model")) {
  console.log("apply-hermes-execute-patches: executionResult model merge already applied");
}

const RJ_OLD = `    executionResult.resultJson = {
        result: parsed.response || "",
        session_id: parsed.sessionId || null,
        usage: parsed.usage || null,
        cost_usd: parsed.costUsd ?? null,
    };`;
const RJ_NEW = `    executionResult.resultJson = {
        result: parsed.response || "",
        session_id: parsed.sessionId || null,
        usage: parsed.usage || null,
        cost_usd: parsed.costUsd ?? null,
        model: parsed.resolvedModel || model || null,
    };`;
if (text.includes(RJ_OLD)) {
  text = text.replace(RJ_OLD, RJ_NEW);
  changed = true;
  console.log("apply-hermes-execute-patches: resultJson includes model");
} else if (text.includes("cost_usd: parsed.costUsd ?? null,\n        model:")) {
  console.log("apply-hermes-execute-patches: resultJson model already applied");
}

const PROMPT_BUILD_LINE = "    const prompt = buildPrompt(ctx, config);";
const PROMPT_BUILD_REPLACEMENT = `    const prompt = (() => {
        const base = buildPrompt(ctx, config);
        const shared = ctx.context && typeof ctx.context.paperclipSharedKnowledge === "string"
            ? ctx.context.paperclipSharedKnowledge.trim()
            : "";
        if (!shared)
            return base;
        return \`\${base}\\n\\n## Paperclip shared knowledge (cross-adapter / prior runs)\\n\\n\${shared}\\n\`;
    })();`;

if (text.includes(PROMPT_BUILD_LINE) && !text.includes("ctx.context.paperclipSharedKnowledge")) {
  text = text.replace(PROMPT_BUILD_LINE, PROMPT_BUILD_REPLACEMENT);
  changed = true;
  console.log("apply-hermes-execute-patches: append Paperclip shared knowledge to Hermes prompt");
} else if (text.includes("ctx.context.paperclipSharedKnowledge")) {
  console.log("apply-hermes-execute-patches: shared knowledge prompt merge already applied");
} else {
  console.warn("apply-hermes-execute-patches: buildPrompt line not found — shared knowledge not merged");
}

/** Allow `custom` (local OpenAI-compatible / Ollama) even though it is not in npm VALID_PROVIDERS. */
const PROVIDER_CHECK_OLD = `    if (provider && VALID_PROVIDERS.includes(provider)) {
        args.push("--provider", provider);
    }`;
const PROVIDER_CHECK_NEW = `    if (provider && (VALID_PROVIDERS.includes(provider) || provider === "custom")) {
        args.push("--provider", provider);
    }`;
if (text.includes(PROVIDER_CHECK_OLD) && !text.includes('provider === "custom"')) {
  text = text.replace(PROVIDER_CHECK_OLD, PROVIDER_CHECK_NEW);
  changed = true;
  console.log("apply-hermes-execute-patches: allow hermes --provider custom (local Ollama)");
} else if (text.includes('provider === "custom"') && text.includes("VALID_PROVIDERS.includes(provider)")) {
  console.log("apply-hermes-execute-patches: custom provider patch already applied");
} else {
  console.warn("apply-hermes-execute-patches: provider check block not found — local Ollama may not get --provider custom");
}

/** Prior patch only set OPENAI_BASE_URL; Hermes needs OPENROUTER_BASE_URL for custom base URL resolution. */
const OLLAMA_ENV_OLD = `        if (openaiBase) {
            env.OPENAI_BASE_URL = openaiBase;
        }`;
const OLLAMA_ENV_NEW = `        if (openaiBase) {
            env.OPENAI_BASE_URL = openaiBase;
            // Hermes resolve_runtime_provider ignores OPENAI_BASE_URL for --provider custom; it uses
            // OPENROUTER_BASE_URL / config.yaml. Without this, base_url falls back to OpenRouter and the
            // CLI asks for OPENROUTER_API_KEY even for local Ollama.
            env.OPENROUTER_BASE_URL = openaiBase;
        }`;

const CWD_BLOCK_MARKER = `    // ── Resolve working directory ──────────────────────────────────────────
    const cwd = cfgString(config.cwd) || cfgString(ctx.config?.workspaceDir) || ".";`;
const CWD_BLOCK_WITH_OLLAMA = `    if (provider === "custom") {
        const openaiBase = cfgString(config.baseUrl) || cfgString(config.customBaseUrl);
        if (openaiBase) {
            env.OPENAI_BASE_URL = openaiBase;
            // Hermes resolve_runtime_provider ignores OPENAI_BASE_URL for --provider custom; it uses
            // OPENROUTER_BASE_URL / config.yaml. Without this, base_url falls back to OpenRouter and the
            // CLI asks for OPENROUTER_API_KEY even for local Ollama.
            env.OPENROUTER_BASE_URL = openaiBase;
        }
    }
    // ── Resolve working directory ──────────────────────────────────────────
    const cwd = cfgString(config.cwd) || cfgString(ctx.config?.workspaceDir) || ".";`;

if (text.includes(OLLAMA_ENV_OLD) && !text.includes("env.OPENROUTER_BASE_URL = openaiBase")) {
  text = text.replace(OLLAMA_ENV_OLD, OLLAMA_ENV_NEW);
  changed = true;
  console.log("apply-hermes-execute-patches: upgrade custom Ollama env: add OPENROUTER_BASE_URL");
}

if (text.includes(CWD_BLOCK_MARKER) && !text.includes("cfgString(config.baseUrl)")) {
  text = text.replace(CWD_BLOCK_MARKER, CWD_BLOCK_WITH_OLLAMA);
  changed = true;
  console.log("apply-hermes-execute-patches: OPENAI_BASE_URL + OPENROUTER_BASE_URL for provider custom (Ollama)");
} else if (text.includes("cfgString(config.baseUrl)")) {
  console.log("apply-hermes-execute-patches: Ollama base URL injection already present");
} else {
  console.warn("apply-hermes-execute-patches: cwd block marker not found — cannot inject Ollama base URL env");
}

if (!text.includes("delete env.PAPERCLIP_AGENT_JWT_SECRET")) {
  if (!text.includes(RESOLVE_CWD_COMMENT)) {
    console.error("apply-hermes-execute-patches: Resolve working directory marker not found — cannot insert JWT strip");
    process.exit(1);
  }
  text = text.replace(RESOLVE_CWD_COMMENT, JWT_DELETE_LINE + RESOLVE_CWD_COMMENT);
  changed = true;
  console.log("apply-hermes-execute-patches: strip PAPERCLIP_AGENT_JWT_SECRET from Hermes env");
} else {
  console.log("apply-hermes-execute-patches: JWT strip already applied");
}

// ── 7) Retry without --resume when local Hermes has no such session; clearSession on still-fail ─────────
const HERMES_SESSION_RETRY_MARK = "isHermesSessionNotFoundError";
if (!text.includes(HERMES_SESSION_RETRY_MARK)) {
  const PARSE_HERMES_END = `    return result;
}
// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------
export async function execute(ctx) {`;
  const PARSE_HERMES_END_WITH_DETECTOR = `    return result;
}
/** True when the Hermes child exited because --resume id is missing (new container / empty SessionDB). */
function isHermesSessionNotFoundError(stdout, stderr) {
    const combined = \`\${stdout || ""}\\n\${stderr || ""}\`;
    return /Session not found\\s*:/i.test(combined);
}
// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------
export async function execute(ctx) {`;
  if (!text.includes(PARSE_HERMES_END)) {
    console.error("apply-hermes-execute-patches: parseHermesOutput block end not found — cannot add session-retry");
    process.exit(1);
  }
  text = text.replace(PARSE_HERMES_END, PARSE_HERMES_END_WITH_DETECTOR);
  changed = true;
  console.log("apply-hermes-execute-patches: add isHermesSessionNotFoundError helper");
} else {
  console.log("apply-hermes-execute-patches: session not found helper already present");
}

if (!text.includes("makeHermesArgs")) {
  const SESSION_RESUME_OLD = `    args.push("--source", "tool");
    // Session resume
    const prevSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId);
    if (persistSession && prevSessionId) {
        args.push("--resume", prevSessionId);
    }
    if (extraArgs?.length) {
        args.push(...extraArgs);
    }`;
  const SESSION_RESUME_NEW = `    args.push("--source", "tool");
    const prevSessionId = cfgString(ctx.runtime?.sessionParams?.sessionId);
    const makeHermesArgs = (resumeId) => {
        const a = args.slice();
        if (persistSession && resumeId) {
            a.push("--resume", resumeId);
        }
        if (extraArgs?.length) {
            a.push(...extraArgs);
        }
        return a;
    };
    let hermesArgs = makeHermesArgs(prevSessionId);`;
  if (!text.includes(SESSION_RESUME_OLD)) {
    console.error("apply-hermes-execute-patches: expected session resume block not found — upstream execute.js changed");
    process.exit(1);
  }
  text = text.replace(SESSION_RESUME_OLD, SESSION_RESUME_NEW);
  changed = true;
  console.log("apply-hermes-execute-patches: makeHermesArgs for resume + extraArgs");
} else {
  console.log("apply-hermes-execute-patches: makeHermesArgs already present");
}

if (!text.includes("retriedAfterMissingSession")) {
  const RUN_CHILD_OLD = `    const result = await runChildProcess(ctx.runId, hermesCmd, args, {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onLog: wrappedOnLog,
    });
    // ── Parse output ───────────────────────────────────────────────────────
    const parsed = parseHermesOutput(result.stdout || "", result.stderr || "");`;
  const RUN_CHILD_NEW = `    let result = await runChildProcess(ctx.runId, hermesCmd, hermesArgs, {
        cwd,
        env,
        timeoutSec,
        graceSec,
        onLog: wrappedOnLog,
    });
    let retriedAfterMissingSession = false;
    if (prevSessionId &&
        !result.timedOut &&
        (result.exitCode ?? 0) !== 0 &&
        isHermesSessionNotFoundError(result.stdout || "", result.stderr || "")) {
        await ctx.onLog("stdout", \`[paperclip] Hermes resume session "\${prevSessionId}" is not in the local store; retrying without --resume.\\n\`);
        retriedAfterMissingSession = true;
        hermesArgs = makeHermesArgs(null);
        result = await runChildProcess(ctx.runId, hermesCmd, hermesArgs, {
            cwd,
            env,
            timeoutSec,
            graceSec,
            onLog: wrappedOnLog,
        });
    }
    // ── Parse output ───────────────────────────────────────────────────────
    const parsed = parseHermesOutput(result.stdout || "", result.stderr || "");`;
  if (!text.includes(RUN_CHILD_OLD)) {
    console.error("apply-hermes-execute-patches: runChildProcess block not found — upstream execute.js changed");
    process.exit(1);
  }
  text = text.replace(RUN_CHILD_OLD, RUN_CHILD_NEW);
  changed = true;
  console.log("apply-hermes-execute-patches: retry without --resume on session not found");
} else {
  console.log("apply-hermes-execute-patches: session retry block already present");
}

if (text.includes("retriedAfterMissingSession") && !text.includes("executionResult.clearSession")) {
  const RETURN_SESSION_OLD = `    if (persistSession && parsed.sessionId) {
        executionResult.sessionParams = { sessionId: parsed.sessionId };
        executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
    }
    return executionResult;
}`;
  const RETURN_SESSION_NEW = `    if (persistSession && parsed.sessionId) {
        executionResult.sessionParams = { sessionId: parsed.sessionId };
        executionResult.sessionDisplayId = parsed.sessionId.slice(0, 16);
    }
    if (retriedAfterMissingSession && (result.exitCode ?? 0) !== 0) {
        executionResult.clearSession = true;
    }
    return executionResult;
}`;
  if (!text.includes(RETURN_SESSION_OLD)) {
    console.warn("apply-hermes-execute-patches: executionResult return block not found — clearSession not added");
  } else {
    text = text.replace(RETURN_SESSION_OLD, RETURN_SESSION_NEW);
    changed = true;
    console.log("apply-hermes-execute-patches: clearSession when retry still failed");
  }
} else if (text.includes("executionResult.clearSession")) {
  console.log("apply-hermes-execute-patches: clearSession on stale session already present");
}

if (changed) {
  fs.writeFileSync(executeJs, text);
}
console.log("Done:", executeJs);
