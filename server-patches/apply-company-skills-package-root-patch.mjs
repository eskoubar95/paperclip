#!/usr/bin/env node
/**
 * Paperclip bug: GitHub skill import uses path.posix.dirname("SKILL.md") === "."
 * so inventory filter uses entry.startsWith("./") and never includes references/,
 * scripts/, assets/. Also entry.slice(1) mangles paths when "package dir" is ".".
 *
 * Fixes readUrlSkillImports + readInlineSkillImports (catalog/zip skills at repo root).
 * Upstream: consider PR to paperclipai/paperclip — search skillPackageDirFromRelativeSkillPath.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || "/app";
const target = path.join(root, "server/src/services/company-skills.ts");
let text = fs.readFileSync(target, "utf8");

const MARKER = "skillPackageDirFromRelativeSkillPath";

if (text.includes(MARKER)) {
  console.log("apply-company-skills-package-root-patch: already applied");
  process.exit(0);
}

const INSERT_AFTER = `const PROJECT_ROOT_SKILL_SUBDIRECTORIES = [
  "references",
  "scripts",
  "assets",
] as const;

`;

const HELPERS = `${INSERT_AFTER}
function skillPackageDirFromRelativeSkillPath(relativeSkillPath: string): string {
  const dir = path.posix.dirname(relativeSkillPath);
  return dir === "." ? "" : dir;
}

function isFileInSkillPackage(entry: string, relativeSkillPath: string, packageDir: string): boolean {
  if (entry === relativeSkillPath) return true;
  if (packageDir) return entry.startsWith(\`\${packageDir}/\`);
  for (const sub of PROJECT_ROOT_SKILL_SUBDIRECTORIES) {
    if (entry === sub || entry.startsWith(\`\${sub}/\`)) return true;
  }
  return false;
}

function relativePathInSkillPackage(entry: string, relativeSkillPath: string, packageDir: string): string {
  if (entry === relativeSkillPath) return "SKILL.md";
  if (!packageDir) return entry;
  return entry.slice(packageDir.length + 1);
}

`;

if (!text.includes(INSERT_AFTER)) {
  console.error("apply-company-skills-package-root-patch: anchor not found — upstream company-skills.ts changed");
  process.exit(1);
}
text = text.replace(INSERT_AFTER, HELPERS);

const OLD_LOOP = `      const skillDir = path.posix.dirname(relativeSkillPath);
      const slug = deriveImportedSkillSlug(parsedMarkdown.frontmatter, path.posix.basename(skillDir));
      const skillKey = readCanonicalSkillKey(
        parsedMarkdown.frontmatter,
        isPlainRecord(parsedMarkdown.frontmatter.metadata) ? parsedMarkdown.frontmatter.metadata : null,
      );
      if (requestedSkillSlug && !matchesRequestedSkill(relativeSkillPath, requestedSkillSlug) && slug !== requestedSkillSlug) {
        continue;
      }
      const metadata = {
        ...(skillKey ? { skillKey } : {}),
        sourceKind: "github",
        ...(parsed.hostname !== "github.com" ? { hostname: parsed.hostname } : {}),
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        trackingRef,
        repoSkillDir: normalizeGitHubSkillDirectory(
          basePrefix ? \`\${basePrefix}\${skillDir}\` : skillDir,
          slug,
        ),
      };
      const inventory = filteredPaths
        .filter((entry) => entry === relativeSkillPath || entry.startsWith(\`\${skillDir}/\`))
        .map((entry) => ({
          path: entry === relativeSkillPath ? "SKILL.md" : entry.slice(skillDir.length + 1),
          kind: classifyInventoryKind(entry === relativeSkillPath ? "SKILL.md" : entry.slice(skillDir.length + 1)),
        }))
        .sort((left, right) => left.path.localeCompare(right.path));`;

const NEW_LOOP = `      const packageDir = skillPackageDirFromRelativeSkillPath(relativeSkillPath);
      const slug = deriveImportedSkillSlug(
        parsedMarkdown.frontmatter,
        packageDir
          ? path.posix.basename(packageDir)
          : path.posix.basename(normalizePortablePath(parsed.basePath || ".")),
      );
      const skillKey = readCanonicalSkillKey(
        parsedMarkdown.frontmatter,
        isPlainRecord(parsedMarkdown.frontmatter.metadata) ? parsedMarkdown.frontmatter.metadata : null,
      );
      if (requestedSkillSlug && !matchesRequestedSkill(relativeSkillPath, requestedSkillSlug) && slug !== requestedSkillSlug) {
        continue;
      }
      const metadata = {
        ...(skillKey ? { skillKey } : {}),
        sourceKind: "github",
        ...(parsed.hostname !== "github.com" ? { hostname: parsed.hostname } : {}),
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        trackingRef,
        repoSkillDir: normalizeGitHubSkillDirectory(
          packageDir
            ? (basePrefix ? \`\${basePrefix}\${packageDir}\` : packageDir)
            : (basePrefix ? normalizePortablePath(basePrefix.replace(/\\/+$/,"")) : "."),
          slug,
        ),
      };
      const inventory = filteredPaths
        .filter((entry) => isFileInSkillPackage(entry, relativeSkillPath, packageDir))
        .map((entry) => {
          const rel = relativePathInSkillPackage(entry, relativeSkillPath, packageDir);
          return {
            path: normalizePortablePath(rel),
            kind: classifyInventoryKind(rel),
          };
        })
        .sort((left, right) => left.path.localeCompare(right.path));`;

if (!text.includes(OLD_LOOP)) {
  console.error("apply-company-skills-package-root-patch: readUrlSkillImports block not found — update patch");
  process.exit(1);
}
text = text.replace(OLD_LOOP, NEW_LOOP);

const OLD_INLINE = `    const inventory = Object.keys(normalizedFiles)
      .filter((entry) => entry === skillPath || (skillDir ? entry.startsWith(\`\${skillDir}/\`) : false))
      .map((entry) => {
        const relative = entry === skillPath ? "SKILL.md" : entry.slice(skillDir.length + 1);
        return {
          path: normalizePortablePath(relative),
          kind: classifyInventoryKind(relative),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));`;

const NEW_INLINE = `    const inventory = Object.keys(normalizedFiles)
      .filter((entry) => {
        if (entry === skillPath) return true;
        if (skillDir) return entry.startsWith(\`\${skillDir}/\`);
        for (const sub of PROJECT_ROOT_SKILL_SUBDIRECTORIES) {
          if (entry === sub || entry.startsWith(\`\${sub}/\`)) return true;
        }
        return false;
      })
      .map((entry) => {
        const relative = entry === skillPath ? "SKILL.md" : (skillDir ? entry.slice(skillDir.length + 1) : entry);
        return {
          path: normalizePortablePath(relative),
          kind: classifyInventoryKind(relative),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));`;

if (!text.includes(OLD_INLINE)) {
  console.error("apply-company-skills-package-root-patch: readInlineSkillImports block not found — update patch");
  process.exit(1);
}
text = text.replace(OLD_INLINE, NEW_INLINE);

fs.writeFileSync(target, text);
console.log("apply-company-skills-package-root-patch: patched", target);
