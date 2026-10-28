# cortico-world-deai（去 AI 味）

一个**不连平台、不管事件**的 Coopanion World：挂上之后只在三处起作用。

1. **环境提示词**：`src/ENV_PROMPT.md` 进系统前缀，告诉它「话说完会被体检」「被拦了怎么改」。
2. **工具 `deai_check`**：把一段文本丢进去，返回命中清单（小作文 / 升华 / 讨好 / 翻译腔 / AI 词句式）与改法；`mode: "rewrite"` 再给一版规则替换后的文本。
3. **面板「腔调记录」**：读 `tone-log.json`，显示最近 15 条——哪些被拦下、哪些真发出去了。数据由 `patcher/` 那边写进来（没打补丁时只显示空列表）。

规则移植自 deai-flavor 的分级思路（硬伤 3 分、句式 2 分、抽象词 1 分，按每百字归一），词表与句式按中文口语重写。

## 安装

把本目录放到：

```
<Coopanion 数据目录>\extensions\node_modules\cortico-world-deai
```

`config.json` 里打开：

```json
{ "worlds": { "deai": { "enabled": true } } }
```

然后重启 Coopanion。

有的 pnpm 布局需要把它链接进 `node_modules`，命令按实际路径写：

```
cmd /c mklink /J "<...>\extensions\node_modules\cortico-world-deai" "<...>\extensions\cortico-world-deai"
```

## 改规则

- 说话规则：`src/ENV_PROMPT.md`，下一轮前缀重建就生效（也能在 WebUI 的 World 页里编辑）。
- 词表与句式：`src/deai.ts` 的 `HARD_WORDS` / `SOFT_WORDS` / `PATTERNS`，重启进程生效。
- 闸门阈值与日志路径：`src/tone.ts`。注意 `patcher/coopanion-tone-check.ts.src` 里有一份同源实现，改这里要一起改。

## 日志路径

按下面顺序取第一个可用的：

1. 环境变量 `COOPANION_TONE_LOG`
2. `<用户目录>/Coopanion/data/home/companion/data/tone-log.json`

只留最近 15 条，满了从最老的丢。
