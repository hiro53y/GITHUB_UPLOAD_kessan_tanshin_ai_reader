# 判断記録

## 2026-05-09

- MVPでは外部LLM APIを実装しない。理由: ユーザー要件で外部AI APIの使用とAPIキー入力欄が禁止されているため。
- Gemini無料枠モードは実装しない。理由: MVPでは標準ルール分析のみで完結させる指示があるため。
- TDnet取得は検索フォームPOSTを優先し、日別一覧HTMLをフォールバックにした。理由: 銘柄コード単位の検索で過剰アクセスを避けやすいため。
- Vite CLIの通常ビルドではなく `scripts/build.mjs` を `npm run build` に採用した。理由: このWindows/OneDrive実行環境ではNodeの `child_process.spawn` がEPERMになり、Vite内部のesbuildプロセス起動が失敗したため。型チェックは `tsc --noEmit`、バンドルはRollup + TypeScript APIで実行する。
- ブラウザでのlocalhost視覚確認は実行できなかった。理由: in-app Browserのセキュリティポリシーで `localhost:5173` 操作が拒否されたため。
- Cloudflare公開はPages + Workers proxyの2構成にした。理由: フロントエンドは静的PWAとしてPagesに適し、TDnet/PDF取得のCORS回避は許可ドメイン限定のWorkerに分けるのが安全なため。
- 独自ビルドに `process.env.NODE_ENV` / `import.meta.env` 置換を追加した。理由: Vite CLIを使わないビルドでは置換が自動で行われず、ブラウザ実行時にクラッシュする可能性があったため。
- GitHubアップロード対象は `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` の1フォルダにした。理由: ユーザー要件として、`deliverables/` 直下の1フォルダをGitHubへアップロードすればCloudflare Pagesで使える形が求められたため。`node_modules/`、`dist/`、`out/` は含めない。
- ビルドスクリプトから `@rollup/plugin-node-resolve` への直接importを外し、Node標準の `require.resolve` を使う軽量resolverへ置き換えた。あわせて `.node-version` / `.nvmrc` でNode.js 20系を指定した。理由: 推移依存だけに頼る直接importはCloudflareのクリーン環境で解決できない可能性があったため。
- Cloudflare Pages Functionsの `/api/proxy` を追加し、PDF URL取得とTDnet取得のfallbackに入れた。理由: GitHub + Cloudflare Pages公開時に、別Worker URLを設定しなくても同一オリジンproxyでCORS失敗を回避しやすくするため。
- 無料AI要約は外部LLM APIではなく端末内の抽出型要約として実装した。理由: ユーザーは無料AI機能を求めている一方、外部LLM APIやAPIキー欄は実装しない方針が維持されているため。
- Service Workerのcache名を更新し、旧cache削除とassetsのnetwork-first取得を追加した。理由: PWAが古い `/assets/app.js` をcache優先で返し、修正後も画面が変わらない状態を避けるため。
