# 引き継ぎメモ

## 現在の状況

決算短信AIリーダーの精度向上版をGit管理済みの正本へ統合済み。build表示は `2026-08-11.1`。2026-08-11に、公式PDFゴールド評価、TDnet/JPX候補選定、PDF表座標復元とページ品質ゲート、XBRL context/unit検証、統一financial facts、Workers AI構造化出力の二重検証を追加し、正本固有の銘柄マスタ検索・構造化レポート・同一オリジンAI経路も維持した。`npm run accuracy`、全128テスト、3構成typecheck、build、起動smokeはすべて成功。

## 主な変更（2026-08-11 精度向上）

- 公式決算短信PDF 1件と合成回帰5件を `tests/fixtures/golden/` に固定し、重大項目完全一致・警告F1・根拠ページ包含率を `npm run accuracy` で判定。
- TDnet/JPXは取得状態を区別し、query付きPDF/XBRL URL、最大6ページ、書類IDを保持した重複排除、訂正・差替優先、決算短信/説明資料限定の自動選定に変更。
- PDFは文字座標からY→X順に行・セルを復元し、文書全体だけでなく実績・予想・配当の各根拠ページ品質で確定可否を判定。
- 億円/百万円/千円/円を円へ正規化。単位未検出は百万円に仮定せず不確実扱い。
- XBRLはJPY unitRef、期間、連結区分、主要指標の完全性を検証。累計durationとSummaryを優先し、PDFと期間/連結が違うcontextでは上書きしない。
- 数値・判定・要約・良い点/注意点・Markdown・AI入力を統一financial factsから再生成し、画面とMarkdownへ数値ソース/品質/contextを表示。
- Workers AIは `@cf/meta/llama-3.1-8b-instruct-fast` のJSON Schema出力を使用。Workerとブラウザ双方で根拠ページ・抜粋・数値トークン・禁止表現・実行payload hashを検証し、不合格応答は表示しない。
- 追加再監査: AI中断/timeout・Service binding/DO二重制限、履歴復元、PDF配当ページ、XBRL不完全Summary/非集計dimension/成長率来歴、候補資料の新旧順、警告否定文、proxyの本文上限/redirect/IPv6/内部例外、PWA更新キャッシュを修正。
- 検証: `npm run accuracy` 2ファイル・6テスト、`npm test` 15ファイル・128テスト、`npm run typecheck` 3構成、`npm run build`、`npm run dev -- --smoke` が正本で成功。
- 未実施: Cloudflareへの本番デプロイ、Pagesの`AI_GATEWAY` Service binding/Workers AIライブ推論、Android実機、実銘柄XBRLの画面目視。

## 主な変更（2026-06-29 デバッグ精査）

- 【重大・文字化け】TDnet/JPXのHTMLは Shift_JIS（一部 EUC-JP）配信。`response.text()`（UTF-8既定）で会社名・タイトルが文字化けし、会社名フィルタ・候補抽出まで破綻していた。charset判定デコード（HTTPヘッダ→`<meta charset>`→UTF-8フォールバック）を `src/lib/utils.ts`（`decodeHtmlBytes`）・`functions/lib/jpxDisclosures.ts`・`worker/src/jpxDisclosures.ts`（`decodeResponseBytes`）に追加。
- 【中・SSRF】`functions/api/proxy.ts` の `.pdf` ワイルドカード経路がプライベート/メタデータIPへ到達可能だった。`isPrivateHost()` を追加し localhost/RFC1918/リンクローカル/CGNAT/IPv6内部を遮断。
- 【重大・金額1e6過大】`src/lib/xbrlExtract.ts` の `toDisplay` が `decimals`（精度）を値の単位と取り違え、円全額を「百万円」とみなしていた。下流 `App.tsx:fmtAmount` が更に×1,000,000するため全金額が100万倍過大だった。換算元を `"円"` 固定に修正。実例 `tse-ed-t:NetSales unitRef="JPY" scale="6" decimals="-6">10,586,781` で円全額格納を確認。iXBRLと.xbrlの両経路は整合（当初の二重スケーリング疑いは誤診）。
- 検証（2026-06-29、清浄コピーで実走）: `tsc --noEmit` を app/worker/Pages Functionsの3構成で実行し**全てエラー0**。`vitest run` は**3ファイル・19件全通過**（新規 `tests/xbrlExtract.test.ts` を含む）。`scripts/build.mjs` も成功し `dist` 生成。XBRL回帰テストは修正前=失敗(`12345000000`)→修正後=成功(`12345`)を確認。
- 環境メモ: 当セッションのサンドボックスは（A）Linuxマウントが当日Edit済みファイルを末尾切れで保持、（B）`node_modules` の `fflate`/`fast-xml-parser`/`vitest` が中身欠損の不完全インストール、という2点の不整合があった。検証は別ディレクトリへ清浄コピー＋不足3パッケージ再インストールで回避済み。**ユーザー環境でも `npm ci`（またはこの3パッケージの再install）後に `npm run build` を実行して緑を確認することを推奨**。
- 残課題: XBRL修正は実XBRL（抽出成功銘柄）での金額表示（兆円/億円が妥当か）の最終目視確認を推奨。修正は src/functions/worker のみで deliverables/ は未更新。

GitHubへ反映する正本は `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/`。このフォルダー自体がGitリポジトリであり、Cloudflare PagesではBuild commandを `npm run build`、Build output directoryを `dist` にする。精度向上版は正本固有機能を保持して統合する。

## 主な変更（2026-06-25）

- 検索期間30日では5451（ヨドコウ）の2026年5月11日公表決算が期間外になる問題を再現。
- 最新決算のJPX履歴検索を最低120日へ自動拡張するよう修正。
- 5451の回帰テストを追加し、ヨドコウの「2026年3月期 決算短信〔日本基準〕（連結）」を取得対象として確認。
- JPXフォールバック修正は現在の正本へ統合済み。
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
- `deliverables/kessan_tanshin_ai_reader/`、`deliverables/kessan_tanshin_ai_reader_clean/`、`deliverables/UPLOAD_THIS_TO_GITHUB_kessan_tanshin_ai_reader/` は作業途中の旧フォルダ。GitHubへ反映する正本は `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` のみ。
- ローカルでのクリーン `npm ci` はOneDrive配下のEPERMで失敗する場合がある。Cloudflare Pages側ではリポジトリ直下で `npm run build` を実行する。
