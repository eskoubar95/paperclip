$ErrorActionPreference = "Stop"

$ScriptPath = "C:\Users\Nicklas\Github\paperclip\scripts\windows\paperclip-tray.ps1"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "Paperclip Local Tray.lnk"

if (-not (Test-Path $ScriptPath)) {
  throw "Missing script: $ScriptPath"
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
$Shortcut.WorkingDirectory = "C:\Users\Nicklas\Github\paperclip"
$Shortcut.IconLocation = "shell32.dll,220"
$Shortcut.Save()

Write-Host "Created startup shortcut: $ShortcutPath" -ForegroundColor Green
Write-Host "Paperclip tray + backend will auto-start at user login (no admin required)." -ForegroundColor Green
