import { parseDSL } from './parser.js';

const sampleDSL = `
# layout: stack

### component: header
[ Logo ] News Portal [ 設定 ] [ ログアウト ]

## layout: split
### left:
#### component: table
| date | title | status |
|------|-------|--------|

### right:
#### component: panel
- title
- meta
- summary
[ Open ] [ Mark as read ]
`;

const ast = parseDSL(sampleDSL);
console.log(JSON.stringify(ast, null, 2));
