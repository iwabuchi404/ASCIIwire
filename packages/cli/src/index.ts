#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { parseDSL, renderASCII } from '@asciiwire/core';

const program = new Command();

program
  .name('asciiwire')
  .description('ASCII UI Wireframe Toolchain')
  .version('0.1.0');

program
  .argument('<file>', 'DSL file (Markdown) to render')
  .option('-w, --width <number>', 'Output width', '80')
  .action((file, options) => {
    try {
      const fullPath = path.resolve(file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const ast = parseDSL(content);
      const output = renderASCII(ast, { width: parseInt(options.width, 10) });

      console.log(output);
    } catch (error) {
      console.error('Error rendering DSL:', error);
      process.exit(1);
    }
  });

program.parse();
