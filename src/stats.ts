import { App, Modal, TFile, normalizePath } from "obsidian";

interface BookStat {
  title: string;
  source: "apple" | "weread";
  highlights: number;
  notes: number;
  chapters: number;
}

export interface ReadingStats {
  books: number;
  highlights: number;
  notes: number;
  chapters: number;
  appleBooks: number;
  wereadBooks: number;
  recent: number;
  months: Array<{ key: string; label: string; count: number }>;
  top: BookStat[];
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

export async function computeReadingStats(
  app: App,
  appleDir: string,
  wereadDir: string
): Promise<ReadingStats> {
  const dirs: Array<{ dir: string; source: "apple" | "weread" }> = [
    { dir: normalizePath(appleDir), source: "apple" },
    { dir: normalizePath(wereadDir), source: "weread" },
  ];

  const now = new Date();
  const months: Array<{ key: string; label: string; count: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: monthKey(date),
      label: date.getMonth() === 0 ? `${date.getFullYear()}` : `${date.getMonth() + 1}月`,
      count: 0,
    });
  }
  const monthIndex = new Map(months.map((month, index) => [month.key, index]));

  const stats: ReadingStats = {
    books: 0,
    highlights: 0,
    notes: 0,
    chapters: 0,
    appleBooks: 0,
    wereadBooks: 0,
    recent: 0,
    months,
    top: [],
  };

  const books: BookStat[] = [];

  for (const { dir, source } of dirs) {
    if (!dir) continue;
    const files = app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${dir}/`));

    for (const file of files) {
      let text: string;
      try {
        text = await app.vault.read(file);
      } catch {
        continue;
      }
      const frontmatter = parseFrontmatter(text);
      const highlightCount =
        (text.match(/<span class="abs-time">/g) ?? []).length +
        (text.match(/\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\]\(/g) ?? []).length;
      const noteCount = (text.match(/\[!absnote\]/g) ?? []).length;
      const chapterCount = (text.match(/^## /gm) ?? []).length;

      stats.books += 1;
      stats.highlights += highlightCount;
      stats.notes += noteCount;
      stats.chapters += chapterCount;
      if (source === "apple") stats.appleBooks += 1;
      else stats.wereadBooks += 1;

      const datePatterns = [
        /<span class="abs-time">\[(\d{4})-(\d{2})-(\d{2})/g,
        /\[(\d{4})-(\d{2})-(\d{2})[ T]/g,
      ];
      for (const dateRe of datePatterns) {
        for (const match of text.matchAll(dateRe)) {
          const index = monthIndex.get(`${match[1]}-${match[2]}`);
          if (index !== undefined) months[index].count += 1;
        }
      }

      const lastReadRaw = frontmatter.lastRead ?? frontmatter.lastReadDate ?? "";
      const lastRead = Date.parse(lastReadRaw);
      const stamp = Number.isNaN(lastRead) ? file.stat.mtime : lastRead;
      stats.recent = Math.max(stats.recent, stamp);

      books.push({
        title: frontmatter.title || file.basename,
        source,
        highlights: highlightCount,
        notes: noteCount,
        chapters: chapterCount,
      });
    }
  }

  stats.top = books
    .slice()
    .sort((a, b) => b.highlights - a.highlights)
    .slice(0, 6);

  return stats;
}

function relative(timestamp: number): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

export class ReadingStatsModal extends Modal {
  private appleDir: string;
  private wereadDir: string;

  constructor(app: App, appleDir: string, wereadDir: string) {
    super(app);
    this.appleDir = appleDir;
    this.wereadDir = wereadDir;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-stats-modal");
    contentEl.createEl("h2", { text: "阅读统计" });
    contentEl.createDiv({ cls: "abs-stats-loading", text: "统计中…" });

    const stats = await computeReadingStats(this.app, this.appleDir, this.wereadDir);
    contentEl.empty();
    contentEl.createEl("h2", { text: "阅读统计" });
    contentEl.createDiv({
      cls: "abs-stats-sub",
      text: `苹果图书 ${stats.appleBooks} 本 · 微信读书 ${stats.wereadBooks} 本 · 最近阅读 ${relative(
        stats.recent
      )}`,
    });

    const kpis = contentEl.createDiv({ cls: "abs-kpi-grid" });
    const addKpi = (value: number | string, label: string) => {
      const card = kpis.createDiv({ cls: "abs-kpi" });
      card.createDiv({ cls: "abs-kpi-value", text: String(value) });
      card.createDiv({ cls: "abs-kpi-label", text: label });
    };

    addKpi(stats.books, "本书");
    addKpi(stats.highlights, "条划线");
    addKpi(stats.notes, "条评论");
    addKpi(stats.chapters, "个章节");

    contentEl.createEl("h3", { text: "近 12 个月划线" });
    const chart = contentEl.createDiv({ cls: "abs-chart" });
    const max = Math.max(1, ...stats.months.map((month) => month.count));
    for (const month of stats.months) {
      const column = chart.createDiv({ cls: "abs-chart-col" });
      column.setAttribute("title", `${month.label}：${month.count} 条`);
      column.createDiv({ cls: "abs-chart-value", text: String(month.count) });
      if (month.count > 0) {
        const bar = column.createDiv({ cls: "abs-chart-bar" });
        bar.style.height = `${Math.max(2, Math.round((month.count / max) * 100))}%`;
      }
      column.createDiv({ cls: "abs-chart-label", text: month.label });
      // 触屏没有 hover：点一下也能看到数量
      column.addEventListener("click", () => {
        const wasOpen = column.hasClass("is-open");
        chart
          .querySelectorAll(".abs-chart-col.is-open")
          .forEach((item) => item.removeClass("is-open"));
        if (!wasOpen) column.addClass("is-open");
      });
    }

    if (stats.top.length > 0) {
      contentEl.createEl("h3", { text: "划线最多的书" });
      const list = contentEl.createDiv({ cls: "abs-top-list" });
      for (const book of stats.top) {
        const row = list.createDiv({ cls: "abs-top-row" });
        row.createDiv({ cls: "abs-top-title", text: book.title });
        row.createDiv({
          cls: "abs-top-meta",
          text: `${book.highlights} 条划线 · ${book.notes} 条评论`,
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function isBookNote(app: App, file: TFile, dirs: string[]): boolean {
  return dirs.some((dir) => dir && file.path.startsWith(`${normalizePath(dir)}/`));
}
