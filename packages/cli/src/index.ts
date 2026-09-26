#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { parseDSL, renderASCII } from '@asciiwire/core';
import { AI_GUIDE } from './ai-guide.js';

const program = new Command();

program
  .name('asciiwire')
  .description('ASCII UI Wireframe Toolchain')
  .version('0.1.0');

program
  .command('llm')
  .description('Output guide for AI agents to generate DSL')
  .action(() => {
    console.log(AI_GUIDE);
  });

program
  .argument('[file]', 'DSL file to render')
  .option('-w, --width <number>', 'Output width', '80')
  .option('--height <number>', 'Default height for root layouts', '24')
  .action((file, options) => {
    if (!file) {
      program.help();
      return;
    }
    try {
      const fullPath = path.resolve(file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const { nodes, diagnostics } = parseDSL(content);
      const result = renderASCII(nodes, {
        width: parseInt(options.width, 10),
        height: parseInt(options.height, 10),
      });

      console.log(result.ascii);

      const allDiags = [...diagnostics, ...result.diagnostics];
      for (const d of allDiags) {
        const loc = d.line !== undefined ? `line ${d.line + 1}: ` : '';
        console.error(`${d.severity}: ${loc}${d.message}`);
      }
    } catch (error) {
      console.error('Error rendering DSL:', error);
      process.exit(1);
    }
  });

program.parse();
