$ErrorActionPreference = "Stop"

if ($env:MODE -eq $null -or $env:MODE -eq "") { $env:MODE = "wasm" }
Write-Host "Starting demo in MODE=$($env:MODE)"

$hasDocker = (Get-Command docker -ErrorAction SilentlyContinue) -ne $null
$hasDockerComposeCmd = (Get-Command docker-compose -ErrorAction SilentlyContinue) -ne $null
$hasDockerComposeSub = $false
if ($hasDocker) {
  try {
    docker compose version | Out-Null
    $hasDockerComposeSub = $true
  } catch {}
}

if ($hasDocker -and $hasDockerComposeSub) {
  docker compose up --build
} elseif ($hasDockerComposeCmd) {
  docker-compose up --build
} else {
  if (Test-Path package-lock.json) { npm ci } else { npm install }
  npm start
}


