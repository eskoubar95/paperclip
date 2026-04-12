#!/usr/bin/env node
/**
 * Patches server/src/adapters/registry.ts after cloning upstream Paperclip:
 * - Import HERMES_OPENROUTER_MODELS + getHermesLocalConfigSchema
 * - Wire hermes_local adapter models + getConfigSchema
 */
import fs from "node:fs";
import path from "node:path";

const root = "/app";
const registryPath = path.join(root, "server/src/adapters/registry.ts");
let text = fs.readFileSync(registryPath, "utf8");

const importOld = `import {
  agentConfigurationDoc as hermesAgentConfigurationDoc,
  models as hermesModels,
} from "hermes-paperclip-adapter";`;

const importNew = `import {
  agentConfigurationDoc as hermesAgentConfigurationDoc,
} from "hermes-paperclip-adapter";
import { HERMES_OPENROUTER_MODELS, getHermesLocalConfigSchema } from "./hermes-openrouter-models.js";`;

if (!text.includes(importOld)) {
  console.error("apply-hermes-registry-patch: expected hermes import block not found — update patch script for upstream registry.ts");
  process.exit(1);
}
text = text.replace(importOld, importNew);

const adapterOld = `const hermesLocalAdapter: ServerAdapterModule = {
  type: "hermes_local",
  execute: hermesExecute,
  testEnvironment: hermesTestEnvironment,
  sessionCodec: hermesSessionCodec,
  listSkills: hermesListSkills,
  syncSkills: hermesSyncSkills,
  models: hermesModels,
  supportsLocalAgentJwt: true,
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
