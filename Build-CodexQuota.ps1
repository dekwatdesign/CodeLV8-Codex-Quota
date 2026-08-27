$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules") -PathType Container)) {
  npm ci
}

npm run check
npm test
npm run electron:build

Write-Output "Codex Quota package: $((Join-Path $PSScriptRoot 'release\win-unpacked\Codex Quota.exe'))"
