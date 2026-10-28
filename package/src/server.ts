/**
 * deai 的本地检查服务。
 *
 * 为什么需要它：Coopanion 没有「发送前钩子」，World 读事件流又只能看到**发送之后**的记录
 * （而且 QQ 世界根本不写出站事件）。所以想拦住一句话，唯一干净的办法是：
 *
 *   deai 起一个只绑回环的小 HTTP 服务
 *   → 别的 World 想接入，就在自己发送前问一句
 *   → deai 回「放行」还是「拦下」，顺手记账给面板
 *
 * 这样 deai 不碰任何人的代码，愿意接的自己去接。
 *
 * 接口（只监听 127.0.0.1）：
 *   POST /check   { text, where? }  → { ok, level, density, hits, block|null }
 *   POST /note    { text, where? }  → { ok: true }          记账（已确定发出去）
 *   GET  /health                    → { ok, service, version }
 *
 * 端口：环境变量 COOPANION_TONE_PORT，默认 18770。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { analyze } from './deai.ts';
import { appendToneLog } from './tone.ts';

export const TONE_SERVICE_VERSION = 1;
export const DEFAULT_PORT = 18770;

export interface CheckResult {
  ok: true;
  level: string;
  density: number;
  hits: string;
  /** 非 null 时表示应当拦下，值就是可以原样返回给模型的文案 */
  block: string | null;
}

const MAX_BODY = 64 * 1024;

/** 只绑回环，且校验 Host 是 loopback —— 防止网页通过 DNS rebinding 摸进来。 */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** 检查一段文本。判「中」以上给出 block 文案，顺带记一条「被拦下」。 */
export function checkText(text: unknown, where: unknown): CheckResult {
  const body = String(text ?? '');
  const from = typeof where === 'string' && where ? where : 'http';
  const r = analyze(body);
  if (r.level !== '中' && r.level !== '重') {
    appendToneLog({ ok: true, text: body, level: r.level, density: r.density, hits: '', where: from });
    return { ok: true, level: r.level, density: r.density, hits: '', block: null };
  }
  const top = [...r.findings].sort((a, b) => b.weight - a.weight).slice(0, 4);
  const hits = top.map((f) => f.hit).join('、');
  const advice = top[0]?.advice ?? '';
  appendToneLog({ ok: false, text: body, level: r.level, density: r.density, hits, where: from });
  const block = [
    `[没发出去] 这条腔调不对（${r.level}，密度 ${r.density}）：${hits}`,
    advice ? `改法：${advice}` : '',
    '把话改短、把那几处拆开，再调用一次。别原样重发——原样重发还是会被挡。',
  ].filter(Boolean).join('\n');
  return { ok: true, level: r.level, density: r.density, hits, block };
}

export interface ToneService {
  port: number;
  stop(): Promise<void>;
}

export async function startToneService(port = Number(process.env.COOPANION_TONE_PORT) || DEFAULT_PORT): Promise<ToneService | null> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      if (!LOOPBACK.test(req.headers.host ?? '')) {
        res.writeHead(421, { connection: 'close' });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, service: 'coopanion-tone', version: TONE_SERVICE_VERSION });
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/check' || url.pathname === '/note')) {
        readBody(req)
          .then((raw) => {
            let body: Record<string, unknown> = {};
            try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { json(res, 400, { ok: false, error: 'body 不是合法 JSON' }); return; }
            if (url.pathname === '/check') {
              json(res, 200, checkText(body.text, body.where));
            } else {
              const text = String(body.text ?? '');
              appendToneLog({ ok: true, text, level: '通过', density: 0, hits: '', where: typeof body.where === 'string' && body.where ? body.where : 'http' });
              json(res, 200, { ok: true });
            }
          })
          .catch((e) => json(res, 400, { ok: false, error: String(e) }));
        return;
      }

      json(res, 404, { ok: false, error: `没有这个接口: ${req.method} ${url.pathname}` });
    });

    server.on('error', () => resolve(null));   // 端口被占：不阻断扩展启动
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        stop: () => new Promise<void>((done) => { server.close(() => done()); }),
      });
    });
  });
}
