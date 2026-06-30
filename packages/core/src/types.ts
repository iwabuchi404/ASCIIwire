export type NodeKind = 'stack' | 'split' | 'table' | 'header' | 'nav' | 'panel' | 'list' | 'text' | string;

export interface DSLNode {
  id: string;
  level: number;
  type: 'layout' | 'component' | 'branch' | 'text';
  kind: NodeKind;
  params?: Record<string, string>;
  content: string;
  children: DSLNode[];
  sourceRange?: {
    startLine: number;
    endLine: number;
  };
}

export interface RenderResult {
  ascii: string;
  grid: string[][]; // 2D array of node IDs
}

export interface ParseResult {
  root: DSLNode[];
}
