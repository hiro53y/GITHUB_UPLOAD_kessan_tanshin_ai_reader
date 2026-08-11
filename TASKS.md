# タスク管理

## 完了

- [x] 新規案件としてREADME/TASKS/docsを初期化する
- [x] React + TypeScript + Tailwind CSS + PWA基盤を作成する
- [x] TDnet公開ページのベストエフォート取得を実装する
- [x] 候補資料スコアリングを実装する
- [x] PDFテキスト抽出を実装する
- [x] 標準ルール分析を実装する
- [x] ホーム、取得結果、レポート、履歴、設定画面を実装する
- [x] 手動PDFアップロードとPDF URL貼り付け分析を実装する
- [x] localStorage履歴保存を実装する
- [x] Cloudflare Workers proxyサンプルを実装する
- [x] `npm run build` を確認する
- [x] deliverables用パッケージを作成する
- [x] Cloudflare Pages/Workers公開用ファイルを追加する
- [x] 独自ビルド成果物のブラウザ実行時クラッシュ要因を修正する
- [x] `deliverables/` 直下にGitHubアップロード用の単一フォルダを作成する
- [x] TDnet公開期間外をJPX会社別開示履歴で補完する（2026-06-20）
- [x] Cloudflare Pages同一オリジンproxyを既定経路にする（2026-06-20）
- [x] 5451の短期検索漏れを防ぐため最新決算探索を最低120日にする（2026-06-25）

- [x] 要約品質改善：決算サマリー・無料AI診断を転記なし・箇条書き形式に刷新（2026-05-10）
- [x] freeAiDigest型追加・旧履歴データの後方互換マイグレーション実装（2026-05-10）
- [x] ReportPage.tsx に「無料AI診断・要点」カード追加（verdict/良い点/注意点/トピック別サマリー）
- [x] dist再ビルド・deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/dist/ に反映（2026-05-10）

- [x] デバッグ精査: TDnet/JPXのShift_JIS文字化けをcharset判定デコードで修正（2026-06-29）
- [x] デバッグ精査: proxy.tsのSSRF（プライベート/メタデータIP到達）を遮断（2026-06-29）
- [x] デバッグ精査: XBRL金額の1,000,000倍過大バグ（単位取り違え）を修正（2026-06-29）
- [x] XBRL金額換算の回帰テスト追加（tests/xbrlExtract.test.ts）（2026-06-29）
- [x] 清浄コピーで tsc×3=エラー0・vitest 19件全通過・build成功を確認（2026-06-29）
- [x] 精度向上実装（2026-08-11）
  - [x] 実PDFゴールドセットと定量評価指標を追加する
  - [x] TDnet/JPXの探索・重複排除・候補選定を改善する
  - [x] PDF表の行列復元と抽出品質ゲートを実装する
  - [x] XBRLのcontext・期間・連結区分・単位検証を実装する
  - [x] PDF/XBRLを統一factsへ正規化し、判定・要約・表示を同じfactsから再生成する
  - [x] Workers AIを根拠付き構造化出力に変更し、数値・ページ・禁止表現を後段検証する
  - [x] 回帰テスト、型チェック、ビルド、起動確認を実施する
  - [x] 修正済みソースをGit管理済みの正本deliverablesへ統合する
- [x] 2026-06-29以前の修正と正本固有機能を精度向上版へ統合（2026-08-11）

## 未完了

- [ ] 実機Android Chromeでのホーム画面追加確認
- [ ] 本番HTTPSホスティングへの配置
- [ ] 実XBRL（XBRL抽出成功銘柄）で金額表示（兆円/億円）の目視確認
