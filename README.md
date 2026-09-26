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

## DSL Format (v3)

ASCIIwire uses an `@`-prefixed DSL with 2-space indentation to define structure and layout.

```
@vstack
  @header
    [ Logo ] News Portal [ Settings ] [ Logout ]
  @hstack height=12
    @vstack width=40%
      @table height=fill
        | date | title | status |
        |------|-------|--------|
        | 6/30 | Hello | done |
    @panel width=fill
      - title
      - summary
      [ Open ]
```

Element syntax: `@<kind> [key=value ...]`. Layout kinds are `vstack` / `hstack`; component kinds include `header`, `table`, `panel`, `nav`, `list`, `footer`. Sizes accept `N`, `N%`, `fill`, or `auto`.

### Rendering Output

```text
======================================================================
|            [ Logo ] News Portal [ Settings ] [ Logout ]            |
+------+-------+--------+==+-----------------------------------------+
| date | title | status |  | - title                                 |
+------+-------+--------+  | - summary                               |
| 6/30 | Hello | done   |  | [ Open ]                                |
+------+-------+--------+  +-----------------------------------------+
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
