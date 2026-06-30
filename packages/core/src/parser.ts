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
      if (stack.length > 0) {
        // Close range for current node if next heading found
        stack[stack.length - 1].sourceRange!.endLine = i; // 0-indexed, exclusive end
      }
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

      // Handle parameters (e.g., split ratio=60 or split 1/1)
      if (isLayout || isComponent) {
        const parts = value.split(/\s+/);
        kind = parts[0] as NodeKind;
        for (let j = 1; j < parts.length; j++) {
            const part = parts[j];
            if (part.includes('=')) {
                const [k, v] = part.split('=');
                params[k] = v;
            } else {
                params['value'] = part;
            }
        }
      }

      const node: DSLNode = {
        id: `node-${i}-${Math.random().toString(36).substr(2, 5)}`,
        level,
        type,
        kind,
        params: Object.keys(params).length > 0 ? params : undefined,
        content: '',
        children: [],
        sourceRange: { startLine: i, endLine: i } // 0-indexed
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
      // Add content to the current node (skip empty lines)
      const lineTrim = line.trim();
      if (lineTrim === '') continue;
      const currentNode = stack[stack.length - 1];
      if (currentNode.content === '') {
          currentNode.content = line;
      } else {
          currentNode.content += '\n' + line;
      }
      currentNode.sourceRange!.endLine = i; // 0-indexed, inclusive end
    }
  }

  return root;
}
