import { DSLNode, NodeKind } from './types.js';

export function parseDSL(markdown: string): DSLNode[] {
  const lines = markdown.split(/\r?\n/);
  const root: DSLNode[] = [];
  const stack: DSLNode[] = [];

  const headingRegex = /^(#+)\s+(layout:|component:|left:|right:|top:|bottom:)?\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(headingRegex);

    if (match) {
      const level = match[1].length;
      const prefix = match[2]?.replace(':', '').trim();
      const value = match[3].trim();

      const branchPrefixes = ['left', 'right', 'top', 'bottom'];
      const isLayout = prefix === 'layout';
      const isComponent = prefix === 'component';
      const isBranch = prefix && branchPrefixes.includes(prefix);

      const type = isLayout ? 'layout' : isComponent ? 'component' : isBranch ? 'branch' : 'text';
      let kind = (isLayout || isComponent ? value : prefix || value) as NodeKind;
      const params: Record<string, string> = {};

      // Handle parameters (e.g., split 30/70)
      if (isLayout || isComponent) {
        const parts = value.split(/\s+/);
        if (parts.length > 1) {
          kind = parts[0] as NodeKind;
          params['value'] = parts.slice(1).join(' ');
        }
      }

      const node: DSLNode = {
        level,
        type,
        kind,
        params: Object.keys(params).length > 0 ? params : undefined,
        content: isBranch || isLayout || isComponent ? '' : value, // Keep value for text nodes
        children: []
      };

      // Find parent in stack
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
    } else if (stack.length > 0) {
      // Add content to the current node
      const currentNode = stack[stack.length - 1];
      if (currentNode.content) {
        currentNode.content += '\n' + line;
      } else {
        currentNode.content = line;
      }
    }
  }

  // Trim content for all nodes
  const trimContent = (nodes: DSLNode[]) => {
    for (const node of nodes) {
      node.content = node.content.trim();
      trimContent(node.children);
    }
  };
  trimContent(root);

  trimContent(root);

  return root;
}
