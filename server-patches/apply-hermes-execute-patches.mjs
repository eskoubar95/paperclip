#!/usr/bin/env node
/**
 * After pnpm install, patch hermes-paperclip-adapter dist/server/execute.js:
 * 1) Replace DEFAULT_PROMPT_TEMPLATE — Bearer on curls, jq (not long python -c) to avoid LLM mangling.
 * 2) delete env.PAPERCLIP_AGENT_JWT_SECRET before spawning Hermes.
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
  return fs.readFileSync(innerPath, "utf8").replace(/\r\n/g, "\n").trimEnd();
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

const JWT_MARKER = `    if (userEnv && typeof userEnv === "object") {
        Object.assign(env, userEnv);
    }
    // ── Resolve working directory ──────────────────────────────────────────`;

const JWT_REPLACEMENT = `    if (userEnv && typeof userEnv === "object") {
        Object.assign(env, userEnv);
    }
    delete env.PAPERCLIP_AGENT_JWT_SECRET;
    // ── Resolve working directory ──────────────────────────────────────────`;

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

if (!text.includes("delete env.PAPERCLIP_AGENT_JWT_SECRET")) {
  if (!text.includes(JWT_MARKER)) {
    console.error("apply-hermes-execute-patches: JWT env block not found — adapter execute.js changed; update patch");
    process.exit(1);
  }
  text = text.replace(JWT_MARKER, JWT_REPLACEMENT);
  changed = true;
  console.log("apply-hermes-execute-patches: strip PAPERCLIP_AGENT_JWT_SECRET from Hermes env");
} else {
  console.log("apply-hermes-execute-patches: JWT strip already applied");
}

if (changed) {
  fs.writeFileSync(executeJs, text);
}
console.log("Done:", executeJs);
