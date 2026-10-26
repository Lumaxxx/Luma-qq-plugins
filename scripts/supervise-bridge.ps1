$ErrorActionPreference = 'Continue'
$root = '<QQ_HOME>'
$log = Join-Path $root 'bridge-supervisor.log'
$node = '<USER_HOME>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$cli = Join-Path $root 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$env:DSH_HOME = Join-Path $root 'home'
$env:PATH = (Join-Path $root 'bin') + ';' + $env:PATH

function Write-Log([string]$m) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content -Path $log -Encoding utf8
}

Write-Log 'supervisor started'
while ($true) {
  try {
    $listening = [bool](Get-NetTCPConnection -State Listen -LocalPort 3081 -ErrorAction SilentlyContinue)
    if (-not $listening) {
      Start-Process -FilePath $node -ArgumentList @($cli, 'web', '--port', '3081', '--no-open') -WindowStyle Hidden
      Write-Log 'bridge not listening -> started'
      # 等它起来再检查，避免刚启动时端口还没监听又拉起第二个
      Start-Sleep -Seconds 30
      continue
    }
    # 好感度只读服务（设置页读表用）
    $affinityUp = [bool](Get-NetTCPConnection -State Listen -LocalPort 3082 -ErrorAction SilentlyContinue)
    if (-not $affinityUp) {
      Start-Process -FilePath $node -ArgumentList @((Join-Path $root 'affinity-server.mjs')) -WindowStyle Hidden
      Write-Log 'affinity server not listening -> started'
    }
  }
  catch {
    Write-Log ("error: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 10
}
