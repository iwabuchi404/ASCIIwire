export const AI_GUIDE = `
# ASCIIwire DSL Guide for AI Agents

ASCIIwire is a DSL for defining UI wireframes that can be rendered into ASCII art. Use this guide to generate valid DSL.

## General Rules

1. **Hierarchy**: Use Markdown heading levels (#, ##, ###) for nesting.
2. **Type/Kind Prefix**: Headings must start with one of these:
   - \`layout: [kind]\`: Container (\`stack\`, \`split\`)
   - \`component: [kind]\`: UI Element (\`header\`, \`table\`, \`nav\`, \`panel\`)
   - \`left:\`, \`right:\`: Branches for \`split\` layout.
3. **Content**: Text after a heading (until next heading) is the content/data of that node.

## Layouts

- **stack**: Vertically stacks children.
- **split [ratio]**: Horizontally splits into \`left:\` and \`right:\`.
  - Example: \`# layout: split 30/70\` sets a 30:70 width ratio. Default is 50/50.

## Components

- **header**: Centered text with border.
- **table**: Markdown table content.
- **panel**: Box with solid border (\`+--+\`).
- **nav**: Navigation elements center-aligned.
- **default**: Box with dotted border (\`+..+\`) for any other components.

## Example DSL

\`\`\`markdown
# layout: stack

## component: header
My Application

## layout: split 30/70
### left:
#### component: panel
Navigation
- Home
- Settings

### right:
#### component: panel
Main Content Area
Welcome to the dashboard!

## component: table
| ID | User | Role |
|----|------|------|
| 1  | Admin| Super|
\`\`\`
`.trim();
