import {
  App,
  Menu,
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  addIcon,
  normalizePath,
  requestUrl,
  setIcon,
} from "obsidian";
import { BookReaderView, VIEW_TYPE_BOOK_READER } from "./src/bookReader";
import { discoverAppleBooksDatabases, syncAppleBooksNative } from "./src/appleBooksSync";
import { syncWeread, WEREAD_GATEWAY } from "./src/wereadSync";
import { ReadingStatsModal } from "./src/stats";
import { TimelineModal, computeTimeline } from "./src/timeline";
import { QuoteResolver } from "./src/quoteResolver";
import { DEFAULT_ICON_ID, ICON_OPTIONS, iconId } from "./src/icons";
import {
  StraightenResult,
  analyzeCover,
  isStandardCover,
  straightenCover,
} from "./src/coverStraighten";
import { AI_MODULES, AiAdvisorModal, AiCache, importCopilotSettings } from "./src/aiAdvisor";
import { CoverAdjust, CoverAdjustModal } from "./src/coverAdjust";
import {
  SetupResult,
  SetupSource,
  SetupSyncHandlers,
  SetupWizardModal,
} from "./src/setupWizard";
import { openExternal } from "./src/external";
import { appendMarkup } from "./src/dom";

export const VIEW_TYPE_APPLE_BOOKS = "apple-books-shelf-view";

type StatusKey = "全部" | "在读" | "已读" | "想读" | "想看" | "待看";
type CoverMode = "auto" | "fill" | "contain" | "stretch" | "straighten-contain";

type SortKey = "recent" | "title" | "rating" | "progress" | "words";
type ShelfLayout = "grid" | "deck" | "stack" | "coverflow" | "timeline";

/** iPhone 只保留封面墙和时间线；iPad / 电脑使用完整布局。 */
const PHONE_LAYOUTS: ShelfLayout[] = ["grid"];

interface AppleBooksSettings {
  folder: string;
  coverField: string;
  authorField: string;
  statusField: string;
  progressField: string;
  ratingField: string;
  highlightsField: string;
  lastReadField: string;
  showTitles: boolean;
  defaultSort: SortKey;
  booksOutputDir: string;
  coverDir: string;
  wereadEnabled: boolean;
  wereadApiKey: string;
  wereadGateway: string;
  wereadBackupMode: "off" | "sync" | "daily" | "changed";
  wereadBackupDir: string;
  wereadBackupKeep: number;
  wereadOutputDir: string;
  readerDensity: "comfortable" | "compact" | "minimal";
  readerShowTime: boolean;
  exitEditAfterSave: boolean;
  editHighlight: boolean;
  shelfLayout: ShelfLayout;
  iconStyle: string;
  viewScales: Record<string, number>;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  syncEnabled: boolean;
  syncBridgeDir: string;
  syncIntervalMinutes: number;
  syncScope: "all" | "apple" | "weread";
  timelineOrientation: "auto" | "horizontal" | "vertical";
  timelineSort: "recent" | "oldest";
  timelineScale: number;
  straightenCovers: boolean;
  coverMode: CoverMode;
  coverflowBatch: number;
  coverflowAngle: "soft" | "standard" | "strong";
  coverflowAutoLoad: boolean;
  favoriteSource: "merged" | "swipe" | "status";
  favoriteStatuses: string;
  favoriteFillTo: number;
  shelfFilter: "all" | "curated" | "strict";
  deckRoundStart: number;
  quotesFilePath: string;
  hideAssetFolder: boolean;
  autoCleanDuplicates: boolean;
  showAllProperties: boolean;
  visibleProperties: string;
  layoutMigrated: boolean;
  timestampsMigrated: boolean;
  lastReadFormatMigrated: boolean;
  coverAdjust: Record<string, CoverAdjust>;
  aiCache: AiCache | null;
  aiHistory: AiCache[];
  profileDir: string;
  shareDir: string;
  aiModules: string[];
  aiThemeView: "bars" | "cards";
  showSelectionToolbar: boolean;
  ribbonIconSize: number;
  ribbonIconStroke: number;
  aiModels: string[];
  onboarded: boolean;
  setupPending: boolean;
  setupSource: SetupSource | null;
  feedbackUrl: string;
  bookNoteView: "reader" | "reading" | "live";
}

type FieldKey =
  | "coverField"
  | "authorField"
  | "statusField"
  | "progressField"
  | "ratingField"
  | "highlightsField"
  | "lastReadField";

/** 测试构建标记：用来确认设备加载的是哪一版界面 */
const UI_BUILD = "2026-11-06 12:50";

const DEFAULT_SETTINGS: AppleBooksSettings = {  folder: "",
  coverField: "cover",
  authorField: "author",
  statusField: "status",
  progressField: "progress",
  ratingField: "rating",
  highlightsField: "highlights",
  lastReadField: "lastRead",
  showTitles: true,
  defaultSort: "recent",
  booksOutputDir: "OmniBooks/苹果图书",
  coverDir: "",
  wereadEnabled: true,
  wereadApiKey: "",
  wereadGateway: "",
  wereadBackupMode: "changed",
  wereadBackupDir: ".omnibooks-backup/weread",
  wereadBackupKeep: 5,
  wereadOutputDir: "OmniBooks/微信读书",
  readerDensity: "comfortable",
  readerShowTime: true,
  exitEditAfterSave: true,
  editHighlight: true,
  shelfLayout: "grid",
  iconStyle: DEFAULT_ICON_ID,
  viewScales: {},
  aiBaseUrl: "https://api.deepseek.com/v1",
  aiApiKey: "",
  aiModel: "deepseek-chat",
  syncEnabled: true,
  syncBridgeDir: ".apple-books-sync",
  syncIntervalMinutes: 30,
  syncScope: "all",
  timelineOrientation: "auto",
  timelineSort: "recent",
  timelineScale: 0.7,
  straightenCovers: true,
  coverMode: "auto",
  coverflowBatch: 0,
  coverflowAngle: "standard",
  coverflowAutoLoad: false,
  favoriteSource: "merged",
  favoriteStatuses: "想看",
  favoriteFillTo: 20,
  shelfFilter: "all",
  deckRoundStart: 0,
  quotesFilePath: "OmniBooks/阅读/金句.md",
  hideAssetFolder: true,
  autoCleanDuplicates: true,
  showAllProperties: false,
  visibleProperties: "title,author,readingTime",
  layoutMigrated: false,
  timestampsMigrated: false,
  lastReadFormatMigrated: false,
  coverAdjust: {},
  aiCache: null,
  aiHistory: [],
  profileDir: "OmniBooks/阅读",
  shareDir: "OmniBooks/阅读",
  aiModules: ["domain", "completion", "topics", "types", "sources"],
  aiThemeView: "cards",
  showSelectionToolbar: true,
  ribbonIconSize: 19,
  ribbonIconStroke: 0.5,
  aiModels: [],
  onboarded: false,
  setupPending: false,
  setupSource: null,
  feedbackUrl: "https://github.com/0xTack/OmniBooks/issues/new",
  bookNoteView: "reader",
};

interface Book {
  file: TFile;
  files: TFile[];
  title: string;
  author: string;
  cover: string;
  status: string;
  progress: number;
  rating: number;
  highlights: number;
  words: number;
  lastRead: number;
}

const STATUS_ALIASES: Record<string, string> = {
  "在读": "在读",
  "在读中": "在读",
  "阅读中": "在读",
  reading: "在读",
  "已读": "已读",
  "读完": "已读",
  finished: "已读",
  read: "已读",
  "想读": "想读",
  "未读": "想读",
  wishlist: "想读",
  "to-read": "想读",
  want: "想读",
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.length > 0 ? asString(value[0]) : "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return "";
  return String(value);
}

function toPercent(value: unknown): number {
  if (typeof value === "number") {
    return clamp(value > 0 && value <= 1 ? value * 100 : value);
  }
  const text = asString(value).trim();
  if (!text) return 0;
  const lower = text.toLowerCase();
  if (lower === "finished" || text === "已读" || text === "读完") return 100;
  const parsed = parseFloat(text);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed > 0 && parsed <= 1 && !text.endsWith("%") ? parsed * 100 : parsed);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(asString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return fallback;
  }
  const text = asString(value).trim();
  if (!text) return fallback;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeStatus(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return "";
  const mapped = STATUS_ALIASES[raw] ?? STATUS_ALIASES[raw.toLowerCase()];
  if (mapped) return mapped;
  if (raw === "1") return "想读";
  if (raw === "2") return "在读";
  if (raw === "3" || raw === "4") return "已读";
  return "";
}

function stripLink(value: string): string {
  return value
    .trim()
    .replace(/^!?\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .trim();
}

const STAMP_STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8z"/></svg>';
const STAMP_PAUSE_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="4.5" width="3.6" height="15" rx="1.8"/><rect x="13.4" y="4.5" width="3.6" height="15" rx="1.8"/></svg>';

function appleBooksStatus(): {
  label: string;
  detail: string;
  action?: "permission" | "openBooks";
} {
  if (!Platform.isDesktopApp) {
    return {
      label: "手机端需 Mac 中转",
      detail:
        "苹果图书首次同步需要在同一 iCloud 库的 Mac 上完成；之后平板/手机点同步，会由正在运行的 Mac 执行。",
    };
  }
  if (process.platform !== "darwin") {
    return { label: "当前系统不支持", detail: "苹果图书同步仅支持 macOS 桌面版。" };
  }
  const db = discoverAppleBooksDatabases();
  if (db.permissionDenied) {
    return {
      label: "需要完全磁盘访问权限",
      detail:
        "到 系统设置 → 隐私与安全性 → 完全磁盘访问权限，添加并勾选 Obsidian（没有就点 + 从「应用程序」添加），然后完全退出并重开 Obsidian。",
      action: "permission",
    };
  }
  if (!db.library || !db.annotation) {
    return {
      label: "未找到图书数据库",
      detail:
        "请先打开一次 macOS「图书」App，翻开一本书并划一条线；如果书架还是空的，等 iCloud 同步完，再点「重新检查」。",
      action: "openBooks",
    };
  }
  try {
    const fs = (window as any).require("fs");
    fs.accessSync(db.library, fs.constants.R_OK);
    fs.accessSync(db.annotation, fs.constants.R_OK);
  } catch {
    return {
      label: "需要完全磁盘访问权限",
      detail:
        "到 系统设置 → 隐私与安全性 → 完全磁盘访问权限，添加并勾选 Obsidian（没有就点 + 从「应用程序」添加），然后完全退出并重开 Obsidian。",
      action: "permission",
    };
  }
  return { label: "可用", detail: "已找到并可以读取苹果图书数据库。" };
}

function parseFrontmatter(text: string): Record<string, unknown> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;

  const body = text.slice(3, end);
  const result: Record<string, unknown> = {};

  for (const line of body.split("\n")) {
    const match = /^([A-Za-z0-9_\u4e00-\u9fa5-]+):\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (!value) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function formatLegacyNote(text: string): string | null {
  if (text.includes("abs-time") || text.includes("[!absnote]")) return null;

  const lines = text.split("\n");
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end === -1) return null;
    bodyStart = end + 1;
  }

  const body = lines.slice(bodyStart);
  const out: string[] = [];
  let changed = false;
  let i = 0;

  const pushChapter = (line: string) => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(line);
    out.push("");
  };

  const pushAnnotation = (label: string, quote: string[], note: string[]) => {
    out.push(label.startsWith("[") ? label : `<span class="abs-time">${label}</span>`);
    out.push("");
    for (const line of quote) out.push(line);
    out.push("");
    if (note.length > 0) {
      out.push("> [!absnote]");
      for (const line of note) out.push(line ? `> ${line}` : ">");
      out.push("");
    }
  };

  while (i < body.length) {
    const line = body[i];

    if (line.startsWith("## ")) {
      pushChapter(line);
      i += 1;
      continue;
    }

    if (line.trim() === "---") {
      i += 1;
      continue;
    }

    const callout = /^>\s*\[!quote\][-+]?\s*(.*)$/.exec(line);
    if (callout) {
      changed = true;
      const label = callout[1].trim();
      i += 1;

      const quote: string[] = [];
      while (i < body.length && body[i].startsWith(">") && !/^>\s*\[!note\]/.test(body[i])) {
        quote.push(body[i].replace(/^>\s?/, ""));
        i += 1;
      }
      while (i < body.length && body[i].trim() === "") i += 1;

      const note: string[] = [];
      if (i < body.length && /^>\s*\[!note\]/.test(body[i])) {
        i += 1;
        while (i < body.length && body[i].startsWith(">")) {
          note.push(body[i].replace(/^>\s?/, ""));
          i += 1;
        }
      }
      while (note.length > 0 && note[note.length - 1].trim() === "") note.pop();

      pushAnnotation(label, quote, note);
      continue;
    }

    const raw = /^>\s*\[([^\]]+)\]\(<([^>]+)>\)\s*(.*)$/.exec(line);
    if (raw) {
      changed = true;
      const label = `[${raw[1]}](<${raw[2]}>)`;
      const quote = [raw[3]];
      i += 1;

      while (i < body.length && body[i].startsWith(">")) {
        quote.push(body[i].replace(/^>\s?/, ""));
        i += 1;
      }
      while (i < body.length && body[i].trim() === "") i += 1;

      const note: string[] = [];
      while (i < body.length && body[i].trim() !== "---" && !body[i].startsWith("## ")) {
        note.push(body[i]);
        i += 1;
      }
      while (note.length > 0 && note[note.length - 1].trim() === "") note.pop();

      pushAnnotation(label, quote, note);
      continue;
    }

    out.push(line);
    i += 1;
  }

  if (!changed) return null;

  const head = lines.slice(0, bodyStart).join("\n");
  return `${head}\n\n${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function gradientFor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(155deg, hsl(${hue}, 34%, 62%), hsl(${(hue + 45) % 360}, 42%, 40%))`;
}


export default class AppleBooksShelfPlugin extends Plugin {
  settings: AppleBooksSettings = { ...DEFAULT_SETTINGS };
  private processingRequest = false;
  private ribbonEl: HTMLElement | null = null;
  private formatting = false;
  private formatTimer: number | null = null;
  private allowSourceOpen = false;
  private switchingToReader = false;
  private altKeyDown = false;
  private lastBookFile: TFile | null = null;
  private pendingReaderPath = "";
  private manualSourcePath = "";
  private readerRequestId = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    document.body.toggleClass("omnibooks-tablet", Platform.isTablet);
    document.body.toggleClass("omnibooks-phone", Platform.isPhone);
    this.applyHiddenFolders();
    this.applyPropertyVisibility();
    this.registerInterval(
      window.setInterval(() => {
        this.syncExplorerHiddenFolders();
        this.syncPropertyVisibility();
      }, 1000)
    );

    for (const option of ICON_OPTIONS) {
      addIcon(iconId(option.id), option.svg);
    }

    addIcon(
      "omnibooks-zoom",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10 H16"/><path d="M12 5.5 V14.5"/><path d="M8 18 H16"/></svg>`
    );

    if (Platform.isDesktopApp && this.settings.syncEnabled) {
      this.startRequestWatcher();
      this.startAutoSync();
      this.startFormatWatcher();
    }

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.followFolderRename(file.path, oldPath);
      })
    );

    this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOK_READER);
    this.registerView(
      VIEW_TYPE_APPLE_BOOKS,
      (leaf: WorkspaceLeaf) => new AppleBooksShelfView(leaf, this)
    );
    this.registerView(
      VIEW_TYPE_BOOK_READER,
      (leaf: WorkspaceLeaf) => new BookReaderView(leaf, this)
    );

    this.registerDomEvent(window, "keydown", (event) => {
      this.altKeyDown = event.altKey;
    });
    this.registerDomEvent(window, "keyup", (event) => {
      this.altKeyDown = event.altKey;
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.settings.bookNoteView === "live") return;
        if (this.allowSourceOpen) return;
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.manualSourcePath && this.manualSourcePath !== file.path) {
          this.manualSourcePath = "";
        }
        if (this.altKeyDown) {
          this.manualSourcePath = file.path;
          return;
        }
        if (this.switchingToReader) return;
        const active = this.app.workspace.activeLeaf;
        this.openAsBookNote(file, active ?? undefined);
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (this.settings.bookNoteView === "live") return;
        if (this.allowSourceOpen || this.switchingToReader || this.altKeyDown) {
          return;
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return;
        this.openAsBookNote(view.file, view.leaf);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (this.settings.bookNoteView === "live") return;
        if (this.allowSourceOpen || this.switchingToReader || this.altKeyDown) {
          return;
        }
        if (!(leaf?.view instanceof MarkdownView)) return;
        const file = leaf.view.file;
        if (!file) return;
        this.openAsBookNote(file, leaf);
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (this.settings.bookNoteView === "live") return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file && this.isBookNote(view.file)) {
          this.openAsBookNote(view.file, view.leaf);
        }
      })
    );

    this.registerInterval(
      window.setInterval(() => this.ensureActiveBookReader(), 800)
    );

    this.ribbonEl = this.addRibbonIcon(this.currentIconId(), "打开 OmniBooks", () => {
      void this.activateView();
    });
    this.ribbonEl.addClass("omnibooks-ribbon-icon");
    this.applyIconVars();

    this.addCommand({
      id: "open-apple-books-shelf",
      name: "打开 OmniBooks",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "cycle-shelf-view",
      name: "切换书架视图",
      callback: () => {
        if (Platform.isPhone) {
          new Notice("手机端固定为封面墙，不能切换视图");
          return;
        }
        const order: ShelfLayout[] = ["grid", "deck", "coverflow", "timeline"];
        const labels: Record<ShelfLayout, string> = {
          grid: "封面墙",
          deck: "卡片模式",
          stack: "叠放",
          coverflow: "唱片模式",
          timeline: "时间线",
        };
        const index = order.indexOf(this.settings.shelfLayout);
        const next = order[(index + 1) % order.length];
        this.settings.shelfLayout = next;
        void this.saveSettings();
        new Notice(`已切换到：${labels[next]}`);
      },
    });

    this.addCommand({
      id: "setup-wizard",
      name: "首次使用向导",
      callback: () => {
        this.openSetupWizard();
      },
    });

    this.addCommand({
      id: "open-settings",
      name: "打开 OmniBooks 设置",
      callback: () => {
        const setting = (
          this.app as unknown as {
            setting?: { open(): void; openTabById(id: string): void };
          }
        ).setting;
        setting?.open();
        setting?.openTabById(this.manifest.id);
      },
    });

    this.addCommand({
      id: "feedback",
      name: "反馈与建议",
      callback: () => {
        this.openFeedback();
      },
    });

    this.addCommand({
      id: "copy-diagnostics",
      name: "复制诊断信息",
      callback: () => {
        void this.copyDiagnostics();
      },
    });

    this.addCommand({
      id: "refresh-apple-books-shelf",
      name: "重新扫描书库",
      callback: () => {
        this.refreshViews(true, true);
      },
    });

    this.addCommand({
      id: "import-apple-books",
      name: "一键导入苹果图书",
      callback: () => {
        void this.importAppleBooks();
      },
    });

    this.addCommand({
      id: "sync-apple-books-now",
      name: "同步书库（苹果 + 微信）",
      callback: () => {
        void this.syncFromCommand();
      },
    });

    this.addCommand({
      id: "diagnose-apple-books-shelf",
      name: "输出书库诊断信息",
      callback: () => {
        void this.diagnose();
      },
    });

    this.addCommand({
      id: "format-apple-books-notes",
      name: "重新排版苹果图书笔记",
      callback: () => {
        void this.formatAppleBooksNotes(true);
      },
    });

    this.addCommand({
      id: "clear-swipe-history",
      name: "清空滑动记录",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_APPLE_BOOKS)[0];
        const view = leaf?.view;
        if (view instanceof AppleBooksShelfView) {
          view.resetSwipeChoices();
          new Notice("滑动记录已清空");
        }
      },
    });

    this.addCommand({
      id: "cleanup-legacy-weread",
      name: "清理旧微信读书模板笔记",
      callback: () => {
        void this.cleanupLegacyWeread();
      },
    });

    this.addCommand({
      id: "migrate-default-layout",
      name: "整理到默认目录（OmniBooks）",
      callback: () => {
        void this.migrateToDefaultLayout();
      },
    });

    this.addCommand({
      id: "ai-reading-advisor",
      name: "AI 阅析",
      callback: () => {
        this.openAiAdvisor();
      },
    });

    this.addCommand({
      id: "reading-timeline",
      name: "阅读时间线",
      callback: () => {
        this.openTimeline();
      },
    });

    this.addCommand({
      id: "fix-lastread-format",
      name: "统一 lastRead 时间格式",
      callback: () => {
        void this.migrateLastReadFormat(true);
      },
    });

    this.addCommand({
      id: "restyle-timestamps-above",
      name: "重排时间戳（日期在上）",
      callback: () => {
        void this.migrateTimestampsAbove();
      },
    });

    this.addCommand({
      id: "migrate-time-links",
      name: "迁移时间戳为 Markdown 链接",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_APPLE_BOOKS)[0];
        const view = leaf?.view;
        if (view instanceof AppleBooksShelfView) void view.migrateTimeLinks();
        else new Notice("请先打开书架视图");
      },
    });

    this.addCommand({
      id: "reading-stats",
      name: "阅读统计",
      callback: () => {
        this.openReadingStats();
      },
    });

    this.addCommand({
      id: "sync-weread-now",
      name: "更新微信读书",
      callback: () => {
        void this.syncWereadFromCommand();
      },
    });

    this.addCommand({
      id: "open-book-reader",
      name: "打开阅读视图（最近一本书）",
      callback: () => {
        void this.openLatestBookReader();
      },
    });

    this.addCommand({
      id: "open-current-in-reader",
      name: "在 OmniBooks 阅读视图打开当前笔记",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isBookNote(file)) {
          new Notice("当前不是书籍笔记");
          return;
        }
        this.manualSourcePath = "";
        this.scheduleOpenInReader(file);
      },
    });

    this.addCommand({
      id: "edit-book-note-source",
      name: "编辑当前书籍笔记（原文）",
      callback: () => {
        void this.openBookNoteSource();
      },
    });

    this.addSettingTab(new AppleBooksShelfSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => {
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (
          active?.file &&
          this.settings.bookNoteView === "reading" &&
          this.isBookNote(active.file)
        ) {
          void this.openInReadingMode(active.file, active.leaf);
        }
      }, 500);
      void this.migrateLayout().then(async () => {
        if (!this.settings.timestampsMigrated) {
          await this.migrateTimestampsAbove(false);
        }
        if (!this.settings.lastReadFormatMigrated) {
          await this.migrateLastReadFormat();
        }
        if (this.settings.autoCleanDuplicates !== false) {
          await this.cleanDuplicateNotes();
        }
        if (!this.settings.onboarded) {
          this.openSetupWizard();
        } else if (this.settings.setupPending) {
          new Notice(
            "OmniBooks：还有书源未设置完成，可在 设置 → 安装向导 继续。",
            6000
          );
        }

        // 插件重载后强制重建已有书架视图，确保拿到最新的工具栏/滑杆 DOM。
        window.setTimeout(() => this.refreshViews(false, true), 400);
      });
    });
  }

  onunload(): void {
    /* Obsidian 会处理视图卸载；不要在这里 detach leaves */
  }

  async openBookReader(files: TFile[]): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOK_READER)[0] ?? null;

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_BOOK_READER, active: true });
    }

    const view = leaf.view;
    if (view instanceof BookReaderView) {
      await view.setBook(files);
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  rememberBookFile(file: TFile | null): void {
    this.lastBookFile = file;
  }


  isBookNote(file: TFile): boolean {
    if (file.extension !== "md") return false;
    const dirs = [
      this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    if (dirs.some((dir) => file.path.startsWith(`${dir}/`))) return true;
    // 目录设置还没同步到新设备时，先用书名/书源文件夹兜底。
    if (/(^|\/)(苹果图书|微信读书)(\/|$)/.test(file.path)) return true;

    // 换设备后目录设置可能还没同步过来：再用书籍 frontmatter 认一次。
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) return false;

    const classes = Array.isArray(fm.cssclasses)
      ? fm.cssclasses.map((value) => String(value))
      : typeof fm.cssclasses === "string"
        ? fm.cssclasses.split(/\s+/)
        : [];
    if (classes.includes("omnibooks")) return true;

    const source = String(fm.source ?? "").toLowerCase();
    if (source === "weread" || source === "apple" || source === "apple-books") {
      return true;
    }

    return ["bookId", "cover", "highlights", "readingTime", "lastRead", "annotation_count", "open_url", "source_file"]
      .some((key) => {
        const value = fm[key];
        return value !== undefined && value !== null && String(value).trim() !== "";
      });
  }

  /** 新设备上 metadataCache 可能晚于 file-open；这里短轮询等它认出书籍笔记。 */
  private openAsBookNote(
    file: TFile,
    leaf?: WorkspaceLeaf,
    attempt = 0
  ): void {
    if (this.settings.bookNoteView === "live") return;
    if (this.allowSourceOpen || this.switchingToReader || this.altKeyDown) return;
    if (this.manualSourcePath === file.path) return;
    if (attempt > 0) {
      const stillOpen = this.app.workspace
        .getLeavesOfType("markdown")
        .some(
          (item) =>
            item.view instanceof MarkdownView &&
            item.view.file?.path === file.path
        );
      if (!stillOpen) return;
    }

    if (!this.isBookNote(file)) {
      if (attempt < 20) {
        window.setTimeout(
          () => this.openAsBookNote(file, leaf, attempt + 1),
          150
        );
      }
      return;
    }

    if (this.settings.bookNoteView === "reading") {
      void this.openInReadingMode(file, leaf);
    } else {
      this.scheduleOpenInReader(file, leaf);
    }
  }

  private ensureActiveBookReader(): void {
    if (this.settings.bookNoteView !== "reader") return;
    if (this.allowSourceOpen || this.switchingToReader || this.altKeyDown) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file || !this.isBookNote(file)) return;
    if (this.manualSourcePath === file.path) return;
    this.scheduleOpenInReader(file, view.leaf);
  }

  private scheduleOpenInReader(
    file: TFile,
    leaf?: WorkspaceLeaf
  ): void {
    if (this.pendingReaderPath === file.path && this.switchingToReader) return;
    this.pendingReaderPath = file.path;
    const requestId = ++this.readerRequestId;
    let attempts = 0;

    const run = () => {
      if (this.pendingReaderPath !== file.path) return;
      if (this.allowSourceOpen) return;
      const maxAttempts = Platform.isMobile ? 50 : 20;
      if (this.switchingToReader) {
        if (attempts < maxAttempts) {
          attempts += 1;
          window.setTimeout(run, Platform.isMobile ? 60 : 20);
        }
        return;
      }
      const activeLeaf = this.app.workspace.activeLeaf;
      const target =
        leaf && leaf.view instanceof MarkdownView
          ? leaf
          : activeLeaf?.view instanceof MarkdownView &&
              activeLeaf.view.file?.path === file.path
            ? activeLeaf
            : this.app.workspace
                .getLeavesOfType("markdown")
                .find(
                  (item) =>
                    item.view instanceof MarkdownView &&
                    item.view.file?.path === file.path
                );
      if (target) {
        void this.openInReaderView(file, target, requestId);
        return;
      }
      if (attempts < maxAttempts) {
        attempts += 1;
        window.setTimeout(run, Platform.isMobile ? 60 : 20);
      }
    };

    run();
  }

  private async openInReaderView(
    file: TFile,
    preferredLeaf?: WorkspaceLeaf,
    requestId = this.readerRequestId
  ): Promise<void> {
    if (this.switchingToReader) return;
    this.switchingToReader = true;
    this.lastBookFile = file;
    try {
      if (requestId !== this.readerRequestId) return;
      const existingReader = this.app.workspace
        .getLeavesOfType(VIEW_TYPE_BOOK_READER)
        .find((item) => item.view instanceof BookReaderView);
      if (
        existingReader?.view instanceof BookReaderView &&
        existingReader === this.app.workspace.activeLeaf
      ) {
        await existingReader.view.setBook([file]);
        return;
      }
      const leaf =
        preferredLeaf ??
        (await this.findMarkdownLeaf(file)) ??
        this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
      const targetLeaf = leaf ?? this.app.workspace.getLeaf("tab");
      if (requestId !== this.readerRequestId) return;
      await targetLeaf.setViewState({
        type: VIEW_TYPE_BOOK_READER,
        active: true,
      });

      let reader: unknown = targetLeaf.view;
      const checkCount = Platform.isMobile ? 24 : 6;
      const checkDelay = Platform.isMobile ? 40 : 10;
      for (let i = 0; i < checkCount; i += 1) {
        if (reader instanceof BookReaderView) break;
        await new Promise<void>((resolve) => window.setTimeout(resolve, checkDelay));
        reader = targetLeaf.view;
      }

      // 兜底：替换失败就在新标签里打开阅读视图，至少能看到内容
      if (!(reader instanceof BookReaderView)) {
        const fallback = this.app.workspace.getLeaf("tab");
        await fallback.setViewState({ type: VIEW_TYPE_BOOK_READER, active: true });
        for (let i = 0; i < 10; i += 1) {
          if (fallback.view instanceof BookReaderView) break;
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 30)
          );
        }
        if (fallback.view instanceof BookReaderView) {
          await fallback.view.setBook([file]);
          await this.app.workspace.revealLeaf(fallback);
          reader = fallback.view;
        }
      }

      if (reader instanceof BookReaderView) {
        await this.app.workspace.revealLeaf(targetLeaf);
        if (requestId === this.readerRequestId) await reader.setBook([file]);
      } else {
        new Notice("无法切换到阅读视图，请从书架打开");
      }
    } catch (error) {
      /* 失败时保持原生笔记 */
    } finally {
      window.setTimeout(() => {
        this.switchingToReader = false;
      }, 120);
    }
  }

  private async findMarkdownLeaf(file: TFile): Promise<WorkspaceLeaf | null> {
    const maxAttempts = Platform.isMobile ? 24 : 6;
    const delay = Platform.isMobile ? 50 : 30;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const leaf = this.app.workspace
        .getLeavesOfType("markdown")
        .find(
          (item) =>
            item.view instanceof MarkdownView &&
            item.view.file?.path === file.path
        );
      if (leaf) return leaf;
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
    }
    return null;
  }

  private async openInReadingMode(
    file: TFile,
    preferredLeaf?: WorkspaceLeaf
  ): Promise<void> {
    // 换设备 / iCloud 刚同步时，file-open 往往早于 MarkdownView 就绪。
    // 这里不依赖单次事件，连续找几次 leaf，并同时尝试 setViewState 与 setState。
    const requestId = ++this.readerRequestId;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (requestId !== this.readerRequestId) return;
      if (this.allowSourceOpen || this.manualSourcePath === file.path) return;

      const activeLeaf = this.app.workspace.activeLeaf;
      const activeView = activeLeaf?.view;
      const candidate =
        preferredLeaf?.view instanceof MarkdownView &&
        preferredLeaf.view.file?.path === file.path
          ? preferredLeaf
          : activeView instanceof MarkdownView &&
              activeView.file?.path === file.path
            ? activeLeaf
            : await this.findMarkdownLeaf(file);

      const view = candidate?.view;
      if (candidate && view instanceof MarkdownView && view.file?.path === file.path) {
        if (view.getMode() === "preview") return;

        try {
          const state = view.getState();
          await candidate.setViewState({
            type: "markdown",
            state: { ...state, file: file.path, mode: "preview" },
          });
        } catch {
          /* 继续尝试下面的 setState */
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
        if (requestId !== this.readerRequestId) return;
        if (
          candidate.view instanceof MarkdownView &&
          candidate.view.getMode() === "preview"
        ) {
          return;
        }

        try {
          await view.setState(
            { ...view.getState(), file: file.path, mode: "preview" },
            { history: false }
          );
        } catch {
          /* 下一轮继续 */
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
        if (requestId !== this.readerRequestId) return;
        if (
          candidate.view instanceof MarkdownView &&
          candidate.view.getMode() === "preview"
        ) {
          return;
        }
      }

      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, attempt < 8 ? 40 : 120)
      );
    }
  }

  async openBookNoteSource(): Promise<void> {
    const file =
      this.lastBookFile ?? this.app.workspace.getActiveFile() ?? null;
    if (!file) {
      new Notice("没有可编辑的书籍笔记");
      return;
    }
    this.manualSourcePath = file.path;
    this.allowSourceOpen = true;
    window.setTimeout(() => {
      this.allowSourceOpen = false;
    }, 1200);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: "markdown",
      state: { file: file.path, mode: "source" },
    });
  }

  private async openLatestBookReader(): Promise<void> {
    const dir = normalizePath(this.settings.booksOutputDir || "读书笔记/苹果图书");
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${dir}/`))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    if (!files[0]) {
      new Notice("没有找到书籍笔记");
      return;
    }

    await this.activateView();
    await this.openBookReader([files[0]]);
  }

  currentIconId(): string {
    return iconId(this.settings.iconStyle || DEFAULT_ICON_ID);
  }

  /** 阅读视图设置变化后即时刷新已打开的阅读页 */
  refreshReaderViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOK_READER)) {
      const view = leaf.view;
      if (view instanceof BookReaderView) view.rerender();
    }
  }

  applyIconVars(): void {
    const root = document.documentElement;
    const base = this.settings.ribbonIconSize || 22;
    // 手机和 iPad 的侧边栏图标统一在设置值基础上 +4，默认 19 → 23px。
    const size = Platform.isMobile ? Math.min(30, base + 4) : base;
    root.setCssProps({ "--omni-icon-size": `${size}px` });
    root.setCssProps({ "--omni-icon-stroke": `${this.settings.ribbonIconStroke || 0.5}px`
     });
  }

  applyIcon(): void {
    const id = this.currentIconId();
    if (this.ribbonEl) setIcon(this.ribbonEl, id);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const update = (leaf as unknown as { updateHeader?: () => void }).updateHeader;
      if (typeof update === "function") update.call(leaf);
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_APPLE_BOOKS)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_APPLE_BOOKS, active: true });
    }

    await workspace.revealLeaf(leaf);
  }

  openSetupWizard(): void {
    // 首次打开即记为“已看过”：即使中途关掉，也不再每次启动都弹。
    // 但保留 setupPending，下次启动用一条轻提示提醒还有书源没连完。
    const firstRun = !this.settings.onboarded;
    this.settings.onboarded = true;
    if (firstRun) this.settings.setupPending = true;
    void this.saveData(this.settings);
    new SetupWizardModal(this.app, {
      source: null,
      wereadApiKey: this.settings.wereadApiKey ?? "",
      appleStatus: () => appleBooksStatus(),
      onWereadQrLogin: (switchAccount?: boolean) =>
        this.startWereadQrLogin(switchAccount),
      onOpenPermission: () => {
        openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
      },
      onOpenBooks: () => {
        openExternal("ibooks://");
      },
      onSkip: () => {
        this.settings.onboarded = true;
        this.settings.setupPending = false;
        void this.saveSettings();
      },
      onFinish: async (result: SetupResult, sync: SetupSyncHandlers) => {
        this.settings.setupSource = result.source;
        this.settings.onboarded = true;
        this.settings.setupPending = false;

        if (result.wereadSkipped) {
          this.settings.wereadEnabled = false;
        } else {
          this.settings.wereadEnabled = true;
          if (result.wereadApiKey) this.settings.wereadApiKey = result.wereadApiKey;
        }

        const bothSkipped = result.wereadSkipped && result.appleSkipped;
        // 向导只负责配置书源，不应该把同步按钮一起藏掉
        this.settings.syncEnabled = true;
        if (!bothSkipped) {
          if (result.appleSkipped) this.settings.syncScope = "weread";
          else if (result.wereadSkipped) this.settings.syncScope = "apple";
          else this.settings.syncScope = "all";
        }

        await this.saveSettings();
        if (!bothSkipped) await this.runFirstSync(result, sync);
        this.refreshViews(true);
      },
      onOpenShelf: () => {
        void this.activateView();
      },
    }).open();
  }

  openFeedback(): void {
    openExternal(this.feedbackIssueUrl());
  }

  private feedbackRepoUrl(): string {
    const base = (
      this.settings.feedbackUrl || DEFAULT_SETTINGS.feedbackUrl
    ).trim();
    return base.replace(/\/issues(\/.*)?$/i, "").replace(/\/+$/, "");
  }

  feedbackIssueUrl(label?: string): string {
    const repo = this.feedbackRepoUrl();
    return label
      ? `${repo}/issues/new?labels=${encodeURIComponent(label)}`
      : `${repo}/issues/new`;
  }

  feedbackAuthorUrl(): string {
    const repo = this.feedbackRepoUrl();
    const match = /^(https?:\/\/github\.com\/[^/]+)/i.exec(repo);
    return match?.[1] ?? repo;
  }

  async copyDiagnostics(): Promise<void> {
    const dirs = [
      this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    const count = this.app.vault
      .getMarkdownFiles()
      .filter((file) => dirs.some((dir) => file.path.startsWith(`${dir}/`))).length;
    const apple = appleBooksStatus();
    const platform = Platform.isMacOS
      ? "macOS"
      : Platform.isWin
        ? "Windows"
        : Platform.isLinux
          ? "Linux"
          : Platform.isMobile
            ? "移动端"
            : "桌面端";
    const appVersion =
      (this.app as unknown as { appVersion?: string }).appVersion ?? "";
    const lines = [
      `OmniBooks ${this.manifest.version}`,
      appVersion ? `Obsidian ${appVersion}` : "",
      platform,
      `书籍笔记：${count}`,
      `苹果图书：${apple.label}`,
      `微信读书：${this.settings.wereadApiKey ? "已配置 Key" : "未配置 Key"}`,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      new Notice("诊断信息已复制，可直接粘贴到 Issue 里");
    } catch {
      new Notice("复制失败，请手动截图或复制");
    }
  }

  private async followFolderRename(newPath: string, oldPath: string): Promise<void> {
    const keys = [
      "folder",
      "booksOutputDir",
      "coverDir",
      "wereadOutputDir",
      "profileDir",
      "shareDir",
      "quotesFilePath",
    ] as const;
    let changed = false;

    for (const key of keys) {
      const value = normalizePath(this.settings[key] || "");
      if (!value) continue;
      if (value !== oldPath && !value.startsWith(`${oldPath}/`)) continue;

      const updated = normalizePath(`${newPath}${value.slice(oldPath.length)}`);
      if (!updated || updated === value) continue;
      this.settings[key] = updated;
      changed = true;
    }

    if (!changed) return;
    await this.saveSettings();
    new Notice(`OmniBooks 路径已跟随移动到 ${newPath}`);
  }

  private async uniquePath(
    folder: string,
    base: string,
    suffix: string
  ): Promise<string> {
    let candidate = `${folder}/${base}${suffix}.md`;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${folder}/${base}${suffix} ${index}.md`;
      index += 1;
    }
    return candidate;
  }

  /** 把旧的 books/、阅读画像/、收藏/ 一次性整理到新结构 */
  private async migrateLayout(): Promise<void> {
    this.applyHiddenFolders();
    if (this.settings.layoutMigrated) {
      await this.cleanupLegacyFolders();
      return;
    }

    let moved = 0;
    const booksDir = normalizePath(
      this.settings.booksOutputDir || "OmniBooks/苹果图书"
    );
    const oldProfileDir = "OmniBooks/阅读画像";
    const configuredProfile = normalizePath(
      this.settings.profileDir || "OmniBooks/阅读"
    );
    const useDefaultProfile =
      configuredProfile === oldProfileDir || configuredProfile === "OmniBooks/阅读";
    const readDir = useDefaultProfile ? "OmniBooks/阅读" : configuredProfile;
    const oldQuotes = "OmniBooks/收藏/金句.md";
    const newQuotes = `${readDir}/金句.md`;

    // 苹果图书：books/ 里的笔记提到上一层
    const booksFolder = this.app.vault.getAbstractFileByPath(`${booksDir}/books`);
    if (booksFolder instanceof TFolder) {
      for (const child of [...booksFolder.children]) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        let target = `${booksDir}/${child.name}`;
        const existing = this.app.vault.getAbstractFileByPath(target);
        if (existing instanceof TFile) {
          const oldText = await this.app.vault.read(child);
          const newText = await this.app.vault.read(existing);
          if (oldText === newText) {
            try {
              await this.app.vault.delete(child);
            } catch {
              /* 忽略 */
            }
            continue;
          }
          target = await this.uniquePath(booksDir, child.basename, " (旧)");
        }
        try {
          await this.app.fileManager.renameFile(child, target);
          moved += 1;
        } catch {
          /* 跳过单个失败 */
        }
      }
      if (booksFolder.children.length === 0) {
        try {
          await this.app.vault.delete(booksFolder);
        } catch {
          /* 忽略 */
        }
      }
    }

    // 阅读画像/ -> 阅读/AI画像 …
    const oldProfile = this.app.vault.getAbstractFileByPath(oldProfileDir);
    if (useDefaultProfile && oldProfile instanceof TFolder && oldProfileDir !== readDir) {
      await this.ensureFolderPath(readDir);
      for (const child of [...oldProfile.children]) {
        if (!(child instanceof TFile)) continue;
        let name = child.name;
        if (child.extension === "md") {
          const base = child.basename.startsWith("AI画像")
            ? child.basename
            : `AI画像 ${child.basename}`;
          name = `${base}.md`;
        }
        let target = `${readDir}/${name}`;
        if (this.app.vault.getAbstractFileByPath(target)) {
          target =
            child.extension === "md"
              ? await this.uniquePath(readDir, name.replace(/\.md$/, ""), " (旧)")
              : `${readDir}/${child.basename}-${Date.now()}.${child.extension}`;
        }
        try {
          await this.app.fileManager.renameFile(child, target);
          moved += 1;
        } catch {
          /* 跳过单个失败 */
        }
      }
      if (oldProfile.children.length === 0) {
        try {
          await this.app.vault.delete(oldProfile);
        } catch {
          /* 忽略 */
        }
      }
    }

    // 收藏/金句.md -> 阅读/金句.md
    if (useDefaultProfile && oldQuotes !== newQuotes) {
      const quotesFile = this.app.vault.getAbstractFileByPath(oldQuotes);
      if (
        quotesFile instanceof TFile &&
        !this.app.vault.getAbstractFileByPath(newQuotes)
      ) {
        await this.ensureFolderPath(readDir);
        try {
          await this.app.fileManager.renameFile(quotesFile, newQuotes);
          moved += 1;
        } catch {
          /* 忽略 */
        }
      }
    }

    if (useDefaultProfile) {
      this.settings.profileDir = readDir;
      if (this.settings.quotesFilePath === oldQuotes) {
        this.settings.quotesFilePath = newQuotes;
      }
    }

    // 空文件夹收尾
    await this.cleanupLegacyFolders();

    this.settings.layoutMigrated = true;
    await this.saveSettings();
    if (moved > 0) new Notice(`OmniBooks 已整理：移动 ${moved} 个文件`);
  }

  private async cleanupLegacyFolders(): Promise<void> {
    const booksDir = normalizePath(
      this.settings.booksOutputDir || "OmniBooks/苹果图书"
    );
    for (const path of [
      `${booksDir}/books`,
      "OmniBooks/阅读画像",
      "OmniBooks/收藏",
    ]) {
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder)) continue;
      if (folder.children.length > 0) continue;
      try {
        await this.app.vault.adapter.rmdir(path, true);
      } catch {
        try {
          await this.app.vault.delete(folder);
        } catch {
          /* 忽略 */
        }
      }
    }
  }

  /** 清理同一书源内同一本书的完全重复副本；苹果和微信之间不互相比较 */
  async cleanDuplicateNotes(notify = false): Promise<number> {
    if (this.settings.autoCleanDuplicates === false) return 0;

    const sources = [
      {
        dir: normalizePath(
          this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir
        ),
        kind: "apple",
      },
      {
        dir: normalizePath(
          this.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir
        ),
        kind: "weread",
      },
    ];
    const bodyOf = (text: string): string => {
      const end = text.indexOf("\n---", 3);
      return (end >= 0 ? text.slice(end + 4) : text)
        .replace(/\r\n/g, "\n")
        .trim();
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = `${normalizePath(
      this.settings.syncBridgeDir || DEFAULT_SETTINGS.syncBridgeDir
    )}/duplicate-backup/${stamp}`;
    let removed = 0;

    for (const source of sources) {
      const groups = new Map<string, TFile[]>();
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(`${source.dir}/`)) continue;
        const text = await this.app.vault.read(file);
        const match =
          source.kind === "apple"
            ? /assetid\/([A-Za-z0-9]+)/.exec(text)
            : /^bookId:\s*"?([^"\n]+)/m.exec(text);
        if (!match) continue;
        const list = groups.get(match[1]) ?? [];
        list.push(file);
        groups.set(match[1], list);
      }

      for (const files of groups.values()) {
        if (files.length < 2) continue;
        const plain = files.filter((file) => !/ \d+\.md$/.test(file.name));
        const keep =
          plain[0] ??
          files.slice().sort((a, b) => b.stat.size - a.stat.size)[0];
        const keepBody = bodyOf(await this.app.vault.read(keep));

        for (const file of files) {
          if (file.path === keep.path) continue;
          const text = await this.app.vault.read(file);
          // 正文完全一致才删；内容不同的冲突版本先保留
          if (bodyOf(text) !== keepBody) continue;
          try {
            await this.ensureFolderPath(backupDir);
            await this.app.vault.adapter.write(
              `${backupDir}/${source.kind}-${file.name}`,
              text
            );
          } catch {
            continue;
          }
          try {
            await this.app.vault.delete(file);
            removed += 1;
          } catch {
            /* 忽略单个失败 */
          }
        }
      }
    }

    if (notify && removed > 0) {
      new Notice(`已清理 ${removed} 个重复副本`);
    }
    return removed;
  }

  private async syncFromCommand(): Promise<void> {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_APPLE_BOOKS)[0];
    const view = leaf?.view;
    if (view instanceof AppleBooksShelfView) {
      await view.runSync("all");
    }
  }

  /** 把独立的日期链接行合并到下一段划线末尾：正文 —— [日期](链接) */
  async migrateInlineTimestamps(): Promise<void> {
    const dirs = [
      this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    const stampRe =
      /^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\]\((<[^>]+>|[^)]+)\)\s*$/;
    let changed = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!dirs.some((dir) => file.path.startsWith(`${dir}/`))) continue;
      const text = await this.app.vault.read(file);
      if (!text.includes("](<")) continue;

      const lines = text.split("\n");
      const out: string[] = [];
      let fileChanged = false;
      for (let i = 0; i < lines.length; i += 1) {
        if (!stampRe.test(lines[i])) {
          out.push(lines[i]);
          continue;
        }
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j += 1;
        const next = lines[j];
        const blocked =
          !next || next.startsWith("#") || next.startsWith(">") || stampRe.test(next);
        if (blocked) {
          out.push(lines[i]);
          continue;
        }
        let k = j;
        while (
          k + 1 < lines.length &&
          lines[k + 1].trim() !== "" &&
          !lines[k + 1].startsWith("#") &&
          !lines[k + 1].startsWith(">") &&
          !stampRe.test(lines[k + 1])
        ) {
          k += 1;
        }
        for (let x = j; x <= k; x += 1) {
          out.push(x === k ? `${lines[x]} —— ${lines[i].trim()}` : lines[x]);
        }
        out.push("");
        fileChanged = true;
        i = k;
      }

      // 顺带把连续空行压成一个，避免编辑视图里出现大段空白
      const nextText = out.join("\n").replace(/\n{3,}/g, "\n\n");
      if (fileChanged || nextText !== text) {
        await this.app.vault.modify(file, nextText);
        changed += 1;
      }
    }

    new Notice(`已改为行尾时间戳：${changed} 篇笔记`);
  }

  /** 把 ISO 的 lastRead 统一成 YYYY-MM-DD HH:mm */
  async migrateLastReadFormat(notify = false): Promise<number> {
    const dirs = [
      this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    const re =
      /^lastRead:\s*"?(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z"?\s*$/m;
    let changed = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!dirs.some((dir) => file.path.startsWith(`${dir}/`))) continue;
      const text = await this.app.vault.read(file);
      if (!re.test(text)) continue;
      const next = text.replace(re, 'lastRead: "$1 $2"');
      if (next !== text) {
        await this.app.vault.modify(file, next);
        changed += 1;
      }
    }

    this.settings.lastReadFormatMigrated = true;
    await this.saveSettings();
    if (notify) new Notice(`已统一阅读时间格式：${changed} 篇`);
    return changed;
  }

  /** 把「正文 —— [时间](链接)」改成「时间在上、正文在下」，原生预览更像阅读视图 */
  async migrateTimestampsAbove(notify = true): Promise<number> {
    const dirs = [
      this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    const stampRe = /^(.*?)\s*——\s*(\[[^\]]+\]\(<[^>]+>\))\s*$/;
    let changed = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!dirs.some((dir) => file.path.startsWith(`${dir}/`))) continue;
      const text = await this.app.vault.read(file);
      if (!text.includes(" —— [")) continue;

      const lines = text.split("\n");
      const out: string[] = [];
      let fileChanged = false;

      for (const line of lines) {
        const match = stampRe.exec(line);
        if (!match || !match[1].trim()) {
          out.push(line);
          continue;
        }
        const quote = match[1].trim();
        out.push(match[2]);
        out.push("");
        out.push(...quote.split("\n"));
        out.push("");
        fileChanged = true;
      }

      if (!fileChanged) continue;
      const next = out.join("\n").replace(/\n{3,}/g, "\n\n");
      if (next !== text) {
        await this.app.vault.modify(file, next);
        changed += 1;
      }
    }

    this.settings.timestampsMigrated = true;
    await this.saveSettings();
    if (notify) new Notice(`已改为日期在上：${changed} 篇笔记`);
    return changed;
  }

  private async diagnose(): Promise<void> {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_APPLE_BOOKS)[0];
    const view = leaf?.view;
    if (!(view instanceof AppleBooksShelfView)) {
      new Notice("请先打开书架视图");
      return;
    }
    await view.exportDiagnostics();
    new Notice("诊断信息已写入 .apple-books-sync/diagnostics.json");
  }

  bridgePath(file: string): string {
    const dir = normalizePath(this.settings.syncBridgeDir || ".apple-books-sync");
    return `${dir}/${file}`;
  }

  /** 手机端排查用：把打开笔记的链路写到库内，方便回到电脑上看 */
  private mobileLog(line: string): void {
    if (!Platform.isMobile) return;
    const dir = normalizePath(this.settings.syncBridgeDir || ".apple-books-sync");
    const path = `${dir}/mobile-open.log`;
    const text = `${new Date().toISOString()} ${line}\n`;
    void (async () => {
      try {
        if (!(await this.app.vault.adapter.exists(dir))) {
          await this.app.vault.adapter.mkdir(dir);
        }
        await this.app.vault.adapter.append(path, text);
      } catch {
        /* 日志失败不影响功能 */
      }
    })();
  }

  runSync(): Promise<{ ok: boolean; message: string }> {
    return (async () => {
      try {
        const report = await syncAppleBooksNative(
          this.app,
          this.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
          this.settings.coverDir || undefined
        );

        await this.app.vault.adapter
          .write(this.bridgePath("last-result.txt"), JSON.stringify(report, null, 2))
          .catch(() => undefined);

        if (report.failed.length > 0) {
          return { ok: false, message: report.failed[0].error };
        }
        void this.cleanDuplicateNotes();
        return { ok: true, message: "" };
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        if (/Operation not permitted|EACCES|EPERM/i.test(message)) {
          message =
            "读取苹果图书数据库被系统拒绝。请到 系统设置 → 隐私与安全性 → 完全磁盘访问权限，添加并勾选 Obsidian（没有就点 + 添加），然后完全退出并重开 Obsidian。";
        }
        await this.app.vault.adapter
          .write(this.bridgePath("last-error.txt"), `${new Date().toISOString()}\n${message}`)
          .catch(() => undefined);
        return { ok: false, message };
      }
    })();
  }

  async runWereadSync(handlers?: {
    onProgress?: (message: string) => void;
    onBook?: (total: number) => void;
  }): Promise<{ ok: boolean; message: string }> {
    if (!this.settings.wereadEnabled) return { ok: true, message: "" };
    if (!this.settings.wereadApiKey) {
      return { ok: false, message: "未配置微信读书 API Key" };
    }

    const logLines: string[] = [];
    const logPath = this.bridgePath("sync.log");
    const log = (line: string) => {
      logLines.push(`${new Date().toISOString()} ${line}`);
      void this.app.vault.adapter.write(logPath, logLines.join("\n")).catch(() => undefined);
    };

    try {
      const report = await syncWeread(
        this.app,
        this.settings.wereadApiKey,
        this.settings.wereadOutputDir || "微信读书",
        {
          gateway: this.settings.wereadGateway?.trim() || undefined,
          cachePath: this.bridgePath("weread-cache.json"),
          backupMode: this.settings.wereadBackupMode ?? "changed",
          backupDir: this.settings.wereadBackupDir || ".omnibooks-backup/weread",
          backupKeep: this.settings.wereadBackupKeep ?? 5,
          onProgress: handlers?.onProgress,
          onBook: handlers?.onBook,
          onLog: log,
        }
      );
      log(`report: ${JSON.stringify(report)}`);
      void this.app.vault.adapter.write(logPath, logLines.join("\n")).catch(() => undefined);

      await this.app.vault.adapter
        .write(this.bridgePath("last-weread.json"), JSON.stringify(report, null, 2))
        .catch(() => undefined);

      if (report.offline) {
        const restored = report.restored ?? 0;
        return {
          ok: true,
          message: `接口不可用，已用上次快照（补回 ${restored} 本）`,
        };
      }
      if (report.failed.length > 0) {
        return { ok: false, message: report.failed[0].error };
      }
      void this.cleanDuplicateNotes();
      return { ok: true, message: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.app.vault.adapter
        .write(this.bridgePath("last-weread-error.txt"), `${new Date().toISOString()}\n${message}`)
        .catch(() => undefined);
      return { ok: false, message };
    }
  }

  /** 安装向导点「完成」后的首次同步：边同步边回传进度，部分书入库即通知 */
  private async runFirstSync(
    result: SetupResult,
    sync: SetupSyncHandlers
  ): Promise<void> {
    const tasks: Array<Promise<void>> = [];

    if (!result.wereadSkipped) {
      tasks.push(
        (async () => {
          sync.onProgress("微信读书：正在读取书架…");
          const report = await this.runWereadSync({
            onProgress: (message) => sync.onProgress(`微信读书 ${message}`),
            onBook: (total) => {
              if (total >= 3) sync.onBooksReady();
            },
          });
          if (!report.ok) {
            new Notice(`微信读书同步失败：${report.message}`, 10000);
          } else if (report.message) {
            new Notice(report.message, 6000);
          }
        })()
      );
    }

    if (!result.appleSkipped) {
      if (Platform.isDesktopApp) {
        tasks.push(
          (async () => {
            sync.onProgress("苹果图书：正在读取本机书库…");
            const report = await this.runSync();
            if (!report.ok) {
              new Notice(`苹果图书同步失败：${report.message}`, 10000);
            }
            sync.onBooksReady();
          })()
        );
      } else {
        sync.onProgress("苹果图书：请在同一 iCloud 库的 Mac 上完成首次同步。");
      }
    }

    await Promise.all(tasks);
    sync.onProgress("同步完成");
  }

  async migrateToDefaultLayout(): Promise<void> {
    const moves = [
      { from: this.settings.booksOutputDir || "苹果图书", to: "OmniBooks/苹果图书" },
      { from: this.settings.wereadOutputDir || "微信读书", to: "OmniBooks/微信读书" },
    ];

    let moved = 0;
    for (const move of moves) {
      const from = normalizePath(move.from);
      const to = normalizePath(move.to);
      if (!from || from === to) continue;

      const files = this.app.vault.getFiles().filter((file) => file.path.startsWith(`${from}/`));
      for (const file of files) {
        const relative = file.path.slice(from.length + 1);
        const destination = `${to}/${relative}`;
        await this.ensureFolderPath(destination.split("/").slice(0, -1).join("/"));
        try {
          await this.app.fileManager.renameFile(file, destination);
          moved += 1;
        } catch {
          /* 跳过单个失败 */
        }
      }
    }

    this.settings.booksOutputDir = "OmniBooks/苹果图书";
    this.settings.wereadOutputDir = "OmniBooks/微信读书";
    await this.saveSettings();
    this.refreshViews();
    new Notice(`已整理 ${moved} 个文件到 OmniBooks`);
  }

  private async ensureFolderPath(folder: string): Promise<void> {
    const normalized = normalizePath(folder);
    if (!normalized) return;
    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch {
          /* 已存在 */
        }
      }
    }
  }

  openAiAdvisor(): void {
    const modal = new AiAdvisorModal(this.app, {
      dirs: [
        this.settings.booksOutputDir || "苹果图书",
        this.settings.wereadOutputDir || "微信读书",
      ],
      shareDir: this.settings.shareDir || "OmniBooks/阅读",
      baseUrl: this.settings.aiBaseUrl,
      apiKey: this.settings.aiApiKey,
      model: this.settings.aiModel,
      includeNotes: false,
      modules: this.settings.aiModules,
      themeView: this.settings.aiThemeView,
      history: this.settings.aiHistory ?? [],
      cache: this.settings.aiCache ?? undefined,
      saveCache: async (cache) => {
        this.settings.aiCache = cache;
        const history = this.settings.aiHistory ?? [];
        const monthKey = new Date(cache.savedAt).toISOString().slice(0, 7);
        const existing = history.findIndex(
          (item) => new Date(item.savedAt).toISOString().slice(0, 7) === monthKey
        );
        if (existing >= 0) history[existing] = cache;
        else history.push(cache);
        this.settings.aiHistory = history.slice(-24);
        await this.saveSettings();
        void this.writeProfileNote(cache);
      },
    }, {
      models: this.settings.aiModels ?? [],
      save: async (patch) => {
        if (patch.baseUrl !== undefined) this.settings.aiBaseUrl = patch.baseUrl;
        if (patch.apiKey !== undefined) this.settings.aiApiKey = patch.apiKey;
        if (patch.model !== undefined) this.settings.aiModel = patch.model;
        if (patch.models !== undefined) this.settings.aiModels = patch.models;
        if (patch.themeView !== undefined) this.settings.aiThemeView = patch.themeView;
        await this.saveSettings();
      },
      fetchModels: (baseUrl, apiKey) => this.fetchAiModels(baseUrl, apiKey),
    });
    modal.open();
  }

  /** 用 Base URL + API Key 拉取可用模型列表（OpenAI 兼容的 /models） */
  async fetchAiModels(
    baseUrl?: string,
    apiKey?: string
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const base = (baseUrl ?? this.settings.aiBaseUrl ?? "").trim().replace(/\/+$/, "");
    const key = (apiKey ?? this.settings.aiApiKey ?? "").trim();
    if (!base) return { ok: false, models: [], error: "缺少 Base URL" };
    if (!key) return { ok: false, models: [], error: "缺少 API Key" };

    try {
      const response = await Promise.race([
        requestUrl({
          url: `${base}/models`,
          method: "GET",
          headers: { Authorization: `Bearer ${key}` },
          throw: false,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("请求超时（15 秒）")), 15000);
        }),
      ]);

      if (response.status < 200 || response.status >= 300) {
        const detail = String(response.text ?? "").replace(/\s+/g, " ").slice(0, 160);
        return { ok: false, models: [], error: `HTTP ${response.status} ${detail}` };
      }

      let payload: any = response.json;
      if (!payload) {
        try {
          payload = JSON.parse(response.text);
        } catch {
          return { ok: false, models: [], error: "返回的不是 JSON" };
        }
      }

      const list = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
      const models: string[] = [];
      for (const item of list) {
        const id =
          typeof item === "string" ? item : (item?.id ?? item?.name ?? "").toString().trim();
        if (id && !models.includes(id)) models.push(id);
      }

      if (models.length === 0) {
        return { ok: false, models: [], error: "接口没有返回模型列表" };
      }

      models.sort((a, b) => a.localeCompare(b));
      this.settings.aiModels = models;
      if (!this.settings.aiModel || !models.includes(this.settings.aiModel)) {
        this.settings.aiModel = models[0];
      }
      await this.saveSettings();
      return { ok: true, models };
    } catch (error) {
      return { ok: false, models: [], error: (error as Error).message };
    }
  }

  async importAiFromCopilot(): Promise<boolean> {
    try {
      const raw = await this.app.vault.adapter.read(
        ".obsidian/plugins/copilot/data.json"
      );
      const imported = importCopilotSettings(raw);
      if (!imported.apiKey) throw new Error("Copilot 里没有可用的 API Key");
      this.settings.aiBaseUrl = imported.baseUrl ?? this.settings.aiBaseUrl;
      this.settings.aiApiKey = imported.apiKey;
      this.settings.aiModel = imported.model ?? this.settings.aiModel;
      await this.saveSettings();
      new Notice("已从 Copilot 导入 AI 配置");
      return true;
    } catch (error) {
      new Notice(
        `导入失败：${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  async importAppleBooks(): Promise<void> {
    new Notice("正在导入苹果图书…");
    const result = await this.runSync();

    if (!result.ok) {
      new Notice(`导入失败：${result.message}`);
      if (/authorization|denied|权限|not authorized/i.test(result.message)) {
        new Notice("请在 系统设置 → 隐私与安全性 → 完全磁盘访问权限 中勾选 Obsidian");
        openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        );
      }
      return;
    }

    new Notice("苹果图书导入完成");
    this.refreshViews();
  }

  openTimeline(): void {
    new TimelineModal(this.app, [
      this.settings.booksOutputDir || "OmniBooks/苹果图书",
      this.settings.wereadOutputDir || "OmniBooks/微信读书",
    ]).open();
  }

  openReadingStats(): void {
    new ReadingStatsModal(
      this.app,
      this.settings.booksOutputDir || "苹果图书",
      this.settings.wereadOutputDir || "微信读书"
    ).open();
  }

  private confirmWereadSwitch(): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText("更换微信读书账号");
      modal.contentEl.createEl("p", {
        text: "会清除当前设备的 API Key 和扫码登录缓存。旧账号同步的笔记会在下次同步时被清理，默认会先备份。",
      });
      const footer = modal.contentEl.createDiv({ cls: "modal-button-container" });
      footer
        .createEl("button", { text: "取消" })
        .addEventListener("click", () => {
          resolve(false);
          modal.close();
        });
      footer
        .createEl("button", { cls: "mod-warning", text: "更换账号" })
        .addEventListener("click", () => {
          resolve(true);
          modal.close();
        });
      modal.onClose = () => resolve(false);
      modal.open();
    });
  }

  async switchWereadAccount(): Promise<void> {
    if (!(await this.confirmWereadSwitch())) return;
    await this.startWereadQrLogin(true);
    this.refreshViews();
  }

  async startWereadQrLogin(switchAccount = false): Promise<string | null> {    const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;

    if (Platform.isMobile || !nodeRequire) {
      if (switchAccount) {
        this.settings.wereadApiKey = "";
        await this.saveSettings();
      }
      openExternal("https://weread.qq.com/r/weread-skills");
      new Notice(
        switchAccount
          ? "已清除当前账号。请在网页登录新账号后复制 API Key，粘贴到设置里。"
          : "已打开微信读书官方页面，扫码后可复制 API Key"
      );
      return null;
    }

    if (switchAccount) {
      // 先退出旧账号：清空 Key、登录缓存，避免扫码窗口直接复用旧 Cookie
      this.settings.wereadApiKey = "";
      await this.saveSettings();
      await this.app.vault.adapter
        .remove(this.bridgePath("weread-cache.json"))
        .catch(() => undefined);
    }

    try {
      const electron = nodeRequire("electron") as {
        remote?: {
          BrowserWindow: new (options: Record<string, unknown>) => {
            loadURL(url: string): Promise<void>;
            show(): void;
            close(): void;
            webContents: {
              session: {
                cookies: { get(filter: { url: string }): Promise<Array<{ name: string; value: string }>> };
                clearStorageData(options?: { storages?: string[] }): Promise<void>;
              };
            };
            on(event: string, callback: () => void): void;
          };
          getCurrentWindow(): unknown;
        };
      };
      const remote = electron.remote;
      if (!remote) throw new Error("不支持内嵌窗口");

      const win = new remote.BrowserWindow({
        width: 480,
        height: 720,
        parent: remote.getCurrentWindow(),
        title: switchAccount ? "微信扫码登录（更换账号）" : "微信扫码登录",
        webPreferences: { partition: "persist:omnibooks-weread-login" },
      });

      if (switchAccount) {
        try {
          await win.webContents.session.clearStorageData({
            storages: ["cookies", "localstorage", "indexdb", "cachestorage"],
          });
        } catch {
          /* 清不掉 Cookie 时仍允许手动登录 */
        }
      }

      await win.loadURL("https://weread.qq.com/#login");
      win.show();
      new Notice(
        switchAccount
          ? "请用另一个微信扫码登录，登录后会自动替换 API Key"
          : "请用微信扫码登录，登录后会自动获取 API Key"
      );

      return await new Promise<string | null>((resolve) => {
        let done = false;
        let timer = 0;

        const finish = (key: string | null) => {
          if (done) return;
          done = true;
          if (timer) window.clearInterval(timer);
          resolve(key);
        };

        timer = window.setInterval(async () => {
          if (done) return;
          try {
            const cookies = await win.webContents.session.cookies.get({
              url: "https://weread.qq.com",
            });
            if (cookies.length === 0) return;

            const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
            const response = await requestUrl({
              url: "https://weread.qq.com/api/skills/apikeyGet",
              method: "GET",
              headers: { Cookie: cookieHeader },
              throw: false,
            });
            const key = (response.json as { apikey?: string } | undefined)?.apikey;
            if (!key) return;

            this.settings.wereadApiKey = key;
            await this.saveSettings();
            new Notice(
              "已保存微信读书 API Key。这台设备以后会自动使用；其他设备第一次使用时各填一次。",
              6000
            );
            finish(key);
            win.close();
          } catch {
            /* 等待扫码完成 */
          }
        }, 3000);

        win.on("closed", () => finish(null));
      });
    } catch (error) {
      new Notice(
        `无法打开扫码窗口：${error instanceof Error ? error.message : String(error)}`
      );
      openExternal("https://weread.qq.com/r/weread-skills");
      return null;
    }
  }

  private dimLabel(key: string): string {
    return (
      { literary: "文学", philosophical: "思想", knowledge: "知识", realism: "现实", social: "社会", imagination: "想象" }[
        key
      ] ?? key
    );
  }

  private profileSvg(profile: Record<string, number>): string {
    const dims: Array<[string, string, number]> = [
      ["literary", "文学", -90],
      ["philosophical", "思想", -30],
      ["knowledge", "知识", 30],
      ["realism", "现实", 90],
      ["social", "社会", 150],
      ["imagination", "想象", 210],
    ];
    const W = 320, H = 300, cx = 160, cy = 152, R = 100;
    const pt = (angle: number, value: number) => {
      const rad = (angle * Math.PI) / 180;
      const r = (Math.max(0, Math.min(10, value)) / 10) * R;
      return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
    };
    const ring = (lv: number) =>
      dims.map(([, , a]) => pt(a, lv).map((n) => n.toFixed(1)).join(",")).join(" ");
    const shape = dims
      .map(([key, , a]) => pt(a, profile[key] ?? 0).map((n) => n.toFixed(1)).join(","))
      .join(" ");
    const spokes = dims
      .map(([key, label, a]) => {
        const [x, y] = pt(a, 10);
        const [lx, ly] = pt(a, 12.4);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#8884" stroke-width="1"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" font-size="12" fill="#999" text-anchor="middle">${label}</text>`;
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${[2, 4, 6, 8, 10].map((lv) => `<polygon points="${ring(lv)}" fill="none" stroke="#8883" stroke-width="1"/>`).join("")}${spokes}<polygon points="${shape}" fill="#7d8ec933" stroke="#7d8ec9" stroke-width="2"/></svg>`;
  }

  private barsSvg(profile: Record<string, number>): string {
    const rows: Array<[string, string]> = [
      ["literary", "文学"],
      ["philosophical", "思想"],
      ["knowledge", "知识"],
      ["realism", "现实"],
      ["social", "社会"],
      ["imagination", "想象"],
    ];
    const sorted = rows.slice().sort((a, b) => (profile[b[0]] ?? 0) - (profile[a[0]] ?? 0));
    const rowH = 30, W = 460, H = rowH * sorted.length + 10;
    const bars = sorted.map(([key, label], i) => {
      const value = Number(profile[key] ?? 0);
      const y = i * rowH + 6;
      const w = (value / 10) * 320;
      return `<text x="0" y="${y + 15}" font-size="13" fill="#999">${label}</text><rect x="52" y="${y + 4}" width="320" height="10" rx="5" fill="#8883"/><rect x="52" y="${y + 4}" width="${w.toFixed(1)}" height="10" rx="5" fill="#7d8ec9"/><text x="388" y="${y + 15}" font-size="13" fill="#999">${value.toFixed(1)}</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bars.join("")}</svg>`;
  }

  /** 把每次阅读画像写成带日期的笔记（报表格式） */
  private async writeProfileNote(cache: AiCache): Promise<void> {
    try {
      const date = new Date(cache.savedAt).toISOString().slice(0, 10);
      const dir = normalizePath(this.settings.profileDir || "OmniBooks/阅读");
      if (!(await this.app.vault.adapter.exists(dir))) {
        await this.app.vault.createFolder(dir);
      }

      const analysis = cache.analysis;
      const profile = (analysis.profile ?? {}) as unknown as Record<string, number>;
      const coverage = (analysis.coverage ?? {}) as unknown as Record<string, number>;
      const dims = ["literary", "philosophical", "knowledge", "realism", "social", "imagination"];

      const L: string[] = [];
      L.push("---");
      L.push(`title: "AI画像 ${date}"`);
      L.push(`date: ${date}`);
      for (const key of dims) {
        if (profile[key] !== undefined) L.push(`${key}: ${Number(profile[key]).toFixed(1)}`);
      }
      L.push("---");
      L.push("");
      L.push(`# AI画像 · ${date}`);
      L.push("");

      if (analysis.summary) {
        L.push(`> ${analysis.summary}`);
        L.push("");
      }

      L.push("## 六维画像");
      L.push("");
      L.push(this.profileSvg(profile));
      L.push("");
      L.push(this.barsSvg(profile));
      L.push("");
      L.push("| 维度 | 得分 | 覆盖度 |");
      L.push("| --- | ---: | ---: |");
      for (const key of dims) {
        L.push(
          `| ${this.dimLabel(key)} | ${Number(profile[key] ?? 0).toFixed(1)} | ${Math.round(
            Number(coverage[key] ?? 0) * 100
          )}% |`
        );
      }
      L.push("");

      if (analysis.themes?.length) {
        L.push("## 最近在关注");
        L.push("");
        for (const theme of analysis.themes) L.push(`- ${theme}`);
        L.push("");
      }

      if (analysis.blindSpots?.length) {
        L.push("## 偏科 / 缺口");
        L.push("");
        for (const spot of analysis.blindSpots) L.push(`- ${spot}`);
        L.push("");
      }

      if (analysis.motifs?.length) {
        L.push("## 长期母题");
        L.push("");
        L.push(analysis.motifs.map((motif: string) => `\`${motif}\``).join(" · "));
        L.push("");
      }

      if (analysis.recommendations?.length) {
        L.push("## 推荐");
        L.push("");
        const buckets: Array<[string, string]> = [
          ["comfort", "延续"],
          ["deepen", "深入"],
          ["compensate", "补偿"],
          ["bridge", "桥梁"],
          ["adventure", "冒险"],
        ];
        L.push("| 类型 | 书名 | 作者 | 理由 |");
        L.push("| --- | --- | --- | --- |");
        for (const [mode, label] of buckets) {
          for (const item of analysis.recommendations as Array<{
            mode: string;
            title: string;
            author?: string;
            reason?: string;
          }>) {
            if (item.mode !== mode) continue;
            L.push(
              `| ${label} | 《${item.title}》 | ${item.author ?? ""} | ${(item.reason ?? "").replace(/\|/g, "／")} |`
            );
          }
        }
        L.push("");
      }

      L.push("---");
      L.push(`<sub>生成于 ${new Date(cache.savedAt).toLocaleString("zh-CN")} · OmniBooks</sub>`);
      L.push("");

      const path = `${dir}/AI画像 ${date}.md`;
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modify(existing as never, L.join("\n"));
      else await this.app.vault.create(path, L.join("\n"));
      new Notice(`AI画像已保存到 ${path}`);
    } catch {
      /* 忽略写入失败 */
    }
  }

  async cleanupLegacyWeread(): Promise<void> {
    const dir = normalizePath(this.settings.wereadOutputDir || "OmniBooks/微信读书");
    const known = new Set<string>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${dir}/`)) continue;
      const text = await this.app.vault.read(file);
      const bookId = /^bookId:\s*"?([^"\n]+)"?/m.exec(text)?.[1]?.trim();
      if (bookId) known.add(bookId);
    }

    let removed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      let text = "";
      try {
        text = await this.app.vault.read(file);
      } catch {
        continue;
      }
      if (!/^doc_type:\s*"?weread-/m.test(text)) continue;
      const bookId = /^bookId:\s*"?([^"\n]+)"?/m.exec(text)?.[1]?.trim();
      if (!bookId || !known.has(bookId)) continue;
      try {
        await this.app.vault.trash(file, true);
        removed += 1;
      } catch {
        /* 忽略 */
      }
    }

    new Notice(`已清理 ${removed} 个旧微信读书模板笔记`);
  }

  async importWereadKey(): Promise<boolean> {
    try {
      const raw = await this.app.vault.adapter.read(
        ".obsidian/plugins/obsidian-weread-plugin/data.json"
      );
      const parsed = JSON.parse(raw) as { wereadApiKey?: string };
      const key = (parsed.wereadApiKey ?? "").trim();
      if (!key) throw new Error("现有 Weread 插件里没有 API Key");
      this.settings.wereadApiKey = key;
      await this.saveSettings();
      new Notice(
        "已导入并保存微信读书 API Key。这台设备以后会自动使用；其他设备第一次使用时各填一次。",
        6000
      );
      return true;
    } catch (error) {
      new Notice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async syncWereadFromCommand(): Promise<void> {
    new Notice("正在同步微信读书…");
    void this.app.vault.adapter
      .write(this.bridgePath("sync.log"), `${new Date().toISOString()} start\n`)
      .catch(() => undefined);
    const result = await this.runWereadSync();
    new Notice(result.ok ? result.message || "微信读书已更新" : `微信读书更新失败：${result.message}`);
    if (result.ok) this.refreshViews();
  }

  private startRequestWatcher(): void {
    const interval = window.setInterval(() => {
      void this.processPendingRequest();
    }, 3000);
    this.registerInterval(interval);
  }

  private startAutoSync(): void {
    const minutes = this.settings.syncIntervalMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const interval = window.setInterval(() => {
      if (this.processingRequest) return;
      void this.runSync().then((result) => {
        if (result.ok) this.refreshViews();
      });
    }, minutes * 60_000);
    this.registerInterval(interval);
  }

  private startFormatWatcher(): void {
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.formatTimer !== null) window.clearTimeout(this.formatTimer);
        this.formatTimer = window.setTimeout(() => {
          this.formatTimer = null;
          void this.formatAppleBooksNotes();
        }, 4000);
      })
    );
  }

  private async appleBooksDir(): Promise<string> {
    return normalizePath(this.settings.booksOutputDir || "读书笔记/苹果图书");
  }

  async formatAppleBooksNotes(notify = false): Promise<void> {
    if (this.formatting) return;
    this.formatting = true;
    try {
      const dir = await this.appleBooksDir();
      let count = 0;

      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(`${dir}/`)) continue;
        const text = await this.app.vault.read(file);
        const formatted = formatLegacyNote(text);
        if (formatted && formatted !== text) {
          await this.app.vault.modify(file, formatted);
          count += 1;
        }
      }

      if (notify) {
        new Notice(count > 0 ? `已重新排版 ${count} 个笔记` : "没有需要排版的笔记");
      }
    } finally {
      this.formatting = false;
    }
  }

  private async processPendingRequest(): Promise<void> {
    if (this.processingRequest) return;

    const adapter = this.app.vault.adapter;
    const requestPath = this.bridgePath("request.json");
    const statusPath = this.bridgePath("status.json");

    if (!(await adapter.exists(requestPath))) return;

    this.processingRequest = true;
    try {
      const raw = await adapter.read(requestPath);
      let request: { id?: string } = {};
      try {
        request = JSON.parse(raw) as { id?: string };
      } catch {
        /* 忽略损坏的请求 */
      }
      await adapter.remove(requestPath);

      const result = await this.runSync();
      await adapter.write(
        statusPath,
        JSON.stringify({
          id: request.id ?? "",
          ok: result.ok,
          message: result.message,
          ts: Date.now(),
        })
      );

      if (result.ok) {
        this.refreshViews();
        new Notice("苹果图书已更新");
      } else {
        new Notice(`苹果图书更新失败：${result.message}`);
      }
    } finally {
      this.processingRequest = false;
    }
  }

  refreshViews(notify = false, force = false): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_APPLE_BOOKS);
    for (const leaf of leaves) {
      if (leaf.view instanceof AppleBooksShelfView) {
        leaf.view.rebuild(force);
      }
    }
    if (notify) new Notice("OmniBooks：已重新扫描");
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<AppleBooksSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
    // 老用户已有配置，不弹首次安装向导；新安装才会看到
    if (data && (data as Partial<AppleBooksSettings>).onboarded === undefined) {
      this.settings.onboarded = true;
    }
    const legacyReader = (data as { openBookInReader?: boolean } | null)
      ?.openBookInReader;
    if (
      data &&
      (data as Partial<AppleBooksSettings>).bookNoteView === undefined &&
      legacyReader === false
    ) {
      this.settings.bookNoteView = "live";
    }
    const allowed: ShelfLayout[] = Platform.isPhone
      ? PHONE_LAYOUTS
      : ["grid", "deck", "coverflow", "timeline"];
    if (!allowed.includes(this.settings.shelfLayout)) {
      this.settings.shelfLayout = "grid";
    }
    if (!ICON_OPTIONS.some((option) => option.id === this.settings.iconStyle)) {
      this.settings.iconStyle = DEFAULT_ICON_ID;
    }

    // 旧版本的分析模块列表里没有 completion，还留着已下线的 months，这里做一次迁移
    const savedModules = Array.isArray(this.settings.aiModules) ? this.settings.aiModules : [];
    const validModules = new Set(AI_MODULES.map((item) => item.id));
    const modules = new Set(savedModules.length ? savedModules : DEFAULT_SETTINGS.aiModules);
    if (savedModules.includes("months")) modules.add("completion");
    this.settings.aiModules = [...modules].filter((id) => validModules.has(id));
  }

  private visiblePropertyKeys = new Set<string>();
  private hiddenFolderPaths: string[] = [];

  applyPropertyVisibility(): void {
    const showAll = this.settings.showAllProperties === true;
    this.visiblePropertyKeys = new Set(
      (this.settings.visibleProperties || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    );
    document.body.toggleClass("omnibooks-show-all-props", showAll);
    this.syncPropertyVisibility();
  }

  syncPropertyVisibility(): void {
    const showAll = this.settings.showAllProperties === true;
    document
      .querySelectorAll<HTMLElement>(".metadata-property[data-property-key]")
      .forEach((el) => {
        const key = el.dataset.propertyKey ?? "";
        el.toggleClass(
          "abs-prop-hidden",
          !showAll && !this.visiblePropertyKeys.has(key)
        );
      });
  }

  applyHiddenFolders(): void {
    if (this.settings.hideAssetFolder === false) {
      this.hiddenFolderPaths = [];
      this.syncExplorerHiddenFolders();
      return;
    }
    const dir = normalizePath(
      this.settings.booksOutputDir || "OmniBooks/苹果图书"
    );
    const folders = [`${dir}/assets`];
    const customCover = normalizePath(this.settings.coverDir || "");
    if (customCover) folders.push(customCover);
    this.hiddenFolderPaths = folders;
    this.syncExplorerHiddenFolders();
  }

  syncExplorerHiddenFolders(): void {
    document
      .querySelectorAll<HTMLElement>(".nav-folder-title[data-path]")
      .forEach((title) => {
        const path = title.dataset.path ?? "";
        title
          .closest(".nav-folder")
          ?.toggleClass(
            "abs-hide-folder",
            this.hiddenFolderPaths.includes(path)
          );
      });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyHiddenFolders();
    this.applyPropertyVisibility();
    this.refreshViews(false, true);
  }


}

export class AppleBooksShelfView extends ItemView {
  private plugin: AppleBooksShelfPlugin;
  private books: Book[] = [];
  private query = "";
  private statusFilter: StatusKey = "全部";
  private curationFilter: "all" | "liked" | "shelved" = "all";
  private deckKeyHandler: ((dir: "left" | "right") => void) | null = null;
  private sourceFilter: "all" | "apple" | "weread" = "all";
  private sort: SortKey;

  private gridEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private emptyEl!: HTMLElement;

  private refreshTimer: number | null = null;
  private scanStats = { files: 0, matched: 0 };
  private refreshPromise: Promise<void> | null = null;
  private refreshQueued = false;
  private lastRenderSignature = "";
  private lastStatsSignature = "";
  private chromeSyncEnabled = true;

  constructor(leaf: WorkspaceLeaf, plugin: AppleBooksShelfPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.sort = plugin.settings.defaultSort;
  }

  getViewType(): string {
    return VIEW_TYPE_APPLE_BOOKS;
  }

  getDisplayText(): string {
    return "OmniBooks";
  }

  getIcon(): string {
    return this.plugin.currentIconId();
  }

  async onOpen(): Promise<void> {
    this.buildChrome();
    void this.refreshData();

    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh())
    );

    this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
      if (this.app.workspace.activeLeaf?.view !== this) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      // 卡片模式：左右方向键直接收藏 / 搁置，不需要先点中卡片
      if (this.plugin.settings.shelfLayout === "deck") {
        if (!this.deckKeyHandler) return;
        event.preventDefault();
        this.deckKeyHandler(event.key === "ArrowLeft" ? "left" : "right");
        return;
      }

      if (this.plugin.settings.shelfLayout !== "coverflow") return;
      const rail = this.currentRail;
      if (!rail || !rail.isConnected) return;
      event.preventDefault();
      const card = rail.querySelector(".abs-cf-card") as HTMLElement | null;
      const step = (card?.offsetWidth ?? 170) + 26;
      rail.scrollBy({
        left: (event.key === "ArrowRight" ? 1 : -1) * step,
        behavior: "smooth",
      });
    });
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.coverFileIndex = null;
        this.invalidateCoverBlob(file.path);
        this.scheduleRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.coverFileIndex = null;
        this.invalidateCoverBlob(oldPath);
        this.invalidateCoverBlob(file.path);
        this.scheduleRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("create", () => {
        this.coverFileIndex = null;
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (
          file instanceof TFile &&
          /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.extension)
        ) {
          this.invalidateCoverBlob(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleRefresh())
    );
    this.registerDomEvent(
      window,
      "pointerup",
      () => this.unlockDeckScroll(),
      { capture: true }
    );
    this.registerDomEvent(
      window,
      "pointercancel",
      () => this.unlockDeckScroll(),
      { capture: true }
    );
    this.registerDomEvent(
      window,
      "touchend",
      () => this.unlockDeckScroll(),
      { capture: true }
    );
    this.registerDomEvent(
      window,
      "touchcancel",
      () => this.unlockDeckScroll(),
      { capture: true }
    );
    this.app.workspace.onLayoutReady(() => {
      if (this.containerEl.isConnected) void this.refreshData();
    });
  }

  async onClose(): Promise<void> {
    this.unlockDeckScroll();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.coverObserver?.disconnect();
    this.coverObserver = null;
    this.coverflowObserver?.disconnect();
    this.coverflowObserver = null;
    this.timelineResizeObserver?.disconnect();
    this.timelineResizeObserver = null;
    this.coverLoadQueue = [];
    this.coverLoadActive = 0;
    this.coverBlobPending.clear();
    for (const url of this.coverBlobCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.coverBlobCache.clear();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshData();
    }, 400);
  }

  rebuild(force = false): void {
    if (force) this.lastRenderSignature = "";
    if (!this.gridEl?.isConnected || this.chromeSyncEnabled !== this.plugin.settings.syncEnabled) {
      this.buildChrome();
      this.lastRenderSignature = "";
    } else {
      this.applyScale();
    }
    void this.refreshData();
  }

  private buildChrome(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("abs-root");
    this.chromeSyncEnabled = this.plugin.settings.syncEnabled;
    this.lastStatsSignature = "";
    this.lastRenderSignature = "";
    this.coverObserver?.disconnect();
    this.coverObserver = null;
    this.coverLoadQueue = [];
    this.coverLoadActive = 0;
    this.applyScale();

    const toolbar = root.createDiv({ cls: "abs-toolbar" });
    // 兜底：部分设备只同步到新的 main.js、styles.css 还是旧的。
    // 关键布局直接用行内 !important 固定。
    const must = (el: HTMLElement, prop: string, value: string) =>
      el.style.setProperty(prop, value, "important");
    const controlH = Platform.isPhone ? "42px" : Platform.isTablet ? "38px" : "30px";
    must(toolbar, "flex-wrap", "wrap");
    toolbar.style.overflowX = "visible";
    toolbar.style.overflowY = "visible";
    toolbar.style.setProperty("--abs-control-h", controlH);
    // 鼠标点完按钮立刻失焦，避免系统焦点环（橙色）残留在图标按钮上
    toolbar.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (button) window.setTimeout(() => button.blur(), 0);
    });

    const searchWrap = toolbar.createDiv({ cls: "abs-search" });
    must(searchWrap, "order", "1");
    must(searchWrap, "flex", "0 1 140px");
    must(searchWrap, "min-width", "100px");
    must(searchWrap, "max-width", "160px");
    must(searchWrap, "width", "auto");
    must(searchWrap, "height", controlH);
    must(searchWrap, "min-height", controlH);
    must(searchWrap, "box-sizing", "border-box");
    setIcon(searchWrap.createSpan({ cls: "abs-search-icon" }), "search");
    const input = searchWrap.createEl("input", {
      cls: "abs-search-input",
      attr: {
        type: "text",
        placeholder: "搜索",
        "aria-label": "搜索书名或作者",
      },
    });
    input.value = this.query;
    must(input, "font-size", "12px");
    input.addEventListener("input", () => {
      this.query = input.value;
      this.updateResults();
    });

    const filters = toolbar.createDiv({ cls: "abs-filters" });
    must(filters, "order", "2");
    must(filters, "flex", "0 0 auto");
    must(filters, "flex-wrap", "wrap");
    const filterBtn = filters.createEl("button", {
      cls: "dropdown abs-filter",
      attr: { "aria-label": "筛选", type: "button" },
    });
    must(filterBtn, "height", controlH);
    must(filterBtn, "min-height", controlH);
    must(filterBtn, "box-sizing", "border-box");
    must(filterBtn, "flex", "0 0 74px");
    must(filterBtn, "width", "74px");
    must(filterBtn, "min-width", "0");
    must(filterBtn, "max-width", "100px");
    must(filterBtn, "padding", "0 6px");
    must(filterBtn, "font-size", "12px");
    const repaintFilter = () => {
      const parts: string[] = [];
      if (this.statusFilter !== "全部") parts.push(this.statusFilter);
      if (this.curationFilter === "liked") parts.push("收藏");
      else if (this.curationFilter === "shelved") parts.push("搁置");
      if (this.sourceFilter !== "all") {
        parts.push(this.sourceFilter === "apple" ? "苹果" : "微信");
      }
      filterBtn.setText("筛选");
      filterBtn.toggleClass("is-on", parts.length > 0);
      filterBtn.setAttribute(
        "title",
        parts.length ? `已筛选：${parts.join(" · ")}` : "筛选"
      );
    };
    repaintFilter();
    filterBtn.addEventListener("click", (event: MouseEvent) => {
      this.openFilterMenu(event, repaintFilter);
      // 菜单打开后立刻失焦，避免 macOS/主题给按钮画彩色焦点框
      filterBtn.blur();
    });

    const sortSelect = filters.createEl("select", {
      cls: "dropdown abs-sort",
      attr: { "aria-label": "排序方式" },
    });
    must(sortSelect, "height", controlH);
    must(sortSelect, "min-height", controlH);
    must(sortSelect, "box-sizing", "border-box");
    must(sortSelect, "flex", "0 0 92px");
    must(sortSelect, "width", "92px");
    must(sortSelect, "min-width", "0");
    must(sortSelect, "max-width", "120px");
    must(sortSelect, "padding", "0 16px 0 4px");
    must(sortSelect, "font-size", "12px");
    const sortOptions: Array<[SortKey, string]> = [
      ["recent", "最近阅读"],
      ["title", "书名"],
      ["rating", "评分"],
      ["progress", "阅读进度"],
      ["words", "字数"],
    ];
    for (const [value, label] of sortOptions) {
      const option = sortSelect.createEl("option", { text: label, value });
      if (value === this.sort) option.selected = true;
    }
    sortSelect.addEventListener("change", () => {
      this.sort = sortSelect.value as SortKey;
      this.updateResults();
    });

    this.sourceSelectEl = null;

    const actions = toolbar.createDiv({ cls: "abs-actions" });
    must(actions, "order", "3");
    must(actions, "flex", "0 0 auto");
    must(actions, "flex-wrap", "wrap");
    must(actions, "margin-left", "0");
    must(actions, "justify-content", "flex-start");

    const aiBtn = actions.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "AI 阅析", type: "button" },
    });
    setIcon(aiBtn, "sparkles");
    aiBtn.addEventListener("click", () => this.plugin.openAiAdvisor());

    if (!Platform.isPhone) {
      const layoutBtn = actions.createEl("button", {
        cls: "clickable-icon abs-icon-btn",
        attr: { "aria-label": "切换视图", type: "button" },
      });
      setIcon(layoutBtn, "eye");
      layoutBtn.addEventListener("click", (event: MouseEvent) => {
        const modes: Array<{
          id: ShelfLayout;
          label: string;
        }> = [
          { id: "grid", label: "封面墙" },
          { id: "deck", label: "卡片模式" },
          { id: "coverflow", label: "唱片模式" },
          { id: "timeline", label: "时间线" },
        ];

        const menu = new Menu();
        for (const mode of modes) {
          menu.addItem((item) =>
            item
              .setTitle(mode.label)
              .setChecked(this.plugin.settings.shelfLayout === mode.id)
              .onClick(async () => {
                this.plugin.settings.shelfLayout = mode.id;
                this.lastRenderSignature = "";
                this.rebuild();
                setIcon(layoutBtn, "eye");
                new Notice(`已切换到：${mode.label}`);
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  new Notice(
                    `视图已切换，但保存失败：${
                      error instanceof Error ? error.message : String(error)
                    }`
                  );
                }
              })
          );
        }
        menu.showAtMouseEvent(event);
      });
    }

    const timelineBtn = actions.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "阅读时间线", type: "button" },
    });
    setIcon(timelineBtn, "history");
    timelineBtn.addEventListener("click", () => this.plugin.openTimeline());

    const statsBtn = actions.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "阅读统计", type: "button" },
    });
    setIcon(statsBtn, "bar-chart-2");
    statsBtn.addEventListener("click", () => this.plugin.openReadingStats());

    const sizeWrap = actions.createDiv({ cls: "abs-size-wrap" });
    const sizeBtn = sizeWrap.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "视图大小", type: "button" },
    });
    setIcon(sizeBtn, "omnibooks-zoom");

    const pop = sizeWrap.createDiv({ cls: "abs-size-pop" });
    pop.addEventListener("pointerdown", (event) => event.stopPropagation());
    pop.addEventListener("click", (event) => event.stopPropagation());

    const minus = pop.createEl("button", {
      cls: "abs-size-step",
      text: "−",
      attr: { type: "button", "aria-label": "缩小" },
    });
    const select = pop.createEl("select", {
      cls: "abs-size-select",
      attr: { "aria-label": "视图大小" },
    });
    for (let percent = 60; percent <= 160; percent += 5) {
      select.createEl("option", {
        text: `${percent}%`,
        value: (percent / 100).toFixed(2),
      });
    }
    const plus = pop.createEl("button", {
      cls: "abs-size-step",
      text: "+",
      attr: { type: "button", "aria-label": "放大" },
    });

    let currentValue = this.currentScale();

    const clampScale = (input: number): number =>
      Math.min(1.6, Math.max(0.6, Math.round(input * 20) / 20));

    const setScale = (input: number, save = false) => {
      const value = clampScale(input);
      currentValue = value;
      select.value = value.toFixed(2);
      this.plugin.settings.viewScales = {
        ...this.plugin.settings.viewScales,
        [this.plugin.settings.shelfLayout]: value,
      };
      this.applyScale();
      if (this.plugin.settings.shelfLayout === "coverflow") {
        this.lastRenderSignature = "";
        this.updateResults();
      }
      if (save) {
        // 只保存数据，不触发视图重建
        void this.plugin.saveData(this.plugin.settings);
      }
    };

    const syncRange = () => {
      currentValue = this.currentScale();
      select.value = currentValue.toFixed(2);
    };
    syncRange();

    select.addEventListener("change", (event) => {
      event.stopPropagation();
      setScale(Number(select.value), true);
    });
    select.addEventListener("pointerdown", (event) =>
      event.stopPropagation()
    );

    minus.addEventListener("click", (event) => {
      event.stopPropagation();
      setScale(currentValue - 0.1, true);
    });
    plus.addEventListener("click", (event) => {
      event.stopPropagation();
      setScale(currentValue + 0.1, true);
    });

    sizeBtn.addEventListener("click", (event: MouseEvent) => {
      event.stopPropagation();
      sizeWrap.toggleClass("is-open", !sizeWrap.hasClass("is-open"));
      syncRange();
    });

    this.registerDomEvent(document, "click", (event) => {
      if (event.target instanceof Node && sizeWrap.contains(event.target)) {
        return;
      }
      sizeWrap.removeClass("is-open");
    });

    if (this.plugin.settings.syncEnabled) {
      const syncWrap = actions.createDiv({ cls: "abs-sync-wrap" });
      const syncBtn = syncWrap.createEl("button", {
        cls: "clickable-icon abs-icon-btn abs-sync-main",
        attr: {
          "aria-label": "选择同步范围",
          type: "button",
        },
      });
      const scopeLabel = (scope: "all" | "apple" | "weread"): string =>
        scope === "apple"
          ? "只同步苹果图书"
          : scope === "weread"
            ? "只同步微信读书"
            : "同步全部（苹果 + 微信）";
      const applySyncLabel = () => {
        const scope = this.plugin.settings.syncScope ?? "all";
        const label =
          scopeLabel(scope) +
          (Platform.isMobile && scope !== "weread"
            ? "（苹果图书由 Mac 执行）"
            : "");
        syncBtn.setAttribute("aria-label", label);
        syncBtn.setAttribute("title", label);
      };
      applySyncLabel();
      syncBtn.empty();
      appendMarkup(
        syncBtn,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.4 15.5h9.2a3.4 3.4 0 0 0 .3-6.8 5.3 5.3 0 0 0-10.3-1.1 4 4 0 0 0 .8 7.9z"/><path d="M12 8.6v3.6"/><path d="M10.2 10.4l1.8 1.8 1.8-1.8"/></svg><span class="abs-sync-chevron" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>`
      );
      syncBtn.addEventListener("click", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".abs-sync-chevron")) {
          void this.runSync(this.plugin.settings.syncScope ?? "all");
          return;
        }
        event.stopPropagation();
        const menu = new Menu();
        const addSyncItem = (
          scope: "all" | "apple" | "weread",
          label: string
        ) => {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(this.plugin.settings.syncScope === scope)
              .onClick(async () => {
                this.plugin.settings.syncScope = scope;
                applySyncLabel();
                await this.plugin.saveData(this.plugin.settings);
                void this.runSync(scope);
              })
          );
        };
        addSyncItem("all", "全部同步（苹果 + 微信）");
        addSyncItem("apple", "只同步苹果图书");
        addSyncItem("weread", "只同步微信读书");
        menu.showAtMouseEvent(event);
      });
    }

    const refreshBtn = actions.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "重新扫描", type: "button" },
    });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => {
      void this.refreshData();
      new Notice("OmniBooks：已重新扫描");
    });

    const settingsBtn = actions.createEl("button", {
      cls: "clickable-icon abs-icon-btn",
      attr: { "aria-label": "书架设置", type: "button" },
    });
    setIcon(settingsBtn, "settings");
    settingsBtn.addEventListener("click", () => {
      const setting = (this.app as unknown as {
        setting?: { open(): void; openTabById(id: string): void };
      }).setting;
      if (setting) {
        setting.open();
        setting.openTabById(this.plugin.manifest.id);
      }
    });

    this.statsEl = root.createDiv({ cls: "abs-stats" });
    this.gridEl = root.createDiv({ cls: "abs-grid" });
    this.emptyEl = root.createDiv({ cls: "abs-empty" });
  }

  private async refreshData(): Promise<void> {
    this.rankCache = null;
    if (this.refreshPromise) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      await this.loadSwipeChoices();
      this.books = await this.collectBooks();
      this.renderStats();
      this.updateResults();
    })().finally(() => {
      this.refreshPromise = null;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refreshData();
      }
    });
    return this.refreshPromise;
  }

  private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached && Object.keys(cached).length > 0) {
      return cached as Record<string, unknown>;
    }

    // 缓存里没有（常见于手机端刚同步、文件还没被索引）时，直接读文件
    try {
      const text = await this.app.vault.read(file);
      return parseFrontmatter(text);
    } catch {
      return null;
    }
  }

  private async collectBooks(): Promise<Book[]> {
    const settings = this.plugin.settings;
    const rawFolder = settings.folder.trim();
    const folder = rawFolder ? normalizePath(rawFolder) : "";
    const inFolder = (file: TFile): boolean => {
      if (!folder) return true;
      return file.path === folder || file.path.startsWith(`${folder}/`);
    };

    const fieldKeys = [
      settings.coverField,
      "cover",
      settings.progressField,
      "progress",
      settings.ratingField,
      "rating",
      settings.highlightsField,
      "highlights",
      "noteCount",
      "annotation_count",
    ].filter(Boolean);

    const books: Book[] = [];
    let scanned = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!inFolder(file)) continue;
      scanned += 1;

      const frontmatter = await this.readFrontmatter(file);
      if (!frontmatter) continue;

      const pick = (primary: string, fallbacks: string[]): unknown => {
        for (const key of [primary, ...fallbacks]) {
          if (!key) continue;
          const value = frontmatter[key];
          if (value !== undefined && value !== null && value !== "") return value;
        }
        return undefined;
      };

      const isBook = fieldKeys.some((key) => {
        const value = frontmatter[key];
        return value !== undefined && value !== null && value !== "";
      });

      let status = normalizeStatus(pick(settings.statusField, ["status", "readingStatus"]));
      if (!isBook && !status) continue;

      const title = asString(frontmatter.title).trim() || file.basename;
      const author = asString(pick(settings.authorField, ["author"])).trim();
      const cover = stripLink(asString(pick(settings.coverField, ["cover"])));
      const progress = toPercent(pick(settings.progressField, ["progress"]));
      const rating = Math.max(
        0,
        Math.min(5, toNumber(pick(settings.ratingField, ["rating"])))
      );
      const highlights = Math.max(
        0,
        Math.round(
          toNumber(
            pick(settings.highlightsField, ["highlights", "noteCount", "annotation_count"])
          )
        )
      );
      const words = Math.max(0, Math.round(toNumber(pick("words", ["wordCount", "totalWords"]))));
      const lastRead = toTimestamp(
        pick(settings.lastReadField, [
          "lastRead",
          "lastReadDate",
          "last_modified_at",
          "readingDate",
        ]),
        file.stat.mtime
      );

      if (!status) {
        if (progress >= 100) status = "已读";
        else if (progress > 0) status = "在读";
        else if (highlights > 0) status = "在读";
        else status = "想读";
      }

      books.push({
        file,
        files: [file],
        title,
        author,
        cover,
        status,
        progress,
        rating,
        highlights,
        words,
        lastRead,
      });
    }

    const merged = new Map<string, Book>();
    for (const book of books) {
      const key = book.title.replace(/\s+/g, "").toLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, book);
        continue;
      }
      existing.files.push(...book.files);
      existing.highlights = Math.max(existing.highlights, book.highlights);
      existing.words = Math.max(existing.words, book.words);
      existing.lastRead = Math.max(existing.lastRead, book.lastRead);
      if (!existing.cover) existing.cover = book.cover;
      if (!existing.author) existing.author = book.author;
    }

    const result = [...merged.values()];
    for (const book of result) {
      const choice = this.swipeChoices?.[book.file.path];
      if (choice?.status) book.status = choice.status;
    }
    this.scanStats = { files: scanned, matched: result.length };
    return result;
  }

  private renderStats(): void {
    const total = this.books.length;
    const notes = this.books.reduce((sum, book) => sum + book.highlights, 0);
    const reading = this.books.filter((book) => book.status === "在读").length;
    const filterMode = this.plugin.settings.shelfFilter || "all";
    const curatedCount = this.curatedBooks(this.books).length;
    const signature = [
      total,
      notes,
      reading,
      filterMode,
      curatedCount,
      this.plugin.settings.favoriteSource,
      this.plugin.settings.favoriteStatuses,
    ].join("|");
    if (signature === this.lastStatsSignature) return;
    this.lastStatsSignature = signature;

    this.statsEl.empty();
    this.statsEl.parentElement
      ?.querySelectorAll(".abs-stats-expand")
      .forEach((el) => el.remove());

    const addStat = (icon: string, text: string) => {
      const item = this.statsEl.createDiv({ cls: "abs-stat" });
      setIcon(item.createSpan({ cls: "abs-stat-icon" }), icon);
      item.createSpan({ text });
    };

    addStat(
      "book",
      filterMode === "all"
        ? `${total} 本书`
        : filterMode === "strict"
          ? `${curatedCount} 本收藏`
          : `${curatedCount} 本精选`
    );
    addStat("pencil-line", `${notes} 个笔记`);
    addStat("bookmark", `${reading} 本在读`);

    const panel = document.createElement("div");
    panel.addClass("abs-stats-expand");
    this.statsEl.parentElement?.insertBefore(panel, this.gridEl);

    const togglePanel = async () => {
      if (panel.hasClass("is-open")) {
        panel.removeClass("is-open");
        panel.empty();
        return;
      }
      panel.addClass("is-open");
      panel.empty();
      panel.createDiv({ cls: "abs-stats-expand-loading", text: "整理最近阅读…" });

      const events = await computeTimeline(this.app, [
        this.plugin.settings.booksOutputDir || "OmniBooks/苹果图书",
        this.plugin.settings.wereadOutputDir || "OmniBooks/微信读书",
      ]);

      panel.empty();
      if (events.length === 0) {
        panel.createDiv({ cls: "abs-stats-expand-loading", text: "暂无阅读记录" });
        return;
      }

      for (const event of events.slice(0, 15)) {
        const date = new Date(event.time);
        const row = panel.createDiv({ cls: "abs-stats-event" });
        row.createDiv({
          cls: "abs-stats-event-date",
          text: `${date.getMonth() + 1}/${date.getDate()}`,
        });
        row.createDiv({ cls: "abs-stats-event-title", text: event.title });
        row.createDiv({ cls: "abs-stats-event-detail", text: event.detail });
      }
    };

    const statItems = this.statsEl.querySelectorAll(".abs-stat");
    statItems.forEach((item, index) => {
      if (index === 0) {
        item.addClass("is-clickable");
        item.addEventListener("click", () => this.plugin.openTimeline());
        return;
      }
      if (index !== 1 && index !== 2) return;
      item.addClass("is-clickable");
      item.addEventListener("click", () => void togglePanel());
    });
  }

  private bookKey(book: Book): string {
    return `${book.title.trim().toLowerCase()}::${book.author.trim().toLowerCase()}`;
  }

  /** 按设置里的「收藏定义」判断一本书算不算收藏 */
  private isFavorite(book: Book): { favorite: boolean; ts: number } {
    const source = this.plugin.settings.favoriteSource || "merged";
    const statusWords = (this.plugin.settings.favoriteStatuses || "想看")
      .split(/[,，\s]+/)
      .map((word) => word.trim())
      .filter(Boolean);

    let swipeLiked = false;
    let swipeTs = 0;
    if (source !== "status" && this.swipeChoices) {
      for (const file of book.files) {
        const entry = this.swipeChoices[file.path];
        if (entry?.choice === "liked") {
          swipeLiked = true;
          swipeTs = Math.max(swipeTs, entry.ts || 0);
        }
      }
    }

    let statusMatch = false;
    if (source !== "swipe") {
      statusMatch = statusWords.includes(book.status);
    }

    return {
      favorite: swipeLiked || statusMatch,
      ts: swipeTs || book.lastRead,
    };
  }

  /** 只看收藏：不足 N 本时用最近阅读补足，并记录哪些是补足的 */
  private curatedBooks(list: Book[]): Book[] {
    const mode = this.plugin.settings.shelfFilter || "all";
    if (mode === "all") {
      this.curatedPadding.clear();
      return list;
    }

    const favorites: Book[] = [];
    const rest: Book[] = [];
    const stamps = new Map<string, number>();

    for (const book of list) {
      const { favorite, ts } = this.isFavorite(book);
      if (favorite) {
        favorites.push(book);
        stamps.set(this.bookKey(book), ts);
      } else {
        rest.push(book);
      }
    }

    favorites.sort(
      (a, b) => (stamps.get(this.bookKey(b)) ?? 0) - (stamps.get(this.bookKey(a)) ?? 0)
    );

    this.curatedPadding.clear();
    if (mode === "strict") return favorites;

    const target = Math.max(0, this.plugin.settings.favoriteFillTo ?? 20);
    const result = [...favorites];
    // 只有「收藏不够」时才补足；收藏本身超过目标时全部保留，交给分页
    if (target > 0 && result.length < target) {
      const byRecent = rest
        .slice()
        .sort((a, b) => b.lastRead - a.lastRead)
        .slice(0, target - result.length);
      for (const book of byRecent) {
        this.curatedPadding.add(this.bookKey(book));
      }
      result.push(...byRecent);
    }
    try {
      void this.plugin.app.vault.adapter
        .append(
          this.plugin.bridgePath("perf.log"),
          `${new Date().toISOString()} curated mode=${mode} source=${this.plugin.settings.favoriteSource} favorites=${favorites.length} pad=${this.curatedPadding.size} total=${result.length}\n`
        )
        .catch(() => undefined);
    } catch {
      /* 忽略 */
    }
    return result;
  }

  private filteredBooks(): Book[] {
    const query = this.query.trim().toLowerCase();

    const appleDir = normalizePath(this.plugin.settings.booksOutputDir || "OmniBooks/苹果图书");
    const wereadDir = normalizePath(this.plugin.settings.wereadOutputDir || "OmniBooks/微信读书");

    const list = this.books.filter((book) => {
      if (this.statusFilter !== "全部" && book.status !== this.statusFilter) return false;
      if (this.curationFilter === "liked" && !this.isFavorite(book).favorite) return false;
      if (this.curationFilter === "shelved") {
        const shelved = book.files.some(
          (file) => this.swipeChoices?.[file.path]?.choice === "shelved"
        );
        if (!shelved) return false;
      }
      if (this.sourceFilter === "apple" && !book.file.path.startsWith(`${appleDir}/`)) return false;
      if (this.sourceFilter === "weread" && !book.file.path.startsWith(`${wereadDir}/`)) return false;
      if (!query) return true;
      return (
        book.title.toLowerCase().includes(query) ||
        book.author.toLowerCase().includes(query)
      );
    });

    const sorters: Record<SortKey, (a: Book, b: Book) => number> = {
      recent: (a, b) => b.lastRead - a.lastRead,
      title: (a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"),
      rating: (a, b) => b.rating - a.rating || b.lastRead - a.lastRead,
      progress: (a, b) => b.progress - a.progress || b.lastRead - a.lastRead,
      words: (a, b) => b.words - a.words || b.lastRead - a.lastRead,
    };

    const sorted = list.sort(sorters[this.sort]);
    return this.curatedBooks(sorted);
  }

  /** 一批渲染多少本：自动档按设备与实测首帧动态调整 */
  private coverflowBatch(): number {
    const fixed = this.plugin.settings.coverflowBatch || 0;
    if (fixed > 0) return fixed;
    if (!this.coverflowAutoBatch) {
      this.coverflowAutoBatch = Platform.isPhone ? 12 : 20;
    }
    return this.coverflowAutoBatch;
  }

  /** 根据实测首帧调整自动档（8~30） */
  private tuneCoverflowBatch(paintMs: number): void {
    if ((this.plugin.settings.coverflowBatch || 0) > 0) return;
    const current = this.coverflowAutoBatch || (Platform.isPhone ? 12 : 20);
    let next = current;
    if (paintMs > 120) next = current - 4;
    else if (paintMs > 80) next = current - 2;
    else if (paintMs < 35) next = current + 2;
    next = Math.max(8, Math.min(30, next));
    this.coverflowAutoBatch = next;
  }

  /** 桌面端：滚轮一格翻一张（只绑一次，避免重复监听） */
  /** 唱片模式里的完整菜单：排序、筛选、来源 */
  /** 统一筛选：进度 / 收藏 / 来源 分组 */
  private openFilterMenu(event: MouseEvent, repaint: () => void): void {
    const menu = new Menu();
    const group = (label: string) => {
      menu.addItem((item) => item.setTitle(label).setDisabled(true));
    };

    menu.addSeparator();
    group("来源");
    for (const [value, label] of [
      ["all", "全部"],
      ["apple", "苹果图书"],
      ["weread", "微信读书"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.sourceFilter === value)
          .onClick(() => {
            this.sourceFilter = value;
            repaint();
            this.updateResults();
          })
      );
    }

    group("进度");
    for (const [value, label] of [
      ["全部", "全部"],
      ["在读", "在读"],
      ["已读", "已读"],
      ["想读", "想读"],
      ["想看", "想看"],
      ["待看", "待看"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.statusFilter === value)
          .onClick(() => {
            this.statusFilter = value as StatusKey;
            repaint();
            this.updateResults();
          })
      );
    }

    menu.addSeparator();
    group("收藏");
    for (const [value, label] of [
      ["all", "全部"],
      ["liked", "收藏"],
      ["shelved", "搁置"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.curationFilter === value)
          .onClick(async () => {
            this.curationFilter = value;
            if (value !== "all" && !this.swipeChoices) {
              await this.loadSwipeChoices();
            }
            repaint();
            this.updateResults();
          })
      );
    }

    menu.showAtMouseEvent(event);
  }

  private openShelfMenu(event: MouseEvent): void {
    const menu = new Menu();

    for (const [value, label] of [
      ["recent", "最近阅读"],
      ["title", "书名"],
      ["rating", "评分"],
      ["progress", "进度"],
      ["words", "字数"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.sort === value)
          .onClick(() => {
            this.sort = value as SortKey;
            this.updateResults();
          })
      );
    }

    menu.addSeparator();
    menu.addItem((item) => item.setTitle("加载方式").setDisabled(true));
    for (const [value, label] of [
      ["auto", "自动加载（滑到末尾自动追加）"],
      ["manual", "手动加载（点「加载更多」才追加）"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(
            (this.plugin.settings.coverflowAutoLoad !== false) === (value === "auto")
          )
          .onClick(async () => {
            this.plugin.settings.coverflowAutoLoad = value === "auto";
            await this.plugin.saveSettings();
          })
      );
    }

    menu.addSeparator();
    for (const [value, label] of [
      ["all", "全部书籍"],
      ["curated", "只看收藏（不足自动补足）"],
      ["strict", "只看收藏（严格，不补足）"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked((this.plugin.settings.shelfFilter || "all") === value)
          .onClick(async () => {
            this.plugin.settings.shelfFilter = value;
            await this.plugin.saveSettings();
            if ((value === "curated" || value === "strict") && !this.swipeChoices) {
              await this.loadSwipeChoices();
            }
            this.updateResults();
          })
      );
    }

    menu.addSeparator();
    for (const [value, label] of [
      ["all", "全部来源"],
      ["apple", "苹果图书"],
      ["weread", "微信读书"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(this.sourceFilter === value)
          .onClick(() => {
            this.sourceFilter = value;
            if (this.sourceSelectEl) this.sourceSelectEl.value = value;
            this.updateResults();
          })
      );
    }

    menu.showAtMouseEvent(event);
  }

  private bindWheel(): void {
    if (this.wheelBound) return;
    this.wheelBound = true;
    this.gridEl.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        const rail = this.currentRail;
        if (!rail || !rail.isConnected) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        if (this.plugin.settings.shelfLayout !== "coverflow") return;
        event.preventDefault();

        const now = Date.now();
        if (now < this.wheelLock) return;
        this.wheelLock = now + 160;

        const card = rail.querySelector(".abs-cf-card") as HTMLElement | null;
        const step = (card?.offsetWidth ?? 170) + 26;
        rail.scrollBy({ left: (event.deltaY > 0 ? 1 : -1) * step, behavior: "smooth" });
      },
      { passive: false }
    );
  }

  private logPerf(layout: string, books: number, ms: number): void {
    try {
      void this.plugin.app.vault.adapter
        .append(
          this.plugin.bridgePath("perf.log"),
          `${new Date().toISOString()} ${layout} books=${books} ${ms.toFixed(1)}ms\n`
        )
        .catch(() => undefined);
    } catch {
      /* 忽略 */
    }
  }


  private updateResults(): void {
    const perfStart = performance.now();
    // 唱片模式重渲染前记住滚动位置，避免刷新后跳回第一本
    if (
      this.plugin.settings.shelfLayout === "coverflow" &&
      this.currentRail?.isConnected
    ) {
      this.coverflowScroll = this.currentRail.scrollLeft;
    }
    this.deckKeyHandler = null;
    const books = this.filteredBooks();
    let layout = this.plugin.settings.shelfLayout;
    if (Platform.isPhone && !PHONE_LAYOUTS.includes(layout)) {
      layout = "grid";
      this.plugin.settings.shelfLayout = "grid";
      void this.plugin.saveData(this.plugin.settings);
    }
    const signature = this.renderSignature(books);
    if (signature === this.lastRenderSignature) {
      // 防御：DOM 被重建但签名没变时（例如视图重新挂载），不能停在空书架
      const gridEmpty = (this.gridEl?.childElementCount ?? 0) === 0;
      if (!(books.length > 0 && gridEmpty)) return;
    }
    this.lastRenderSignature = signature;
    this.coverObserver?.disconnect();
    this.coverObserver = null;
    this.coverLoadQueue = [];
    this.coverLoadActive = 0;
    this.gridEl.toggleClass("abs-deck", layout === "deck");
    this.gridEl.toggleClass("abs-stack", layout === "stack");
    this.gridEl.toggleClass("abs-coverflow", layout === "coverflow");
    this.gridEl.toggleClass("abs-timeline-mode", layout === "timeline");
    this.contentEl.toggleClass("is-deck-mode", layout === "deck");

    const perfEnd = () => {
      this.logPerf(layout, books.length, performance.now() - perfStart);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const paintMs = performance.now() - perfStart;
          this.logPerf(`${layout}:paint`, books.length, paintMs);
          if (layout === "coverflow") this.tuneCoverflowBatch(paintMs);
        });
      });
    };

    if (layout === "stack" && books.length > 0) {
      this.gridEl.empty();
      try {
        this.renderStack(books);
      } catch (error) {
        this.fallbackToGrid("叠放模式", error);
      }
      perfEnd();
      return;
    }

    if (layout === "deck" && books.length > 0) {
      this.gridEl.empty();
      void this.renderSwipe(books).catch((error) => {
        this.fallbackToGrid("卡片模式", error);
      });
      perfEnd();
      return;
    }

    if (layout === "coverflow" && books.length > 0) {
      this.gridEl.empty();
      try {
        this.renderCoverflow(books);
      } catch (error) {
        this.fallbackToGrid("唱片模式", error);
      }
      perfEnd();
      return;
    }

    if (layout === "timeline") {
      this.gridEl.empty();
      void this.renderTimelineMode();
      perfEnd();
      return;
    }

    if (books.length === 0) {
      this.gridEl.empty();
      this.emptyEl.setCssStyles({ display: "flex" });
      this.emptyEl.empty();
      const hasAnyBooks = this.books.length > 0;
      this.emptyEl.createDiv({
        cls: "abs-empty-title",
        text: hasAnyBooks ? "没有符合筛选的书" : "书架上还没有书",
      });
      this.emptyEl.createDiv({
        cls: "abs-empty-text",
        text: hasAnyBooks
          ? "换一个筛选条件或搜索词试试。"
          : this.query || this.statusFilter !== "全部"
            ? "换个关键词或状态试试。"
            : "在笔记的 frontmatter 里写上 cover / status / progress / rating / highlights 任意一项，就会出现在这里。",
      });
      if (hasAnyBooks) {
        const active: string[] = [];
        if (this.query) active.push(`搜索「${this.query}」`);
        if (this.statusFilter !== "全部") active.push(`状态：${this.statusFilter}`);
        if (this.curationFilter === "liked") active.push("只看收藏");
        if (this.curationFilter === "shelved") active.push("只看搁置");
        if (this.sourceFilter !== "all") {
          active.push(`来源：${this.sourceFilter === "apple" ? "苹果图书" : "微信读书"}`);
        }
        if (active.length > 0) {
          this.emptyEl.createDiv({
            cls: "abs-empty-text abs-empty-debug",
            text: `当前筛选：${active.join(" · ")}`,
          });
        }
        const reset = this.emptyEl.createEl("button", {
          cls: "mod-cta abs-import-btn",
          text: "清除筛选",
        });
        reset.addEventListener("click", () => {
          this.query = "";
          this.statusFilter = "全部";
          this.curationFilter = "all";
          this.sourceFilter = "all";
          this.lastRenderSignature = "";
          this.buildChrome();
          void this.refreshData();
        });
      }
      if (!hasAnyBooks && !this.query && this.statusFilter === "全部") {
        this.emptyEl.createDiv({
          cls: "abs-empty-text abs-empty-debug",
          text: `已扫描 ${this.scanStats.files} 个笔记，识别 ${this.scanStats.matched} 本。`,
        });

        const status = appleBooksStatus();
        this.emptyEl.createDiv({
          cls: "abs-empty-text abs-empty-debug",
          text: `苹果图书：${status.label}。${status.detail}`,
        });
        if (status.action === "permission") {
          const permBtn = this.emptyEl.createEl("button", {
            cls: "abs-import-btn",
            text: "打开权限设置",
          });
          permBtn.addEventListener("click", () => {
            openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
          });
        }

        const importBtn = this.emptyEl.createEl("button", {
          cls: "mod-cta abs-import-btn",
          text: "一键导入苹果图书",
        });
        importBtn.addEventListener("click", () => {
          void this.plugin.importAppleBooks();
        });

        if (
          this.plugin.settings.wereadEnabled &&
          this.plugin.settings.wereadApiKey
        ) {
          const wereadBtn = this.emptyEl.createEl("button", {
            cls: "mod-cta abs-import-btn",
            text: "一键同步微信读书",
          });
          wereadBtn.addEventListener("click", () => {
            void this.runSync("weread");
          });
        }

        const setupBtn = this.emptyEl.createEl("button", {
          cls: "abs-import-btn",
          text: "设置书源",
        });
        setupBtn.addEventListener("click", () => {
          this.plugin.openSetupWizard();
        });
      }
      return;
    }

    this.emptyEl.setCssStyles({ display: "none" });

    // 先离屏构建，再一次性替换：避免刷新时先清空、再逐张插入造成闪屏。
    this.coverPrefetchBudget = Platform.isPhone ? 6 : 12;
    const fragment = document.createDocumentFragment();
    for (const book of books) {
      fragment.appendChild(this.renderCard(book));
    }
    this.gridEl.replaceChildren(fragment);
    perfEnd();
  }

  private fallbackToGrid(label: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "" : "";
    console.error(`OmniBooks ${label}`, error);
    void this.plugin.app.vault.adapter
      .append(
        this.plugin.bridgePath("layout-error.log"),
        `${new Date().toISOString()} ${label}: ${message}\n${stack}\n`
      )
      .catch(() => undefined);
    new Notice(`${label}加载失败，已切回封面墙：${message}`);
    this.plugin.settings.shelfLayout = "grid";
    this.lastRenderSignature = "";
    void this.plugin.saveSettings();
  }

  private renderSignature(books: Book[]): string {
    const settings = this.plugin.settings;
    const scale =
      settings.viewScales?.[settings.shelfLayout] ??
      (settings.shelfLayout === "coverflow" ? 1 : 1);
    const padding = [...this.curatedPadding].sort().join(",");
    const rows = books.map((book) =>
      [
        book.file.path,
        book.title,
        book.author,
        book.cover,
        book.status,
        book.progress,
        book.rating,
        book.highlights,
        book.words,
        book.lastRead,
      ].join("\u0001")
    );
    return [
      settings.shelfLayout,
      settings.showTitles ? 1 : 0,
      settings.coverMode,
      settings.straightenCovers ? 1 : 0,
      settings.shelfFilter,
      settings.favoriteSource,
      settings.favoriteStatuses,
      this.query,
      this.statusFilter,
      this.curationFilter,
      this.sourceFilter,
      this.sort,
      scale,
      this.coverflowLimit,
      this.deckBatchDone,
      settings.deckRoundStart,
      Object.entries(this.swipeChoices ?? {})
        .map(([path, entry]) => `${path}:${entry.choice}:${entry.ts}`)
        .sort()
        .join(","),
      padding,
      ...rows,
    ].join("\u0002");
  }

  private coverThumbs = new Map<string, string>();
  private coverThumbQueue: string[] = [];
  private coverThumbPending = new Set<string>();
  private coverThumbActive = 0;
  private coverLoadQueue: Array<{
    img: HTMLImageElement;
    url: string;
    attempts: number;
  }> = [];
  private coverLoadActive = 0;
  private coverObserver: IntersectionObserver | null = null;
  private coverFileIndex: Map<string, TFile> | null = null;
  private coverUrlToFile = new Map<string, TFile>();
  private coverBlobCache = new Map<string, string>();
  private coverBlobPending = new Map<string, Promise<string | null>>();
  private coverPrefetchBudget = 0;

  private straightCache = new Map<string, string>();
  private straightFailed = new Set<string>();
  private straightWaiters = new Map<string, Set<HTMLImageElement>>();
  private straightQueue: Array<{ key: string; file: TFile | null }> = [];
  private straightActive = 0;

  private coverAdjustKey(raw: string): string {
    return stripLink(raw);
  }

  /** 唱片模式缩略图：canvas 缩到 360px，降低解码与纹理开销 */
  private coverThumb(url: string): string | null {
    const hit = this.coverThumbs.get(url);
    if (hit) return hit;
    if (!this.coverThumbPending.has(url) && !this.coverThumbQueue.includes(url)) {
      this.coverThumbQueue.push(url);
      this.pumpCoverThumbs();
    }
    return null;
  }

  private pumpCoverThumbs(): void {
    while (this.coverThumbActive < 4 && this.coverThumbQueue.length > 0) {
      const url = this.coverThumbQueue.shift();
      if (!url || this.coverThumbs.has(url) || this.coverThumbPending.has(url)) continue;
      this.coverThumbPending.add(url);
      this.coverThumbActive += 1;
      const img = new Image();
      img.decoding = "async";
      const done = () => {
        this.coverThumbPending.delete(url);
        this.coverThumbActive -= 1;
        this.pumpCoverThumbs();
      };
      img.onload = () => {
        try {
          const maxW = 360;
          const ratio = Math.min(1, maxW / Math.max(1, img.naturalWidth));
          const w = Math.max(1, Math.round(img.naturalWidth * ratio));
          const h = Math.max(1, Math.round(img.naturalHeight * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const data = canvas.toDataURL("image/jpeg", 0.8);
            if (this.coverThumbs.size > 300) this.coverThumbs.clear();
            this.coverThumbs.set(url, data);
            document.querySelectorAll<HTMLImageElement>(".abs-cf-img").forEach((el) => {
              if (el.dataset.thumb === url) el.src = data;
            });
          }
        } catch {
          /* 画布被跨域污染时跳过 */
        }
        done();
      };
      img.onerror = done;
      img.src = url;
    }
  }

  private applyCoverAdjust(img: HTMLElement, raw: string): void {
    const key = this.coverAdjustKey(raw);
    const adj = this.plugin.settings.coverAdjust?.[key];
    if (!adj) return;
    img.addClass("is-cover-adjusted");
    img.setCssStyles({ transform: `translate(${adj.x}%, ${adj.y}%) scale(${adj.scale}) rotate(${adj.rotate}deg)` });
  }

  openCoverAdjust(book: Book): void {
    const coverUrl = this.resolveCover(book.cover, book.file);
    if (!coverUrl) return;
    const key = this.coverAdjustKey(book.cover);

    new CoverAdjustModal(this.app, {
      title: book.title,
      coverUrl,
      value: this.plugin.settings.coverAdjust?.[key] ?? null,
      onSave: async (value) => {
        if (!this.plugin.settings.coverAdjust) this.plugin.settings.coverAdjust = {};
        if (value) this.plugin.settings.coverAdjust[key] = value;
        else delete this.plugin.settings.coverAdjust[key];
        await this.plugin.saveSettings();
        this.lastRenderSignature = "";
        this.updateResults();
      },
    }).open();
  }

  private handleCover(
    img: HTMLImageElement,
    src: string,
    rawCover: string,
    source: TFile | null
  ): void {
    img.addEventListener("load", () => {
      const mode = this.plugin.settings.coverMode ?? "auto";
      this.applyCoverAdjust(img, rawCover);

      if (img.dataset.straightened === "1") {
        img.removeClass("is-cover-fill");
        img.removeClass("is-cover-stretch");
        img.toggleClass("is-cover-contain", mode === "straighten-contain");
        return;
      }

      const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);

      if (mode === "contain") {
        img.removeClass("is-cover-fill");
        img.removeClass("is-cover-stretch");
        img.addClass("is-cover-contain");
        return;
      }

      if (mode === "stretch") {
        img.removeClass("is-cover-contain");
        img.removeClass("is-cover-fill");
        img.addClass("is-cover-stretch");
        return;
      }

      if (mode === "fill") {
        img.removeClass("is-cover-contain");
        img.removeClass("is-cover-stretch");
        img.addClass("is-cover-fill");
        return;
      }

      // auto / straighten-contain：标准比例直接铺满
      if (isStandardCover(img.naturalWidth, img.naturalHeight)) {
        img.removeClass("is-cover-fill");
        img.removeClass("is-cover-contain");
        img.removeClass("is-cover-stretch");
        return;
      }

      // 非标准比例：尺寸差得太多的（画册跨页、超宽封面）先完整显示，避免裁掉标题；
      // 接近封面比例的（立体书影）先铺满，等拉正结果回来再替换。
      const tooFar = ratio > 0.95 || ratio < 0.6;
      if (tooFar) {
        img.addClass("is-cover-contain");
      } else {
        img.addClass("is-cover-fill");
      }
      if (!/^https?:\/\//i.test(src)) {
        this.queueStraighten(img, src, this.resolveCoverFile(rawCover, source));
      }
    });
  }

  private resolveCoverFile(raw: string, source: TFile | null): TFile | null {
    const value = raw.trim();
    if (!value || /^https?:\/\//i.test(value) || value.startsWith("data:")) return null;
    const cleaned = stripLink(value);
    if (!cleaned) return null;
    const target =
      this.app.metadataCache.getFirstLinkpathDest(cleaned, source?.path ?? "") ??
      this.app.vault.getAbstractFileByPath(normalizePath(cleaned));
    return target instanceof TFile ? target : null;
  }

  /** 把歪掉的封面加入透视校正队列（同一张图只处理一次，结果缓存） */
  private queueStraighten(img: HTMLImageElement, src: string, file: TFile | null): void {
    const mode = this.plugin.settings.coverMode ?? "auto";
    if (mode !== "auto" && mode !== "straighten-contain") return;
    if (img.dataset.straightened === "1") return;

    const key = file?.path ?? src;
    const cached = this.straightCache.get(key);
    if (cached) {
      this.applyStraightenedCover(img, cached);
      return;
    }
    if (this.straightFailed.has(key)) return;

    let waiters = this.straightWaiters.get(key);
    if (!waiters) {
      waiters = new Set();
      this.straightWaiters.set(key, waiters);
      this.straightQueue.push({ key, file });
    }
    waiters.add(img);
    this.pumpStraightQueue();
  }

  /** 用 vault 里的原始字节解码，避开 app:// 图片污染 canvas 的问题 */
  private async loadCoverImage(file: TFile): Promise<HTMLImageElement | null> {
    const buffer = await this.app.vault.readBinary(file);
    const type = file.extension.toLowerCase();
    const mime =
      type === "png" ? "image/png" : type === "webp" ? "image/webp" : "image/jpeg";
    const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    try {
      return await new Promise<HTMLImageElement | null>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  private pumpStraightQueue(): void {
    while (this.straightActive < 2 && this.straightQueue.length > 0) {
      const job = this.straightQueue.shift();
      if (!job) break;
      const group = this.straightWaiters.get(job.key);
      if (!group || group.size === 0) {
        this.straightWaiters.delete(job.key);
        continue;
      }

      this.straightActive += 1;
      void (async () => {
        let result: StraightenResult | null = null;
        let analysisReason = "no-file";
        try {
          const sample = job.file
            ? await this.loadCoverImage(job.file)
            : [...group].find((el) => el.isConnected) ?? [...group][0];
          if (sample) {
            const analysis = analyzeCover(sample);
            analysisReason = analysis
              ? `${analysis.reason} fill=${analysis.fill.toFixed(2)}`
              : "unreadable";
            if (analysis) result = straightenCover(sample);
          }
        } catch (error) {
          analysisReason = `error ${(error as Error).message}`.slice(0, 120);
        }

        this.straightActive -= 1;
        const waiters = this.straightWaiters.get(job.key) ?? group;
        this.straightWaiters.delete(job.key);

        if (result) {
          this.straightCache.set(job.key, result.dataUrl);
          if (this.straightCache.size > 80) {
            const firstKey = this.straightCache.keys().next().value;
            if (firstKey) this.straightCache.delete(firstKey);
          }
          for (const el of waiters) {
            if (el.isConnected) this.applyStraightenedCover(el, result.dataUrl);
          }
        } else {
          this.straightFailed.add(job.key);
        }

        this.logStraighten(job.key, result, analysisReason);
        this.pumpStraightQueue();
      })();
    }
  }

  private logStraighten(
    key: string,
    result: StraightenResult | null,
    reason: string
  ): void {
    try {
      const name = key.split("/").pop() ?? key;
      const line = result
        ? `${name}\tok ${result.width}x${result.height}${result.hinged ? " hinged" : ""}`
        : `${name}\tskip ${reason}`;
      void this.app.vault.adapter
        .append(this.plugin.bridgePath("straighten.log"), `${new Date().toISOString()} ${line}\n`)
        .catch(() => undefined);
    } catch {
      /* 日志失败不影响功能 */
    }
  }

  private applyStraightenedCover(img: HTMLImageElement, dataUrl: string): void {
    const mode = this.plugin.settings.coverMode ?? "auto";
    img.dataset.straightened = "1";
    img.removeClass("is-cover-fill");
    img.removeClass("is-cover-stretch");
    img.toggleClass("is-cover-contain", mode === "straighten-contain");
    img.addClass("is-straightened-cover");
    img.src = dataUrl;
  }

  private renderCard(book: Book): HTMLElement {
    const card = document.createElement("div");
    card.addClass("abs-card");
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `${book.title}${book.author ? `，${book.author}` : ""}`);
    card.title = `${book.title}${book.author ? `\n${book.author}` : ""}`;

    const cover = card.createDiv({ cls: "abs-cover" });
    const coverUrl = this.resolveCover(book.cover, book.file);
    this.prefetchCover(coverUrl ?? "");
    this.renderCoverFallback(cover, book.title);

    if (coverUrl) {
      const img = cover.createEl("img", { cls: "abs-cover-img" });
      this.handleCover(img, coverUrl, book.cover, book.file);
      img.alt = book.title;
      this.observeCoverImage(img, coverUrl);
    }

    const adjustBtn = cover.createDiv({
      cls: "abs-cover-adjust-btn",
      attr: { "aria-label": "调整封面", role: "button" },
    });
    setIcon(adjustBtn, "sliders-horizontal");
    adjustBtn.addEventListener("click", (event: MouseEvent) => {
      event.stopPropagation();
      this.openCoverAdjust(book);
    });

    card.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("调整封面…")
          .setIcon("sliders-horizontal")
          .onClick(() => this.openCoverAdjust(book))
      );
      menu.showAtMouseEvent(event);
    });

    if (book.status === "在读") {
      cover.createDiv({ cls: "abs-badge", text: "在读" });
    }

    if (book.progress > 0 && book.progress < 100) {
      const bar = cover.createDiv({ cls: "abs-progress" });
      const fill = bar.createDiv({ cls: "abs-progress-fill" });
      fill.setCssStyles({ width: `${book.progress}%` });
    }

    if (this.plugin.settings.showTitles) {
      const meta = card.createDiv({ cls: "abs-meta" });
      meta.createDiv({ cls: "abs-title", text: book.title });
      if (book.author) meta.createDiv({ cls: "abs-author", text: book.author });
    }

    const open = () => this.openBook(book);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });

    return card;
  }

  private renderCoverFallback(cover: HTMLElement, title: string): void {
    const fallback = cover.createDiv({ cls: "abs-cover-fallback" });
    fallback.setCssStyles({ background: gradientFor(title) });
    fallback.createDiv({ cls: "abs-cover-title", text: title });
  }

  private coverLoaderLimit(): number {
    return Platform.isPhone ? 6 : 12;
  }

  private observeCoverImage(img: HTMLImageElement, url: string): void {
    img.dataset.coverSrc = url;
    img.loading = "eager";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    if (typeof IntersectionObserver === "undefined") {
      window.requestAnimationFrame(() => {
        if (img.isConnected) this.queueCoverImage(img, url);
      });
      return;
    }
    if (!this.coverObserver) {
      this.coverObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target as HTMLImageElement;
            this.coverObserver?.unobserve(el);
            const src = el.dataset.coverSrc;
            if (src && !el.src) this.queueCoverImage(el, src);
          }
        },
        { root: this.contentEl, rootMargin: "500px 0px" }
      );
    }
    this.coverObserver.observe(img);
  }

  private prefetchCover(coverUrl: string): void {
    if (this.coverPrefetchBudget <= 0) return;
    const file = this.coverUrlToFile.get(coverUrl);
    if (!file) return;
    this.coverPrefetchBudget -= 1;
    void this.readCoverBlob(file);
  }

  private queueCoverImage(img: HTMLImageElement, url: string): void {
    if (img.dataset.coverQueued === "1") return;
    img.dataset.coverQueued = "1";
    this.coverLoadQueue.push({ img, url, attempts: 0 });
    this.pumpCoverImages();
  }

  private pumpCoverImages(): void {
    const limit = this.coverLoaderLimit();
    while (this.coverLoadActive < limit && this.coverLoadQueue.length > 0) {
      const job = this.coverLoadQueue.shift();
      if (!job) break;
      if (!job.img.isConnected) continue;
      this.coverLoadActive += 1;
      void this.runCoverJob(job);
    }
  }

  private async runCoverJob(job: {
    img: HTMLImageElement;
    url: string;
    attempts: number;
  }): Promise<void> {
    const { img, url } = job;
    let settled = false;
    let watchdog = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchdog) window.clearTimeout(watchdog);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      this.coverLoadActive = Math.max(0, this.coverLoadActive - 1);
      this.pumpCoverImages();
    };

    const onLoad = () => {
      img.addClass("is-cover-visible");
      finish();
    };

    const onError = () => {
      if (!img.isConnected) {
        finish();
        return;
      }
      if (job.attempts < 2) {
        job.attempts += 1;
        window.setTimeout(() => {
          if (!img.isConnected) {
            finish();
            return;
          }
          img.removeAttribute("src");
          img.src = url;
        }, 350 * job.attempts);
        return;
      }
      img.remove();
      finish();
    };

    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    watchdog = window.setTimeout(() => {
      if (settled) return;
      if (img.isConnected) img.remove();
      finish();
    }, 20000);

    // iCloud 里的本地封面用 app:// 偶尔会一直不返回；直接读文件再 blob，成功率更高。
    const file = this.coverUrlToFile.get(url);
    if (url.startsWith("app://") && file) {
      const cached = await this.readCoverBlob(file);
      if (settled) return;
      if (!img.isConnected) {
        finish();
        return;
      }
      img.src = cached ?? url;
      return;
    }

    img.src = url;
  }

  private async readCoverBlob(file: TFile): Promise<string | null> {
    const cached = this.coverBlobCache.get(file.path);
    if (cached) return cached;
    const pending = this.coverBlobPending.get(file.path);
    if (pending) return pending;

    const task = (async () => {
      try {
        const buffer = await this.app.vault.readBinary(file);
        if (!this.containerEl.isConnected) return null;
        const url = URL.createObjectURL(
          new Blob([buffer], { type: this.coverMime(file.extension) })
        );
        this.cacheCoverBlob(file.path, url);
        return url;
      } catch {
        return null;
      }
    })();
    this.coverBlobPending.set(file.path, task);
    try {
      return await task;
    } finally {
      this.coverBlobPending.delete(file.path);
    }
  }

  private cacheCoverBlob(path: string, url: string): void {
    const old = this.coverBlobCache.get(path);
    if (old) URL.revokeObjectURL(old);
    this.coverBlobCache.set(path, url);
    while (this.coverBlobCache.size > 120) {
      const first = this.coverBlobCache.entries().next().value as
        | [string, string]
        | undefined;
      if (!first) break;
      this.coverBlobCache.delete(first[0]);
      URL.revokeObjectURL(first[1]);
    }
  }

  private invalidateCoverBlob(path: string): void {
    const url = this.coverBlobCache.get(path);
    if (!url) return;
    this.coverBlobCache.delete(path);
    URL.revokeObjectURL(url);
  }

  private coverDirPath(): string {
    const custom = normalizePath(this.plugin.settings.coverDir || "");
    if (custom) return custom;
    const books = normalizePath(
      this.plugin.settings.booksOutputDir || "OmniBooks/苹果图书"
    );
    return `${books}/assets/covers`;
  }

  private coverFileByName(name: string): TFile | null {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    if (!this.coverFileIndex) {
      this.coverFileIndex = new Map();
      for (const file of this.app.vault.getFiles()) {
        if (!/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name)) continue;
        const fileKey = file.name.toLowerCase();
        if (!this.coverFileIndex.has(fileKey)) {
          this.coverFileIndex.set(fileKey, file);
        }
      }
    }
    return this.coverFileIndex.get(key) ?? null;
  }

  private coverPathToUrl(file: TFile | null): string | null {
    if (!file) return null;
    try {
      return this.app.vault.adapter.getResourcePath(file.path);
    } catch {
      return null;
    }
  }

  private coverFileToUrl(file: TFile | null): string | null {
    if (!file) return null;
    const url = this.coverPathToUrl(file);
    if (url) this.coverUrlToFile.set(url, file);
    return url;
  }

  private coverMime(ext: string): string {
    const value = ext.toLowerCase();
    if (value === "png") return "image/png";
    if (value === "webp") return "image/webp";
    if (value === "gif") return "image/gif";
    if (value === "avif") return "image/avif";
    if (value === "bmp") return "image/bmp";
    return "image/jpeg";
  }

  private frontmatterOf(file: TFile | null): Record<string, unknown> | null {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache?.frontmatter as Record<string, unknown> | undefined) ?? null;
  }

  private findCoverFile(raw: string, source: TFile | null): TFile | null {
    let value = stripLink(raw).trim();
    if (!value) return null;
    const markdownImage = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(value);
    if (markdownImage) {
      value = markdownImage[1].trim().replace(/^<|>$/g, "");
    }
    if (/^file:\/\//i.test(value)) {
      try {
        value = decodeURIComponent(value.replace(/^file:\/\//i, ""));
      } catch {
        value = value.replace(/^file:\/\//i, "");
      }
    }
    value = value.split("#")[0].split("?")[0].replace(/\\/g, "/");
    const variants = new Set<string>();
    const add = (candidate: string) => {
      const trimmed = candidate.trim();
      if (trimmed) variants.add(trimmed);
    };
    add(value);
    try {
      add(decodeURIComponent(value));
    } catch {
      /* 保持原样 */
    }
    add(value.replace(/^\.\//, ""));
    add(value.replace(/^\/+/, ""));
    if (/^[A-Za-z]:\//.test(value) || value.startsWith("/")) {
      add(value.split("/").pop() ?? "");
    }

    for (const candidate of variants) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(
        candidate,
        source?.path ?? ""
      );
      if (dest instanceof TFile) return dest;

      const direct = this.app.vault.getAbstractFileByPath(
        normalizePath(candidate)
      );
      if (direct instanceof TFile) return direct;

      if (source?.parent) {
        const sibling = this.app.vault.getAbstractFileByPath(
          normalizePath(`${source.parent.path}/${candidate}`)
        );
        if (sibling instanceof TFile) return sibling;
      }
    }

    const base = (value.split("/").pop() ?? "").trim();
    if (base) {
      const byName = this.coverFileByName(base);
      if (byName) return byName;
      try {
        const decoded = decodeURIComponent(base);
        if (decoded !== base) {
          const byDecoded = this.coverFileByName(decoded);
          if (byDecoded) return byDecoded;
        }
      } catch {
        /* 保持原样 */
      }
    }

    const coverDir = this.coverDirPath();
    if (base) {
      const direct = this.app.vault.getAbstractFileByPath(
        normalizePath(`${coverDir}/${base}`)
      );
      if (direct instanceof TFile) return direct;
    }

    const fm = this.frontmatterOf(source);
    const assetId = String(fm?.bookId ?? "").trim();
    const openUrl = String(fm?.open_url ?? "");
    const appleId = assetId || /assetid\/([A-Za-z0-9]+)/i.exec(openUrl)?.[1] || "";
    if (appleId) {
      const hit = this.app.vault
        .getFiles()
        .find(
          (file) =>
            file.path.startsWith(`${coverDir}/`) &&
            file.basename.toLowerCase() === appleId.toLowerCase()
        );
      if (hit) return hit;
    }

    return null;
  }

  private resolveSiblingCover(source: TFile | null): TFile | null {
    if (!source) return null;
    const folder = source.parent?.path ?? "";
    const stem = source.basename;
    const names = [
      `${stem}.jpg`,
      `${stem}.jpeg`,
      `${stem}.png`,
      `${stem}.webp`,
      "cover.jpg",
      "cover.jpeg",
      "cover.png",
      "cover.webp",
    ];
    for (const name of names) {
      const file = this.app.vault.getAbstractFileByPath(
        normalizePath(`${folder}/${name}`)
      );
      if (file instanceof TFile) return file;
    }

    const fm = this.frontmatterOf(source);
    const assetId = String(fm?.bookId ?? "").trim();
    const openUrl = String(fm?.open_url ?? "");
    const id = assetId || /assetid\/([A-Za-z0-9]+)/i.exec(openUrl)?.[1] || "";
    if (!id) return null;
    const coverDir = this.coverDirPath();
    return (
      this.app.vault
        .getFiles()
        .find(
          (file) =>
            file.path.startsWith(`${coverDir}/`) &&
            file.basename.toLowerCase() === id.toLowerCase()
        ) ?? null
    );
  }

  private resolveCover(raw: string, source: TFile | null): string | null {
    const value = raw.trim();
    if (!value) return this.coverFileToUrl(this.resolveSiblingCover(source));
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
    const file = this.findCoverFile(value, source);
    const url = this.coverFileToUrl(file);
    if (url) return url;
    return this.coverFileToUrl(this.resolveSiblingCover(source));
  }

  /** 其他布局的封面：本地封面走 blob，失败自动重试两次。 */
  private setImageSource(img: HTMLImageElement, url: string, attempt = 0): void {
    img.loading = "eager";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";

    const apply = (src: string) => {
      img.onload = null;
      img.onerror = () => {
        if (attempt < 2) {
          window.setTimeout(() => {
            if (img.isConnected) this.setImageSource(img, url, attempt + 1);
          }, 350 * (attempt + 1));
          return;
        }
        img.onerror = null;
        img.addClass("is-cover-failed");
      };
      img.src = src;
    };

    const file = this.coverUrlToFile.get(url);
    if (url.startsWith("app://") && file) {
      void this.readCoverBlob(file)
        .then((cached) => {
          if (!img.isConnected) return;
          apply(cached ?? url);
        })
        .catch(() => apply(url));
      return;
    }

    apply(url);
  }

  private swipeChoices: Record<
    string,
    { choice: "liked" | "shelved"; status: "想看" | "待看"; ts: number; prevStatus?: string }
  > | null = null;
  private rankCache: Map<string, { minutes: number; rank: number }> | null = null;
  private coverflowLimit = 0;
  private coverflowAutoBatch = 0;
  private coverflowAppending = false;
  private coverflowScroll = 0;
  private coverflowObserver: ResizeObserver | null = null;
  private timelineResizeObserver: ResizeObserver | null = null;
  private deckScrollLocked = false;
  private deckTouchGuard: ((event: TouchEvent) => void) | null = null;
  private curatedPadding = new Set<string>();
  private currentRail: HTMLElement | null = null;
  private sourceSelectEl: HTMLSelectElement | null = null;
  private deckBatchDone = 0;
  private wheelBound = false;
  private wheelLock = 0;
  private quoteResolver: QuoteResolver | null = null;

  private async loadSwipeChoices(): Promise<
    Record<
      string,
      { choice: "liked" | "shelved"; status: "想看" | "待看"; ts: number; prevStatus?: string }
    >
  > {
    if (this.swipeChoices) return this.swipeChoices;
    try {
      const raw = await this.app.vault.adapter.read(this.plugin.bridgePath("swipe.json"));
      const parsed = JSON.parse(raw) as Record<
        string,
        | "liked"
        | "shelved"
        | { choice: "liked" | "shelved"; status: "想看" | "待看"; ts: number }
      >;
      const normalized: Record<
        string,
        { choice: "liked" | "shelved"; status: "想看" | "待看"; ts: number }
      > = {};
      for (const [path, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          normalized[path] = {
            choice: value,
            status: value === "liked" ? "想看" : "待看",
            ts: Date.now(),
          };
        } else {
          normalized[path] = value;
        }
      }
      this.swipeChoices = normalized;
    } catch {
      this.swipeChoices = {};
    }
    return this.swipeChoices;
  }

  private async saveSwipeChoice(path: string, choice: "liked" | "shelved"): Promise<void> {
    const choices = await this.loadSwipeChoices();
    choices[path] = {
      choice,
      status: choice === "liked" ? "想看" : "待看",
      ts: Date.now(),
    };
    await this.app.vault.adapter
      .write(this.plugin.bridgePath("swipe.json"), JSON.stringify(choices, null, 2))
      .catch(() => undefined);
  }

  /** 覆盖时同时回写笔记状态，避免「合并两套」把旧标签顶回来 */
  private async writeNoteStatus(book: Book, status: string): Promise<void> {
    let previous = "";
    try {
      await this.app.fileManager.processFrontMatter(book.file, (frontmatter) => {
        previous = String(frontmatter.status ?? "");
        frontmatter.status = status;
      });
    } catch {
      return;
    }
    try {
      const choices = await this.loadSwipeChoices();
      const entry = choices[book.file.path];
      if (entry && entry.prevStatus === undefined && previous) {
        entry.prevStatus = previous;
        await this.app.vault.adapter
          .write(this.plugin.bridgePath("swipe.json"), JSON.stringify(choices, null, 2))
          .catch(() => undefined);
      }
    } catch {
      /* 忽略 */
    }
  }

  /** 分类完成面板：一轮结束 / 本批 20 本结束 */
  private renderDeckDone(
    container: HTMLElement,
    kind: "round" | "batch",
    liked: number,
    shelved: number,
    remaining: number
  ): void {
    const box = container.createDiv({ cls: "abs-deck-done" });
    box.createDiv({
      cls: "abs-deck-done-title",
      text: kind === "round" ? "这一轮都分类完了" : "本批 20 本分完了",
    });
    box.createDiv({
      cls: "abs-deck-done-stats",
      text:
        kind === "round"
          ? `已收藏 ${liked} 本 · 已搁置 ${shelved} 本`
          : `还剩 ${remaining} 本没分类 · 已收藏 ${liked} 本 · 已搁置 ${shelved} 本`,
    });

    const actions = box.createDiv({ cls: "abs-deck-done-actions" });

    if (kind === "batch") {
      const next = actions.createEl("button", { cls: "mod-cta", text: "继续下一批" });
      next.addEventListener("click", () => {
        this.deckBatchDone = 0;
        this.updateResults();
      });
    }

    const restart = actions.createEl("button", {
      cls: kind === "round" ? "mod-cta" : "",
      text: "重新开始一轮",
    });
    restart.addEventListener("click", async () => {
      this.plugin.settings.deckRoundStart = Date.now();
      this.deckBatchDone = 0;
      await this.plugin.saveSettings();
      this.updateResults();
    });

    const clear = actions.createEl("button", {
      cls: "abs-deck-done-danger",
      text: "清空所有记录",
    });
    clear.addEventListener("click", async () => {
      if (
        !window.confirm(
          "清空所有收藏/搁置记录？笔记里由滑动写入的「想看 / 待看」会恢复成原来的状态。"
        )
      ) {
        return;
      }
      const current = await this.loadSwipeChoices();
      for (const [path, entry] of Object.entries(current)) {
        if (entry.prevStatus === undefined) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        try {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (entry.prevStatus) frontmatter.status = entry.prevStatus;
          });
        } catch {
          /* 忽略 */
        }
      }
      await this.app.vault.adapter
        .write(this.plugin.bridgePath("swipe.json"), "{}")
        .catch(() => undefined);
      this.swipeChoices = null;
      this.plugin.settings.deckRoundStart = 0;
      this.deckBatchDone = 0;
      await this.plugin.saveSettings();
      this.updateResults();
    });

    box.createDiv({
      cls: "abs-deck-done-hint",
      text: "「重新开始一轮」会让你重新看一遍所有书，改主意时直接覆盖；旧记录仍在。",
    });
  }

  private lockDeckScroll(): void {
    if (this.deckScrollLocked) return;
    this.deckScrollLocked = true;
    this.contentEl.classList.add("omnibooks-deck-lock");
    let el: HTMLElement | null = this.contentEl.parentElement;
    while (el) {
      const style = getComputedStyle(el);
      if (
        /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)
      ) {
        el.classList.add("omnibooks-deck-lock");
      }
      el = el.parentElement;
    }
    document.body.classList.add("omnibooks-deck-lock");

    // iPad / iPhone：overflow 和 touch-action 拦不住 document 级滚动与 Obsidian 的滑动手势，
    // 拖动期间直接在 document 上阻止 touchmove 默认行为。
    if (!this.deckTouchGuard) {
      this.deckTouchGuard = (event: TouchEvent) => {
        if (!this.deckScrollLocked) return;
        if (event.cancelable) event.preventDefault();
      };
      document.addEventListener("touchmove", this.deckTouchGuard, {
        passive: false,
      });
    }
  }

  private unlockDeckScroll(): void {
    if (!this.deckScrollLocked) return;
    this.deckScrollLocked = false;
    document
      .querySelectorAll(".omnibooks-deck-lock")
      .forEach((el) => el.classList.remove("omnibooks-deck-lock"));
    if (this.deckTouchGuard) {
      document.removeEventListener("touchmove", this.deckTouchGuard);
      this.deckTouchGuard = null;
    }
  }

  private async renderSwipe(books: Book[]): Promise<void> {
    this.unlockDeckScroll();
    const choices = await this.loadSwipeChoices();
    const round = this.plugin.settings.deckRoundStart || 0;
    const stack = books.filter((book) => {
      const entry = choices[book.file.path];
      return !entry || (entry.ts || 0) < round;
    });
    const container = this.gridEl.createDiv({ cls: "abs-swipe" });
    container.style.setProperty("touch-action", "none", "important");
    container.style.setProperty("overscroll-behavior", "none", "important");

    const liked = Object.values(choices).filter((entry) => entry.choice === "liked").length;
    const shelved = Object.values(choices).filter((entry) => entry.choice === "shelved").length;

    if (stack.length === 0) {
      this.renderDeckDone(container, "round", liked, shelved, 0);
      return;
    }

    if (this.deckBatchDone >= 20) {
      this.renderDeckDone(container, "batch", liked, shelved, stack.length);
      return;
    }

    const top = stack[0];
    const next = stack[1];

    const stackEl = container.createDiv({ cls: "abs-swipe-stack" });

    let peek: HTMLElement | null = null;
    if (next) {
      peek = stackEl.createDiv({ cls: "abs-swipe-card is-peek" });
      const peekCover = this.resolveCover(next.cover, next.file);
      if (peekCover) {
        const img = peek.createEl("img", { cls: "abs-swipe-cover" });
        this.handleCover(img, peekCover, next.cover, next.file);
        this.setImageSource(img, peekCover);
        img.alt = next.title;
        img.loading = "lazy";
      }
    }

    const card = stackEl.createDiv({ cls: "abs-swipe-card is-top" });
    card.style.setProperty("touch-action", "none", "important");
    const coverUrl = this.resolveCover(top.cover, top.file);
    if (coverUrl) {
      const img = card.createEl("img", { cls: "abs-swipe-cover" });
      this.setImageSource(img, coverUrl);
      img.alt = top.title;
    } else {
      const fallback = card.createDiv({ cls: "abs-swipe-fallback" });
      fallback.setCssStyles({ background: gradientFor(top.title) });
      fallback.createDiv({ cls: "abs-swipe-fallback-title", text: top.title });
    }

    const likeStamp = card.createDiv({ cls: "abs-swipe-stamp abs-swipe-stamp--like" });
    appendMarkup(likeStamp.createSpan({ cls: "abs-stamp-icon" }), STAMP_STAR_SVG);
    likeStamp.createSpan({ cls: "abs-stamp-text", text: "收藏" });

    const passStamp = card.createDiv({ cls: "abs-swipe-stamp abs-swipe-stamp--pass" });
    appendMarkup(passStamp.createSpan({ cls: "abs-stamp-icon" }), STAMP_PAUSE_SVG);
    passStamp.createSpan({ cls: "abs-stamp-text", text: "搁置" });
    const quoteEl = card.createDiv({ cls: "abs-swipe-quote" });
    void this.loadCardQuote(top, quoteEl);

    const meta = container.createDiv({ cls: "abs-swipe-meta" });
    meta.createDiv({ cls: "abs-swipe-title", text: top.title });
    if (top.author) meta.createDiv({ cls: "abs-swipe-author", text: top.author });
    container.createDiv({
      cls: "abs-swipe-hint",
      text: Platform.isMobile
        ? `左滑搁置 · 右滑收藏 · 点击阅读　${stack.length} 本待选`
        : `左滑搁置 · 右滑收藏 · 点击阅读 · ← → 方向键　${stack.length} 本待选`,
    });

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let dx = 0;
    let dragging = false;

    const reset = () => {
      card.setCssStyles({ transform: "" });
      card.removeClass("is-dragging");
      likeStamp.setCssStyles({ opacity: "0" });
      passStamp.setCssStyles({ opacity: "0" });
      if (peek) {
        peek.setCssStyles({ opacity: "0" });
        peek.setCssStyles({ transform: "translateY(18px) scale(0.96)" });
      }
    };

    const finish = async (choice: "liked" | "shelved") => {
      const direction = choice === "liked" ? 1 : -1;
      card.addClass("is-leaving");
      card.setCssStyles({ transform: `translateX(${direction * 640}px) rotate(${direction * 22}deg)` });
      card.setCssStyles({ opacity: "0" });
      await this.saveSwipeChoice(top.file.path, choice);
      await this.writeNoteStatus(top, choice === "liked" ? "想看" : "待看");
      this.deckBatchDone += 1;
      this.lastRenderSignature = "";
      window.setTimeout(() => this.updateResults(), 260);
    };

    const gestureSurface = container;
    gestureSurface.addEventListener("pointerdown", (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.lockDeckScroll();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startTime = Date.now();
      dx = 0;
      card.addClass("is-dragging");
      try {
        gestureSurface.setPointerCapture(event.pointerId);
      } catch {
        /* 部分手机 WebView 不支持指针捕获，仍然可以拖动 */
      }
    });

    gestureSurface.addEventListener("pointermove", (event: PointerEvent) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) < Math.abs(dy) && Math.abs(dx) < 8) return;
      card.setCssStyles({ transform: `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 18}deg)` });
      const likeOpacity = Math.min(1, Math.max(0, (dx - 6) / 150));
      const passOpacity = Math.min(1, Math.max(0, (-dx - 6) / 150));
      likeStamp.setCssStyles({ opacity: String(likeOpacity) });
      passStamp.setCssStyles({ opacity: String(passOpacity) });

      if (peek) {
        const reveal = Math.min(1, Math.abs(dx) / 55);
        peek.setCssStyles({
          opacity: String(0.25 + reveal * 0.75),
          transform: `translateY(${16 - reveal * 8}px) scale(${
            0.95 + reveal * 0.03
          })`,
        });
      }
    });

    const endDrag = (cancelled: boolean) => {
      if (!dragging) return;
      dragging = false;
      card.removeClass("is-dragging");
      const elapsed = Math.max(1, Date.now() - startTime);
      const velocity = Math.abs(dx) / elapsed;

      if (!cancelled && Math.abs(dx) < 8 && elapsed < 600) {
        this.openBook(top);
        return;
      }

      if (dx > 70 || (velocity > 0.55 && dx > 28)) {
        void finish("liked");
        return;
      }
      if (dx < -70 || (velocity > 0.55 && dx < -28)) {
        void finish("shelved");
        return;
      }
      reset();
    };

    gestureSurface.addEventListener("pointerup", (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.unlockDeckScroll();
      endDrag(false);
    });
    gestureSurface.addEventListener("pointercancel", (event: PointerEvent) => {
      event.stopPropagation();
      this.unlockDeckScroll();
      endDrag(true);
    });
    gestureSurface.addEventListener("dragstart", (event) => event.preventDefault());
    gestureSurface.addEventListener(
      "touchstart",
      (event: TouchEvent) => {
        if (event.touches.length === 1) {
          this.lockDeckScroll();
          event.preventDefault();
        }
      },
      { passive: false }
    );
    gestureSurface.addEventListener(
      "touchend",
      () => this.unlockDeckScroll(),
      { passive: true }
    );
    gestureSurface.addEventListener(
      "touchcancel",
      () => this.unlockDeckScroll(),
      { passive: true }
    );
    gestureSurface.addEventListener(
      "touchmove",
      (event: TouchEvent) => {
        if (dragging) event.preventDefault();
      },
      { passive: false }
    );
    card.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") void finish("liked");
      if (event.key === "ArrowLeft") void finish("shelved");
    });
    this.deckKeyHandler = (dir) => void finish(dir === "left" ? "shelved" : "liked");
    card.tabIndex = 0;
  }

  private async renderTimelineMode(): Promise<void> {
    this.timelineResizeObserver?.disconnect();
    this.timelineResizeObserver = null;
    const wrap = this.gridEl.createDiv({ cls: "abs-tl-mode" });

    const applyTimelineHeight = () => {
      if (!wrap.isConnected) return;
      const contentRect = this.contentEl.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const topOffset = Math.max(0, wrapRect.top - contentRect.top);
      const contentAvailable = this.contentEl.clientHeight - topOffset - 16;
      const viewportAvailable = window.innerHeight - wrapRect.top - 32;
      const available = Math.max(
        320,
        Math.min(contentAvailable, viewportAvailable)
      );
      wrap.setCssStyles({ height: `${available}px` });
    };
    applyTimelineHeight();
    if (typeof ResizeObserver !== "undefined") {
      this.timelineResizeObserver = new ResizeObserver(() => {
        applyTimelineHeight();
      });
      this.timelineResizeObserver.observe(this.contentEl);
    }

    wrap.createDiv({ cls: "abs-tl-mode-loading", text: "整理时间线…" });

    const events = await computeTimeline(this.app, [
      this.plugin.settings.booksOutputDir || "OmniBooks/苹果图书",
      this.plugin.settings.wereadOutputDir || "OmniBooks/微信读书",
    ]);

    wrap.empty();
    if (events.length === 0) {
      wrap.createDiv({
        cls: "abs-tl-mode-loading",
        text: "还没有阅读记录。",
      });
      return;
    }

    const autoHorizontal = window.innerWidth >= window.innerHeight;
    const orientation = Platform.isPhone
      ? "vertical"
      : this.plugin.settings.timelineOrientation === "auto"
        ? autoHorizontal
          ? "horizontal"
          : "vertical"
        : this.plugin.settings.timelineOrientation;
    const horizontal = orientation === "horizontal";
    wrap.addClass(horizontal ? "is-horizontal" : "is-vertical");

    wrap.setCssProps({
      "--tl-scale": String(this.plugin.settings.timelineScale || 1),
    });
    const controls = wrap.createDiv({ cls: "abs-tl-controls" });
    const sortLabel = this.plugin.settings.timelineSort === "oldest" ? "最初" : "最近";

    if (!Platform.isPhone) {
      const orientationLabel =
        this.plugin.settings.timelineOrientation === "auto"
          ? "自动"
          : this.plugin.settings.timelineOrientation === "horizontal"
            ? "横向"
            : "纵向";
      const dirBtn = controls.createEl("button", {
        cls: "abs-tl-control",
        text: `方向：${orientationLabel}`,
      });
      dirBtn.addEventListener("click", (event: MouseEvent) => {
        const menu = new Menu();
        for (const [value, label] of [
          ["auto", "自动"],
          ["horizontal", "横向"],
          ["vertical", "纵向"],
        ] as const) {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(this.plugin.settings.timelineOrientation === value)
              .onClick(async () => {
                this.plugin.settings.timelineOrientation = value;
                await this.plugin.saveData(this.plugin.settings);
                this.updateResults();
              })
          );
        }
        menu.showAtMouseEvent(event);
      });
    }

    const sortBtn = controls.createEl("button", {
      cls: "abs-tl-control",
      text: `排序：${sortLabel}`,
    });
    sortBtn.addEventListener("click", (event: MouseEvent) => {
      const menu = new Menu();
      for (const [value, label] of [
        ["recent", "最近"],
        ["oldest", "最初"],
      ] as const) {
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setChecked(this.plugin.settings.timelineSort === value)
            .onClick(async () => {
              this.plugin.settings.timelineSort = value;
              await this.plugin.saveData(this.plugin.settings);
              this.updateResults();
            })
        );
      }
      menu.showAtMouseEvent(event);
    });

    const scaleBtn = controls.createEl("button", {
      cls: "abs-tl-control",
      text: `缩放：${Math.round((this.plugin.settings.timelineScale || 1) * 100)}%`,
    });
    scaleBtn.addEventListener("click", (event: MouseEvent) => {
      const menu = new Menu();
      const current = this.plugin.settings.timelineScale || 1;
      const apply = async (value: number) => {
        this.plugin.settings.timelineScale = Math.min(1.6, Math.max(0.4, Math.round(value * 100) / 100));
        await this.plugin.saveData(this.plugin.settings);
        this.updateResults();
      };

      menu.addItem((item) =>
        item
          .setTitle("放大")
          .setIcon("plus")
          .onClick(() => void apply(current + 0.1))
      );
      menu.addItem((item) =>
        item
          .setTitle("缩小")
          .setIcon("minus")
          .onClick(() => void apply(current - 0.1))
      );
      menu.addSeparator();
      for (const preset of [0.4, 0.5, 0.7, 1, 1.3, 1.6] as const) {
        menu.addItem((item) =>
          item
            .setTitle(`${Math.round(preset * 100)}%${preset === 0.4 ? "（年表）" : ""}`)
            .setChecked(Math.abs(current - preset) < 0.001)
            .onClick(() => void apply(preset))
        );
      }
      menu.showAtMouseEvent(event);
    });

    this.gridEl.insertBefore(controls, wrap);

    const orderedEvents =
      this.plugin.settings.timelineSort === "oldest"
        ? [...events].sort((a, b) => a.time - b.time)
        : events;

    // 缩到 40% 左右：切换成按年统计的年表（竖屏、横屏都显示）
    if ((this.plugin.settings.timelineScale || 1) <= 0.45) {
      wrap.addClass("is-yearbook");
      const byYear = new Map<number, { count: number; cover: string; title: string }>();
      for (const event of events) {
        const year = new Date(event.time).getFullYear();
        const entry = byYear.get(year) ?? { count: 0, cover: "", title: "" };
        entry.count += 1;
        if (!entry.cover && event.cover) {
          entry.cover = event.cover;
          entry.title = event.title;
        }
        byYear.set(year, entry);
      }
      const years = [...byYear.entries()].sort((a, b) => b[0] - a[0]);
      const max = Math.max(1, ...years.map(([, entry]) => entry.count));
      const hash = (value: number) => {
        const x = Math.sin(value * 12.9898) * 43758.5453;
        return Math.abs(x - Math.floor(x));
      };

      const chartEl = wrap.createDiv({ cls: "abs-tl-years" });
      years.forEach(([year, entry], colIndex) => {
        const col = chartEl.createDiv({ cls: "abs-tl-year-col" });
        col.title = `${year} 年 · 读过 ${entry.count} 本`;
        col.createDiv({ cls: "abs-tl-year-count", text: `${entry.count}` });

        const height = 30 + (entry.count / max) * 210;
        const unit = 9;
        const slabs = Math.max(2, Math.round(height / unit));
        const stack = col.createDiv({ cls: "abs-tl-year-stack" });
        stack.setCssStyles({ height: `${slabs * unit}px` });

        for (let i = 0; i < slabs; i += 1) {
          const slab = stack.createDiv({ cls: "abs-tl-year-slab" });
          const seed = hash(year * 37 + i * 7);
          slab.setCssStyles({ height: "7px" });
          slab.setCssStyles({ width: `${56 + Math.round(hash(year + i) * 18)}px` });
          slab.setCssProps({
            "--x": `${Math.round((seed - 0.5) * 6)}px`,
            "--r": `${((seed - 0.5) * 1.6).toFixed(2)}deg`,
          });
          slab.setCssStyles({ animationDelay: `${colIndex * 140 + i * 28}ms` });
          const palette = [
            "#c9a48f",
            "#b7c0a8",
            "#9fadb8",
            "#cdc19a",
            "#b8a6b0",
            "#a9b8a4",
            "#c7ada3",
          ];
          const base = palette[Math.floor(seed * palette.length) % palette.length];
          slab.setCssStyles({ background: base });
          slab.setCssStyles({ opacity: String(0.86 + (i % 3) * 0.05) });
        }

        col.createDiv({ cls: "abs-tl-year-label", text: String(year) });
      });
      return;
    }

    // 纵向：复用「阅读时间线」弹窗的样式（日期/圆点每天一次、左上角年份·月份置顶、日期提前淡出）
    if (!horizontal) {
      const firstDate = new Date(orderedEvents[0].time);
      const pin = wrap.createDiv({ cls: "abs-tl-pin" });
      pin.setText(`${firstDate.getFullYear()} · ${firstDate.getMonth() + 1}`);

      const line = wrap.createDiv({ cls: "abs-timeline abs-timeline--embedded" });
      let currentDay = "";
      const dateNodes: Array<{ el: HTMLElement; date: HTMLElement }> = [];
      const monthNodes: Array<{ el: HTMLElement; label: string }> = [];

      for (const event of orderedEvents) {
        const date = new Date(event.time);
        const day = `${date.getMonth() + 1}/${date.getDate()}`;
        const node = line.createDiv({ cls: `abs-tl-item abs-tl-item--${event.kind}` });
        monthNodes.push({
          el: node,
          label: `${date.getFullYear()} · ${date.getMonth() + 1}`,
        });

        if (day !== currentDay) {
          currentDay = day;
          const dateEl = node.createDiv({ cls: "abs-tl-date", text: day });
          node.createDiv({ cls: "abs-tl-dot" });
          dateNodes.push({ el: node, date: dateEl });
        }

        const card = node.createDiv({ cls: "abs-tl-card" });
        const coverUrl = this.resolveCover(event.cover, null);
        if (coverUrl) {
          // 缩略图不需要封面显示方式/拉正，避免 is-cover-stretch 把 30px 缩略图撑满卡片
          const img = card.createEl("img", { cls: "abs-tl-cover" });
          this.setImageSource(img, coverUrl);
          img.alt = event.title;
          img.loading = "lazy";
        }
        const info = card.createDiv({ cls: "abs-tl-info" });
        info.createDiv({ cls: "abs-tl-title", text: event.title });
        info.createDiv({
          cls: "abs-tl-detail",
          text: `${event.detail}${event.author ? ` · ${event.author}` : ""} · ${String(
            date.getHours()
          ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
        });
      }

      const onScroll = () => {
        const base = wrap.getBoundingClientRect().top + 40;
        let label = monthNodes[0]?.label ?? "";
        for (const entry of monthNodes) {
          if (entry.el.getBoundingClientRect().top <= base) label = entry.label;
        }
        pin.setText(label);

        const pinBottom = pin.getBoundingClientRect().bottom;
        for (const entry of dateNodes) {
          const distance = entry.date.getBoundingClientRect().top - pinBottom;
          entry.date.setCssStyles({ opacity: String(Math.max(0, Math.min(1, distance / 96))) });
        }
      };
      wrap.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return;
    }

    // 横向：独立结构，避免旧样式叠加；尺寸固定，与纵向一样每天只标一次日期
    const hPin = wrap.createDiv({ cls: "abs-hpin" });
    const hPinText = hPin.createSpan();
    // 让年份·月份停在虚线正上方，而不是页面顶部
    const tlScale = Number(getComputedStyle(wrap).getPropertyValue("--tl-scale")) || 1;
    const tlLineTop = 30 + 240 * tlScale + 64 + 8 + 4;
    // 初始位置先放在虚线下方，渲染完成后按真实日期行再对齐一次
    hPin.setCssStyles({ marginTop: `${Math.max(0, tlLineTop + 30)}px` });
    const hEntries: Array<{ el: HTMLElement; label: string; date: HTMLElement | null }> = [];

    const track = wrap.createDiv({ cls: "abs-htl-track" });

    wrap.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        wrap.scrollLeft += event.deltaY;
      },
      { passive: false }
    );

    let currentDay = "";
    for (const event of orderedEvents) {
      const date = new Date(event.time);
      const day = `${date.getMonth() + 1}/${date.getDate()}`;

      const item = track.createDiv({ cls: `abs-htl-item abs-htl-item--${event.kind}` });
      const entry: { el: HTMLElement; label: string; date: HTMLElement | null } = {
        el: item,
        label: `${date.getFullYear()} · ${date.getMonth() + 1}`,
        date: null,
      };
      hEntries.push(entry);
      const coverUrl = this.resolveCover(event.cover, null);
      if (coverUrl) {
        const img = item.createEl("img", { cls: "abs-htl-cover" });
        this.setImageSource(img, coverUrl);
        img.alt = event.title;
        img.loading = "lazy";
      } else {
        const fallback = item.createDiv({ cls: "abs-htl-cover abs-htl-fallback" });
        fallback.setCssStyles({ background: gradientFor(event.title) });
        fallback.createDiv({ cls: "abs-htl-fallback-title", text: event.title });
      }

      const info = item.createDiv({ cls: "abs-htl-info" });
      info.createDiv({ cls: "abs-htl-title", text: event.title });
      info.createDiv({
        cls: "abs-htl-detail",
        text: `${event.detail}${event.author ? ` · ${event.author}` : ""}`,
      });

      item.createDiv({ cls: "abs-htl-dot" });
      if (day !== currentDay) {
        currentDay = day;
        entry.date = item.createDiv({ cls: "abs-htl-date", text: day });
      }
    }

    const firstEntry = hEntries[0];
    if (firstEntry) hPinText.setText(firstEntry.label);

    const updateHorizontalPin = () => {
      const leftEdge = wrap.getBoundingClientRect().left + 8;
      let label = firstEntry?.label ?? "";
      for (const entry of hEntries) {
        const rect = entry.el.getBoundingClientRect();
        if (rect.left <= leftEdge + 84) label = entry.label;
      }
      hPinText.setText(label);

      // 日期靠近左侧年份·月份时提前淡出
      for (const entry of hEntries) {
        if (!entry.date) continue;
        const rect = entry.date.getBoundingClientRect();
        const distance = rect.left - (leftEdge + 72);
        entry.date.setCssStyles({ opacity: String(Math.max(0, Math.min(1, distance / 80))) });
      }
    };
    const alignPinToDates = () => {
      const dateEl = hEntries.find((entry) => entry.date)?.date;
      if (!dateEl) return;
      const wrapRect = wrap.getBoundingClientRect();
      const dateRect = dateEl.getBoundingClientRect();
      hPin.setCssStyles({ marginTop: `${Math.max(0, dateRect.top - wrapRect.top)}px` });
    };

    wrap.addEventListener("scroll", updateHorizontalPin, { passive: true });
    window.setTimeout(() => {
      alignPinToDates();
      updateHorizontalPin();
    }, 0);
    window.addEventListener("resize", alignPinToDates);
  }

  private renderCoverflow(books: Book[]): void {
    this.coverflowObserver?.disconnect();
    this.coverflowObserver = null;
    this.coverPrefetchBudget = Platform.isPhone ? 6 : 12;
    const info = this.gridEl.createDiv({ cls: "abs-cf-info" });
    const head = info.createDiv({ cls: "abs-cf-head" });
    const titleEl = head.createDiv({ cls: "abs-cf-title" });
    const authorEl = head.createDiv({ cls: "abs-cf-author" });
    const sortBtn = info.createEl("button", {
      cls: "clickable-icon abs-cf-sort",
      attr: { "aria-label": "排序", type: "button" },
    });
    setIcon(sortBtn, "arrow-up-down");
    sortBtn.addEventListener("click", (event: MouseEvent) => this.openShelfMenu(event));

    const rail = this.gridEl.createDiv({ cls: "abs-coverflow" });
    // 倾斜越强，卡片越紧：克制留缝、标准贴齐、强烈重叠
    const angleMode = this.plugin.settings.coverflowAngle || "standard";
    rail.setCssProps({ "--cf-gap": angleMode === "strong" ? "-16px" : angleMode === "soft" ? "10px" : "0px"
     });
    this.currentRail = rail;
    this.bindWheel();
    const cards: HTMLElement[] = [];
    const total = books.length;
    // 首次进入：桌面 20 本、手机 12 本；之后保留已经加载的数量
    const firstBatch = this.coverflowBatch();
    let rendered = Math.min(total, Math.max(firstBatch, this.coverflowLimit));
    this.coverflowLimit = rendered;

    const createCard = (book: Book): HTMLElement => {
      const card = document.createElement("div");
      card.addClass("abs-cf-card");
      if (this.curatedPadding.has(this.bookKey(book))) {
        card.createDiv({ cls: "abs-cf-pad-badge", text: "最近" });
      }
      const coverUrl = this.resolveCover(book.cover, book.file);
      this.prefetchCover(coverUrl ?? "");
      const fallback = card.createDiv({ cls: "abs-cf-fallback" });
      fallback.setCssStyles({ background: gradientFor(book.title) });
      fallback.createDiv({ cls: "abs-cf-fallback-title", text: book.title });
      if (coverUrl) {
        const img = card.createEl("img", { cls: "abs-cf-img" });
        img.alt = book.title;
        this.observeCoverImage(img, coverUrl);
      }
      card.addEventListener("click", () => {
        if (card.hasClass("is-active")) this.openBook(book);
        else card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
      return card;
    };

    const initialFrag = document.createDocumentFragment();
    for (let i = 0; i < rendered; i += 1) {
      const card = createCard(books[i]);
      cards.push(card);
      initialFrag.appendChild(card);
    }
    rail.appendChild(initialFrag);

    let more: HTMLElement | null = null;
    let moreTitleEl: HTMLElement | null = null;

    const ensureMore = () => {
      if (rendered >= total) {
        // 保留占位块，避免移除后 scrollWidth 变小导致滚动位置回弹
        if (moreTitleEl) moreTitleEl.setText("已全部加载");
        const btn = more?.querySelector<HTMLButtonElement>(".abs-cf-more-btn");
        if (btn) {
          btn.setText("已全部加载");
          btn.disabled = true;
        }
        return;
      }
      if (!more) {
        more = rail.createDiv({ cls: "abs-cf-more" });
        moreTitleEl = more.createDiv({ cls: "abs-cf-more-title" });
        const moreBtn = more.createEl("button", { cls: "abs-cf-more-btn", text: "加载更多" });
        moreBtn.addEventListener("click", () => loadMore());
        if ((this.plugin.settings.shelfFilter || "all") !== "all") {
          more.createDiv({ cls: "abs-cf-more-hint", text: "只显示收藏" });
        }
        const sourceLink = more.createDiv({ cls: "abs-cf-more-link", text: "更改来源" });
        sourceLink.setAttribute("role", "button");
        sourceLink.tabIndex = 0;
        sourceLink.addEventListener("click", (event: MouseEvent) => this.openShelfMenu(event));

      }
      moreTitleEl?.setText(`还有 ${total - rendered} 本`);
    };

    // 真正的追加：只往右端补卡片，不清空、不重建、不改滚动位置
    const loadMore = () => {
      if (rendered >= total) return;
      const next = Math.min(total, rendered + this.coverflowBatch());
      const frag = document.createDocumentFragment();
      for (let i = rendered; i < next; i += 1) {
        const card = createCard(books[i]);
        cards.push(card);
        frag.appendChild(card);
      }
      if (more) rail.insertBefore(frag, more);
      else rail.appendChild(frag);
      rendered = next;
      this.coverflowLimit = next;
      ensureMore();
      recomputeCenters();
      update();
    };

    ensureMore();

    // 自动加载可关：关掉后只在点「加载更多」时追加，滚动过程零重建
    if (this.plugin.settings.coverflowAutoLoad !== false) {
      window.setTimeout(() => {
        rail.addEventListener(
          "scroll",
          () => {
            if (rendered >= total) return;
            if (rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 360) loadMore();
          },
          { passive: true }
        );
      }, 0);
    }

    const cfAngleMode = this.plugin.settings.coverflowAngle || "standard";
    const cfMaxAngle = cfAngleMode === "soft" ? 58 : cfAngleMode === "strong" ? 82 : 70;
    const cfMaxDepth = cfAngleMode === "soft" ? 90 : cfAngleMode === "strong" ? 150 : 120;

    let frame = 0;
    let centers: number[] = [];
    const recomputeCenters = () => {
      centers = cards.map((card) => card.offsetLeft + card.offsetWidth / 2);
    };
    recomputeCenters();

    let lastBest = -1;

    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (rail.clientWidth <= 0) return;
        const center = rail.scrollLeft + rail.clientWidth / 2;
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        const farLimit = rail.clientWidth * 1.15;
        // 只处理屏幕附近这一圈，屏幕外的卡片直接隐藏，减少 3D 图层数量
        const hideLimit =
          rail.clientWidth * (Platform.isPhone ? 1.2 : 0.62);

        cards.forEach((card, index) => {
          const offset = (centers[index] ?? 0) - center;
          const distance = Math.abs(offset);

          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }

          if (distance > hideLimit) {
            if (card.dataset.hidden !== "1") {
              card.dataset.hidden = "1";
              card.setCssStyles({ visibility: "hidden" });
            }
            return;
          }

          if (card.dataset.hidden === "1") {
            card.dataset.hidden = "0";
            card.setCssStyles({ visibility: "visible" });
            card.dataset.state = "";
          }

          const angle = Math.max(-cfMaxAngle, Math.min(cfMaxAngle, offset / 10));
          const scale = Math.max(0.74, 1 - distance / 2200);
          const depth = -Math.min(cfMaxDepth, distance / 5.5);
          // 不再逐帧改 opacity：只保留 transform，减少一层合成开销
          const state = `${angle.toFixed(1)}|${scale.toFixed(3)}|${depth.toFixed(0)}`;
          if (card.dataset.state === state) return;
          card.dataset.state = state;
          card.setCssStyles({ transform: `translate3d(0,0,${depth}px) rotateY(${-angle}deg) scale(${scale})` });
        });

        // 只有当前卡片变化时才写 DOM 文本和 class，避免每帧重排
        if (best !== lastBest) {
          lastBest = best;
          cards.forEach((card, index) => card.toggleClass("is-active", index === best));
          titleEl.setText(books[best]?.title ?? "");
          authorEl.setText(books[best]?.author ?? "");
        }
      });
    };

    rail.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", () => {
      recomputeCenters();
      update();
    });
    window.setTimeout(() => {
      recomputeCenters();
      if (this.coverflowScroll > 0) {
        rail.scrollLeft = this.coverflowScroll;
        this.coverflowScroll = 0;
        update();
        return;
      }
      const first = cards[0];
      if (first) {
        rail.scrollLeft = first.offsetLeft - (rail.clientWidth - first.offsetWidth) / 2;
      }
      update();
    }, 0);
    window.setTimeout(update, 0);
    // 手机端视图动画结束后再量一次；避免首次 clientWidth 为 0 导致卡片被判定在屏幕外。
    window.setTimeout(() => {
      recomputeCenters();
      if (rail.scrollLeft <= 1 && cards[0]) {
        rail.scrollLeft =
          cards[0].offsetLeft - (rail.clientWidth - cards[0].offsetWidth) / 2;
      }
      update();
    }, 160);

    if (typeof ResizeObserver !== "undefined") {
      this.coverflowObserver = new ResizeObserver(() => {
        recomputeCenters();
        update();
      });
      this.coverflowObserver.observe(rail);
    }
  }

  private async loadCardQuote(book: Book, el: HTMLElement): Promise<void> {
    if (!this.quoteResolver) {
      this.quoteResolver = new QuoteResolver(
        this.app,
        this.plugin.settings.wereadApiKey,
        this.plugin.bridgePath("quotes.json")
      );
    }
    const quotes = await this.quoteResolver.resolveMany(book.file);
    if (quotes.length === 0) return;
    el.setText(quotes.slice(0, 2).map((item) => item.text).join("\n"));
    el.addClass("is-visible");
  }

  private async loadStackQuote(book: Book, el: HTMLElement, index: number): Promise<void> {
    if (!this.quoteResolver) {
      this.quoteResolver = new QuoteResolver(
        this.app,
        this.plugin.settings.wereadApiKey,
        this.plugin.bridgePath("quotes.json")
      );
    }
    el.removeClass("is-visible");
    el.setText("");
    const quotes = await this.quoteResolver.resolveMany(book.file);
    if (quotes.length === 0) return;
    const card = this.gridEl.querySelectorAll(".abs-stack-card")[index];
    if (card instanceof HTMLElement && card.hasClass("is-active")) {
      el.setText(quotes.slice(0, 3).map((item) => item.text).join("\n"));
      el.addClass("is-visible");
    }
  }

  private renderStack(books: Book[]): void {
    const wide =
      this.contentEl.clientWidth > this.contentEl.clientHeight &&
      this.contentEl.clientWidth >= 820;
    const layout = this.gridEl.createDiv({
      cls: wide ? "abs-stack-layout is-wide" : "abs-stack-layout",
    });
    const stack = layout.createDiv({ cls: "abs-stack" });
    const side = wide ? layout.createDiv({ cls: "abs-stack-side-quote" }) : null;
    const cards: HTMLElement[] = [];
    let progressFill: HTMLElement | null = null;
    let active = 0;

    const setActive = (index: number) => {
      active = index;
      cards.forEach((card, i) => card.toggleClass("is-active", i === index));
      if (progressFill) {
        progressFill.setCssStyles({ width: `${((index + 1) / Math.max(1, books.length)) * 100}%` });
      }
      const quoteEl = cards[index]?.querySelector(".abs-stack-quote");
      const quoteTarget = quoteEl instanceof HTMLElement ? quoteEl : null;
      const book = books[index];
      if (book) {
        if (quoteTarget) this.loadStackQuote(book, quoteTarget, index);
        if (side) this.loadStackQuote(book, side, index);
      }
    };

    books.forEach((book, index) => {
      const card = stack.createDiv({ cls: "abs-stack-card" });
      const hue = this.spineHue(book.title);
      card.setCssProps({ "--stack-hue": String(hue) });
      if (index % 2 === 1) card.addClass("is-alt");

      const cover = card.createDiv({ cls: "abs-stack-cover" });
      const coverUrl = this.resolveCover(book.cover, book.file);
      if (coverUrl) {
        const img = cover.createEl("img", { cls: "abs-stack-img" });
        this.handleCover(img, coverUrl, book.cover, book.file);
        this.setImageSource(img, coverUrl);
        img.alt = book.title;
        img.loading = "lazy";
      } else {
        const fallback = cover.createDiv({ cls: "abs-stack-fallback" });
        fallback.setCssStyles({ background: gradientFor(book.title) });
        fallback.createDiv({ cls: "abs-stack-fallback-title", text: book.title });
      }

      const label = card.createDiv({ cls: "abs-stack-label" });
      label.createDiv({ cls: "abs-stack-title", text: book.title });
      if (book.author) label.createDiv({ cls: "abs-stack-author", text: book.author });
      card.createDiv({ cls: "abs-stack-quote" });

      card.addEventListener("click", () => {
        if (active === index) {
          this.openBook(book);
          return;
        }
        setActive(index);
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      cards.push(card);
    });

    let frame = 0;
    const updateActive = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = stack.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        let best = 0;
        let distance = Number.POSITIVE_INFINITY;
        cards.forEach((card, i) => {
          const box = card.getBoundingClientRect();
          const delta = Math.abs(box.top + box.height / 2 - center);
          if (delta < distance) {
            distance = delta;
            best = i;
          }
        });
        setActive(best);
      });
    };

    progressFill = this.gridEl
      .createDiv({ cls: "abs-stack-progress" })
      .createDiv({ cls: "abs-stack-progress-fill" });
    stack.addEventListener("scroll", updateActive, { passive: true });
    window.setTimeout(() => setActive(0), 0);
  }

  private renderFold(books: Book[]): void {
    const wrap = this.gridEl.createDiv({ cls: "abs-fold" });
    const panels: HTMLElement[] = [];
    let active = 0;

    const setActive = (index: number) => {
      active = index;
      panels.forEach((panel, i) => panel.toggleClass("is-active", i === index));
    };

    books.forEach((book, index) => {
      const hue = this.spineHue(book.title);
      const panel = wrap.createDiv({ cls: "abs-fold-panel" });
      if (index % 2 === 1) panel.addClass("is-alt");
      panel.setCssStyles({ background: `linear-gradient(180deg, hsl(${hue} 42% 44%), hsl(${hue} 46% 28%))` });
      panel.setCssProps({ "--fold-hue": String(hue) });
      panel.createDiv({ cls: "abs-fold-title", text: book.title });

      panel.addEventListener("click", () => {
        if (active === index) {
          this.openBook(book);
          return;
        }
        setActive(index);
        panel.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });

      panels.push(panel);
    });

    let frame = 0;
    const updateActive = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const center = wrap.scrollLeft + wrap.clientWidth / 2;
        let best = 0;
        let distance = Number.POSITIVE_INFINITY;
        panels.forEach((panel, index) => {
          const middle = panel.offsetLeft + panel.offsetWidth / 2;
          const delta = Math.abs(middle - center);
          if (delta < distance) {
            distance = delta;
            best = index;
          }
        });
        setActive(best);
      });
    };

    wrap.addEventListener("scroll", updateActive, { passive: true });
    window.setTimeout(() => {
      const first = panels[0];
      if (first) {
        wrap.scrollLeft = first.offsetLeft - (wrap.clientWidth - first.offsetWidth) / 2;
      }
      setActive(0);
    }, 0);
  }

  resetSwipeChoices(): void {
    this.swipeChoices = {};
    void this.app.vault.adapter
      .remove(this.plugin.bridgePath("swipe.json"))
      .catch(() => undefined);
    this.updateResults();
  }

  private currentScale(): number {
    const saved = this.plugin.settings.viewScales?.[this.plugin.settings.shelfLayout];
    if (typeof saved === "number") return saved;
    // 唱片模式默认 100%；iPad 封面墙默认 100%，其他布局默认 80%
    if (this.plugin.settings.shelfLayout === "coverflow") return 1;
    if (Platform.isTablet) return 1;
    return 0.8;
  }

  private applyScale(): void {
    this.contentEl.setCssProps({ "--abs-scale": String(this.currentScale()) });
  }

  private spineHue(title: string): number {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = (hash * 31 + title.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
  }

  private renderSpineShelf(books: Book[]): void {
    const info = this.gridEl.createDiv({ cls: "abs-spine-info" });
    const infoTitle = info.createDiv({ cls: "abs-spine-info-title" });
    const infoMeta = info.createDiv({ cls: "abs-spine-info-meta" });

    const rail = this.gridEl.createDiv({ cls: "abs-spine-rail" });
    const spines: HTMLElement[] = [];
    let activeBook: Book | null = null;

    const setActive = (index: number) => {
      spines.forEach((el, i) => el.toggleClass("is-active", i === index));
      activeBook = books[index];
      infoTitle.setText(books[index]?.title ?? "");
      infoMeta.setText(
        [
          books[index]?.author,
          books[index]?.status,
          books[index]?.highlights ? `${books[index].highlights} 条划线` : "",
          books[index]?.words
            ? `${(books[index].words / 10000).toFixed(1)} 万字`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      );
    };

    books.forEach((book, index) => {
      const spine = document.createElement("div");
      spine.addClass("abs-spine");
      const hue = this.spineHue(book.title);
      spine.setCssStyles({ background: `linear-gradient(180deg, hsl(${hue} 42% 46%), hsl(${hue} 46% 31%))` });
      const words = book.words || 0;
      const base = words > 0 ? 170 + Math.min(190, Math.sqrt(words) / 3) : 225 + (hue % 4) * 12;
      spine.setCssStyles({ height: `${Math.round(base * this.currentScale())}px` });
      spine.setAttribute("title", book.title);
      spine.createDiv({ cls: "abs-spine-title", text: book.title });
      spine.addEventListener("click", () => {
        const isActive = spine.hasClass("is-active");
        setActive(index);
        spine.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        if (isActive) this.openBook(book);
      });
      rail.appendChild(spine);
      spines.push(spine);
    });

    info.addEventListener("click", () => {
      if (activeBook) this.openBook(activeBook);
    });

    let frame = 0;
    const updateActive = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const center = rail.scrollLeft + rail.clientWidth / 2;
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        spines.forEach((spine, index) => {
          const middle = spine.offsetLeft + spine.offsetWidth / 2;
          const distance = Math.abs(middle - center);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        });
        setActive(best);
      });
    };

    rail.addEventListener("scroll", updateActive, { passive: true });
    window.setTimeout(() => {
      const first = spines[0];
      if (first) {
        rail.scrollLeft =
          first.offsetLeft - (rail.clientWidth - first.offsetWidth) / 2;
      }
      setActive(0);
    }, 0);
  }

  private openBook(book: Book): void {
    const appleDir = normalizePath(this.plugin.settings.booksOutputDir || "苹果图书");
    const wereadDir = normalizePath(this.plugin.settings.wereadOutputDir || "微信读书");
    const frontmatter = this.app.metadataCache.getFileCache(book.file)?.frontmatter;
    const looksLikeBookNote = Boolean(
      frontmatter &&
        (frontmatter.bookId || frontmatter.source || frontmatter.annotation_count !== undefined)
    );

    if (
      book.file.path.startsWith(`${appleDir}/`) ||
      book.file.path.startsWith(`${wereadDir}/`) ||
      looksLikeBookNote
    ) {
      const preferred = [appleDir, wereadDir];
      const sorted = [...book.files].sort((a, b) => {
        const score = (path: string) =>
          preferred.some((dir) => dir && path.startsWith(`${dir}/`)) ? 0 : 1;
        return score(a.path) - score(b.path);
      });
      void this.plugin.openBookReader(sorted);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    void leaf.openFile(book.file).catch(() => {
      new Notice(`无法打开：${book.title}`);
    });
  }

  /** 把独立的日期链接行合并到下一段划线末尾，形成「正文 —— [日期](链接)」 */
  async migrateInlineTimestamps(): Promise<void> {
    const dirs = [
      this.plugin.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.plugin.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    const stampRe =
      /^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\]\((<[^>]+>|[^)]+)\)\s*$/;
    let changed = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!dirs.some((dir) => file.path.startsWith(`${dir}/`))) continue;
      const text = await this.app.vault.read(file);
      if (!/^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\]\(/m.test(text)) continue;

      const lines = text.split("\n");
      const out: string[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (!stampRe.test(lines[i])) {
          out.push(lines[i]);
          continue;
        }
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j += 1;
        const next = lines[j];
        const blocked =
          !next ||
          next.startsWith("#") ||
          next.startsWith(">") ||
          stampRe.test(next);
        if (blocked) {
          out.push(lines[i]);
          continue;
        }
        let k = j;
        while (
          k + 1 < lines.length &&
          lines[k + 1].trim() !== "" &&
          !lines[k + 1].startsWith("#") &&
          !lines[k + 1].startsWith(">") &&
          !stampRe.test(lines[k + 1])
        ) {
          k += 1;
        }
        for (let x = j; x <= k; x += 1) {
          out.push(x === k ? `${lines[x]} —— ${lines[i].trim()}` : lines[x]);
        }
        out.push("");
        i = k;
      }

      const nextText = out.join("\n");
      if (nextText !== text) {
        await this.app.vault.modify(file, nextText);
        changed += 1;
      }
    }

    new Notice(`已改为行尾时间戳：${changed} 篇笔记`);
  }

  /** 把旧的 <span class="abs-time"> 时间戳迁移成标准 Markdown 链接 */
  async migrateTimeLinks(): Promise<void> {
    const dirs = [
      this.plugin.settings.booksOutputDir || DEFAULT_SETTINGS.booksOutputDir,
      this.plugin.settings.wereadOutputDir || DEFAULT_SETTINGS.wereadOutputDir,
    ]
      .filter(Boolean)
      .map((dir) => normalizePath(dir));
    let changed = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!dirs.some((dir) => file.path.startsWith(`${dir}/`))) continue;
      const text = await this.app.vault.read(file);
      if (!text.includes('class="abs-time"')) continue;
      const next = text.replace(
        /<span class="abs-time">\[([^\]]+)\]\((?:<([^>]+)>|([^)]+))\)<\/span>/g,
        (_match, label: string, angled: string | undefined, plain: string | undefined) =>
          `[${label}](<${String(angled || plain || "").trim()}>)`
      );
      if (next !== text) {
        await this.app.vault.modify(file, next);
        changed += 1;
      }
    }

    new Notice(`时间戳已迁移：${changed} 篇笔记`);
  }

  async exportDiagnostics(): Promise<void> {
    await this.refreshData();
    const data = {
      vault: this.app.vault.getName(),
      platform: Platform.isMobile ? "mobile" : "desktop",
      folder: this.plugin.settings.folder,
      scanned: this.scanStats.files,
      matched: this.scanStats.matched,
      totalMarkdown: this.app.vault.getMarkdownFiles().length,
      books: this.books.slice(0, 20).map((book) => ({
        title: book.title,
        path: book.file.path,
        status: book.status,
        progress: book.progress,
        highlights: book.highlights,
        cover: book.cover.slice(0, 100),
      })),
    };
    await this.app.vault.adapter.write(
      this.plugin.bridgePath("diagnostics.json"),
      JSON.stringify(data, null, 2)
    );
  }

  private syncing = false;

  async runSync(scope: "all" | "apple" | "weread" = "all"): Promise<void> {
    if (!this.plugin.settings.syncEnabled) {
      new Notice("同步功能已在设置中关闭");
      return;
    }

    if (this.syncing) {
      new Notice("正在同步，请稍候…", 3000);
      return;
    }

    const wantApple = scope !== "weread";
    const wantWeread =
      scope !== "apple" &&
      this.plugin.settings.wereadEnabled &&
      Boolean(this.plugin.settings.wereadApiKey);

    this.syncing = true;
    const notice = new Notice("正在同步…", 0);
    try {
      if (Platform.isDesktopApp) {
        let apple = { ok: true, message: "" };
        let weread = { ok: true, message: "" };

        if (wantApple) {
          notice.setMessage("正在更新苹果图书…");
          apple = await this.plugin.runSync();
        }
        if (wantWeread) {
          notice.setMessage("正在更新微信读书…");
          weread = await this.plugin.runWereadSync({
            onProgress: (message) => notice.setMessage(`微信读书 ${message}`),
          });
        }

        const parts: string[] = [];
        if (wantApple) {
          parts.push(apple.ok ? "苹果图书已更新" : `苹果图书失败：${apple.message}`);
        }
        if (wantWeread) {
          parts.push(weread.ok ? weread.message || "微信读书已更新" : `微信读书失败：${weread.message}`);
        }
        notice.setMessage(parts.join("；") || "没有可同步的内容");

        if (apple.ok || weread.ok) void this.refreshData();
        return;
      }

      if (wantWeread) {
        notice.setMessage("正在更新微信读书…");
        const weread = await this.plugin.runWereadSync({
          onProgress: (message) => notice.setMessage(`微信读书 ${message}`),
        });
        notice.setMessage(
          weread.ok ? weread.message || "微信读书已更新" : `微信读书失败：${weread.message}`
        );
        if (weread.ok) void this.refreshData();
      }

      if (wantApple) {
        notice.setMessage("已发送苹果图书请求，等待 Mac 响应…");
        notice.hide();
        await this.requestRemoteSync();
        return;
      }
    } finally {
      this.syncing = false;
      window.setTimeout(() => notice.hide(), 2600);
    }
  }

  private async requestRemoteSync(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dir = normalizePath(this.plugin.settings.syncBridgeDir || ".apple-books-sync");
    const requestPath = this.plugin.bridgePath("request.json");
    const statusPath = this.plugin.bridgePath("status.json");

    try {
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    } catch {
      /* 目录已存在 */
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await adapter.write(requestPath, JSON.stringify({ id, ts: Date.now(), device: "mobile" }));
    new Notice(
      "已发送苹果图书更新请求；Mac 运行时会自动处理。微信读书同步不需要等待这一步。",
      7000
    );

    const started = Date.now();
    let warned = false;
    const deadline = started + 240_000;
    while (Date.now() < deadline) {
      await wait(2000);
      if (!warned && Date.now() - started > 20_000) {
        warned = true;
        new Notice(
          "Mac 还没有响应。请确认 Mac 上的 Obsidian 正在运行；请求会保留，稍后运行也会处理。",
          8000
        );
      }
      if (!(await adapter.exists(statusPath))) continue;

      try {
        const status = JSON.parse(await adapter.read(statusPath)) as {
          id?: string;
          ok?: boolean;
          message?: string;
        };
        if (status.id !== id) continue;

        new Notice(
          status.ok
            ? "苹果图书已更新"
            : `苹果图书更新失败：${status.message ?? "未知错误"}`,
          status.ok ? 4000 : 10000
        );
        if (status.ok) void this.refreshData();
        return;
      } catch {
        /* 文件正在写入，稍后重试 */
      }
    }

    new Notice(
      "苹果图书更新未完成：Mac 没有响应。请确认 Mac 上的 Obsidian 正在运行，并已授予完全磁盘访问权限。",
      12000
    );
  }
}

class AppleBooksShelfSettingTab extends PluginSettingTab {
  plugin: AppleBooksShelfPlugin;

  constructor(app: App, plugin: AppleBooksShelfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private appleBooksStatus() { return appleBooksStatus(); }


  private countStatusMatches(statuses: string[]): number {
    if (statuses.length === 0) return 0;
    const dirs = [
      normalizePath(this.plugin.settings.booksOutputDir || "OmniBooks/苹果图书"),
      normalizePath(this.plugin.settings.wereadOutputDir || "OmniBooks/微信读书"),
    ].filter(Boolean);

    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!dirs.some((dir) => file.path.startsWith(`${dir}/`))) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      const status = normalizeStatus(frontmatter.status ?? frontmatter.readingStatus);
      if (status && statuses.includes(status)) count += 1;
    }
    return count;
  }

  private async countSwipeLikes(): Promise<number> {
    try {
      const raw = await this.app.vault.adapter.read(this.plugin.bridgePath("swipe.json"));
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.values(parsed).filter((value) =>
        typeof value === "string" ? value === "liked" : (value as { choice?: string })?.choice === "liked"
      ).length;
    } catch {
      return 0;
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "随处可读，一处留痕",
    });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `界面构建：${UI_BUILD}`,
    });

    new Setting(containerEl)
      .setName("安装向导")
      .setDesc(
        this.plugin.settings.setupPending
          ? "还有书源未设置完成；点「重新打开」继续。不会改动已有笔记。"
          : "重新选择书源、填写微信读书 Key、检查苹果图书权限。不会改动已有笔记。"
      )
      .addButton((button) =>
        button.setButtonText("重新打开").onClick(() => this.plugin.openSetupWizard())
      );

    new Setting(containerEl).setName("显示").setHeading();

    new Setting(containerEl)
      .setName("封面显示方式")
      .setDesc(
        "自动：标准封面铺满；立体书、带书脊或拍歪的封面会自动找四条边做透视校正。也可以强制铺满或完整显示。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "自动（默认：铺满 + 拉正，尽量不裁字）")
          .addOption("fill", "铺满方框（裁切边缘）")
          .addOption("contain", "完整显示（留白，绝不裁切）")
          .addOption("stretch", "拉伸铺满（会变形，但一个字都不裁）")
          .addOption("straighten-contain", "拉正后完整显示（留白）")
          .setValue(this.plugin.settings.coverMode ?? "auto")
          .onChange(async (value) => {
            this.plugin.settings.coverMode = value as CoverMode;
            this.plugin.settings.straightenCovers =
              value === "auto" || value === "straighten-contain";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("唱片倾斜")
      .setDesc("控制唱片模式两侧未选中封面的倾斜幅度；只改角度和景深，不增加渲染开销。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("soft", "克制（58°）")
          .addOption("standard", "标准（70°）")
          .addOption("strong", "强烈（82°）")
          .setValue(this.plugin.settings.coverflowAngle ?? "standard")
          .onChange(async (value) => {
            this.plugin.settings.coverflowAngle = value as "soft" | "standard" | "strong";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("加载方式")
      .setDesc(
        "自动：滑到末尾自动追加下一批；手动：只在点「加载更多」时追加。唱片模式的排序菜单里也能切换。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "自动加载")
          .addOption("manual", "手动加载")
          .setValue(this.plugin.settings.coverflowAutoLoad !== false ? "auto" : "manual")
          .onChange(async (value) => {
            this.plugin.settings.coverflowAutoLoad = value === "auto";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("唱片模式每批数量")
      .setDesc(
        "唱片模式一次渲染多少本。自动档：手机 12 本起、桌面 20 本起，并根据实测首帧在 8–30 之间自动调整。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("0", "自动（推荐）")
          .addOption("10", "每批 10 本（省内存）")
          .addOption("20", "每批 20 本")
          .addOption("30", "每批 30 本（高性能设备）")
          .setValue(String(this.plugin.settings.coverflowBatch ?? 0))
          .onChange(async (value) => {
            this.plugin.settings.coverflowBatch = Number(value) || 0;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("显示书名和作者")
      .setDesc("关闭后只显示封面墙。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTitles)
          .onChange(async (value) => {
            this.plugin.settings.showTitles = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("隐藏封面文件夹")
      .setDesc("在文件管理器里隐藏苹果图书的 assets 文件夹；封面链接不受影响。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideAssetFolder !== false)
          .onChange(async (value) => {
            this.plugin.settings.hideAssetFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动清理重复笔记")
      .setDesc(
        "只清理同一书源内同一本书、正文完全一致的副本；苹果和微信同名不算重复。保留一份，其余移到 .apple-books-sync/duplicate-backup。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCleanDuplicates !== false)
          .onChange(async (value) => {
            this.plugin.settings.autoCleanDuplicates = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("笔记属性显示")
      .setDesc(
        "默认只显示书名、作者、阅读时间；自定义可填写要额外显示的字段，多个用逗号分隔。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("minimal", "精简：书名、作者、阅读时间")
          .addOption("custom", "自定义")
          .addOption("all", "全部属性")
          .setValue(
            this.plugin.settings.showAllProperties
              ? "all"
              : (this.plugin.settings.visibleProperties ||
                  "title,author,readingTime") === "title,author,readingTime"
                ? "minimal"
                : "custom"
          )
          .onChange(async (value) => {
            this.plugin.settings.showAllProperties = value === "all";
            if (value === "minimal") {
              this.plugin.settings.visibleProperties = "title,author,readingTime";
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自定义显示的属性")
      .setDesc("用逗号分隔字段名，例如 title,author,readingTime,bookId,lastRead。")
      .addText((text) =>
        text
          .setPlaceholder("title,author,readingTime")
          .setValue(
            this.plugin.settings.visibleProperties ||
              "title,author,readingTime"
          )
          .onChange(async (value) => {
            this.plugin.settings.visibleProperties =
              value.trim() || "title,author,readingTime";
            this.plugin.settings.showAllProperties = false;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("打开书籍笔记时")
      .setDesc(
        "阅读视图最接近书架；Obsidian 阅读模式只读；实时预览用于编辑。按住 Alt 打开可临时编辑原文。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("reader", "OmniBooks 阅读视图")
          .addOption("reading", "Obsidian 阅读模式")
          .addOption("live", "实时预览编辑")
          .setValue(this.plugin.settings.bookNoteView ?? "reader")
          .onChange(async (value) => {
            this.plugin.settings.bookNoteView =
              value as typeof this.plugin.settings.bookNoteView;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("阅读视图密度")
      .setDesc("控制阅读视图的留白和字号。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("comfortable", "舒适")
          .addOption("compact", "紧凑")
          .addOption("minimal", "极简")
          .setValue(this.plugin.settings.readerDensity)
          .onChange(async (value) => {
            this.plugin.settings.readerDensity =
              value as typeof this.plugin.settings.readerDensity;
            await this.plugin.saveSettings();
            this.plugin.refreshReaderViews();
          })
      );

    new Setting(containerEl)
      .setName("阅读视图显示时间")
      .setDesc("关闭后每条划线不显示时间。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.readerShowTime).onChange(async (value) => {
          this.plugin.settings.readerShowTime = value;
          await this.plugin.saveSettings();
          this.plugin.refreshReaderViews();
        })
      );

    new Setting(containerEl)
      .setName("保存后退出编辑")
      .setDesc("关闭后点保存会留在编辑模式，方便连续修改。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.exitEditAfterSave !== false)
          .onChange(async (value) => {
            this.plugin.settings.exitEditAfterSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("编辑高亮边框")
      .setDesc("进入阅读视图的编辑模式时，在面板四周显示一圈主题色边框。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.editHighlight !== false)
          .onChange(async (value) => {
            this.plugin.settings.editHighlight = value;
            await this.plugin.saveSettings();
            this.plugin.refreshReaderViews();
          })
      );

    new Setting(containerEl)
      .setName("默认排序")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("recent", "最近阅读")
          .addOption("title", "书名")
          .addOption("rating", "评分")
          .addOption("progress", "阅读进度")
          .setValue(this.plugin.settings.defaultSort)
          .onChange(async (value) => {
            this.plugin.settings.defaultSort = value as SortKey;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("图书文件夹")
      .setDesc("只扫描这个文件夹；留空表示全库扫描。")
      .addText((text) =>
        text
          .setPlaceholder("例如：图书")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("图书笔记文件夹")
      .setDesc("苹果图书同步生成的笔记存放位置（库内相对路径，可自定义）。在 Obsidian 里移动文件夹会自动跟随。")
      .addText((text) =>
        text
          .setPlaceholder("读书笔记/苹果图书")
          .setValue(this.plugin.settings.booksOutputDir)
          .onChange(async (value) => {
            this.plugin.settings.booksOutputDir =
              value.trim() || DEFAULT_SETTINGS.booksOutputDir;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("封面文件夹")
      .setDesc(
        "苹果图书封面的存放位置；留空使用「图书笔记文件夹/assets/covers」。"
      )
      .addText((text) =>
        text
          .setPlaceholder(`${DEFAULT_SETTINGS.booksOutputDir}/assets/covers`)
          .setValue(this.plugin.settings.coverDir || "")
          .onChange(async (value) => {
            this.plugin.settings.coverDir = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("收藏").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "收藏有两个来源，各记各的：一是卡片模式右滑「收藏」，二是笔记里写的状态。由你决定以哪个为准。",
    });

    new Setting(containerEl)
      .setName("以哪个为准")
      .setDesc("默认两个都算：右滑收藏过的书，加上状态符合下面设置的书。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("merged", "两个都算（推荐）")
          .addOption("swipe", "只看右滑收藏")
          .addOption("status", "只看笔记状态")
          .setValue(this.plugin.settings.favoriteSource || "merged")
          .onChange(async (value) => {
            this.plugin.settings.favoriteSource =
              value as typeof this.plugin.settings.favoriteSource;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    const statusSetting = new Setting(containerEl)
      .setName("哪些笔记状态算收藏")
      .setDesc("点一下切换，立即生效。");
    statusSetting.settingEl.addClass("abs-fav-status-row");
    const chips = statusSetting.controlEl.createDiv({ cls: "abs-fav-statuses" });
    const statusOptions = ["想看", "想读", "待看", "在读", "已读"];
    const parseStatuses = () =>
      (this.plugin.settings.favoriteStatuses || "想看")
        .split(/[,，\s]+/)
        .map((word) => word.trim())
        .filter(Boolean);

    const updateCount = () => {
      const selected = parseStatuses();
      const matches = this.countStatusMatches(selected);
      void this.countSwipeLikes().then((likes) => {
        statusSetting.setDesc(
          `点一下切换。当前匹配：笔记状态 ${matches} 本 · 右滑收藏 ${likes} 本`
        );
      });
    };

    for (const status of statusOptions) {
      const chip = chips.createEl("button", { cls: "abs-fav-chip", text: status });
      if (parseStatuses().includes(status)) chip.addClass("is-on");
      chip.addEventListener("click", async () => {
        const selected = parseStatuses();
        const next = selected.includes(status)
          ? selected.filter((item) => item !== status)
          : [...selected, status];
        this.plugin.settings.favoriteStatuses = next.join(",") || "想看";
        chip.toggleClass("is-on", next.includes(status));
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        updateCount();
      });
    }

    updateCount();

    new Setting(containerEl)
      .setName("收藏不足时补足到")
      .setDesc("填 0 表示不补足（等于严格只看收藏）。补进来的书会在封面右上角标「最近」。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text
          .setValue(String(this.plugin.settings.favoriteFillTo ?? 20))
          .onChange(async (value) => {
            const count = Number(value);
            this.plugin.settings.favoriteFillTo =
              Number.isFinite(count) && count >= 0 ? Math.floor(count) : 20;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    new Setting(containerEl)
      .setName("金句收藏文件")
      .setDesc("阅读时点爱心，会追加到这里的 Markdown。可以直接在文件里给句子补评论。")
      .addText((text) =>
        text
          .setPlaceholder("OmniBooks/阅读/金句.md")
          .setValue(this.plugin.settings.quotesFilePath || "OmniBooks/阅读/金句.md")
          .onChange(async (value) => {
            this.plugin.settings.quotesFilePath =
              value.trim() || "OmniBooks/阅读/金句.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("选中文字显示工具条")
      .setDesc("阅读时选中文字，浮出「复制 / 收藏」。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showSelectionToolbar !== false)
          .onChange(async (value) => {
            this.plugin.settings.showSelectionToolbar = value;
            await this.plugin.saveSettings();
            this.plugin.refreshReaderViews();
          })
      );

    new Setting(containerEl)
      .setName("当前筛选")
      .setDesc("也可以随时在唱片模式的排序菜单里切换。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "全部书籍")
          .addOption("curated", "只看收藏（自动补足）")
          .addOption("strict", "只看收藏（严格）")
          .setValue(this.plugin.settings.shelfFilter || "all")
          .onChange(async (value) => {
            this.plugin.settings.shelfFilter = value as typeof this.plugin.settings.shelfFilter;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl).setName("字段映射").setHeading();

    const field = (
      name: string,
      desc: string,
      key: FieldKey
    ) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((text) =>
          text
            .setValue(String(this.plugin.settings[key]))
            .onChange(async (value) => {
              this.plugin.settings[key] = value.trim() || DEFAULT_SETTINGS[key];
              await this.plugin.saveSettings();
            })
        );
    };

    field("封面字段", "frontmatter 中存放封面图片路径或网址的字段。", "coverField");
    field("作者字段", "frontmatter 中存放作者的字段。", "authorField");
    field("状态字段", "值为 在读 / 已读 / 想读（也支持 reading、finished 等写法）。", "statusField");
    field("进度字段", "支持 45、45%、0.45 三种写法。", "progressField");
    field("评分字段", "0 到 5 的数字，用于排序。", "ratingField");
    field("笔记数字段", "摘录或笔记数量，用于顶部统计。", "highlightsField");
    field("最近阅读字段", "用于排序和「最近阅读」显示；留空时使用文件修改时间。", "lastReadField");

    new Setting(containerEl).setName("AI 阅析").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Key 每台设备填一次即可，之后会自动使用。只发送书名、作者、标签，不上传笔记正文。",
    });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("例如 https://api.deepseek.com/v1 或 https://api.openai.com/v1。")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com/v1")
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value.trim() || "https://api.deepseek.com/v1";
            await this.plugin.saveSettings();
          })
      );

    let aiKeySaveTimer: number | null = null;
    new Setting(containerEl)
      .setName("API Key")
      .setDesc(
        "每台设备第一次使用时填一次，之后打开会自动使用。Key 只留在这台设备，换设备需要重新填写。"
      )
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.aiApiKey)
          .onChange(async (value) => {
            const key = value.trim();
            this.plugin.settings.aiApiKey = key;
            await this.plugin.saveSettings();
            if (aiKeySaveTimer !== null) window.clearTimeout(aiKeySaveTimer);
            aiKeySaveTimer = window.setTimeout(() => {
              aiKeySaveTimer = null;
              new Notice(
                key
                  ? "已保存。Key 只留在这台设备，换设备需要重新填写。"
                  : "已清除 API Key。之后需要重新填写才能使用 AI 阅析。",
                6000
              );
            }, 1200);
          })
      )
      .addButton((button) =>
        button.setButtonText("从 Copilot 导入").onClick(async () => {
          if (await this.plugin.importAiFromCopilot()) this.display();
        })
      );

    const modulesSetting = new Setting(containerEl)
      .setName("分析内容")
      .setDesc("勾选要出现在「数据」页里的模块，默认全选。");
    modulesSetting.settingEl.addClass("abs-modules-setting");
    const moduleChips = modulesSetting.infoEl.createDiv({ cls: "abs-modules-chips" });
    const enabledModules = new Set(
      this.plugin.settings.aiModules?.length
        ? this.plugin.settings.aiModules
        : AI_MODULES.map((item) => item.id)
    );
    for (const module of AI_MODULES) {
      const chip = moduleChips.createEl("button", { cls: "abs-fav-chip", text: module.label });
      chip.setAttribute("title", module.desc);
      if (enabledModules.has(module.id)) chip.addClass("is-on");
      chip.addEventListener("click", async () => {
        const next = new Set(enabledModules);
        if (next.has(module.id)) next.delete(module.id);
        else next.add(module.id);
        enabledModules.clear();
        next.forEach((id) => enabledModules.add(id));
        chip.toggleClass("is-on", next.has(module.id));
        this.plugin.settings.aiModules = [...next];
        await this.plugin.saveSettings();
      });
    }

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("填好 Base URL 和 API Key 后点一下，会拉取这个接口支持的模型列表。")
      .addButton((button) =>
        button.setButtonText("测试并获取模型").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          const result = await this.plugin.fetchAiModels();
          button.setDisabled(false);
          button.setButtonText("测试并获取模型");
          if (result.ok) {
            new Notice(`连接成功，拿到 ${result.models.length} 个模型`);
            this.display();
          } else {
            new Notice(`连接失败：${result.error ?? "未知错误"}`);
          }
        })
      );

    const modelOptions = this.plugin.settings.aiModels ?? [];
    const modelSetting = new Setting(containerEl).setName("模型");

    if (modelOptions.length > 0) {
      modelSetting.setDesc(`已从接口获取 ${modelOptions.length} 个模型，直接选。`);
      modelSetting.addDropdown((dropdown) => {
        for (const model of modelOptions) {
          dropdown.addOption(model, model);
        }
        dropdown
          .setValue(this.plugin.settings.aiModel || modelOptions[0])
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value;
            await this.plugin.saveSettings();
          });
      });
    } else {
      modelSetting.setDesc("先点上面的「测试并获取模型」；没测试时也可以手动填写。");
      modelSetting.addText((text) =>
        text
          .setPlaceholder("deepseek-chat")
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value.trim() || "deepseek-chat";
            await this.plugin.saveSettings();
          })
      );
    }

    new Setting(containerEl)
      .setName("AI画像文件夹")
      .setDesc("AI 阅析生成的画像笔记存放位置。")
      .addText((text) =>
        text
          .setPlaceholder("OmniBooks/阅读")
          .setValue(this.plugin.settings.profileDir || "OmniBooks/阅读")
          .onChange(async (value) => {
            this.plugin.settings.profileDir =
              value.trim() || DEFAULT_SETTINGS.profileDir;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI分享图文件夹")
      .setDesc("阅读画像分享图的保存位置。")
      .addText((text) =>
        text
          .setPlaceholder("OmniBooks/阅读")
          .setValue(this.plugin.settings.shareDir || "OmniBooks/阅读")
          .onChange(async (value) => {
            this.plugin.settings.shareDir =
              value.trim() || DEFAULT_SETTINGS.shareDir;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("微信读书同步").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "使用微信读书 API Key（wrk- 开头）调用官方 Agent 接口。手机端可以直接同步，不需要 Mac。",
    });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc(
        "扫码获取后粘贴到这里；也可以直接从已安装的 Weread 插件导入。每台设备第一次使用时填一次，之后自动使用；Key 只保存在当前设备的插件设置里。"
      )
      .addText((text) =>
        text
          .setPlaceholder("wrk-...")
          .setValue(this.plugin.settings.wereadApiKey)
          .onChange(async (value) => {
            this.plugin.settings.wereadApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .addButton((button) =>
        button.setButtonText("从 Weread 导入").onClick(async () => {
          if (await this.plugin.importWereadKey()) this.display();
        })
      );

    const currentWereadKey = this.plugin.settings.wereadApiKey;
    new Setting(containerEl)
      .setName("微信读书账号")
      .setDesc(
        currentWereadKey
          ? `已连接 · ${currentWereadKey.slice(0, 6)}…${currentWereadKey.slice(-4)}`
          : "未连接。可以扫码登录，或从 Weread 插件导入 Key。"
      )
      .addButton((button) =>
        button.setButtonText("更换账号").onClick(async () => {
          await this.plugin.switchWereadAccount();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("获取 API Key")
      .setDesc("桌面端会打开扫码窗口，登录后自动填入；手机端会打开官方页面手动复制。")
      .addButton((button) =>
        button.setButtonText("扫码获取").onClick(async () => {
          await this.plugin.startWereadQrLogin();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("接口地址")
      .setDesc("一般不用改。接口失效时填入镜像或代理地址；留空使用默认，默认失败会自动回退。")
      .addText((text) =>
        text
          .setPlaceholder(WEREAD_GATEWAY)
          .setValue(this.plugin.settings.wereadGateway || "")
          .onChange(async (value) => {
            this.plugin.settings.wereadGateway = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("备份方式")
      .setDesc("同步前把微信读书笔记备份到库内隐藏文件夹，默认只备份会被改写的旧版本。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("off", "关闭备份")
          .addOption("changed", "只备份被改写的旧版本（推荐）")
          .addOption("sync", "每次同步前完整备份")
          .addOption("daily", "每天首次同步完整备份")
          .setValue(this.plugin.settings.wereadBackupMode ?? "changed")
          .onChange(async (value) => {
            this.plugin.settings.wereadBackupMode =
              value as typeof this.plugin.settings.wereadBackupMode;
            await this.plugin.saveSettings();
          })
      );

    const backupHint = containerEl.createDiv({ cls: "abs-backup-hint" });
    for (const [name, text] of [
      ["关闭备份", "不备份，覆盖或删除直接生效。适合已经用 Git / 时间机器备份 vault 的情况。"],
      ["只备份被改写的旧版本", "某篇笔记即将被覆盖或删除时，只保存那一篇的旧内容。日常最省空间。"],
      ["每次同步前完整备份", "每次同步开始前复制整个微信读书文件夹，没有改动也会多一份。"],
      ["每天首次完整备份", "当天第一次同步前复制全部笔记；同一天多次同步不会重复占空间。"],
    ]) {
      const row = backupHint.createDiv({ cls: "abs-backup-hint-row" });
      row.createSpan({ cls: "abs-backup-hint-name", text: `${name}：` });
      row.createSpan({ cls: "abs-backup-hint-text", text: text });
    }

    new Setting(containerEl)
      .setName("备份文件夹")
      .setDesc("库内相对路径；点开头的文件夹不会显示在文件管理器里。")
      .addText((text) =>
        text
          .setPlaceholder(".omnibooks-backup/weread")
          .setValue(
            this.plugin.settings.wereadBackupDir || ".omnibooks-backup/weread"
          )
          .onChange(async (value) => {
            this.plugin.settings.wereadBackupDir =
              value.trim() || ".omnibooks-backup/weread";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("保留份数")
      .setDesc("超过份数时自动删除最早的备份。")
      .addSlider((slider) =>
        slider
          .setLimits(1, 20, 1)
          .setValue(this.plugin.settings.wereadBackupKeep ?? 5)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.wereadBackupKeep = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("同步微信读书")
      .setDesc("关闭后书架里的同步按钮只更新苹果图书。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.wereadEnabled).onChange(async (value) => {
          this.plugin.settings.wereadEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("微信读书笔记文件夹")
      .setDesc("微信读书同步生成的笔记存放位置（库内相对路径）。")
      .addText((text) =>
        text
          .setPlaceholder("微信读书")
          .setValue(this.plugin.settings.wereadOutputDir)
          .onChange(async (value) => {
            this.plugin.settings.wereadOutputDir =
              value.trim() || DEFAULT_SETTINGS.wereadOutputDir;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("苹果图书同步").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "苹果图书首次同步需要在 Mac 上完成。之后桌面端直接读取数据库；平板/手机点同步会把请求写入同步文件夹，由同一 iCloud 库里的 Mac 执行。Mac 没开时请求会排队。Mac 端需要保持 Obsidian 运行，并给 Obsidian 完全磁盘访问权限。微信读书同步不依赖 Mac。",
    });

    const appleStatus = this.appleBooksStatus();
    const appleStatusSetting = new Setting(containerEl)
      .setName("当前状态")
      .setDesc(`${appleStatus.label} · ${appleStatus.detail}`);
    if (appleStatus.action === "permission") {
      appleStatusSetting.addButton((button) =>
        button.setButtonText("打开权限设置").onClick(() => {
          openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
        })
      );
    }
    if (appleStatus.action === "openBooks") {
      appleStatusSetting.addButton((button) =>
        button.setButtonText("打开「图书」").onClick(() => {
          openExternal("ibooks://");
        })
      );
    }
    appleStatusSetting.addButton((button) =>
      button.setButtonText("重新检查").onClick(() => this.display())
    );

    if (appleStatus.action === "permission") {
      const guide = containerEl.createDiv({ cls: "abs-permission-guide" });
      const steps: Array<{ icon: string; title: string; desc: string }> = [
        {
          icon: "settings",
          title: "打开系统设置",
          desc: "点左上角苹果菜单 → 系统设置。",
        },
        {
          icon: "shield",
          title: "进入隐私与安全性",
          desc: "在左侧列表中找到「隐私与安全性」。",
        },
        {
          icon: "folder-check",
          title: "勾选 Obsidian",
          desc: "在「完全磁盘访问权限」里勾选 Obsidian；列表里没有就点 + 从「应用程序」添加。",
        },
      ];
      steps.forEach((step, index) => {
        const row = guide.createDiv({ cls: "abs-permission-step" });
        row.createDiv({ cls: "abs-permission-num", text: String(index + 1) });
        const icon = row.createDiv({ cls: "abs-permission-icon" });
        setIcon(icon, step.icon);
        const body = row.createDiv({ cls: "abs-permission-body" });
        body.createDiv({ cls: "abs-permission-title", text: step.title });
        body.createDiv({ cls: "abs-permission-desc", text: step.desc });
      });
      guide.createDiv({
        cls: "abs-permission-note",
        text: "勾选后完全退出 Obsidian（Command + Q），再重新打开，然后点「重新检查」。",
      });
    }

    new Setting(containerEl)
      .setName("显示同步按钮")
      .setDesc("在书架工具栏显示「更新苹果图书」按钮。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.syncEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("同步请求文件夹")
      .setDesc("手机与 Mac 之间的中转文件夹，会随 iCloud 自动同步。一般不需要改。")
      .addText((text) =>
        text
          .setPlaceholder(".apple-books-sync")
          .setValue(this.plugin.settings.syncBridgeDir)
          .onChange(async (value) => {
            this.plugin.settings.syncBridgeDir = value.trim() || DEFAULT_SETTINGS.syncBridgeDir;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动同步间隔（分钟）")
      .setDesc("Mac 端每隔多少分钟自动抓取一次苹果图书，填 0 关闭；修改后重启 Obsidian 生效。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const minutes = Number(value);
            this.plugin.settings.syncIntervalMinutes =
              Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("图标").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "侧边栏和标签页使用的图标，默认「无尽知识」。",
    });

    const picker = containerEl.createDiv({ cls: "abs-icon-picker" });
    for (const option of ICON_OPTIONS) {
      const item = picker.createDiv({ cls: "abs-icon-choice" });
      if ((this.plugin.settings.iconStyle || DEFAULT_ICON_ID) === option.id) {
        item.addClass("is-selected");
      }
      const preview = item.createDiv({ cls: "abs-icon-preview" });
      setIcon(preview, iconId(option.id));
      item.createDiv({ cls: "abs-icon-name", text: option.name });
      item.createDiv({ cls: "abs-icon-group", text: option.group });
      item.addEventListener("click", async () => {
        this.plugin.settings.iconStyle = option.id;
        await this.plugin.saveSettings();
        this.plugin.applyIcon();
        picker.querySelectorAll(".abs-icon-choice").forEach((el) => el.removeClass("is-selected"));
        item.addClass("is-selected");
      });
    }

    new Setting(containerEl)
      .setName("图标大小")
      .setDesc("侧边栏图标尺寸，默认 22px。")
      .addSlider((slider) =>
        slider
          .setLimits(16, 30, 1)
          .setValue(this.plugin.settings.ribbonIconSize || 22)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.ribbonIconSize = value;
            this.plugin.applyIconVars();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("反馈").setHeading();
    const feedback = containerEl.createDiv({ cls: "abs-feedback-card" });
    const feedbackBody = feedback.createDiv({ cls: "abs-feedback-body" });
    feedbackBody.createDiv({ cls: "abs-feedback-title", text: "GitHub Issues" });
    feedbackBody.createDiv({
      cls: "abs-feedback-desc",
      text: "报告问题、提功能建议，或查看作者主页。",
    });

    const feedbackActions = feedback.createDiv({ cls: "abs-feedback-actions" });
    const feedbackButtons: Array<[string, string]> = [
      ["报告问题", this.plugin.feedbackIssueUrl()],
      ["功能建议", this.plugin.feedbackIssueUrl("enhancement")],
      ["作者主页", this.plugin.feedbackAuthorUrl()],
    ];
    for (const [label, url] of feedbackButtons) {
      const button = feedbackActions.createEl("button", {
        cls: "abs-feedback-btn",
        text: label,
      });
      button.addEventListener("click", () => openExternal(url));
    }

    new Setting(containerEl).setName("更多书源").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "目前支持苹果图书和微信读书。Kindle、KOReader、Readwise、Calibre 以及本地 EPUB / PDF 的划线导入还在计划中，做好一个加一个。",
    });

    this.groupSections(containerEl);

    const supportHeading = new Setting(containerEl)
      .setName("支持 / Sponsor")
      .setHeading();
    supportHeading.settingEl.addClass("abs-support-heading");
    const support = containerEl.createDiv({
      cls: "abs-feedback-card abs-support-card",
    });
    const supportBody = support.createDiv({ cls: "abs-feedback-body" });
    supportBody.createDiv({ cls: "abs-feedback-title", text: "请作者喝杯咖啡" });
    supportBody.createDiv({
      cls: "abs-feedback-desc",
      text: "如果 OmniBooks 对你有帮助，欢迎支持后续开发。",
    });
    const supportActions = support.createDiv({ cls: "abs-feedback-actions" });
    const supportBtn = supportActions.createEl("button", {
      cls: "abs-feedback-btn abs-support-btn",
    });
    setIcon(supportBtn.createSpan({ cls: "abs-support-icon" }), "heart");
    supportBtn.createSpan({ text: "支持作者" });
    supportBtn.addEventListener("click", () => {
      openExternal("https://afdian.com/a/tack123/plan");
    });
  }

  private groupSections(containerEl: HTMLElement): void {
    const hints: Record<string, string> = {
      显示: "封面、布局、排序、文件夹",
      收藏: "收藏来源、金句文件",
      字段映射: "7 个 frontmatter 字段",
      "AI 阅析": "服务商、Key、分析模块、存储",
      微信读书同步: "Key、接口、备份",
      苹果图书同步: "权限、同步按钮、中转文件夹",
      图标: "侧边栏图标与大小",
      反馈: "GitHub Issues",
      更多书源: "计划中的来源",
    };

    const children = Array.from(containerEl.children);
    let current: { title: string; nodes: HTMLElement[] } | null = null;
    const sections: Array<{ title: string; nodes: HTMLElement[] }> = [];

    for (const child of children) {
      const heading =
        child.classList.contains("setting-item-heading") ||
        child.tagName === "H3";
      if (heading) {
        if (current) sections.push(current);
        const title =
          child.querySelector(".setting-item-name")?.textContent?.trim() ??
          child.textContent?.trim() ??
          "";
        current = { title, nodes: [] };
        child.remove();
        continue;
      }
      if (current) current.nodes.push(child as HTMLElement);
    }
    if (current) sections.push(current);

    const preferred = [
      "AI 阅析",
      "微信读书同步",
      "苹果图书同步",
      "显示",
      "收藏",
      "字段映射",
      "图标",
      "反馈",
      "更多书源",
    ];
    sections.sort(
      (a, b) =>
        (preferred.indexOf(a.title) + 1 || 999) -
        (preferred.indexOf(b.title) + 1 || 999)
    );

    const wrapper = containerEl.createDiv({ cls: "abs-settings-sections" });

    for (const section of sections) {
      const details = wrapper.createEl("details", {
        cls: "abs-settings-group",
      });
      const summary = details.createEl("summary", {
        cls: "abs-settings-group-summary",
      });
      summary.createSpan({
        cls: "abs-settings-group-title",
        text: section.title,
      });
      const hint = hints[section.title];
      if (hint) {
        summary.createSpan({ cls: "abs-settings-group-hint", text: hint });
      }
      summary.createSpan({ cls: "abs-settings-group-chevron", text: "›" });

      const body = details.createDiv({ cls: "abs-settings-group-body" });
      for (const node of section.nodes) body.appendChild(node);
    }
  }
}
