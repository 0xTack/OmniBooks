import { App, normalizePath } from "obsidian";

/* ------------------------------------------------------------------ */
/* Node helpers (desktop only)                                         */
/* ------------------------------------------------------------------ */

type NodeRequire = (id: string) => unknown;

function nodeRequire<T>(id: string): T {
  const req = (window as unknown as { require?: NodeRequire }).require;
  if (!req) throw new Error("当前环境不支持 Node API");
  return req(id) as T;
}

interface ExecOptions {
  encoding: "utf8" | "buffer";
  maxBuffer?: number;
}

function execFile(
  file: string,
  args: string[],
  options: ExecOptions
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const cp = nodeRequire<{
      execFile: (
        file: string,
        args: string[],
        options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void
      ) => void;
    }>("child_process");

    cp.execFile(
      file,
      args,
      { encoding: options.encoding, maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const message = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
          reject(new Error(message.trim() || error.message));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

function pathModule(): {
  join(...parts: string[]): string;
  basename(p: string): string;
  dirname(p: string): string;
  extname(p: string): string;
  posix: { join(...parts: string[]): string; dirname(p: string): string; normalize(p: string): string };
} {
  return nodeRequire("path");
}

function fsModule(): {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  statSync(p: string): { mtimeMs: number; isDirectory(): boolean; isFile(): boolean };
  readFileSync(p: string): Buffer;
} {
  return nodeRequire("fs");
}

function homeDir(): string {
  return nodeRequire<{ homedir(): string }>("os").homedir();
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface AnnotationRow {
  assetId: string;
  title: string;
  author: string | null;
  path: string | null;
  type: number | null;
  selectedText: string | null;
  noteText: string | null;
  location: string | null;
  created: number | null;
  modified: number | null;
}

export interface SyncReport {
  samplePath?: string | null;
  books: number;
  written: number;
  unchanged: number;
  failed: Array<{ title: string; error: string }>;
  dbPaths: { library: string; annotation: string };
  outputDir: string;
}

interface EpubChapter {
  key: string;
  title: string;
  order: number;
}

interface EpubPackage {
  chapters: Map<string, EpubChapter>;
  cover: { data: Buffer; ext: string } | null;
  publisher: string | null;
  subjects: string[];
}

/* ------------------------------------------------------------------ */
/* Apple Books databases                                               */
/* ------------------------------------------------------------------ */

const APPLE_EPOCH = Date.UTC(2001, 0, 1);

function latestSqlite(dir: string): {
  path: string | null;
  permissionDenied: boolean;
} {
  const fs = fsModule();
  const path = pathModule();
  try {
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".sqlite"))
      .map((name) => {
        const full = path.join(dir, name);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return { path: files[0]?.full ?? null, permissionDenied: false };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return {
      path: null,
      permissionDenied: code === "EACCES" || code === "EPERM",
    };
  }
}

export function discoverAppleBooksDatabases(): {
  library: string;
  annotation: string;
  permissionDenied: boolean;
} {
  const path = pathModule();
  const home = homeDir();
  const base = path.join(
    home,
    "Library/Containers/com.apple.iBooksX/Data/Documents"
  );
  const library = latestSqlite(path.join(base, "BKLibrary"));
  const annotation = latestSqlite(path.join(base, "AEAnnotation"));
  return {
    library: library.path ?? "",
    annotation: annotation.path ?? "",
    permissionDenied: library.permissionDenied || annotation.permissionDenied,
  };
}

function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}

async function querySqliteJson(dbPath: string, sql: string): Promise<AnnotationRow[]> {
  const out = (await execFile("/usr/bin/sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
  })) as string;
  const text = out.trim();
  if (!text) return [];
  return JSON.parse(text) as AnnotationRow[];
}

async function readAnnotations(
  libraryDb: string,
  annotationDb: string
): Promise<AnnotationRow[]> {
  const sql = `
    ATTACH DATABASE '${sqlQuote(libraryDb)}' AS lib;
    SELECT
      b.ZASSETID AS assetId,
      b.ZTITLE AS title,
      b.ZAUTHOR AS author,
      b.ZPATH AS path,
      a.ZANNOTATIONTYPE AS type,
      a.ZANNOTATIONSELECTEDTEXT AS selectedText,
      a.ZANNOTATIONNOTE AS noteText,
      a.ZANNOTATIONLOCATION AS location,
      a.ZANNOTATIONCREATIONDATE AS created,
      a.ZANNOTATIONMODIFICATIONDATE AS modified
    FROM ZAEANNOTATION a
    INNER JOIN lib.ZBKLIBRARYASSET b ON b.ZASSETID = a.ZANNOTATIONASSETID
    WHERE b.ZCONTENTTYPE = 1
      AND (a.ZANNOTATIONDELETED IS NULL OR a.ZANNOTATIONDELETED = 0)
      AND (
        TRIM(COALESCE(a.ZANNOTATIONSELECTEDTEXT, '')) <> ''
        OR TRIM(COALESCE(a.ZANNOTATIONNOTE, '')) <> ''
      )
    ORDER BY b.ZTITLE COLLATE NOCASE, a.ZANNOTATIONLOCATION;
  `;

  return querySqliteJson(annotationDb, sql);
}

interface BookRow {
  assetId: string;
  title: string;
  author: string | null;
  path: string | null;
  lastOpened: number | null;
}

async function readAllBooks(libraryDb: string): Promise<BookRow[]> {
  const sql = `
    SELECT
      ZASSETID AS assetId,
      ZTITLE AS title,
      ZAUTHOR AS author,
      ZPATH AS path,
      ZLASTOPENDATE AS lastOpened
    FROM ZBKLIBRARYASSET
    WHERE ZCONTENTTYPE = 1
    ORDER BY ZTITLE COLLATE NOCASE;
  `;
  const rows = (await querySqliteJson(libraryDb, sql)) as unknown as BookRow[];
  return rows.filter((row) => Boolean(row.assetId));
}

/* ------------------------------------------------------------------ */
/* EPUB parsing (chapters + cover)                                     */
/* ------------------------------------------------------------------ */

async function listZip(zipPath: string): Promise<string[]> {
  try {
    const out = (await execFile("/usr/bin/unzip", ["-Z1", zipPath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })) as string;
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function readZipText(zipPath: string, entry: string): Promise<string | null> {
  try {
    const out = (await execFile("/usr/bin/unzip", ["-p", zipPath, entry], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })) as string;
    return out;
  } catch {
    return null;
  }
}

async function readZipBuffer(zipPath: string, entry: string): Promise<Buffer | null> {
  try {
    const out = (await execFile("/usr/bin/unzip", ["-p", zipPath, entry], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    })) as Buffer;
    return out;
  } catch {
    return null;
  }
}


async function readEpubEntryText(
  bookPath: string,
  isDirectory: boolean,
  entry: string
): Promise<string | null> {
  if (!isDirectory) return readZipText(bookPath, entry);
  try {
    const path = pathModule();
    const fs = nodeRequire<{ readFileSync(p: string, enc: string): string }>("fs");
    return fs.readFileSync(path.join(bookPath, entry), "utf8");
  } catch {
    return null;
  }
}

async function readEpubEntryBuffer(
  bookPath: string,
  isDirectory: boolean,
  entry: string
): Promise<Buffer | null> {
  if (!isDirectory) return readZipBuffer(bookPath, entry);
  try {
    const path = pathModule();
    const fs = nodeRequire<{ readFileSync(p: string): Buffer }>("fs");
    return fs.readFileSync(path.join(bookPath, entry));
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? "") : null;
}

function parseOpfManifest(opf: string): {
  hrefById: Map<string, string>;
  mediaById: Map<string, string>;
  propertiesById: Map<string, string>;
  spine: string[];
  coverItemId: string | null;
} {
  const hrefById = new Map<string, string>();
  const mediaById = new Map<string, string>();
  const propertiesById = new Map<string, string>();
  const spine: string[] = [];
  let coverItemId: string | null = null;

  const itemRe = /<item\b[^>]*>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRe.exec(opf))) {
    const tag = itemMatch[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (!id || !href) continue;
    hrefById.set(id, href);
    mediaById.set(id, attr(tag, "media-type") ?? "");
    propertiesById.set(id, attr(tag, "properties") ?? "");
  }

  const itemrefRe = /<itemref\b[^>]*>/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefRe.exec(opf))) {
    const idref = attr(refMatch[0], "idref");
    if (idref) spine.push(idref);
  }

  const metaRe = /<meta\b[^>]*>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRe.exec(opf))) {
    const tag = metaMatch[0];
    if ((attr(tag, "name") ?? "").toLowerCase() === "cover") {
      coverItemId = attr(tag, "content");
    }
  }

  for (const [id, properties] of propertiesById) {
    if (properties.includes("cover-image")) coverItemId = id;
  }

  return { hrefById, mediaById, propertiesById, spine, coverItemId };
}

function extractTitleFromHtml(html: string): string | null {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]) : "";
  if (title && title.length > 0 && title.length < 200) return title;

  for (const tag of ["h1", "h2", "h3"]) {
    const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
    if (match) {
      const text = stripTags(match[1]);
      if (text) return text;
    }
  }
  return null;
}

function basenameOf(href: string): string {
  return href.split("/").pop() ?? href;
}

async function readEpubPackage(
  bookPath: string | null,
  chapterKeys: string[],
  bookTitle: string
): Promise<EpubPackage> {
  const empty: EpubPackage = {
    chapters: new Map(),
    cover: null,
    publisher: null,
    subjects: [],
  };
  if (!bookPath) return empty;

  const path = pathModule();
  let isDirectory = false;
  try {
    isDirectory = fsModule().statSync(bookPath).isDirectory();
  } catch {
    return empty;
  }

  const container = await readEpubEntryText(bookPath, isDirectory, "META-INF/container.xml");
  if (!container) return empty;

  const rootfileMatch = /<rootfile\b[^>]*full-path\s*=\s*"([^"]+)"/i.exec(container);
  const opfPath = rootfileMatch?.[1] ?? "OEBPS/content.opf";
  const opf = await readEpubEntryText(bookPath, isDirectory, opfPath);
  if (!opf) return empty;

  const { hrefById, mediaById, spine, coverItemId } = parseOpfManifest(opf);
  const opfDir = path.posix.dirname(opfPath);

  const resolveHref = (href: string): string => {
    const joined = href.startsWith("/") ? href.slice(1) : path.posix.join(opfDir, href);
    return joined.replace(/^\.\//, "");
  };

  const spineOrder = new Map<string, number>();
  spine.forEach((id, index) => spineOrder.set(resolveHref(hrefById.get(id) ?? ""), index));

  const chapters = new Map<string, EpubChapter>();
  const wanted = new Set(chapterKeys.map((key) => key.toLowerCase()));

  for (const [id, href] of hrefById) {
    const media = mediaById.get(id) ?? "";
    if (!/x?html/i.test(media)) continue;

    const resolved = resolveHref(href);
    const file = basenameOf(resolved).toLowerCase();
    const key = chapterKeys.find(
      (candidate) =>
        candidate.toLowerCase() === file ||
        file.includes(candidate.toLowerCase()) ||
        candidate.toLowerCase().includes(file)
    );
    if (!key && wanted.size > 0 && !spineOrder.has(resolved)) continue;
    if (!key) continue;

    const html = await readEpubEntryText(bookPath, isDirectory, resolved);
    let title = html ? extractTitleFromHtml(html) : null;
    if (!title || title === bookTitle) title = null;

    const order = spineOrder.get(resolved) ?? Number.MAX_SAFE_INTEGER;
    chapters.set(key, {
      key,
      title: title ?? `第 ${chapters.size + 1} 章`,
      order,
    });
  }

  let cover: EpubPackage["cover"] = null;
  let coverId = coverItemId;
  if (!coverId) {
    for (const [id, media] of mediaById) {
      const href = hrefById.get(id) ?? "";
      if (/^image\//i.test(media) && /cover/i.test(`${id} ${href}`)) {
        coverId = id;
        break;
      }
    }
  }
  if (!coverId) {
    for (const [id, media] of mediaById) {
      if (/^image\//i.test(media)) {
        coverId = id;
        break;
      }
    }
  }
  if (coverId) {
    const href = hrefById.get(coverId);
    if (href) {
      const resolved = resolveHref(href);
      const data = await readEpubEntryBuffer(bookPath, isDirectory, resolved);
      if (data && data.length > 0) {
        const ext = (path.extname(resolved) || ".jpg").toLowerCase();
        cover = { data, ext };
      }
    }
  }

  const publisherMatch = /<dc:publisher[^>]*>([\s\S]*?)<\/dc:publisher>/i.exec(opf);
  const publisher = publisherMatch ? stripTags(publisherMatch[1]) : null;

  const subjects: string[] = [];
  const subjectRe = /<dc:subject[^>]*>([\s\S]*?)<\/dc:subject>/gi;
  let subjectMatch: RegExpExecArray | null;
  while ((subjectMatch = subjectRe.exec(opf))) {
    const value = stripTags(subjectMatch[1]);
    if (value) subjects.push(value);
  }

  return { chapters, cover, publisher, subjects };
}

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                  */
/* ------------------------------------------------------------------ */

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatDate(appleSeconds: number | null): string {
  if (!appleSeconds) return "";
  const date = new Date(APPLE_EPOCH + appleSeconds * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
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

function chapterKeyOf(location: string | null): string {
  if (!location) return "未分章";
  const match = /\[([^\]]+\.x?html?)\]/i.exec(location);
  return match?.[1] ?? "未分章";
}

function buildLocationLink(assetId: string, location: string | null): string {
  if (!location) return `ibooks://assetid/${assetId}`;
  return `ibooks://assetid/${assetId}#${location}`;
}

interface RenderedAnnotation {
  location: string | null;
  created: number | null;
  selectedText: string | null;
  noteText: string | null;
}

function formatAppleMinute(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderBook(
  book: { assetId: string; title: string; author: string | null; path: string | null; lastOpened: number | null },
  rows: AnnotationRow[],
  epub: EpubPackage,
  coverLink: string | null
): string {
  const chapters = new Map<string, RenderedAnnotation[]>();
  for (const row of rows) {
    const key = chapterKeyOf(row.location);
    const list = chapters.get(key) ?? [];
    list.push(row);
    chapters.set(key, list);
  }

  for (const list of chapters.values()) {
    list.sort((a, b) => (a.location ?? "").localeCompare(b.location ?? "", "en"));
  }

  const sortedChapters = [...chapters.entries()].sort((a, b) => {
    const left = epub.chapters.get(a[0])?.order ?? Number.MAX_SAFE_INTEGER;
    const right = epub.chapters.get(b[0])?.order ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  const tags = new Set<string>();
  if (book.author) {
    for (const name of book.author.split(/[,，;；]/)) {
      const trimmed = name.trim();
      if (trimmed) tags.add(trimmed);
    }
  }
  for (const subject of epub.subjects.slice(0, 5)) tags.add(subject);
  tags.add(book.title);

  const lastModified = rows.reduce((max, row) => Math.max(max, row.modified ?? row.created ?? 0), 0);

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${yaml(book.title)}`);
  if (book.author) lines.push(`author: ${yaml(book.author)}`);
  if (epub.publisher) lines.push(`publisher: ${yaml(epub.publisher)}`);
  lines.push(`format: "EPUB"`);
  lines.push(`annotation_count: ${rows.length}`);
  if (lastModified) {
    lines.push(`last_modified_at: ${yaml(new Date(APPLE_EPOCH + lastModified * 1000).toISOString())}`);
  }
  if (book.lastOpened && book.lastOpened > 0) {
    lines.push(`lastRead: ${yaml(formatAppleMinute(APPLE_EPOCH + book.lastOpened * 1000))}`);
  }
  if (coverLink) lines.push(`cover: ${yaml(`[[${coverLink}]]`)}`);
  if (book.path) lines.push(`source_file: ${yaml(book.path)}`);
  lines.push(`open_url: ${yaml(`[${book.title}](<ibooks://assetid/${book.assetId}>)`)}`);
  lines.push("cssclasses:");
  lines.push("  - omnibooks");
  lines.push("tags:");
  for (const tag of tags) lines.push(`  - ${yaml(tag)}`);
  lines.push("---");
  lines.push("");

  for (const [key, annotations] of sortedChapters) {
    const chapter = epub.chapters.get(key);
    lines.push(`## ${chapter?.title ?? (key === "未分章" ? "未分章" : key)}`);
    lines.push("");

    for (const annotation of annotations) {
      const time = formatDate(annotation.created);
      const quote = (annotation.selectedText ?? "").trim();

      const link = time
        ? `[${time}](<${buildLocationLink(book.assetId, annotation.location)}>)`
        : "";
      if (link) lines.push(link);
      if (quote) lines.push(...quote.split("\n"));
      if (link || quote) lines.push("");

      const note = (annotation.noteText ?? "").trim();
      if (note) {
        lines.push("> [!absnote]");
        for (const line of note.split("\n")) lines.push(`> ${line}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ------------------------------------------------------------------ */
/* Sync                                                               */
/* ------------------------------------------------------------------ */

async function ensureFolder(app: App, folder: string): Promise<void> {
  const normalized = normalizePath(folder);
  if (!normalized) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
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

export async function syncAppleBooksNative(
  app: App,
  outputDir: string,
  coverDir?: string,
  onProgress?: (message: string) => void
): Promise<SyncReport> {
  const path = pathModule();
  const databases = discoverAppleBooksDatabases();

  const report: SyncReport = {
    books: 0,
    written: 0,
    unchanged: 0,
    failed: [],
    dbPaths: databases,
    outputDir,
  };

  if (databases.permissionDenied) {
    throw new Error(
      "读取苹果图书数据库被系统拒绝。请到 系统设置 → 隐私与安全性 → 完全磁盘访问权限，添加并勾选 Obsidian，然后完全退出并重开 Obsidian。"
    );
  }
  if (!databases.library || !databases.annotation) {
    throw new Error(
      "找不到苹果图书数据库。请先打开一次 macOS「图书」App 并任意翻一本书，再回来同步。"
    );
  }

  const rows = await readAnnotations(databases.library, databases.annotation);
  const allBooks = await readAllBooks(databases.library);
  if (allBooks.length === 0) return report;

  const byBook = new Map<
    string,
    {
      title: string;
      author: string | null;
      path: string | null;
      lastOpened: number | null;
      annotations: AnnotationRow[];
    }
  >();

  for (const book of allBooks) {
    byBook.set(book.assetId, {
      title: book.title,
      author: book.author,
      path: book.path,
      lastOpened: book.lastOpened ?? null,
      annotations: [],
    });
  }

  for (const row of rows) {
    const entry = byBook.get(row.assetId);
    if (entry) {
      entry.annotations.push(row);
    } else {
      byBook.set(row.assetId, {
        title: row.title,
        author: row.author,
        path: row.path,
        lastOpened: null,
        annotations: [row],
      });
    }
  }

  const folder = normalizePath(outputDir || "读书笔记/苹果图书");
  const coverFolder = normalizePath(
    coverDir?.trim() || `${folder}/assets/covers`
  );
  await ensureFolder(app, folder);
  await ensureFolder(app, coverFolder);

  report.books = byBook.size;
  report.samplePath = allBooks[0]?.path ?? null;
  let index = 0;

  for (const [assetId, entry] of byBook) {
    index += 1;
    const annotations = entry.annotations;
    const title = (entry.title || `未命名-${assetId.slice(0, 6)}`).trim();
    onProgress?.(`${index}/${byBook.size} ${title}`);

    try {
      const chapterKeys = [...new Set(annotations.map((row) => chapterKeyOf(row.location)))];
      const epub = await readEpubPackage(entry.path, chapterKeys, title);

      let coverLink: string | null = null;
      if (!epub.cover) {
        const existing = app.vault
          .getFiles()
          .find((file) => file.path.startsWith(`${coverFolder}/${assetId}.`));
        if (existing) coverLink = existing.path;
      }
      if (epub.cover) {
        const coverPath = `${coverFolder}/${assetId}${epub.cover.ext}`;
        const buffer = epub.cover.data;
        const arrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;
        const existing = app.vault.getAbstractFileByPath(coverPath);
        if (existing) {
          await app.vault.adapter.writeBinary(coverPath, arrayBuffer);
        } else {
          await app.vault.createBinary(coverPath, arrayBuffer);
        }
        coverLink = coverPath;
      }

      const markdown = renderBook(
        { assetId, title, author: entry.author, path: entry.path, lastOpened: entry.lastOpened ?? null },
        annotations,
        epub,
        coverLink
      );

      const filePath = `${folder}/${sanitizeFileName(title)}.md`;
      const existing = app.vault.getAbstractFileByPath(filePath);

      if (existing && "stat" in existing) {
        const old = await app.vault.read(existing as never);
        if (old === markdown) {
          report.unchanged += 1;
          continue;
        }
        await app.vault.modify(existing as never, markdown);
      } else {
        await app.vault.create(filePath, markdown);
      }

      report.written += 1;
    } catch (error) {
      report.failed.push({
        title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}
