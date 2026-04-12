#!/usr/bin/env node
/**
 * After pnpm install, patch hermes-paperclip-adapter dist/server/execute.js:
 * 1) Replace DEFAULT_PROMPT_TEMPLATE — add Bearer on all curls, avoid `curl | python3` (Tirith / policy).
 * 2) delete env.PAPERCLIP_AGENT_JWT_SECRET before spawning Hermes (agents use API key only).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || "/app";

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

/** Inner body of DEFAULT_PROMPT_TEMPLATE (between outer backticks in execute.js). */
const PROMPT_INNER = [
  'You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.',
  "",
  "IMPORTANT: Use \\`terminal\\` with \\`curl\\` for ALL Paperclip API calls. Every request MUST include \\`-H \"Authorization: Bearer $PAPERCLIP_API_KEY\"\\`. Never pipe curl into python; use \\`-o /tmp/pc-issues.json\\` (or similar) then run python on that file.",
  "",
  "Your Paperclip identity:",
  "  Agent ID: {{agentId}}",
  "  Company ID: {{companyId}}",
  "  API Base: {{paperclipApiUrl}}",
  "",
  "{{#taskId}}",
  "## Assigned Task",
  "",
  "Issue ID: {{taskId}}",
  "Title: {{taskTitle}}",
  "",
  "{{taskBody}}",
  "",
  "## Workflow",
  "",
  "1. Work on the task using your tools",
  "2. When done, mark the issue as completed:",
  '   \\`curl -sS -X PATCH -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "Content-Type: application/json" "{{paperclipApiUrl}}/issues/{{taskId}}" -d \'{"status":"done"}\'\\`',
  "3. Post a completion comment on the issue summarizing what you did:",
  '   \\`curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "Content-Type: application/json" "{{paperclipApiUrl}}/issues/{{taskId}}/comments" -d \'{"body":"DONE: <your summary here>"}\'\\`',
  "4. If this issue has a parent (check the issue body or comments for references like TRA-XX), post a brief notification on the parent issue so the parent owner knows:",
  '   \\`curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "Content-Type: application/json" "{{paperclipApiUrl}}/issues/PARENT_ISSUE_ID/comments" -d \'{"body":"{{agentName}} completed {{taskId}}. Summary: <brief>"}\'\\`',
  "{{/taskId}}",
  "",
  "{{#commentId}}",
  "## Comment on This Issue",
  "",
  "Someone commented. Read it:",
  '   \\`curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" -o /tmp/pc-comment.json "{{paperclipApiUrl}}/issues/{{taskId}}/comments/{{commentId}}" && python3 -m json.tool /tmp/pc-comment.json\\`',
  "",
  "Address the comment, POST a reply if needed, then continue working.",
  "{{/commentId}}",
  "",
  "{{#noTask}}",
  "## Heartbeat Wake — Check for Work",
  "",
  "1. List ALL open issues assigned to you (todo, backlog, in_progress):",
  '   \\`curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" -o /tmp/pc-issues.json "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}" && python3 -c \'import json; issues=json.load(open("/tmp/pc-issues.json")); [print("%s %12s %6s %s" % (i["identifier"], i["status"], str(i.get("priority","")), i["title"])) for i in issues if i["status"] not in ("done","cancelled")]\'\\`',
  "",
  "2. If issues found, pick the highest priority one that is not done/cancelled and work on it:",
  '   - Read the issue details: \\`curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" -o /tmp/pc-issue.json "{{paperclipApiUrl}}/issues/ISSUE_ID" && python3 -m json.tool /tmp/pc-issue.json\\`',
  "   - Do the work in the project directory: {{projectName}}",
  "   - When done, mark complete and post a comment (see Workflow steps 2-4 above)",
  "",
  "3. If no issues assigned to you, check for unassigned issues:",
  '   \\`curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" -o /tmp/pc-backlog.json "{{paperclipApiUrl}}/companies/{{companyId}}/issues?status=backlog" && python3 -c \'import json; issues=json.load(open("/tmp/pc-backlog.json")); [print("%s %s" % (i["identifier"], i["title"])) for i in issues if not i.get("assigneeAgentId")]\'\\`',
  "   If you find a relevant issue, assign it to yourself:",
  '   \\`curl -sS -X PATCH -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "Content-Type: application/json" "{{paperclipApiUrl}}/issues/ISSUE_ID" -d \'{"assigneeAgentId":"{{agentId}}","status":"todo"}\'\\`',
  "",
  "4. If truly nothing to do, report briefly what you checked.",
  "{{/noTask}}",
].join("\n");

const PROMPT_START = "const DEFAULT_PROMPT_TEMPLATE = `";
const PROMPT_END = "`;\nfunction buildPrompt(ctx, config) {";

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

let text = fs.readFileSync(executeJs, "utf8");
let changed = false;

const p0 = text.indexOf(PROMPT_START);
const p1 = text.indexOf(PROMPT_END, p0);
if (p0 === -1 || p1 === -1) {
  console.error("apply-hermes-execute-patches: DEFAULT_PROMPT_TEMPLATE block not found — update patch");
  process.exit(1);
}
if (!text.includes("pc-issues.json")) {
  text = text.slice(0, p0 + PROMPT_START.length) + PROMPT_INNER + text.slice(p1);
  changed = true;
  console.log("apply-hermes-execute-patches: replaced DEFAULT_PROMPT_TEMPLATE");
} else {
  console.log("apply-hermes-execute-patches: prompt already patched (pc-issues.json present)");
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
