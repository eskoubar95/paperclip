$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RepoRoot = "C:\Users\Nicklas\Github\paperclip"
$StartScript = Join-Path $RepoRoot "scripts\windows\start-paperclip.ps1"
$StopScript = Join-Path $RepoRoot "scripts\windows\stop-paperclip.ps1"
$AppUrl = "http://localhost:3100"
$ContainerName = "paperclip-local"

if (-not (Test-Path $StartScript)) { throw "Missing $StartScript" }
if (-not (Test-Path $StopScript)) { throw "Missing $StopScript" }

function Open-PaperclipApp {
  $chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
  $edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

  if (Test-Path $chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList "--app=$AppUrl" | Out-Null
    return
  }
  if (Test-Path $edgePath) {
    Start-Process -FilePath $edgePath -ArgumentList "--app=$AppUrl" | Out-Null
    return
  }
  Start-Process $AppUrl | Out-Null
}

function Test-ContainerRunning {
  try {
    $running = docker inspect -f "{{.State.Running}}" $ContainerName 2>$null
    return ($running -eq "true")
  } catch {
    return $false
  }
}

function Start-Backend {
  Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$StartScript`" -NoOpen" -WindowStyle Hidden -Wait
}

function Stop-Backend {
  Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$StopScript`"" -WindowStyle Hidden -Wait
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Visible = $true
$notifyIcon.Text = "Paperclip Local"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemStatus = $menu.Items.Add("Status: Initializing...")
$null = $menu.Items.Add("-")
$itemOpen = $menu.Items.Add("Open Paperclip")
$itemRestart = $menu.Items.Add("Restart Backend")
$itemQuit = $menu.Items.Add("Quit Paperclip")
$notifyIcon.ContextMenuStrip = $menu

$itemOpen.Add_Click({
  Open-PaperclipApp
})

$itemRestart.Add_Click({
  try {
    Stop-Backend
    Start-Backend
    [System.Windows.Forms.MessageBox]::Show("Paperclip backend restarted.", "Paperclip", "OK", "Information") | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Could not restart backend: $($_.Exception.Message)", "Paperclip", "OK", "Error") | Out-Null
  }
})

$itemQuit.Add_Click({
  try {
    Stop-Backend
  } catch {
    # Ignore stop errors on exit.
  }
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.Add_DoubleClick({
  Open-PaperclipApp
})

try {
  Start-Backend
} catch {
  [System.Windows.Forms.MessageBox]::Show("Paperclip startup failed: $($_.Exception.Message)", "Paperclip", "OK", "Error") | Out-Null
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
  if (Test-ContainerRunning) {
    $itemStatus.Text = "Status: Running"
    $notifyIcon.Text = "Paperclip Local - Running"
  } else {
    $itemStatus.Text = "Status: Stopped"
    $notifyIcon.Text = "Paperclip Local - Stopped"
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
