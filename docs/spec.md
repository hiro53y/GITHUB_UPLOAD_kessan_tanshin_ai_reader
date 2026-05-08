# 仕様メモ

## 目的

日本株の銘柄コードを入力し、最新の決算短信・決算関連資料を探して、スマホで読みやすい標準ルール分析レポートを生成する。

## 方針

- 有料APIは使わない。
- 外部LLM APIは使わない。
- 投資助言、売買推奨、価格目標、将来株価の予測は出さない。
- TDnet公開閲覧ページはベストエフォート取得とする。
- 失敗時は手動PDFアップロードまたはPDF URL貼り付けで続行できる。

## 実装

- フロントエンド: React / TypeScript / Tailwind CSS
- ビルド: `scripts/build.mjs` によるRollup + TypeScript transpile
- PWA: manifest + service worker
- PDF解析: `pdfjs-dist`
- 保存: localStorage
- proxy: `worker/src/index.ts`

## TDnet取得

2026年5月9日時点で確認した構造:

- 検索フォーム: `https://www.release.tdnet.info/onsf/TDJFSearch/TDJFSearch`
- 検索期間候補: `I_head` の `select[name='t0']`
- 検索結果行: `#maintable tr`
- 一覧HTML: `I_list_001_YYYYMMDD.html`
- 一覧行: `#main-list-table tr`

アプリでは検索フォームを優先し、失敗または該当なしの場合に日別一覧の探索へフォールバックする。
