import { describe, it, expect } from 'vitest';
import { parseDSL } from '../src/parser.js';
import { renderASCII } from '../src/renderer.js';

describe('DSL Parser (v3)', () => {
  it('should parse @kind elements with indent hierarchy', () => {
    const { nodes, diagnostics } = parseDSL(`@vstack
  @header
    Hello`);
    expect(diagnostics).toHaveLength(0);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('vstack');
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].kind).toBe('header');
    expect(nodes[0].children[0].content.trim()).toBe('Hello');
  });

  it('should parse key=value and quoted parameters', () => {
    const { nodes } = parseDSL(`@vstack
  @panel width=30% title="a b c" id=detail
    X`);
    const p = nodes[0].children[0];
    expect(p.params?.width).toBe('30%');
    expect(p.params?.title).toBe('a b c');
    expect(p.id).toBe('detail');
  });

  it('sourceRange covers descendants', () => {
    const { nodes } = parseDSL(`@vstack
  @panel
    content
  @panel
    more`);
    // vstack range covers all element + content lines
    expect(nodes[0].sourceRange.endLine).toBe(4);
    expect(nodes[0].children[0].sourceRange.endLine).toBe(2);
  });

  it('warns on unknown kind, bare params, and duplicate ids', () => {
    const { diagnostics } = parseDSL(`@vstack
  @weird
    x
  @panel id=a
  @panel id=a badparam`);
    const msgs = diagnostics.map(d => d.message).join('\n');
    expect(msgs).toContain("Unknown kind 'weird'");
    expect(msgs).toContain("Duplicate id 'a'");
    expect(msgs).toContain("'badparam' has no value");
  });

  it('warns on indent jumps', () => {
    const { diagnostics } = parseDSL(`@vstack
      @panel
        x`);
    expect(diagnostics.some(d => d.message.includes('Indent jumps'))).toBe(true);
  });

  it('treats @@ as escaped content, not an element', () => {
    const { nodes } = parseDSL(`@panel
  @@notanelement`);
    expect(nodes[0].children).toHaveLength(0);
    expect(nodes[0].content).toContain('@notanelement');
  });
});

describe('ASCII Renderer (v3)', () => {
  it('should render vstack with header and shared borders', () => {
    const { nodes } = parseDSL(`@vstack
  @header
    Hello
  @panel
    Box`);
    const r = renderASCII(nodes, { width: 20, height: 10 });
    expect(r.ascii).toContain('====');
    expect(r.ascii).toContain('Hello');
    expect(r.ascii).toContain('+--');
  });

  it('should distribute hstack widths: fixed, percent, fill', () => {
    const { nodes } = parseDSL(`@vstack
  @hstack height=5
    @panel width=10
      A
    @panel width=50%
      B
    @panel width=fill
      C`);
    const r = renderASCII(nodes, { width: 40, height: 10 });
    const boxes = Object.fromEntries(r.boxes.map(b => [b.nodeId, b.rect]));
    const hstack = nodes[0].children[0];
    expect(boxes[hstack.children[0].id].w).toBe(10);
    expect(boxes[hstack.children[1].id].w).toBe(Math.round(42 * 0.5));
    expect(boxes[hstack.children[2].id].w).toBe(42 - 10 - Math.round(42 * 0.5));
  });

  it('should apply default height 24 to root layouts', () => {
    const { nodes } = parseDSL(`@vstack
  @panel
    x`);
    const r = renderASCII(nodes, { width: 20 });
    expect(r.ascii.split('\n')).toHaveLength(24);
  });

  it('should let fill children absorb remaining height', () => {
    const { nodes } = parseDSL(`@vstack
  @header
    T
  @panel height=fill
    Body`);
    const r = renderASCII(nodes, { width: 20, height: 10 });
    const panel = r.boxes.find(b => b.kind === 'panel')!;
    expect(panel.rect.h + panel.rect.y).toBe(10);
  });

  it('should render unknown kinds as dotted boxes with warning', () => {
    const { nodes } = parseDSL(`@vstack
  @custom
    hi`);
    const r = renderASCII(nodes, { width: 20, height: 6 });
    expect(r.ascii).toContain('+.');
    expect(r.ascii).toContain('hi');
  });

  it('should treat multiple roots as separate screens', () => {
    const { nodes } = parseDSL(`@header
  One
@header
  Two`);
    const r = renderASCII(nodes, { width: 20 });
    const lines = r.ascii.split('\n');
    expect(lines.filter(l => l === '')).toHaveLength(1); // separator blank line
    expect(r.ascii).toContain('One');
    expect(r.ascii).toContain('Two');
  });

  it('hstack children without height spec stretch to the row height', () => {
    const { nodes } = parseDSL(`@vstack
  @hstack height=fill
    @vstack width=30%
      @nav
        menu
    @panel width=fill
      body`);
    const r = renderASCII(nodes, { width: 40, height: 20 });
    const hstackNode = nodes[0].children[0];
    const hstack = r.boxes.find(b => b.nodeId === hstackNode.id)!;
    const childIds = new Set(hstackNode.children.map(c => c.id));
    const childBoxes = r.boxes.filter(b => childIds.has(b.nodeId));
    expect(childBoxes).toHaveLength(2);
    for (const b of childBoxes) {
      expect(b.rect.h).toBe(hstack.rect.h);
    }
  });

  it('should warn and truncate when fixed height overflows', () => {
    const { nodes } = parseDSL(`@vstack height=4
  @panel height=8
    x`);
    const r = renderASCII(nodes, { width: 20 });
    expect(r.diagnostics.some(d => d.message.includes('exceeds') || d.message.includes('truncated'))).toBe(true);
    expect(r.ascii.split('\n')).toHaveLength(4);
  });
});
