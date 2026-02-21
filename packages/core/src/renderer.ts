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
    const halfWidth = Math.floor(width / 2);
    const leftBranch = node.children.find(c => c.kind === 'left');
    const rightBranch = node.children.find(c => c.kind === 'right');

    const leftLines = leftBranch ? renderChildren(leftBranch.children, halfWidth - 1) : [];
    const rightLines = rightBranch ? renderChildren(rightBranch.children, width - halfWidth - 1) : [];

    const maxLines = Math.max(leftLines.length, rightLines.length);
    const result: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const left = (leftLines[i] || '').padEnd(halfWidth - 1);
      const right = (rightLines[i] || '').padEnd(width - halfWidth - 1);
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
  const lines = node.content.split('\n');
  const boxedLines: string[] = [];
  
  // Create a border
  const border = '+' + '-'.repeat(width - 2) + '+';
  boxedLines.push(border);

  for (const line of lines) {
    // Simple wrapping or truncation
    const content = line.substring(0, width - 4);
    boxedLines.push('| ' + content.padEnd(width - 4) + ' |');
  }

  boxedLines.push(border);
  return boxedLines;
}
