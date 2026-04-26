#Requires -Version 5.1
<#
  Fetches cursor-mcp.json bundle from Paperclip and writes $env:USERPROFILE\.cursor\mcp.json
  Usage:
    $env:PAPERCLIP_API_URL = "http://127.0.0.1:3100"   # no trailing /api
    $env:PAPERCLIP_MCP_SYNC_TOKEN = "pcpmcp_...."
    $env:PAPERCLIP_COMPANY_ID = "<uuid>"
    .\Sync-PaperclipMcp.ps1
#>
$ErrorActionPreference = "Stop"
$api = ($env:PAPERCLIP_API_URL ?? "http://127.0.0.1:3100").TrimEnd("/")
$companyId = $env:PAPERCLIP_COMPANY_ID
$token = $env:PAPERCLIP_MCP_SYNC_TOKEN
if (-not $companyId) { throw "Set PAPERCLIP_COMPANY_ID" }
if (-not $token) { throw "Set PAPERCLIP_MCP_SYNC_TOKEN (create in Company Settings → Cursor MCP)" }
$url = "$api/api/companies/$companyId/mcp/cursor-mcp.json"
$headers = @{ Authorization = "Bearer $token" }
$out = Join-Path $env:USERPROFILE ".cursor" "mcp.json"
$null = New-Item -ItemType Directory -Force -Path (Split-Path $out)
Invoke-RestMethod -Uri $url -Headers $headers -Method Get | ConvertTo-Json -Depth 50 | Set-Content -Path $out -Encoding utf8
Write-Host "Wrote $out"
