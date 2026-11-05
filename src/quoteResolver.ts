import { App, TFile, normalizePath, requestUrl } from "obsidian";

export interface QuoteItem {
  text: string;
  source: string;
}

interface CacheEntry {
  quotes: QuoteItem[];
  ts: number;
}

const CACHE_TTL = 7 * 24 * 3600 * 1000;

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

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .match(/[^。！？!?]+[。！？!?]?/g)
    ?.map((sentence) => sentence.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "").trim())
    .filter((sentence) => sentence.length >= 8) ?? [];
}

export function trimToSentence(text: string, target = 50): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length <= target ? clean : `${clean.slice(0, target)}…`;
  }

  let best = sentences[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const sentence of sentences) {
    if (sentence.length > 120) continue;
    const score = Math.abs(sentence.length - target);
    if (score < bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best.length <= 120 ? best : `${best.slice(0, 80)}…`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export class QuoteResolver {
  private cache: Record<string, CacheEntry> | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private app: App,
    private apiKey: string,
    private cachePath: string
  ) {}

  private async loadCache(): Promise<Record<string, CacheEntry>> {
    if (this.cache) return this.cache;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const raw = await this.app.vault.adapter.read(this.cachePath);
          this.cache = JSON.parse(raw) as Record<string, CacheEntry>;
        } catch {
          this.cache = {};
        }
      })();
    }
    await this.loading;
    return this.cache ?? {};
  }

  private async saveCache(): Promise<void> {
    if (!this.cache) return;
    await this.app.vault.adapter
      .write(this.cachePath, JSON.stringify(this.cache))
      .catch(() => undefined);
  }

  async resolve(file: TFile): Promise<QuoteItem | null> {
    const quotes = await this.resolveMany(file);
    return quotes[0] ?? null;
  }

  async resolveMany(file: TFile): Promise<QuoteItem[]> {
    const cache = await this.loadCache();
    const key = file.path;
    const cached = cache[key];
    if (
      cached &&
      Date.now() - cached.ts < CACHE_TTL &&
      Array.isArray(cached.quotes) &&
      cached.quotes.length > 0
    ) {
      return cached.quotes;
    }

    let note = "";
    try {
      note = await this.app.vault.read(file);
    } catch {
      return [];
    }

    const frontmatter = parseFrontmatter(note);
    const title = frontmatter.title || file.basename;
    const author = frontmatter.author || "";
    const bookId = frontmatter.bookId || "";

    const collected: QuoteItem[] = [];

    if (this.apiKey && bookId) {
      collected.push(...(await this.tryWereadPopular(bookId)));
      collected.push(...(await this.tryWereadReviews(bookId)));
    }

    if (collected.length < 3) {
      collected.push(...(await this.tryWikiquote(title, author)));
    }

    collected.push(...this.localHighlights(note));

    const seen = new Set<string>();
    const quotes: QuoteItem[] = [];
    for (const item of collected) {
      const text = trimToSentence(item.text);
      if (!text || text.length < 6) continue;
      const dedupeKey = text.replace(/\s+/g, "");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      quotes.push({ text, source: item.source });
      if (quotes.length >= 5) break;
    }

    cache[key] = { quotes, ts: Date.now() };
    await this.saveCache();
    return quotes;
  }

  private localHighlights(note: string): QuoteItem[] {
    const results: QuoteItem[] = [];
    const inline = /^(.+?)\s*——\s*\[[^\]]+\]\([^)]+\)\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = inline.exec(note))) {
      const text = match[1].trim();
      if (text.length >= 6) results.push({ text, source: "我的划线" });
      if (results.length >= 4) break;
    }

    if (results.length === 0) {
      const regex =
        /(?:<span class="abs-time">[\s\S]*?<\/span>|^\[[^\]]+\]\([^)]+\))\s*\n\s*\n([^\n]+)/gm;
      while ((match = regex.exec(note))) {
        const text = match[1].trim();
        if (text.length >= 6) results.push({ text, source: "我的划线" });
        if (results.length >= 4) break;
      }
    }
    return results;
  }

  private async tryWereadPopular(bookId: string): Promise<QuoteItem[]> {
    try {
      const response = await requestUrl({
        url: "https://i.weread.qq.com/api/agent/gateway",
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_name: "/book/bestbookmarks",
          skill_version: "1.0.3",
          bookId,
          chapterUid: 0,
        }),
        throw: false,
      });
      const items =
        (response.json as { items?: Array<{ markText?: string }> })?.items ?? [];
      return items
        .map((item) => (item.markText ?? "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((text) => ({ text, source: "微信读书热门划线" }));
    } catch {
      return [];
    }
  }

  private async tryWereadReviews(bookId: string): Promise<QuoteItem[]> {
    try {
      const response = await requestUrl({
        url: "https://i.weread.qq.com/api/agent/gateway",
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_name: "/review/list",
          skill_version: "1.0.3",
          bookId,
          reviewListType: 0,
          count: 5,
        }),
        throw: false,
      });
      const reviews =
        (response.json as { reviews?: Array<{ review?: { content?: string } }> })
          ?.reviews ?? [];
      return reviews
        .map((item) => htmlToText(item.review?.content ?? ""))
        .filter((text) => text.length >= 8)
        .slice(0, 2)
        .map((text) => ({ text, source: "微信读书热评" }));
    } catch {
      return [];
    }
  }

  private async tryWikiquote(title: string, author: string): Promise<QuoteItem[]> {
    try {
      const search = await requestUrl({
        url: `https://zh.wikiquote.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          `${title} ${author}`
        )}&format=json&srlimit=3`,
        method: "GET",
        throw: false,
      });
      const results = (
        search.json as { query?: { search?: Array<{ title: string }> } }
      )?.query?.search;
      if (!results || results.length === 0) return [];

      const quotes: QuoteItem[] = [];
      for (const result of results.slice(0, 2)) {
        const page = await requestUrl({
          url: `https://zh.wikiquote.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(
            result.title
          )}&format=json`,
          method: "GET",
          throw: false,
        });
        const pages = (
          page.json as {
            query?: { pages?: Record<string, { extract?: string }> };
          }
        )?.query?.pages;
        if (!pages) continue;

        const extract = Object.values(pages)[0]?.extract ?? "";
        if (!extract) continue;

        for (const sentence of splitSentences(extract)) {
          if (sentence.includes("维基语录")) continue;
          if (sentence.length < 12) continue;
          quotes.push({ text: sentence, source: "维基语录" });
          if (quotes.length >= 3) return quotes;
        }
      }
      return quotes;
    } catch {
      return [];
    }
  }
}
