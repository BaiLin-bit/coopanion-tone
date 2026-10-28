// 去 AI 味自检：纯文本规则，不读文件、不联网、不调用模型。
// 五类症状：小作文（句子太整齐）、升华（爱总结爱拔高）、讨好（太客气有求必应）、
// 翻译腔、AI 惯用词与句式。
// 分级思路借鉴 deai-flavor：硬伤按 3 计、句式按 2 计、抽象词按 1 计，密度按每百字归一。
// @ts-nocheck

export type Category = '小作文' | '升华' | '讨好' | '翻译腔' | 'AI 词句式';

export interface Finding {
  category: Category;
  /** 命中的原文片段 */
  hit: string;
  /** 一句话改法 */
  advice: string;
  /** 有值表示可规则替换；空串表示整段删掉 */
  replace?: string;
  /** 计权：3 硬伤 / 2 句式与节奏 / 1 抽象词 */
  weight: number;
}

const MAX_CHARS = 12000;

/** 硬伤词：见到就该动。右边是可替换的说法，空串表示直接删。 */
const HARD_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['值得注意的是', '对了'],
  ['值得一提的是', '对了'],
  ['需要注意的是', '提醒一句'],
  ['需要指出的是', ''],
  ['综上所述', '就这么着'],
  ['总而言之', '反正'],
  ['总的来说', '反正'],
  ['一言以蔽之', ''],
  ['不难看出', '看得出来'],
  ['众所周知', ''],
  ['希望对你有所帮助', ''],
  ['希望对你有帮助', ''],
  ['让我们一起', ''],
  ['让我们', ''],
  ['在当今', ''],
  ['赋能', '帮上忙'],
  ['闭环', '一圈走完'],
  ['抓手', '下手的地方'],
  ['底层逻辑', '根上的道理'],
  ['颗粒度', '粗细'],
  ['方法论', '做法'],
  ['对齐', '对上'],
  ['为你提供', '给你'],
  ['助你', '帮你'],
  ['帮助你', '帮你'],
  ['不妨', '要不'],
  ['可以看到', '看得出来'],
  ['值得关注的是', '对了'],
  ['需要强调的是', '提醒一句'],
  ['简而言之', '反正'],
  ['一句话总结', ''],
  ['在这里我想', ''],
];

/** 只提示、不自动替换的抽象词。 */
const SOFT_WORDS: readonly string[] = [
  '此外', '因此', '然而', '由此可见', '再者', '与此同时', '换句话说', '本质上',
  '关键在于', '核心是', '某种程度上', '一定程度上', '从这个角度看',
  '生态', '链路', '心智', '范式', '维度', '协同', '沉淀', '势能', '纵深',
  '层面', '路径', '机制', '体系', '重塑', '演进', '加持', '助力', '穿透',
  '落地', '起势', '打透', '串联', '场景',
];

interface Pattern {
  re: RegExp;
  category: Category;
  advice: string;
  /** 计权，默认 2 */
  weight?: number;
}

/** 句式：命中就报，不做自动替换。 */
const PATTERNS: readonly Pattern[] = [
  { re: /不是[^。！？；\n]{0,20}?而是/, category: 'AI 词句式', advice: '「不是…而是」是对偶腔，拆成两句直说。' },
  { re: /不仅[^。！？；\n]{0,20}?(?:更|还|也)/, category: 'AI 词句式', advice: '「不仅…更是」是递进腔，说一件就够。' },
  { re: /不仅[^。！？；\n]{0,20}?而且/, category: 'AI 词句式', advice: '「不仅…而且」拆开，两句之间不用连词。' },
  { re: /无论[^。！？；\n]{0,20}?还是[^。！？；\n]{0,20}?[都也]/, category: 'AI 词句式', advice: '「无论…还是…都」是套话，直接说结论。' },
  { re: /既[^。！？；\n]{0,15}?又[^。！？；\n]{0,15}?/, category: 'AI 词句式', advice: '「既…又…」是并列腔，挑一个说。' },
  { re: /一方面[^。！？；\n]{0,30}?另一方面/, category: 'AI 词句式', advice: '「一方面…另一方面」像念稿，删掉连接词。' },
  { re: /首先[^。！？；\n]{0,40}?其次/, category: 'AI 词句式', advice: '「首先…其次」是分点腔，口语不用编号。' },
  { re: /(?:^|\n)[ \t]*首先[，、]/, category: 'AI 词句式', advice: '别用「首先」开头，直接说事。' },
  { re: /(?:正|即)因为[^。！？；\n]{0,20}?所以/, category: 'AI 词句式', advice: '因果关系不用连词，两句并排就成。' },
  { re: /进行(?:确认|处理|优化|调整|分析|沟通|了解|检查|安排|操作|测试|对比|评估)/, category: '翻译腔', advice: '「进行+动词」是翻译腔，直接把动词拿出来用。' },
  { re: /被[^。！？\n]{0,10}?所/, category: '翻译腔', advice: '「被…所…」是译文句式，改成主动。' },
  { re: /作为(?:一个|一名|一位|一种)/, category: '翻译腔', advice: '「作为一个…」多是废话，删掉。' },
  { re: /当[^。！？\n]{0,20}?的时候/, category: '翻译腔', advice: '「当…的时候」太长，「…时」或直接说。' },
  { re: /(?:使得|基于此|在这种情况下)/, category: '翻译腔', advice: '这是书面连接词，口语里没有。' },
  { re: /(?:你会发现|我们可以看到|我们不难发现|让我们来看看)/, category: '翻译腔', advice: '别对着人说「你会发现」，像讲课。' },
  { re: /一个(?:选择|过程|方向|机会|决定|理由|答案|问题|动作|声音)/, category: '翻译腔', advice: '「一个+抽象名词」是译文习惯，中文常不带量词。' },
  { re: /(?:随时(?:都)?可以找我|随时(?:跟我说|找我|喊我)|我(?:一直|都)?在(?:这里|这儿))/i, category: '讨好', advice: '「随时找我」是客服话，除非真在哄人，删掉。' },
  { re: /(?:我理解(?:你)?的感受|不用客气|别客气|辛苦了)/, category: '讨好', advice: '这句太客气了，像在应付。' },
  { re: /(?:如果|要是)(?:你)?(?:愿意|需要|想)(?:的话)?/, category: '讨好', advice: '「如果你需要的话」先把自己放低了，直接问要不要。' },
  { re: /(?:我可以帮你|要不要我帮你|需要我帮你)/, category: '讨好', advice: '有求必应的口气，别主动揽活。' },
  { re: /(?:一起加油|未来可期|都会好的|值得珍藏|共勉|加油哦)/, category: '升华', advice: '这是拔高收尾，删掉，停在事实上。' },
  { re: /(?:希望|愿|相信|期待|祝你)[^。！？\n]{0,30}[。！~～]?[ \t]*$/, category: '升华', advice: '「希望…/愿…」结尾是在升华，删掉最后那句。' },
  { re: /(?:你说呢|你觉得呢|是不是呢|对吧|对吗)[？?][ \t]*$/, category: '升华', advice: '反问收尾像在收场，别问。' },

  // —— 以下是实测里真被忽略掉的腔调：结构太工整、爱给方案、爱补一句 ——
  // 破折号补丁:前面已经把话说完了,再用破折号兜一句解释
  { re: /——[^。！？!?\n]{6,}/, category: 'AI 词句式', advice: '破折号后面兜的那句,断成一句话单独说。', weight: 2 },
  // 「不是A,是B」对举(没有「而是」,所以上面的规则抓不到)
  { re: /不是[^。！？；\n]{1,15}[，,][ \t]*(?:就)?是[^。！？；\n]{1,20}/, category: 'AI 词句式', advice: '「不是…,是…」是对举腔,直接说后半句。', weight: 2 },
  // 分号:聊天里几乎不用,一用就露出书面腔
  { re: /[；;]/, category: '翻译腔', advice: '分号是书面语,这里换成句号。', weight: 2 },
  // 冒号后拉出一串解释
  { re: /：[^。！？!?\n]{10,}/, category: 'AI 词句式', advice: '冒号后面那串,拆成独立的一句。', weight: 1 },
  // 「X 我知道,……」定义式开场
  { re: /^[^，。！？\n]{2,15}(?:我知道|我清楚|我了解)[，,]/m, category: 'AI 词句式', advice: '先说事,别先摆「我知道」的架势。', weight: 2 },
  // 「…的话」条件铺陈
  { re: /[^。！？；\n]{4,}的话[，,]/, category: '讨好', advice: '「…的话」是铺垫,直接说。', weight: 1 },
  // 主动加码
  { re: /(?:我也可以|我也能|我还能|我这边也)/, category: '讨好', advice: '别主动加码,他问了你再说。', weight: 2 },
  // 汇报腔
  { re: /(?:先跟你说一声|跟你说一声|我告诉你|我陪你)/, category: 'AI 词句式', advice: '这是汇报,删掉,有事直接说事。', weight: 1 },
  // 方案化:先给默认值再补一句
  { re: /(?:默认我|我按[^。！？，\n]{2,10}的来|按默认)/, category: 'AI 词句式', advice: '别替他拍默认方案,问他要哪个。', weight: 2 },
  // 夸张评价收尾:把形容词往死里用,一句一个「狠/损/刀」
  { re: /(?:太(?:狠|损|绝|毒|扎心|顶了)了|全是(?:刀|刀子)|刀刀|破防了|顶不住了|看傻|直冒冷汗)/, category: '升华', advice: '「狠/损/全是刀」这类词一条一个就够,别句句都来。', weight: 2 },
  // 「比…还…」把话抬得比事本身还重
  { re: /比[^。！？；\n]{1,20}(?:还|更)[\u4e00-\u9fa5]/, category: '升华', advice: '别把话抬得比事本身还重,说事就行。', weight: 2 },
];

const sentenceSplit = /[。！？!?\n]+/;

function cn(x: string): number {
  return (x.match(/[\u4e00-\u9fa5]/g) ?? []).length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sentences(t: string): string[] {
  return t.split(sentenceSplit).map((s) => s.trim()).filter(Boolean);
}

/** 分句：逗号、分号也算一拍，用来量说话节奏。 */
const clauseSplit = /[。！？!?；;，,\n]+/;

function clauses(t: string): string[] {
  return t.split(clauseSplit).map((s) => s.trim()).filter(Boolean);
}

/** 规则替换：只动硬伤词，长词优先，删词时连同前面的逗号。 */
function rewrite(text: string): { out: string; changed: string[] } {
  let out = text;
  const changed: string[] = [];
  for (const [word, rep] of [...HARD_WORDS].sort((a, b) => b[0].length - a[0].length)) {
    if (!out.includes(word)) continue;
    out = rep === '' ? out.split('，' + word).join('，').split(word).join('') : out.split(word).join(rep);
    changed.push(word);
  }
  return {
    out: out.replace(/，{2,}/g, '，').replace(/^[，、\s]+/, '').replace(/[ \t]+\n/g, '\n'),
    changed,
  };
}

export interface Report {
  level: '通过' | '轻' | '中' | '重';
  chars: number;
  density: number;
  findings: Finding[];
  /** 按类别分组的行，已排好序 */
  lines: string[];
  truncated: boolean;
}

export function analyze(raw: string): Report {
  const full = String(raw ?? '');
  const truncated = full.length > MAX_CHARS;
  const text = truncated ? full.slice(0, MAX_CHARS) : full;
  const chars = Math.max(1, cn(text));
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding): void => {
    const key = f.category + '|' + f.hit;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  // 硬伤词：匹配过的片段先占位，避免子串重复计数
  let work = text;
  for (const [word, rep] of [...HARD_WORDS].sort((a, b) => b[0].length - a[0].length)) {
    if (!work.includes(word)) continue;
    add({ category: 'AI 词句式', hit: word, advice: rep ? `改成「${rep}」` : '删掉', replace: rep, weight: 3 });
    work = work.split(word).join('\u0001');
  }

  // 抽象词：只计数、只提示
  for (const word of SOFT_WORDS) {
    if (!work.includes(word)) continue;
    add({ category: 'AI 词句式', hit: word, advice: '词太大，换成日常说法', weight: 1 });
    work = work.split(word).join('\u0001');
  }

  // 句式
  for (const p of PATTERNS) {
    const m = work.match(p.re);
    if (!m) continue;
    add({ category: p.category, hit: (m[0] ?? '').trim(), advice: p.advice, weight: p.weight ?? 2 });
    work = work.replace(p.re, '\u0001');
  }

  // 顿号三连、三项还一样长：「号码无效、你好旧友、查无回应」。
  // 人随手举例长短不齐，不会凑成齐刷刷的三项；短消息里的枚举多半是正常清单，放长到 25 字以上再看。
  if (text.length >= 25) {
    const runs = text.match(/[\u4e00-\u9fa5]{2,8}(?:、[\u4e00-\u9fa5]{2,8}){2,}/g) ?? [];
    for (const run of runs) {
      const parts = run.split('、').map((s) => s.length);
      if (parts.length >= 3 && Math.min(...parts) >= 3 && Math.max(...parts) - Math.min(...parts) <= 1) {
        add({ category: '小作文', hit: `三项等长（${parts.join('/')}）`, advice: '举例子别凑成一样长的三项。', weight: 2 });
        break;
      }
    }
  }

  // 翻译腔：定语太厚
  const de = (text.match(/的/g) ?? []).length;
  if (de >= 3 && de * 12 > chars) {
    add({ category: '翻译腔', hit: `的×${de}`, advice: '一句里定语太多，把主语直接说出来', weight: 2 });
  }

  // 小作文：一条消息本身太长。实测这台机器上 QQ 消息中位数 67 字、最长 185 字，
  // 所以阈值按它自己的水核定——超过 40 字就已经比真人聊天长了。
  if (chars > 90) {
    add({ category: '小作文', hit: `一条 ${chars} 字`, advice: '拆成两三条发，一条只说一件事。', weight: 3 });
  } else if (chars > 60) {
    add({ category: '小作文', hit: `一条 ${chars} 字`, advice: '砍掉一半，只留最想说的那句。', weight: 2 });
  } else if (chars > 40) {
    add({ category: '小作文', hit: `一条 ${chars} 字`, advice: '还能再短点。', weight: 1 });
  }

  // 小作文：整句有没有长到离谱，再看分句节奏（逗号也算一拍）
  const whole = sentences(text).map(cn).filter((n) => n > 0);
  const longest = whole.length ? Math.max(...whole) : 0;
  if (longest > 50) {
    add({ category: '小作文', hit: `一句 ${longest} 字`, advice: '这句太长，中间找个地方断成两句', weight: 2 });
  }
  const lens = clauses(text).map(cn).filter((n) => n > 0);
  const longestClause = lens.length ? Math.max(...lens) : 0;
  if (longestClause > 38) {
    add({ category: '小作文', hit: `一口气 ${longestClause} 字没喘`, advice: '这句中间断开，说成两三口。', weight: 2 });
  }
  if (lens.length >= 3) {
    const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
    if (avg > 26) {
      add({ category: '小作文', hit: `平均 ${avg} 字一句`, advice: '一句里塞了太多东西，挑个地方断成两句', weight: 2 });
    } else if (lens.every((n) => n >= 18)) {
      add({ category: '小作文', hit: `最短的一句也有 ${Math.min(...lens)} 字`, advice: '全篇没有短句，加一句四五个字的', weight: 2 });
    }
    for (let i = 0; i + 2 < lens.length; i++) {
      const [a, b, c] = [lens[i], lens[i + 1], lens[i + 2]];
      if (a >= 8 && Math.max(a, b, c) - Math.min(a, b, c) <= 3) {
        add({ category: '小作文', hit: `第 ${i + 1}-${i + 3} 句一样长（${a}/${b}/${c}）`, advice: '三句齐了，把中间那句砍短或拆开', weight: 2 });
        break;
      }
    }
  }

  const total = findings.reduce((sum, f) => sum + f.weight, 0);
  // 短文本按 70 字起算，免得「今天天挺好」里一个词就把密度顶到天上
  const density = round1(total / (Math.max(chars, 70) / 100));
  const hard = findings.filter((f) => f.weight === 3).length;
  // 阈值按实测校准：624 条历史发言里，「中」应落在真该动笔的那批（约一成），
  // 不能把随口一句闲聊也判中，否则每次都要重写。
  const level: Report['level'] = !findings.length ? '通过'
    : (hard >= 2 || density >= 9) ? '重'
      : (hard >= 1 || density >= 3.5) ? '中' : '轻';

  const order: Category[] = ['小作文', '升华', '讨好', '翻译腔', 'AI 词句式'];
  const lines = order
    .map((cat) => (findings.filter((f) => f.category === cat)))
    .filter((list) => list.length)
    .flatMap((list) => list.map((f) => `- ${f.category}：「${f.hit}」 ${f.advice}`));

  return { level, chars, density, findings, lines, truncated };
}

/** 给模型看的短报告。 */
export function report(raw: string, mode: 'check' | 'rewrite' = 'check'): string {
  const r = analyze(raw);
  const head = r.level === '通过'
    ? `通过（密度 ${r.density}，${r.chars} 字）：可以发。`
    : `${r.level}（密度 ${r.density}，${r.chars} 字，${r.findings.length} 处）`;
  const body = r.lines.join('\n');
  const parts = [head];
  if (body) parts.push(body);
  if (r.level !== '通过') {
    parts.push(r.level === '重' ? '按上面的改，改到「轻」再发。' : r.level === '中' ? '命中一条也要改。' : '顺手改掉，下次注意。');
  }
  if (mode === 'rewrite') {
    const { out, changed } = rewrite(String(raw ?? ''));
    if (changed.length) parts.push(`规则替换后的版本（句式还得自己动）：\n${out}`);
    else parts.push('规则替换不动句式，得自己重写那几句。');
  }
  if (r.truncated) parts.push('（文本超过 12000 字，只检查了前半段。）');
  return parts.join('\n');
}
