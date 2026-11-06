import { App, Modal, Notice, Platform, setIcon } from "obsidian";
import { openExternal } from "./external";

export type SetupSource = "apple" | "weread" | "both";

export interface SetupStatus {
  label: string;
  detail: string;
  action?: "permission" | "openBooks";
}

export interface SetupResult {
  source: SetupSource;
  wereadApiKey: string;
  wereadSkipped: boolean;
  appleSkipped: boolean;
}

/** 向导在「正在同步」步骤里回传进度给宿主插件 */
export interface SetupSyncHandlers {
  onProgress: (message: string) => void;
  onBooksReady: () => void;
}

export interface SetupWizardOptions {
  source: SetupSource | null;
  wereadApiKey: string;
  appleStatus: () => SetupStatus;
  onWereadQrLogin: (switchAccount?: boolean) => Promise<string | null>;
  onOpenPermission: () => void;
  onOpenBooks: () => void;
  onSkip: () => void;
  onFinish: (result: SetupResult, sync: SetupSyncHandlers) => Promise<void> | void;
  onOpenShelf: () => void;
}

const WEREAD_KEY_PAGE = "https://weread.qq.com/r/weread-skills";

function appleRequirement(): string {
  if (!Platform.isDesktopApp) {
    return "需要：同一 iCloud 库里的 Mac 先完成首次同步，并保持 Obsidian 运行；Mac 需授予完全磁盘访问权限。";
  }
  if (process.platform !== "darwin") {
    return "需要：macOS 桌面版。其他系统可以手动放入笔记，或改用微信读书。";
  }
  return "需要：macOS「图书」App 已打开过一次；Obsidian 已获完全磁盘访问权限。首次同步会在这台 Mac 上建立书库。";
}

function appleSteps(status: SetupStatus): string[] {
  if (status.label === "需要完全磁盘访问权限") {
    return [
      "点「打开权限设置」，在「完全磁盘访问权限」里勾选 Obsidian；列表里没有就点 + 从「应用程序」添加。",
      "完全退出 Obsidian（Command + Q），再重新打开。",
      "回到这里点「重新检查」。",
    ];
  }
  if (status.label === "未找到图书数据库") {
    return [
      "打开 macOS「图书」，随便翻一本，让它建立数据库。",
      "确认「图书」里已登录 Apple ID，或等 iCloud 同步完成。",
      "回到这里点「重新检查」。",
    ];
  }
  if (status.label === "手机端需 Mac 中转") {
    return [
      "第一次同步需要在 Mac 上完成：在 Mac 的 Obsidian 里打开 OmniBooks，执行一次苹果图书同步。",
      "之后同一 iCloud 库里的平板/手机点同步，会把请求交给正在运行的 Mac。",
      "Mac 需要保持 Obsidian 运行，并授予完全磁盘访问权限。",
    ];
  }
  if (status.label === "当前系统不支持") {
    return ["苹果图书同步仅支持 macOS；其他系统仍可手动放入笔记，或改用微信读书。"];
  }
  return [];
}

const SOURCE_OPTIONS: Array<{
  id: SetupSource;
  name: string;
  desc: string;
  icon: string;
}> = [
  {
    id: "weread",
    name: "微信读书",
    desc: "用 API Key 读取书架、划线与想法。",
    icon: "book",
  },
  {
    id: "apple",
    name: "苹果图书",
    desc: "读取 Mac 本机 Books 数据库与划线。首次同步需要在 Mac 电脑上完成。",
    icon: "book-open",
  },
  {
    id: "both",
    name: "两个都用",
    desc: "两行清单，各自连接，互不影响。",
    icon: "layers",
  },
];

export class SetupWizardModal extends Modal {
  private opts: SetupWizardOptions;
  private step: "source" | "connect" | "syncing" | "done" = "source";
  private source: SetupSource | null;
  private wereadKey: string;
  private skipWeread = false;
  private skipApple = false;
  private qrPending = false;
  private finished = false;
  private saving = false;
  private allowClose = false;
  private showUnfinished = false;
  private syncMessage = "";
  private syncReady = false;
  private enteredShelf = false;
  private syncMessageEl: HTMLElement | null = null;

  constructor(app: App, opts: SetupWizardOptions) {
    super(app);
    this.opts = opts;
    this.source = opts.source ?? null;
    this.wereadKey = opts.wereadApiKey ?? "";
  }

  onOpen(): void {
    this.modalEl.setCssStyles({ width: "min(620px, 94vw)" });
    this.containerEl.addClass("abs-wizard-locked");
    this.modalEl.addClass("abs-wizard-locked");
    this.contentEl.addClass("abs-wizard");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** 点右上角叉号：允许关闭，并记为已完成，之后不再自动弹出 */
  close(): void {
    if (!this.allowClose) {
      this.finished = true;
      this.allowClose = true;
      if (this.step === "syncing") this.enteredShelf = true;
      this.opts.onSkip();
    }
    super.close();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.step === "source") this.renderSource();
    else if (this.step === "connect") this.renderConnect();
    else if (this.step === "syncing") this.renderSyncing();
    else this.renderDone();
  }

  private goSource(): void {
    this.step = "source";
    this.showUnfinished = false;
    this.render();
  }

  private goConnect(source: SetupSource): void {
    this.source = source;
    this.skipWeread = source === "apple";
    this.skipApple = source === "weread";
    this.showUnfinished = false;
    this.step = "connect";
    this.render();
  }

  private wereadReady(): boolean {
    return Boolean(this.wereadKey.trim());
  }

  private appleReady(): boolean {
    return this.opts.appleStatus().label === "可用";
  }

  private unresolvedSources(): string[] {
    const unresolved: string[] = [];
    if (this.source !== "apple" && !this.skipWeread && !this.wereadReady()) {
      unresolved.push("微信读书");
    }
    if (this.source !== "weread" && !this.skipApple && !this.appleReady()) {
      unresolved.push("苹果图书");
    }
    return unresolved;
  }

  private async finish(): Promise<void> {
    if (this.saving) return;
    if (this.source === null) return;
    const unresolved = this.unresolvedSources();
    if (unresolved.length > 0) {
      this.showUnfinished = true;
      this.render();
      new Notice(`还有未完成的书源：${unresolved.join("、")}`);
      return;
    }
    this.finished = true;
    const result: SetupResult = {
      source: this.source,
      wereadApiKey: this.wereadKey.trim(),
      wereadSkipped: this.source === "apple" || this.skipWeread,
      appleSkipped: this.source === "weread" || this.skipApple,
    };
    this.saving = true;
    this.syncMessage = "正在准备同步…";
    this.syncReady = false;
    this.enteredShelf = false;
    this.syncMessageEl = null;
    this.step = "syncing";
    this.render();
    try {
      await this.opts.onFinish(result, {
        onProgress: (message) => {
          this.syncMessage = message;
          if (this.syncMessageEl?.isConnected) {
            this.syncMessageEl.setText(message);
          } else if (this.contentEl.isConnected && this.step === "syncing") {
            this.render();
          }
        },
        onBooksReady: () => {
          if (this.syncReady) return;
          this.syncReady = true;
          if (this.contentEl.isConnected && this.step === "syncing") this.render();
        },
      });
      this.showUnfinished = false;
      this.allowClose = true;
      this.containerEl.removeClass("abs-wizard-locked");
      this.modalEl.removeClass("abs-wizard-locked");
      if (this.source === "both") {
        this.step = "done";
        this.render();
      } else {
        const shouldOpen = !this.enteredShelf;
        this.close();
        if (shouldOpen) this.opts.onOpenShelf();
      }
    } catch (error) {
      this.finished = false;
      this.step = "connect";
      this.allowClose = false;
      this.containerEl.addClass("abs-wizard-locked");
      this.modalEl.addClass("abs-wizard-locked");
      this.render();
      new Notice(
        `保存设置失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.saving = false;
    }
  }

  private enterShelfEarly(): void {
    this.enteredShelf = true;
    this.allowClose = true;
    this.close();
    this.opts.onOpenShelf();
  }

  private skipAll(): void {
    this.finished = true;
    this.allowClose = true;
    this.opts.onSkip();
    this.close();
  }

  private closeDone(): void {
    this.allowClose = true;
    this.close();
  }

  private renderSource(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "欢迎使用 OmniBooks" });
    contentEl.createEl("p", {
      cls: "abs-wizard-intro",
      text: "先选书从哪里来。之后可以在设置里随时加上另一个。",
    });

    const list = contentEl.createDiv({ cls: "abs-wizard-sources" });
    const cards: HTMLElement[] = [];
    for (const option of SOURCE_OPTIONS) {
      const card = list.createDiv({ cls: "abs-wizard-source" });
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      if (this.source === option.id) card.addClass("is-selected");

      const icon = card.createDiv({ cls: "abs-wizard-source-icon" });
      setIcon(icon, option.icon);

      const body = card.createDiv({ cls: "abs-wizard-source-body" });
      body.createDiv({ cls: "abs-wizard-source-name", text: option.name });
      body.createDiv({ cls: "abs-wizard-source-desc", text: option.desc });

      const choose = () => this.goConnect(option.id);
      card.addEventListener("click", choose);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });
      cards.push(card);
    }

    // 默认把焦点和高亮放在「两个都用」；已有选择时跟随已有选择。
    const selectedIndex = SOURCE_OPTIONS.findIndex(
      (option) => option.id === this.source
    );
    const preferredIndex = SOURCE_OPTIONS.findIndex(
      (option) => option.id === "both"
    );
    const focusIndex =
      selectedIndex >= 0 ? selectedIndex : preferredIndex >= 0 ? preferredIndex : 0;
    const target = cards[focusIndex];
    if (!this.source && target) target.addClass("is-selected");
    if (target) {
      window.setTimeout(() => target.focus({ preventScroll: true }), 0);
    }

    contentEl.createEl("p", {
      cls: "abs-wizard-note",
      text: "这个向导只在首次安装时出现一次，之后可以在 设置 → OmniBooks 里重新打开。",
    });
    contentEl.createEl("p", {
      cls: "abs-wizard-note",
      text: "更多来源陆续加入：Kindle、KOReader、Readwise、本地 EPUB / PDF。",
    });

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    const skip = footer.createEl("button", {
      cls: "abs-wizard-btn is-quiet",
      text: "跳过安装",
    });
    skip.addEventListener("click", () => this.skipAll());
  }

  private renderConnect(): void {
    const { contentEl } = this;
    const both = this.source === "both";

    contentEl.createEl("h2", { text: "连接书源" });
    contentEl.createEl("p", {
      cls: "abs-wizard-intro",
      text: both
        ? "两个书源都可以先跳过。只有都连上或跳过后，才能点「完成」。"
        : "按下面的提示连上，或跳过这个书源。之后可以在设置里改。",
    });

    const rows = contentEl.createDiv({ cls: "abs-wizard-rows" });
    if (this.source !== "apple") this.renderWereadRow(rows);
    if (this.source !== "weread") this.renderAppleRow(rows);

    const unresolved = this.unresolvedSources();
    if (unresolved.length > 0) {
      contentEl.createDiv({
        cls: "abs-wizard-hint",
        text: `还差：${unresolved.join("、")}。完成后才能点「完成」；暂时不用的一项可以点「跳过这个书源」。`,
      });
    }

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    if (both) {
      const back = footer.createEl("button", { cls: "abs-wizard-btn", text: "上一步" });
      back.addEventListener("click", () => this.goSource());
    }

    const skip = footer.createEl("button", {
      cls: "abs-wizard-btn is-quiet",
      text: "跳过全部",
    });
    skip.addEventListener("click", () => this.skipAll());

    const start = footer.createEl("button", {
      cls: "abs-wizard-btn mod-cta",
      text: "完成",
    });
    start.addEventListener("click", () => {
      void this.finish();
    });
  }

  private renderWereadRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "abs-wizard-row" });
    if (this.skipWeread) row.addClass("is-skipped");
    if (this.showUnfinished && !this.skipWeread && !this.wereadReady()) {
      row.addClass("is-unfinished");
    }

    const head = row.createDiv({ cls: "abs-wizard-row-head" });
    const icon = head.createDiv({ cls: "abs-wizard-row-icon" });
    setIcon(icon, "book");
    head.createEl("span", { cls: "abs-wizard-row-title", text: "微信读书" });

    const status = head.createEl("span", { cls: "abs-wizard-status" });
    const paintStatus = () => {
      const hasKey = this.wereadReady();
      status.setText(
        this.skipWeread ? "已跳过" : hasKey ? "已连接" : "待填写 Key"
      );
      status.toggleClass("is-ok", !this.skipWeread && hasKey);
      status.toggleClass("is-muted", this.skipWeread || !hasKey);
    };
    paintStatus();

    row.createEl("p", {
      cls: "abs-wizard-row-desc",
      text: "API Key 只保存在本机。桌面端可以扫码自动获取，手机端请打开网页复制。",
    });

    const actions = row.createDiv({ cls: "abs-wizard-row-actions" });
    const input = actions.createEl("input", {
      type: "password",
      cls: "abs-wizard-key-input",
      placeholder: "粘贴 API Key",
    });
    input.value = this.wereadKey;
    input.addEventListener("input", () => {
      this.wereadKey = input.value;
      paintStatus();
    });

    const qr = actions.createEl("button", { cls: "abs-wizard-btn", text: "扫码获取" });
    const swap = this.wereadReady()
      ? actions.createEl("button", { cls: "abs-wizard-btn", text: "更换账号" })
      : null;

    const beginQr = (switchAccount: boolean) => {
      void (async () => {
        if (this.qrPending) return;
        this.qrPending = true;
        qr.disabled = true;
        qr.setText(switchAccount ? "等待重新登录…" : "等待扫码…");
        if (swap) swap.disabled = true;
        if (switchAccount) this.wereadKey = "";
        const key = await this.opts.onWereadQrLogin(switchAccount);
        this.qrPending = false;
        if (!this.contentEl.isConnected) return;
        if (key) {
          this.wereadKey = key;
          this.skipWeread = false;
          this.showUnfinished = false;
          this.render();
          new Notice("微信读书已连接");
          return;
        }
        qr.disabled = false;
        qr.setText("扫码获取");
        if (swap) swap.disabled = false;
        if (switchAccount) this.render();
      })();
    };

    qr.addEventListener("click", () => beginQr(false));
    swap?.addEventListener("click", () => beginQr(true));

    const link = actions.createEl("button", {
      cls: "abs-wizard-link",
      text: "打开微信读书获取 Key",
    });
    link.addEventListener("click", () => {
      openExternal(WEREAD_KEY_PAGE);
    });

    row.createDiv({
      cls: "abs-wizard-req",
      text: "需要：微信读书账号。同步时报「无效 Key」时，重新扫码或重新粘贴一次。",
    });

    const skipRow = row.createDiv({ cls: "abs-wizard-row-actions" });
    const skip = skipRow.createEl("button", {
      cls: "abs-wizard-btn is-quiet",
      text: this.skipWeread ? "恢复这一项" : "跳过这个书源",
    });
    skip.addEventListener("click", () => {
      this.skipWeread = !this.skipWeread;
      this.showUnfinished = false;
      this.render();
    });

    input.disabled = this.skipWeread;
    qr.disabled = this.skipWeread;
    link.disabled = this.skipWeread;
  }

  private renderAppleRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "abs-wizard-row" });
    if (this.skipApple) row.addClass("is-skipped");

    const status = this.opts.appleStatus();
    const ready = status.label === "可用";
    if (this.showUnfinished && !this.skipApple && !ready) {
      row.addClass("is-unfinished");
    }

    const head = row.createDiv({ cls: "abs-wizard-row-head" });
    const icon = head.createDiv({ cls: "abs-wizard-row-icon" });
    setIcon(icon, "book-open");
    head.createEl("span", { cls: "abs-wizard-row-title", text: "苹果图书" });

    const pill = head.createEl("span", { cls: "abs-wizard-status" });
    const paintStatus = () => {
      pill.setText(
        this.skipApple ? "已跳过" : ready ? "已连接" : status.label
      );
      pill.toggleClass("is-ok", !this.skipApple && ready);
      pill.toggleClass("is-warn", !this.skipApple && status.action === "permission");
      pill.toggleClass(
        "is-muted",
        this.skipApple || (!status.action && !ready)
      );
    };
    paintStatus();

    row.createEl("p", { cls: "abs-wizard-row-desc", text: status.detail });
    if (Platform.isMobile) {
      row.createEl("p", {
        cls: "abs-wizard-note",
        text: "苹果图书由 Mac 代读；微信读书可直接在本机同步。Mac 没开时，苹果图书请求会排队。",
      });
    }

    const actions = row.createDiv({ cls: "abs-wizard-row-actions" });
    const buttons: HTMLButtonElement[] = [];

    if (status.action === "permission") {
      const button = actions.createEl("button", {
        cls: "abs-wizard-btn",
        text: "打开权限设置",
      });
      button.addEventListener("click", () => this.opts.onOpenPermission());
      buttons.push(button);
    }

    if (status.action === "openBooks") {
      const button = actions.createEl("button", { cls: "abs-wizard-btn", text: "打开「图书」" });
      button.addEventListener("click", () => this.opts.onOpenBooks());
      buttons.push(button);
    }

    const recheck = actions.createEl("button", { cls: "abs-wizard-btn", text: "重新检查" });
    recheck.addEventListener("click", () => {
      this.showUnfinished = false;
      this.render();
    });
    buttons.push(recheck);

    if (!this.skipApple) {
      row.createDiv({ cls: "abs-wizard-req", text: appleRequirement() });

      const steps = appleSteps(status);
      if (steps.length > 0) {
        row.createDiv({ cls: "abs-wizard-req-title", text: "怎么解决" });
        const list = row.createEl("ul", { cls: "abs-wizard-steps" });
        for (const step of steps) list.createEl("li", { text: step });
      }
    }

    const skipRow = row.createDiv({ cls: "abs-wizard-row-actions" });
    const skip = skipRow.createEl("button", {
      cls: "abs-wizard-btn is-quiet",
      text: this.skipApple ? "恢复这一项" : "跳过这个书源",
    });
    skip.addEventListener("click", () => {
      this.skipApple = !this.skipApple;
      this.showUnfinished = false;
      this.render();
    });

    for (const button of buttons) button.disabled = this.skipApple;
  }

  private renderSyncing(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "正在同步" });
    contentEl.createEl("p", {
      cls: "abs-wizard-intro",
      text:
        this.source === "both"
          ? "两个书源正在导入。先导入一部分书就可以进入书架，剩下的会在后台继续。"
          : "正在导入你的书。先导入一部分就可以进入书架，剩下的会在后台继续。",
    });

    const progress = contentEl.createDiv({ cls: "abs-wizard-progress" });
    progress.createDiv({ cls: "abs-wizard-progress-fill" });

    this.syncMessageEl = contentEl.createDiv({
      cls: "abs-wizard-progress-text",
      text: this.syncMessage || "正在准备同步…",
    });

    contentEl.createDiv({
      cls: "abs-wizard-note",
      text: this.syncReady
        ? "已经有一部分书了，可以先进书架；同步完成后会自动提醒。"
        : "导入到一部分书后会出现「进入书架」按钮，不用等全部完成。",
    });

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    const enter = footer.createEl("button", {
      cls: "abs-wizard-btn mod-cta",
      text: this.syncReady ? "进入书架" : "等待导入…",
    });
    enter.disabled = !this.syncReady;
    enter.addEventListener("click", () => {
      if (!this.syncReady) return;
      this.enterShelfEarly();
    });
  }

  private renderDone(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "设置完成" });
    contentEl.createEl("p", {
      cls: "abs-wizard-intro",
      text: "打开书架就能看到已同步的书。第一次同步需要一点时间。",
    });

    const list = contentEl.createDiv({ cls: "abs-wizard-done-list" });
    if (this.source !== "apple") {
      list.createDiv({
        cls: "abs-wizard-done-row",
        text: this.skipWeread
          ? "微信读书：已跳过"
          : this.wereadReady()
            ? "微信读书：已连接"
            : "微信读书：还没填 Key，书源不会同步",
      });
    }
    if (this.source !== "weread") {
      const status = this.opts.appleStatus();
      list.createDiv({
        cls: "abs-wizard-done-row",
        text: this.skipApple
          ? "苹果图书：已跳过"
          : `苹果图书：${status.label === "可用" ? "已连接" : status.label}`,
      });
    }

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    const close = footer.createEl("button", { cls: "abs-wizard-btn", text: "关闭" });
    close.addEventListener("click", () => this.closeDone());

    const open = footer.createEl("button", {
      cls: "abs-wizard-btn mod-cta",
      text: "打开书架",
    });
    open.addEventListener("click", () => {
      this.allowClose = true;
      this.close();
      this.opts.onOpenShelf();
    });
  }
}
