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
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_FIXED` に修正版クリーンフォルダを作成
- [x] `out/fixed_build_test_20260509` の検証コピーで `npm run build` が成功
- [x] 一時クリーン環境で `npm install --ignore-scripts --no-audit --no-fund` が成功（2026-06-20）
- [x] `npm test` が成功（2ファイル・17件、2026-06-20）
- [x] 一時クリーン環境で `npm run build` が成功（app / worker / Pages Functionsの型チェックを含む）
- [x] 一時クリーン環境で `npm run dev -- --smoke` が成功
- [x] ローカル `/api/disclosures?ticker=7203&lookbackDays=120` がHTTP 200を返す
- [x] `7203` からトヨタ自動車の2026年3月期決算短信（2026/05/08）を取得できる
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_20260620` にGitHubアップロード用ファイル一式がある
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_20260620` に `node_modules/`、`dist/`、`out/`、`.npm-cache/`、`.wrangler/` が含まれない
- [x] 5451を30日設定で除外する条件を再現し、最新決算探索が120日へ拡張される回帰テストを追加（2026-06-25）
- [x] `npm test` が成功（2ファイル・18件、2026-06-25）
- [x] `npm run typecheck` が成功（app / worker / Pages Functions）
- [x] クリーンな一時環境で `npm run build` が成功
- [x] `npm run dev -- --smoke` が成功
- [x] ローカル `/api/disclosures?ticker=5451&lookbackDays=120` がHTTP 200を返す
- [x] 5451からヨドコウの2026年3月期決算短信（2026/05/11）を取得できる
- [x] 取得した5451のPDFがHTTP 200・`application/pdf`・`%PDF-1.4`であることを確認
- [x] `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_20260625_5451_FIX` に64ファイルがあり、禁止フォルダ・ルートとの差分がない

## 未実施

- [ ] Android実機Chromeでの表示確認
- [ ] ホーム画面追加後の起動確認
- [ ] 実PDFアップロードによる手動分析の実機操作確認
- [ ] Cloudflare Pages本番デプロイ確認
- [ ] Cloudflare Workers proxy本番デプロイ確認
- [ ] OneDrive外の完全クリーン環境での `npm ci && npm run build`

## 補足

in-app Browserで `127.0.0.1:5173` 操作がセキュリティポリシーにより拒否されたため、スマホ幅の視覚確認は未実施。HTTP API、テスト、ビルド、起動確認は完了している。
