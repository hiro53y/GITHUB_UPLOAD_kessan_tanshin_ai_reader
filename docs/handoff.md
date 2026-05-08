# 引き継ぎメモ

## 現在の状況

決算短信AIリーダーMVPを実装済み。`npm run build` は成功。`npm run dev -- --smoke` と開発サーバーのHTTP 200を確認済み。

GitHubへアップロードする対象は `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` の1フォルダ。Cloudflare Pagesではこのフォルダ内容をリポジトリルートとして扱い、Build commandを `npm run build`、Build output directoryを `dist` にする。

## 主な変更

- React/TypeScript/Tailwind/PWA基盤を追加
- TDnet公開検索、候補スコアリング、PDF抽出、標準ルール分析を追加
- ホーム、取得中、取得結果、レポート、履歴、設定画面を追加
- 手動PDFアップロード、PDF URL分析、履歴保存を追加
- Cloudflare Workers proxyサンプルを追加
- README、AGENTS、TASKS、仕様、判断記録、テストチェックリストを更新
- `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` にGitHubアップロード用の単一フォルダを作成
- GitHubアップロード用フォルダ側でTypeScriptチェックを確認
- Cloudflare Pages用 `_headers` / `_redirects` と Workers proxy用 `worker/wrangler.toml` を追加
- 独自ビルドのブラウザ実行時クラッシュ要因だった `process.env.NODE_ENV` / `import.meta.env` の残存を修正

## 未完了

- 実機Android Chromeでのホーム画面追加確認
- 本番HTTPSホスティングへの配置
- Cloudflare Workers proxyの実Cloudflare環境でのデプロイ確認
- TDnet構造変更時の継続メンテナンス

## 注意点

- TDnet公開閲覧は掲載期間とCORSに依存するため、取得失敗は正常ケース。
- 外部LLM APIは未実装。APIキー入力欄もない。
- ブラウザ視覚確認はセキュリティポリシーで拒否されたため、HTTP応答、TDnet proxy、ビルド成果物、実PDF抽出確認に留めた。
- `deliverables/kessan_tanshin_ai_reader/`、`deliverables/kessan_tanshin_ai_reader_clean/`、`deliverables/UPLOAD_THIS_TO_GITHUB_kessan_tanshin_ai_reader/` は作業途中の旧フォルダ。OneDriveのロックや重複コピーが残ったため、GitHubへはアップロードしない。
