$ErrorActionPreference = "Stop"

$ContainerName = "paperclip-local"

docker rm -f $ContainerName 2>$null | Out-Null
Write-Host "Stopped and removed container: $ContainerName" -ForegroundColor Green
