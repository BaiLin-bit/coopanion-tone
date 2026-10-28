/**
 * 「去 AI 味」的腔调记录面板（Cortico WebUI bundle）。
 *
 * 纯 DOM + ctx.invoke，不打包：dist/webui.js 就是源码本身，Coopanion 升级也不会
 * 因为产物过期而错乱。class 一律带 ctl- 前缀，免得撞上宿主样式。
 *
 * 数据来自 `ctx.invoke('list', [])`，服务端读 tone-log.json：
 * 每次发送/拦截写一条，只留最近 15 条。
 */

const PANELS = { 'tone-log': { mount: mountToneLog } };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function mountToneLog(ctx) {
  const { root } = ctx;

  const wrap = el('div', 'ctl-wrap');
  const head = el('div', 'ctl-head');
  head.append(el('span', 'ctl-title', '腔调记录'), el('span', 'ctl-sub', '最近 15 条'));
  const note = el('p', 'ctl-note', '「拦下」= 没发出去，模型被要求重写；「发出」= 真到了 QQ 上的原话。');
  const list = el('div', 'ctl-list');
  const empty = el('div', 'ctl-empty', '还没有记录。说几句话就会有了。');
  wrap.append(head, note, list, empty);
  root.appendChild(wrap);

  let stopped = false;

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
