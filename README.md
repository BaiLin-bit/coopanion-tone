# coopanion-tone

给 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 加一道**说话腔调检查**：她发出去的话先过一遍规则，太像 AI 就拦下来让她重写，同时把「被拦的」和「真发出去的」记在 WebUI 面板上。

起因很简单：模型会写「值得注意的是」「这个设定挺狠的——三个兑换码连起来像一句话」，这些句子一句两句看不出来，连着读就像客服机器人。

## 它由两部分组成

| 目录 | 是什么 | 能不能独立装 |
|---|---|---|
| `package/` | 一个 Coopanion 扩展（World id `deai`）：规则表 + `deai_check` 工具 + 腔调记录面板 | ✅ 能 |
| `patcher/` | 给**别的**扩展装钩子的工具（QQ / B站 / QQ空间 / 桌宠） | ❌ 是补丁，不是扩展 |

为什么必须分开：QQ、B站、空间、桌宠都是别人发布的世界，它们的 world id 是全局唯一的（`qqbot`、`bili-scroll`…）。如果把它们改过的版本打包发出去，会和市场上已有的包**撞 id**，只能加载一个。所以那部分只能是补丁，不能是扩展。

## 安装

### 1. 扩展（面板 + 自查工具）

把 `package/` 整个目录放到：

```
<Coopanion 数据目录>\extensions\node_modules\cortico-world-deai
```

再在 `config.json` 里打开：

```json
{ "worlds": { "deai": { "enabled": true } } }
```

### 2. 补丁（让别的世界也过检查）

```powershell
# 先备份（脚本会改别人的源码，出问题好回滚）
Copy-Item <Coopanion>\resources\app\node_modules\cortico-world-desktop-pet\src\world.ts "world.ts.bak"

# 打补丁（幂等：已经打过的会跳过，不会重复写入）
powershell -ExecutionPolicy Bypass -File .\patcher\coopanion-tone-patch.ps1

# 补完顺手重启
powershell -ExecutionPolicy Bypass -File .\patcher\coopanion-tone-patch.ps1 -Restart
```

装到别处就加 `-Root "D:\Coopanion"`；没给就用 `%LOCALAPPDATA%\Coopanion\data-location.json` 自动找。

打完**必须重启 Coopanion**（扩展和老代码都在进程里缓存着）。

### 3. 无人值守（可选）

想让升级后自动恢复，注册一个计划任务：

```powershell
$vbs = "<路径>\patcher\coopanion-tone-patch-hidden.vbs"
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`"" -WorkingDirectory (Split-Path $vbs)
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15))
)
Register-ScheduledTask -TaskName 'CoopanionTonePatch' -Action $action -Trigger $triggers -Settings (New-ScheduledTaskSettingsSet -Hidden) -Force
```

用 `wscript` 而不是直接跑 `powershell.exe`，是为了**不弹窗口**（wscript 是 GUI 程序，不开控制台）。

## 补了哪些地方

| 出口 | 拦 | 记 |
|---|---|---|
| `qq_send`（QQ 发消息） | ✅ | ✅ |
| 兜底自动发送（模型只写文字没调工具） | ❌ 只记 | ✅ |
| `qq_confirm_send`（补发草稿） | ✅ | ✅ |
| 主动私聊（她主动找你） | ✅ | ✅ |
| `pet_say`（桌宠气泡） | ❌ 只记 | ✅ |
| `biliscroll_comment`（B站评论） | ✅ | ✅ |
| `qzone_post`（发说说，含自动发） | ✅ | ✅ |
| 自动回复空间评论 | ✅ | ✅ |

不拦的那两个：兜底发生在回合结束后，模型没机会重写，拦了就是「已读不回」；桌宠气泡有 TTS 和动画，硬拦会卡住。

## 判定规则

规则是纯文本匹配，不联网、不调模型。五类症状：小作文、升华、讨好、翻译腔、AI 惯用词与句式，外加：

- 破折号后面兜一句
- 「不是 A，是 B」对举
- 三项等长排比（`A、B、C` 每项一样长）
- 「比…还…」比较级
- 「太狠了 / 全是刀 / 破防了」这类夸张收尾
- 一条消息过长（按实测水核：中位 67 字，超 60 字开始扣分）

判「中」以上才拦；「轻」只提醒。改规则看 `package/src/deai.ts`，改档门阈值看 `package/src/tone.ts` 和 `patcher/coopanion-tone-check.ts.src`（两处要一起改）。

## 风险，先说清楚

1. **补丁会被升级冲掉**。Coopanion 升级整包替换 `resources\app`，框架里的体检模块和桌宠补丁会丢。所以才有那个计划任务。
2. **靠锚点匹配代码**。上游改一行，锚点就找不到。脚本会**明确报错并跳过，不会乱改**，但你需要等脚本更新。
3. **软加载**：所有注入都写了 try/catch，拿不到体检模块就退化成「不检查」，**不会让 QQ 世界起不来**。
4. 面板数据只留最近 15 条，是滚动缓存，不是档案。

## 卸载

```powershell
# 删补丁：把这几处的 toneNote/toneGate 调用去掉，或者直接让 Coopanion 升级一次（resources\app 会被还原）
# 删扩展：删掉 extensions\node_modules\cortico-world-deai，并把 config.json 里 worlds.deai.enabled 设 false
```

## 兼容

| Coopanion | 状态 |
|---|---|
| 0.2.12 | 已验证 |
| 0.2.13 | 已验证 |

## 许可

AGPL-3.0-or-later。详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

这个项目修改了 AGPL 上游的代码，所以整体必须按 AGPL 发布。
