$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules") -PathType Container)) {
  npm ci
}

npm run check
npm test
npm run electron:build

$installer = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "release") -Filter "Codex-Quota-*-x64.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "ไม่พบ Windows x64 installer ใน release"
}

Write-Output "Codex Quota installer: $($installer.FullName)"
Write-Output "Codex Quota package: $((Join-Path $PSScriptRoot 'release\win-unpacked\Codex Quota.exe'))"
