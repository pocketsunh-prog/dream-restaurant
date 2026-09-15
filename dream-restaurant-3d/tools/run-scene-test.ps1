# ============================================================================
# run-scene-test.ps1 - run scene-test.html in headless Chrome and print the result
#   usage: powershell -File tools/run-scene-test.ps1 [-Url http://127.0.0.1:8081]
#   Why this exists: reading the dumped HTML with PowerShell's default encoding
#   mangles non-ASCII text, so this reads/writes everything as UTF-8 and pulls
#   the report out of <pre id="out">.
#   NOTE: keep this file ASCII-only (Windows PowerShell 5.1 parses it as ANSI).
# ============================================================================
param(
  [string]$Url = 'http://127.0.0.1:8081',
  [string]$Page = 'tools/scene-test.html',
  [int]$TimeoutMs = 90000
)
$ErrorActionPreference = 'Stop'

$exe = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { throw 'Chrome/Edge not found' }

$tmp = Join-Path $env:TEMP ('dsh-scene-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$dom = Join-Path $tmp 'dom.html'
$err = Join-Path $tmp 'err.txt'
$ud = Join-Path $tmp 'profile'

$target = "$Url/$Page"
$cargs = @(
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--autoplay-policy=no-user-gesture-required',
  ("--timeout=" + $TimeoutMs), ("--user-data-dir=" + $ud),
  '--dump-dom', ('"' + $target + '"')
)
Start-Process -FilePath $exe -ArgumentList $cargs -NoNewWindow -Wait -RedirectStandardOutput $dom -RedirectStandardError $err | Out-Null

$raw = [System.IO.File]::ReadAllText($dom, [System.Text.Encoding]::UTF8)
$m = [regex]::Match($raw, '(?s)<pre id="out">(.*?)</pre>')
if (-not $m.Success) {
  $t = [regex]::Match($raw, '<title>([^<]*)</title>')
  Write-Output ('NO OUTPUT - title: ' + $t.Groups[1].Value)
  exit 2
}
$lt = [char]0x3C; $gt = [char]0x3E; $amp = [char]0x26
$text = $m.Groups[1].Value
$text = $text -replace ('&' + 'lt;'), '<'
$text = $text -replace ('&' + 'gt;'), '>'
$text = $text -replace ('&' + '#39;'), "'"
$text = $text -replace ('&' + 'quot;'), '"'
$text = $text -replace ('&' + 'amp;'), '&'
Write-Output $text
$summary = ($text -split "`n" | Where-Object { $_ -match 'SCENE TEST' }) -join ''
if ($summary -match 'FAILED') { exit 1 } else { exit 0 }
