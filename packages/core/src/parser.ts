import { DSLNode, NodeKind } from './types.js';

export function parseDSL(source: string): DSLNode[] {
  const lines = source.split(/\r?\n/);
  const root: DSLNode[] = [];
  const stack: { node: DSLNode; indent: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Calculate indentation level (spaces only, 2 spaces per level)
    const indentMatch = line.match(/^( *)/);
    const indentSpaces = indentMatch ? indentMatch[1].length : 0;
    const indentLevel = Math.floor(indentSpaces / 2);

    // Check if this is an element line (@ prefix)
    if (trimmed.startsWith('@')) {
      // Parse: @type kind key=value key=value...
      const elementContent = trimmed.slice(1).trim();
      const parts = elementContent.split(/\s+/);
      const typeStr = parts[0];

      let type: 'layout' | 'component' | 'branch' | 'text';
      if (typeStr === 'layout') type = 'layout';
      else if (typeStr === 'component') type = 'component';
      else if (typeStr === 'branch') type = 'branch';
      else type = 'text';

      const kind = (parts[1] || typeStr) as NodeKind;
      const params: Record<string, string> = {};

      for (let j = 2; j < parts.length; j++) {
        const part = parts[j];
        if (part.includes('=')) {
          const [k, v] = part.split('=');
          params[k] = v;
        } else {
          params['value'] = part;
        }
      }

      // Pop stack until we find the parent
      while (stack.length > 0 && stack[stack.length - 1].indent >= indentLevel) {
        stack.pop();
      }

      // Deterministic ID based on tree path (depth + sibling index)
      const siblingIndex = stack.length === 0
        ? root.length
        : stack[stack.length - 1].node.children.length;
      const parentId = stack.length === 0
        ? 'root'
        : stack[stack.length - 1].node.id;
      const nodeId = `${parentId}-${siblingIndex}`;

      const node: DSLNode = {
        id: nodeId,
        level: indentLevel,
        type,
        kind,
        params: Object.keys(params).length > 0 ? params : undefined,
        content: '',
        children: [],
        sourceRange: { startLine: i, endLine: i }
      };

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({ node, indent: indentLevel });
    } else {
      // Content line - belongs to the current top of stack
      if (stack.length === 0) continue;

      // Unescape @@ to @
      const contentLine = trimmed.replace(/^@@/, '@');

      const currentNode = stack[stack.length - 1].node;
      if (currentNode.content === '') {
        currentNode.content = contentLine;
      } else {
        currentNode.content += '\n' + contentLine;
      }
      currentNode.sourceRange!.endLine = i;
    }
  }

  return root;
}
