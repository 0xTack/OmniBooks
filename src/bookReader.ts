import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import type AppleBooksShelfPlugin from "../main";
import { openExternal } from "./external";

export const VIEW_TYPE_BOOK_READER = "abs-book-reader";

interface HighlightItem {
  time: string;
  link: string | null;
  text: string;
  note: string;
}

interface Chapter {
  title: string;
  items: HighlightItem[];
}

interface ParsedBook {
  title: string;
  author: string;
  cover: string;
  chapters: Chapter[];
  highlights: number;
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

function parseBookNote(markdown: string): ParsedBook {
  const frontmatter = parseFrontmatter(markdown);
  const lines = markdown.split("\n");
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end !== -1) bodyStart = end + 1;
  }

  const chapters: Chapter[] = [];
  let current: Chapter = { title: "", items: [] };

  let item: HighlightItem | null = null;
  let noteMode = false;

  const flush = () => {
    if (!item) return;
    item.text = item.text.trim();
    item.note = item.note.trim();
    if (item.text || item.note) current.items.push(item);
    item = null;
    noteMode = false;
  };

  const ensureChapter = (title: string) => {
    flush();
    if (current.items.length > 0 || current.title) chapters.push(current);
    current = { title, items: [] };
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      ensureChapter(line.slice(3).trim());
      continue;
    }

    if (line.trim() === "---") continue;

    // 行尾时间戳：正文 —— [2026-05-26 21:41](<weread://...>)
    const inlineStamp = /^(.*?)\s*——\s*\[([^\]]+)\]\((<[^>]+>|[^)]+)\)\s*$/.exec(line);
    if (inlineStamp) {
      flush();
      item = {
        time: inlineStamp[2],
        link: inlineStamp[3].replace(/^<|>$/g, ""),
        text: inlineStamp[1].trim(),
        note: "",
      };
      noteMode = false;
      continue;
    }

    const timeSpan = /<span class="abs-time">([\s\S]*?)<\/span>/.exec(line);
    const bareLink = timeSpan
      ? null
      : /^\s*(\[[^\]]+\]\(\s*(?:<[^>]+>|[^)]+)\s*\))\s*$/.exec(line);
    if (timeSpan || bareLink) {
      flush();
      const inner = timeSpan ? timeSpan[1] : (bareLink as RegExpExecArray)[1];
      const link = /\[([^\]]+)\]\(\s*(<[^>]+>|[^)]+)\s*\)/.exec(inner);
      item = {
        time: link ? link[1] : inner.replace(/<[^>]+>/g, "").trim(),
        link: link ? link[2].replace(/^<|>$/g, "") : null,
        text: "",
        note: "",
      };
      noteMode = false;
      continue;
    }

    const quoteCallout = /^>\s*\[!quote\][-+]?\s*(.*)$/.exec(line);
    if (quoteCallout) {
      flush();
      const inner = quoteCallout[1].trim();
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(inner);
      item = {
        time: link ? link[1] : inner,
        link: link ? link[2].replace(/^<|>$/g, "") : null,
        text: "",
        note: "",
      };
      noteMode = false;
      continue;
    }

    if (/^>\s*\[!absnote\]/.test(line) || /^>\s*\[!note\]/.test(line)) {
      noteMode = true;
      if (!item) {
        item = { time: "", link: null, text: "", note: "" };
      }
      continue;
    }

    if (line.startsWith(">")) {
      const content = line.replace(/^>\s?/, "");
      if (!item) continue;
      if (noteMode) {
        item.note += (item.note ? "\n" : "") + content;
      } else {
        item.text += (item.text ? "\n" : "") + content;
      }
      continue;
    }

    if (line.trim() === "") {
      continue;
    }

    if (!item) {
      item = { time: "", link: null, text: "", note: "" };
    }
    if (noteMode) {
      item.note += (item.note ? "\n" : "") + line;
    } else {
      item.text += (item.text ? "\n" : "") + line;
    }
  }

  flush();
  if (current.items.length > 0 || current.title) chapters.push(current);

  const nonEmpty = chapters.filter((chapter) => chapter.items.length > 0);
  return {
    title: frontmatter.title || "",
    author: frontmatter.author || "",
    cover: frontmatter.cover || "",
    chapters: nonEmpty,
    highlights: nonEmpty.reduce((sum, chapter) => sum + chapter.items.length, 0),
  };
}

const RAW_SEPARATOR = "\n\n<!-- ===== 下一本 ===== -->\n\n";

export class BookReaderView extends ItemView {
  private filePaths: string[] = [];
  private mode: "read" | "edit" = "read";
  private rawTexts: string[] = [];
  private plugin: AppleBooksShelfPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: AppleBooksShelfPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_BOOK_READER;
  }

  getDisplayText(): string {
    return "阅读";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.containerEl.removeClass("abs-reader-editing");
    this.contentEl.removeClass("abs-reader-editing");
    this.containerEl.parentElement?.removeClass("abs-reader-editing");
    this.containerEl.findAll(".abs-edit-badge").forEach((el) => el.remove());
  }

  async setBook(files: TFile[]): Promise<void> {
    this.filePaths = files.map((file) => file.path);
    this.plugin.rememberBookFile(files[0] ?? null);
    await this.render();
  }

  private modeBtnEl: HTMLElement | null = null;
  private favorites = new Set<string>();
  private favoritesLoaded = false;
  private saveTimer: number | null = null;

  private favoriteFilePath(): string {
    return normalizePath(
      this.plugin.settings.quotesFilePath || "OmniBooks/阅读/金句.md"
    );
  }

  private normalizeQuote(text: string): string {
    return text
      .replace(/\s+/g, "")
      .replace(/[，。！？；：、“”‘’（）《》…—\-,.!?;:'"()]/g, "");
  }

  private quoteFromLine(line: string): string {
    const body = line.replace(/^-\s*/, "").trim();
    const withoutDate = body.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, "");
    const at = withoutDate.lastIndexOf(" ——");
    return (at > 0 ? withoutDate.slice(0, at) : withoutDate).trim();
  }

  private async loadFavorites(force = false): Promise<void> {
    if (this.favoritesLoaded && !force) return;
    this.favoritesLoaded = true;
    this.favorites.clear();
    try {
      const raw = await this.app.vault.adapter.read(this.favoriteFilePath());
      for (const line of raw.split("\n")) {
        if (!line.startsWith("- ")) continue;
        const text = this.quoteFromLine(line);
        if (text) this.favorites.add(this.normalizeQuote(text));
      }
    } catch {
      /* 文件还不存在 */
    }
  }

  private async ensureFavoriteFile(): Promise<TFile | null> {
    const path = this.favoriteFilePath();
    const folder = path.split("/").slice(0, -1).join("/");
    try {
      if (folder && !(await this.app.vault.adapter.exists(folder))) {
        await this.app.vault.createFolder(folder);
      }
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      return await this.app.vault.create(path, "# 金句收藏\n\n");
    } catch {
      return null;
    }
  }

  /** 收藏 / 取消收藏；返回收藏后的状态 */
  private async toggleFavorite(
    text: string,
    title: string,
    link: string
  ): Promise<boolean> {
    const key = this.normalizeQuote(text);
    if (!key) return false;

    const file = await this.ensureFavoriteFile();
    if (!file) {
      new Notice("收藏文件创建失败，请检查路径");
      return false;
    }

    const raw = await this.app.vault.read(file);
    const lines = raw.split("\n");
    const index = lines.findIndex(
      (line) => line.startsWith("- ") && this.normalizeQuote(this.quoteFromLine(line)) === key
    );

    if (index >= 0) {
      lines.splice(index, 1);
      await this.app.vault.modify(file, lines.join("\n"));
      this.favorites.delete(key);
      return false;
    }

    const date = new Date().toISOString().slice(0, 10);
    lines.push(`- ${text.trim()}`);
    lines.push(`  <sub>《${title}》 · ${date}</sub>`);
    await this.app.vault.modify(file, lines.join("\n"));
    this.favorites.add(key);
    return true;
  }

  private async saveRaw(text: string): Promise<void> {
    const parts = text.split(RAW_SEPARATOR);
    for (let i = 0; i < this.filePaths.length; i += 1) {
      const file = this.app.vault.getAbstractFileByPath(this.filePaths[i]);
      if (!(file instanceof TFile)) continue;
      const content = parts[i] ?? "";
      if (content === (await this.app.vault.read(file))) continue;
      await this.app.vault.modify(file, content);
    }
  }

  private resolveCover(raw: string): string | null {
    const value = raw.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;

    const target =
      this.app.metadataCache.getFirstLinkpathDest(value, this.filePaths[0] ?? "") ??
      this.app.vault.getAbstractFileByPath(normalizePath(value));

    if (target instanceof TFile) {
      try {
        return this.app.vault.adapter.getResourcePath(target.path);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** 设置改变后即时重绘（不改当前打开的书） */
  rerender(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("abs-reader");
    root.addClass(`abs-reader--${this.plugin.settings.readerDensity}`);
    this.containerEl.removeClass("abs-reader-editing");
    root.removeClass("abs-reader-editing");
    const frame = this.containerEl.parentElement;
    frame?.toggleClass(
      "abs-reader-editing",
      this.mode === "edit" && this.plugin.settings.editHighlight !== false
    );
    this.containerEl.findAll(".abs-edit-badge").forEach((el) => el.remove());

    if (this.filePaths.length === 0) {
      root.createDiv({ cls: "abs-reader-empty", text: "从书架里点一本书开始阅读" });
      return;
    }

    const parsed: ParsedBook[] = [];
    this.rawTexts = [];
    for (const filePath of this.filePaths) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;
      const markdown = await this.app.vault.read(file);
      this.rawTexts.push(markdown);
      parsed.push(parseBookNote(markdown));
    }

    if (parsed.length === 0) {
      root.createDiv({ cls: "abs-reader-empty", text: "找不到这本书的笔记" });
      return;
    }

    const book: ParsedBook = {
      title: parsed[0].title,
      author: parsed.find((item) => item.author)?.author ?? "",
      cover: parsed.find((item) => item.cover)?.cover ?? "",
      chapters: [],
      highlights: 0,
    };

    const chapterMap = new Map<string, Chapter>();
    for (const item of parsed) {
      for (const chapter of item.chapters) {
        const key = chapter.title.trim();
        const existing = chapterMap.get(key);
        if (existing) {
          existing.items.push(...chapter.items);
        } else {
          const copy: Chapter = { title: chapter.title, items: [...chapter.items] };
          chapterMap.set(key, copy);
          book.chapters.push(copy);
        }
      }
      book.highlights += item.highlights;
    }

    await this.loadFavorites();

    const header = root.createDiv({ cls: "abs-reader-header" });
    const coverUrl = this.resolveCover(book.cover);
    if (coverUrl) {
      const img = header.createEl("img", { cls: "abs-reader-cover" });
      img.src = coverUrl;
      img.alt = book.title;
    }

    const info = header.createDiv({ cls: "abs-reader-info" });
    info.createEl("h1", { cls: "abs-reader-title", text: book.title || this.filePaths[0]?.split("/").pop()?.replace(/\.md$/, "") || "阅读" });
    if (book.author) info.createDiv({ cls: "abs-reader-author", text: book.author });
    info.createDiv({
      cls: "abs-reader-stats",
      text: `${book.chapters.length} 章 · ${book.highlights} 条摘录`,
    });

    // 铅笔固定在面板右上角，不随内容滚动
    this.modeBtnEl?.remove();
    if (getComputedStyle(this.containerEl).position === "static") {
      this.containerEl.setCssStyles({ position: "relative" });
    }
    const modeBtn = this.containerEl.createEl("button", {
      cls: "clickable-icon abs-reader-mode abs-reader-mode--top",
      attr: {
        "aria-label": this.mode === "read" ? "编辑划线" : "返回阅读",
        title: this.mode === "read" ? "编辑划线" : "返回阅读",
        type: "button",
      },
    });
    this.modeBtnEl = modeBtn;
    setIcon(modeBtn, this.mode === "read" ? "pencil" : "book-open");
    modeBtn.addEventListener("click", () => {
      this.mode = this.mode === "read" ? "edit" : "read";
      void this.render();
    });

    if (this.mode === "edit") {
      const bar = root.createDiv({ cls: "abs-inline-savebar" });
      bar.createSpan({ cls: "abs-inline-editing-label", text: "编辑中" });
      bar.createDiv({
        cls: "abs-inline-savehint",
        text: "直接改划线或想法，保存后写回笔记。",
      });
      const cancel = bar.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => {
        this.mode = "read";
        void this.render();
      });
      const save = bar.createEl("button", {
        cls: "mod-cta",
        text: "保存",
      });
      save.addEventListener("click", () => {
        void this.saveInlineEdits(root);
      });
      root.prepend(bar);
    }

    if (book.chapters.length === 0) {
      root.createDiv({
        cls: "abs-reader-empty",
        text: "这本书还没有划线或想法。",
      });
      return;
    }

    const body = root.createDiv({ cls: "abs-reader-body" });

    for (const chapter of book.chapters) {
      const section = body.createDiv({ cls: "abs-reader-chapter" });
      if (chapter.title) section.createEl("h2", { text: chapter.title });

      for (const item of chapter.items) {
        const article = section.createDiv({ cls: "abs-reader-item" });
        if (this.mode === "edit") article.addClass("is-editing");

        if (item.time && this.plugin.settings.readerShowTime) {
          const meta = article.createDiv({ cls: "abs-reader-meta" });
          if (item.link) {
            const link = meta.createEl("a", { text: item.time, href: item.link });
            link.setAttribute("aria-label", "在苹果图书中打开");
          } else {
            meta.setText(item.time);
          }
        }

        if (this.mode === "edit") {
          const autosize = (area: HTMLTextAreaElement) => {
            area.setCssStyles({ height: "auto" });
            area.setCssStyles({ height: `${area.scrollHeight}px` });
          };
          if (item.link) {
            const textArea = article.createEl("textarea", {
              cls: "abs-inline-text",
              attr: {
                "data-link": item.link,
                placeholder: "划线内容",
                rows: "1",
              },
            });
            textArea.value = item.text;
            autosize(textArea);
            textArea.addEventListener("input", () => autosize(textArea));
          } else {
            article.createDiv({ cls: "abs-reader-quote", text: item.text });
          }
          const noteArea = article.createEl("textarea", {
            cls: "abs-inline-note",
            attr: { placeholder: "写点什么…", rows: "1" },
          });
          noteArea.value = item.note;
          autosize(noteArea);
          noteArea.addEventListener("input", () => autosize(noteArea));
        } else {
        if (item.text) {
          article.createDiv({ cls: "abs-reader-quote", text: item.text });
          if (item.link) {
            const shareBtn = article.createDiv({
              cls: "abs-share-btn",
              attr: {
                role: "button",
                tabindex: "0",
                "aria-label": "在原书中打开",
                title: "在原书中打开",
              },
            });
            setIcon(shareBtn, "share-2");
            const openSource = (event: Event) => {
              event.stopPropagation();
              if (!item.link) return;
              shareBtn.addClass("is-busy");
              window.setTimeout(() => shareBtn.removeClass("is-busy"), 1500);
              openExternal(item.link);
            };
            shareBtn.addEventListener("click", openSource);
            shareBtn.addEventListener("keydown", (event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openSource(event);
              }
            });
          }
          const heart = article.createDiv({
            cls: "abs-heart",
            attr: { "aria-label": "收藏这句", role: "button", tabindex: "0" },
          });
          setIcon(heart, "heart");
          const favored = this.favorites.has(this.normalizeQuote(item.text));
          heart.toggleClass("is-fav", favored);
          heart.addEventListener("click", async (event: MouseEvent) => {
            event.stopPropagation();
            const on = await this.toggleFavorite(
              item.text,
              book.title,
              this.filePaths[0] ? `[[${this.filePaths[0].replace(/\.md$/, "")}]]` : ""
            );
            heart.toggleClass("is-fav", on);
            new Notice(on ? "已收藏到金句" : "已取消收藏");
          });

          const commentBtn = article.createDiv({
            cls: "abs-comment-btn",
            attr: { role: "button", tabindex: "0", "aria-label": "添加评论" },
          });
          setIcon(commentBtn, "message-square");
          commentBtn.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            this.openInlineComment(article, item, book.title);
          });
        }
        if (item.note) article.createDiv({ cls: "abs-reader-note", text: item.note });
        }
      }
    }

    this.attachSelectionToolbar(root, book.title);
  }

  /** 阅读视图内直接编辑划线/想法，保存回原笔记 */
  private async saveInlineEdits(root: HTMLElement): Promise<void> {
    const edits = Array.from(
      root.querySelectorAll<HTMLTextAreaElement>("textarea.abs-inline-text")
    )
      .map((area) => {
        const article = area.closest(".abs-reader-item");
        const note = article?.querySelector<HTMLTextAreaElement>(
          "textarea.abs-inline-note"
        );
        return {
          link: area.dataset.link ?? "",
          text: area.value,
          note: note?.value ?? "",
        };
      })
      .filter((edit) => edit.link);

    if (edits.length === 0) {
      this.mode = "read";
      void this.render();
      return;
    }

    let changed = 0;
    try {
      for (const filePath of this.filePaths) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) continue;
        const before = await this.app.vault.read(file);
        let raw = before;

        for (const edit of edits) {
          if (!raw.includes(edit.link)) continue;
          const next = this.replaceItemBlock(
            raw,
            edit.link,
            edit.text,
            edit.note
          );
          if (next !== raw) {
            raw = next;
            changed += 1;
          }
        }

        if (raw !== before) await this.app.vault.modify(file, raw);
      }
    } catch (error) {
      new Notice(
        `保存失败：${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    new Notice(changed > 0 ? `已保存 ${changed} 条` : "没有变化");
    if (this.plugin.settings.exitEditAfterSave !== false) {
      this.mode = "read";
    }
    void this.render();
  }

  private replaceItemBlock(
    raw: string,
    link: string,
    text: string,
    note: string
  ): string {
    const at = raw.indexOf(link);
    if (at < 0) return raw;
    const lineEnd = raw.indexOf("\n", at);
    if (lineEnd < 0) return raw;

    const rest = raw.slice(lineEnd + 1);
    const next = /\n(?=(?:## |\[[^\]]+\]\(<[^>]+>\)))/.exec(rest);
    const blockEnd = next ? lineEnd + 1 + next.index + 1 : raw.length;

    const quote = text.trim();
    const noteText = note.trim();
    let block = "\n\n";
    if (quote) block += quote;
    block += "\n";
    if (noteText) {
      block += "\n> [!absnote]\n";
      block += noteText
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      block += "\n";
    }
    block += "\n";

    return raw.slice(0, lineEnd + 1) + block + raw.slice(blockEnd);
  }

  /** 划线旁的内联评论编辑器 */
  private openInlineComment(article: HTMLElement, item: HighlightItem, title: string): void {
    const existing = article.querySelector(".abs-comment-editor");
    if (existing) {
      existing.remove();
      return;
    }

    const box = article.createDiv({ cls: "abs-comment-editor" });
    const area = box.createEl("textarea", { cls: "abs-comment-input" });
    area.value = item.note || "";
    area.placeholder = "写点什么… ⌘Enter 保存";

    const actions = box.createDiv({ cls: "abs-comment-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存" });

    const close = () => box.remove();
    cancel.addEventListener("click", close);

    const commit = async () => {
      await this.saveComment(item, area.value);
      close();
      void this.render();
    };

    save.addEventListener("click", commit);
    area.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void commit();
    });
    window.setTimeout(() => area.focus(), 20);
  }

  /** 把评论写回原笔记的划线下方 */
  private async saveComment(item: HighlightItem, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.filePaths[0]);
    if (!(file instanceof TFile)) return;

    const raw = await this.app.vault.read(file);
    const lines = raw.split("\n");
    const needle = item.text.trim().slice(0, 40);
    const index = lines.findIndex((line) => needle && line.includes(needle));
    if (index < 0) {
      new Notice("没找到这条划线，可能笔记被改过");
      return;
    }

    let noteStart = -1;
    for (let i = index + 1; i < Math.min(lines.length, index + 14); i++) {
      if (/^>\s*\[!absnote\]/.test(lines[i])) {
        noteStart = i;
        break;
      }
      if (lines[i].trim() !== "" && !/^>/.test(lines[i])) break;
    }

    const body = text.trim();
    const block = body
      ? ["> [!absnote]", ...body.split("\n").map((line) => `> ${line}`)]
      : [];

    if (noteStart >= 0) {
      let noteEnd = noteStart + 1;
      while (noteEnd < lines.length && /^>/.test(lines[noteEnd])) noteEnd += 1;
      lines.splice(noteStart, noteEnd - noteStart, ...block);
    } else if (block.length > 0) {
      lines.splice(index + 1, 0, ...block);
    } else {
      return;
    }

    await this.app.vault.modify(file, lines.join("\n"));
    new Notice(body ? "评论已保存" : "评论已删除");
  }

  /** 选中文字后浮出：复制 / 收藏 */
  private attachSelectionToolbar(root: HTMLElement, title: string): void {
    if (!this.plugin.settings.showSelectionToolbar) return;

    const bar = root.createDiv({ cls: "abs-sel-bar" });
    const copyBtn = bar.createEl("button", { text: "复制" });
    const favBtn = bar.createEl("button", { text: "收藏" });
    bar.setCssStyles({ display: "none" });

    let currentText = "";

    const hide = () => {
      bar.setCssStyles({ display: "none" });
      currentText = "";
    };

    copyBtn.addEventListener("click", async () => {
      if (!currentText) return;
      await navigator.clipboard.writeText(currentText);
      new Notice("已复制");
      hide();
    });

    favBtn.addEventListener("click", async () => {
      if (!currentText) return;
      const on = await this.toggleFavorite(
        currentText,
        title,
        this.filePaths[0] ? `[[${this.filePaths[0].replace(/\.md$/, "")}]]` : ""
      );
      new Notice(on ? "已收藏到金句" : "这句已在收藏里");
      hide();
    });

    root.addEventListener("mouseup", () => {
      window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (!selection || selection.rangeCount === 0 || text.length < 2) {
          hide();
          return;
        }
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        const rect = range.getBoundingClientRect();
        const host = root.getBoundingClientRect();
        currentText = text;
        bar.setCssStyles({ display: "flex" });
        bar.setCssStyles({ left: `${Math.max(6, Math.min(host.width - 150, rect.left - host.left + rect.width / 2 - 70))}px` });
        bar.setCssStyles({ top: `${Math.max(6, rect.top - host.top - 42)}px` });
      }, 10);
    });

    root.addEventListener("mousedown", (event) => {
      if (!bar.contains(event.target as Node)) hide();
    });
  }
}
