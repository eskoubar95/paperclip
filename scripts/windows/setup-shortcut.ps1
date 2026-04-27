$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir "start-paperclip.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Paperclip.lnk"
$OldShortcutPath = Join-Path $Desktop "Paperclip Local.lnk"

if (-not (Test-Path $StartScript)) {
  throw "Could not find $StartScript"
}

if (Test-Path $OldShortcutPath) {
  Remove-Item $OldShortcutPath -Force
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
$Shortcut.WorkingDirectory = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Shortcut.IconLocation = "shell32.dll,176"
$Shortcut.Description = "Start Paperclip locally (Docker + backend + app window)"
$Shortcut.Save()

Write-Host "Shortcut created: $ShortcutPath" -ForegroundColor Green
Write-Host "Right-click shortcut and choose 'Pin to taskbar'." -ForegroundColor Yellow
Write-Host "Unpin old Chrome/Paperclip Local icons to keep one clean app icon." -ForegroundColor Yellow
