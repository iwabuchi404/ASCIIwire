import { DSLNode } from './types.js';

export interface RenderOptions {
  width: number;
}

export function renderASCII(nodes: DSLNode[], options: RenderOptions = { width: 80 }): string {
  return nodes.map(node => renderNode(node, options.width).join('\n')).join('\n');
}

function renderNode(node: DSLNode, width: number): string[] {
  switch (node.type) {
    case 'layout':
      return renderLayout(node, width);
    case 'component':
      return renderComponent(node, width);
    case 'branch':
      return renderChildren(node.children, width);
    default:
      return [node.content];
  }
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

    const leftWidth = Math.floor((width - 3) * ratio);
    const rightWidth = width - 3 - leftWidth;

    const leftBranch = node.children.find(c => c.kind === 'left');
    const rightBranch = node.children.find(c => c.kind === 'right');

    const leftLines = leftBranch ? renderChildren(leftBranch.children, leftWidth) : [];
    const rightLines = rightBranch ? renderChildren(rightBranch.children, rightWidth) : [];

    const maxLines = Math.max(leftLines.length, rightLines.length);
    const result: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const left = (leftLines[i] || '').padEnd(leftWidth);
      const right = (rightLines[i] || '').padEnd(rightWidth);
      result.push(left + ' | ' + right);
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
  // Nav is often smaller, we don't necessarily box it or we use a different border
  const padding = Math.max(0, Math.floor((width - 4 - content.length) / 2));
  const line = ' '.repeat(padding) + content + ' '.repeat(width - 4 - content.length - padding);
  return [' '.repeat(width), '  ' + line + '  ', ' '.repeat(width)];
}

function renderHeader(node: DSLNode, width: number): string[] {
  const content = node.content.trim();
  const border = '='.repeat(width);
  // Center content
  const padding = Math.max(0, Math.floor((width - 4 - content.length) / 2));
  const line = '| ' + ' '.repeat(padding) + content + ' '.repeat(width - 4 - content.length - padding) + ' |';
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
      colWidths[i] = Math.max(colWidths[i] || 0, cell.length);
    });
  });

  // Simple border
  const makeSeparator = () => '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const sep = makeSeparator();
  
  const formattedRows = rows.map(row => 
    '| ' + row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + ' |'
  );

  const result = [sep, formattedRows[0], sep, ...formattedRows.slice(1), sep];
  // If too wide, fallback to default for now or truncate
  if (sep.length > width) return renderDefaultBox(node, width);
  return result;
}

function renderPanel(node: DSLNode, width: number): string[] {
  const lines = node.content.split('\n');
  const border = '+' + '-'.repeat(width - 2) + '+';
  const result = [border];
  for (const line of lines) {
    const content = line.substring(0, width - 4);
    result.push('| ' + content.padEnd(width - 4) + ' |');
  }
  result.push(border);
  return result;
}

function renderDefaultBox(node: DSLNode, width: number): string[] {
  const lines = node.content.split('\n');
  const border = '+' + '.'.repeat(width - 2) + '+';
  const result = [border];
  for (const line of lines) {
    const content = line.substring(0, width - 4);
    result.push('| ' + content.padEnd(width - 4) + ' |');
  }
  result.push(border);
  return result;
}
