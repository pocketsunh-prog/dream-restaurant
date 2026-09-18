param(
  [string]$Base = 'http://127.0.0.1:8080',
  [int]$Budget = 45000,
  [string]$Only = ''
)
$ErrorActionPreference = 'Continue'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$tests = @(
  @{ name = 'weather-clip'; url = "$Base/tools/weather-clip-test.html"; budget = $Budget },
  @{ name = 'night-crisp';  url = "$Base/tools/night-crisp-test.html";  budget = $Budget },
  @{ name = 'material';     url = "$Base/tools/material-test.html";     budget = $Budget },
  @{ name = 'actor';        url = "$Base/tools/actor-test.html";        budget = $Budget },
  @{ name = 'ui';           url = "$Base/tools/ui-test.html";           budget = $Budget }
)
foreach ($t in $tests) {
  if ($Only -ne '' -and $t.name -ne $Only) { continue }
  $ud = Join-Path $env:TEMP ('dsh2d_' + $t.name)
  if (Test-Path $ud) { Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }
  $tmp = Join-Path $env:TEMP ('dsh2d_' + $t.name + '.html')
  if (Test-Path $tmp) { Remove-Item -Force $tmp }
  $cmd = '"' + $chrome + '" --headless=new --disable-gpu --no-sandbox --timeout=' + $t.budget + ' --virtual-time-budget=' + $t.budget + ' --user-data-dir="' + $ud + '" --dump-dom "' + $t.url + '" > "' + $tmp + '" 2>nul'
  cmd /c $cmd
  $text = ''
  for ($try = 0; $try -lt 10; $try++) {
    try {
      if (Test-Path $tmp) { $text = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8) }
      if ($text.Length -gt 0) { break }
    } catch { $text = '' }
    Start-Sleep -Milliseconds 400
  }
  $m = [regex]::Match($text, '(?s)<pre id="out">(.*?)</pre>')
  Write-Output ("===== " + $t.name + " =====")
  if ($m.Success) {
    $body = $m.Groups[1].Value
    $body = $body -replace '<[^>]+>', ''
    $body = $body -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&' -replace '&quot;', '"'
    Write-Output $body
  } else {
    $m2 = [regex]::Match($text, '(?s)<pre[^>]*id="out"[^>]*>(.*?)</pre>')
    if ($m2.Success) { Write-Output ($m2.Groups[1].Value -replace '<[^>]+>', '') }
    else {
      $m3 = [regex]::Match($text, '(?s)<div id="summary"[^>]*>(.*?)</div>')
      if ($m3.Success) { Write-Output ($m3.Groups[1].Value -replace '<[^>]+>', '') }
      else { Write-Output 'NO #out PRE FOUND (len=' + $text.Length + ')'; Write-Output ($text.Substring(0, [Math]::Min(800, $text.Length))) }
    }
  }
  Write-Output ''
}
