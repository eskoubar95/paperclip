param(
  [switch]$NoOpen,
  # Docker image name: build with e.g. `docker build -t paperclip-local .` (repo root) or set PAPERCLIP_DOCKER_IMAGE
  [string]$Image = ""
)

$ErrorActionPreference = "Stop"

# Local launcher for Paperclip on Windows.
# Starts Docker Desktop if needed, recreates the local container,
# waits for healthcheck, and opens the app in the default browser.
#
# Uses your %USERPROFILE%\.paperclip\instances\default folder (config.json + .env + data):
#  - Binds that path to /paperclip/instances/default so Docker sees the same DATABASE_URL
#    and workspaces as `pnpm dev` on the host.
#  - DATABASE_URL is read from that .env first; falls back to PAPERCLIP_LOCAL_DATABASE_URL.

$ContainerName = "paperclip-local"
$AppUrl = "http://localhost:3100"
$HealthUrl = "http://localhost:3100/api/health"
$AppName = "Paperclip Local"
$LogDir = Join-Path $env:LOCALAPPDATA "Paperclip"
$LogFile = Join-Path $LogDir "launcher.log"
$DockerDesktopPaths = @(
  "C:\Program Files\Docker\Docker\Docker Desktop.exe",
  "C:\Program Files\Docker\Docker\Docker Desktop Launcher.exe"
)
$DockerCliPaths = @(
  "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
  "C:\Program Files\Docker\Docker\resources\docker.exe"
)

if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogFile -Value $line
}

function Get-PaperclipInstanceDefaultRoot {
  return (Join-Path $env:USERPROFILE ".paperclip\instances\default")
}

function Get-DotenvValue {
  param(
    [string]$FilePath,
    [string]$Key
  )
  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $null
  }
  $keyEsc = [regex]::Escape($Key)
  $linePattern = "^\s*${keyEsc}\s*=\s*(.*)$"
  foreach ($raw in Get-Content -LiteralPath $FilePath) {
    $line = $raw.Trim()
    if ($line -match "^\s*#" -or $line -eq "") {
      continue
    }
    if ($line -match $linePattern) {
      $v = $matches[1].Trim()
      if ($v.Length -ge 2 -and $v.StartsWith([char]34) -and $v.EndsWith([char]34)) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      elseif ($v.Length -ge 2 -and $v.StartsWith("'") -and $v.EndsWith("'")) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      return $v
    }
  }
  return $null
}

function Get-DatabaseUrl {
  $instanceRoot = Get-PaperclipInstanceDefaultRoot
  $envFile = Join-Path $instanceRoot ".env"
  $fromFile = Get-DotenvValue -FilePath $envFile -Key "DATABASE_URL"
  if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
    return $fromFile
  }
  $value = $env:PAPERCLIP_LOCAL_DATABASE_URL
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable("PAPERCLIP_LOCAL_DATABASE_URL", "User")
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable("PAPERCLIP_LOCAL_DATABASE_URL", "Machine")
  }
  return $value
}

function Get-BetterAuthSecret {
  $instanceRoot = Get-PaperclipInstanceDefaultRoot
  $envFile = Join-Path $instanceRoot ".env"
  $fromFile = Get-DotenvValue -FilePath $envFile -Key "BETTER_AUTH_SECRET"
  if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
    return $fromFile
  }
  # Same dev default as when instance .env has no auth secret; required for PAPERCLIP_DEPLOYMENT_MODE=authenticated in the image
  return "paperclip-dev-secret"
}

# Optional. Same purpose as Railway: private GitHub over HTTPS (managed workspaces / agent git).
# docker-entrypoint.sh reads GH_TOKEN or GITHUB_TOKEN and sets git's url.insteadOf for https://github.com/
function Get-OptionalGitHubToken {
  foreach ($name in @("PAPERCLIP_LOCAL_GH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
      $value = [Environment]::GetEnvironmentVariable($name, "User")
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
      $value = [Environment]::GetEnvironmentVariable($name, "Machine")
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }
  return $null
}

function Get-DockerCommand {
  $command = Get-Command docker -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  foreach ($path in $DockerCliPaths) {
    if (Test-Path $path) {
      return $path
    }
  }
  return $null
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )
  & $script:DockerCmd @Args
}

function Show-Toast {
  param(
    [string]$Title,
    [string]$Body
  )

  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$Title</text>
      <text>$Body</text>
    </binding>
  </visual>
</toast>
"@
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("PaperclipLocalLauncher")
    $notifier.Show($toast)
  } catch {
    # Toast notifications are optional.
  }
}

function Test-DockerReady {
  try {
    Invoke-Docker -Args @("info") 2>$null | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-DockerDesktopIfNeeded {
  if (Test-DockerReady) {
    return
  }

  $dockerExe = $DockerDesktopPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $dockerExe) {
    throw "Docker Desktop executable not found. Install Docker Desktop first."
  }

  Show-Toast -Title $AppName -Body "Starting Docker Desktop in the background..."
  Start-Process -FilePath $dockerExe -WindowStyle Minimized | Out-Null

  # If available, try to start Docker service as an extra nudge.
  try {
    $svc = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne "Running") {
      Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
    }
  } catch {
    # Service start is optional and may require elevated rights.
  }

  # Wait up to ~4 minutes for Docker engine.
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    if (Test-DockerReady) {
      Show-Toast -Title $AppName -Body "Docker is ready."
      return
    }
  }

  throw "Docker Desktop started, but Docker engine did not become ready in time. Open Docker Desktop once manually and wait until it says 'Engine running'."
}

function Test-OllamaQwen3Optional {
  <#
  Optional preflight for Local Hermes + Ollama (qwen3:8b) profile.
  Does not block startup: Paperclip can still run with cloud/OpenRouter agents.
  #>
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 4
    if ($response.StatusCode -ne 200) {
      Write-Log "Ollama: /api/tags returned status $($response.StatusCode)"
      return
    }
    $json = $response.Content | ConvertFrom-Json
    $names = @()
    if ($json.models) {
      foreach ($m in $json.models) {
        if ($m.name) { $names += [string]$m.name }
        elseif ($m.model) { $names += [string]$m.model }
      }
    }
    $hasQwen = $names | Where-Object { $_ -match "qwen3:8b" -or $_ -eq "qwen3:8b" }
    if ($hasQwen) {
      Write-Log "Ollama: qwen3:8b is available (local Hermes profile)."
    } else {
      Write-Log "Ollama: reachable but qwen3:8b not in tag list. Pull with: ollama pull qwen3:8b"
      Show-Toast -Title $AppName -Body "Ollama: run: ollama pull qwen3:8b for local agents."
    }
  } catch {
    Write-Log "Ollama: not reachable at 127.0.0.1:11434 (optional; needed only for Local Hermes + Ollama). Install Ollama for Windows and keep it running."
  }
}

function Wait-ForHealth {
  param(
    [string]$Url,
    [int]$Retries = 60,
    [int]$DelaySeconds = 2
  )

  for ($i = 1; $i -le $Retries; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        return $true
      }
    } catch {
      # Service still warming up.
    }
    Start-Sleep -Seconds $DelaySeconds
  }
  return $false
}

function Open-PaperclipWindow {
  param([string]$Url)

  $chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
  $edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

  if (Test-Path $chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList "--app=$Url" | Out-Null
    return
  }

  if (Test-Path $edgePath) {
    Start-Process -FilePath $edgePath -ArgumentList "--app=$Url" | Out-Null
    return
  }

  # Fallback to default browser if app-mode browsers are unavailable.
  Start-Process $Url | Out-Null
}

$InstanceDefaultRoot = Get-PaperclipInstanceDefaultRoot
if (-not (Test-Path -LiteralPath $InstanceDefaultRoot)) {
  New-Item -ItemType Directory -Path $InstanceDefaultRoot -Force | Out-Null
}

$DatabaseUrl = Get-DatabaseUrl
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  $envPath = Join-Path $InstanceDefaultRoot ".env"
  throw @"
Missing DATABASE_URL. Add a line to:
  $envPath
  DATABASE_URL=postgresql://...

Or set user env: setx PAPERCLIP_LOCAL_DATABASE_URL ""postgresql://...""
"@
}

$BetterAuthSecret = Get-BetterAuthSecret
$ResolvedImage = $Image
if ([string]::IsNullOrWhiteSpace($ResolvedImage)) {
  $ResolvedImage = [Environment]::GetEnvironmentVariable("PAPERCLIP_DOCKER_IMAGE", "Process")
}
if ([string]::IsNullOrWhiteSpace($ResolvedImage)) {
  $ResolvedImage = [Environment]::GetEnvironmentVariable("PAPERCLIP_DOCKER_IMAGE", "User")
}
if ([string]::IsNullOrWhiteSpace($ResolvedImage)) {
  $ResolvedImage = "paperclip-local"
}

$GitHubPat = Get-OptionalGitHubToken

$script:DockerCmd = Get-DockerCommand
if (-not $script:DockerCmd) {
  throw "Docker CLI not found. Install/reinstall Docker Desktop."
}

Write-Log "Launcher started. NoOpen=$NoOpen"
Write-Log "Instance mount: $InstanceDefaultRoot -> /paperclip/instances/default"
Write-Log "Docker image: $ResolvedImage"
Write-Log "Docker CLI resolved: $script:DockerCmd"
if ($GitHubPat) {
  Write-Log "GitHub: GH_TOKEN will be passed into the container (private repo / managed workspace clone)."
} else {
  Write-Log "GitHub: no PAPERCLIP_LOCAL_GH_TOKEN, GH_TOKEN, or GITHUB_TOKEN in environment; private GitHub HTTPS clones may fail (set a PAT like on Railway, then restart via this script)."
}

try {
  Show-Toast -Title $AppName -Body "Launching local environment..."
  Start-DockerDesktopIfNeeded
  Test-OllamaQwen3Optional

  # Replace existing local container if present.
  $containerExists = $false
  try {
    Invoke-Docker -Args @("container", "inspect", $ContainerName) | Out-Null
    $containerExists = $true
  } catch {
    $containerExists = $false
  }

  if ($containerExists) {
    Write-Log "Existing container found, removing: $ContainerName"
    Invoke-Docker -Args @("rm", "-f", $ContainerName) | Out-Null
  }

  Show-Toast -Title $AppName -Body "Starting local container..."
  # Bind-mount Windows instance dir so .env, config.json, and data match `pnpm dev`; Railway DATABASE_URL applies.
  $mountSource = (Resolve-Path -LiteralPath $InstanceDefaultRoot).Path
  $dockerRun = @(
    "run", "-d",
    "--restart", "unless-stopped",
    "--name", $ContainerName,
    "-p", "3100:3100",
    "-e", "PAPERCLIP_DEPLOYMENT_MODE=local_trusted",
    "-e", "PAPERCLIP_DEPLOYMENT_EXPOSURE=private",
    "-e", "DATABASE_URL=$DatabaseUrl",
    "-e", "BETTER_AUTH_SECRET=$BetterAuthSecret",
    "-e", "PAPERCLIP_PUBLIC_URL=http://localhost:3100",
    "-e", "PAPERCLIP_ALLOWED_HOSTNAMES=localhost,127.0.0.1",
    "-e", "BETTER_AUTH_BASE_URL=http://localhost:3100",
    "-e", "PORT=3100",
    "-e", "HOME=/paperclip",
    "-e", "PAPERCLIP_HOME=/paperclip",
    "-v", "${mountSource}:/paperclip/instances/default"
  )
  if ($GitHubPat) {
    $dockerRun = $dockerRun + @("-e", "GH_TOKEN=$GitHubPat")
  }
  $dockerRun = $dockerRun + @($ResolvedImage)
  Invoke-Docker -Args $dockerRun | Out-Null

  if ($GitHubPat) {
    try {
      $cfgKey = "url.https://x-access-token:$GitHubPat@github.com/.insteadOf"
      Invoke-Docker -Args @("exec", $ContainerName, "git", "config", "--global", $cfgKey, "https://github.com/") | Out-Null
      Write-Log "GitHub: git url.insteadOf configured in container (private HTTPS clone)."
    } catch {
      Write-Log "GitHub: could not set git config in container: $_"
    }
  }

  if (-not (Wait-ForHealth -Url $HealthUrl -Retries 60 -DelaySeconds 2)) {
    Write-Log "Healthcheck failed in time window."
    Invoke-Docker -Args @("logs", "--tail", "100", $ContainerName) | Out-File -FilePath $LogFile -Append
    Show-Toast -Title $AppName -Body "Startup failed. Check launcher log."
    throw "Startup failed. Log: $LogFile"
  }

  if (-not $NoOpen) {
    Open-PaperclipWindow -Url $AppUrl
    Show-Toast -Title $AppName -Body "Ready. Opening app window."
  } else {
    Show-Toast -Title $AppName -Body "Ready in background."
  }

  Write-Log "Startup completed successfully."
  Write-Host "Paperclip is ready at $AppUrl" -ForegroundColor Green
} catch {
  $message = $_.Exception.Message
  Write-Log "ERROR: $message"
  Show-Toast -Title $AppName -Body "Startup error. See log file."
  throw
}
