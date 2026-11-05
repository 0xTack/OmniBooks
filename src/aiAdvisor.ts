import { App, Modal, Notice, Setting, TFile, normalizePath, requestUrl, setIcon } from "obsidian";

export interface AiCache {
  fingerprint: string;
  analysis: Analysis;
  savedAt: number;
}

export interface AiOptions {
  dirs: string[];
  shareDir?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  includeNotes: boolean;
  cache?: AiCache;
  saveCache?: (cache: AiCache) => Promise<void>;
  modules?: string[];
  history?: AiCache[];
  themeView?: "bars" | "cards";
}

interface LibraryBook {
  title: string;
  author: string;
  tags: string[];
  status: string;
  progress: number;
  highlights: number;
  source: string;
  dates: number[];
  /** frontmatter 里的 lastRead，没有则为 null */
  lastRead?: number | null;
  dims?: Dims;
}

export interface Dims {
  literary: number;
  philosophical: number;
  knowledge: number;
  realism: number;
  social: number;
  imagination: number;
}

const DIM_AXES: Array<{ key: keyof Dims; label: string; angle: number }> = [
  { key: "literary", label: "文学", angle: -90 },
  { key: "philosophical", label: "思想", angle: -30 },
  { key: "knowledge", label: "知识", angle: 30 },
  { key: "realism", label: "现实", angle: 90 },
  { key: "social", label: "社会", angle: 150 },
  { key: "imagination", label: "想象", angle: 210 },
];

const EMPTY_DIMS: Dims = {
  literary: 0,
  philosophical: 0,
  knowledge: 0,
  realism: 0,
  social: 0,
  imagination: 0,
};

function toDims(value: unknown): Dims {
  const raw = (value ?? {}) as Record<string, unknown>;
  const pick = (key: keyof Dims) => {
    const n = Number(raw[key]);
    return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
  };
  return {
    literary: pick("literary"),
    philosophical: pick("philosophical"),
    knowledge: pick("knowledge"),
    realism: pick("realism"),
    social: pick("social"),
    imagination: pick("imagination"),
  };
}

interface Recommendation {
  title: string;
  author: string;
  mode: string;
  reason: string;
  tags: string[];
  dimensions?: Dims;
}

interface Analysis {
  summary: string;
  themes: string[];
  blindSpots: string[];
  recommendations: Recommendation[];
  profile: Dims;
  coverage: Dims;
  local?: boolean;
  difficulty?: Array<{ t: string; d: number }>;
  motifs?: string[];
  encouragement?: string;
  /** AI 给每本书归纳的主题，用于「主题热度」 */
  bookTopics?: Array<{ t: string; k: string[] }>;
}

const AI_PROVIDERS: Array<{ id: string; label: string; url: string }> = [
  { id: "deepseek", label: "DeepSeek（深度求索）", url: "https://api.deepseek.com/v1" },
  { id: "openai", label: "OpenAI", url: "https://api.openai.com/v1" },
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { id: "custom", label: "自定义 / 本地模型", url: "" },
];

const LOCAL_RULES: Array<{ key: keyof Dims; test: RegExp }> = [
  { key: "literary", test: /文学|小说|诗|散文|戏剧|故事|作品集/ },
  { key: "philosophical", test: /哲学|思想|伦理|宗教|精神|存在|心理/ },
  { key: "knowledge", test: /科学|物理|数学|生物|自然|计算机|技术|编程|经济|历史/ },
  { key: "realism", test: /纪实|传记|新闻|政治|社会现实|回忆录|日记|访谈/ },
  { key: "social", test: /社会|人类学|性别|制度|阶级|经济|政治|城市|关系/ },
  { key: "imagination", test: /科幻|奇幻|幻想|神话|超现实|魔幻|未来/ },
];

export const AI_MODULES: Array<{ id: string; label: string; desc: string }> = [
  { id: "domain", label: "阅读领域分布", desc: "文学/历史/哲学/社会/心理/科学/艺术，各占多少" },
  { id: "completion", label: "完成率 / 弃读率", desc: "我读完什么？按领域看完成率" },
  { id: "topics", label: "主题热度", desc: "哪些主题反复出现、最后一次是什么时候" },
  { id: "types", label: "类型比例", desc: "环形图：文学/社科/科学/艺术" },
  { id: "sources", label: "来源比例", desc: "苹果图书 vs 微信读书" },
];

const DOMAINS: Array<{ label: string; test: RegExp; color: string }> = [
  { label: "文学", test: /文学|小说|诗|散文|戏剧|故事|作品集|经典|随笔|译文/, color: "hsl(96 32% 58%)" },
  { label: "历史", test: /历史|史料|战争|古代|近代|民国|王朝|史记/, color: "hsl(36 38% 55%)" },
  { label: "哲学", test: /哲学|思想|伦理|存在|宗教|形而上学|逻辑/, color: "hsl(268 28% 50%)" },
  { label: "社会", test: /社会|人类学|性别|制度|阶级|城市|家庭|关系|政治/, color: "hsl(200 34% 50%)" },
  { label: "心理", test: /心理|精神|情绪|认知|疗愈|亲密/, color: "hsl(330 28% 48%)" },
  { label: "科学", test: /科学|物理|数学|生物|自然|计算机|技术|医学|天文|演化|科普/, color: "hsl(170 30% 45%)" },
  { label: "艺术", test: /艺术|绘画|摄影|设计|美术|建筑|音乐|电影|画册|图像/, color: "hsl(320 24% 45%)" },
];

function normalizeBookStatus(book: LibraryBook): "done" | "reading" | "wish" | "unknown" {
  const raw = (book.status || "").trim().toLowerCase();
  if (["已读", "读完", "finished", "read", "3", "4"].includes(raw)) return "done";
  if (["在读", "在读中", "阅读中", "reading", "2"].includes(raw)) return "reading";
  if (["想读", "未读", "wishlist", "to-read", "want", "1"].includes(raw)) return "wish";
  if (book.progress >= 95) return "done";
  if (book.progress > 0 || book.highlights > 0) return "reading";
  return "unknown";
}

function classifyDomain(book: LibraryBook): string {
  const haystack = `${book.title} ${book.author} ${book.tags.join(" ")}`;
  for (const domain of DOMAINS) {
    if (domain.test.test(haystack)) return domain.label;
  }
  return "其他";
}

interface TopicRow {
  name: string;
  count: number;
  last: number | null;
}

/** 书名归一化，只用于 AI 回填主题时对上书 */
function titleKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[《》〈〉「」『』【】\[\]()（）\s·:：,，.。!！?？'"“”‘’—–\-_/\\]/g, "");
}

function formatMonth(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 清洗模型返回的 bookTopics，过滤空主题和过长/过短的主题词 */
function toBookTopics(value: unknown): Array<{ t: string; k: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row: any) => row && row.t && Array.isArray(row.k))
    .map((row: any) => ({
      t: String(row.t),
      k: row.k
        .map((topic: unknown) => String(topic).trim())
        .filter((topic: string) => topic.length >= 2 && topic.length <= 8),
    }))
    .filter((row: { k: string[] }) => row.k.length > 0);
}

function buildTopicRows(
  books: LibraryBook[],
  entries: Array<{ t: string; k: string[] }>
): { rows: TopicRow[]; matched: number } {
  const byTitle = new Map<string, LibraryBook>();
  for (const book of books) byTitle.set(titleKey(book.title), book);

  const findBook = (title: string): LibraryBook | undefined => {
    const key = titleKey(title);
    if (!key) return undefined;
    const exact = byTitle.get(key);
    if (exact) return exact;
    if (key.length < 4) return undefined;
    let best: LibraryBook | undefined;
    let bestGap = Infinity;
    for (const [candidate, book] of byTitle) {
      if (candidate.includes(key) || key.includes(candidate)) {
        const gap = Math.abs(candidate.length - key.length);
        if (gap < bestGap) {
          bestGap = gap;
          best = book;
        }
      }
    }
    return best;
  };

  const topics = new Map<string, { books: Set<string>; last: number | null }>();
  let matched = 0;
  for (const entry of entries) {
    const book = findBook(entry.t);
    if (!book) continue;
    matched += 1;
    const last =
      book.lastRead ?? (book.dates.length > 0 ? Math.max(...book.dates) : null);
    for (const raw of entry.k) {
      const name = raw.replace(/\s+/g, "").replace(/^[「『【]|[」』】]$/g, "");
      if (!name) continue;
      const item = topics.get(name) ?? { books: new Set<string>(), last: null };
      item.books.add(book.title);
      if (last !== null && (item.last === null || last > item.last)) item.last = last;
      topics.set(name, item);
    }
  }

  const rows = [...topics.entries()]
    .map(([name, item]) => ({ name, count: item.books.size, last: item.last }))
    .sort((a, b) => b.count - a.count || (b.last ?? 0) - (a.last ?? 0))
    .slice(0, 8);

  return { rows, matched };
}

function scoreBook(book: LibraryBook): Dims {
  const haystack = `${book.title} ${book.author} ${book.tags.join(" ")}`;
  const dims: Dims = { ...EMPTY_DIMS };
  for (const rule of LOCAL_RULES) {
    if (rule.test.test(haystack)) dims[rule.key] = 1;
  }
  const any = Object.values(dims).some((v) => v > 0);
  if (!any) dims.literary = 1;
  return dims;
}

function analyzeLocally(books: LibraryBook[]): Analysis {
  return {
    summary: "",
    themes: [],
    blindSpots: [],
    recommendations: [],
    profile: { ...EMPTY_DIMS },
    coverage: { ...EMPTY_DIMS },
    local: true,
  };
}

export interface AiBridge {
  models: string[];
  save: (patch: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    models?: string[];
    themeView?: "bars" | "cards";
  }) => Promise<void>;
  fetchModels: (
    baseUrl: string,
    apiKey: string
  ) => Promise<{ ok: boolean; models: string[]; error?: string }>;
}

interface AiJob {
  startedAt: number;
  stage: string;
  done: boolean;
  result?: Analysis;
  error?: string;
}

function parseFrontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!text.startsWith("---")) return result;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return result;
  for (const line of text.slice(3, end).split("\n")) {
    const match = /^([A-Za-z0-9_\u4e00-\u9fa5-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function parseTags(raw: string): string[] {
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[,，]/)
    .map((tag) => tag.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

async function collectLibrary(app: App, dirs: string[]): Promise<LibraryBook[]> {
  const books: LibraryBook[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const normalized = normalizePath(dir);
    if (!normalized) continue;

    for (const file of app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${normalized}/`)) continue;
      if (seen.has(file.path)) continue;
      seen.add(file.path);

      let text: string;
      try {
        text = await app.vault.read(file);
      } catch {
        continue;
      }

      const frontmatter = parseFrontmatter(text);
      const highlights =
        (text.match(/<span class="abs-time">/g) ?? []).length +
        (text.match(/\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\]\(/g) ?? []).length;
      const dates: number[] = [];
      const datePatterns = [
        /<span class="abs-time">\[(\d{4})-(\d{2})-(\d{2})/g,
        /\[(\d{4})-(\d{2})-(\d{2})[ T]/g,
      ];
      for (const dateRe of datePatterns) {
        let match: RegExpExecArray | null;
        while ((match = dateRe.exec(text))) {
          dates.push(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime());
        }
      }
      const lastReadRaw = (frontmatter.lastRead || "").trim();
      const lastReadTime = lastReadRaw ? new Date(lastReadRaw).getTime() : NaN;
      books.push({
        title: frontmatter.title || file.basename,
        author: frontmatter.author || "",
        tags: parseTags(frontmatter.tags || ""),
        status: frontmatter.status || frontmatter.readingStatus || "",
        progress: Number(frontmatter.progress ?? 0) || 0,
        highlights,
        source: frontmatter.source === "weread" ? "微信读书" : "苹果图书",
        dates,
        lastRead: Number.isFinite(lastReadTime) ? lastReadTime : null,
      });
    }
  }

  return books.slice(0, 180);
}

function buildPrompt(books: LibraryBook[]): string {
  const payload = books.map((book) => ({
    t: book.title,
    a: book.author,
    g: book.tags.slice(0, 6),
    s: book.status,
    p: book.progress,
    h: book.highlights,
  }));

  return [
    "你是「阅读导航系统」的分析引擎，不是聊天机器人。只输出 JSON，不要 Markdown 代码块。",
    "",
    "第一步：按下面六个维度给这位读者的**阅读画像**打分（0–10，可带一位小数）。",
    "literary 文学：语言、叙事、人物、形式创新",
    "philosophical 思想：哲学问题、抽象观念、价值与伦理",
    "knowledge 知识：事实、科学、历史、系统专业知识",
    "realism 现实：现实世界、纪实、政治、日常生活",
    "social 社会：群体、制度、阶级、人际关系",
    "imagination 想象：神话、幻想、科幻、超现实",
    "同时给出 coverage（0–1）：这六个维度各自被阅读覆盖的程度。",
    "评分必须以清单里实际出现的书为依据，不要凭印象；宁可保守。",
    "",
    "第二步：找出 2–4 个信息缺口（blindSpots）和 3–5 个主题（themes）。",
    "",
    "第三步：推荐 8 本书，必须分布在 5 个桶里：",
    "comfort 延续：与现有口味高度一致",
    "deepen 深入：把当前兴趣往下挖，帮助重新理解读过的书",
    "compensate 补偿：补足明显偏低的维度",
    "bridge 桥梁：从读者现在关注的问题，过渡到一个陌生领域（至少 1 本）",
    "adventure 冒险：故意给一本与现有偏好相反或完全不相干的书（至少 1 本），用来消除信息差；理由要说明它为什么值得读，而不是随机。",
    "不要推荐清单里已有的书；中英文都可以。",
    "每本给出 title、author、mode、reason、tags（2-3 个）、dimensions（这本书的六维评分）。",
    "",
    "reason 的硬性要求（非常重要）：",
    "1. 必须具体：点名读者读过的书名或作者，说清楚「这本书接的是哪一本、补的是哪个洞」。",
    "2. 必须能验证：读者看完应该知道「为什么是这本，而不是同类的另一本」。",
    "3. 40–70 字，用日常中文，不要术语堆砌。",
    "4. 禁止套话：不许出现「拓展认知边界」「打破信息茧房」「挑战阅读惯性」「提升思维」这类空话。",
    "5. 冒险桶也要具体：要和读者读过的某一本形成明确对照（例如「你读的是村上式的孤独，这本给的是…」）。",
    "错误示例（禁止）：冒险：用数学、音乐与艺术挑战叙事阅读惯性，拓展认知边界。",
    "正确示例：你连着读了卡佛和村上，都是极简叙事的孤独；这本用数学和巴赫的对位法讲同一个「自指」问题，读完再回看《世界尽头与冷酷仙境》会不一样。",
    "",
    "阅读清单（书名、作者、标签、状态、进度、划线数）：",
    JSON.stringify(payload),
    "",
    "另外输出 encouragement：一句写给这位读者的总结，20–32 字，偏鼓励、偏赞赏、偏文艺，可以直接印在分享图上；必须是第二人称「你」，不要出现「读者」两个字，不要用感叹号。示例：「你把时间读成了孤独，又把孤独读成了时间。」",
    "另外输出：motifs（3-5 个读者长期反复出现的母题，如「时间」「孤独」「记忆」）；difficulty（清单中最多 40 本、按划线数从多到少的书，各给 0–10 的阅读难度）。",
    "只输出如下结构的 JSON：",
    '{"profile":{"literary":0,"philosophical":0,"knowledge":0,"realism":0,"social":0,"imagination":0},',
    '"coverage":{"literary":0,"philosophical":0,"knowledge":0,"realism":0,"social":0,"imagination":0},',
    '"summary":"","themes":[""],"blindSpots":[""],',
    '"motifs":[""],"difficulty":[{"t":"书名","d":0}],',
    '"recommendations":[{"title":"","author":"","mode":"comfort|deepen|compensate|bridge|adventure","reason":"","tags":[""],"dimensions":{"literary":0,"philosophical":0,"knowledge":0,"realism":0,"social":0,"imagination":0}}]}',
  ].join("\n");
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return body.trim();
  return body.slice(start, end + 1);
}

async function callModel(options: AiOptions, prompt: string): Promise<Analysis> {
  const base = (options.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const response = await requestUrl({
    url: `${base}/chat/completions`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || "deepseek-chat",
      temperature: 0.8,
      max_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "你是中文阅读顾问。你的目标不是迎合读者，而是帮助读者扩展视野、打破信息茧房。只输出 JSON。",
        },
        { role: "user", content: prompt },
      ],
    }),
    throw: false,
  });

  if (response.status >= 400) {
    const message =
      (response.json as { error?: { message?: string } } | undefined)?.error?.message ??
      response.text.slice(0, 200);
    throw new Error(`AI 接口返回 ${response.status}：${message}`);
  }

  const json = response.json as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("AI 没有返回内容");

  const parsed = JSON.parse(extractJson(content)) as Partial<Analysis>;
  const recs = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.filter((item) => item && item.title)
    : [];

  return {
    summary: parsed.summary ?? "",
    themes: Array.isArray(parsed.themes) ? parsed.themes : [],
    blindSpots: Array.isArray(parsed.blindSpots) ? parsed.blindSpots : [],
    recommendations: recs.map((item) => ({
      ...item,
      dimensions: item.dimensions ? toDims(item.dimensions) : undefined,
    })),
    motifs: Array.isArray((parsed as any).motifs) ? (parsed as any).motifs : [],
    encouragement: typeof (parsed as any).encouragement === "string" ? (parsed as any).encouragement : "",
    difficulty: Array.isArray((parsed as any).difficulty)
      ? (parsed as any).difficulty
          .filter((row: any) => row && row.t)
          .map((row: any) => ({ t: String(row.t), d: Math.max(0, Math.min(10, Number(row.d) || 0)) }))
      : [],
    bookTopics: toBookTopics((parsed as any).bookTopics),
    profile: toDims((parsed as unknown as Record<string, unknown>).profile),
    coverage: toDims((parsed as unknown as Record<string, unknown>).coverage),
  };
}

/** 只发书名+作者，单独生成主题，避免为了主题整本重跑一次分析 */
async function fetchBookTopics(
  options: AiOptions,
  books: LibraryBook[]
): Promise<Array<{ t: string; k: string[] }>> {
  const chunkSize = 50;
  const topics: Array<{ t: string; k: string[] }> = [];
  let lastError: unknown = null;
  for (let i = 0; i < books.length; i += chunkSize) {
    const chunk = books.slice(i, i + chunkSize);
    try {
      const part = await fetchTopicChunk(options, chunk);
      topics.push(...part);
    } catch (error) {
      lastError = error;
    }
  }
  if (topics.length === 0) {
    throw lastError instanceof Error ? lastError : new Error("模型没有给出可用的主题");
  }
  return topics;
}

/** 模型偶尔会把长 JSON 截断，这里能捞出完整的前半段，不至于整批作废 */
function parseTopicsLoose(content: string): Array<{ t: string; k: string[] }> {
  const body = extractJson(content);
  try {
    const parsed = JSON.parse(body) as { bookTopics?: unknown };
    return toBookTopics(parsed.bookTopics);
  } catch {
    const found: unknown[] = [];
    const rowRe = /\{"t"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"k"\s*:\s*\[(.*?)\]\s*\}/g;
    let match: RegExpExecArray | null;
    while ((match = rowRe.exec(content))) {
      try {
        found.push(JSON.parse(`{"t":"${match[1]}","k":[${match[2]}]}`));
      } catch {
        /* 跳过这一条 */
      }
    }
    return toBookTopics(found);
  }
}

async function fetchTopicChunk(
  options: AiOptions,
  books: LibraryBook[]
): Promise<Array<{ t: string; k: string[] }>> {
  const base = (options.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const payload = books.map((book) => ({ t: book.title, a: book.author || undefined }));
  const prompt = [
    "下面是一位读者的书架。给每本书归纳 1–2 个主题词（2–4 个汉字），用来统计「主题热度」。",
    "主题词必须能跨书复用（如「城市与孤独」「记忆」「权力与制度」），不要用「小说」「文学」「随笔」「传记」这类体裁或载体词，也不要只是重复书名。",
    "每本书最多 2 个主题词。t 必须原样使用给出的书名。只输出 JSON，不要解释：",
    '{"bookTopics":[{"t":"书名","k":["主题"]}]}',
    JSON.stringify(payload),
  ].join("\n");

  const body = {
    model: options.model || "deepseek-chat",
    temperature: 0.3,
    max_tokens: 16384,
    messages: [
      { role: "system", content: "你是中文阅读分析助手。只输出 JSON。" },
      { role: "user", content: prompt },
    ],
  };
  const send = (extra: Record<string, unknown>) =>
    requestUrl({
      url: `${base}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({ ...body, ...extra }),
      throw: false,
    });

  // 推理型模型会先写很长的思考过程，主题这种结构化任务直接关掉思考，避免 content 为空
  let response = await send({ thinking: { type: "disabled" } });
  if (response.status >= 400) {
    response = await send({ reasoning_effort: "low" });
  }

  if (response.status >= 400) {
    const message =
      (response.json as { error?: { message?: string } } | undefined)?.error?.message ??
      response.text.slice(0, 200);
    throw new Error(`生成主题失败（${response.status}）：${message}`);
  }

  const json = response.json as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string; reasoning_content?: string };
    }>;
  };
  const choice = json.choices?.[0];
  // 推理型模型有时把 JSON 写进 reasoning_content，content 为空
  const content = (choice?.message?.content || "").trim();
  if (!content) {
    const fallback = (choice?.message?.reasoning_content || "").trim();
    if (!fallback) {
      throw new Error(`模型没有返回内容（finish=${choice?.finish_reason ?? "?"}）`);
    }
    return parseTopicsLoose(fallback);
  }
  return parseTopicsLoose(content);
}

async function chatOnce(
  options: AiOptions,
  question: string,
  context: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  const base = (options.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const response = await requestUrl({
    url: `${base}/chat/completions`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || "deepseek-chat",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "你是这位读者的阅读顾问，回答要具体、口语化，能点名书就点名书。不要空话套话。\n\n读者画像：\n" +
            context,
        },
        ...history.slice(-6),
        { role: "user", content: question },
      ],
    }),
    throw: false,
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  const json = response.json as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || "（没有返回内容）";
}

const MODE_LABEL: Record<string, string> = {
  comfort: "舒适区",
  stretch: "拓展",
  contrarian: "反向",
};

export class AiAdvisorModal extends Modal {
  private options: AiOptions;
  private bridge?: AiBridge;
  /** 跨窗口共享：关掉弹窗后分析继续跑 */
  private static job: AiJob | null = null;
  private progressTimer: number | null = null;
  private tipTimer: number | null = null;
  private booksCache: LibraryBook[] = [];
  private topicView: "bars" | "cards";

  private setupInit = false;
  private draftProvider = "";
  private draftBase = "";
  private draftKey = "";
  private draftModel = "";
  private draftModels: string[] = [];
  private draftStatus = "";
  private draftStatusKind: "" | "ok" | "err" = "";
  private testing = false;

  constructor(app: App, options: AiOptions, bridge?: AiBridge) {
    super(app);
    this.options = options;
    this.bridge = bridge;
    this.topicView = options.themeView === "bars" ? "bars" : "cards";
  }

  private isModalVisible(): boolean {
    return this.contentEl?.isConnected === true;
  }

  private stopTimer(): void {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.tipTimer !== null) {
      window.clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
  }

  private renderLoading(text: string): void {
    this.stopTimer();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-ai-modal");
    contentEl.createEl("h2", { text: "AI 阅析" });
    contentEl.createDiv({ cls: "abs-ai-loading", text });
  }

  /** 进度面板：阶段、已用时间、进度条、可以离开的提示 */
  private renderProgress(job: AiJob): void {
    this.stopTimer();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-ai-modal");
    const box = contentEl.createDiv({ cls: "abs-ai-progress" });
    const stageEl = box.createDiv({ cls: "abs-ai-stage", text: job.stage });
    const bar = box.createDiv({ cls: "abs-ai-bar" }).createDiv({ cls: "abs-ai-bar-fill" });
    const meta = box.createDiv({ cls: "abs-ai-meta" });
    const timeEl = meta.createDiv({ cls: "abs-ai-elapsed", text: "已用 0 秒" });
    meta.createDiv({ cls: "abs-ai-books-count", text: "可关闭窗口，后台继续" });

    const radarWrap = contentEl.createDiv({ cls: "abs-ai-radar is-loading" });
    radarWrap.innerHTML = this.radarSvg(EMPTY_DIMS, undefined, true);

    const tipPool = [
      "正在把你的书按主题归类…",
      "在找哪些领域你几乎没碰过…",
      "试着从你最近读的书往外走一步…",
      "计算六边形里最低的那一角…",
      "挑一本和你口味相反的书…",
      "整理推荐理由，尽量说人话…",
      "可以关掉窗口，分析会在后台继续…",
    ];
    const tipEl = contentEl.createDiv({ cls: "abs-ai-tip", text: tipPool[0] });
    let tipIndex = 0;
    const tipTimer = window.setInterval(() => {
      tipIndex = (tipIndex + 1) % tipPool.length;
      tipEl.setText(tipPool[tipIndex]);
      tipEl.removeClass("is-in");
      void tipEl.offsetWidth;
      tipEl.addClass("is-in");
    }, 3400);
    this.tipTimer = tipTimer;

    const tick = () => {
      const seconds = Math.floor((Date.now() - job.startedAt) / 1000);
      timeEl.setText(`已用 ${seconds} 秒`);
      if (job.done) {
        bar.style.width = "100%";
        return;
      }
      // 慢速爬升，最多到 92%，完成时才到 100%
      const percent = Math.min(92, 6 + seconds * 2.2);
      bar.style.width = `${percent}%`;
      stageEl.setText(job.stage);
    };

    tick();
    this.progressTimer = window.setInterval(tick, 400);
  }

  /** 后台任务结束：已关闭就只弹提示，还开着就渲染结果 */
  private finishJob(job: AiJob): void {
    this.stopTimer();
    if (job.error) {
      new Notice(`AI 阅析：分析失败 · ${job.error}`, 7000);
    } else if (job.result) {
      new Notice(
        `AI 阅析：推荐已生成（${job.result.recommendations.length} 本），点侧边栏 ✨ 查看`,
        7000
      );
    }
    if (!this.isModalVisible()) return;
    if (job.error) {
      this.renderLoading(`分析失败：${job.error}`);
    } else if (job.result) {
      this.renderAnalysis(job.result, this.booksCache);
    }
  }

  private async run(force = false): Promise<void> {
    if (!this.options.apiKey) {
      const books = await collectLibrary(this.app, this.options.dirs);
      this.booksCache = books;
      this.renderAnalysis(analyzeLocally(books), books);
      return;
    }

    const running = AiAdvisorModal.job;
    if (running && !running.done) {
      this.renderProgress(running);
      this.watchJob(running);
      return;
    }

    if (!force && running?.done && running.result) {
      this.renderAnalysis(running.result, this.booksCache);
      return;
    }

    const job: AiJob = {
      startedAt: Date.now(),
      stage: "正在读取书架…",
      done: false,
    };
    AiAdvisorModal.job = job;
    this.renderProgress(job);

    void (async () => {
      try {
        const books = await collectLibrary(this.app, this.options.dirs);
        this.booksCache = books;
        if (books.length === 0) {
          throw new Error("书架里还没有书，先同步或添加书籍笔记");
        }

        const fingerprint = `${books.length}:${this.options.model}:${books
          .map((book) => book.title)
          .sort()
          .join("|")
          .length}`;

        if (!force && this.options.cache) {
          job.done = true;
          this.renderAnalysis(this.options.cache.analysis, books);
          const days = Math.floor((Date.now() - this.options.cache.savedAt) / 86400000);
          if (this.options.cache.fingerprint !== fingerprint) {
            new Notice(`书架有变化，结果可能过期；点右上角 ↻ 重新分析（距上次 ${days} 天）`);
          } else if (days < 30) {
            new Notice(`距上次分析 ${days} 天，满 30 天后再重新总结并出对比图`);
          }
          return;
        }

        job.stage = `已读取 ${books.length} 本书，正在请求模型…`;
        if (this.isModalVisible()) this.renderProgress(job);

        job.stage = "正在分析…";
        const analysis = await callModel(this.options, buildPrompt(books));
        job.result = analysis;
        void this.options.saveCache?.({
          fingerprint,
          analysis,
          savedAt: Date.now(),
        });
        job.stage = `完成：${analysis.recommendations.length} 本推荐`;
        job.done = true;
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        job.done = true;
      }

      this.finishJob(job);
    })();
  }

  /** 重新打开时如果后台还在跑，就连上去继续显示进度 */
  private watchJob(job: AiJob): void {
    this.stopTimer();
    const timer = window.setInterval(() => {
      if (!this.isModalVisible()) {
        window.clearInterval(timer);
        return;
      }
      if (job.done) {
        window.clearInterval(timer);
        this.finishJob(job);
        return;
      }
      const stageEl = this.contentEl.querySelector(".abs-ai-stage");
      if (stageEl instanceof HTMLElement) stageEl.setText(job.stage);
    }, 500);
  }

  private renderSetup(): void {
    if (!this.setupInit) {
      this.setupInit = true;
      this.draftBase = this.options.baseUrl || "https://api.deepseek.com/v1";
      this.draftProvider =
        AI_PROVIDERS.find((item) => item.url === this.draftBase)?.id ?? "custom";
      this.draftKey = this.options.apiKey || "";
      this.draftModel = this.options.model || "";
      this.draftModels = this.bridge?.models ?? [];
    }

    this.stopTimer();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-ai-modal");
    contentEl.createEl("h2", { text: "AI 阅析" });
    contentEl.createDiv({
      cls: "abs-ai-hint",
      text: "填 API Key，测试通过后开始分析。Key 只保存在本地。",
    });

    const providerSetting = new Setting(contentEl)
      .setName("服务商")
      .setDesc("选好就自动填好接口地址，不需要知道 Base URL 是什么。");
    providerSetting.settingEl.addClass("abs-ai-field");
    providerSetting.addDropdown((dropdown) => {
      for (const provider of AI_PROVIDERS) {
        dropdown.addOption(provider.id, provider.label);
      }
      dropdown.setValue(this.draftProvider || "custom").onChange((value) => {
        this.draftProvider = value;
        const preset = AI_PROVIDERS.find((item) => item.id === value);
        if (preset && preset.url) {
          this.draftBase = preset.url;
          this.draftModels = [];
          this.draftStatus = "";
          this.draftStatusKind = "";
        }
        this.renderSetup();
      });
    });

    if (this.draftProvider === "custom") {
      const baseSetting = new Setting(contentEl)
        .setName("Base URL")
        .setDesc("自定义接口的地址，通常以 /v1 结尾。")
        .addText((text) => {
          text.inputEl.addClass("abs-ai-input");
          text
            .setPlaceholder("https://api.example.com/v1")
            .setValue(this.draftBase)
            .onChange((value) => {
              this.draftBase = value.trim();
            });
        });
      baseSetting.settingEl.addClass("abs-ai-field");
    } else {
      contentEl.createDiv({
        cls: "abs-ai-endpoint",
        text: this.draftBase,
      });
    }

    const keySetting = new Setting(contentEl).setName("API Key");
    keySetting.settingEl.addClass("abs-ai-field");
    keySetting.addText((text) => {
      text.inputEl.addClass("abs-ai-input");
      text.inputEl.type = "password";
      text
        .setPlaceholder("sk-...")
        .setValue(this.draftKey)
        .onChange((value) => {
          this.draftKey = value.trim();
        });
    });
    keySetting.addButton((button) => {
      button.setButtonText(this.testing ? "测试中…" : "测试");
      button.buttonEl.addClass("abs-ai-test-btn");
      button.setTooltip("测试连接并获取模型列表");
      button.setDisabled(this.testing);
      button.onClick(async () => {
        if (this.testing) return;
        if (!this.draftBase) {
          this.draftStatus = "先填 Base URL";
          this.draftStatusKind = "err";
          this.renderSetup();
          return;
        }
        if (!this.draftKey) {
          this.draftStatus = "先填 API Key";
          this.draftStatusKind = "err";
          this.renderSetup();
          return;
        }
        this.testing = true;
        this.draftStatus = "正在连接…";
        this.draftStatusKind = "";
        this.renderSetup();

        const result = await (this.bridge?.fetchModels(this.draftBase, this.draftKey) ??
          Promise.resolve({ ok: false, models: [], error: "插件接口未就绪" }));

        this.testing = false;
        if (result.ok) {
          this.draftModels = result.models;
          if (!this.draftModel || !result.models.includes(this.draftModel)) {
            this.draftModel = result.models[0] ?? "";
          }
          this.draftStatus = `连接成功，拿到 ${result.models.length} 个模型`;
          this.draftStatusKind = "ok";
          await this.bridge?.save({
            baseUrl: this.draftBase,
            apiKey: this.draftKey,
            model: this.draftModel,
            models: result.models,
          });
        } else {
          this.draftStatus = result.error ?? "连接失败";
          this.draftStatusKind = "err";
        }
        this.renderSetup();
      });
    });

    const modelSetting = new Setting(contentEl)
      .setName("模型")
      .setDesc(
        this.draftModels.length > 0
          ? "从测试返回的列表里选。"
          : "先在 API Key 右边点「测试」，通过后这里会变成下拉列表。"
      );
    modelSetting.settingEl.addClass("abs-ai-field");

    if (this.draftModels.length > 0) {
      modelSetting.addDropdown((dropdown) => {
        for (const model of this.draftModels) dropdown.addOption(model, model);
        dropdown.setValue(this.draftModel || this.draftModels[0]).onChange((value) => {
          this.draftModel = value;
        });
      });
    } else {
      modelSetting.addText((text) => {
        text.inputEl.addClass("abs-ai-input");
        text
          .setPlaceholder("可以留空，测试后自动填充")
          .setValue(this.draftModel)
          .onChange((value) => {
            this.draftModel = value.trim();
          });
      });
    }

    const actions = new Setting(contentEl).setClass("abs-ai-actions");

    actions.addButton((button) => {
      const ready = Boolean(this.draftKey && this.draftModel);
      button.setButtonText("开始分析");
      button.setCta();
      button.setDisabled(!ready);
      button.onClick(async () => {
        if (!ready) return;
        this.options = {
          ...this.options,
          baseUrl: this.draftBase || this.options.baseUrl,
          apiKey: this.draftKey,
          model: this.draftModel,
        };
        await this.bridge?.save({
          baseUrl: this.options.baseUrl,
          apiKey: this.draftKey,
          model: this.draftModel,
          models: this.draftModels,
        });
        this.setupInit = false;
        void this.run(true);
      });
    });

    if (!this.options.apiKey) {
      actions.addButton((button) => {
        button.setButtonText("先用本地估算");
        button.onClick(() => {
          this.setupInit = false;
          void this.run();
        });
      });
    }

    if (this.draftStatus) {
      contentEl.createDiv({
        cls: `abs-ai-status ${this.draftStatusKind === "err" ? "is-error" : this.draftStatusKind === "ok" ? "is-ok" : ""}`,
        text: this.draftStatus,
      });
    }

    contentEl.createDiv({
      cls: "abs-ai-hint",
      text: "提示：也可以去「设置 → AI 阅析」里配置，两边的值是同一份。",
    });
  }

  private async exportCard(analysis: Analysis): Promise<void> {
    const books = this.booksCache;
    const notes = books.reduce((sum, book) => sum + book.highlights, 0);
    const reading = books.filter((book) => book.progress > 0 && book.progress < 95).length;
    const top = DIM_AXES.map((axis) => ({ label: axis.label, value: analysis.profile[axis.key] }))
      .sort((a, b) => b.value - a.value)[0];

    const generic = [
      "书页合上的时候，有些句子还留在你身上。",
      "你读过的每一页，都在悄悄改写你。",
      "有些书读完了，有些句子还没读完。",
    ];
    const motifs = analysis.motifs ?? [];
    const lines = analysis.local
      ? generic
      : [
      (!analysis.local && analysis.encouragement) ||
        (motifs.length >= 2
        ? `你把${motifs[0]}读成了${motifs[1]}，又把${motifs[1]}读成了${motifs[0]}。`
        : "书页合上的时候，有些句子还留在你身上。"),
      "有些书读完了，有些句子还没读完。",
      "你读过的每一页，都在悄悄改写你。",
    ];
    const line = lines[Math.floor(Math.random() * lines.length)];

    const W = 720;
    const H = 960;
    const cx = W / 2;
    const cy = 470;
    const R = 128;
    const pt = (angle: number, value: number) => {
      const rad = (angle * Math.PI) / 180;
      const r = (Math.max(0, Math.min(10, value)) / 10) * R;
      return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
    };
    const ring = (level: number) =>
      DIM_AXES.map((axis) => pt(axis.angle, level).map((n) => n.toFixed(1)).join(",")).join(" ");
    const shape = DIM_AXES.map((axis) => pt(axis.angle, analysis.profile[axis.key]).map((n) => n.toFixed(1)).join(",")).join(" ");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1b2030"/><stop offset="60%" stop-color="#11131a"/><stop offset="100%" stop-color="#0e1016"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <text x="56" y="82" fill="#6f7799" font-size="15" letter-spacing="6" font-family="PingFang SC, sans-serif">OMNIBOOKS · 阅读画像</text>
      <text x="54" y="176" fill="#e8eaf2" font-size="96" font-weight="700" font-family="PingFang SC, sans-serif">${books.length}</text>
      <text x="${54 + String(books.length).length * 58}" y="176" fill="#9aa0bd" font-size="24" font-family="PingFang SC, sans-serif">本</text>
      <text x="56" y="222" fill="#7d84a4" font-size="20" font-family="PingFang SC, sans-serif">${notes} 条笔记 · ${reading} 本在读 · ${top.label} ${top.value.toFixed(1)}</text>
      ${[2, 4, 6, 8, 10].map((lv) => `<polygon points="${ring(lv)}" fill="none" stroke="#333a54" stroke-width="1"/>`).join("")}
      ${DIM_AXES.map((axis) => {
        const [x, y] = pt(axis.angle, 10);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#333a54" stroke-width="1"/>`;
      }).join("")}
      <polygon points="${shape}" fill="rgba(140,150,200,0.26)" stroke="#8d97cc" stroke-width="2.5"/>
      <line x1="${cx - 20}" y1="770" x2="${cx + 20}" y2="770" stroke="#3a4160" stroke-width="1"/>
      <text x="${cx}" y="820" fill="#c7cbe2" font-size="21" font-style="italic" text-anchor="middle" font-family="PingFang SC, sans-serif">${line}</text>
      <text x="56" y="912" fill="#565c78" font-size="14" letter-spacing="2" font-family="PingFang SC, sans-serif">${new Date().toISOString().slice(0, 7).replace("-", " · ")}</text>
      <text x="${W - 56}" y="912" text-anchor="end" fill="#565c78" font-size="14" letter-spacing="2" font-family="PingFang SC, sans-serif">OMNIBOOKS</text>
    </svg>`;

    try {
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("渲染失败"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W * 2;
      canvas.height = H * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 不可用");
      ctx.scale(2, 2);
      ctx.drawImage(image, 0, 0, W, H);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL("image/png");
      const binary = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
      const dir = normalizePath(this.options.shareDir || "OmniBooks/阅读");
      const path = `${dir}/分享-${new Date().toISOString().slice(0, 10)}.png`;
      try {
        await this.app.vault.createFolder(dir);
      } catch {
        /* 已存在 */
      }
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing as TFile, binary.buffer);
      else await this.app.vault.createBinary(path, binary.buffer);
      new Notice(`已保存分享图：${path}`);
    } catch (error) {
      new Notice(`导出失败：${(error as Error).message}`);
    }
  }

  private radarSvg(profile: Dims, coverage?: Dims, skeleton = false): string {
    const size = 300;
    const cx = size / 2;
    const cy = size / 2 + 6;
    const radius = 92;

    const point = (angle: number, value: number): [number, number] => {
      const rad = (angle * Math.PI) / 180;
      const r = (Math.max(0, Math.min(10, value)) / 10) * radius;
      return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
    };

    const poly = (values: Dims) =>
      DIM_AXES.map((axis) => point(axis.angle, values[axis.key]).map((n) => n.toFixed(1)).join(",")).join(" ");

    const rings = [2, 4, 6, 8, 10]
      .map((level) => {
        const pts = DIM_AXES.map((axis) =>
          point(axis.angle, level).map((n) => n.toFixed(1)).join(",")
        ).join(" ");
        return `<polygon points="${pts}" fill="none" stroke="var(--background-modifier-border)" stroke-width="1"/>`;
      })
      .join("");

    const spokes = DIM_AXES.map(
      (axis) =>
        `<line x1="${cx}" y1="${cy}" x2="${point(axis.angle, 10)[0].toFixed(1)}" y2="${point(axis.angle, 10)[1].toFixed(1)}" stroke="var(--background-modifier-border)" stroke-width="1"/>`
    ).join("");

    const labels = DIM_AXES.map((axis) => {
      const [x, y] = point(axis.angle, 12.2);
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--text-faint)">${axis.label}</text>`;
    }).join("");

    const coverageShape =
      coverage && !skeleton
        ? `<polygon points="${poly(coverage)}" fill="none" stroke="var(--text-faint)" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7"/>`
        : "";

    const profileShape = skeleton
      ? ""
      : `<polygon class="abs-radar-shape" points="${poly(profile)}" fill="var(--interactive-accent)" fill-opacity="0.18" stroke="var(--interactive-accent)" stroke-width="1.8" stroke-linejoin="round"/>`;

    const pulse = skeleton ? `<polygon class="abs-radar-pulse" points="${poly({literary: 7, philosophical: 7, knowledge: 7, realism: 7, social: 7, imagination: 7})}" fill="var(--interactive-accent)" fill-opacity="0.08" stroke="var(--interactive-accent)" stroke-width="1.2" stroke-dasharray="5 5"/>` : "";

    return `<svg viewBox="0 0 ${size} ${size}" class="abs-radar-svg" xmlns="http://www.w3.org/2000/svg">${rings}${spokes}${coverageShape}${pulse}${profileShape}${labels}</svg>`;
  }

  private renderAnalysis(analysis: Analysis, books: LibraryBook[] = []): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-ai-modal");

    const header = contentEl.createDiv({ cls: "abs-ai-header" });
    const tabs = header.createDiv({ cls: "abs-ai-tabs" });
    const refresh = header.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "重新分析", type: "button" },
    });
    refresh.setText("↻");
    refresh.addEventListener("click", () => void this.run(true));

    const panel = contentEl.createDiv({ cls: "abs-ai-panel" });

    const views: Array<{ id: string; label: string }> = analysis.local
      ? [{ id: "data", label: "数据" }]
      : [
          { id: "overview", label: "概览" },
          { id: "data", label: "数据" },
          { id: "recommend", label: "推荐" },
        ];

    const show = (id: string) => {
      tabs.querySelectorAll(".abs-ai-tab").forEach((el) => {
        el.toggleClass("is-active", (el as HTMLElement).dataset.tab === id);
      });
      panel.empty();
      if (id === "overview") this.renderOverview(panel, analysis);
      else if (id === "recommend") this.renderRecommendations(panel, analysis);
      else this.renderData(panel, books, analysis);
    };

    for (const view of views) {
      const btn = tabs.createEl("button", {
        cls: "abs-ai-tab",
        text: view.label,
        attr: { "data-tab": view.id, type: "button" },
      });
      btn.addEventListener("click", () => show(view.id));
    }

    if (analysis.local) {
      this.localNote(
        contentEl,
        "本地估算：没有配置 API，以下结果由书架数据统计得出，可能不准确。"
      );
    }

    show(views[0].id);
  }

  private localNote(parent: HTMLElement, text: string): void {
    const note = parent.createDiv({ cls: "abs-ai-local-note" });
    note.createSpan({ text });
    const button = note.createEl("button", {
      cls: "abs-ai-inline-btn",
      text: "接入 AI",
    });
    button.addEventListener("click", () => this.renderSetup());
  }

  private renderOverview(root: HTMLElement, analysis: Analysis): void {
    if (analysis.summary) {
      root.createDiv({ cls: "abs-ai-summary", text: analysis.summary });
    }

    const radarWrap = root.createDiv({ cls: "abs-ai-radar" });
    radarWrap.innerHTML = this.radarSvg(analysis.profile, analysis.coverage);
    const legend = radarWrap.createDiv({ cls: "abs-ai-radar-legend" });
    legend.createSpan({ cls: "is-solid", text: "兴趣画像" });
    legend.createSpan({ cls: "is-dashed", text: "阅读覆盖" });

    if (analysis.themes.length > 0) {
      const section = root.createDiv({ cls: "abs-ai-section" });
      section.createEl("h3", { text: "你的阅读偏好" });
      const chips = section.createDiv({ cls: "abs-ai-chips abs-ai-chips--stack" });
      for (const theme of analysis.themes) {
        chips.createDiv({ cls: "abs-ai-chip", text: theme });
      }
    }

    if (analysis.blindSpots.length > 0) {
      const section = root.createDiv({ cls: "abs-ai-section" });
      section.createEl("h3", { text: "可能的信息盲区" });
      const chips = section.createDiv({ cls: "abs-ai-chips abs-ai-chips--blind abs-ai-chips--stack" });
      for (const spot of analysis.blindSpots) {
        chips.createDiv({ cls: "abs-ai-chip abs-ai-chip--blind", text: spot });
      }
    }
  }

  private renderRecommendations(root: HTMLElement, analysis: Analysis): void {
    const books: LibraryBook[] = this.booksCache;
    if (
      analysis.summary ||
      analysis.themes.length > 0 ||
      analysis.blindSpots.length > 0 ||
      (analysis.motifs && analysis.motifs.length > 0)
    ) {
      const box = root.createDiv({ cls: "abs-ai-conclusion" });
      box.createDiv({ cls: "abs-ai-conclusion-title", text: "AI 总结" });

      if (analysis.themes.length > 0) {
        box.createDiv({
          cls: "abs-ai-conclusion-line",
          text: `最近在关注什么？${analysis.themes.join("、")}`,
        });
      }
      if (analysis.blindSpots.length > 0) {
        box.createDiv({
          cls: "abs-ai-conclusion-line",
          text: `有什么偏科？缺什么？${analysis.blindSpots.join("；")}`,
        });
      }
      if (analysis.motifs && analysis.motifs.length > 0) {
        box.createDiv({
          cls: "abs-ai-conclusion-line",
          text: `我的阅读正在往哪里走？长期母题：${analysis.motifs.join("、")}`,
        });
      }
      if (analysis.summary) {
        box.createDiv({ cls: "abs-ai-conclusion-summary", text: analysis.summary });
      }
    }

    if (!analysis.local) {
      const dims = DIM_AXES.map((axis) => ({ label: axis.label, value: analysis.profile[axis.key] }))
        .sort((a, b) => b.value - a.value);
      const high = dims.slice(0, 2);
      const low = dims.slice(-2);
      const skew = root.createDiv({ cls: "abs-ai-conclusion" });
      skew.createDiv({ cls: "abs-ai-conclusion-title", text: "偏科与母题" });
      skew.createDiv({
        cls: "abs-ai-conclusion-line",
        text: `重心：${high.map((d) => d.label).join("、")}；薄弱：${low.map((d) => d.label).join("、")}。`,
      });
      if (analysis.motifs && analysis.motifs.length > 0) {
        const chips = skew.createDiv({ cls: "abs-ai-chips" });
        for (const motif of analysis.motifs) {
          chips.createDiv({ cls: "abs-ai-chip", text: motif });
        }
      }
    }

    const pairCount = new Map<string, number>();
    for (const book of books) {
      const tags = book.tags.filter((tag) => tag && tag.length <= 12).slice(0, 6);
      for (let i = 0; i < tags.length; i += 1) {
        for (let j = i + 1; j < tags.length; j += 1) {
          const key = [tags[i], tags[j]].sort().join(" ↔ ");
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    }
    const pairs = [...pairCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (pairs.length > 0) {
      const graph = root.createDiv({ cls: "abs-ai-conclusion" });
      graph.createDiv({ cls: "abs-ai-conclusion-title", text: "知识连接" });
      const table = graph.createDiv({ cls: "abs-topic-table" });
      for (const [pair, count] of pairs) {
        const line = table.createDiv({ cls: "abs-topic-row" });
        line.createSpan({ cls: "abs-topic-name", text: pair });
        line.createSpan({ cls: "abs-topic-count", text: `${count} 本` });
        line.createSpan({ cls: "abs-topic-last", text: "" });
      }
    }

    const groups: Array<{ mode: string; title: string; desc: string }> = [
      { mode: "comfort", title: "延续", desc: "你大概率会喜欢" },
      { mode: "deepen", title: "深入", desc: "把当前兴趣挖深" },
      { mode: "compensate", title: "补偿", desc: "补足阅读缺口" },
      { mode: "bridge", title: "桥梁", desc: "从熟悉走向陌生" },
      { mode: "adventure", title: "冒险", desc: "刻意打破信息茧房" },
      { mode: "stretch", title: "拓展", desc: "相邻但没读过的领域" },
      { mode: "contrarian", title: "反向", desc: "刻意读一点相反的观点" },
    ];

    let shown = 0;
    for (const group of groups) {
      const items = analysis.recommendations.filter((item) => item.mode === group.mode);
      if (items.length === 0) continue;
      shown += items.length;

      const section = root.createDiv({ cls: "abs-ai-section" });
      const heading = section.createDiv({ cls: "abs-ai-section-head" });
      heading.createEl("h3", { text: group.title });
      heading.createDiv({ cls: "abs-ai-section-desc", text: group.desc });

      const list = section.createDiv({ cls: "abs-ai-books" });
      for (const item of items) {
        const card = list.createDiv({ cls: `abs-ai-book abs-ai-book--${group.mode}` });
        card.createDiv({ cls: "abs-ai-book-title", text: item.title });
        if (item.author) card.createDiv({ cls: "abs-ai-book-author", text: item.author });
        if (item.reason) card.createDiv({ cls: "abs-ai-book-reason", text: item.reason });
        if (item.tags?.length) {
          const tags = card.createDiv({ cls: "abs-ai-book-tags" });
          for (const tag of item.tags.slice(0, 3)) {
            tags.createSpan({ cls: "abs-ai-tag", text: tag });
          }
        }
      }
    }

    if (shown === 0) {
      root.createDiv({
        cls: "abs-ai-hint",
        text: "还没有具体书目。配置 API 后可以让模型推荐；本地模式只在「数据」里给出画像。",
      });
    }

    if (this.options.apiKey) {
      const chat = root.createDiv({ cls: "abs-ai-chat" });
      chat.createDiv({ cls: "abs-data-subtitle", text: "继续问" });
      const log = chat.createDiv({ cls: "abs-ai-chat-log" });
      const inputRow = chat.createDiv({ cls: "abs-ai-chat-input" });
      const area = inputRow.createEl("textarea", { cls: "abs-ai-chat-area" });
      area.placeholder = "例如：我下一本读什么？为什么不是别的？";
      const sendBtn = inputRow.createDiv({
        cls: "abs-ai-chat-send",
        attr: { "aria-label": "发送", role: "button", tabindex: "0" },
      });
      sendBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';

      const context = [
        analysis.summary,
        `偏好：${analysis.themes.join("、")}`,
        `盲区：${analysis.blindSpots.join("；")}`,
        `母题：${(analysis.motifs ?? []).join("、")}`,
        `推荐：${analysis.recommendations.map((item) => `《${item.title}》(${item.mode})`).join("、")}`,
      ]
        .filter(Boolean)
        .join("\n");

      const history: Array<{ role: "user" | "assistant"; content: string }> = [];

      const ask = async () => {
        const question = area.value.trim();
        if (!question) return;
        area.value = "";
        const mine = log.createDiv({ cls: "abs-ai-chat-msg is-user", text: question });
        void mine;
        const reply = log.createDiv({ cls: "abs-ai-chat-msg is-ai", text: "思考中…" });
        sendBtn.setAttribute("disabled", "true");
        try {
          const answer = await chatOnce(this.options, question, context, history);
          reply.setText(answer);
          history.push({ role: "user", content: question }, { role: "assistant", content: answer });
        } catch (error) {
          reply.setText(`出错了：${(error as Error).message}`);
        } finally {
          sendBtn.removeAttribute("disabled");
          reply.scrollIntoView({ block: "nearest" });
        }
      };

      sendBtn.addEventListener("click", () => void ask());
      area.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void ask();
        }
      });
    }
  }

  private dataCounter = 0;

  private groupHeader(_root: HTMLElement, _title: string): void {
    /* 不显示分组大标题 */
  }

  private dataSection(root: HTMLElement, title: string, _question: string): void {
    root.createDiv({ cls: "abs-data-subtitle", text: title });
  }

  private renderData(root: HTMLElement, books: LibraryBook[], analysis: Analysis): void {
    this.dataCounter = 0;
    const anyDates = books.some((book) => book.dates.length > 0);
    const startedCount = books.filter((book) => book.progress > 0).length;
    if (books.length === 0) {
      root.createDiv({ cls: "abs-ai-hint", text: "没有可统计的书。" });
      return;
    }

    const enabled = new Set(
      this.options.modules && this.options.modules.length > 0
        ? [...this.options.modules]
        : AI_MODULES.map((item) => item.id)
    );
    ["calendar", "skew", "difficulty", "engage", "history", "motifs", "graph"].forEach((id) => enabled.add(id));

    if (analysis.local) {
      this.localNote(
        root,
        "本地模式：只统计你已有的数据（数量、分布、进度、日期）。六边形、信息缺口、母题、推荐这些需要理解内容，必须接入 AI 才能给，不在这里编造。"
      );
    }

    if (enabled.has("completion")) {
      const done = books.filter((book) => normalizeBookStatus(book) === "done");
      const reading = books.filter((book) => normalizeBookStatus(book) === "reading");
      const started = [...done, ...reading];
      const rate = started.length ? Math.round((done.length / started.length) * 100) : 0;

      this.dataSection(root, "完成率", "我读完了什么？");

      const summary = root.createDiv({ cls: "abs-completion-head" });
      summary.createSpan({ cls: "abs-completion-rate", text: `${rate}%` });
      summary.createSpan({
        cls: "abs-completion-detail",
        text: `已读 ${done.length} 本 · 在读 ${reading.length} 本 · 未读 ${books.length - started.length} 本`,
      });

      const bar = root.createDiv({ cls: "abs-completion-bar" });
      const doneBar = bar.createDiv({ cls: "abs-completion-done" });
      doneBar.style.width = `${rate}%`;

      const byDomain = new Map<string, { started: number; done: number }>();
      for (const book of started) {
        const domain = classifyDomain(book);
        const entry = byDomain.get(domain) ?? { started: 0, done: 0 };
        entry.started += 1;
        if (normalizeBookStatus(book) === "done") entry.done += 1;
        byDomain.set(domain, entry);
      }

      const rows = [...byDomain.entries()]
        .filter(([label, value]) => label !== "其他" && value.started >= 2)
        .map(([label, value]) => ({
          label,
          rate: Math.round((value.done / value.started) * 100),
          started: value.started,
        }))
        .sort((a, b) => b.rate - a.rate);

      if (rows.length > 0) {
        const list = root.createDiv({ cls: "abs-chart-bars" });
        for (const row of rows) {
          const line = list.createDiv({ cls: "abs-chart-bar-row abs-chart-bar-row--domain" });
          line.createSpan({ cls: "abs-chart-bar-label", text: row.label });
          const track = line.createDiv({ cls: "abs-chart-bar-track" });
          const fill = track.createDiv({ cls: "abs-chart-bar-fill" });
          fill.style.width = `${row.rate}%`;
          fill.style.background =
            row.rate >= 70
              ? "hsl(150 30% 48%)"
              : row.rate >= 45
                ? "hsl(45 45% 52%)"
                : "hsl(4 45% 52%)";
          line.createSpan({ cls: "abs-chart-bar-value", text: `${row.rate}%` });
        }
        root.createDiv({
          cls: "abs-completion-note",
          text: "完成率 = 已读 / (已读 + 在读)。已读 = 状态为已读或进度 ≥ 95%；在读 = 状态为在读、有进度或有笔记。未读的书不计入。",
        });
      }
    }

    const trendHead = root.createDiv({ cls: "abs-ai-section-head" });
    trendHead.createEl("h3", { text: "阅读时间" });
    const trendTabs = trendHead.createDiv({ cls: "abs-ai-mini-tabs" });
    const monthBtn = trendTabs.createEl("button", { cls: "abs-ai-mini-tab is-active", text: "近 12 个月" });
    const yearBtn = trendTabs.createEl("button", { cls: "abs-ai-mini-tab", text: "按年" });

    const chartBox = root.createDiv({ cls: "abs-chart-columns" });

    const drawMonths = () => {
      monthBtn.addClass("is-active");
      yearBtn.removeClass("is-active");
      chartBox.empty();
      chartBox.addClass("is-horizontal-bars");

      const yearCount = new Map<number, number>();
      for (const book of books) {
        for (const time of book.dates) {
          const y = new Date(time).getFullYear();
          yearCount.set(y, (yearCount.get(y) ?? 0) + 1);
        }
      }
      const targetYear =
        [...yearCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear();

      chartBox.createDiv({ cls: "abs-chart-year", text: `${targetYear} 年` });

      const counts = new Array(12).fill(0);
      for (const book of books) {
        for (const time of book.dates) {
          const d = new Date(time);
          if (d.getFullYear() === targetYear) counts[d.getMonth()] += 1;
        }
      }
      const max = Math.max(1, ...counts);
      counts.forEach((count, index) => {
        const row = chartBox.createDiv({ cls: "abs-chart-hrow" });
        row.createSpan({ cls: "abs-chart-hlabel", text: `${index + 1} 月` });
        const track = row.createDiv({ cls: "abs-chart-htrack" });
        if (count > 0) {
          const fill = track.createDiv({ cls: "abs-chart-hfill" });
          fill.style.width = `${Math.max(2, (count / max) * 100)}%`;
        }
        row.createSpan({ cls: "abs-chart-hvalue", text: String(count) });
        row.title = `${targetYear} 年 ${index + 1} 月：${count} 条笔记`;
      });
    };

    const drawYears = () => {
      yearBtn.addClass("is-active");
      monthBtn.removeClass("is-active");
      chartBox.empty();
      chartBox.addClass("is-horizontal-bars");

      const years = new Map<number, number>();
      for (const book of books) {
        for (const time of book.dates) {
          const year = new Date(time).getFullYear();
          years.set(year, (years.get(year) ?? 0) + 1);
        }
      }
      const entries = [...years.entries()].sort((a, b) => a[0] - b[0]).slice(-3);
      const max = Math.max(1, ...entries.map(([, count]) => count));
      for (const [year, count] of entries) {
        const row = chartBox.createDiv({ cls: "abs-chart-hrow" });
        row.createSpan({ cls: "abs-chart-hlabel", text: String(year) });
        const track = row.createDiv({ cls: "abs-chart-htrack" });
        const fill = track.createDiv({ cls: "abs-chart-hfill" });
        fill.style.width = `${Math.max(2, (count / max) * 100)}%`;
        row.createSpan({ cls: "abs-chart-hvalue", text: String(count) });
        row.title = `${year} 年：${count} 条笔记`;
      }
    };

    monthBtn.addEventListener("click", drawMonths);
    yearBtn.addEventListener("click", drawYears);
    drawMonths();

    if (enabled.has("calendar")) {
      this.dataSection(root, "日历热力图", "我的阅读习惯稳定吗？");
      const counts = new Map<string, number>();
      for (const book of books) {
        for (const time of book.dates) {
          const d = new Date(time);
          const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const max = Math.max(1, ...counts.values());
      const grid = root.createDiv({ cls: "abs-heatmap" });
      const today = new Date();
      for (let i = 364; i >= 0; i -= 1) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        const count = counts.get(key) ?? 0;
        const cell = grid.createDiv({ cls: "abs-heat-cell" });
        const level =
          count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
        cell.dataset.level = String(level);
        cell.title = `${key}：${count} 条笔记`;
      }
      const legend = root.createDiv({ cls: "abs-heat-legend" });
      legend.createSpan({ cls: "abs-heat-legend-label", text: "少" });
      for (let level = 0; level <= 4; level += 1) {
        const cell = legend.createDiv({ cls: "abs-heat-cell abs-heat-legend-cell" });
        cell.dataset.level = String(level);
      }
      legend.createSpan({ cls: "abs-heat-legend-label", text: "多" });
      legend.createSpan({
        cls: "abs-heat-legend-text",
        text: "红得越深，当天笔记越多（1 / 2–3 / 4–6 / 7+ 条）",
      });
    }

    if (enabled.has("domain")) {
      const counts = new Map<string, number>();
      for (const book of books) {
        const domain = classifyDomain(book);
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
      }
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const total = Math.max(1, books.length);

      this.groupHeader(root, "二、我在读什么");
      this.dataSection(root, "领域分布", "我在读什么？");
      const list = root.createDiv({ cls: "abs-chart-bars" });
      for (const [label, count] of rows) {
        const color = DOMAINS.find((item) => item.label === label)?.color ?? "hsl(0 0% 45%)";
        const line = list.createDiv({ cls: "abs-chart-bar-row abs-chart-bar-row--domain" });
        line.createSpan({ cls: "abs-chart-bar-label", text: label });
        const track = line.createDiv({ cls: "abs-chart-bar-track" });
        const fill = track.createDiv({ cls: "abs-chart-bar-fill" });
        fill.style.width = `${(count / total) * 100}%`;
        fill.style.background = color;
        line.createSpan({
          cls: "abs-chart-bar-value",
          text: `${Math.round((count / total) * 100)}%`,
        });
      }
    }

    if (enabled.has("topics")) {
      this.renderTopics(root, books, analysis);
    }

    if (enabled.has("engage")) {
      this.dataSection(root, "投入度", "哪些书真正改变了我？");
      const ranked = books
        .map((book) => ({
          title: book.title,
          score: book.highlights * 3 + Math.round(book.progress / 10),
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      if (ranked.length > 0) {
        const maxScore = ranked[0].score;
        const list = root.createDiv({ cls: "abs-chart-bars" });
        for (const row of ranked) {
          const line = list.createDiv({ cls: "abs-chart-bar-row abs-engage-row" });
          line.createSpan({ cls: "abs-chart-bar-label", text: row.title.slice(0, 12) });
          const track = line.createDiv({ cls: "abs-chart-bar-track" });
          const fill = track.createDiv({ cls: "abs-chart-bar-fill" });
          fill.style.width = `${(row.score / maxScore) * 100}%`;
          line.createSpan({ cls: "abs-chart-bar-value", text: String(row.score) });
        }
        root.createDiv({ cls: "abs-completion-note", text: "投入度 = 划线数 × 3 + 阅读进度 ÷ 10。" });
      }
    }

    if (enabled.has("types")) this.renderTypeDonut(root, books);

    if (enabled.has("sources")) this.renderSourceSplit(root, books);
  }

  /** 主题热度：AI 归纳的每本书主题，聚合成「反复出现的主题 + 最近一次」 */
  private renderTopics(root: HTMLElement, books: LibraryBook[], analysis: Analysis): void {
    const head = root.createDiv({ cls: "abs-data-head" });
    head.createDiv({ cls: "abs-data-subtitle", text: "主题热度" });

    if (analysis.local) {
      root.createDiv({
        cls: "abs-ai-hint",
        text: "本地模式不猜主题。接上 API 重新分析后，这里会按书名归纳主题，再统计每个主题出现了几本、最近一次是什么时候。",
      });
      return;
    }

    const entries = analysis.bookTopics ?? [];
    const { rows, matched } = buildTopicRows(books, entries);

    if (rows.length === 0) {
      root.createDiv({
        cls: "abs-ai-hint",
        text:
          entries.length === 0
            ? "这次分析是旧缓存，里面还没有主题数据。可以单独生成一次，只发书名和作者，不用重跑整份分析。"
            : "AI 这次给的主题没能对上清单里的书，先跳过这一块，不硬凑。",
      });
      if (entries.length === 0 && this.options.apiKey) {
        const button = root.createEl("button", {
          cls: "abs-topic-generate",
          text: "生成主题",
        });
        button.addEventListener("click", () => {
          void this.generateTopics(root, books, analysis, button);
        });
      }
      return;
    }

    const seg = head.createDiv({ cls: "abs-ai-mini-tabs" });
    const buttons: HTMLButtonElement[] = [];
    const paintButton = (button: HTMLButtonElement) => {
      button.toggleClass(
        "is-active",
        this.topicView === (button.dataset.view as "bars" | "cards")
      );
    };

    const body = root.createDiv({ cls: "abs-topic-body" });
    const paint = () => {
      body.empty();
      const max = Math.max(1, ...rows.map((row) => row.count));

      if (this.topicView === "cards") {
        const grid = body.createDiv({ cls: "abs-topic-cards" });
        for (const row of rows) {
          const card = grid.createDiv({ cls: "abs-topic-card" });
          card.createDiv({ cls: "abs-topic-card-name", text: row.name });
          const num = card.createDiv({ cls: "abs-topic-card-num" });
          num.createSpan({ text: String(row.count) });
          num.createSpan({ cls: "abs-topic-card-unit", text: "本" });
          card.createDiv({
            cls: "abs-topic-card-when",
            text: row.last === null ? "日期未知" : `最近 ${formatMonth(row.last)}`,
          });
        }
      } else {
        const list = body.createDiv({ cls: "abs-chart-bars" });
        for (const row of rows) {
          const line = list.createDiv({ cls: "abs-topic-row" });
          line.createSpan({ cls: "abs-chart-bar-label abs-topic-name", text: row.name });
          const track = line.createDiv({ cls: "abs-chart-bar-track" });
          const fill = track.createDiv({ cls: "abs-chart-bar-fill" });
          fill.style.width = `${(row.count / max) * 100}%`;
          line.createSpan({ cls: "abs-chart-bar-value abs-topic-count", text: `${row.count} 本` });
          line.createSpan({
            cls: "abs-topic-when",
            text: row.last === null ? "日期未知" : `最近 ${formatMonth(row.last)}`,
          });
        }
      }
    };

    for (const view of ["cards", "bars"] as const) {
      const button = seg.createEl("button", {
        cls: "abs-ai-mini-tab",
        text: view === "bars" ? "条形" : "卡片",
      });
      button.dataset.view = view;
      paintButton(button);
      button.addEventListener("click", () => {
        this.topicView = view;
        buttons.forEach(paintButton);
        paint();
        void this.bridge?.save({ themeView: view });
      });
      buttons.push(button);
    }

    paint();

    const unknown = rows.filter((row) => row.last === null).length;
    if (unknown > 0) {
      root.createDiv({
        cls: "abs-completion-note",
        text: "标「日期未知」的书还没读到日期：苹果图书重新同步一次就会补上 lastRead。",
      });
    }
    if (matched < entries.length) {
      root.createDiv({
        cls: "abs-completion-note",
        text: `还有 ${entries.length - matched} 本没对上书名，没有计入。`,
      });
    }
  }

  /** 旧缓存没有主题时，单独生成一次并写回缓存 */
  private async generateTopics(
    root: HTMLElement,
    books: LibraryBook[],
    analysis: Analysis,
    button: HTMLButtonElement
  ): Promise<void> {
    if (button.disabled) return;
    button.disabled = true;
    button.setText("生成中…");
    try {
      const topics = await fetchBookTopics(this.options, books);
      analysis.bookTopics = topics;
      const cache = this.options.cache;
      if (cache) {
        cache.analysis.bookTopics = topics;
        void this.options.saveCache?.(cache);
      }
      root.empty();
      this.renderData(root, books, analysis);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(message);
      button.disabled = false;
      button.setText("重试");
      root.createDiv({ cls: "abs-completion-note", text: message });
    }
  }

  /** 类型比例环形图 */
  private renderTypeDonut(root: HTMLElement, books: LibraryBook[]): void {
    root.createDiv({ cls: "abs-data-subtitle", text: "类型比例" });
    const buckets: Array<{ label: string; test: RegExp; count: number; color: string }> = [
      {
        label: "文学小说",
        test: /文学|小说|诗|散文|戏剧|故事|作品|经典|文集|随笔|译文|作家/,
        count: 0,
        color: "hsl(96 32% 58%)",
      },
      {
        label: "人文社科",
        test: /社会|哲学|思想|历史|政治|人类|性别|宗教|经济|文化|心理|传记|纪实|访谈|制度/,
        count: 0,
        color: "hsl(200 34% 50%)",
      },
      {
        label: "科学自然",
        test: /科学|物理|数学|生物|自然|计算机|技术|编程|医学|天文|地理|科普|演化/,
        count: 0,
        color: "hsl(258 30% 46%)",
      },
      {
        label: "艺术图像",
        test: /艺术|绘画|摄影|设计|美术|建筑|音乐|电影|画册|图像|视觉/,
        count: 0,
        color: "hsl(320 26% 44%)",
      },
    ];
    let other = 0;
    for (const book of books) {
      const haystack = `${book.title} ${book.tags.join(" ")}`;
      const hit = buckets.find((bucket) => bucket.test.test(haystack));
      if (hit) hit.count += 1;
      else other += 1;
    }
    if (other > 0) {
      buckets.push({ label: "其他", test: /./, count: other, color: "hsl(0 0% 45%)" });
    }

    const total = Math.max(1, books.length);
    const donut = root.createDiv({ cls: "abs-chart-donut" });
    let offset = 0;
    const segments: string[] = [];
    for (const bucket of buckets) {
      if (bucket.count === 0) continue;
      const fraction = bucket.count / total;
      segments.push(
        `<circle r="42" cx="60" cy="60" fill="none" stroke="${bucket.color}" stroke-width="20" stroke-dasharray="${(fraction * 264).toFixed(1)} 264" stroke-dashoffset="${(-offset * 264).toFixed(1)}" transform="rotate(-90 60 60)"/>`
      );
      offset += fraction;
    }
    donut.innerHTML = `<svg viewBox="0 0 120 120">${segments.join("")}</svg>`;

    const legendBox = donut.createDiv({ cls: "abs-chart-legend" });
    for (const bucket of buckets) {
      if (bucket.count === 0) continue;
      const row = legendBox.createDiv({ cls: "abs-chart-legend-row" });
      const dot = row.createSpan({ cls: "abs-chart-dot" });
      dot.style.background = bucket.color;
      row.createSpan({ text: `${bucket.label} ${bucket.count}` });
    }
  }

  /** 来源比例：苹果 vs 微信 */
  private renderSourceSplit(root: HTMLElement, books: LibraryBook[]): void {
    root.createDiv({ cls: "abs-data-subtitle", text: "来源比例" });
    const total = Math.max(1, books.length);
    const apple = books.filter((book) => book.source === "苹果图书").length;
    const weread = books.length - apple;
    const sourceBar = root.createDiv({ cls: "abs-chart-split" });
    const appleBar = sourceBar.createDiv({ cls: "abs-chart-split-part" });
    appleBar.style.width = `${(apple / total) * 100}%`;
    appleBar.style.background = "hsl(200 34% 52%)";
    appleBar.setText(`苹果 ${apple}`);
    const wereadBar = sourceBar.createDiv({ cls: "abs-chart-split-part" });
    wereadBar.style.width = `${(weread / total) * 100}%`;
    wereadBar.style.background = "hsl(150 30% 48%)";
    wereadBar.setText(`微信 ${weread}`);
  }

  async onOpen(): Promise<void> {
    await this.run();
  }

  onClose(): void {
    this.stopTimer();
    this.contentEl.empty();
  }
}

export function importCopilotSettings(raw: string): Partial<AiOptions> {
  try {
    const data = JSON.parse(raw) as Record<string, string>;
    if (data.deepseekApiKey) {
      return {
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: data.deepseekApiKey,
        model: "deepseek-chat",
      };
    }
    if (data.openRouterAiApiKey) {
      return {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: data.openRouterAiApiKey,
        model: data.defaultModelKey?.split("|")[0] ?? "openai/gpt-4o-mini",
      };
    }
    if (data.openAIApiKey) {
      return {
        baseUrl: "https://api.openai.com/v1",
        apiKey: data.openAIApiKey,
        model: "gpt-4o-mini",
      };
    }
  } catch {
    /* 忽略 */
  }
  return {};
}
