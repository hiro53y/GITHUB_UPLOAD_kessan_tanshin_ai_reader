# Codex 開発ルール

## 必須方針

- 外部LLM APIを使わない。
- 有料APIを使わない。
- 投資助言表現を出さない。
- 売買推奨、価格目標、投資判断の断定、将来株価の予測を実装しない。
- 完了確認には必ず `npm run build` を使う。
- UIは添付画像の雰囲気を優先する。
- 添付画像とプロンプト本文が矛盾する場合は、プロンプト本文を優先する。

## 技術ルール

- React + TypeScript + Tailwind CSS + PWAで実装する。
- TDnet公開ページ取得はベストエフォートとして扱う。
- 取得失敗は正常ケースとし、手動PDFアップロードまたはPDF URL貼り付けへ誘導する。
- 取得ロジックは `src/lib/disclosureFetcher.ts` に集約する。
- PDF解析は `pdfjs-dist` を使う。
- 分析は標準ルール分析だけで完結させる。
- 無料AI要約は外部APIなしの端末内抽出型要約として扱う。
- 履歴と設定はlocalStorageを使う。

## 検証ルール

- `npm install` または環境制約時の代替コマンドを確認する。
- `npm run build` を実行する。
- `npm run dev` または同等のローカル起動を確認する。
- 外部LLM APIキー入力欄や自動送信処理を追加しない。
- CORSやTDnet構造変更で失敗した場合の案内を残す。

## フォルダルール

- `input/` は読み取り専用。
- `out/` は中間生成物とログ。
- アプリ成果物は `deliverables/` 直下にGitHubアップロード用の1フォルダとして保存する。
- その1フォルダをGitHubリポジトリのルートとしてアップロードすれば、Cloudflare Pagesでビルドできる状態にする。
- GitHubアップロード用フォルダには `src/`、`public/`、`functions/`、`worker/`、`scripts/`、設定ファイル、README、AGENTS、TASKSを含める。
- GitHubアップロード用フォルダには `node_modules/`、`dist/`、`out/`、`.npm-cache/`、`.wrangler/`、二重の `github_upload/` を含めない。
- 既存の `deliverables/` 内ファイルは上書きしない。
- `CLAUDE.md` は変更しない。
