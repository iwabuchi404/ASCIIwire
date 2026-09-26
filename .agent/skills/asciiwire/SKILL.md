---
name: asciiwire_dsl
description: Instructions for AI agents to generate and understand ASCIIwire DSL v3 for UI wireframing.
---

# ASCIIwire DSL v3 Generation Skill

This skill provides instructions on how to generate the ASCIIwire DSL v3, which is used to define UI wireframes that can be rendered into ASCII art.

## DSL General Rules

1. **Element syntax**: `@<kind> [key=value ...]` — the kind is written directly (e.g. `@panel`, never `@component panel`).
2. **Nesting**: 2-space indentation defines the hierarchy. Deeper lines are children of the nearest element above.
3. **Content**: indented non-`@` lines below an element are its text content.
4. **Comments**: lines starting with `#` are ignored and do not affect hierarchy.
5. **Escaping**: `@@` at the start of a content line renders a literal `@`.
6. **Params**: `key=value`. Values containing spaces may be quoted: `key="a b"`.
7. **Multiple roots**: each root-level element renders as a separate screen.

## Layout Kinds

- `@vstack` — arranges children vertically
- `@hstack` — arranges children horizontally

Parts (`panel`, `header`, etc.) may also contain child elements; they stack vertically.

## Component Kinds

`header`, `table`, `panel`, `nav`, `list`, `footer`. Unknown kinds render as a dotted default box with a warning — the DSL still parses.

## Sizing

`width` / `height` accept:

- `N` — absolute cells (e.g. `width=20`)
- `N%` — fraction of the parent (e.g. `width=30%`)
- `fill` — evenly shares the remaining space
- `auto` — derived from content (default when unspecified)

Other params: `id=name` gives a stable node ID.

## Example

```
@vstack
  @header
    [ Logo ] News Portal [ Settings ] [ Logout ]
  @hstack height=fill
    @vstack width=30%
      @nav
        [ Home ] [ Users ]
      @table height=fill
        | date | title | status |
        |------|-------|--------|
    @panel width=fill id=detail
      - title
      - summary
      [ Open ]
  @footer
    v1.0.0
```

## Usage in Prompting

When asked to "design a UI" using ASCIIwire:
1. Wrap the DSL in a code block.
2. Start with a root `@vstack` (or `@hstack`).
3. Use nested layouts to structure the page; put content lines under part elements.
4. Prefer `width=30%`/`width=fill` proportions over guessing absolute widths.
