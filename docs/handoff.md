# 引き継ぎメモ

## 現在の状況

決算短信AIリーダーMVPを実装済み。2026-06-25に5451の短期検索漏れを修正。

GitHubへアップロードする対象は `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_20260625_5451_FIX/` の1フォルダ。Cloudflare Pagesではこのフォルダ内容をリポジトリルートとして扱い、Build commandを `npm run build`、Build output directoryを `dist` にする。

## 主な変更（2026-06-25）

- 検索期間30日では5451（ヨドコウ）の2026年5月11日公表決算が期間外になる問題を再現。
- 最新決算のJPX履歴検索を最低120日へ自動拡張するよう修正。
- 5451の回帰テストを追加し、ヨドコウの「2026年3月期 決算短信〔日本基準〕（連結）」を取得対象として確認。
- JPXフォールバックが欠落していた旧成果物フォルダは使用せず、新しいGitHubアップロード用フォルダを作成。
- クリーンな一時環境で `npm test`（18件）、`npm run typecheck`、`npm run build`、`npm run dev -- --smoke` が成功。
- ローカルAPI経由で5451の決算短信PDF（HTTP 200 / `%PDF-1.4`）まで取得できることを確認。

## 主な変更（2026-06-20）

- 公開版が同梱Pages Functionを使わず、Worker URL未設定時にTDnetのCORSで全検索が失敗し得る問題を修正。
- TDnet検索期間内に決算資料が無い場合、公式JPX「東証上場会社情報サービス」の会社別開示履歴を検索するフォールバックを追加。
- 役員人事など `other` 文書を最新決算として自動選定しないよう修正。
- `functions/api/proxy.ts`、`functions/api/disclosures.ts`、`worker/src/jpxDisclosures.ts` を追加し、Pages/外部Worker/ローカル開発で同じ取得フローを利用。
- `7203` の実取得で、トヨタ自動車の「2026年3月期 決算短信〔IFRS〕（連結）」（2026/05/08）を確認。
- クリーンな一時環境で `npm test`（17件）、`npm run build`、`npm run dev -- --smoke` が成功。
- ローカル画面の自動操作はブラウザ側の既存セキュリティ制限で拒否されたため、API応答・単体テスト・ビルド・起動で検証。

## 主な変更（2026-05-10）

- **要約品質を全面刷新**：決算サマリー・無料AI診断が生テキストを転記する問題を修正。キーワード名・構造化データだけを使って箇条書き要約を生成するよう変更。
- `src/lib/types.ts`：`FreeAiDigest`型・`FreeAiVerdict`型を追加。`AnalysisReport`に`freeAiDigest`フィールドを追加。
- `src/lib/ruleAnalyzer.ts`：`topicComment()`・`buildSummary()`・`buildFreeAiDigest()`を完全書き直し。excerptAround()由来の生テキストを排除。
- `src/lib/promptBuilder.ts`：`buildMarkdownReport()`をfreeAiDigest構造データ対応に更新。
- `src/pages/ReportPage.tsx`：「無料AI診断・要点」カードを新設（判定バッジ・主要数値・良い点/注意点・トピック別サマリー）。
- `src/App.tsx`：旧localStorage履歴データ（freeAiDigest未保有）の後方互換マイグレーション関数を追加。
- `dist/`再ビルド → `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/dist/` に反映済み。

## 以前の変更

- React/TypeScript/Tailwind/PWA基盤を追加
- TDnet公開検索、候補スコアリング、PDF抽出、標準ルール分析を追加
- ホーム、取得中、取得結果、レポート、履歴、設定画面を追加
- 手動PDFアップロード、PDF URL分析、履歴保存を追加
- Cloudflare Workers proxyサンプルを追加
- `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` にGitHubアップロード用フォルダ作成済み
- Cloudflare Pages用 `_headers` / `_redirects` と Workers proxy用 `worker/wrangler.toml` を追加

## 未完了

- 実機Android Chromeでのホーム画面追加確認
- 本番HTTPSホスティングへの配置
- Cloudflare Pages Functions / Workers proxyの実Cloudflare環境でのデプロイ確認
- TDnet構造変更時の継続メンテナンス

## 注意点

- TDnet公開閲覧は掲載期間とCORSに依存するため、取得失敗は正常ケース。
- 外部LLM APIは未実装。APIキー入力欄もない。
- ブラウザ視覚確認はセキュリティポリシーで拒否されたため、HTTP応答、TDnet/JPX取得、ビルド成果物、実PDF抽出確認に留めた。
- `deliverables/kessan_tanshin_ai_reader/`、`deliverables/kessan_tanshin_ai_reader_clean/`、`deliverables/UPLOAD_THIS_TO_GITHUB_kessan_tanshin_ai_reader/`、`deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` は作業途中の旧フォルダ。OneDriveのロック、重複コピー、生成済み `dist/` が残ったため、GitHubへはアップロードしない。
- ローカルでのクリーン `npm ci` はOneDrive配下のEPERMで失敗する場合がある。Cloudflare Pages側ではリポジトリ直下で `npm run build` を実行する。
