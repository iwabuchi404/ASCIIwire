export type NodeKind =
  | 'hstack' | 'vstack'                      // layout containers
  | 'header' | 'table' | 'panel' | 'nav' | 'list' | 'footer'  // parts
  | 'layer' | 'grid'                        // spec-finalized / reserved
  | string;                                 // unknown kinds are kept

export interface DSLNode {
  id: string;
  level: number;
  kind: NodeKind;
  params?: Record<string, string>;
  content: string;
  /** 0-based line numbers of this node's own content lines (excludes descendant lines) */
  contentLineNos?: number[];
  children: DSLNode[];
  /** Line range covering the element line, its content lines, AND all descendant elements */
  sourceRange: {
    startLine: number;
    endLine: number;
  };
}

export type Severity = 'warning' | 'error';

export interface Diagnostic {
  severity: Severity;
  message: string;
  line?: number;
  nodeId?: string;
}

export interface ParseResult {
  nodes: DSLNode[];
  diagnostics: Diagnostic[];
}

export type SizeSpec =
  | { type: 'fixed'; value: number }
  | { type: 'percent'; value: number }
  | { type: 'fill' }
  | { type: 'auto' };

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutBox {
  nodeId: string;
  kind: string;
  rect: BoxRect;
}

export interface RenderResult {
  ascii: string;
  /** 2D array of node ids, one entry per visual column. null where no node claims the cell. */
  grid: (string | null)[][];
  /** Absolute position/size of every rendered node (hit-testing, click-to-jump, anchor-to) */
  boxes: LayoutBox[];
  diagnostics: Diagnostic[];
}
