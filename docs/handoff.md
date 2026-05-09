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
- Cloudflareクリーン環境向けにビルドスクリプトの未宣言依存を外し、Node.js 20指定の `.node-version` / `.nvmrc` を追加
- Cloudflare Pages Functionsの同一オリジンproxy `functions/api/proxy.ts` を追加
- PDF URL取得とTDnet取得のfallback順を、開発proxy、Pages proxy、Worker proxy、直接取得の順に変更
- レポートの確認誘導文言を「根拠ページ・読みどころ」に変更
- 外部APIなしの無料AI要約カードを追加
- Yahoo!ファイナンスの銘柄コード検索リンクをホームに追加
- PWAのService Worker cacheを更新し、古い画面が残る問題を修正
- JS/CSSをバージョン付きファイル名に変更し、ホーム先頭に「改修版 2026-05-09.3」カードを追加
- 2026-05-09.4で、ホーム先頭を「要約強化版」に更新し、無料AI診断の表示内容を業績診断・良い点・注意点・主要数値中心に変更
- PDF URL貼り付けはTDnet以外でも、HTTPSかつ `.pdf` のURLならPages proxyを通すように変更
- 2026-05-09.5で、決算短信1ページ目の業績表を優先解析し、売上高・営業利益・経常利益・純利益の前年差、通期予想、配当予想を自然文で要約するように変更

## 未完了

- 実機Android Chromeでのホーム画面追加確認
- 本番HTTPSホスティングへの配置
- Cloudflare Pages Functions proxyの実Cloudflare環境での動作確認
- Cloudflare Workers proxyの実Cloudflare環境でのデプロイ確認
- TDnet構造変更時の継続メンテナンス

## 注意点

- TDnet公開閲覧は掲載期間とCORSに依存するため、取得失敗は正常ケース。
- 外部LLM APIは未実装。APIキー入力欄もない。無料AI要約は端末内の抽出型要約。
- ブラウザ視覚確認はセキュリティポリシーで拒否されたため、HTTP応答、TDnet proxy、ビルド成果物、実PDF抽出確認に留めた。
- `deliverables/kessan_tanshin_ai_reader/`、`deliverables/kessan_tanshin_ai_reader_clean/`、`deliverables/UPLOAD_THIS_TO_GITHUB_kessan_tanshin_ai_reader/` は作業途中の旧フォルダ。OneDriveのロックや重複コピーが残ったため、GitHubへはアップロードしない。
- ローカルでの再 `npm install` / クリーン `npm ci` はOneDrive配下のEPERMで失敗する場合がある。Cloudflare Pages側ではリポジトリ直下で `npm run build` を実行する。
- `node_modules/`、`dist/`、`.npm-cache/`、`.npm-pack-cache/`、`.manual-rollup/` はGitHubアップロード対象外。`.gitignore` に含めている。
- 既にスマホで旧版を開いていた場合、初回アクセス時にService Worker更新で自動リロードされる。まだ旧表示ならChromeのサイトデータ削除または強制再読み込みで確認する。
- 新版が表示されていれば、ホーム最上部に「要約強化版 2026-05-09.5」カードが見える。
