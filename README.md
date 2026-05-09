# 決算短信AIリーダー

## GitHubアップロード対象

GitHubへアップロードするフォルダは `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_FIXED/` です。

このフォルダをGitHubリポジトリのルートとしてアップロードしてください。Cloudflare Pagesでは、そのリポジトリに対して `npm run build` を実行し、出力先を `dist` に設定します。

アップロード対象フォルダには `src/`、`public/`、`worker/`、`scripts/`、設定ファイル、README、AGENTS、TASKSを含めます。`node_modules/`、`dist/`、`out/`、`.npm-cache/`、`.wrangler/` は含めません。

Cloudflare PagesではNode.js 20系でビルドする前提です。`.node-version` と `.nvmrc` に `20` を入れています。

## アプリ概要

決算短信AIリーダーは、日本株の銘柄コードを入力して、TDnet公開閲覧ページから最新の決算関連資料をベストエフォートで探し、PDFテキスト抽出と標準ルール分析で読みどころを整理するAndroid Chrome向けPWAです。

本アプリは投資助言アプリではありません。決算短信・決算説明資料を読むための補助ツールです。

## できること

- 銘柄コードからTDnet公開閲覧ページを検索
- 決算短信、四半期決算短信、決算説明資料、業績予想修正、配当予想修正などの候補選定
- PDFの自動取得または手動PDFアップロード
- `pdfjs-dist` によるページ単位のテキスト抽出
- 標準ルール分析による主要トピック、注意語句、数値候補、原文確認ページの提示
- AI用プロンプト、Markdownレポート、原文確認リストのコピー
- ローカルストレージによる履歴保存
- Cloudflare Workers AI（無料枠）によるAI要約（オプション）
- PWAとしてAndroid Chromeのホーム画面に追加

## できないこと

- 投資助言、売買推奨、将来株価の予測
- 価格目標や投資判断の断定表示
- TDnetの非公開API利用
- 有料金融データAPI、有料PDF解析API、有料ニュースAPIの利用
- 外部LLM APIへの自動送信
- TDnet公開閲覧の掲載期間外データの完全取得

## 有料API・外部LLM APIを使わない方針

MVPでは有料APIを使いません。外部LLM APIも使いません。

Cloudflare Workers AI（無料枠）によるAI要約はオプション機能として利用できます。設定画面で「AI要約」をONにし、Worker URLを入力すると、分析時にAI要約が生成されます。

## TDnet公開ページ取得について

TDnet公開閲覧ページは無料公開ページを対象にしたベストエフォート取得です。2026年5月9日時点では、検索画面または一覧HTMLから以下の構造を利用します。

- 検索: `https://www.release.tdnet.info/onsf/TDJFSearch/TDJFSearch`
- 一覧: `https://www.release.tdnet.info/inbs/I_list_001_YYYYMMDD.html`
- 一覧行: `time/code/companyname/title/xbrl` または `kjTime/kjCode/kjName/kjTitle/kjXbrl`

TDnet側のHTML構造変更、CORS制限、掲載期間、ネットワーク状況により自動取得は失敗する可能性があります。失敗時は正常ケースとして扱い、手動PDFアップロードまたはPDF URL貼り付けで続行できます。

## セットアップ手順

```bash
npm install
```

この環境ではOneDrive配下でnpmの一部後処理がEPERMになる場合があります。その場合は次を使います。

```bash
npm install --ignore-scripts --no-bin-links --no-audit --no-fund
```

## ローカル起動方法

```bash
npm run dev
```

起動後、表示されたURLを開きます。標準は以下です。

```text
http://localhost:5173
```

このプロジェクトの `npm run dev` は、実行環境で `child_process.spawn` が制限されるケースを避けるため、Vite CLIではなくNode製の軽量サーバーを使います。Vite CLIを使える環境では `npm run dev:vite` も利用できます。

## ビルド方法

```bash
npm run build
```

ビルド成果物は `dist/` に生成されます。PWA manifest、service worker、PDF workerを含みます。

## スマホでPWAとして使う方法

1. PCで `npm run dev` を起動する
2. AndroidスマホとPCを同じネットワークに接続する
3. PCのローカルIPとポートでChromeからアクセスする
4. Chromeメニューから「ホーム画面に追加」を選ぶ

本番配置する場合は `npm run build` 後の `dist/` をHTTPS対応の静的ホスティングへ配置してください。

## GitHub + Cloudflare Pagesで公開する方法

このアプリはCloudflare Pagesで公開する静的PWAとして使える構成です。GitHubにこのプロジェクト一式をアップロードし、Cloudflare Pagesでリポジトリ連携してください。

Cloudflare Pagesの設定:

| 項目 | 値 |
|---|---|
| Framework preset | React (Vite) または None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | リポジトリ直下 |
| Environment variables | MVPでは不要 |

Cloudflare公式ドキュメントでも、React (Vite) のPagesビルド設定は `npm run build` / `dist` とされています。

### GitHubへアップロードするファイル

アップロードするもの:

- `src/`
- `public/`
- `scripts/`
- `worker/`
- `docs/`
- `tests/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tailwind.config.js`
- `postcss.config.js`
- `vite.config.js`
- `index.html`
- `.env.example`
- `.gitignore`
- `README.md`
- `AGENTS.md`
- `TASKS.md`

アップロードしないもの:

- `node_modules/`
- `dist/`
- `.npm-cache/`
- `out/npm-cache/`
- `out/*.log`
- `deliverables/`

`dist/` はCloudflare Pages側で `npm run build` により生成されます。

## Cloudflare Workers proxyを併用する方法

Cloudflare Pagesで公開したアプリはHTTPSの静的PWAとして動作します。ただしTDnetやPDF配信元がCORSを許可していない場合、ブラウザからの直接取得は失敗します。その場合は `worker/` のCloudflare Workers proxyを別途デプロイし、アプリの設定画面へWorker URLを入力してください。

Workerのデプロイ例:

```bash
npx wrangler deploy --config worker/wrangler.toml
```

デプロイ後、表示された `https://...workers.dev` のURLを、アプリの「設定 > Cloudflare Workers proxy URL」に入力します。

## Cloudflare Workers proxyの仕様

ブラウザからTDnetやPDFへ直接アクセスできない場合は、`worker/src/index.ts` をCloudflare Workersへ配置し、設定画面にWorker URLを入力します。

Worker proxyの方針:

- 許可ドメインのみproxy
- 初期許可は `www.release.tdnet.info` と `release.tdnet.info`
- 任意URL proxyはしない
- 簡易レート制限あり
- Cache APIでGETを短時間キャッシュ
- エラーはJSONで返す

## AI要約機能（オプション）

Cloudflare Workers AI（無料枠）を使ったAI要約機能が利用できます。

- モデル: `@cf/meta/llama-3.1-8b-instruct`
- 無料枠: 10,000 neurons/日
- エンドポイント: `POST /ai/summarize`
- Workerの`wrangler.toml`に`[ai] binding = "AI"`が必要

### AI要約の有効化手順

1. WorkerをCloudflareにデプロイ（`npx wrangler deploy --config worker/wrangler.toml`）
2. アプリの設定画面で「Cloudflare Workers proxy URL」にWorker URLを入力
3. 「AI要約（Workers AI）」をONにする
4. 分析時に自動でAI要約が生成される

AI要約が失敗しても、従来のルールベース分析は常に表示されます。

## PDF自動取得に失敗した場合

以下のどちらかで続行してください。

- TDnetまたは企業IRページからPDFを保存し、手動PDFアップロード
- PDF URLを貼り付けて分析

よくある原因:

- PDF配信先が一時的に応答していない
- 公開ページ構造が変わった
- CORS制限によりブラウザから直接取得できない
- TDnet公開閲覧の掲載期間外だった

## 免責事項

本アプリは、決算資料を読むための補助ツールです。投資助言、売買推奨、将来の株価予測を行うものではありません。抽出結果や分析には誤りが含まれる可能性があります。投資判断を行う場合は、必ず公式資料、TDnet、企業IR、決算短信、有価証券報告書等の原文を確認してください。
