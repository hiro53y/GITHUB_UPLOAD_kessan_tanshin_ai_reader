# 仕様メモ

## 目的

日本株の銘柄コードを入力し、最新の決算短信・決算関連資料を探して、スマホで読みやすい標準ルール分析レポートを生成する。

## 方針

- 有料APIは使わない。
- 外部LLM APIは使わない。
- 投資助言、売買推奨、価格目標、将来株価の予測は出さない。
- TDnet公開閲覧ページとJPX「東証上場会社情報サービス」はベストエフォート取得とする。
- 失敗時は手動PDFアップロードまたはPDF URL貼り付けで続行できる。

## 実装

- フロントエンド: React / TypeScript / Tailwind CSS
- ビルド: `scripts/build.mjs` によるRollup + TypeScript transpile
- PWA: manifest + service worker
- PDF解析: `pdfjs-dist`
- 保存: localStorage
- proxy: `functions/api/*.ts`（Cloudflare Pages標準）/ `worker/src/index.ts`（任意の外部Worker）

## TDnet取得

2026年6月20日時点で確認した構造:

- 検索フォーム: `https://www.release.tdnet.info/onsf/TDJFSearch/TDJFSearch`
- 検索期間候補: `I_head` の `select[name='t0']`
- 検索結果行: `#maintable tr`
- 一覧HTML: `I_list_001_YYYYMMDD.html`
- 一覧行: `#main-list-table tr`

アプリではTDnet検索フォームを優先し、決算短信・決算説明資料が無い場合はJPX「東証上場会社情報サービス」の会社別開示履歴へフォールバックする。TDnet/JPXとも取得できない場合だけ日別一覧を探索し、最終的に手動PDFへ誘導する。

ユーザー設定の検索期間が120日未満でも、決算関連資料が見つからない場合はJPX履歴検索を120日まで自動拡張する。四半期サイクルの決算短信が短期設定から漏れることを防ぐためである。

JPX履歴取得は `worker/src/jpxDisclosures.ts` に集約し、Pages Functionと外部Workerで共用する。フロントエンド側の取得順序・候補統合・スコアリングは `src/lib/disclosureFetcher.ts` に集約する。
