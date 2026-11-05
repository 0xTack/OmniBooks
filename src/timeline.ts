import { App, Modal, TFile, normalizePath } from "obsidian";

interface TimelineEvent {
  time: number;
  kind: "start" | "finish" | "note" | "read";
  title: string;
  author: string;
  cover: string;
  detail: string;
}

interface BookEntry {
  title: string;
  author: string;
  cover: string;
  file: TFile;
  status: string;
  progress: number;
  dates: number[];
  lastRead: number;
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

function cleanTitle(title: string): string {
  return title
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[：:]\s*$/, "")
    .trim();
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function monthLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export async function computeTimeline(
  app: App,
  dirs: string[]
): Promise<TimelineEvent[]> {
  const books = new Map<string, BookEntry>();

  for (const dir of dirs) {
    const normalized = normalizePath(dir);
    if (!normalized) continue;

    for (const file of app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${normalized}/`)) continue;

      let text: string;
      try {
        text = await app.vault.read(file);
      } catch {
        continue;
      }

      const frontmatter = parseFrontmatter(text);
      const title = cleanTitle(frontmatter.title || file.basename);
      const key = title.replace(/\s+/g, "").toLowerCase();

      const dates: number[] = [];
      const datePatterns = [
        /<span class="abs-time">\[(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/g,
        /\[(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\]\(/g,
      ];
      for (const dateRe of datePatterns) {
        let match: RegExpExecArray | null;
        while ((match = dateRe.exec(text))) {
          dates.push(
            new Date(
              Number(match[1]),
              Number(match[2]) - 1,
              Number(match[3]),
              Number(match[4]),
              Number(match[5])
            ).getTime()
          );
        }
      }
      dates.sort((a, b) => a - b);

      const lastRead = Date.parse(frontmatter.lastRead ?? frontmatter.lastReadDate ?? "");
      const existing = books.get(key);
      if (existing) {
        existing.dates.push(...dates);
        existing.dates.sort((a, b) => a - b);
        existing.lastRead = Math.max(existing.lastRead, Number.isNaN(lastRead) ? 0 : lastRead);
        continue;
      }

      books.set(key, {
        title,
        author: frontmatter.author || "",
        cover: frontmatter.cover || "",
        file,
        status: frontmatter.status || frontmatter.readingStatus || "",
        progress: Number(frontmatter.progress ?? 0) || 0,
        dates,
        lastRead: Number.isNaN(lastRead) ? 0 : lastRead,
      });
    }
  }

  const events: TimelineEvent[] = [];

  for (const book of books.values()) {
    if (book.dates.length === 0) {
      if (book.lastRead) {
        events.push({
          time: book.lastRead,
          kind: "read",
          title: book.title,
          author: book.author,
          cover: book.cover,
          detail: "阅读",
        });
      }
      continue;
    }

    const byDay = new Map<string, number[]>();
    for (const date of book.dates) {
      const key = dayKey(date);
      const list = byDay.get(key) ?? [];
      list.push(date);
      byDay.set(key, list);
    }

    for (const [key, list] of byDay) {
      const time = list[0];
      events.push({
        time,
        kind: "note",
        title: book.title,
        author: book.author,
        cover: book.cover,
        detail: list.length > 1 ? `读了 ${list.length} 段` : "读了 1 段",
      });
      void key;
    }

    const first = book.dates[0];
    events.push({
      time: first,
      kind: "start",
      title: book.title,
      author: book.author,
      cover: book.cover,
      detail: "开始阅读",
    });

    const finished =
      book.status === "已读" ||
      book.status === "3" ||
      book.status === "4" ||
      book.progress >= 100;
    if (finished) {
      events.push({
        time: book.dates[book.dates.length - 1],
        kind: "finish",
        title: book.title,
        author: book.author,
        cover: book.cover,
        detail: "读完",
      });
    }
  }

  // 同一本书在同一个月只保留第一次记录，避免时间线重复
  const seen = new Set<string>();
  const deduped = events
    .sort((a, b) => a.time - b.time)
    .filter((event) => {
      const key = event.title.replace(/\s+/g, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.time - a.time);

  return deduped;
}

function formatDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export class TimelineModal extends Modal {
  private dirs: string[];

  constructor(app: App, dirs: string[]) {
    super(app);
    this.dirs = dirs;
  }

  private coverUrl(cover: string): string | null {
    const value = cover.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(value));
    if (file instanceof TFile) {
      try {
        return this.app.vault.adapter.getResourcePath(file.path);
      } catch {
        return null;
      }
    }
    return null;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-timeline-modal");
    contentEl.createEl("h2", { text: "阅读时间线" });
    contentEl.createDiv({ cls: "abs-timeline-loading", text: "整理中…" });

    const events = await computeTimeline(this.app, this.dirs);
    contentEl.empty();
    contentEl.addClass("abs-timeline-modal");
    contentEl.createEl("h2", { text: "阅读时间线" });

    if (events.length === 0) {
      contentEl.createDiv({
        cls: "abs-timeline-loading",
        text: "还没有可以串起来的阅读记录。",
      });
      return;
    }

    contentEl.createDiv({
      cls: "abs-timeline-sub",
      text: `${events.length} 条记录 · 最近 ${formatDay(events[0].time)}`,
    });

    const first = new Date(events[0].time);
    const pin = contentEl.createDiv({ cls: "abs-tl-pin" });
    pin.setText(`${first.getFullYear()} · ${first.getMonth() + 1}`);

    const line = contentEl.createDiv({ cls: "abs-timeline" });
    let currentDay = "";
    const monthNodes: Array<{ el: HTMLElement; label: string }> = [];
    const dateNodes: Array<{ el: HTMLElement; date: HTMLElement }> = [];

    for (const event of events) {
      const date = new Date(event.time);
      const day = formatDay(event.time);

      const item = line.createDiv({ cls: `abs-tl-item abs-tl-item--${event.kind}` });
      monthNodes.push({
        el: item,
        label: `${date.getFullYear()} · ${date.getMonth() + 1}`,
      });
      // 只有每天的第一条显示日期和圆点，避免一长串重复的点和日期
      if (day !== currentDay) {
        currentDay = day;
        const dateEl = item.createDiv({ cls: "abs-tl-date", text: day });
        item.createDiv({ cls: "abs-tl-dot" });
        dateNodes.push({ el: item, date: dateEl });
      }

      const card = item.createDiv({ cls: "abs-tl-card" });
      const cover = this.coverUrl(event.cover);
      if (cover) {
        const img = card.createEl("img", { cls: "abs-tl-cover" });
        img.src = cover;
        img.alt = event.title;
        img.loading = "lazy";
      }
      const info = card.createDiv({ cls: "abs-tl-info" });
      info.createDiv({ cls: "abs-tl-title", text: event.title });
      info.createDiv({
        cls: "abs-tl-detail",
        text: `${event.detail}${event.author ? ` · ${event.author}` : ""} · ${formatTime(event.time)}`,
      });
    }

    contentEl.addEventListener("scroll", () => {
      const top = contentEl.getBoundingClientRect().top + 40;
      let label = monthNodes[0]?.label ?? "";
      for (const entry of monthNodes) {
        if (entry.el.getBoundingClientRect().top <= top) label = entry.label;
      }
      pin.setText(label);

      // 日期靠近置顶数字时提前、连续地淡出，避免突然消失
      const pinBottom = pin.getBoundingClientRect().bottom;
      const fadeRange = 96;
      for (const entry of dateNodes) {
        const distance = entry.date.getBoundingClientRect().top - pinBottom;
        const opacity = Math.max(0, Math.min(1, distance / fadeRange));
        entry.date.setCssStyles({ opacity: String(opacity) });
      }
    });

    contentEl.scrollTop = 0;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
