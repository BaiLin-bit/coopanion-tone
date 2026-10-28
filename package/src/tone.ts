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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
