import { parseDSL } from './parser.js';
import { renderASCII } from './renderer.js';

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
const ascii = renderASCII(ast, { width: 60 });
console.log(ascii);
