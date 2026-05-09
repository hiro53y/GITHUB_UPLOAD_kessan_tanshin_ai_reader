# テストチェックリスト

## 実施済み

- [x] `npm install --ignore-scripts --no-bin-links --no-audit --no-fund` が成功
- [x] `node node_modules/typescript/bin/tsc --noEmit` が成功
- [x] `npm run build` が成功
- [x] `npm run dev -- --smoke` が成功
- [x] `http://localhost:5173` がHTTP 200を返す
- [x] `manifest.webmanifest` が生成される
- [x] `/assets/app.js` がHTTP 200を返す
- [x] 開発サーバーproxy経由でTDnet検索結果HTMLを取得できる
- [x] TDnet公開PDFを `pdfjs-dist` で読み、1ページ目のテキストを抽出できる
- [x] `dist/assets/app.js` に `process.env` / `import.meta.env` が残らない
- [x] Cloudflare Pages用 `_headers` / `_redirects` が `dist/` に生成される
- [x] 外部AI APIキー入力欄を実装していない
- [x] 取得失敗時の手動PDFアップロード/PDF URL案内を実装している
- [x] 標準ルール分析だけでレポート生成する
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader` にGitHubアップロード用ファイル一式がある
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader` に `node_modules/`、`dist/`、`out/`、`github_upload/` が含まれない
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader` に `src/src`、`public/public`、`scripts/scripts`、`worker/worker` の重複コピーが含まれない
- [x] `node node_modules/typescript/bin/tsc --noEmit -p deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/tsconfig.json` が成功
- [x] `scripts/build.mjs` の未宣言依存 `@rollup/plugin-node-resolve` をローカルresolverに置換
- [x] `.node-version` / `.nvmrc` でNode.js 20を指定
- [x] Cloudflare Pages Functions proxy `functions/api/proxy.ts` を追加
- [x] PDF URL取得fallbackに `/api/proxy` を追加
- [x] 無料AI要約を外部APIなしで実装
- [x] Yahoo!ファイナンス銘柄コード検索リンクを追加
- [x] 修正後の `npm run build` が成功
- [x] 修正後の `npm run dev -- --smoke` が成功
- [x] ローカル開発サーバーで `/` と `/api/proxy?url=...I_head` がHTTP 200を返す
- [x] Service Worker cache名を更新し、旧cache削除とassets network-firstを実装
- [x] `dist/index.html` が `/assets/app-20260509-3.js` と `/assets/index-20260509-3.css` を参照している
- [x] ホーム先頭に「改修版 2026-05-09.3」カードを追加

## 未実施

- [ ] このOneDrive環境での再 `npm install` はEPERMで失敗。Cloudflare Pagesなどクリーン環境で再確認する。
- [ ] Android実機Chromeでの表示確認
- [ ] ホーム画面追加後の起動確認
- [ ] 実PDFアップロードによる手動分析の実機操作確認
- [ ] Cloudflare Pages本番デプロイ確認
- [ ] Cloudflare Workers proxy本番デプロイ確認
- [ ] OneDrive外の完全クリーン環境での `npm ci && npm run build`

## 補足

in-app Browserで `localhost:5173` 操作がセキュリティポリシーにより拒否されたため、スマホ幅の視覚確認は未実施。

2026-05-09の追加検証で `npm install --ignore-scripts --no-bin-links --no-audit --no-fund` とローカルcache指定の再インストールは、OneDrive配下の `node_modules` / npm cache のEPERMで失敗した。`node_modules` はGitHubアップロード対象外であり、`npm run build` と `npm run dev -- --smoke` は修復後に成功している。
