import { DSLNode, Diagnostic, RenderResult, LayoutBox, SizeSpec, BoxRect } from './types.js';

export interface RenderOptions {
  /** Output width in visual columns (default: 80) */
  width?: number;
  /** Default height for root layout nodes without an explicit height (default: 24) */
  height?: number;
}

const LAYOUT_KINDS = new Set(['hstack', 'vstack']);
const BORDERED_KINDS = new Set(['header', 'panel', 'table']);

function isLayout(kind: string): boolean {
  return LAYOUT_KINDS.has(kind);
}

function isBordered(node: DSLNode): boolean {
  if (BORDERED_KINDS.has(node.kind)) return true;
  // unknown / layer / grid render as dotted default boxes
  return !isLayout(node.kind) && !['nav', 'list', 'footer'].includes(node.kind);
}

// --- Visual Width Helpers ---

function getVisualWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    width += charWidth(char);
  }
  return width;
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) || 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function visualPadEnd(str: string, targetWidth: number, padChar: string = ' '): string {
  const currentWidth = getVisualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + padChar.repeat(targetWidth - currentWidth);
}

// --- 2D character canvas ---

const WIDE_CONT = ''; // marker for the second cell of a full-width char

class Canvas {
  readonly w: number;
  readonly h: number;
  private chars: string[][];
  readonly ids: (string | null)[][];

  constructor(w: number, h: number) {
    this.w = Math.max(0, w);
    this.h = Math.max(0, h);
    this.chars = Array.from({ length: this.h }, () => Array(this.w).fill(' '));
    this.ids = Array.from({ length: this.h }, () => Array(this.w).fill(null));
  }

  /** Claim an id for every cell in rect (called before drawing children). */
  fillIds(rect: BoxRect, id: string) {
    for (let y = rect.y; y < rect.y + rect.h && y < this.h; y++) {
      if (y < 0) continue;
      for (let x = rect.x; x < rect.x + rect.w && x < this.w; x++) {
        if (x < 0) continue;
        this.ids[y][x] = id;
      }
    }
  }

  private clearCell(x: number, y: number) {
    const c = this.chars[y][x];
    if (c === WIDE_CONT) {
      // second half of a wide char: remove its head too
      this.chars[y][x] = ' ';
      if (x > 0) { this.chars[y][x - 1] = ' '; }
      return;
    }
    this.chars[y][x] = ' ';
    if (c && charWidth(c) === 2 && x + 1 < this.w) {
      this.chars[y][x + 1] = ' ';
    }
  }

  /**
   * Write a char at a visual cell. A space never overwrites a non-space cell,
   * so borderless children cannot erase a shared border. Wide chars occupy two cells.
   */
  write(x: number, y: number, ch: string, id: string) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (ch === ' ' && this.chars[y][x] !== ' ') return; // transparent space
    this.clearCell(x, y);
    if (charWidth(ch) === 2) {
      if (x + 1 >= this.w) return;
      this.clearCell(x + 1, y);
      this.chars[y][x] = ch;
      this.chars[y][x + 1] = WIDE_CONT;
      this.ids[y][x] = id;
      this.ids[y][x + 1] = id;
    } else {
      this.chars[y][x] = ch;
      this.ids[y][x] = id;
    }
  }

  rowText(y: number): string {
    return this.chars[y].filter(c => c !== WIDE_CONT).join('').replace(/\s+$/, '');
  }
}

// --- size spec resolution ---

type RawSizeSpec = SizeSpec | { type: 'invalid' };

function parseSizeSpec(raw: string | undefined, dflt: 'fill' | 'auto'): RawSizeSpec {
  if (raw === undefined || raw === '') return { type: dflt };
  if (raw === 'fill') return { type: 'fill' };
  if (raw === 'auto') return { type: 'auto' };
  let m = raw.match(/^(\d+)%$/);
  if (m) return { type: 'percent', value: parseInt(m[1], 10) };
  m = raw.match(/^(\d+)$/);
  if (m) return { type: 'fixed', value: parseInt(m[1], 10) };
  return { type: 'invalid' };
}

// --- measure / arrange / draw ---

interface Ctx {
  diags: Diagnostic[];
  boxes: LayoutBox[];
  defaultHeight: number;
  measured: Map<DSLNode, { w: number; h: number }>;
}

function contentLines(node: DSLNode): string[] {
  return node.content === '' ? [] : node.content.split('\n');
}

function maxLineWidth(node: DSLNode): number {
  return contentLines(node).reduce((w, l) => Math.max(w, getVisualWidth(l)), 0);
}

function tableShape(node: DSLNode): { colWidths: number[]; rows: string[][] } | null {
  const rows = contentLines(node)
    .filter(l => l.includes('|'))
    .map(line => line.split('|').map(c => c.trim())
      .filter((_, i, a) => !(i === 0 && !a[i]) && !(i === a.length - 1 && !a[i])))
    .filter(row => !row.every(c => c.match(/^[ :-]+$/)));
  if (rows.length === 0) return null;
  const colWidths: number[] = [];
  rows.forEach(row => row.forEach((cell, i) => {
    colWidths[i] = Math.max(colWidths[i] || 0, getVisualWidth(cell));
  }));
  return { colWidths, rows };
}

function measure(node: DSLNode, ctx: Ctx): { w: number; h: number } {
  const cached = ctx.measured.get(node);
  if (cached) return cached;
  let size: { w: number; h: number };
  if (isLayout(node.kind)) {
    const kids = node.children.map(c => measure(c, ctx));
    if (kids.length === 0) {
      size = { w: 0, h: 0 };
    } else if (node.kind === 'vstack') {
      size = {
        w: Math.max(...kids.map(k => k.w)),
        h: kids.reduce((s, k) => s + k.h, 0) - (kids.length - 1), // shared borders
      };
    } else {
      size = {
        w: kids.reduce((s, k) => s + k.w, 0) - (kids.length - 1),
        h: Math.max(...kids.map(k => k.h)),
      };
    }
  } else {
    const inner = maxLineWidth(node);
    const n = contentLines(node).length;
    const childH = node.children.length > 0
      ? Math.max(0, ...node.children.map(c => measure(c, ctx).h))
      : 0;
    switch (node.kind) {
      case 'header':
      case 'panel':
        size = { w: inner + 4, h: Math.max(3, n + 2 + childH) };
        break;
      case 'nav':
        size = { w: inner + 4, h: Math.max(3, n + 2 + childH) };
        break;
      case 'footer':
        size = { w: Math.max(inner, 1), h: Math.max(3, n + 2 + childH) };
        break;
      case 'list':
        size = { w: Math.max(inner, 1), h: Math.max(1, n + childH) };
        break;
      case 'table': {
        const t = tableShape(node);
        size = t
          ? { w: t.colWidths.reduce((s, w) => s + w, 0) + 3 * t.colWidths.length + 1, h: t.rows.length + 3 + childH }
          : { w: inner + 4, h: Math.max(3, n + 2 + childH) };
        break;
      }
      default: // unknown / layer / grid → default box
        size = { w: inner + 4, h: Math.max(3, n + 2 + childH) };
    }
  }
  ctx.measured.set(node, size);
  return size;
}

function minSize(node: DSLNode, axis: 'w' | 'h'): number {
  if (isLayout(node.kind)) return 1;
  return isBordered(node) ? (axis === 'w' ? 3 : 2) : 1;
}

function normalizeSize(spec: RawSizeSpec, raw: string | undefined, node: DSLNode, axis: string, ctx: Ctx): SizeSpec {
  if (spec.type === 'invalid') {
    ctx.diags.push({
      severity: 'warning',
      message: `Invalid ${axis} value '${raw}' (expected N, N%, fill, or auto)`,
      line: node.sourceRange.startLine,
      nodeId: node.id,
    });
    return { type: axis === 'width' ? 'fill' : 'auto' };
  }
  return spec;
}

/**
 * Distribute `total` among children along one axis.
 * Order: fixed → % → auto → fill (largest remainder). On overflow shrink fill → auto → %,
 * then clip + warning. Shared borders: allocation total is total + (n - 1).
 */
function allocate(
  children: DSLNode[],
  specs: SizeSpec[],
  total: number,
  axis: 'w' | 'h',
  ctx: Ctx,
  parent: DSLNode,
): number[] {
  const n = children.length;
  const T = total + (n - 1);
  const alloc = new Array(n).fill(0);
  const fillIdx: number[] = [];
  const autoIdx: number[] = [];
  const pctIdx: number[] = [];

  for (let i = 0; i < n; i++) {
    const s = specs[i];
    if (s.type === 'fixed') alloc[i] = Math.max(0, s.value);
    else if (s.type === 'percent') alloc[i] = Math.max(0, Math.round((T * s.value) / 100));
    else if (s.type === 'auto') {
      alloc[i] = Math.max(minSize(children[i], axis), ctx.measured.get(children[i])![axis === 'w' ? 'w' : 'h']);
      autoIdx.push(i);
    } else fillIdx.push(i);
  }

  // fill: split remainder equally (largest remainder)
  let rem = T - alloc.reduce((a, b) => a + b, 0);
  if (fillIdx.length > 0 && rem > 0) {
    const base = Math.floor(rem / fillIdx.length);
    let leftover = rem - base * fillIdx.length;
    for (const i of fillIdx) alloc[i] = base + (leftover-- > 0 ? 1 : 0);
  } else if (rem < 0) {
    // overflow: shrink auto then percent toward their minimum
    let over = -rem;
    for (const group of [autoIdx, pctIdx]) {
      for (const i of group) {
        const floor = minSize(children[i], axis);
        const give = Math.min(alloc[i] - floor, over);
        alloc[i] -= give;
        over -= give;
        if (over <= 0) break;
      }
      if (over <= 0) break;
    }
    if (over > 0) {
      ctx.diags.push({
        severity: 'warning',
        message: `Content exceeds the ${axis === 'w' ? 'width' : 'height'} of '${parent.kind}' by ${over} (truncated)`,
        line: parent.sourceRange.startLine,
        nodeId: parent.id,
      });
    }
  }
  return alloc;
}

/** Child width inside a vstack (or a root part): spec resolves against the container, capped by it. */
function resolveConstrained(spec: SizeSpec, measuredW: number, availW: number): number {
  switch (spec.type) {
    case 'fixed': return Math.min(spec.value, availW);
    case 'percent': return Math.min(Math.max(0, Math.round((availW * spec.value) / 100)), availW);
    case 'auto': return Math.min(Math.max(measuredW, 1), availW);
    case 'fill': default: return availW;
  }
}

// --- drawing ---

function drawBorder(c: Canvas, r: BoxRect, style: string, id: string) {
  if (r.w < 2 || r.h < 2) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) c.write(x, y, '~', id);
    return;
  }
  if (style === '=') {
    for (let x = r.x; x < r.x + r.w; x++) { c.write(x, r.y, '=', id); c.write(x, r.y + r.h - 1, '=', id); }
  } else {
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) { c.write(x, r.y, style, id); c.write(x, r.y + r.h - 1, style, id); }
    c.write(r.x, r.y, '+', id); c.write(r.x + r.w - 1, r.y, '+', id);
    c.write(r.x, r.y + r.h - 1, '+', id); c.write(r.x + r.w - 1, r.y + r.h - 1, '+', id);
  }
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    c.write(r.x, y, '|', id);
    c.write(r.x + r.w - 1, y, '|', id);
  }
}

function drawText(c: Canvas, x: number, y: number, text: string, maxW: number, id: string) {
  let cx = x;
  for (const ch of text) {
    const w = charWidth(ch);
    if (cx - x + w > maxW) break;
    c.write(cx, y, ch, id);
    cx += w;
  }
}

/** Write content lines into a rect, top-aligned, clipped. Returns rows used. */
function drawContentLines(c: Canvas, node: DSLNode, r: BoxRect): number {
  const lines = contentLines(node);
  let y = r.y;
  for (const line of lines) {
    if (y >= r.y + r.h) break;
    drawText(c, r.x, y, line, r.w, node.id);
    y++;
  }
  return y - r.y;
}

function drawTable(c: Canvas, node: DSLNode, r: BoxRect, ctx: Ctx) {
  const t = tableShape(node);
  if (!t) { drawBorder(c, r, '-', node.id); drawContentLines(c, node, innerRect(r)); return; }

  let { colWidths, rows } = t;
  const n = colWidths.length;
  const fixed = 3 * n + 1; // separators + padding
  const availCells = r.w - fixed;
  const natural = colWidths.reduce((a, b) => a + b, 0);
  if (natural > availCells) {
    ctx.diags.push({
      severity: 'warning',
      message: `Table '${node.id}' columns shrunk to fit width ${r.w}`,
      line: node.sourceRange.startLine,
      nodeId: node.id,
    });
    colWidths = colWidths.map(w => Math.max(1, Math.floor((w * availCells) / natural)));
  }

  const sep = (y: number) => {
    c.write(r.x, y, '+', node.id);
    let x = r.x + 1;
    for (const w of colWidths) {
      for (let i = 0; i < w + 2; i++) c.write(x++, y, '-', node.id);
      c.write(x++, y, '+', node.id);
    }
  };
  const drawRow = (y: number, row: string[]) => {
    let x = r.x;
    c.write(x++, y, '|', node.id);
    for (let i = 0; i < n; i++) {
      drawText(c, x + 1, y, visualPadEnd(row[i] || '', colWidths[i]), colWidths[i], node.id);
      x += colWidths[i] + 2;
      c.write(x++, y, '|', node.id);
    }
  };

  let y = r.y;
  const end = r.y + r.h;
  if (y < end) sep(y++);
  if (y < end) drawRow(y++, rows[0]);
  if (y < end) sep(y++);
  for (let i = 1; i < rows.length && y < end - 1; i++) drawRow(y++, rows[i]);
  if (y < end) sep(y++);
}

function innerRect(r: BoxRect): BoxRect {
  return { x: r.x + 2, y: r.y + 1, w: Math.max(0, r.w - 4), h: Math.max(0, r.h - 2) };
}

/** Centered text block (nav, footer): content vertically and horizontally centered in rect. */
function drawCentered(c: Canvas, node: DSLNode, r: BoxRect) {
  const lines = contentLines(node);
  const blockH = lines.length;
  const startY = r.y + Math.max(0, Math.floor((r.h - blockH) / 2));
  lines.forEach((line, i) => {
    const w = getVisualWidth(line);
    const x = r.x + Math.max(0, Math.floor((r.w - w) / 2));
    drawText(c, x, startY + i, line, r.w, node.id);
  });
}

function drawPart(node: DSLNode, r: BoxRect, c: Canvas, ctx: Ctx) {
  let contentArea: BoxRect;
  switch (node.kind) {
    case 'header':
      drawBorder(c, r, '=', node.id);
      contentArea = innerRect(r);
      drawCentered(c, node, contentArea);
      break;
    case 'table':
      drawTable(c, node, r, ctx);
      contentArea = { x: r.x, y: r.y + Math.min(r.h, (tableShape(node)?.rows.length ?? 0) + 3), w: r.w, h: 0 };
      break;
    case 'nav':
    case 'footer':
      drawCentered(c, node, r);
      contentArea = r;
      break;
    case 'list':
      contentArea = r;
      drawContentLines(c, node, r);
      break;
    case 'panel':
      drawBorder(c, r, '-', node.id);
      contentArea = innerRect(r);
      drawContentLines(c, node, contentArea);
      break;
    default: // unknown / layer / grid → dotted default box
      drawBorder(c, r, '.', node.id);
      contentArea = innerRect(r);
      drawContentLines(c, node, contentArea);
  }

  // Children inside a part render as an implicit vstack below its content
  if (node.children.length > 0) {
    const usedH = node.kind === 'table' ? 0 : contentLines(node).length;
    const childArea: BoxRect = {
      x: contentArea.x,
      y: contentArea.y + usedH,
      w: contentArea.w,
      h: Math.max(0, contentArea.h - usedH),
    };
    if (childArea.h > 0) {
      arrangeChildrenVertical(node.children, childArea, c, ctx);
    } else {
      ctx.diags.push({
        severity: 'warning',
        message: `Children inside '${node.kind}' have no room and are not rendered`,
        line: node.sourceRange.startLine,
        nodeId: node.id,
      });
    }
  }
}

// --- arrange ---

function arrangeChildrenVertical(children: DSLNode[], r: BoxRect, c: Canvas, ctx: Ctx) {
  const specs = children.map(ch =>
    normalizeSize(parseSizeSpec(ch.params?.height, 'auto'), ch.params?.height, ch, 'height', ctx));
  const alloc = allocate(children, specs, r.h, 'h', ctx, { kind: 'vstack', id: '', sourceRange: { startLine: 0, endLine: 0 } } as DSLNode);
  let y = r.y;
  for (let i = 0; i < children.length; i++) {
    const ch = alloc[i];
    if (ch <= 0) continue;
    const wSpec = normalizeSize(parseSizeSpec(children[i].params?.width, 'fill'), children[i].params?.width, children[i], 'width', ctx);
    const cw = resolveConstrained(wSpec, ctx.measured.get(children[i])!.w, r.w);
    arrange(children[i], { x: r.x, y, w: cw, h: ch }, c, ctx);
    y += ch - 1; // shared border
  }
}

function arrange(node: DSLNode, r: BoxRect, c: Canvas, ctx: Ctx) {
  if (r.w <= 0 || r.h <= 0) return;
  c.fillIds(r, node.id);
  ctx.boxes.push({ nodeId: node.id, kind: node.kind, rect: { ...r } });

  if (node.kind === 'vstack') {
    if (node.children.length === 0) return;
    const specs = node.children.map(ch =>
      normalizeSize(parseSizeSpec(ch.params?.height, 'auto'), ch.params?.height, ch, 'height', ctx));
    const alloc = allocate(node.children, specs, r.h, 'h', ctx, node);
    let y = r.y;
    for (let i = 0; i < node.children.length; i++) {
      const ch = alloc[i];
      if (ch <= 0) continue;
      const child = node.children[i];
      const wSpec = normalizeSize(parseSizeSpec(child.params?.width, 'fill'), child.params?.width, child, 'width', ctx);
      const cw = resolveConstrained(wSpec, ctx.measured.get(child)!.w, r.w);
      arrange(child, { x: r.x, y, w: cw, h: ch }, c, ctx);
      y += ch - 1;
    }
    return;
  }

  if (node.kind === 'hstack') {
    if (node.children.length === 0) return;
    const specs = node.children.map(ch =>
      normalizeSize(parseSizeSpec(ch.params?.width, 'fill'), ch.params?.width, ch, 'width', ctx));
    const alloc = allocate(node.children, specs, r.w, 'w', ctx, node);
    // Row height: tallest child's resolved height, capped by the container.
    // Cross-axis default is fill so columns stretch to the row height
    // (mirrors vstack children defaulting to width=fill).
    let rowH = 0;
    for (const child of node.children) {
      const hSpec = normalizeSize(parseSizeSpec(child.params?.height, 'fill'), child.params?.height, child, 'height', ctx);
      let ch: number;
      switch (hSpec.type) {
        case 'fixed': ch = hSpec.value; break;
        case 'percent': ch = Math.round((r.h * hSpec.value) / 100); break;
        case 'fill': ch = r.h; break;
        default: ch = ctx.measured.get(child)!.h;
      }
      rowH = Math.max(rowH, ch);
    }
    if (rowH > r.h) {
      ctx.diags.push({
        severity: 'warning',
        message: `hstack children exceed height ${r.h} (truncated)`,
        line: node.sourceRange.startLine,
        nodeId: node.id,
      });
      rowH = r.h;
    }
    let x = r.x;
    for (let i = 0; i < node.children.length; i++) {
      const cw = alloc[i];
      if (cw <= 0) continue;
      arrange(node.children[i], { x, y: r.y, w: cw, h: rowH }, c, ctx);
      x += cw - 1; // shared border
    }
    return;
  }

  drawPart(node, r, c, ctx);
}

// --- entry point ---

export function renderASCII(nodes: DSLNode[], options: RenderOptions = {}): RenderResult {
  const W = options.width ?? 80;
  const ctx: Ctx = { diags: [], boxes: [], defaultHeight: options.height ?? 24, measured: new Map() };

  for (const n of nodes) measure(n, ctx);

  const asciiLines: string[] = [];
  const grid: (string | null)[][] = [];
  let yOffset = 0;

  for (const node of nodes) {
    const boxStart = ctx.boxes.length;
    const m = ctx.measured.get(node)!;
    const wSpec = normalizeSize(parseSizeSpec(node.params?.width, isLayout(node.kind) ? 'fill' : 'auto'), node.params?.width, node, 'width', ctx);
    const w = resolveConstrained(wSpec, m.w, W);

    let h: number;
    const hRaw = node.params?.height;
    // Layout roots default to the configurable minimum height; part roots default to auto
    const hSpec = normalizeSize(parseSizeSpec(hRaw, isLayout(node.kind) ? 'fill' : 'auto'), hRaw, node, 'height', ctx);
    if (isLayout(node.kind)) {
      if (hSpec.type === 'fixed') {
        h = hSpec.value;
        if (m.h > h) {
          ctx.diags.push({
            severity: 'warning',
            message: `'${node.kind}' height=${h} is smaller than content (${m.h}); truncated`,
            line: node.sourceRange.startLine,
            nodeId: node.id,
          });
        }
      } else if (hSpec.type === 'auto') {
        h = m.h;
      } else {
        // unspecified / fill / % → default height as minimum, extends with content
        h = Math.max(ctx.defaultHeight, m.h);
      }
    } else {
      h = hSpec.type === 'fixed' ? hSpec.value
        : hSpec.type === 'percent' ? Math.round((ctx.defaultHeight * hSpec.value) / 100)
        : m.h;
    }

    const canvas = new Canvas(w, Math.max(1, h));
    arrange(node, { x: 0, y: 0, w, h }, canvas, ctx);

    if (asciiLines.length > 0) {
      asciiLines.push('');
      grid.push(Array(W).fill(null));
      yOffset++;
    }
    for (let y = 0; y < canvas.h; y++) {
      asciiLines.push(canvas.rowText(y));
      grid.push(canvas.ids[y]);
    }
    // boxes for this root were recorded in canvas-local coords; shift into document coords
    for (let i = boxStart; i < ctx.boxes.length; i++) {
      ctx.boxes[i].rect.y += yOffset;
    }
    yOffset += canvas.h;
  }

  return {
    ascii: asciiLines.join('\n'),
    grid,
    boxes: ctx.boxes,
    diagnostics: ctx.diags,
  };
}
