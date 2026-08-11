# Cloudflare公開手順

## 推奨構成

- フロントエンド: Cloudflare Pages
- CORS回避proxy: Cloudflare Workers
- データ保存: ユーザー端末のlocalStorage
- 外部LLM API: 使用しない
- 有料API: 使用しない

## Cloudflare Pages設定

| 項目 | 値 |
|---|---|
| Git連携 | GitHubリポジトリ |
| Framework preset | React (Vite) または None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | リポジトリ直下 |
| Node.js version | `20` |

`.node-version` と `.nvmrc` をリポジトリ直下に置いているため、Cloudflare PagesはNode.js 20系でビルドする前提です。

### Pages FunctionsのAI要約を有効にする場合

先に同梱Workerをデプロイし、Cloudflare Pagesへ次のbindingを設定してから再デプロイします。

- `AI_GATEWAY`: Service binding。Serviceには `kessan-tanshin-reader-proxy`（`worker/wrangler.toml`でデプロイしたWorker）を選択

`AI_GATEWAY` が無い場合、`/api/ai/summarize` は課金濫用を避けるため501でfail closedになり、アプリは標準ルール分析を表示します。同梱WorkerはDurable ObjectでIP別・AI全体の両方を各30回/60秒に制限します。公開規模に応じてWAF Rate LimitingやTurnstileも併用してください。

## Worker proxy

TDnetやPDF配信元がCORSを許可しない場合に使う。

```bash
npx wrangler deploy --config worker/wrangler.toml
```

デプロイ後、アプリの設定画面にWorker URLを入力する。

## GitHubへ含める

- `src/`
- `public/`
- `scripts/`
- `worker/`
- `docs/`
- `tests/`
- 設定ファイル一式
- `package.json`
- `package-lock.json`

## GitHubへ含めない

- `node_modules/`
- `dist/`
- `out/`
- `.npm-cache/`
- `deliverables/`
