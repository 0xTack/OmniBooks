# OmniBooks

Turn your book notes into a visual shelf inside Obsidian.

OmniBooks reads Markdown notes that carry book frontmatter (`title`, `author`, `cover`, `status`, `progress`, `highlights`, `lastRead`) and renders them as a bookshelf, a reading view, a timeline, and a set of reading statistics. It can sync notes from Apple Books (macOS) and WeRead (微信读书).

## Features

- **Shelf views** — cover wall, card, stacked, coverflow, and timeline.
- **Reader view** — chapters, highlights, inline comments, favourite quotes.
- **Sync** — Apple Books (local SQLite, desktop only) and WeRead (Agent API).
- **Reading timeline** — year/month pins, one date per day, fade-out near the pinned label.
- **Statistics** — completion rate, calendar heatmap, domain distribution, reading time.
- **AI advisor (optional)** — reading profile, radar chart, recommendations, and a data page. Requires your own API key.

## Installation

### Community plugins (recommended)

1. Open **Settings → Community plugins → Browse**.
2. Search for **OmniBooks**.
3. Install, then enable it.

Or open it directly: [obsidian://show-plugin?id=omnibooks](obsidian://show-plugin?id=omnibooks).

### Manual

Copy these files into `<vault>/.obsidian/plugins/omnibooks/`:

```text
main.js
manifest.json
styles.css
```

Restart Obsidian, then enable **OmniBooks** in Settings → Community plugins.

### BRAT (beta)

BRAT is only needed for testing builds that are not in the community directory yet.

1. Install the **BRAT** plugin from the community directory.
2. Run `BRAT: Add a beta plugin for testing`.
3. Enter the repository name (`0xTack/OmniBooks`).
4. Enable OmniBooks in Settings → Community plugins.

## Data sources and privacy

- **Apple Books**: reads the local Books database on macOS only. macOS requires Full Disk Access for Obsidian; enable it in System Settings → Privacy & Security → Full Disk Access, then fully quit and reopen Obsidian. No network request. Disabled on mobile.
- **WeRead (微信读书)**: calls an **unofficial** endpoint used by the WeRead client. It is not a public API and may change or stop working at any time. The API key is stored locally in the plugin settings and is never sent anywhere else.
- **AI advisor**: optional. Requests go directly to the provider you configure (DeepSeek, OpenAI, OpenRouter, or a custom OpenAI-compatible endpoint). Your key is stored locally.
- All book notes stay in your vault as plain Markdown. The plugin never uploads your notes.

## Commands

- `Open OmniBooks shelf`
- `Open book reader`
- `Reading timeline`
- `Reading statistics`
- `Sync Apple Books now`
- `Sync WeRead now`

## Known limitations

- Apple Books sync requires macOS and desktop Obsidian; it cannot run on mobile.
- WeRead sync depends on a non-public endpoint and may be rate-limited.
- Mobile layouts are supported but have had less testing than desktop.
- Reading time for archived WeRead books may be missing.

## Roadmap

- Local EPUB / PDF books: scan metadata and covers, show them on the shelf.
- Annotation import: a generic CSV / Markdown importer, then Kindle, KOReader, Readwise, and Calibre.
- More sync sources will be added one at a time, without promising dates.

## License

MIT

---

# OmniBooks 万卷书

把 Obsidian 里的书籍笔记渲染成书架，并提供阅读视图、时间线、统计和可选的 AI 顾问。

## 功能

- **五种书架布局**：封面墙、卡片、叠放、唱片、时间线。
- **阅读视图**：按章节展示划线、内联评论、爱心收藏金句。
- **同步**：苹果图书（本地 SQLite，仅桌面端）与微信读书（Agent 接口）。
- **阅读时间线**：年份·月份置顶、每天只标一次日期、靠近时淡出。
- **统计**：完成率、日历热力图、领域分布、阅读时间。
- **AI 顾问**：六维画像、雷达图、推荐、数据页；需要你自己的 API Key。

## 安装

### 社区市场（推荐）

1. 设置 → 第三方插件 → 浏览；
2. 搜索 **OmniBooks**；
3. 安装并启用。

也可以直接打开：[obsidian://show-plugin?id=omnibooks](obsidian://show-plugin?id=omnibooks)。

### 手动

把 `main.js`、`manifest.json`、`styles.css` 放进：

```text
<你的库>/.obsidian/plugins/omnibooks/
```

重启 Obsidian → 设置 → 第三方插件 → 启用 **OmniBooks**。

### BRAT（内测）

只用于社区目录里还没有的测试版本。

1. 先安装社区插件 **BRAT**；
2. 命令面板执行 `BRAT: Add a beta plugin for testing`；
3. 输入仓库名（`0xTack/OmniBooks`）；
4. 在第三方插件里启用 OmniBooks。

## 数据来源与隐私

- **苹果图书**：只读 macOS 本地「图书」数据库，不走网络；手机端不可用。需要在 系统设置 → 隐私与安全性 → 完全磁盘访问权限 中勾选 Obsidian，然后完全退出并重开。
- **微信读书**：调用微信读书客户端的**非公开**接口，不是官方 API，随时可能失效；Key 只保存在本地插件设置中。
- **AI 顾问**：可选，请求直接发给你配置的服务商；Key 只保存在本地。
- 书籍笔记始终是 vault 里的普通 Markdown，插件不会上传你的笔记。

## 命令

- `打开 OmniBooks 万卷书`
- `打开阅读视图`
- `阅读时间线`
- `阅读统计`
- `立即同步苹果图书`
- `立即同步微信读书`

## 已知限制

- 苹果图书同步依赖 macOS 桌面端，手机端无法运行。
- 微信读书接口非公开，可能被限流或失效。
- 手机端布局可用，但测试少于桌面端。
- 归档的微信读书书籍可能取不到阅读时长。

## 路线图

- 本地 EPUB / PDF：读取书名、作者、封面，直接上书架。
- 标注导入：先做通用 CSV / Markdown 导入，再逐步支持 Kindle、KOReader、Readwise、Calibre。
- 其他阅读器会陆续加入同步，不承诺具体时间。

## 许可证

MIT
