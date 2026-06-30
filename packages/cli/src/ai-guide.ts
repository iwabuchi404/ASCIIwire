export const AI_GUIDE = `
# ASCIIwire DSL Guide for AI Agents

ASCIIwire is a DSL for defining UI wireframes that can be rendered into ASCII art. Use this guide to generate valid DSL.

## Syntax

- **Element lines**: Start with \`@\` followed by type, kind, and optional parameters
- **Content lines**: Indented lines that don't start with \`@\`
- **Comments**: Lines starting with \`#\`
- **Indentation**: 2 spaces per nesting level
- **Escaping**: Use \`@@\` to include a literal \`@\` in content

## Element Types

| Syntax | Description |
|---|---|
| \`@layout <kind> [params]\` | Container: \`stack\`, \`split\` |
| \`@component <kind> [params]\` | UI Element: \`header\`, \`table\`, \`panel\`, \`nav\`, \`list\`, \`footer\` |
| \`@branch <kind>\` | Split branch: \`left\`, \`right\`, \`top\`, \`bottom\` |

## Parameters (key=value only)

| Parameter | Applies to | Default | Example |
|---|---|---|---|
| \`ratio=A/B\` | split | 50/50 | \`@layout split ratio=30/70\` |
| \`width=N\` | component | 80 | \`@component panel width=60\` |
| \`height=N\` | panel, default-box | content lines | \`@component panel height=10\` |

## Layouts

- **stack**: Vertically stacks children
- **split**: Horizontally or vertically splits into branches
  - Horizontal: \`@branch left\` / \`@branch right\`
  - Vertical: \`@branch top\` / \`@branch bottom\`

## Components

- **header**: Centered text with \`=\` border
- **table**: Markdown table syntax in content
- **panel**: Box with solid border (\`+--+\`)
- **nav**: Centered navigation text
- **list**: Plain text lines
- **footer**: Centered text with padding
- **default**: Dotted border (\`+..+\`) for unknown kinds

## Example DSL

\`\`\`
@layout stack
  @component header
    My Application

  @layout split ratio=30/70
    @branch left
      @component panel height=6
        Navigation
        - Home
        - Settings
    @branch right
      @component panel
        Main Content Area
        Welcome to the dashboard!

  @component table
    | ID | User  | Role   |
    |----|-------|--------|
    | 1  | Alice | Admin  |
\`\`\`
`.trim();
