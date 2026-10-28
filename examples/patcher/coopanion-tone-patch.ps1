<#
  coopanion-tone-patch.ps1 —— 恢复 Coopanion 的「说话腔调检查」补丁

  为什么需要它：
  Coopanion 升级会整包替换 resources\app，框架里的 tone-check.ts 和桌宠补丁会丢；
  data\extensions 下的扩展一般不丢，但重装扩展会。

  补的地方（6 个文件）：
    1. resources\app\build\cortico\src\core\tone-check.ts            ← 从 .src 复制
    2. resources\app\node_modules\cortico-world-desktop-pet\src\world.ts （pet_say 回执，只记）
    3. data\extensions\...\cortico-world-qq-final-beta\src\world.ts   （qq_send 闸门/回执/兜底/补发）
    4. data\extensions\...\cortico-world-qq-final-beta\src\qzone.ts   （自动说说/评论闸门）
    5. data\extensions\...\cortico-world-bili-scroller\src\world.ts   （B站评论闸门）
    6. data\extensions\...\cortico-world-qzone-alont1\src\world.ts    （qzone_post 闸门）

  设计要点：
  - 所有注入的调用都走「软加载」：拿不到 tone-check.ts 就退化成不检查，绝不让世界起不来。
  - 幂等：每个补丁都有 marker，已存在就跳过。
  - 锚点找不到时明确告警并跳过，不乱改。

  用法：
    手动： powershell -ExecutionPolicy Bypass -File .\coopanion-tone-patch.ps1
    静默： ... -Quiet            计划任务用的就是这个
    重启： ... -Restart          补完顺手重启（计划任务没带）
    指定： ... -Root "D:\Coopanion"
#>
param([switch]$Quiet, [switch]$Restart, [string]$Root)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$logFile = Join-Path $PSScriptRoot 'coopanion-tone-patch.log'

function Say([string]$m) { if (-not $Quiet) { Write-Host $m } }
function Note([string]$m) {
  try { Add-Content -LiteralPath $logFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 } catch { }
}
function Read-Text([string]$p) { return [System.IO.File]::ReadAllText($p, $utf8) }
function Write-Text([string]$p, [string]$t) { [System.IO.File]::WriteAllText($p, $t, $utf8) }

# ---------- 定位 Coopanion ----------
function Find-Root {
  if ($Root) { return $Root }
  $loc = Join-Path $env:LOCALAPPDATA 'Coopanion\data-location.json'
  if (Test-Path -LiteralPath $loc) {
    try {
      $j = Get-Content -LiteralPath $loc -Raw -Encoding utf8 | ConvertFrom-Json
      if ($j.program -and (Test-Path -LiteralPath $j.program)) { return [string]$j.program }
    } catch { }
  }
  $guess = Join-Path $env:USERPROFILE 'Coopanion'
  if (Test-Path -LiteralPath $guess) { return $guess }
  throw '找不到 Coopanion 安装目录，请用 -Root 指定'
}

$root = Find-Root
$dataDir = Join-Path $root 'data'
$moduleDst = Join-Path $root 'resources\app\build\cortico\src\core\tone-check.ts'
$petWorld = Join-Path $root 'resources\app\node_modules\cortico-world-desktop-pet\src\world.ts'
$qqDir = Join-Path $dataDir 'extensions\node_modules\cortico-world-qq-final-beta\src'
$qqWorld = Join-Path $qqDir 'world.ts'
$qqQzone = Join-Path $qqDir 'qzone.ts'
$biliWorld = Join-Path $dataDir 'extensions\node_modules\cortico-world-bili-scroller\src\world.ts'
$qzWorld = Join-Path $dataDir 'extensions\node_modules\cortico-world-qzone-alont1\src\world.ts'
$moduleSrc = Join-Path $PSScriptRoot 'coopanion-tone-check.ts.src'

Say "Coopanion: $root"

# ---------- 通用：在某行之后插入若干行 ----------
function Insert-AfterLine([string]$content, [string]$anchor, [string[]]$lines) {
  $at = $content.IndexOf($anchor)
  if ($at -lt 0) { return $null }
  $lineEnd = $content.IndexOf("`n", $at)
  if ($lineEnd -lt 0) { return $null }
  return $content.Insert($lineEnd + 1, (($lines -join "`r`n") + "`r`n"))
}

# ---------- 通用：把某一行整体替换成若干行 ----------
function Replace-Line([string]$content, [string]$anchor, [string[]]$lines) {
  if ($content.IndexOf($anchor) -lt 0) { return $null }
  return $content.Replace($anchor, ($lines -join "`r`n"))
}

# ---------- 软加载块（含 toneGate + toneNote） ----------
$softBoth = @(
  '// 体检模块软加载：拿不到就退化成「不检查」，绝不让本世界起不来。'
  '// （Coopanion 升级会把 resources\app 整个换掉，框架里的 tone-check.ts 可能暂时不在。）'
  'type ToneBlockResult = { block: string; level: string; density: number; hits: string } | null;'
  'let toneNote: (text: string, where?: string) => string = () => '''';'
  'let toneGate: (text: string, where?: string) => ToneBlockResult = () => null;'
  'try {'
  '  const toneMod = await import(''cortico/core/tone-check.ts'');'
  '  if (typeof toneMod.toneNote === ''function'') toneNote = toneMod.toneNote as typeof toneNote;'
  '  if (typeof toneMod.toneGate === ''function'') toneGate = toneMod.toneGate as typeof toneGate;'
  '} catch {'
  '  // 模块不在，照常工作'
  '}'
)

# ---------- 软加载块（只有 toneNote，桌宠用） ----------
$softNote = @(
  '// 体检模块软加载：拿不到就退化成「不检查」，绝不让本世界起不来。'
  '// （Coopanion 升级会把 resources\app 整个换掉，框架里的 tone-check.ts 可能暂时不在。）'
  'let toneNote: (text: string, where?: string) => string = () => '''';'
  'try {'
  '  const toneMod = await import(''cortico/core/tone-check.ts'');'
  '  if (typeof toneMod.toneNote === ''function'') toneNote = toneMod.toneNote as typeof toneNote;'
  '} catch {'
  '  // 模块不在，照常工作'
  '}'
)

$wrote = $false
$problems = @()

# ================= 1. 体检模块 =================
if (Test-Path -LiteralPath $moduleDst) {
  Say '[1/6] 体检模块已在'
} else {
  $moduleParent = Split-Path -Parent $moduleDst
  if (-not (Test-Path -LiteralPath $moduleParent)) {
    Say '[1/6] 体检模块：目标目录不存在（Coopanion 路径可能变了），跳过'
    $problems += '框架 core 目录不存在'
  } elseif (-not (Test-Path -LiteralPath $moduleSrc)) {
    Say '[1/6] 体检模块：缺少源文件 coopanion-tone-check.ts.src，跳过'
    $problems += '缺少体检模块源文件'
  } else {
    Copy-Item -LiteralPath $moduleSrc -Destination $moduleDst -Force
    $wrote = $true
    Say '[1/6] 体检模块已就位'
  }
}

# ================= 2. 桌宠 pet_say（只记不拦） =================
if (-not (Test-Path -LiteralPath $petWorld)) {
  Say '[2/6] 桌宠：没装，跳过'
} elseif ((Read-Text $petWorld).Contains('tone-check.ts')) {
  Say '[2/6] 桌宠：已打过'
} else {
  $t = Read-Text $petWorld
  $anchor = "import { nowIso, shortTime } from 'cortico/core/util.ts';"
  $next = Insert-AfterLine $t $anchor $softNote
  if (-not $next) {
    Say '[2/6] 桌宠：找不到 import 锚点，跳过'
    $problems += '桌宠 import 锚点缺失'
  } else {
    $t = $next
    $oldRet = 'return { text: this.t.sayReceipt({ waitSec, selfSec, chatOpen: this.chat.size > 0, replaced, dropped, images: shown.blobs.length }) };'
    $newRet = 'return { text: this.t.sayReceipt({ waitSec, selfSec, chatOpen: this.chat.size > 0, replaced, dropped, images: shown.blobs.length }) + toneNote(beats.map((b) => b.text).join(''''), ''pet_say'') };'
    if ($t.Contains($oldRet)) { $t = $t.Replace($oldRet, $newRet); Say '[2/6] 桌宠：软加载 + 回执已写入' }
    else { Say '[2/6] 桌宠：只补了软加载，回执锚点没找到'; $problems += '桌宠回执锚点缺失' }
    Write-Text $petWorld $t
    $wrote = $true
  }
}

# ================= 3. QQ world（闸门 + 回执 + 兜底 + 补发） =================
if (-not (Test-Path -LiteralPath $qqWorld)) {
  Say '[3/6] QQ：没装，跳过'
} else {
  $q = Read-Text $qqWorld
  $touched = $false

  if (-not $q.Contains('tone-check.ts')) {
    $anchor = "import { shortTime } from 'cortico/core/util.ts';"
    $next = Insert-AfterLine $q $anchor $softBoth
    if ($next) { $q = $next; $touched = $true; Say '[3/6] QQ：软加载已写入' }
    else { $problems += 'QQ import 锚点缺失' }
  }

  if (-not $q.Contains('toneGate(text)')) {
    $anchor = "this.log.info('qq_send调用参数', { to, textLength: text.length });"
    $gateLines = @(
      '        // 说话腔调闸门：判「中」以上直接不放行，改短改顺之后再调一次。'
      '        const toneBlocked = toneGate(text);'
      '        if (toneBlocked) {'
      "          this.log.info('qq_send 被腔调检查拦下', { level: toneBlocked.level, density: toneBlocked.density, hits: toneBlocked.hits });"
      '          return { text: toneBlocked.block, failed: true };'
      '        }'
    )
    $next = Insert-AfterLine $q $anchor $gateLines
    if ($next) { $q = $next; $touched = $true; Say '[3/6] QQ：qq_send 闸门已写入' }
    else { $problems += 'QQ 闸门锚点缺失' }
  }

  if (-not $q.Contains('${toneNote(text)}')) {
    $lines = $q -split '(?<=\r?\n)'
    $done = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]
      if ($line.Contains('已发送（编号') -and -not $line.Contains('toneNote')) {
        $pos = $line.LastIndexOf('`;')
        if ($pos -ge 0) { $lines[$i] = $line.Substring(0, $pos) + '${toneNote(text)}' + $line.Substring($pos); $done = $true }
      }
    }
    if ($done) { $q = ($lines -join ''); $touched = $true; Say '[3/6] QQ：回执提示已写入' }
    else { $problems += 'QQ 回执锚点缺失' }
  }

  if (-not $q.Contains('toneNote(buf)')) {
    $at = $q.IndexOf('void this.sendTo(conv, buf).catch(')
    if ($at -ge 0) {
      $q = $q.Replace('void this.sendTo(conv, buf).catch(', 'void this.sendTo(conv, buf).then(() => { toneNote(buf); }).catch(')
      $touched = $true
      Say '[3/6] QQ：兜底记账已写入'
    } else { $problems += 'QQ 兜底锚点缺失' }
  }

  if (-not $q.Contains('toneGate(p.text)')) {
    $anchor = 'return await this.sendTo(p.address, p.text, p.replyMessageId);'
    $lines = @(
      '        // 补发草稿同样走闸门，免得绕开 qq_send 那个口子。'
      '        const toneBlocked = toneGate(p.text);'
      '        if (toneBlocked) {'
      '          this.pendingSends.delete(id);'
      '          return { text: toneBlocked.block, failed: true };'
      '        }'
      '        const receipt = await this.sendTo(p.address, p.text, p.replyMessageId);'
      '        toneNote(p.text);'
      '        return receipt;'
    )
    $next = Replace-Line $q $anchor $lines
    if ($next) { $q = $next; $touched = $true; Say '[3/6] QQ：补发闸门已写入' }
    else { $problems += 'QQ 补发锚点缺失' }
  }

  if ($touched) { Write-Text $qqWorld $q; $wrote = $true } else { Say '[3/6] QQ：已打过' }
}

# ================= 4. QQ 空间自动发帖（qzone.ts） =================
if (-not (Test-Path -LiteralPath $qqQzone)) {
  Say '[4/6] QQ空间自动帖：不存在，跳过'
} else {
  $z = Read-Text $qqQzone
  $touched = $false

  if (-not $z.Contains('tone-check.ts')) {
    $anchor = "import type { Logger } from 'cortico/core/types.ts';"
    $next = Insert-AfterLine $z $anchor $softBoth
    if ($next) { $z = $next; $touched = $true; Say '[4/6] 空间自动帖：软加载已写入' }
    else { $problems += 'qzone.ts import 锚点缺失' }
  }

  if (-not $z.Contains("toneGate(content, 'qzone_post')")) {
    $anchor = "    if (!content) return { ok: false, error: '动态内容为空' };"
    $lines = @(
      '    // 说话腔调闸门：自动生成的说说同样发在公开场合，拦下就这一轮不发。'
      '    const toneBlocked = toneGate(content, ''qzone_post'');'
      '    if (toneBlocked) {'
      "      this.log.warn('自动发说说被腔调检查拦下', { level: toneBlocked.level, hits: toneBlocked.hits });"
      '      return { ok: false, error: `腔调检查没通过（${toneBlocked.level}）：${toneBlocked.hits}` };'
      '    }'
    )
    $next = Insert-AfterLine $z $anchor $lines
    if ($next) { $z = $next; $touched = $true; Say '[4/6] 空间自动帖：闸门已写入' }
    else { $problems += 'qzone.ts 发帖锚点缺失' }
  }

  if (-not $z.Contains('toneNote(body')) {
    $at = $z.IndexOf("this.log.info('已发 QQ空间动态'")
    if ($at -ge 0) {
      $lineEnd = $z.IndexOf("`n", $at)
      $z = $z.Insert($lineEnd + 1, "      toneNote(body, 'qzone_post');`r`n")
      $touched = $true
      Say '[4/6] 空间自动帖：记账已写入'
    } else { $problems += 'qzone.ts 发帖记账锚点缺失' }
  }

  if (-not $z.Contains("toneGate(text, 'qzone_comment')")) {
    $anchor = "    if (!text) return { ok: false, error: '回复内容为空' };"
    $lines = @(
      '    // 评论回复同样是公开的，一样过闸门。'
      '    const toneBlocked = toneGate(text, ''qzone_comment'');'
      '    if (toneBlocked) {'
      "      this.log.warn('回复空间评论被腔调检查拦下', { level: toneBlocked.level, hits: toneBlocked.hits });"
      '      return { ok: false, error: `腔调检查没通过（${toneBlocked.level}）：${toneBlocked.hits}` };'
      '    }'
    )
    $next = Insert-AfterLine $z $anchor $lines
    if ($next) { $z = $next; $touched = $true; Say '[4/6] 空间评论：闸门已写入' }
    else { $problems += 'qzone.ts 评论锚点缺失' }
  }

  if (-not $z.Contains("toneNote(text, 'qzone_comment')")) {
    $at = $z.IndexOf("this.log.info('已回复 QQ空间评论'")
    if ($at -ge 0) {
      $lineEnd = $z.IndexOf("`n", $at)
      $z = $z.Insert($lineEnd + 1, "      toneNote(text, 'qzone_comment');`r`n")
      $touched = $true
      Say '[4/6] 空间评论：记账已写入'
    } else { $problems += 'qzone.ts 评论记账锚点缺失' }
  }

  if ($touched) { Write-Text $qqQzone $z; $wrote = $true } else { Say '[4/6] 空间自动帖：已打过' }
}

# ================= 5. B站评论 =================
if (-not (Test-Path -LiteralPath $biliWorld)) {
  Say '[5/6] B站：没装，跳过'
} else {
  $b = Read-Text $biliWorld
  $touched = $false

  if (-not $b.Contains('tone-check.ts')) {
    $anchor = "import { ScrollState, clockIn, todayIn } from './state.ts';"
    $next = Insert-AfterLine $b $anchor $softBoth
    if ($next) { $b = $next; $touched = $true; Say '[5/6] B站：软加载已写入' }
    else { $problems += 'B站 import 锚点缺失' }
  }

  if (-not $b.Contains("toneGate(message, 'bili_comment')")) {
    $anchor = '    const detail = await this.bili.detail(bvid, signal);'
    $lines = @(
      '    // 说话腔调闸门：评论是发在公开场合的，比 QQ 更不能带 AI 腔。'
      '    const toneBlocked = toneGate(message, ''bili_comment'');'
      '    if (toneBlocked) {'
      '      return {'
      '        text: ['
      '          `没有发出去（腔调检查没通过）：${toneBlocked.level}，密度 ${toneBlocked.density}`,'
      '          `命中：${toneBlocked.hits}`,'
      "          '把话改短、把那几处拆开，再调用一次 biliscroll_comment。别原样重发——原样重发还是会被挡。',"
      '          `草稿：${message}`,'
      "        ].join('\n'),"
      '        failed: true,'
      '      };'
      '    }'
    )
    $next = Insert-AfterLine $b $anchor $lines
    if ($next) { $b = $next; $touched = $true; Say '[5/6] B站：闸门已写入' }
    else { $problems += 'B站闸门锚点缺失' }
  }

  if (-not $b.Contains("toneNote(message, 'bili_comment')")) {
    $at = $b.IndexOf('    const result = await this.bili.sendComment({')
    if ($at -ge 0) {
      $endAt = $b.IndexOf('    });', $at)
      if ($endAt -ge 0) {
        $lineEnd = $b.IndexOf("`n", $endAt)
        $b = $b.Insert($lineEnd + 1, "    toneNote(message, 'bili_comment');`r`n")
        $touched = $true
        Say '[5/6] B站：记账已写入'
      } else { $problems += 'B站记账锚点缺失' }
    } else { $problems += 'B站记账锚点缺失' }
  }

  if ($touched) { Write-Text $biliWorld $b; $wrote = $true } else { Say '[5/6] B站：已打过' }
}

# ================= 6. QQ 空间扩展（qzone-alont1） =================
if (-not (Test-Path -LiteralPath $qzWorld)) {
  Say '[6/6] 空间扩展：没装，跳过'
} else {
  $v = Read-Text $qzWorld
  $touched = $false

  if (-not $v.Contains('tone-check.ts')) {
    $anchor = "import { nowIso } from 'cortico/core/util.ts';"
    $next = Insert-AfterLine $v $anchor $softBoth
    if ($next) { $v = $next; $touched = $true; Say '[6/6] 空间扩展：软加载已写入' }
    else { $problems += 'qzone-alont1 import 锚点缺失' }
  }

  if (-not $v.Contains("toneGate(content, 'qzone_post')")) {
    $anchor = '        const withImage = typeof args.with_image === ''boolean'' ? args.with_image : undefined;'
    $lines = @(
      '        // 说话腔调闸门：说说发出去是公开的，比 QQ 消息更不能带 AI 腔。'
      '        const toneBlocked = toneGate(content, ''qzone_post'');'
      '        if (toneBlocked) {'
      '          return {'
      '            text: ['
      '              `没有发出去（腔调检查没通过）：${toneBlocked.level}，密度 ${toneBlocked.density}`,'
      '              `命中：${toneBlocked.hits}`,'
      "              '把话改短、把那几处拆开，再调用一次 qzone_post。别原样重发——原样重发还是会被挡。',"
      '              `草稿：${content}`,'
      "            ].join('\n'),"
      '            failed: true,'
      '          };'
      '        }'
    )
    $next = Insert-AfterLine $v $anchor $lines
    if ($next) { $v = $next; $touched = $true; Say '[6/6] 空间扩展：闸门已写入' }
    else { $problems += 'qzone-alont1 闸门锚点缺失' }
  }

  if (-not $v.Contains("toneNote(content, 'qzone_post')")) {
    $anchor = '        return this.publish(content, withImage === undefined ? {} : { withImage });'
    $lines = @(
      '        const receipt = await this.publish(content, withImage === undefined ? {} : { withImage });'
      '        toneNote(content, ''qzone_post'');'
      '        return receipt;'
    )
    $next = Replace-Line $v $anchor $lines
    if ($next) { $v = $next; $touched = $true; Say '[6/6] 空间扩展：记账已写入' }
    else { $problems += 'qzone-alont1 记账锚点缺失' }
  }

  if ($touched) { Write-Text $qzWorld $v; $wrote = $true } else { Say '[6/6] 空间扩展：已打过' }
}

# ================= 汇总 =================
Note ('补完。写入={0} 问题={1}' -f $wrote, $(if ($problems.Count) { $problems -join '; ' } else { '无' }))

if ($problems.Count) {
  Say ''
  Say '以下锚点没找到（对应版本可能变了，需要人工看）：' -ForegroundColor Yellow
  foreach ($p in $problems) { Say "  - $p" -ForegroundColor Yellow }
}

# ---------- 可选：重启 ----------
$restarted = $false
if ($Restart -and $wrote) {
  $procs = @(Get-Process Coopanion -ErrorAction SilentlyContinue)
  if ($procs.Count -gt 0) {
    Say '补丁要重启才生效，10 秒后重启 Coopanion…'
    Start-Sleep -Seconds 10
    $procs = @(Get-Process Coopanion -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
      try {
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        Start-Process -FilePath (Join-Path $root 'Coopanion.exe') -WorkingDirectory $root
        $restarted = $true
        Say 'Coopanion 已重启。'
      } catch { Say ('自动重启失败，请手动开一次: ' + $_.Exception.Message) }
    }
  }
}

Say ''
if ($restarted) { Say '完成：已恢复并重启。' -ForegroundColor Green }
elseif ($wrote) { Say '完成：已恢复。重启 Coopanion 后生效。' -ForegroundColor Green }
else { Say '补丁完好，无需处理。' -ForegroundColor Green }
