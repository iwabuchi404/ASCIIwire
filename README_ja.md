# ASCIIwire

ASCIIwireは、AIと人間がワイヤーフレームを介してUIを共同設計するためのテキストベース・ツールチェーンです。「AIが出力しやすく、人間が確認・修正しやすい」を両立することを目的としています。

## コンセプト

- **DSL（構造）** をコアに置く。
- **アスキーアート（確認用）** を生成し、コードブロック内で表示する。
- **VSCode拡張（GUIエディタ）** により、直感的な編集を可能にする。

## モノレポ構成

- `packages/core`: DSLパーサー ＋ レンダラー（共通ロジック）。
- `packages/cli`: CLIツール（開発中）。
- `packages/vscode`: VSCode拡張（開発中）。
- `packages/mcp`: MCPサーバー（開発中）。

## DSLフォーマット（Markdownベース）

Markdownの見出しを利用して構造とレイアウトを定義します。

```markdown
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
- summary
[ Open ]
```

## 開発の始め方

### 前提条件

- Node.js (v20+)
- pnpm

### インストール

```bash
pnpm install
```

### ビルドとテスト

```bash
# 全パッケージのビルド
pnpm build

# coreパッケージのテスト実行
pnpm --filter @asciiwire/core test
```

## ライセンス

MIT
