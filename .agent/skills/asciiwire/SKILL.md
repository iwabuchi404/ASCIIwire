---
name: asciiwire_dsl
description: Instructions for AI agents to generate and understand ASCIIwire DSL for UI wireframing.
---

# ASCIIwire DSL Generation Skill

This skill provides instructions on how to generate the ASCIIwire DSL, which is used to define UI wireframes that can be rendered into ASCII art.

## DSL General Rules

1. **Heading Levels**: Use Markdown heading levels (`#`, `##`, `###`, etc.) to represent nesting depth.
2. **Type/Kind Detection**: Use prefixes in the heading content to specify the type.
   - `layout: [kind]`: Defines a layout container (e.g., `stack`, `split`).
   - `component: [kind]`: Defines a UI component (e.g., `header`, `table`, `nav`, `panel`).
   - `left:`, `right:`, `top:`, `bottom:`: Defines branches for layouts like `split`.
3. **Content**: Any text following a heading until the next heading of the same or higher level belongs to that element.

## Layout Kinds

### Stack (`layout: stack`)
Arranges children vertically.

### Split (`layout: split`)
Arranges exactly two children (`left:` and `right:`) horizontally. Currently fixed at 50/50 width ratio.

## Component Examples

Components contain raw text or markdown-like patterns inside them.

### Header
```markdown
### component: header
[ Logo ] Menu Item | Search [ Login ]
```

### Table
```markdown
### component: table
| Name | Role | Status |
|------|------|--------|
| Alice| Dev  | Active |
```

## Usage in Prompting

When asked to "design a UI" using ASCIIwire:
1. Always wrap the DSL in a `markdown` code block.
2. Start with a top-level `# layout: stack`.
3. Use nested layouts to structure the page.
4. Ensure human-readable labels and clear component types.
