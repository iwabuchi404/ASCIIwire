import { describe, it, expect } from 'vitest';
import { parseDSL } from '../src/parser.js';
import { renderASCII } from '../src/renderer.js';

describe('DSL Parser', () => {
  it('should parse simple stack and components', () => {
    const dsl = `@layout stack
  @component header
    Hello`;
    const ast = parseDSL(dsl);
    expect(ast).toHaveLength(1);
    expect(ast[0].kind).toBe('stack');
    expect(ast[0].children).toHaveLength(1);
    expect(ast[0].children[0].kind).toBe('header');
    expect(ast[0].children[0].content.trim()).toBe('Hello');
  });

  it('should parse split layout with left/right branches', () => {
    const dsl = `@layout split ratio=50/50
  @branch left
    @component panel
      A
  @branch right
    @component panel
      B`;
    const ast = parseDSL(dsl);
    expect(ast[0].kind).toBe('split');
    expect(ast[0].children).toHaveLength(2);
    expect(ast[0].children[0].kind).toBe('left');
    expect(ast[0].children[1].kind).toBe('right');
  });

  it('should parse parameters (height, width, ratio)', () => {
    const dsl = `@layout split ratio=30/70
  @branch left
    @component panel height=10 width=60
      Content`;
    const ast = parseDSL(dsl);
    expect(ast[0].params?.ratio).toBe('30/70');
    expect(ast[0].children[0].children[0].params?.height).toBe('10');
    expect(ast[0].children[0].children[0].params?.width).toBe('60');
  });

  it('should skip comments and empty lines', () => {
    const dsl = `# This is a comment
@layout stack

  @component header
    # This is content, not a comment
    Hello`;
    const ast = parseDSL(dsl);
    expect(ast).toHaveLength(1);
    expect(ast[0].kind).toBe('stack');
    expect(ast[0].children[0].kind).toBe('header');
    expect(ast[0].children[0].content).toContain('Hello');
    expect(ast[0].children[0].content).not.toContain('This is a comment');
  });
});

describe('ASCII Renderer', () => {
  it('should render boxed components', () => {
    const dsl = `@layout stack
  @component header
    Hello`;
    const ast = parseDSL(dsl);
    const result = renderASCII(ast, { width: 20 });
    expect(result.ascii).toContain('====');
    expect(result.ascii).toContain('Hello');
  });

  it('should render split layout', () => {
    const dsl = `@layout split ratio=50/50
  @branch left
    @component panel
      A
  @branch right
    @component panel
      B`;
    const ast = parseDSL(dsl);
    const result = renderASCII(ast, { width: 40 });
    expect(result.ascii).toContain('|');
    expect(result.ascii).toContain('A');
    expect(result.ascii).toContain('B');
  });

  it('should render panel with height padding', () => {
    const dsl = `@layout stack
  @component panel height=5
    Line1`;
    const ast = parseDSL(dsl);
    const result = renderASCII(ast, { width: 20 });
    const lines = result.ascii.split('\n');
    // border + 5 content lines + border = 7 lines
    expect(lines.length).toBe(7);
  });
});
