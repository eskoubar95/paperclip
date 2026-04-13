#!/usr/bin/env node
/**
 * After pnpm install, patch hermes-paperclip-adapter dist/server/execute.js:
 * 1) Replace DEFAULT_PROMPT_TEMPLATE — Bearer on curls, jq (not long python -c) to avoid LLM mangling.
 * 2) Resolve adapter config from ctx.config first (merged env) — fixes wrapped env → [object Object] when only adapterConfig is used (hermes-paperclip-adapter#27).
 * 3) Unwrap Paperclip secret env shape { value } when merging into Hermes env.
 * 4) Map ctx.authToken → PAPERCLIP_API_KEY when the key is still unset (Paperclip JWT for API calls).
 * 5) delete env.PAPERCLIP_AGENT_JWT_SECRET before spawning Hermes.
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

if (changed) {
  fs.writeFileSync(executeJs, text);
}
console.log("Done:", executeJs);
