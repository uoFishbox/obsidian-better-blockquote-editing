# Better Blockquote Editing

Obsidianのcallout・引用を、標準のMarkdownエディタでその場で編集するプラグインです。外側の `>` を意識せず、テーマの装飾を保ったまま本文やタイトルを編集できます。

Obsidian 1.14.4以降のLive Previewに対応しています。

## 使い方

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat)プラグインに `https://github.com/uoFishbox/obsidian-better-blockquote-editing` を登録し、インストール後有効化してください。
2. Live Previewでcallout・引用内にカーソルを移動するとエディタが開きます。calloutの本文やタイトルのクリック／タップでも開けます。
3. 通常のMarkdownと同じように編集できます。
4. **Esc**、**Ctrl+Enter**（**Cmd+Enter**）、右上の閉じるアイコンをクリックするか、矢印キーでエディタ外にキャレットを移動すると編集を終了します。

- calloutのタイトルもObsidian標準のMarkdownエディタでその場で編集でき、リンク補完や書式コマンドを利用できます。入れ子のcallout・引用にも対応しています。
- calloutの左上アイコンをクリックすると、タイプを選ぶモーダルが開きます。標準タイプ・別名を検索でき、カスタムタイプ名も入力できます。
- 矢印キーで本文・タイトル間やブロックの外へ移動できます。タイトルで **Enter** を押すと本文へ移動します。

## 注意点

- Source mode、Reading view、リスト項目内の引用は対象外です。
- 折りたたみ指定はSource modeで変更してください。
- **何らかの問題が生じて同期停止が表示された場合、未反映の内容は元ノートに保存されません。表示されたモーダルから本文をコピーしてから閉じてください。**
- 他プラグインとの完全な互換性は保証できません。

## 開発

Node.js 22以降を使用してください。

```sh
npm ci
npm test
npm run build
```

開発中の自動ビルドは `npm run dev` で起動します。

Obsidian CLIが使える環境では、プラグインを有効にして実機テストを実行できます。

```sh
npm run test:obsidian -- <vault-name>
```
