# 判断記録

## 2026-08-11

- 精度評価は、公式決算短信PDF 1件と合成回帰5件を `tests/fixtures/golden/` に固定し、資料選定・主要数値・単位・期間・連結区分は誤り0件を合格条件とした。曖昧な表は値を推測せず「不確実」とする。
- PDFは文書全体の平均品質だけでなく、実績・予想・配当の各根拠ページ品質で個別に採否を決める。別ページの正常な表で曖昧ページを救済しない。
- 金額単位は主要表直前の表記を採用し、億円・百万円・千円・円を円へ正規化する。単位を確認できない場合は百万円と仮定せず、主要数値の確定を抑止する。
- XBRLは連結context、累計duration、Summaryファイルを優先し、3主要指標未満・期間不一致・連結区分不一致・JPY未確認の値でPDF factsを上書きしない。
- AIはWorkers AI JSON Modeの構造化claimsのみを受け入れ、Workerとブラウザの両方でschema・根拠抜粋・ページ・数値トークン・禁止表現を検証する。不合格応答は表示せずルール要約へフォールバックする。
- 精度向上版はGit管理済みの正本 `deliverables/GITHUB_UPLOAD_kessan_tanshin_ai_reader/` へ統合済み。検証用の別フォルダーは削除済みで、以後は正本だけを上書きし、別名コピーを作らない。
- build `2026-08-11.1` では、固定URLのbundleに対するimmutable指定を廃止し、内容hash付きService Worker cache・HTTP cache再検証・build前の`dist`限定cleanを採用した。旧buildや旧bundleを配布・表示し続けないことを優先する。
- 再監査で、PDF/XBRLのページ・context・dimension・完全性、AIの中断/timeout、履歴復元、資料選定、proxyの本文上限・redirect再検証・IPv6/例外情報漏洩を修正し、境界条件を回帰テストへ固定した。
- Pages AIはCORSだけを濫用対策とせず、Service binding `AI_GATEWAY` から同梱Workerへ委譲する。WorkerのDurable ObjectでIP別・AI全体を二重制限し、binding未設定・制限基盤障害時はAIだけfail closedにする。

## 2026-06-29

- デバッグ精査により以下を修正（src/functions/worker のみ。deliverables は未変更）。
  - 【重大】TDnet/JPXのHTMLが Shift_JIS（一部 EUC-JP）配信のため、`response.text()`（UTF-8既定）で会社名・タイトルが文字化けし、会社名フィルタ・候補抽出まで破綻していた。bytes取得→HTTPヘッダ→`<meta charset>`の順でcharset判定しデコードする処理を `src/lib/utils.ts`・`functions/lib/jpxDisclosures.ts`・`worker/src/jpxDisclosures.ts` に追加。
  - 【中】`functions/api/proxy.ts` の `.pdf` ワイルドカード経路がプライベート/メタデータIPへ到達できるSSRFリスクだったため、`isPrivateHost()` を追加して localhost/RFC1918/リンクローカル/CGNAT/IPv6内部を遮断。
  - 【重大】XBRL金額の単位換算バグを修正。`xbrlExtract.ts` の `toDisplay` が `decimals`（精度メタデータ）を値の単位と取り違え、円全額の値を「百万円」とみなしていた。下流 `App.tsx` の `fmtAmount` が百万円→円で×1,000,000するため、全金額が1,000,000倍過大（例: 売上10.59兆円→「10,586,781兆円」）になっていた。換算元を `"円"` 固定に変更。
- 判断根拠（XBRL単位）: 実例 `<ix:nonFraction name="tse-ed-t:NetSales" unitRef="JPY" scale="6" decimals="-6">10,586,781</ix:nonFraction>` より、iXBRLは表示値(百万円)×10^scale=円全額、非インラインXBRLも unitRef=JPY の円全額格納と確認（XBRL仕様）。`parseIxbrlFacts` の scale 適用は正しく、iXBRL経路と .xbrl経路は整合（当初疑った二重スケーリングは誤診）。真因は両経路共通の下流換算にあった。
- 注記: 本環境のサンドボックス(Linuxマウント)は当日Edit済みファイルを末尾切れの古いスナップショットで保持し、`tsc`/`vitest` が当該4ファイルでのみ偽の構文エラーを出す。Windows実体は完結・整合を確認済み。最終的な `npm run build` 緑確認は実機推奨。

## 2026-06-25

- 最新決算のJPX履歴検索は最低120日とする。理由: 30日設定が保存されていると、5451（ヨドコウ）の2026年5月11日公表資料が2026年6月25日時点で期間外となり、公開資料が存在しても0件になるため。
- 当時は別名の2026-06-25修正版を作成した（現在は正本へ統合・別名フォルダー削除済み。この運用は廃止）。

## 2026-06-20

- TDnet検索で決算関連資料が無い場合は、公式JPX「東証上場会社情報サービス」の会社別開示履歴を利用する。理由: TDnet検索画面の公開期間内に直近決算が無い銘柄でも、銘柄コードから最新決算短信を取得できるようにするため。
- Cloudflare Pagesでは同梱の `/api/proxy` と `/api/disclosures` を既定経路として自動利用する。理由: Worker URL未設定の公開版でブラウザのCORS制限により全検索が失敗する状態をなくすため。
- `documentType === "other"` の資料は自動選定しない。理由: 役員人事などを「最新決算関連資料」と誤判定するのを防ぐため。
- 当時は別名の2026-06-20修正版を作成した（現在は正本へ統合・別名フォルダー削除済み。この運用は廃止）。

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
- 当時はOneDrive配下のGit書込問題を避けるため別名の修正版クリーンフォルダを作成した（現在は正本へ統合・別名フォルダー削除済み。この運用は廃止）。
