import { parseDSL } from './parser.js';
import { renderASCII } from './renderer.js';

const sampleDSL = `
@vstack
  @header
    [ Logo ] News Portal [ Settings ] [ Logout ]
  @hstack
    @panel width=30%
      - title
      - summary
    @table width=fill
      | date | title | status |
      |------|-------|--------|
`;

const { nodes, diagnostics } = parseDSL(sampleDSL);
const result = renderASCII(nodes, { width: 60 });
console.log(result.ascii);
if (diagnostics.length || result.diagnostics.length) {
  console.error('Diagnostics:', [...diagnostics, ...result.diagnostics]);
}
