import { parseDSL, renderASCII } from '../dist/index.js';
import fs from 'fs';

const content = fs.readFileSync('sample.md', 'utf-8');
const ast = parseDSL(content);
console.log('AST Length:', ast.length);
const output = renderASCII(ast, { width: 40 });
console.log('Output Length:', output.length);
console.log('---Output Start---');
console.log(output);
console.log('---Output End---');
