import { parseDSL } from './parser.js';

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

const result = parseDSL(sampleDSL);
console.log(JSON.stringify(result, null, 2));
