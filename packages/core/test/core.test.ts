import { describe, it, expect } from 'vitest';
import { parseDSL } from '../src/parser.js';
import { renderASCII } from '../src/renderer.js';

describe('DSL Parser', () => {
  it('should parse simple stack and components', () => {
    const dsl = `
# layout: stack
### component: header
Hello
`;
    const ast = parseDSL(dsl);
    expect(ast).toHaveLength(1);
    expect(ast[0].kind).toBe('stack');
    expect(ast[0].children).toHaveLength(1);
    expect(ast[0].children[0].kind).toBe('header');
    expect(ast[0].children[0].content).toBe('Hello');
  });

  it('should parse split layout with left/right branches', () => {
    const dsl = `
# layout: split
## left:
### component: a
## right:
### component: b
`;
    const ast = parseDSL(dsl);
    expect(ast[0].kind).toBe('split');
    expect(ast[0].children).toHaveLength(2);
    expect(ast[0].children[0].kind).toBe('left');
    expect(ast[0].children[1].kind).toBe('right');
  });
});

describe('ASCII Renderer', () => {
  it('should render boxed components', () => {
    const dsl = `### component: test\nContent`;
    const ast = parseDSL(dsl);
    const ascii = renderASCII(ast, { width: 20 });
    expect(ascii).toContain('+------------------+');
    expect(ascii).toContain('| Content          |');
  });

  it('should render split layout', () => {
    const dsl = `
# layout: split
## left:
### component: left
## right:
### component: right
`;
    const ast = parseDSL(dsl);
    const ascii = renderASCII(ast, { width: 40 });
    const lines = ascii.split('\n');
    expect(lines[0]).toMatch(/\|/); // Should contain separator
  });
});
