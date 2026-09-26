import { DSLNode, Diagnostic, ParseResult } from './types.js';

const KNOWN_KINDS = new Set([
  'hstack', 'vstack',
  'header', 'table', 'panel', 'nav', 'list', 'footer',
]);

/** Spec-finalized or reserved kinds: kept, rendered as default box, warned once each. */
const DEFERRED_KINDS: Record<string, string> = {
  layer: "not yet implemented (rendered in normal flow)",
  grid: "reserved kind (rendered as a default box)",
};

/** Tokenize an element line, keeping "..." spans (with \" escapes) as single tokens. */
function tokenizeElement(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote && ch === '\\' && text[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur !== '') { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur !== '') tokens.push(cur);
  return tokens;
}

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseDSL(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const root: DSLNode[] = [];
  const diagnostics: Diagnostic[] = [];
  const stack: { node: DSLNode; indent: number }[] = [];
  const warnedKinds = new Set<string>();
  let strayContentWarned = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const indentMatch = line.match(/^( *)/);
    const indentSpaces = indentMatch ? indentMatch[1].length : 0;
    const indentLevel = Math.floor(indentSpaces / 2);

    // Element line: '@' not followed by '@' ('@@' is escaped content)
    const isElement = trimmed.startsWith('@') && !trimmed.startsWith('@@');

    if (isElement) {
      // Pop stack until we find the parent
      while (stack.length > 0 && stack[stack.length - 1].indent >= indentLevel) {
        stack.pop();
      }

      if (stack.length > 0 && indentLevel > stack[stack.length - 1].indent + 1) {
        diagnostics.push({
          severity: 'warning',
          message: `Indent jumps ${indentLevel - stack[stack.length - 1].indent} levels (2 spaces per level expected)`,
          line: i,
        });
      }

      // This line belongs to the ancestors' subtrees
      for (const s of stack) s.node.sourceRange.endLine = i;

      // Parse: @kind key=value key="quoted value" ...
      const elementContent = trimmed.slice(1).trim();
      const tokens = tokenizeElement(elementContent);
      const kind = tokens[0] || '';
      const params: Record<string, string> = {};

      for (let j = 1; j < tokens.length; j++) {
        const part = tokens[j];
        const eq = part.indexOf('=');
        if (eq === -1) {
          params[part] = '';
          diagnostics.push({
            severity: 'warning',
            message: `Parameter '${part}' has no value (expected key=value)`,
            line: i,
          });
        } else {
          params[part.slice(0, eq)] = unquote(part.slice(eq + 1));
        }
      }

      // Deterministic ID based on tree path (depth + sibling index)
      const siblingIndex = stack.length === 0
        ? root.length
        : stack[stack.length - 1].node.children.length;
      const parentId = stack.length === 0
        ? 'root'
        : stack[stack.length - 1].node.id;
      const nodeId = `${parentId}-${siblingIndex}`;

      if (!KNOWN_KINDS.has(kind) && !(kind in DEFERRED_KINDS)) {
        diagnostics.push({
          severity: 'warning',
          message: `Unknown kind '${kind}' (rendered as a default box)`,
          line: i,
        });
      } else if (kind in DEFERRED_KINDS && !warnedKinds.has(kind)) {
        warnedKinds.add(kind);
        diagnostics.push({
          severity: 'warning',
          message: `'@${kind}' is ${DEFERRED_KINDS[kind]}`,
          line: i,
        });
      }

      const node: DSLNode = {
        // A user-assigned id takes precedence; uniqueness is checked per root below
        id: params.id || nodeId,
        level: indentLevel,
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
      if (stack.length === 0) {
        if (!strayContentWarned) {
          strayContentWarned = true;
          diagnostics.push({
            severity: 'warning',
            message: 'Content outside any element is ignored',
            line: i,
          });
        }
        continue;
      }

      // Unescape @@ to @
      const contentLine = trimmed.replace(/^@@/, '@');

      // Content lines are inside every ancestor's range
      for (const s of stack) s.node.sourceRange.endLine = i;

      const currentNode = stack[stack.length - 1].node;
      if (currentNode.content === '') {
        currentNode.content = contentLine;
      } else {
        currentNode.content += '\n' + contentLine;
      }
      (currentNode.contentLineNos ??= []).push(i);
    }
  }

  // Custom id uniqueness check: first occurrence wins within each root
  for (const rootNode of root) {
    const seen = new Set<string>();
    const walk = (node: DSLNode) => {
      if (node.params?.id) {
        if (seen.has(node.id)) {
          diagnostics.push({
            severity: 'warning',
            message: `Duplicate id '${node.id}' (first occurrence is used)`,
            line: node.sourceRange.startLine,
            nodeId: node.id,
          });
        } else {
          seen.add(node.id);
        }
      }
      node.children.forEach(walk);
    };
    walk(rootNode);
  }

  return { nodes: root, diagnostics };
}
