# Ayu plugin pack - installer (ASCII only)
#
# Installs the plugins/patches/scripts into an existing DSH + NapCat + qq-groupmate setup.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install-ayu.ps1 -GroupId <qq-group>
# Optional:
#   -QQHome      bridge instance dir     (default: %USERPROFILE%\dsh-qq)
#   -DSHHome     desktop DSH home        (default: %USERPROFILE%\.dsh)
#   -WebAgentHome browser-use install    (default: %USERPROFILE%\ayu-web-agent)
#   -PythonExe   python with requests+pyyaml
#   -BotQQ / -OwnerUid / -OwnerName / -BotName  fill placeholders
#   -NapCatToken NapCat HTTP api token   (default: random)
#   -DryRun

param(
  [string]$QQHome = "",
  [string]$DSHHome = "",
  [string]$WebAgentHome = "",
  [string]$GroupId = "",
  [string]$BotQQ = "",
  [string]$OwnerUid = "",
  [string]$OwnerName = "",
  [string]$BotName = "",
  [string]$NapCatToken = "",
  [string]$PythonExe = "",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
$UserHome = $env:USERPROFILE

if ($QQHome -eq "") { $QQHome = Join-Path $UserHome 'dsh-qq' }
if ($DSHHome -eq "") { $DSHHome = Join-Path $UserHome '.dsh' }
if ($WebAgentHome -eq "") { $WebAgentHome = Join-Path $UserHome 'ayu-web-agent' }
if ($NapCatToken -eq "") {
  $NapCatToken = -join ((48..57) + (97..102) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
}

$WebProfile = Join-Path $QQHome 'home\profiles\web'
$DesktopProfile = Join-Path $DSHHome 'profiles\desktop'
$BotData = Join-Path $QQHome 'home\qq-groupmate'
$Lib = Join-Path $WebProfile 'node_modules\dsh-plugin-qq-groupmate\lib'
$AmemDir = Join-Path $WebProfile 'node_modules\dsh-qq-amem'
$SocialDir = Join-Path $DesktopProfile 'node_modules\dsh-qq-social'

function Say($m) { Write-Host "[ayu] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[ayu] $m" -ForegroundColor Yellow }
function Run-Step($action) {
  if ($DryRun) { Write-Host "  (dry-run) $action" -ForegroundColor DarkGray } else { & $action }
}
function Write-Utf8([string]$path, [string]$text) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Substitute([string]$text) {
  $map = [ordered]@{
    '<QQ_HOME>'        = $QQHome
    '<DSH_HOME>'       = $DSHHome
    '<USER_HOME>'      = $UserHome
    '<WEBAGENT_HOME>'  = $WebAgentHome
    '<PYTHON_EXE>'     = $PythonExe
    '<GROUP_ID>'       = $GroupId
    '<NAPCAT_TOKEN>'   = $NapCatToken
    '<BOT_QQ>'         = $BotQQ
    '<OWNER_UID>'      = $OwnerUid
    '<OWNER_NAME>'     = $OwnerName
    '<BOT_NAME>'       = $BotName
    '<LEGACY_LLM_CONFIG>' = ''
    '<API_KEY>'        = ''
  }
  foreach ($k in $map.Keys) { $text = $text.Replace($k, $map[$k]) }
  return $text
}

function Install-TextFile([string]$src, [string]$dst) {
  $text = Get-Content $src -Raw -Encoding UTF8
  Run-Step { Write-Utf8 $dst (Substitute $text) }
}

function Ensure-Bundle([string]$profileDir, [string]$bundle) {
  $pkg = Join-Path $profileDir 'package.json'
  if (-not (Test-Path $pkg)) { Warn "missing $pkg"; return }
  if ($DryRun) { Write-Host "  (dry-run) register $bundle" -ForegroundColor DarkGray; return }
  $data = Get-Content $pkg -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq $data.dsh) { $data | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $data.dsh.profile) { $data.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
  if ($null -eq $data.dsh.profile.bundles) { $data.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
  $bundles = @($data.dsh.profile.bundles)
  if ($bundles -notcontains $bundle) {
    $data.dsh.profile.bundles = @($bundles + $bundle)
    Write-Utf8 $pkg (($data | ConvertTo-Json -Depth 12) + "`n")
    Say "registered $bundle"
  }
}

Say "repo     : $Repo"
Say "bridge   : $QQHome"
Say "desktop  : $DSHHome"
Say "bot data : $BotData"
Say "web agent: $WebAgentHome"

if (-not (Test-Path $Lib)) {
  Warn "qq-groupmate not found: $Lib"
  Warn "install dsh-plugin-qq-groupmate into the bridge profile first."
  exit 1
}

if ($PythonExe -eq "") {
  $cand = @(
    (Join-Path $UserHome 'AppData\Local\Programs\Python\Python311\python.exe'),
    (Join-Path $UserHome 'AppData\Local\Programs\Python\Python310\python.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($cand) { $PythonExe = $cand } else { $PythonExe = 'python' }
}
Say "python   : $PythonExe"

# 1) API key -> local secret file
$key = $env:DEEPSEEK_API_KEY
if (-not $key -or -not $key.StartsWith('sk-')) {
  Say "paste DeepSeek API key (hidden), empty to skip:"
  $sec = Read-Host -AsSecureString 'API Key'
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ($key -and $key.StartsWith('sk-')) {
  Run-Step { Write-Utf8 (Join-Path $QQHome 'ayu-secret.env') ("DEEPSEEK_API_KEY=$key`n") }
  Say "key saved to $(Join-Path $QQHome 'ayu-secret.env')"
} else { Warn "no key: vision + learning disabled" }

# 2) qq-groupmate patches
$patchLib = Join-Path $Repo 'qq-groupmate-patch\lib'
Get-ChildItem $patchLib -Filter *.js | ForEach-Object { Install-TextFile $_.FullName (Join-Path $Lib $_.Name) }
Say "qq-groupmate patched"

# 3) sidecar plugin
New-Item -ItemType Directory -Path $AmemDir -Force | Out-Null
Copy-Item (Join-Path $Repo 'dsh-qq-amem\index.js') $AmemDir -Force
Copy-Item (Join-Path $Repo 'dsh-qq-amem\package.json') $AmemDir -Force
Install-TextFile (Join-Path $Repo 'dsh-qq-amem\cordis.patch.yml') (Join-Path $AmemDir 'cordis.patch.yml')
Ensure-Bundle $WebProfile 'dsh-qq-amem'
Say "sidecar installed"

# 4) settings plugin
if (Test-Path $DesktopProfile) {
  New-Item -ItemType Directory -Path $SocialDir -Force | Out-Null
  Copy-Item (Join-Path $Repo 'dsh-qq-social\package.json') $SocialDir -Force
  Get-ChildItem (Join-Path $Repo 'dsh-qq-social') -Filter *.js | ForEach-Object { Install-TextFile $_.FullName (Join-Path $SocialDir $_.Name) }
  Ensure-Bundle $DesktopProfile 'dsh-qq-social'
  Say "settings plugin installed (restart desktop DSH)"
} else { Warn "desktop profile not found: $DesktopProfile" }

# 5) bridge config
$bridgeCfg = Join-Path $WebProfile 'cordis.patch.yml'
if (Test-Path $bridgeCfg) {
  Run-Step { Copy-Item $bridgeCfg ($bridgeCfg + '.bak_' + (Get-Date -Format yyyyMMddHHmmss)) -Force }
  Warn "bridge config exists; backed up, merge configs\cordis.patch.example.yml manually"
} else {
  Install-TextFile (Join-Path $Repo 'configs\cordis.patch.example.yml') $bridgeCfg
  Say "bridge config written"
}

# 6) scripts
foreach ($name in 'ayu-learn.py','ayu-sync-cards.mjs','affinity-server.mjs','supervise-bridge.ps1','start-qq-hidden.vbs','start-qq-bg.cmd','start-bridge-supervisor.cmd','start-napcat.cmd') {
  $src = Join-Path $Repo ("scripts\" + $name)
  if (Test-Path $src) { Install-TextFile $src (Join-Path $QQHome $name) }
}
Say "scripts written to $QQHome"

# 7) web agent script
if (Test-Path $WebAgentHome) {
  Install-TextFile (Join-Path $Repo 'web-agent\run_ayu.py') (Join-Path $WebAgentHome 'run_ayu.py')
  Say "web agent script copied (deps: $PythonExe -m pip install browser-use==0.1.40)"
} else { Warn "web agent dir missing: $WebAgentHome (skip run_ayu.py)" }

Write-Host ""
Say "done. next:"
Write-Host "  1) NapCat http api on 127.0.0.1:6098, token = $NapCatToken"
Write-Host "  2) wscript `"$QQHome\start-qq-hidden.vbs`""
Write-Host "  3) `"$QQHome\start-bridge-supervisor.cmd`""
Write-Host "  4) restart desktop DSH -> settings -> LUMA"
Write-Host "  5) first learn: `"$PythonExe`" `"$QQHome\ayu-learn.py`""
