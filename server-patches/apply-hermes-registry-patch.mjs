#!/usr/bin/env node
/**
 * Patches server/src/adapters/registry.ts after Paperclip source is available:
 * - Swap hermes-paperclip-adapter model/doc import for OpenRouter helpers from hermes-openrouter-models.js
 * - Wire hermes_local adapter models + getConfigSchema + extended agent docs
 *
 * Upstream registry layout changed (split imports); this script matches current paperclip `registry.ts`.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || "/app";
const registryPath = path.join(root, "server/src/adapters/registry.ts");
if (!fs.existsSync(registryPath)) {
  console.error("apply-hermes-registry-patch: missing", registryPath);
  process.exit(1);
}
let text = fs.readFileSync(registryPath, "utf8");

const importDocOld = `import {
  agentConfigurationDoc as hermesAgentConfigurationDoc,
  models as hermesModels,
} from "hermes-paperclip-adapter";`;

const importDocNew = `import { HERMES_OPENROUTER_MODELS, getHermesLocalConfigSchema, hermesAgentConfigurationDoc } from "./hermes-openrouter-models.js";`;

if (!text.includes(importDocOld)) {
  console.error(
    "apply-hermes-registry-patch: expected hermes doc/models import not found — update patch script for upstream registry.ts",
  );
  process.exit(1);
}
text = text.replace(importDocOld, importDocNew);

const adapterOld = `const hermesLocalAdapter: ServerAdapterModule = {
  type: "hermes_local",
  execute: hermesExecute,
  testEnvironment: hermesTestEnvironment,
  sessionCodec: hermesSessionCodec,
  listSkills: hermesListSkills,
  syncSkills: hermesSyncSkills,
  models: hermesModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: hermesAgentConfigurationDoc,
  detectModel: () => detectModelFromHermes(),
};`;

const adapterNew = `const hermesLocalAdapter: ServerAdapterModule = {
  type: "hermes_local",
  execute: hermesExecute,
  testEnvironment: hermesTestEnvironment,
  sessionCodec: hermesSessionCodec,
  listSkills: hermesListSkills,
  syncSkills: hermesSyncSkills,
  models: HERMES_OPENROUTER_MODELS,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: hermesAgentConfigurationDoc,
  detectModel: () => detectModelFromHermes(),
  getConfigSchema: getHermesLocalConfigSchema,
};`;

if (!text.includes(adapterOld)) {
  console.error("apply-hermes-registry-patch: expected hermesLocalAdapter block not found — update patch script");
  process.exit(1);
}
text = text.replace(adapterOld, adapterNew);

fs.writeFileSync(registryPath, text);
console.log("Patched", registryPath);
