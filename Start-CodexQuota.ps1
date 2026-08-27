param(
  [switch]$Demo
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$executable = Join-Path $PSScriptRoot "release\win-unpacked\Codex Quota.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "ไม่พบแพ็กเกจ Codex Quota กรุณารัน .\Build-CodexQuota.ps1 ก่อน"
}

$arguments = if ($Demo) { "--demo" } else { "" }
Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $PSScriptRoot
