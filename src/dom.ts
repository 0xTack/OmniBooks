/** 解析 HTML/SVG 字符串并插入，避免直接赋值 innerHTML。 */
export function appendMarkup(parent: HTMLElement, markup: string): void {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  for (const child of Array.from(doc.body.children)) {
    parent.appendChild(child);
  }
}
