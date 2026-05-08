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

## 未実施

- [ ] Android実機Chromeでの表示確認
- [ ] ホーム画面追加後の起動確認
- [ ] 実PDFアップロードによる手動分析の実機操作確認
- [ ] Cloudflare Pages本番デプロイ確認
- [ ] Cloudflare Workers proxy本番デプロイ確認

## 補足

in-app Browserで `localhost:5173` 操作がセキュリティポリシーにより拒否されたため、スマホ幅の視覚確認は未実施。
