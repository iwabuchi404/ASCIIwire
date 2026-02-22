import { DSLNode } from './types.js';

export interface RenderOptions {
  width: number;
}

export function renderASCII(nodes: DSLNode[], options: RenderOptions = { width: 80 }): string {
  return nodes.map(node => renderNode(node, options.width).join('\n')).join('\n');
}

function renderNode(node: DSLNode, width: number): string[] {
  if (node.type === 'text') {
    return [visualSlice(node.content, 0, width)];
  }
  switch (node.type) {
    case 'layout':
      return renderLayout(node, width);
    case 'component':
      return renderComponent(node, width);
    case 'branch':
      return renderChildren(node.children, width);
    default:
      return [visualSlice(node.content, 0, width)];
  }
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

function renderLayout(node: DSLNode, width: number): string[] {
  if (node.kind === 'stack') {
    return renderChildren(node.children, width);
  } else if (node.kind === 'split') {
    let ratio = 0.5;
    const ratioParam = node.params?.value;
    if (ratioParam && ratioParam.includes('/')) {
      const [left, right] = ratioParam.split('/').map(n => parseInt(n, 10));
      if (!isNaN(left) && !isNaN(right)) {
        ratio = left / (left + right);
      }
    }

    const leftWidth = Math.floor((width - 1) * ratio);
    const rightWidth = width - 1 - leftWidth;

    const leftBranch = node.children.find(c => c.kind === 'left');
    const rightBranch = node.children.find(c => c.kind === 'right');

    const leftLines = leftBranch ? renderChildren(leftBranch.children, leftWidth) : [];
    const rightLines = rightBranch ? renderChildren(rightBranch.children, rightWidth) : [];

    const maxLines = Math.max(leftLines.length, rightLines.length);
    const result: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const left = visualPadEnd(leftLines[i] || '', leftWidth);
      const right = visualPadEnd(rightLines[i] || '', rightWidth);
      result.push(left + '|' + right);
    }
    return result;
  }
  return [];
}

function renderChildren(children: DSLNode[], width: number): string[] {
  let result: string[] = [];
  for (const child of children) {
    const childLines = renderNode(child, width);
    if (result.length > 0) {
      // Add a separator or just append?
      // For now, just append.
    }
    result = result.concat(childLines);
  }
  return result;
}

function renderComponent(node: DSLNode, width: number): string[] {
  switch (node.kind) {
    case 'header':
      return renderHeader(node, width);
    case 'table':
      return renderTable(node, width);
    case 'panel':
      return renderPanel(node, width);
    case 'nav':
      return renderNav(node, width);
    default:
      return renderDefaultBox(node, width);
  }
}

function renderNav(node: DSLNode, width: number): string[] {
  const content = node.content.trim();
  const contentWidth = getVisualWidth(content);
  // Nav is often smaller, we don't necessarily box it or we use a different border
  const padding = Math.max(0, Math.floor((width - 4 - contentWidth) / 2));
  const line = ' '.repeat(padding) + content + ' '.repeat(width - 4 - contentWidth - padding);
  return [' '.repeat(width), '  ' + line + '  ', ' '.repeat(width)];
}

function renderHeader(node: DSLNode, width: number): string[] {
  const content = node.content.trim();
  const contentWidth = getVisualWidth(content);
  const border = '='.repeat(width);
  // Center content
  const padding = Math.max(0, Math.floor((width - 4 - contentWidth) / 2));
  const line = '| ' + ' '.repeat(padding) + content + ' '.repeat(width - 4 - contentWidth - padding) + ' |';
  return [border, line, border];
}

function renderTable(node: DSLNode, width: number): string[] {
  const lines = node.content.split('\n').filter(l => l.trim().includes('|'));
  if (lines.length === 0) return renderDefaultBox(node, width);

  const rows = lines.map(line => 
    line.split('|').map(cell => cell.trim()).filter((_, i, a) => !(i === 0 && !a[i]) && !(i === a.length - 1 && !a[i]))
  ).filter(row => !row.every(cell => cell.match(/^[ :-]+$/)));

  const colWidths: number[] = [];
  rows.forEach(row => {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i] || 0, getVisualWidth(cell));
    });
  });

  // Simple border
  const makeSeparator = () => '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const sep = makeSeparator();
  
  const formattedRows = rows.map(row => 
    '| ' + row.map((cell, i) => visualPadEnd(cell, colWidths[i])).join(' | ') + ' |'
  );

  const result = [sep, formattedRows[0], sep, ...formattedRows.slice(1), sep];
  // If too wide, fallback to default for now or truncate
  if (getVisualWidth(sep) > width) return renderDefaultBox(node, width);
  return result;
}

function renderPanel(node: DSLNode, width: number): string[] {
  const lines = node.content.split('\n');
  const border = '+' + '-'.repeat(width - 2) + '+';
  const result = [border];
  for (const line of lines) {
    const content = visualSlice(line, 0, width - 4);
    result.push('| ' + visualPadEnd(content, width - 4) + ' |');
  }
  result.push(border);
  return result;
}

function renderDefaultBox(node: DSLNode, width: number): string[] {
  const lines = node.content.split('\n');
  const border = '+' + '.'.repeat(width - 2) + '+';
  const result = [border];
  for (const line of lines) {
    const content = visualSlice(line, 0, width - 4);
    result.push('| ' + visualPadEnd(content, width - 4) + ' |');
  }
  result.push(border);
  return result;
}
