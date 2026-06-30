# 判断記録

## 2026-06-25

- 最新決算のJPX履歴検索は最低120日とする。理由: 30日設定が保存されていると、5451（ヨドコウ）の2026年5月11日公表資料が2026年6月25日時点で期間外となり、公開資料が存在しても0件になるため。
- 既存成果物は上書きせず、修正版を `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_20260625_5451_FIX/` に新規作成する。

## 2026-06-20

- TDnet検索で決算関連資料が無い場合は、公式JPX「東証上場会社情報サービス」の会社別開示履歴を利用する。理由: TDnet検索画面の公開期間内に直近決算が無い銘柄でも、銘柄コードから最新決算短信を取得できるようにするため。
- Cloudflare Pagesでは同梱の `/api/proxy` と `/api/disclosures` を既定経路として自動利用する。理由: Worker URL未設定の公開版でブラウザのCORS制限により全検索が失敗する状態をなくすため。
- `documentType === "other"` の資料は自動選定しない。理由: 役員人事などを「最新決算関連資料」と誤判定するのを防ぐため。
- 既存成果物は上書きせず、修正版を `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_20260620/` に新規作成する。

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
- OneDrive配下で `.git/index.lock` と `.git/objects` の作成が拒否されたため、GitHubアップロード用の修正版クリーンフォルダを `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader_FIXED/` に作成した。理由: Git操作に依存せず、フォルダ単位でGitHubへ再アップロードできる状態にするため。
