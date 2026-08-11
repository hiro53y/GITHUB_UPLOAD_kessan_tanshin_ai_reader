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
- [x] 当時は別名の修正版フォルダを作成（現在は削除済み。以後は正本のみを上書き）
- [x] `out/fixed_build_test_20260509` の検証コピーで `npm run build` が成功
- [x] 一時クリーン環境で `npm install --ignore-scripts --no-audit --no-fund` が成功（2026-06-20）
- [x] `npm test` が成功（2ファイル・17件、2026-06-20）
- [x] 一時クリーン環境で `npm run build` が成功（app / worker / Pages Functionsの型チェックを含む）
- [x] 一時クリーン環境で `npm run dev -- --smoke` が成功
- [x] ローカル `/api/disclosures?ticker=7203&lookbackDays=120` がHTTP 200を返す
- [x] `7203` からトヨタ自動車の2026年3月期決算短信（2026/05/08）を取得できる
- [x] 2026-06-20版は当時の別名フォルダで検証（現在は削除済み。内容は正本へ統合）
- [x] 2026-06-20版で配布禁止物がないことを当時確認（現在の配布対象は正本のみ）
- [x] 5451を30日設定で除外する条件を再現し、最新決算探索が120日へ拡張される回帰テストを追加（2026-06-25）
- [x] `npm test` が成功（2ファイル・18件、2026-06-25）
- [x] `npm run typecheck` が成功（app / worker / Pages Functions）
- [x] クリーンな一時環境で `npm run build` が成功
- [x] `npm run dev -- --smoke` が成功
- [x] ローカル `/api/disclosures?ticker=5451&lookbackDays=120` がHTTP 200を返す
- [x] 5451からヨドコウの2026年3月期決算短信（2026/05/11）を取得できる
- [x] 取得した5451のPDFがHTTP 200・`application/pdf`・`%PDF-1.4`であることを確認
- [x] 2026-06-25版は当時の別名フォルダで検証（現在は削除済み。内容は正本へ統合）
- [x] デバッグ精査の修正後、清浄コピーで `tsc --noEmit`（app/worker/Pages Functionsの3構成）が全てエラー0（2026-06-29）
- [x] `vitest run` が成功（3ファイル・19件、新規 xbrlExtract.test.ts を含む、2026-06-29）
- [x] `scripts/build.mjs`（`npm run build` のバンドル工程）が成功し `dist` 生成（2026-06-29）
- [x] XBRL金額1e6過大の回帰テストが、修正前は失敗（'12345000000'）・修正後は成功（'12345'）することを確認（2026-06-29）
- [x] charset判定デコード追加後も既存JPXテスト（charsetヘッダ無し→UTF-8フォールバック）が通ることを確認（2026-06-29）
- [x] `npm run accuracy` が成功（公式PDF 1件 + 合成回帰5件、2ファイル・6テスト、2026-08-11）
- [x] 公式PDFから実績4指標・通期予想4指標・年間配当・警告・根拠ページがゴールド期待値に一致（2026-08-11）
- [x] 精度版単体で `npm test` が成功（10ファイル・75件、2026-08-11）
- [x] `npm run typecheck` が成功（app / Worker / Pages Functions、2026-08-11）
- [x] `npm run build` が成功し `dist` を生成（2026-08-11）
- [x] `npm run dev -- --smoke` が成功しHTTP起動確認が完了（2026-08-11）
- [x] PDF対象ページ品質、億円/単位不明、XBRL累計context/Summary優先、期間・連結不一致抑止の回帰テストが成功（2026-08-11）
- [x] AI構造化出力のschema・根拠・数値トークン・ページ・入力hashのWorker/クライアント二重検証テストが成功（2026-08-11）
- [x] 精度向上版をGit管理済みの正本 `GITHUB_UPLOAD_kessan_tanshin_ai_reader` へ統合（2026-08-11）
- [x] 正本で `npm run accuracy` 2ファイル・6テスト、全15ファイル・128テスト、3構成typecheck、build、起動smokeを再確認（2026-08-11）
- [x] build `2026-08-11.1`、PWA cache更新、旧dist成果物clean、AI中断/timeout、履歴復元、PDF/XBRL境界、proxy SSRF/redirect/本文上限/情報漏洩の回帰確認（2026-08-11）
- [x] Pages AIをService binding経由に限定し、Worker DOのIP別・AI全体二重上限とfail closedを確認（2026-08-11）

## 未実施

- [ ] Android実機Chromeでの表示確認
- [ ] ホーム画面追加後の起動確認
- [ ] 実PDFアップロードによる手動分析の実機操作確認
- [ ] Cloudflare Pages本番デプロイ確認
- [ ] Cloudflare Workers proxy本番デプロイ確認
- [ ] OneDrive外の完全クリーン環境での `npm ci && npm run build`
- [ ] Cloudflare Workers AIの実デプロイ環境でライブ推論を確認

## 補足

in-app Browserで `127.0.0.1:5173` 操作がセキュリティポリシーにより拒否されたため、スマホ幅の視覚確認は未実施。HTTP API、テスト、ビルド、起動確認は完了している。
