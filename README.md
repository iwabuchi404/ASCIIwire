# ASCIIwire

ASCIIwire is a text-based toolchain designed for collaborative UI design between AI and humans through wireframes. It aims to achieve both "easy for AI to output" and "easy for humans to verify and modify".

## Concept

- **DSL (Structure)** is the core.
- **ASCII Art (Verification)** is generated for display in code blocks.
- **Visual Editor (VSCode Extension)** allows GUI manipulation.

## Monorepo Structure

- `packages/core`: DSL parser and ASCII renderer (shared logic).
- `packages/cli`: CLI tool for DSL to ASCII conversion (TBD).
- `packages/vscode`: VSCode extension for visual editing (TBD).
- `packages/mcp`: MCP server for AI integration (TBD).

## DSL Format (Markdown-based)

ASCIIwire uses Markdown headings to define structure and layout.

```markdown
# layout: stack

### component: header
[ Logo ] News Portal [ Settings ] [ Logout ]

## layout: split
### left:
#### component: table
| date | title | status |
|------|-------|--------|

### right:
#### component: panel
- title
- summary
[ Open ]
```

### Rendering Output

```text
======================================================================
|            [ Logo ] News Portal [ Settings ] [ Logout ]            |
======================================================================
+------+-------+--------+         |+---------------------------------+
| date | title | status |         || - title                         |
+------+-------+--------+         || - summary                       |
+------+-------+--------+         || [ Open ]                        |
                                  |+---------------------------------+
```

## Getting Started

### Prerequisites

- Node.js (v20+)
- pnpm

### Installation

```bash
pnpm install
```

### Build & Test

```bash
# Build all packages
pnpm build

# Run tests for core
pnpm --filter @asciiwire/core test
```

## License

MIT
