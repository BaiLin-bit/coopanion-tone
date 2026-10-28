# coopanion-tone

给 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 加一道**说话腔调检查**：她要说的话先过一遍规则，太像 AI 就拦下来让她重写，同时把「被拦的」和「真发出去的」记在 WebUI 面板上。

起因很具体：模型会写「值得注意的是」「这个设定挺狠的——三个兑换码连起来像一句话」，一句两句看不出来，连着读就像客服机器人。

## 这个项目**不改任何人的代码**

Coopanion 没有「发送前钩子」这种扩展点，World 只能声明工具、提示词、面板、配置和事件。而事件流是**发送之后**才记录的（QQ 世界甚至根本不写出站事件），所以扩展自己看不到「即将发出的话」。

于是这里的做法是：

```
deai 扩展启动时，起一个只监听回环的小服务
        ↓
谁想让自己的发言被拦，就在发送前问一句
        ↓
deai 回「放行」还是「拦下」，顺手记账 → 面板显示
```

**装扩展不会改动你任何一个文件。** 想让它真的拦住，得你自己（或者你的 AI）去改对应的 World——扩展面板里给了现成的代码片段和一段可以直接粘给 AI 的提示词。

## 目录

```
package/           Coopanion 扩展（World id: deai）
  src/deai.ts        规则表（34 条正则 + 评分）
  src/tone.ts        日志读写
  src/server.ts      本地检查服务
  dist/webui.js      面板：腔调记录 + 接入指南
docs/接入指南.md     各处怎么接、给 AI 的提示词
examples/patcher/   旧的「直接打补丁」参考实现（可选，见文末）
```

## 安装扩展

把 `package/` 放到：

```
<Coopanion 数据目录>\extensions\node_modules\cortico-world-deai
```

在 `config.json` 里打开：

```json
{ "worlds": { "deai": { "enabled": true } } }
```

重启 Coopanion。然后在 WebUI 的 World 列表里进「去 AI 味」，会看到：

- **腔调记录**：最近 15 条（没接入时是空的）
- **检查服务**：运行中 / 未启动，以及端口
- **「想让它真的拦住？」**：代码片段 + 复制给 AI 的提示词

## 检查服务

默认端口 `18770`（环境变量 `COOPANION_TONE_PORT` 可改），只绑 `127.0.0.1`。

```
POST /check   { text, where }  →  { level, density, hits, block }
POST /note    { text, where }  →  { ok }
GET  /health  →  { ok, service, version }
```

`block` 非 null 就别发。完整接法和示例见 [docs/接入指南.md](docs/接入指南.md)。

## 规则

纯文本匹配，不联网、不调模型。五类症状：小作文、升华、讨好、翻译腔、AI 惯用词与句式，另外还有：

- 破折号后面兜一句
- 「不是 A，是 B」对举
- 三项等长排比（`A、B、C` 每项一样长）
- 「比…还…」比较级
- 「太狠了 / 全是刀 / 破防了」这类夸张收尾
- 一条消息过长（实测这台机器上 QQ 消息中位 67 字，超 60 开始扣分）

判「中」以上才拦，「轻」只提醒。改规则改 `package/src/deai.ts`。

## 风险

1. **接入要改文件，升级会覆盖。** 改之前备份，记下改了哪几行。
2. **不接入就没有数据**，也不会拦任何话——这是设计，不是 bug。
3. 面板只留最近 15 条，是滚动缓存，不是档案。
4. 服务只监听 `127.0.0.1`，不对外。但同一台机器上的其他程序能访问它。

## 关于 examples/patcher

`examples/patcher/` 是早期方案的**参考实现**：直接往 Coopanion 安装目录和几个 World 的源码里插代码，做到「发送前拦截」。

它**不属于本扩展，也不属于 Coopanion 插件市场**——市场明确拉黑「改写程序文件」的包（已有三个先例）。它的价值是给你参考「接入大概长什么样」；真要接，建议用 `docs/接入指南.md` 里的方式自己改，或者干脆用面板里那段提示词让 AI 改。

## 兼容

| Coopanion | 状态 |
|---|---|
| 0.2.12 | 已验证 |
| 0.2.13 | 已验证 |

## 许可

AGPL-3.0-or-later。详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
