import { App, normalizePath, requestUrl } from "obsidian";

export const WEREAD_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.3";
const REQUEST_TIMEOUT = 12_000;

export interface WereadSyncReport {
  books: number;
  written: number;
  unchanged: number;
  failed: Array<{ title: string; error: string }>;
  outputDir: string;
  /** 接口整体不可用，本次用本地快照兜底 */
  offline?: boolean;
  /** 从本地快照补回的文件数 */
  restored?: number;
  /** 重试次数 */
  retries?: number;
  /** 本次备份的文件数 */
  backedUp?: number;
  /** 备份根目录（有备份时才有） */
  backupDir?: string;
}

export type WereadBackupMode = "off" | "sync" | "daily" | "changed";

export interface WereadSyncOptions {
  /** 自定义接口地址；留空用默认。接口失效时可填镜像或代理。 */
  gateway?: string;
  /** 本地快照路径（库内相对路径） */
  cachePath?: string;
  /** 备份方式：关闭 / 每次同步前 / 每天首次 / 只备份被改写的旧版本 */
  backupMode?: WereadBackupMode;
  /** 备份根目录（库内相对路径） */
  backupDir?: string;
  /** 保留最近多少份备份 */
  backupKeep?: number;
  onProgress?: (message: string) => void;
  onLog?: (line: string) => void;
}

interface WereadCacheEntry {
  bookId: string;
  file: string;
  markdown: string;
}

interface WereadCache {
  savedAt: number;
  entries: WereadCacheEntry[];
}

class FatalGatewayError extends Error {}


interface WereadBookEntry {
  bookId: string;
  noteCount?: number;
  reviewCount?: number;
  markedStatus?: number;
  readingProgress?: number;
  sort?: number;
  book?: {
    title?: string;
    author?: string;
    cover?: string;
    categories?: Array<{ title?: string }>;
    publisher?: string;
  };
}

interface WereadBookmark {
  chapterUid?: number;
  chapterIdx?: number;
  range?: string;
  markText?: string;
  createTime?: number;
  bookmarkId?: string;
}

interface WereadChapter {
  title?: string;
  chapterUid?: number;
  chapterIdx?: number;
}

interface WereadReview {
  review?: {
    abstract?: string;
    content?: string;
    chapterUid?: number;
    chapterIdx?: number;
    chapterName?: string;
    range?: string;
    createTime?: number;
  };
}

interface RenderedItem {
  chapterUid: number;
  chapterIdx: number;
  rangeStart: number;
  time: number;
  text: string;
  note: string;
  range: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`请求超时：${label}`)),
      REQUEST_TIMEOUT
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function gatewayCandidates(gateway?: string): string[] {
  const custom = (gateway ?? "").trim();
  return custom && custom !== WEREAD_GATEWAY ? [custom, WEREAD_GATEWAY] : [WEREAD_GATEWAY];
}

async function callGateway(
  apiKey: string,
  apiName: string,
  params: Record<string, unknown>,
  options: { gateway?: string; onRetry?: (attempt: number, reason: string) => void }
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  let attemptNo = 0;

  for (const gateway of gatewayCandidates(options.gateway)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attemptNo += 1;
      try {
        const response = await withTimeout(
          requestUrl({
            url: gateway,
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_name: apiName,
              skill_version: SKILL_VERSION,
              ...params,
            }),
            throw: false,
          }),
          apiName
        );

        const status = Number((response as { status?: number }).status ?? 200);
        if (status === 401 || status === 403) {
          throw new FatalGatewayError("API Key 无效或已过期，请重新扫码获取");
        }
        if (status === 429 || status >= 500) {
          throw new Error(`接口繁忙（HTTP ${status}）`);
        }
        if (status >= 400) {
          throw new FatalGatewayError(`接口拒绝请求（HTTP ${status}）`);
        }

        const json = response.json as Record<string, unknown> | undefined;
        if (!json) throw new Error(`微信读书接口无返回：${apiName}`);
        const errcode = json.errcode as number | undefined;
        if (errcode && errcode !== 0) {
          throw new FatalGatewayError(
            `微信读书接口错误：${(json.errmsg as string) ?? errcode}`
          );
        }
        return json;
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        lastError = failure;
        const retryable = !(failure instanceof FatalGatewayError);
        const canRetry = retryable && attempt === 0;
        if (!canRetry) break;
        options.onRetry?.(attemptNo, failure.message);
        await wait(700 * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error("微信读书接口不可用");
}

function parseRange(range: string | undefined): { start: number; end: number } {
  const match = /^(\d+)-(\d+)$/.exec(range ?? "");
  if (!match) return { start: 0, end: 0 };
  return { start: Number(match[1]), end: Number(match[2]) };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatMinuteTime(seconds: number): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTime(seconds: number): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

function shortTitle(title: string): string {
  const withoutParens = title
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return withoutParens || title;
}

function sanitizeFileName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function yaml(value: string): string {
  return JSON.stringify(value);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function deepLink(bookId: string, chapterUid: number, range: string): string {
  const { start, end } = parseRange(range);
  return `weread://bestbookmark?bookId=${encodeURIComponent(
    bookId
  )}&chapterUid=${chapterUid}&rangeStart=${start}&rangeEnd=${end}`;
}

function formatReadingTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

function renderBook(
  bookId: string,
  entry: WereadBookEntry,
  chapters: WereadChapter[],
  items: RenderedItem[],
  readingTime: string
): string {
  const title = decodeEntities(entry.book?.title?.trim() || bookId);
  const author = decodeEntities(entry.book?.author?.trim() || "");
  const cover = entry.book?.cover || "";
  const progress = Number(entry.readingProgress ?? 0);
  const status = entry.markedStatus ?? (progress >= 100 ? 3 : progress > 0 ? 2 : 1);

  const chapterTitle = new Map<number, string>();
  for (const chapter of chapters) {
    if (chapter.chapterUid === undefined) continue;
    chapterTitle.set(chapter.chapterUid, chapter.title ?? "");
  }

  const grouped = new Map<number, RenderedItem[]>();
  for (const item of items) {
    const list = grouped.get(item.chapterUid) ?? [];
    list.push(item);
    grouped.set(item.chapterUid, list);
  }

  const ordered = [...grouped.entries()].sort((a, b) => {
    const left = a[1][0]?.chapterIdx ?? 0;
    const right = b[1][0]?.chapterIdx ?? 0;
    return left - right;
  });

  const tags = new Set<string>();
  if (author) tags.add(author);
  for (const category of entry.book?.categories ?? []) {
    if (category.title) tags.add(category.title);
  }
  tags.add(title);

  const lastRead = Number(entry.sort ?? 0);
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${yaml(title)}`);
  if (author) lines.push(`author: ${yaml(author)}`);
  lines.push(`bookId: ${yaml(bookId)}`);
  lines.push(`source: "weread"`);
  lines.push(`status: ${status}`);
  lines.push(`progress: ${Math.max(0, Math.min(100, Math.round(progress)))}`);
  lines.push(`highlights: ${items.length}`);
  if (lastRead) lines.push(`lastRead: ${yaml(formatMinuteTime(lastRead))}`);
  if (readingTime) lines.push(`readingTime: ${yaml(readingTime)}`);
  if (cover) lines.push(`cover: ${yaml(cover)}`);
  lines.push("cssclasses:");
  lines.push("  - omnibooks");
  lines.push("tags:");
  for (const tag of tags) lines.push(`  - ${yaml(tag)}`);
  lines.push("---");
  lines.push("");

  for (const [chapterUid, chapterItems] of ordered) {
    chapterItems.sort((a, b) => a.rangeStart - b.rangeStart);
    const heading = chapterTitle.get(chapterUid) || chapterItems[0]?.range || "未分章";
    lines.push(`## ${heading}`);
    lines.push("");

    for (const item of chapterItems) {
      const time = formatTime(item.time);
      const link = time
        ? `[${time}](<${deepLink(bookId, chapterUid, item.range)}>)`
        : "";
      if (link) lines.push(link);
      if (item.text) lines.push(...item.text.split("\n"));
      if (link || item.text) lines.push("");
      if (item.note) {
        lines.push("> [!absnote]");
        for (const line of item.note.split("\n")) lines.push(`> ${line}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const normalized = normalizePath(folder);
  if (!normalized) return;
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch {
        /* 已存在 */
      }
    }
  }
}

async function ensureAdapterFolder(app: App, filePath: string): Promise<void> {
  const normalized = normalizePath(filePath);
  const folder = normalized.split("/").slice(0, -1).join("/");
  if (!folder) return;
  await ensureAdapterPath(app, folder);
}

async function ensureAdapterPath(app: App, folder: string): Promise<void> {
  const normalized = normalizePath(folder);
  if (!normalized) return;
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    try {
      if (!(await app.vault.adapter.exists(current))) {
        await app.vault.adapter.mkdir(current);
      }
    } catch {
      /* 目录已存在或不可创建 */
    }
  }
}

function backupStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function pruneBackups(
  app: App,
  root: string,
  keep: number,
  log: (line: string) => void
): Promise<void> {
  try {
    const listing = await app.vault.adapter.list(root);
    const folders = [...listing.folders].sort();
    const remove = Math.max(0, folders.length - keep);
    for (const folder of folders.slice(0, remove)) {
      try {
        await app.vault.adapter.rmdir(folder, true);
        log(`backup pruned: ${folder}`);
      } catch {
        /* 忽略单个失败 */
      }
    }
  } catch {
    /* 没有旧备份 */
  }
}

async function readCache(app: App, cachePath: string): Promise<WereadCache | null> {
  if (!cachePath) return null;
  try {
    const raw = await app.vault.adapter.read(normalizePath(cachePath));
    const parsed = JSON.parse(raw) as WereadCache;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(
  app: App,
  cachePath: string,
  entries: WereadCacheEntry[]
): Promise<void> {
  if (!cachePath) return;
  try {
    await ensureAdapterFolder(app, cachePath);
    const cache: WereadCache = { savedAt: Date.now(), entries };
    await app.vault.adapter.write(normalizePath(cachePath), JSON.stringify(cache));
  } catch {
    /* 快照失败不影响同步结果 */
  }
}

/** 接口不可用时，用快照把缺失的笔记补回来；已有文件不动 */
async function restoreCache(
  app: App,
  folder: string,
  cache: WereadCache,
  log: (line: string) => void
): Promise<number> {
  let restored = 0;
  for (const entry of cache.entries) {
    const filePath = `${folder}/${entry.file}`;
    if (app.vault.getAbstractFileByPath(filePath)) continue;
    try {
      await app.vault.create(filePath, entry.markdown);
      restored += 1;
    } catch (error) {
      log(
        `cache restore failed: ${entry.file} ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return restored;
}

export async function syncWeread(
  app: App,
  apiKey: string,
  outputDir: string,
  options: WereadSyncOptions = {}
): Promise<WereadSyncReport> {
  const log = (line: string) => options.onLog?.(line);
  log("sync begin");
  const report: WereadSyncReport = {
    books: 0,
    written: 0,
    unchanged: 0,
    failed: [],
    outputDir,
    retries: 0,
  };

  if (!apiKey) throw new Error("未配置微信读书 API Key");

  const gatewayOptions = {
    gateway: options.gateway,
    onRetry: (attempt: number, reason: string) => {
      report.retries = (report.retries ?? 0) + 1;
      log(`retry ${attempt}: ${reason}`);
    },
  };

  const cachePath = options.cachePath ?? "";
  const cache = await readCache(app, cachePath);
  const cacheById = new Map(
    (cache?.entries ?? []).map((entry) => [entry.bookId, entry])
  );
  const folder = normalizePath(outputDir || "微信读书");

  const backupMode = options.backupMode ?? "off";
  const backupRoot = normalizePath(
    options.backupDir || ".omnibooks-backup/weread"
  );
  const backupKeep = Math.max(
    1,
    Math.min(20, Math.round(options.backupKeep ?? 5))
  );
  let backupSession = "";
  let backedUp = 0;

  const startBackup = async (): Promise<void> => {
    if (backupSession) return;
    backupSession = `${backupRoot}/${backupStamp()}`;
    await ensureAdapterPath(app, backupSession);
    report.backupDir = backupRoot;
  };

  const backupFile = async (
    relative: string,
    content: string
  ): Promise<void> => {
    await startBackup();
    const target = `${backupSession}/${relative}`;
    await ensureAdapterPath(app, target.split("/").slice(0, -1).join("/"));
    await app.vault.adapter.write(target, content);
    backedUp += 1;
  };

  const snapshot = async (): Promise<void> => {
    const files = app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`));
    for (const file of files) {
      try {
        await backupFile(
          file.path.slice(folder.length + 1),
          await app.vault.read(file)
        );
      } catch {
        /* 忽略单个失败 */
      }
    }
    log(`backup snapshot: ${files.length} files`);
  };

  if (backupMode === "sync") {
    await snapshot();
  } else if (backupMode === "daily") {
    const today = backupStamp().slice(0, 10);
    let hasToday = false;
    try {
      const listing = await app.vault.adapter.list(backupRoot);
      hasToday = listing.folders.some((path) =>
        (path.split("/").pop() ?? "").startsWith(today)
      );
    } catch {
      hasToday = false;
    }
    if (!hasToday) await snapshot();
  }

  log("fetching notebooks");
  const entries: WereadBookEntry[] = [];
  try {
    let lastSort: number | undefined;
    for (let page = 0; page < 20; page++) {
      const params: Record<string, unknown> = { count: 200 };
      if (lastSort !== undefined) params.lastSort = lastSort;
      const result = (await callGateway(
        apiKey,
        "/user/notebooks",
        params,
        gatewayOptions
      )) as {
        books?: WereadBookEntry[];
        hasMore?: number;
      };
      const pageBooks = result.books ?? [];
      entries.push(...pageBooks);
      if (result.hasMore !== 1 || pageBooks.length === 0) break;
      lastSort = Number(pageBooks[pageBooks.length - 1]?.sort ?? 0) || undefined;
      if (!lastSort) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`notebooks failed: ${message}`);
    // 兜底：接口不可用时用上次快照，至少保证书架不空、笔记不丢
    if (cache && cache.entries.length > 0) {
      await ensureFolder(app, folder);
      const restored = await restoreCache(app, folder, cache, log);
      report.books = cache.entries.length;
      report.written = restored;
      report.unchanged = cache.entries.length - restored;
      report.restored = restored;
      report.offline = true;
      log(
        `offline fallback: ${cache.entries.length} books, restored ${restored}`
      );
      return report;
    }
    throw error;
  }

  log(`notebooks done: ${entries.length}`);
  // 拉完整书架（不只是有笔记的书）
  let shelfBooks: Array<{
    bookId: string;
    title?: string;
    author?: string;
    cover?: string;
    finishReading?: number;
    readUpdateTime?: number;
    updateTime?: number;
  }> = [];
  let shelfOk = true;
  try {
    const shelf = (await callGateway(
      apiKey,
      "/shelf/sync",
      { synckey: 0 },
      gatewayOptions
    )) as {
      books?: Array<{
        bookId: string;
        title?: string;
        author?: string;
        cover?: string;
        finishReading?: number;
        readUpdateTime?: number;
        updateTime?: number;
      }>;
      archive?: Array<{
        bookId: string;
        title?: string;
        author?: string;
        cover?: string;
        finishReading?: number;
        readUpdateTime?: number;
        updateTime?: number;
      }>;
    };
    shelfBooks = [...(shelf.books ?? []), ...(shelf.archive ?? [])];
    log(`shelf done: books=${(shelf.books ?? []).length}, archive=${(shelf.archive ?? []).length}`);
  } catch (error) {
    shelfBooks = [];
    shelfOk = false;
    log(
      `shelf failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const notebookById = new Map(entries.map((entry) => [entry.bookId, entry]));

  log(`shelf books: ${shelfBooks.length}, notebooks: ${entries.length}`);

  const books: WereadBookEntry[] =
    shelfBooks.length > 0
      ? shelfBooks.map((shelfBook) => {
          const notebook = notebookById.get(shelfBook.bookId);
          if (notebook) return notebook;
          return {
            bookId: shelfBook.bookId,
            noteCount: 0,
            reviewCount: 0,
            markedStatus: shelfBook.finishReading
              ? 3
              : shelfBook.readUpdateTime
                ? 2
                : 1,
            readingProgress: 0,
            sort: shelfBook.readUpdateTime ?? shelfBook.updateTime ?? 0,
            book: {
              title: shelfBook.title,
              author: shelfBook.author,
              cover: shelfBook.cover,
            },
          } satisfies WereadBookEntry;
        })
      : entries.filter(
          (entry) => (entry.noteCount ?? 0) > 0 || (entry.reviewCount ?? 0) > 0
        );

  report.books = books.length;
  log(`books to sync: ${books.length}`);

  await ensureFolder(app, folder);


  // 用 bookId 匹配已有笔记，避免因为书名变化产生重复文件
  const existingByBookId = new Map<
    string,
    Array<{ path: string; generated: boolean; readingTime: string }>
  >();
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(`${folder}/`)) continue;
    const text = await app.vault.read(file);
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const bookId = /^bookId:\s*"?([^"\n]+)"?/m.exec(frontmatter)?.[1]?.trim();
    if (!bookId) continue;
    const generated =
      /^source:\s*"?weread"?/m.test(frontmatter) ||
      /^doc_type:\s*"?weread-/m.test(frontmatter);
    const readingTime = /^readingTime:\s*"?([^"\n]+)"?/m.exec(frontmatter)?.[1]?.trim() ?? "";
    const list = existingByBookId.get(bookId) ?? [];
    list.push({ path: file.path, generated, readingTime });
    existingByBookId.set(bookId, list);
  }

  const writtenPaths = new Set<string>();
  const generatedBookIds = new Set<string>();
  const nextCacheEntries: WereadCacheEntry[] = [];
  let index = 0;
  for (const entry of books) {
    index += 1;
    const title = entry.book?.title?.trim() || entry.bookId;
    options.onProgress?.(`${index}/${books.length} ${title}`);
    if (index % 10 === 0 || index === books.length) {
      log(`progress ${index}/${books.length}: ${title}`);
    }

    try {
      const hasNotes = (entry.noteCount ?? 0) > 0 || (entry.reviewCount ?? 0) > 0;

      let chapters: WereadChapter[] = [];
      let bookmarks: WereadBookmark[] = [];
      let reviews: WereadReview[] = [];

      if (hasNotes) {
        const marksResult = (await callGateway(
          apiKey,
          "/book/bookmarklist",
          {
            bookId: entry.bookId,
            synckey: 0,
          },
          gatewayOptions
        )) as {
          updated?: WereadBookmark[];
          chapters?: WereadChapter[];
        };

        const reviewsResult = (await callGateway(
          apiKey,
          "/review/list/mine",
          {
            bookid: entry.bookId,
            synckey: 0,
            count: 200,
          },
          gatewayOptions
        )) as { reviews?: WereadReview[] };

        chapters = marksResult.chapters ?? [];
        bookmarks = marksResult.updated ?? [];
        reviews = reviewsResult.reviews ?? [];
      }

      const reviewItems = reviews
        .map((item) => item.review)
        .filter((review): review is NonNullable<typeof review> => Boolean(review));

      const chapterIdxByUid = new Map<number, number>();
      for (const chapter of chapters) {
        if (chapter.chapterUid !== undefined && chapter.chapterIdx !== undefined) {
          chapterIdxByUid.set(chapter.chapterUid, chapter.chapterIdx);
        }
      }

      const items: RenderedItem[] = [];
      const seen = new Set<string>();

      for (const review of reviewItems) {
        const abstract = (review.abstract ?? "").trim();
        if (!abstract) continue;
        const chapterUid = Number(review.chapterUid ?? 0);
        if (!chapterUid) continue;
        const range = review.range ?? "";
        const key = `${chapterUid}:${range}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          chapterUid,
          chapterIdx: Number(review.chapterIdx ?? chapterIdxByUid.get(chapterUid) ?? 0),
          rangeStart: parseRange(range).start,
          time: Number(review.createTime ?? 0),
          text: abstract,
          note: (review.content ?? "").trim(),
          range,
        });
      }

      for (const bookmark of bookmarks) {
        const text = (bookmark.markText ?? "").trim();
        if (!text) continue;
        const chapterUid = Number(bookmark.chapterUid ?? 0);
        const range = bookmark.range ?? "";
        const key = `${chapterUid}:${range}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          chapterUid,
          chapterIdx: Number(
            bookmark.chapterIdx ?? chapterIdxByUid.get(chapterUid) ?? 0
          ),
          rangeStart: parseRange(range).start,
          time: Number(bookmark.createTime ?? 0),
          text,
          note: "",
          range,
        });
      }

      let readingTime =
        existingByBookId.get(entry.bookId)?.find((item) => item.readingTime)?.readingTime ?? "";
      if (!readingTime) {
        try {
          const progress = (await callGateway(
            apiKey,
            "/book/getprogress",
            {
              bookId: entry.bookId,
            },
            gatewayOptions
          )) as { book?: { readingTime?: number } };
          readingTime = formatReadingTime(Number(progress.book?.readingTime ?? 0));
        } catch {
          readingTime = "";
        }
      }

      const markdown = renderBook(entry.bookId, entry, chapters, items, readingTime);
      const filePath = `${folder}/${sanitizeFileName(shortTitle(title))}.md`;
      nextCacheEntries.push({
        bookId: entry.bookId,
        file: filePath.slice(folder.length + 1),
        markdown,
      });
      writtenPaths.add(filePath);
      generatedBookIds.add(entry.bookId);
      const existing = app.vault.getAbstractFileByPath(filePath);

      if (existing) {
        let old = "";
        try {
          old = await app.vault.read(existing as never);
        } catch {
          old = ""; // 文件被外部动过 / 索引过期，按「需要重写」处理
        }
        if (old === markdown) {
          report.unchanged += 1;
          continue;
        }
        if (backupMode === "changed") {
          try {
            await backupFile(filePath.slice(folder.length + 1), old);
          } catch {
            /* 备份失败不阻塞同步 */
          }
        }
        try {
          await app.vault.modify(existing as never, markdown);
        } catch {
          await app.vault.create(filePath, markdown);
        }
      } else {
        await app.vault.create(filePath, markdown);
      }

      report.written += 1;
    } catch (error) {
      const cached = cacheById.get(entry.bookId);
      if (cached) {
        const cachedPath = `${folder}/${cached.file}`;
        if (!app.vault.getAbstractFileByPath(cachedPath)) {
          try {
            await app.vault.create(cachedPath, cached.markdown);
            report.restored = (report.restored ?? 0) + 1;
            log(`restored from cache: ${title}`);
            continue;
          } catch {
            /* 落回失败列表 */
          }
        }
      }
      report.failed.push({
        title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 只有书架完整时才做清理，避免一次请求失败误删笔记
  if (shelfOk) {
  // 删除之前由本插件生成、但现在已不再使用的重复笔记
  for (const candidates of existingByBookId.values()) {
    for (const candidate of candidates) {
      if (!candidate.generated) continue;
      if (writtenPaths.has(candidate.path)) continue;
      const file = app.vault.getAbstractFileByPath(candidate.path);
      if (file) {
        if (backupMode === "changed") {
          try {
            await backupFile(
              candidate.path.slice(folder.length + 1),
              await app.vault.read(file as never)
            );
          } catch {
            /* 备份失败不阻塞 */
          }
        }
        try {
          await app.vault.delete(file);
        } catch {
          /* 忽略删除失败 */
        }
      }
    }
  }

  // 删除旧的微信读书插件模板笔记（仅当同一本书已有新笔记）
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.endsWith(".md")) continue;
    let text = "";
    try {
      text = await app.vault.read(file);
    } catch {
      continue;
    }
    if (!/^doc_type:\s*"?weread-/m.test(text)) continue;
    const bookId = /^bookId:\s*"?([^"\n]+)"?/m.exec(text)?.[1]?.trim();
    if (!bookId || !generatedBookIds.has(bookId)) continue;
    if (backupMode === "changed") {
      try {
        await backupFile(
          file.path.startsWith(`${folder}/`)
            ? file.path.slice(folder.length + 1)
            : file.name,
          text
        );
      } catch {
        /* 备份失败不阻塞 */
      }
    }
    try {
      await app.vault.delete(file);
    } catch {
      /* 忽略 */
    }
  }
  }

  // 合并快照：本次成功的覆盖旧快照，失败的保留旧内容；书架失败时不写，避免丢条目
  if (shelfOk) {
    const currentIds = new Set(books.map((book) => book.bookId));
    const merged = new Map<string, WereadCacheEntry>();
    for (const [bookId, entry] of cacheById) {
      if (currentIds.has(bookId)) merged.set(bookId, entry);
    }
    for (const entry of nextCacheEntries) merged.set(entry.bookId, entry);
    if (merged.size > 0) {
      await writeCache(app, cachePath, [...merged.values()]);
    }
  }

  if (backedUp > 0) {
    report.backedUp = backedUp;
    await pruneBackups(app, backupRoot, backupKeep, log);
  }

  log(`done: written=${report.written}, unchanged=${report.unchanged}, failed=${report.failed.length}`);
  return report;
}
