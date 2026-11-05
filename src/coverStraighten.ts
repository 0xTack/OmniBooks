/**
 * 封面拉正（透视校正）
 *
 * 立体书封、带书脊的封面、拍歪的书影，本质上是「一个矩形被拍成了梯形」。
 * 这里做四件事：
 *   1. 在缩略图上估算背景色，把封面从背景里分离出来；
 *   2. 对四条边做稳健直线拟合，求交点得到四个角；
 *   3. 立体书盒（正面 + 书脊 + 顶面）再找一条「书脊折线」，只取正面；
 *   4. 用单应性变换（homography）把四边形拉回矩形。
 *
 * 全部在本地 canvas 里完成，不上传任何图片。
 */

export interface Point {
  x: number;
  y: number;
}

export interface CoverQuad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface CoverAnalysis {
  quad: CoverQuad;
  /** 检测到的四边形面积 / 外接框面积 */
  fill: number;
  /** 用于日志：为什么成功或失败 */
  reason: string;
  /** 是否检测到书脊折线并据此只取正面 */
  hinged: boolean;
  /** 原始图片尺寸 */
  sourceWidth: number;
  sourceHeight: number;
}

export interface StraightenResult {
  dataUrl: string;
  /** 源图里被认定为封面的四个角（原图坐标） */
  quad: CoverQuad;
  /** 拉正后输出的尺寸 */
  width: number;
  height: number;
  hinged: boolean;
}

/** 工作分辨率：只在缩略图上找边，避免大图逐像素扫描 */
const WORK_WIDTH = 150;
/** 判定「标准封面」的宽高比区间，落在这里面的图不需要拉正 */
const STANDARD_MIN = 0.7;
const STANDARD_MAX = 0.8;
/** 输出最大高度：书架最宽也就 200px 左右，520 足够清晰 */
const MAX_OUTPUT_HEIGHT = 520;

export function isStandardCover(width: number, height: number): boolean {
  const ratio = width / Math.max(1, height);
  return ratio >= STANDARD_MIN && ratio <= STANDARD_MAX;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const arr = values.slice().sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(quad: CoverQuad): number {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

interface Line {
  /** x = a * y + b（horizontal=true）或 y = a * x + b（horizontal=false） */
  a: number;
  b: number;
}

/** 最小二乘拟合，第二轮剔除离群点 */
function robustFit(points: Point[], horizontal: boolean, maxSlope = 0.75): Line | null {
  if (points.length < 8) return null;

  const fit = (pts: Point[]): Line | null => {
    const n = pts.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const p of pts) {
      const u = horizontal ? p.y : p.x;
      const v = horizontal ? p.x : p.y;
      sx += u;
      sy += v;
      sxx += u * u;
      sxy += u * v;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-6) return null;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (Math.abs(a) > maxSlope) return null;
    return { a, b };
  };

  const first = fit(points);
  if (!first) return null;

  const residuals = points.map((p) => {
    const predicted = horizontal ? first.a * p.y + first.b : first.a * p.x + first.b;
    return Math.abs((horizontal ? p.x : p.y) - predicted);
  });
  const sorted = residuals.slice().sort((x, y) => x - y);
  const cutoff = sorted[Math.floor(sorted.length * 0.85)] ?? Infinity;

  const kept = points.filter((_, index) => residuals[index] <= cutoff * 1.6 + 1);
  return fit(kept) ?? first;
}

function intersect(left: Line | null, top: Line | null): Point | null {
  if (!left || !top) return null;
  const denom = 1 - left.a * top.a;
  if (Math.abs(denom) < 1e-6) return null;
  const x = (left.a * top.b + left.b) / denom;
  const y = top.a * x + top.b;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

interface Background {
  r: number;
  g: number;
  b: number;
  transparent: boolean;
}

function sampleBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Background {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let transparent = 0;
  let total = 0;

  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
    if (data[i + 3] < 40) transparent += 1;
    total += 1;
  };

  const ring = Math.max(2, Math.round(width * 0.02));
  for (let x = 0; x < width; x += 1) {
    for (let t = 0; t < ring; t += 1) {
      push(x, t);
      push(x, height - 1 - t);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let t = 0; t < ring; t += 1) {
      push(t, y);
      push(width - 1 - t, y);
    }
  }

  return {
    r: median(rs),
    g: median(gs),
    b: median(bs),
    transparent: total > 0 && transparent / total > 0.5,
  };
}

/**
 * 立体书盒：找「书脊折线」（正面与书脊之间的那条近竖直的强边）。
 * 只在左侧 15%–58% 的范围内找，返回拟合出的竖直线。
 */
function findHingeLine(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  box: { left: number; right: number; top: number; bottom: number }
): Line | null {
  const boxHeight = box.bottom - box.top;
  const innerTop = box.top + boxHeight * 0.1;
  const innerBottom = box.bottom - boxHeight * 0.1;
  const x0 = box.left + (box.right - box.left) * 0.1;
  const x1 = box.left + (box.right - box.left) * 0.78;
  if (x1 - x0 < 6) return null;

  const gray = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  // 每一行单独归一化：书脊折线要在同一行里相对最强，而不是绝对阈值
  const rows: Array<{ y: number; bestX: number; strength: number }> = [];
  for (let y = Math.ceil(innerTop); y <= innerBottom; y += 1) {
    let rowMax = 0;
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) {
      const gx = Math.abs(gray(x + 1, y) - gray(x - 1, y));
      if (gx > rowMax) rowMax = gx;
    }
    if (rowMax < 14) continue;
    const cut = Math.max(12, rowMax * 0.55);
    let bestX = -1;
    let bestDx = 0;
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) {
      const gx = Math.abs(gray(x + 1, y) - gray(x - 1, y));
      if (gx >= cut && gx > bestDx) {
        bestDx = gx;
        bestX = x;
      }
    }
    if (bestX >= 0) rows.push({ y, bestX, strength: bestDx });
  }

  if (rows.length < Math.max(10, (innerBottom - innerTop) * 0.25)) return null;

  // 按 x 投票：书脊折线会在很多行里落到相近的列
  const votes = new Map<number, number>();
  for (const row of rows) {
    const bucket = Math.round(row.bestX / 3) * 3;
    votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
  }
  let bestBucket = -1;
  let bestVotes = 0;
  for (const [bucket, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      bestBucket = bucket;
    }
  }
  if (bestBucket < 0 || bestVotes / rows.length < 0.28) return null;

  const points: Point[] = [];
  for (const row of rows) {
    if (Math.abs(row.bestX - bestBucket) > 6) continue;
    let bestX = row.bestX;
    let bestDx = 0;
    for (let dx = -3; dx <= 3; dx += 1) {
      const x = bestBucket + dx;
      const gx = Math.abs(gray(x + 1, row.y) - gray(x - 1, row.y));
      if (gx > bestDx) {
        bestDx = gx;
        bestX = x;
      }
    }
    points.push({ x: bestX, y: row.y });
  }

  return robustFit(points, true, 0.5);
}

interface Detection {
  quad: CoverQuad;
  fill: number;
  hinged: boolean;
  reason: string;
}

export function analyzeCover(image: HTMLImageElement): CoverAnalysis | null {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight) return null;

  const workWidth = Math.min(WORK_WIDTH, naturalWidth);
  const workHeight = Math.max(1, Math.round((naturalHeight * workWidth) / naturalWidth));

  const canvas = document.createElement("canvas");
  canvas.width = workWidth;
  canvas.height = workHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, workWidth, workHeight);

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, workWidth, workHeight);
  } catch {
    return null; // 跨域图片，canvas 被污染
  }

  const data = pixels.data;
  const bg = sampleBackground(data, workWidth, workHeight);
  const threshold = 30;

  const mask = new Uint8Array(workWidth * workHeight);
  const rowCount = new Int32Array(workHeight);
  const colCount = new Int32Array(workWidth);

  for (let y = 0; y < workHeight; y += 1) {
    for (let x = 0; x < workWidth; x += 1) {
      const i = (y * workWidth + x) * 4;
      let foreground: boolean;
      if (bg.transparent) {
        foreground = data[i + 3] > 60;
      } else {
        const dr = Math.abs(data[i] - bg.r);
        const dg = Math.abs(data[i + 1] - bg.g);
        const db = Math.abs(data[i + 2] - bg.b);
        foreground = Math.max(dr, dg, db) > threshold;
      }
      if (foreground) {
        mask[y * workWidth + x] = 1;
        rowCount[y] += 1;
        colCount[x] += 1;
      }
    }
  }

  const rowMin = workWidth * 0.04;
  const colMin = workHeight * 0.04;
  let top = 0;
  let bottom = workHeight - 1;
  let left = 0;
  let right = workWidth - 1;
  while (top < workHeight && rowCount[top] < rowMin) top += 1;
  while (bottom > top && rowCount[bottom] < rowMin) bottom -= 1;
  while (left < workWidth && colCount[left] < colMin) left += 1;
  while (right > left && colCount[right] < colMin) right -= 1;

  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth < WORK_WIDTH * 0.35 || boxHeight < workHeight * 0.35) {
    return null;
  }

  const leftPoints: Point[] = [];
  const rightPoints: Point[] = [];
  const innerTop = top + boxHeight * 0.12;
  const innerBottom = bottom - boxHeight * 0.12;
  for (let y = Math.ceil(innerTop); y <= innerBottom; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = left; x <= right; x += 1) {
      if (mask[y * workWidth + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (last - first < boxWidth * 0.4) continue;
    leftPoints.push({ x: first, y });
    rightPoints.push({ x: last, y });
  }

  const topPoints: Point[] = [];
  const bottomPoints: Point[] = [];
  const innerLeft = left + boxWidth * 0.12;
  const innerRight = right - boxWidth * 0.12;
  for (let x = Math.ceil(innerLeft); x <= innerRight; x += 1) {
    let first = -1;
    let last = -1;
    for (let y = top; y <= bottom; y += 1) {
      if (mask[y * workWidth + x]) {
        if (first < 0) first = y;
        last = y;
      }
    }
    if (first < 0) continue;
    if (last - first < boxHeight * 0.4) continue;
    topPoints.push({ x, y: first });
    bottomPoints.push({ x, y: last });
  }

  const leftLine = robustFit(leftPoints, true);
  const rightLine = robustFit(rightPoints, true);
  const topLine = robustFit(topPoints, false);
  const bottomLine = robustFit(bottomPoints, false);
  if (!leftLine || !rightLine || !topLine || !bottomLine) {
    return null;
  }

  let tl = intersect(leftLine, topLine);
  let tr = intersect(rightLine, topLine);
  let br = intersect(rightLine, bottomLine);
  let bl = intersect(leftLine, bottomLine);
  if (!tl || !tr || !br || !bl) return null;

  const margin = 0.08;
  const inBox = (p: Point) =>
    p.x >= left - boxWidth * margin &&
    p.x <= right + boxWidth * margin &&
    p.y >= top - boxHeight * margin &&
    p.y <= bottom + boxHeight * margin;
  if (![tl, tr, br, bl].every(inBox)) return null;

  let quad: CoverQuad = { tl, tr, br, bl };
  let fill = polygonArea(quad) / Math.max(1, boxWidth * boxHeight);
  if (fill < 0.6) return null;

  // ---- 立体书盒：找书脊折线，只保留正面 ----
  let hinged = false;
  const widthNow = (distance(tl, tr) + distance(bl, br)) / 2;
  const heightNow = (distance(tl, bl) + distance(tr, br)) / 2;
  const tilt = Math.max(Math.abs(topLine.a), Math.abs(bottomLine.a));
  const ratioNow = widthNow / Math.max(1, heightNow);

  let hinge = findHingeLine(data, workWidth, workHeight, { left, right, top, bottom });

  // 没找到折线时，退化为「右锚定、按封面比例裁切」：书脊通常在左侧
  if (!hinge && ratioNow > 0.92 && tilt > 0.02) {
    const targetWidth = heightNow * 0.74;
    hinge = { a: rightLine.a, b: rightLine.b - targetWidth };
  }

  if (ratioNow > 0.85 && tilt > 0.02 && hinge) {
    const ntl = intersect(hinge, topLine);
    const nbl = intersect(hinge, bottomLine);
    if (ntl && nbl) {
      const candidate: CoverQuad = { tl: ntl, tr, br, bl: nbl };
      const cw = (distance(ntl, tr) + distance(nbl, br)) / 2;
      const ch = (distance(ntl, nbl) + distance(tr, br)) / 2;
      const cratio = cw / Math.max(1, ch);
      if (cratio > 0.52 && cratio < 0.9 && polygonArea(candidate) > 0.25 * boxWidth * boxHeight) {
        quad = candidate;
        tl = ntl;
        bl = nbl;
        hinged = true;
        fill = polygonArea(quad) / Math.max(1, boxWidth * boxHeight);
      }
    }
  }

  const scaleX = naturalWidth / workWidth;
  const scaleY = naturalHeight / workHeight;
  const scaled: CoverQuad = {
    tl: { x: tl.x * scaleX, y: tl.y * scaleY },
    tr: { x: tr.x * scaleX, y: tr.y * scaleY },
    br: { x: br.x * scaleX, y: br.y * scaleY },
    bl: { x: bl.x * scaleX, y: bl.y * scaleY },
  };

  return {
    quad: scaled,
    fill,
    reason: hinged ? "hinged" : "silhouette",
    hinged,
    sourceWidth: naturalWidth,
    sourceHeight: naturalHeight,
  };
}

/** 解 8 元一次方程组，求目标矩形 → 源四边形的单应矩阵 */
function solveHomography(from: Point[], to: Point[]): number[] | null {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-9) return null;
    if (pivot !== col) {
      const tmp = rows[pivot];
      rows[pivot] = rows[col];
      rows[col] = tmp;
    }
    const divisor = rows[col][col];
    for (let k = col; k < 9; k += 1) rows[col][k] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = rows[row][col];
      if (factor === 0) continue;
      for (let k = col; k < 9; k += 1) rows[row][k] -= factor * rows[col][k];
    }
  }

  return rows.map((row) => row[8]);
}

function warp(
  source: HTMLImageElement,
  quad: CoverQuad,
  outWidth: number,
  outHeight: number
): string | null {
  const naturalWidth = source.naturalWidth;
  const naturalHeight = source.naturalHeight;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = naturalWidth;
  srcCanvas.height = naturalHeight;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return null;
  srcCtx.drawImage(source, 0, 0);

  let srcData: ImageData;
  try {
    srcData = srcCtx.getImageData(0, 0, naturalWidth, naturalHeight);
  } catch {
    return null;
  }

  const matrix = solveHomography(
    [
      { x: 0, y: 0 },
      { x: outWidth, y: 0 },
      { x: outWidth, y: outHeight },
      { x: 0, y: outHeight },
    ],
    [quad.tl, quad.tr, quad.br, quad.bl]
  );
  if (!matrix) return null;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return null;

  const outImage = outCtx.createImageData(outWidth, outHeight);
  const src = srcData.data;
  const dst = outImage.data;
  const [h11, h12, h13, h21, h22, h23, h31, h32] = matrix;

  for (let y = 0; y < outHeight; y += 1) {
    const yc = y + 0.5;
    const rowOffset = y * outWidth * 4;
    for (let x = 0; x < outWidth; x += 1) {
      const xc = x + 0.5;
      const w = h31 * xc + h32 * yc + 1;
      if (Math.abs(w) < 1e-9) continue;
      const sx = (h11 * xc + h12 * yc + h13) / w;
      const sy = (h21 * xc + h22 * yc + h23) / w;

      const i = rowOffset + x * 4;
      if (sx < 0 || sy < 0 || sx > naturalWidth - 1 || sy > naturalHeight - 1) {
        dst[i + 3] = 255;
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(naturalWidth - 1, x0 + 1);
      const y1 = Math.min(naturalHeight - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * naturalWidth + x0) * 4;
      const i10 = (y0 * naturalWidth + x1) * 4;
      const i01 = (y1 * naturalWidth + x0) * 4;
      const i11 = (y1 * naturalWidth + x1) * 4;

      for (let c = 0; c < 3; c += 1) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        dst[i + c] = top * (1 - fy) + bottom * fy;
      }
      dst[i + 3] = 255;
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  try {
    return outCanvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

/**
 * 把一张「歪的」封面拉正。找不到可靠的四条边时返回 null，调用方沿用原图。
 */
export function straightenCover(image: HTMLImageElement): StraightenResult | null {
  if (!image.naturalWidth || !image.naturalHeight) return null;
  if (isStandardCover(image.naturalWidth, image.naturalHeight)) return null;

  const analysis = analyzeCover(image);
  if (!analysis) return null;

  const { quad } = analysis;
  // 几乎就是整张图、也没有透视倾斜：不用重采样，交给 CSS 铺满即可
  const quadWidth = (distance(quad.tl, quad.tr) + distance(quad.bl, quad.br)) / 2;
  const quadHeight = (distance(quad.tl, quad.bl) + distance(quad.tr, quad.br)) / 2;
  const tilt = Math.max(
    Math.abs((quad.tr.y - quad.tl.y) / Math.max(1, quad.tr.x - quad.tl.x)),
    Math.abs((quad.br.y - quad.bl.y) / Math.max(1, quad.br.x - quad.bl.x))
  );
  const coversAlmostAll =
    quadWidth > analysis.sourceWidth * 0.92 && quadHeight > analysis.sourceHeight * 0.92;
  if (coversAlmostAll && tilt < 0.008 && !analysis.hinged) return null;
  const widthTop = distance(quad.tl, quad.tr);
  const widthBottom = distance(quad.bl, quad.br);
  const heightLeft = distance(quad.tl, quad.bl);
  const heightRight = distance(quad.tr, quad.br);

  let outWidth = Math.round((widthTop + widthBottom) / 2);
  let outHeight = Math.round((heightLeft + heightRight) / 2);
  if (outWidth < 40 || outHeight < 40) return null;

  if (outHeight > MAX_OUTPUT_HEIGHT) {
    const k = MAX_OUTPUT_HEIGHT / outHeight;
    outWidth = Math.round(outWidth * k);
    outHeight = MAX_OUTPUT_HEIGHT;
  }

  const dataUrl = warp(image, quad, outWidth, outHeight);
  if (!dataUrl) return null;

  return { dataUrl, quad, width: outWidth, height: outHeight, hinged: analysis.hinged };
}
