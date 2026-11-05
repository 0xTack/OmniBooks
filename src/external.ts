type ShellOpen = (target: string) => Promise<void>;

let cachedShell: { openExternal?: ShellOpen } | null | undefined;

function electronShell(): { openExternal?: ShellOpen } | null {
  if (cachedShell !== undefined) return cachedShell;
  try {
    const nodeRequire = (
      window as unknown as { require?: (id: string) => unknown }
    ).require;
    cachedShell = nodeRequire
      ? (nodeRequire("electron") as { shell?: { openExternal?: ShellOpen } })
          .shell ?? null
      : null;
  } catch {
    cachedShell = null;
  }
  return cachedShell;
}

/**
 * 统一的外部链接入口：桌面端交给系统浏览器 / 系统设置，
 * 手机上退回 window.open，避免在 Obsidian 内部新开网页。
 */
export function openExternal(url: string): void {
  if (!url) return;

  const shell = electronShell();
  if (shell?.openExternal) {
    void shell.openExternal(url).catch(() => {
      window.open(url);
    });
    return;
  }

  window.open(url);
}
