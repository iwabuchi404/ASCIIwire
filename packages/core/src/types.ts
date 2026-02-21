export type NodeKind = 'stack' | 'split' | 'table' | 'header' | 'nav' | 'panel' | 'list' | 'text' | string;

export interface DSLNode {
  level: number;
  type: 'layout' | 'component' | 'branch' | 'text';
  kind: NodeKind;
  content: string;
  children: DSLNode[];
}

export interface ParseResult {
  root: DSLNode[];
}
