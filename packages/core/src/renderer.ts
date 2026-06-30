import { DSLNode, RenderResult } from './types.js';

export interface RenderOptions {
  width: number;
}

interface RenderedNode {
  lines: string[];
  ids: string[][];
}

export function renderASCII(nodes: DSLNode[], options: RenderOptions = { width: 80 }): RenderResult {
  const renderedNodes = nodes.map(node => renderNode(node, options.width));
  const lines: string[] = [];
  const grid: string[][] = [];

  for (const rendered of renderedNodes) {
    lines.push(...rendered.lines);
    grid.push(...rendered.ids);
  }

  return {
    ascii: lines.join('\n'),
    grid
  };
}

function renderNode(node: DSLNode, width: number): RenderedNode {
  // Use width from params if available
  if (node.params?.width) {
    const w = parseInt(node.params.width, 10);
    if (!isNaN(w)) width = w;
  }

  if (node.type === 'text') {
    const text = visualSlice(node.content, 0, width);
    return { lines: [text], ids: [makeIdLine(text, node.id)] };
  }
  
  let result: RenderedNode;
  switch (node.type) {
    case 'layout':
      result = renderLayout(node, width);
      break;
    case 'component':
      result = renderComponent(node, width);
      break;
    case 'branch':
      result = renderChildren(node.children, width);
      break;
    default:
      const text = visualSlice(node.content, 0, width);
      result = { lines: [text], ids: [makeIdLine(text, node.id)] };
  }
  return result;
}

// --- Visual Width Helpers ---

/**
 * Calculates the visual width of a string (Half-width = 1, Full-width = 2)
 */
function getVisualWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    // East Asian Width: wide (W) or full-width (F)
    if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2329 && code <= 0x232a) || // Angle brackets
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || // CJK Radicals, Symbols, Kana, Han
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe10 && code <= 0xfe19) || // Vertical forms
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compatibility Forms
      (code >= 0xff00 && code <= 0xff60) || // Full-width forms
      (code >= 0xffe0 && code <= 0xffe6) || // Full-width symbols
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pads a string with spaces until it reaches the desired visual width
 */
function visualPadEnd(str: string, targetWidth: number, padChar: string = ' '): string {
  const currentWidth = getVisualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + padChar.repeat(targetWidth - currentWidth);
}

/**
 * Slices a string based on its visual width
 */
function visualSlice(str: string, start: number, visualWidth: number): string {
  let currentVisualWidth = 0;
  let result = '';
  
  for (const char of str) {
    const charWidth = getVisualWidth(char);
    if (currentVisualWidth + charWidth > visualWidth) {
      break;
    }
    result += char;
    currentVisualWidth += charWidth;
  }
  return result;
}

/**
 * Creates an ids array for a line of text, where each character contributes
 * its visual width in id entries (full-width = 2, half-width = 1).
 */
function makeIdLine(text: string, nodeId: string): string[] {
  const ids: string[] = [];
  for (const char of text) {
    const cw = getVisualWidth(char);
    for (let j = 0; j < cw; j++) ids.push(nodeId);
  }
  return ids;
}

function renderLayout(node: DSLNode, width: number): RenderedNode {
  if (node.kind === 'stack') {
    return renderChildren(node.children, width);
  } else if (node.kind === 'split') {
    let ratio = 0.5;
    const ratioParam = node.params?.ratio || node.params?.value;
    if (ratioParam) {
      if (ratioParam.includes('/')) {
        const [left, right] = ratioParam.split('/').map((n: string) => parseInt(n, 10));
        if (!isNaN(left) && !isNaN(right)) {
          ratio = left / (left + right);
        }
      } else if (!isNaN(parseFloat(ratioParam))) {
        ratio = parseFloat(ratioParam) / 100;
      }
    }

    const leftBranch = node.children.find(c => c.kind === 'left');
    const rightBranch = node.children.find(c => c.kind === 'right');
    const topBranch = node.children.find(c => c.kind === 'top');
    const bottomBranch = node.children.find(c => c.kind === 'bottom');

    // Horizontal split (left/right)
    if (leftBranch || rightBranch) {
      const leftWidth = Math.floor((width - 1) * ratio);
      const rightWidth = width - 1 - leftWidth;

      const leftResult = leftBranch ? renderChildren(leftBranch.children, leftWidth) : { lines: [], ids: [] };
      const rightResult = rightBranch ? renderChildren(rightBranch.children, rightWidth) : { lines: [], ids: [] };

      const maxLines = Math.max(leftResult.lines.length, rightResult.lines.length);
      const lines: string[] = [];
      const ids: string[][] = [];

      for (let i = 0; i < maxLines; i++) {
          const leftLine = visualPadEnd(leftResult.lines[i] || '', leftWidth);
          const rightLine = visualPadEnd(rightResult.lines[i] || '', rightWidth);
          
          const leftIds = (leftResult.ids[i] || []).concat(Array(leftWidth - (leftResult.ids[i]?.length || 0)).fill(leftBranch?.id || node.id));
          const rightIds = (rightResult.ids[i] || []).concat(Array(rightWidth - (rightResult.ids[i]?.length || 0)).fill(rightBranch?.id || node.id));
          
          lines.push(leftLine + '|' + rightLine);
          ids.push([...leftIds, node.id, ...rightIds]);
      }
      return { lines, ids };
    }

    // Vertical split (top/bottom)
    if (topBranch || bottomBranch) {
      const topResult = topBranch ? renderChildren(topBranch.children, width) : { lines: [], ids: [] };
      const bottomResult = bottomBranch ? renderChildren(bottomBranch.children, width) : { lines: [], ids: [] };

      const separator = '-'.repeat(width);
      const lines = [...topResult.lines, separator, ...bottomResult.lines];
      const sepIds = Array(width).fill(node.id);
      const ids = [...topResult.ids, sepIds, ...bottomResult.ids];

      return { lines, ids };
    }
  }
  return { lines: [], ids: [] };
}

function renderChildren(children: DSLNode[], width: number): RenderedNode {
  const lines: string[] = [];
  const ids: string[][] = [];
  for (const child of children) {
    const rendered = renderNode(child, width);
    lines.push(...rendered.lines);
    ids.push(...rendered.ids);
  }
  return { lines, ids };
}

function renderComponent(node: DSLNode, width: number): RenderedNode {
  switch (node.kind) {
    case 'header':
      return renderHeader(node, width);
    case 'table':
      return renderTable(node, width);
    case 'panel':
      return renderPanel(node, width);
    case 'nav':
      return renderNav(node, width);
    case 'list':
      return renderList(node, width);
    case 'footer':
      return renderFooter(node, width);
    default:
      return renderDefaultBox(node, width);
  }
}

function renderNav(node: DSLNode, width: number): RenderedNode {
  const content = node.content.trim();
  const contentWidth = getVisualWidth(content);
  const padding = Math.max(0, Math.floor((width - 4 - contentWidth) / 2));
  
  const textLine = ' '.repeat(padding) + content + ' '.repeat(Math.max(0, width - 4 - contentWidth - padding));
  const line = '  ' + textLine + '  ';
  
  const lines = [' '.repeat(width), line, ' '.repeat(width)];
  const ids = Array(3).fill(null).map(() => Array(width).fill(node.id));
  
  return { lines, ids };
}

function renderHeader(node: DSLNode, width: number): RenderedNode {
  const content = node.content.trim();
  const contentWidth = getVisualWidth(content);
  const border = '='.repeat(width);
  const padding = Math.max(0, Math.floor((width - 4 - contentWidth) / 2));
  const line = '| ' + ' '.repeat(padding) + content + ' '.repeat(width - 4 - contentWidth - padding) + ' |';
  
  const lines = [border, line, border];
  const ids = Array(3).fill(null).map(() => Array(width).fill(node.id));
  
  return { lines, ids };
}

function renderTable(node: DSLNode, width: number): RenderedNode {
  const linesContent = node.content.split('\n').filter(l => l.trim().includes('|'));
  if (linesContent.length === 0) return renderDefaultBox(node, width);

  const rows = linesContent.map(line => 
    line.split('|').map(cell => cell.trim()).filter((_, i, a) => !(i === 0 && !a[i]) && !(i === a.length - 1 && !a[i]))
  ).filter(row => !row.every(cell => cell.match(/^[ :-]+$/)));

  const colWidths: number[] = [];
  rows.forEach(row => {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i] || 0, getVisualWidth(cell));
    });
  });

  const makeSeparator = () => '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const sep = makeSeparator();
  
  if (getVisualWidth(sep) > width) return renderDefaultBox(node, width);

  const formattedRows = rows.map(row => 
    '| ' + row.map((cell, i) => visualPadEnd(cell, colWidths[i])).join(' | ') + ' |'
  );

  const lines = [sep, formattedRows[0], sep, ...formattedRows.slice(1), sep];
  const ids = lines.map(() => Array(getVisualWidth(sep)).fill(node.id));

  return { lines, ids };
}

function renderPanel(node: DSLNode, width: number): RenderedNode {
  const linesContent = node.content.split('\n').filter(l => l.trim() !== '');
  const border = '+' + '-'.repeat(width - 2) + '+';
  const lines = [border];
  for (const lineContent of linesContent) {
    const content = visualSlice(lineContent, 0, width - 4);
    lines.push('| ' + visualPadEnd(content, width - 4) + ' |');
  }
  // Pad to height if specified
  const targetHeight = parseInt(node.params?.height || '0', 10);
  if (targetHeight > linesContent.length) {
    for (let i = linesContent.length; i < targetHeight; i++) {
      lines.push('| ' + visualPadEnd('', width - 4) + ' |');
    }
  }
  lines.push(border);
  
  const ids = lines.map(() => Array(width).fill(node.id));
  return { lines, ids };
}

function renderList(node: DSLNode, width: number): RenderedNode {
  const linesContent = node.content.split('\n').filter(l => l.trim() !== '');
  const lines: string[] = [];
  for (const lineContent of linesContent) {
    const content = visualSlice(lineContent, 0, width);
    lines.push(content);
  }

  const ids: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    ids.push(makeIdLine(lines[i], node.id));
  }

  return { lines, ids };
}

function renderFooter(node: DSLNode, width: number): RenderedNode {
  const content = node.content.trim();
  const contentWidth = getVisualWidth(content);
  const padding = Math.max(0, Math.floor((width - contentWidth) / 2));
  const line = ' '.repeat(padding) + content + ' '.repeat(Math.max(0, width - contentWidth - padding));

  const lines = [' '.repeat(width), line, ' '.repeat(width)];
  const ids = Array(3).fill(null).map(() => Array(width).fill(node.id));

  return { lines, ids };
}

function renderDefaultBox(node: DSLNode, width: number): RenderedNode {
  const linesContent = node.content.split('\n').filter(l => l.trim() !== '');
  const border = '+' + '.'.repeat(width - 2) + '+';
  const lines = [border];
  for (const lineContent of linesContent) {
    const content = visualSlice(lineContent, 0, width - 4);
    lines.push('| ' + visualPadEnd(content, width - 4) + ' |');
  }
  // Pad to height if specified
  const targetHeight = parseInt(node.params?.height || '0', 10);
  if (targetHeight > linesContent.length) {
    for (let i = linesContent.length; i < targetHeight; i++) {
      lines.push('| ' + visualPadEnd('', width - 4) + ' |');
    }
  }
  lines.push(border);
  
  const ids = lines.map(() => Array(width).fill(node.id));
  return { lines, ids };
}
