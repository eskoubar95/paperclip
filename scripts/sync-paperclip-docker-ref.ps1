<#
.SYNOPSIS
  Sets PAPERCLIP_GIT_REF in the parent Dockerfile to the current paperclip/ submodule HEAD.

.DESCRIPTION
  Docker builds clone paperclip from Git at a fixed SHA — not your working tree.
  After you commit in `paperclip/`, run this from the repo root, then rebuild the image.
  You must still `git push` the paperclip fork so Railway/CI can clone that commit.

.EXAMPLE
  cd C:\path\to\parent-repo
  .\scripts\sync-paperclip-docker-ref.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dockerfile = Join-Path $root "Dockerfile"
$pc = Join-Path $root "paperclip"
if (-not (Test-Path -LiteralPath $pc)) {
  throw "paperclip/ not found at $pc"
}
Push-Location $pc
try {
  $dirty = git status --porcelain
  if ($dirty) {
    Write-Warning "paperclip/ has uncommitted changes. Commit (or stash) before relying on this SHA for production."
  }
  $sha = (git rev-parse HEAD).Trim()
} finally {
  Pop-Location
}
if ($sha.Length -ne 40) {
  throw "Unexpected git rev-parse output: $sha"
}
$content = Get-Content -LiteralPath $dockerfile -Raw
$pattern = '(ARG PAPERCLIP_GIT_REF=)([a-f0-9]{40})'
$newContent = [regex]::Replace($content, $pattern, "`$1$sha", 1)
if ($newContent -eq $content) {
  throw "Could not find ARG PAPERCLIP_GIT_REF=<40-char-sha> in Dockerfile"
}
Set-Content -LiteralPath $dockerfile -Value $newContent -NoNewline
Write-Host "Updated Dockerfile PAPERCLIP_GIT_REF=$sha" -ForegroundColor Green
