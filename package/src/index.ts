// 去 AI 味：一个只提供「自检工具 + 环境提示词」的 World。
// 不连接任何平台、不推事件，挂上就生效：前缀里多一段说话规则，工具表里多一个 deai_check。
// @ts-nocheck
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from './deai.ts';
import { readToneLog } from './tone.ts';
import { startToneService, type ToneService } from './server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PROMPT_PATH = join(here, 'ENV_PROMPT.md');

const CHECK_TOOL = {
  name: 'deai_check',
  description:
    '自查一段即将发出去的文本有没有 AI 味：句子太整齐像小作文、爱总结升华、太客气讨好、翻译腔、AI 惯用词与句式。'
    + '这是你自己的工具，报告只给你自己看，不要原样发出去，也不要向对方提这个工具。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        description: '准备发出去的那一版原文，整段贴进来（不要贴只有三五个字的短句，那不需要查）',
      },
      mode: {
        type: 'string',
        enum: ['check', 'rewrite'],
        description: 'check=只报告（默认）；rewrite=顺带给一版规则替换后的文本',
      },
    },
    required: ['text'],
  },
  tags: ['read'],
  barrierAfter: true,
  handler: async (args) => {
    const text = typeof args?.text === 'string' ? args.text : '';
    if (!text.trim()) return { text: '空文本，没什么可查的。', failed: true };
    const mode = args?.mode === 'rewrite' ? 'rewrite' : 'check';
    return report(text, mode);
  },
};

class DeaiWorld {
  readonly id = 'deai';
  /** 本地检查服务；端口被占时为 null，不影响扩展本身。 */
  private service: ToneService | null = null;

  /** 模板没有变量，返回空对象表示「保留模板全文」。 */
  envPromptVars() {
    return {};
  }

  tools() {
    return [CHECK_TOOL];
  }

  async start() {
    this.service = await startToneService();
  }

  async stop() {
    await this.service?.stop();
    this.service = null;
  }

  webUi() {
    return {
      label: '去 AI 味',
      panels: [
        {
          id: 'tone-log',
          title: '腔调记录',
          description: '最近 15 条：被拦下的话，和真发出去的话。',
          getMethods: ['list'],
        },
      ],
      invoke: async (panel: string, method: string) => {
        if (panel !== 'tone-log') throw new Error(`未知面板: ${panel}`);
        if (method === 'list') {
          return {
            items: readToneLog(),
            service: this.service ? { port: this.service.port, url: `http://127.0.0.1:${this.service.port}` } : null,
          };
        }
        throw new Error(`未知方法: ${method}`);
      },
      promptDocs: [
        {
          key: 'worlds.deai.envPrompt',
          title: '去 AI 味规则',
          description: '发言前的自查流程，以及五类症状分别怎么改。改完下一轮前缀就重建。',
          path: ENV_PROMPT_PATH,
          role: 'envPrompt',
          vars: [],
        },
      ],
    };
  }
}

export default {
  id: 'deai',
  label: '去 AI 味',
  defaults: () => ({ enabled: false }),
  create: () => new DeaiWorld(),
};
