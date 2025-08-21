$ErrorActionPreference = "Stop"

param(
  [int]$duration = 30,
  [string]$mode = "wasm"
)

Write-Host "Waiting $duration seconds to collect metrics..."
Start-Sleep -Seconds $duration

try {
  $resp = Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/metrics
  if ($resp.StatusCode -eq 200) {
    $json = $resp.Content | ConvertFrom-Json
    $json | ConvertTo-Json -Depth 5 | Out-File -Encoding UTF8 metrics.json
    Write-Host "Saved metrics.json"
  } else {
    Write-Host "No metrics available (status $($resp.StatusCode))"
  }
} catch {
  Write-Host "Failed to fetch metrics: $_"
}


