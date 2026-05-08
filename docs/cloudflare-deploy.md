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
