export const AI_GUIDE = `
# ASCIIwire DSL v3 Guide for AI Agents

ASCIIwire is a DSL for defining UI wireframes that can be rendered into ASCII art. Use this guide to generate valid DSL.

## Syntax

- **Element lines**: \`@<kind> [key=value ...]\`
- **Content lines**: Indented lines that don't start with \`@\`
- **Comments**: Lines starting with \`#\`
- **Indentation**: 2 spaces per nesting level
- **Escaping**: Use \`@@\` to include a literal \`@\` in content
- **Quoted values**: \`key="value with spaces"\` (escape quotes as \`\\"\`)

## Kinds

| Syntax | Description |
|---|---|
| \`@vstack\` | Vertical stack container |
| \`@hstack\` | Horizontal stack container |
| \`@header\` | Centered text with \`=\` border |
| \`@table\` | Markdown table syntax in content |
| \`@panel\` | Box with solid border (\`+--+\`) |
| \`@nav\` | Centered navigation text (borderless) |
| \`@list\` | Plain text lines (borderless) |
| \`@footer\` | Centered text (borderless) |

Unknown kinds render as a dotted box (\`+..+\`) and produce a warning. Keep content inside.

## Sizing

\`width\` and \`height\` accept: \`N\` (chars/lines), \`N%\`, \`fill\`, \`auto\`.
Defaults: \`width=fill\`, \`height=auto\`.

- In \`@hstack\`, \`width\` distributes horizontal space: fixed → \`%\` → \`auto\` → \`fill\` splits the remainder.
- In \`@vstack\`, \`width\` is the maximum width and \`height\` distributes vertical space the same way.
- A root layout (\`@vstack\`/\`@hstack\`) without \`height\` uses the default height (24 lines) as a minimum and grows with content.
- Each root element is a separate screen.
- \`id=name\` assigns a stable name to an element (unique per screen).

## Example DSL

\`\`\`
@vstack
  @header
    My Application
  @hstack
    @panel width=20
      Navigation
      - Home
      - Settings
    @panel width=fill
      Main Content Area
      Welcome to the dashboard!
    @panel width=30% id=detail
      Detail
  @footer
    v1.0.0 | (c) 2024
\`\`\`

## Rules for AI output

- Always use \`@\` + kind directly (e.g. \`@panel\`, never \`@component panel\`)
- Keep indentation consistent at 2 spaces
- Prefer \`fill\` for the main content area and fixed/\`%\` widths for sidebars
- Put a single \`@vstack\` or \`@hstack\` at the root per screen; use multiple roots for multiple screens
`.trim();
