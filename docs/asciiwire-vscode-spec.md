# ASCIIwire VSCode Extension — 設計ドキュメント

## コンセプト

`.wire`ファイルを開いたとき、テキスト編集とアスキーアートプレビューを同一ウィンドウで提供するVSCode拡張。AIが出力したDSLを人間がさっと確認・修正してAIに返せる、軽量な編集環境を目指す。

---

## ファイル形式

- 拡張子: `.wire`
- 内容: ASCIIwire DSL v2（`@` プレフィックス + インデント階層）
- `.wire`を開いた瞬間に拡張が自動起動する

---

## 画面構成

```
+--------------------------------------------------+
| wire.md  [テキストモード][マウスモード]  [コピー ▾] |  ← タイトルバー
+-------------------------+------------------------+
|                         |                        |
|   DSLテキストエディタ      |  アスキーアートプレビュー |
|   （左ペイン）             |  （右ペイン）           |
|                         |                        |
|   @layout stack         |  +-----------------+   |
|     @component header   |  | Header          |   |
|   ...                   |  +-----------------+   |
|                         |  | Table  | Panel  |   |
|                         |  +-----------------+   |
+-------------------------+------------------------+
```

左ペインはVSCodeの標準テキストエディタをそのまま使用。右ペインはWebviewでアスキーアートをレンダリング。

---

## モード

### テキストモード（デフォルト・最小版で実装）

左ペインのDSLを直接テキスト編集する。編集に応じて右ペインのプレビューがリアルタイムで更新される。

### マウスモード（後続バージョンで実装）

右ペインのアスキーアート上でマウス操作が可能になる。内部では2次元配列でセル状態を管理し、操作結果をDSLに書き戻す。最小操作はボックスの描画・移動・リサイズ、テキストラベルの編集。

ステータスバーのボタンでモード切り替え。

---

## コピー機能

エディタタイトルバーの`[コピー ▾]`ボタンからメニューを展開して選択する。`.wire`を開いたときのみ表示される。

| メニュー項目 | クリップボードの内容 |
|------------|-----------------|
| アスキーアートをコピー（デフォルト） | アスキーアートのみ |
| DSLをコピー | DSLのみ |
| 両方をコピー | アスキーアート＋HTMLコメント内にDSL |

両方コピーの出力形式:

```
+------------------+
| Header           |
+------------------+

<!-- asciiwire-dsl
@layout stack
  @component header
-->
```

AIはコメント内のDSLを優先して読む。人間には見えないので共有時にノイズにならない。

---

## プレビュー仕様

### フォント
VSCodeのエディタフォントをCSS変数で継承する。ユーザーが設定済みの等幅フォントがそのまま使われるため、日本語環境でも自然に表示される。

```css
pre {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}
```

### テーマ
VSCodeのダーク/ライトテーマに自動追従する。CSS変数（`--vscode-editor-background`等）を使用してWebview内の配色を同期する。

### エラー時の挙動
DSLにパースエラーがある場合、プレビューペインにエラー内容を表示する。最後の正常状態には戻らず、エラーを明示する。

```
[Error] line 3: "component:" の後にコンポーネント種別が必要です
```

---

## リアルタイムプレビューの仕組み

```
DSLテキスト編集
  ↓ onChange イベント
@asciiwire/core でレンダリング
  ↓ エラー時はエラーメッセージを表示
WebviewPanel にアスキーアートを送信
  ↓
<pre>タグで等幅フォント表示（VSCodeフォント継承）
```

WebviewはVSCode標準のWebviewPanelを使用。`@asciiwire/core`をWebview内でバンドルしてレンダリングを完結させる。

---

## 技術構成

```
asciiwire-vscode/
  src/
    extension.ts       ← エントリポイント、.wire.md に紐付け
    previewPanel.ts    ← WebviewPanel の管理
    copyMenu.ts        ← コピーメニューの実装
  webview/
    index.html         ← プレビュー表示
    renderer.js        ← @asciiwire/core のバンドル
  package.json
```

### 依存関係

- `@asciiwire/core` — DSLパーサー＋アスキーアートレンダラー
- VSCode Extension API — CustomEditor、WebviewPanel、StatusBarItem

### ファイル紐付け

`package.json`の`contributes`で`.wire`をトリガーとして登録する。

```json
"activationEvents": ["onLanguage:wire"],
"contributes": {
  "languages": [{
    "id": "wire",
    "extensions": [".wire"]
  }]
}
```

---

## 実装フェーズ

### Phase 1（最小版・宣伝可能な状態）

- `.wire`を開いたら自動でプレビューが起動
- DSL編集→リアルタイムプレビュー更新
- コピーメニュー（3種類）
- テキストモードのみ

### Phase 2

- マウスモードの実装
- ボックス描画・移動
- DSL書き戻し

### Phase 3

- コンポーネントのリサイズ（`height=N` / `width=N` パラメータ更新）
- ラベル編集
- `asciiwire open`コマンドとのCLI連携

---

## 未解決事項

- 全角文字の幅計算（`@asciiwire/core`側の問題だが表示品質に影響する）→ 実装済み
- マウスモードでの操作とDSL同期の詳細設計（Phase 2着手時に別途設計）→ 実装済み（`height=N`/`width=N`パラメータ更新方式）
- DSL v2移行スクリプト（`.wire.md` → `.wire` 変換）
