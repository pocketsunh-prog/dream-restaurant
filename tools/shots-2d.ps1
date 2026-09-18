param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$W = 1600,
  [int]$H = 1000,
  [int]$WaitMs = 9000
)
$ErrorActionPreference = 'Stop'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$root = Split-Path -Parent $PSScriptRoot
$outPath = (Join-Path $root $Out) -replace '/', '\'
$dir = Split-Path -Parent $outPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
if (Test-Path $outPath) { Remove-Item $outPath -Force }
$ud = Join-Path $env:TEMP 'dsh2dshot'
if (Test-Path $ud) { Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }
$line = '"' + $chrome + '" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --window-size=' + $W + ',' + $H + ' --virtual-time-budget=' + $WaitMs + ' --user-data-dir="' + $ud + '" --screenshot="' + $outPath + '" "' + $Url + '"'
$bat = Join-Path $env:TEMP 'dsh2dshot.bat'
Set-Content -Path $bat -Value @('@echo off', $line) -Encoding Ascii
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $bat -WindowStyle Hidden -PassThru
if (-not $p.WaitForExit(90000)) {
  try { $p.Kill() } catch { }
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Output ('TIMEOUT ' + $outPath)
  exit 1
}
if (Test-Path $outPath) {
  Write-Output ('OK ' + $outPath + ' ' + (Get-Item $outPath).Length + ' bytes')
} else {
  Write-Output ('FAILED ' + $outPath)
}
