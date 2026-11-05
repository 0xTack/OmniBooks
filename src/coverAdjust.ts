import { App, Modal, Setting } from "obsidian";

export interface CoverAdjust {
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

export const DEFAULT_COVER_ADJUST: CoverAdjust = { x: 0, y: 0, scale: 1, rotate: 0 };

export interface CoverAdjustOptions {
  title: string;
  coverUrl: string;
  value: CoverAdjust | null;
  onSave: (value: CoverAdjust | null) => void;
}

export class CoverAdjustModal extends Modal {
  private options: CoverAdjustOptions;
  private draft: CoverAdjust;
  private previewImg: HTMLImageElement | null = null;

  constructor(app: App, options: CoverAdjustOptions) {
    super(app);
    this.options = options;
    this.draft = { ...(options.value ?? DEFAULT_COVER_ADJUST) };
  }

  private applyPreview(): void {
    if (!this.previewImg) return;
    this.previewImg.style.transform = `translate(${this.draft.x}%, ${this.draft.y}%) scale(${this.draft.scale}) rotate(${this.draft.rotate}deg)`;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    key: keyof CoverAdjust
  ): Setting {
    return new Setting(this.contentEl)
      .setName(label)
      .addSlider((slider) =>
        slider
          .setLimits(min, max, step)
          .setValue(this.draft[key])
          .setDynamicTooltip()
          .onChange((value) => {
            this.draft[key] = value;
            this.applyPreview();
          })
      );
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abs-cover-adjust");

    contentEl.createEl("h2", { text: "调整封面" });
    contentEl.createDiv({
      cls: "abs-cover-adjust-title",
      text: this.options.title,
    });

    const stage = contentEl.createDiv({ cls: "abs-cover-adjust-stage" });
    const img = stage.createEl("img", { cls: "abs-cover-adjust-img" });
    img.src = this.options.coverUrl;
    this.previewImg = img;
    this.applyPreview();

    this.slider("水平偏移", -50, 50, 1, "x");
    this.slider("垂直偏移", -50, 50, 1, "y");
    this.slider("缩放", 0.6, 2, 0.02, "scale");
    this.slider("旋转", -15, 15, 0.5, "rotate");

    const actions = contentEl.createDiv({ cls: "abs-cover-adjust-actions" });

    const autoBtn = actions.createEl("button", { text: "自动" });
    autoBtn.addEventListener("click", () => {
      this.draft = { ...DEFAULT_COVER_ADJUST };
      this.applyPreview();
      this.options.onSave(null);
      this.close();
    });

    const resetBtn = actions.createEl("button", { text: "重置" });
    resetBtn.addEventListener("click", () => {
      this.draft = { ...DEFAULT_COVER_ADJUST };
      this.applyPreview();
    });

    const saveBtn = actions.createEl("button", { cls: "mod-cta", text: "保存" });
    saveBtn.addEventListener("click", () => {
      this.options.onSave({ ...this.draft });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
