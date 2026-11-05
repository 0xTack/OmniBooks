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

export interface SetupWizardOptions {
  source: SetupSource | null;
  wereadApiKey: string;
  appleStatus: () => SetupStatus;
  onWereadQrLogin: () => Promise<string | null>;
  onOpenPermission: () => void;
  onOpenBooks: () => void;
  onDismiss: () => void;
  onFinish: (result: SetupResult) => Promise<void> | void;
  onOpenShelf: () => void;
}

const WEREAD_KEY_PAGE = "https://weread.qq.com/r/weread-skills";

function appleRequirement(): string {
  if (!Platform.isDesktopApp) {
    return "需要：同一 iCloud 库里的 Mac 保持 Obsidian 运行，并授予完全磁盘访问权限。";
  }
  if (process.platform !== "darwin") {
    return "需要：macOS 桌面版。其他系统可以手动放入笔记，或改用微信读书。";
  }
  return "需要：macOS「图书」App 已打开过一次；Obsidian 已获完全磁盘访问权限。";
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
      "在同一 iCloud 库里的 Mac 上安装并启用 OmniBooks。",
      "Mac 保持 Obsidian 运行，并授予完全磁盘访问权限。",
      "手机点同步会写入请求，由 Mac 执行。",
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
    id: "apple",
    name: "苹果图书",
    desc: "读取本机 Books 数据库与划线。需要完全磁盘访问权限。",
    icon: "book-open",
  },
  {
    id: "weread",
    name: "微信读书",
    desc: "用 API Key 读取书架、划线与想法。",
    icon: "book",
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
  private step: "source" | "connect" | "done" = "source";
  private source: SetupSource | null;
  private wereadKey: string;
  private skipWeread = false;
  private skipApple = false;
  private qrPending = false;
  private finished = false;

  constructor(app: App, opts: SetupWizardOptions) {
    super(app);
    this.opts = opts;
    this.source = opts.source ?? null;
    this.wereadKey = opts.wereadApiKey ?? "";
  }

  onOpen(): void {
    this.modalEl.style.width = "min(620px, 94vw)";
    this.contentEl.addClass("abs-wizard");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.finished) this.opts.onDismiss();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.step === "source") this.renderSource();
    else if (this.step === "connect") this.renderConnect();
    else this.renderDone();
  }

  private goSource(): void {
    this.step = "source";
    this.render();
  }

  private goConnect(source: SetupSource): void {
    this.source = source;
    this.skipWeread = source === "apple";
    this.skipApple = source === "weread";
    this.step = "connect";
    this.render();
  }

  private async finish(): Promise<void> {
    if (this.source === null) return;
    this.finished = true;
    const result: SetupResult = {
      source: this.source,
      wereadApiKey: this.wereadKey.trim(),
      wereadSkipped: this.source === "apple" || this.skipWeread,
      appleSkipped: this.source === "weread" || this.skipApple,
    };
    await this.opts.onFinish(result);
    this.step = "done";
    this.render();
  }

  private renderSource(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "欢迎使用 OmniBooks" });
    contentEl.createEl("p", {
      cls: "abs-wizard-intro",
      text: "先选书从哪里来。之后可以在设置里随时加上另一个。",
    });

    const list = contentEl.createDiv({ cls: "abs-wizard-sources" });
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
    }

    contentEl.createEl("p", {
      cls: "abs-wizard-note",
      text: "更多来源陆续加入：Kindle、KOReader、Readwise、本地 EPUB / PDF。",
    });

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    const skip = footer.createEl("button", {
      cls: "abs-wizard-btn is-quiet",
      text: "稍后再说",
    });
    skip.addEventListener("click", () => this.close());
  }

  private renderConnect(): void {
    const { contentEl } = this;
    const both = this.source === "both";

    contentEl.createEl("h2", { text: "连接书源" });
    contentEl.createEl("p", {
      cls: "abs-wizard-intro",
      text: both ? "两行独立，任意一行都可以先跳过。" : "按下面的提示连上就能用。之后可以在设置里改。",
    });

    const rows = contentEl.createDiv({ cls: "abs-wizard-rows" });
    if (this.source !== "apple") this.renderWereadRow(rows);
    if (this.source !== "weread") this.renderAppleRow(rows);

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    const back = footer.createEl("button", { cls: "abs-wizard-btn", text: "上一步" });
    back.addEventListener("click", () => this.goSource());

    const start = footer.createEl("button", {
      cls: "abs-wizard-btn mod-cta",
      text: "开始使用",
    });
    start.addEventListener("click", () => {
      void this.finish();
    });
  }

  private renderWereadRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "abs-wizard-row" });
    if (this.skipWeread) row.addClass("is-skipped");

    const head = row.createDiv({ cls: "abs-wizard-row-head" });
    const icon = head.createDiv({ cls: "abs-wizard-row-icon" });
    setIcon(icon, "book");
    head.createEl("span", { cls: "abs-wizard-row-title", text: "微信读书" });

    const status = head.createEl("span", { cls: "abs-wizard-status" });
    const paintStatus = () => {
      const hasKey = Boolean(this.wereadKey.trim());
      status.setText(this.skipWeread ? "已跳过" : hasKey ? "已填写 Key" : "未填写 Key");
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
    qr.addEventListener("click", () => {
      void (async () => {
        if (this.qrPending) return;
        this.qrPending = true;
        qr.disabled = true;
        qr.setText("等待扫码…");
        const key = await this.opts.onWereadQrLogin();
        this.qrPending = false;
        if (!this.contentEl.isConnected) return;
        if (key) {
          this.wereadKey = key;
          this.skipWeread = false;
          this.render();
          new Notice("微信读书已连接");
          return;
        }
        qr.disabled = false;
        qr.setText("扫码获取");
      })();
    });

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

    const toggle = row.createEl("label", { cls: "abs-wizard-skip" });
    const checkbox = toggle.createEl("input", { type: "checkbox" });
    checkbox.checked = this.skipWeread;
    toggle.createSpan({ text: "暂时跳过，稍后在设置里添加" });
    checkbox.addEventListener("change", () => {
      this.skipWeread = checkbox.checked;
      row.toggleClass("is-skipped", this.skipWeread);
      input.disabled = this.skipWeread;
      qr.disabled = this.skipWeread;
      link.disabled = this.skipWeread;
      paintStatus();
    });
    input.disabled = this.skipWeread;
    qr.disabled = this.skipWeread;
    link.disabled = this.skipWeread;
  }

  private renderAppleRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "abs-wizard-row" });
    if (this.skipApple) row.addClass("is-skipped");

    const status = this.opts.appleStatus();
    const head = row.createDiv({ cls: "abs-wizard-row-head" });
    const icon = head.createDiv({ cls: "abs-wizard-row-icon" });
    setIcon(icon, "book-open");
    head.createEl("span", { cls: "abs-wizard-row-title", text: "苹果图书" });

    const pill = head.createEl("span", { cls: "abs-wizard-status" });
    const paintStatus = () => {
      pill.setText(this.skipApple ? "已跳过" : status.label);
      pill.toggleClass("is-ok", !this.skipApple && status.label === "可用");
      pill.toggleClass("is-warn", !this.skipApple && status.action === "permission");
      pill.toggleClass("is-muted", this.skipApple || (!status.action && status.label !== "可用"));
    };
    paintStatus();

    row.createEl("p", { cls: "abs-wizard-row-desc", text: status.detail });

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
    recheck.addEventListener("click", () => this.render());
    buttons.push(recheck);

    row.createDiv({ cls: "abs-wizard-req", text: appleRequirement() });

    const steps = appleSteps(status);
    if (steps.length > 0) {
      row.createDiv({ cls: "abs-wizard-req-title", text: "怎么解决" });
      const list = row.createEl("ul", { cls: "abs-wizard-steps" });
      for (const step of steps) list.createEl("li", { text: step });
    }

    const toggle = row.createEl("label", { cls: "abs-wizard-skip" });
    const checkbox = toggle.createEl("input", { type: "checkbox" });
    checkbox.checked = this.skipApple;
    toggle.createSpan({ text: "暂时跳过，稍后在设置里添加" });
    checkbox.addEventListener("change", () => {
      this.skipApple = checkbox.checked;
      row.toggleClass("is-skipped", this.skipApple);
      for (const button of buttons) button.disabled = this.skipApple;
      paintStatus();
    });
    for (const button of buttons) button.disabled = this.skipApple;
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
      const hasKey = Boolean(this.wereadKey.trim());
      list.createDiv({
        cls: "abs-wizard-done-row",
        text: this.skipWeread
          ? "微信读书：已跳过"
          : hasKey
            ? "微信读书：已填写 Key"
            : "微信读书：还没填 Key，书源不会同步",
      });
    }
    if (this.source !== "weread") {
      const status = this.opts.appleStatus();
      list.createDiv({
        cls: "abs-wizard-done-row",
        text: this.skipApple ? "苹果图书：已跳过" : `苹果图书：${status.label}`,
      });
    }

    const footer = contentEl.createDiv({ cls: "abs-wizard-footer" });
    const close = footer.createEl("button", { cls: "abs-wizard-btn", text: "关闭" });
    close.addEventListener("click", () => this.close());

    const open = footer.createEl("button", {
      cls: "abs-wizard-btn mod-cta",
      text: "打开书架",
    });
    open.addEventListener("click", () => {
      this.close();
      this.opts.onOpenShelf();
    });
  }
}
