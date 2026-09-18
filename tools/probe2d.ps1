param(
  [string]$Page = 'tools/_street-probe.html',
  [string]$Shot = ''
)
$ErrorActionPreference = 'Continue'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$ud = Join-Path $env:TEMP 'dsh2d_probe'
if (Test-Path $ud) { Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }
$tmp = Join-Path $env:TEMP 'dsh2d_probe_dom.html'
if (Test-Path $tmp) { Remove-Item -Force $tmp }
$url = 'http://127.0.0.1:8080/' + $Page
$cmd = '"' + $chrome + '" --headless=new --disable-gpu --no-sandbox --timeout=45000 --virtual-time-budget=15000 --user-data-dir="' + $ud + '" --dump-dom "' + $url + '" > "' + $tmp + '" 2>nul'
cmd /c $cmd
Start-Sleep -Milliseconds 700
$text = ''
if (Test-Path $tmp) { $text = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8) }
$m = [regex]::Match($text, '(?s)<pre id="out">(.*?)</pre>')
if ($m.Success) { $m.Groups[1].Value -replace '<[^>]+>', '' }
else { 'NO OUT len=' + $text.Length }
if ($Shot -ne '') {
  $root = Split-Path -Parent $PSScriptRoot
  $outPath = (Join-Path $root $Shot) -replace '/', '\'
  if (Test-Path $outPath) { Remove-Item $outPath -Force }
  $ud2 = Join-Path $env:TEMP 'dsh2d_probeshot'
  if (Test-Path $ud2) { Remove-Item -Recurse -Force $ud2 -ErrorAction SilentlyContinue }
  $bat = Join-Path $env:TEMP 'probeshot.bat'
  Set-Content -Path $bat -Value @('@echo off', '"' + $chrome + '" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1600,1000 --virtual-time-budget=12000 --user-data-dir="' + $ud2 + '" --screenshot="' + $outPath + '" "' + $url + '"') -Encoding Ascii
  cmd /c $bat 2>&1 | Out-Null
  if (Test-Path $outPath) { 'SHOT OK ' + $outPath + ' ' + (Get-Item $outPath).Length }
}
