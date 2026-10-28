/**
 * 「去 AI 味」的腔调记录面板（Cortico WebUI bundle）。
 *
 * 纯 DOM + ctx.invoke，不打包：dist/webui.js 就是源码本身，Coopanion 升级也不会
 * 因为产物过期而错乱。class 一律带 ctl- 前缀，免得撞上宿主样式。
 *
 * 数据来自 `ctx.invoke('list', [])`：服务端读 tone-log.json（最近 15 条），
 * 并告诉面板本地检查服务跑在哪个端口。
 *
 * 面板除了记录，还负责**告诉用户怎么接**：deai 自己不改任何人的代码，
 * 想让它拦住发言，得由用户（或他的 AI）去改对应的 World。所以这里放了
 * 一段可以直接复制给 AI 的话。
 */

const PANELS = { 'tone-log': { mount: mountToneLog } };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** 复制文本；老浏览器没有 clipboard API 就退化成选中。 */
function copyText(text, ui) {
  const done = () => { try { ui?.toast?.('已复制'); } catch { /* 没有 toast 就算了 */ } };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else {
    fallback();
  }
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { /* 复制不了就留给人手动选 */ }
    ta.remove();
  }
}

function mountToneLog(ctx) {
  const { root, ui } = ctx;

  // 声明必须在使用之前：下面的接入指南文案会立即读 currentPort。
  let currentPort = null;
  let stopped = false;

  const wrap = el('div', 'ctl-wrap');

  const head = el('div', 'ctl-head');
  head.append(el('span', 'ctl-title', '腔调记录'), el('span', 'ctl-sub', '最近 15 条'));

  const serviceLine = el('div', 'ctl-service', '检查服务：读取中…');

  const note = el('p', 'ctl-note', '「拦下」= 没发出去，模型被要求重写；「发出」= 真到了外面的原话。');
  const list = el('div', 'ctl-list');
  const empty = el('div', 'ctl-empty', '还没有记录。接上之后，她说的话会出现在这里。');

  // ---- 接入指南 ----
  const guide = el('details', 'ctl-guide');
  const summary = el('summary', 'ctl-guide-title', '想让它真的拦住？点这里看怎么接');
  const guideBody = el('div', 'ctl-guide-body');

  const intro = el('p', 'ctl-guide-p', '这个扩展不改任何人的代码。想让它拦住某处的发言，需要在那个 World 发送前调一下下面的检查服务——你自己改，或者复制提示词让 AI 改。');

  const snippetTitle = el('p', 'ctl-guide-p', '示例：QQ（包 cortico-world-qq-final-beta，world id qqbot，工具 qq_send）。别的世界变量名、返回结构、是否 async 都不一样，按实际改。');

  const snippet = [
    '// 示例：QQ 的 qq_send（cortico-world-qq-final-beta / qqbot）',
    'const r = await fetch(`http://127.0.0.1:<端口>/check`, {',
    "  method: 'POST',",
    "  headers: { 'content-type': 'application/json' },",
    "  body: JSON.stringify({ text, where: 'qq_send' }),",
    '}).then((x) => x.json());',
    'if (r.block) return { text: r.block, failed: true };   // 拦下：这句话没发出去',
    '// block 为 null 就照常发',
  ].join('\n');
  const pre = el('pre', 'ctl-code', snippet);
  const copyBtn = el('button', 'ctl-btn', '复制这段示例');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', () => copyText(snippet.replace('<端口>', String(currentPort || '18770')), ui));

  const idNote = el('p', 'ctl-guide-p', '四个世界的包名 / world id / 工具名 / 文件位置，见仓库里的 docs/接入指南.md。别搞混：cortico-world-qq（id qq，工具 qq.send）和 cortico-world-qq-final-beta（id qqbot，工具 qq_send）是两个不同的包。');

  const promptText = [
    '帮我改一下这个 Coopanion 安装里的发言出口，让它在发送前先问一下本地的腔调检查服务。',
    '',
    '服务地址：http://127.0.0.1/' + (currentPort || '18770') + '/check',
    '方法：POST，Content-Type: application/json',
    '请求体：{"text": "<要发出去的正文>", "where": "<来源名，比如 qq_send>"}',
    '返回：{"ok":true,"level":"通过|轻|中|重","density":数字,"hits":"命中的毛病","block":null 或 "拦截文案"}',
    '',
    '要求：',
    '1. 调用前先把原文原样传进去（不要先截断、不要先清洗）。',
    '2. 如果返回的 block 不是 null，就不要发送，把 block 原样作为工具结果返回（并标记失败），让模型重写。',
    '3. 如果 block 是 null，照常发送，不要改动原有逻辑。',
    '4. 只改发送那一处，别动别的功能。',
    '5. 改之前先备份文件；改完告诉我：改了哪个文件、哪一行、怎么回滚。',
    '6. 如果找不到发送的那处，或者文件结构和描述对不上，就停下来问我，不要乱猜。',
  ].join('\n');
  const promptPre = el('pre', 'ctl-code', promptText);
  const copyPromptBtn = el('button', 'ctl-btn', '复制给 AI 的提示词');
  copyPromptBtn.type = 'button';
  copyPromptBtn.addEventListener('click', () => copyText(promptText, ui));

  const warn = el('p', 'ctl-guide-p ctl-warn', '注意：改的是 Coopanion 安装目录里的文件，升级会被覆盖。改之前务必备份，改完记下改了哪里。');

  guideBody.append(intro, snippetTitle, pre, copyBtn, idNote, promptPre, copyPromptBtn, warn);
  guide.append(summary, guideBody);

  wrap.append(head, serviceLine, note, list, empty, guide);
  root.appendChild(wrap);

  // stopped / currentPort 已在函数开头声明

  function renderService(service) {
    currentPort = service?.port ?? null;
    if (service?.port) {
      serviceLine.textContent = '检查服务：运行中 → http://127.0.0.1:' + service.port + '/check';
      serviceLine.className = 'ctl-service ctl-service-on';
    } else {
      serviceLine.textContent = '检查服务：未启动（端口被占用或扩展未加载）——接入会失败，先看 Coopanion 日志。';
      serviceLine.className = 'ctl-service ctl-service-off';
    }
  }

  function render(items) {
    list.replaceChildren();
    if (!items || !items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    for (const it of items) {
      const row = el('div', 'ctl-row ' + (it.ok ? 'ctl-ok' : 'ctl-block'));
      const line = el('div', 'ctl-line');
      line.append(el('span', 'ctl-tag', it.ok ? '发出' : '拦下'));
      if (it.where) line.append(el('span', 'ctl-where', it.where));
      if (it.time) line.append(el('span', 'ctl-time', it.time));
      if (!it.ok && it.level) line.append(el('span', 'ctl-level', it.level + (it.density != null ? ' · 密度 ' + it.density : '')));
      row.append(line);
      row.append(el('div', 'ctl-text', it.text || ''));
      if (it.hits) row.append(el('div', 'ctl-hits', it.hits));
      list.append(row);
    }
  }

  async function refresh() {
    if (stopped) return;
    try {
      const data = await ctx.invoke('list', []);
      render(data && data.items ? data.items : []);
      renderService(data && data.service ? data.service : null);
    } catch {
      // 拿不到就等下一轮，别在页面上吵闹
    }
  }

  refresh();
  if (ctx.lifecycle && typeof ctx.lifecycle.interval === 'function') {
    ctx.lifecycle.interval(refresh, 3000);
  } else {
    const timer = setInterval(refresh, 3000);
    const stop = () => { stopped = true; clearInterval(timer); };
    if (ctx.signal && typeof ctx.signal.addEventListener === 'function') {
      ctx.signal.addEventListener('abort', stop, { once: true });
    } else {
      window.addEventListener('beforeunload', stop, { once: true });
    }
  }
}

export default { panels: PANELS };
