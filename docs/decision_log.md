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
