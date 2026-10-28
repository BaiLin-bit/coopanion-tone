/**
 * 体检模块（deai 自带版）。
 *
 * 和框架里那份 `cortico/core/tone-check.ts` 用同一套路径约定，但**自包含**：
 * 不 import 任何 `cortico/` 运行时模块，所以 deai 可以独立安装，Coopanion 升级也不影响它。
 *
 * 为什么只读不写：记录是 QQ / B站 / 空间那几处「发送前」写进来的（它们调框架里那份），
 * deai 只负责把同一个文件读出来给面板看。两边必须算到同一个路径——
 * 所以路径规则在这里和框架里各写一遍，改的时候要一起改。
 *
 * 路径优先级：
 *   1. 环境变量 COOPANION_TONE_LOG（想挪位置就设它）
 *   2. <用户目录>/Coopanion/data/home/companion/data/tone-log.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface ToneLogEntry {
  /** 本地时间，形如 2026-10-28 22:50:03 */
  time: string;
  /** true = 真发出去了；false = 被闸门拦下 */
  ok: boolean;
  /** 原话（拦下的是被挡那版，发出的是实际发的那版） */
  text: string;
  level: string;
  density: number;
  hits: string;
  /** 从哪儿发的：qq_send / pet_say / bili_comment / qzone_post / qq_proactive */
  where: string;
}

/** 和框架那份必须一致。 */
export function toneLogPath(): string {
  return process.env.COOPANION_TONE_LOG
    || join(homedir(), 'Coopanion', 'data', 'home', 'companion', 'data', 'tone-log.json');
}

/** 面板读用：最新的在前。文件不在或坏了就当空。 */
export function readToneLog(): ToneLogEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(toneLogPath(), 'utf8')) as { items?: ToneLogEntry[] };
    return Array.isArray(parsed.items) ? parsed.items.slice().reverse() : [];
  } catch {
    return [];
  }
}

/** 服务地址的发现文件；接入方读它，而不是猜端口。 */
export function serviceInfoPath(): string {
  return process.env.COOPANION_TONE_SERVICE_FILE
    || join(homedir(), 'Coopanion', 'data', 'home', 'companion', 'data', 'tone-service.json');
}

export interface ToneServiceInfo {
  url: string;
  port: number;
  service: string;
  version: number;
  since: string;
}

/** 读服务地址；文件不在（服务没起）时返回 null。 */
export function readServiceInfo(): ToneServiceInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(serviceInfoPath(), 'utf8')) as ToneServiceInfo;
    return parsed && typeof parsed.url === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** 只留最近这么多条，多了从最老的丢。 */
export const TONE_LOG_MAX = 15;

function nowText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 记一条。写不进去就算了，绝不影响调用方。 */
export function appendToneLog(entry: Omit<ToneLogEntry, 'time'>): void {
  try {
    const path = toneLogPath();
    let items: ToneLogEntry[] = [];
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { items?: ToneLogEntry[] };
      if (Array.isArray(parsed.items)) items = parsed.items;
    } catch { /* 文件不在或坏了，从头来 */ }
    items.push({ time: nowText(), ...entry });
    while (items.length > TONE_LOG_MAX) items.shift();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ items }, null, 2), 'utf8');
  } catch {
    // 记录失败不影响说话
  }
}
