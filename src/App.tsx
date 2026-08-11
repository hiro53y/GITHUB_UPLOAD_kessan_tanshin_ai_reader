import { FileText, WifiOff } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { appReducer, createInitialAppState, type LastTickerRequest } from "./lib/appReducer";
import { BottomNav, type NavKey } from "./components/BottomNav";
import { Card } from "./components/Card";
import { FetchResultPage } from "./pages/FetchResultPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { fetchAiSummary } from "./lib/aiSummarizer";
import { fetchLatestDisclosureByTicker } from "./lib/disclosureFetcher";
import { extractPdfText } from "./lib/pdfExtract";
import { applyVerifiedXbrlToReport, financialFactsToAiFacts } from "./lib/financialFacts";
import { buildMarkdownReport } from "./lib/promptBuilder";
import { analyzeDisclosureText } from "./lib/ruleAnalyzer";
import { buildStructuredReport } from "./lib/structuredReport";
import { extractXbrlMetrics } from "./lib/xbrlExtract";
import {
  clearHistory,
  deleteHistoryItem,
  estimateStorageSize,
  getPdfTextCache,
  getSettings,
  listHistory,
  saveHistoryItem,
  saveLastTicker,
  saveSettings,
  setPdfTextCache
} from "./lib/storage";
import type { AnalysisReport, DisclosureFetchResult, DisclosureItem, FreeAiDigest, HistoryItem, LoadingStep } from "./lib/types";
import { APP_BUILD_TAG, compactText, copyToClipboard, createId, createInitialSteps, formatDateTime, isValidTicker, normalizeTicker } from "./lib/utils";

const defaultFreeAiDigest: FreeAiDigest = {
  verdict: "unknown",
  verdictLabel: "判定不明（旧データ）",
  headline: "",
  plainSummary: "",
  bullets: [],
  goodPoints: [],
  concernPoints: [],
  topicSummaries: [],
  keyFigures: [],
  keyMetrics: [],
  forecastMetrics: [],
  method: "（旧バージョンのデータ）",
};

function migrateReport(report: AnalysisReport): AnalysisReport {
  const withDigest = report.freeAiDigest ? report : { ...report, freeAiDigest: defaultFreeAiDigest };
  // 旧バージョンで保存された履歴には structuredReport がないため、その場で生成する
  if (!withDigest.structuredReport) {
    return { ...withDigest, structuredReport: buildStructuredReport(withDigest) };
  }
  return withDigest;
}

function updateStepList(steps: LoadingStep[], id: number, status: LoadingStep["status"], detail?: string): LoadingStep[] {
  return steps.map((step) => (step.id === id ? { ...step, status, detail } : step));
}

function makeManualDisclosure(input: { url?: string; fileName?: string; ticker?: string; companyName?: string }): DisclosureItem {
  return {
    id: createId("manual"),
    title: input.fileName || "手動PDF資料",
    ticker: input.ticker,
    companyName: input.companyName,
    pdfUrl: input.url,
    sourceUrl: input.url || "manual-upload",
    documentType: "other",
    score: 0,
    scoreReasons: ["手動指定されたPDFを分析対象にしました"]
  };
}

export default function App() {
  // useReducer による集中ステート管理。setter は既存ロジック互換のため shim 関数で残す。
  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    () => createInitialAppState(getSettings(), listHistory(), createInitialSteps())
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const {
    active, settings, history, historyFilter, fetchResult,
    selectedDisclosure, report, pdfWarnings, steps, logs,
    processing, toast, detailReport, lastTickerRequest, isOnline
  } = state;

  const setActive = (v: NavKey) => dispatch({ type: "SET_ACTIVE", payload: v });
  const setSettings = (v: typeof settings) => dispatch({ type: "SET_SETTINGS", payload: v });
  const setHistory = (v: HistoryItem[]) => dispatch({ type: "SET_HISTORY", payload: v });
  const setHistoryFilter = (v: "all" | "success" | "warning") => dispatch({ type: "SET_HISTORY_FILTER", payload: v });
  type FRUpdater = DisclosureFetchResult | undefined | ((c: DisclosureFetchResult | undefined) => DisclosureFetchResult | undefined);
  const setFetchResult = (v: FRUpdater) => {
    if (typeof v === "function") dispatch({ type: "UPDATE_FETCH_RESULT", payload: v });
    else dispatch({ type: "SET_FETCH_RESULT", payload: v });
  };
  const setSelectedDisclosure = (v: DisclosureItem | undefined) => dispatch({ type: "SET_SELECTED_DISCLOSURE", payload: v });
  const setReport = (v: AnalysisReport | undefined) => dispatch({ type: "SET_REPORT", payload: v });
  const setPdfWarnings = (v: string[]) => dispatch({ type: "SET_PDF_WARNINGS", payload: v });
  type StepsUpdater = LoadingStep[] | ((c: LoadingStep[]) => LoadingStep[]);
  const setSteps = (v: StepsUpdater) => {
    if (typeof v === "function") dispatch({ type: "UPDATE_STEPS", payload: v });
    else dispatch({ type: "SET_STEPS", payload: v });
  };
  type LogsUpdater = string[] | ((c: string[]) => string[]);
  const setLogs = (v: LogsUpdater) => {
    const next = typeof v === "function" ? v(stateRef.current.logs) : v;
    dispatch({ type: "SET_LOGS", payload: next });
  };
  const setProcessing = (v: boolean) => dispatch({ type: "SET_PROCESSING", payload: v });
  const setToast = (v: string) => dispatch({ type: "SET_TOAST", payload: v });
  const setDetailReport = (v: boolean) => dispatch({ type: "SET_DETAIL_REPORT", payload: v });
  const setLastTickerRequest = (v: LastTickerRequest | undefined) => dispatch({ type: "SET_LAST_TICKER_REQUEST", payload: v });
  const setIsOnline = (v: boolean) => dispatch({ type: "SET_ONLINE", payload: v });

  const abortRef = useRef<AbortController | null>(null);
  const notifyTimerRef = useRef<number | null>(null);

  function startAbortController(): AbortSignal {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  }

  function cancelProcessing() {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setProcessing(false);
    setSteps((current) =>
      current.map((step) =>
        step.status === "processing" || step.status === "waiting"
          ? { ...step, status: "failed", detail: step.status === "waiting" ? "未到達（中断）" : "中断" }
          : step
      )
    );
    notify("処理を中断しました");
  }

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // アンマウント時に進行中のタイマー・非同期処理をクリーンアップ（StrictMode 二重マウント対応）
  useEffect(() => {
    return () => {
      if (notifyTimerRef.current !== null) {
        window.clearTimeout(notifyTimerRef.current);
        notifyTimerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const latestHistory = history[0];
  const storageSize = useMemo(() => estimateStorageSize(), [history, settings]);

  function notify(message: string) {
    setToast(message);
    if (notifyTimerRef.current !== null) window.clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = window.setTimeout(() => {
      setToast("");
      notifyTimerRef.current = null;
    }, 2600);
  }

  function setStep(id: number, status: LoadingStep["status"], detail?: string) {
    setSteps((current) => updateStepList(current, id, status, detail));
  }

  function addLog(message: string) {
    setLogs((current) => [...current, `${new Date().toLocaleTimeString("ja-JP")} ${message}`]);
  }

  function persistSettings(next: typeof settings) {
    setSettings(next);
    const result = saveSettings(next);
    notify(result.ok ? "設定を保存しました" : `設定の保存に失敗しました（${result.error ?? "不明"}）`);
  }

  async function copyText(label: string, text: string) {
    const ok = await copyToClipboard(text);
    notify(ok ? `${label}をコピーしました` : `${label}のコピーに失敗しました`);
  }

  function saveReportHistory(nextReport: AnalysisReport, nextFetchResult: DisclosureFetchResult | undefined, textSample: string) {
    const markdown = buildMarkdownReport(nextReport);
    const item: HistoryItem = {
      id: createId("history"),
      ticker: nextReport.ticker,
      companyName: nextReport.companyName,
      analyzedAt: nextReport.analyzedAt,
      disclosedAt: nextReport.sourceDisclosure?.disclosedAt,
      title: nextReport.sourceDisclosure?.title,
      pdfUrl: nextReport.sourceDisclosure?.pdfUrl,
      oneLineSummary: nextReport.oneLineSummary,
      warningCount: nextReport.warnings.length,
      reportMarkdown: markdown,
      extractedTextSample: compactText(textSample, 1200),
      status: "success",
      report: nextReport,
      fetchResult: nextFetchResult
    };
    const result = saveHistoryItem(item);
    setHistory(listHistory());
    if (!result.ok) {
      notify(`履歴保存に失敗しました（容量不足）: ${result.error ?? "不明"}`);
    } else if (result.trimmed) {
      notify("履歴が上限の50件を超えたため、最古のものを削除しました");
    }
  }

  async function runPdfAnalysis(input: File | string, disclosure: DisclosureItem, sourceFetchResult?: DisclosureFetchResult, signal?: AbortSignal) {
    const effectiveSignal = signal ?? startAbortController();
    const ownerController = abortRef.current; // この処理のcontrollerを記憶。新規開始でabortRefが差し替わった場合は finally で setProcessing(false) しない。
    try {
      setProcessing(true);

      // 保存済みの抽出テキストがあればPDFダウンロード自体を省略（安定化＋高速化）
      const cachedPdf = typeof input === "string" ? getPdfTextCache(input) : undefined;
      let pdf: Awaited<ReturnType<typeof extractPdfText>>;
      if (cachedPdf) {
        pdf = cachedPdf;
        setStep(4, "success", "保存済み全文を採用（再ダウンロード省略）");
        setStep(5, "success", `${pdf.totalPages}ページ / 抽出済みテキストを再利用`);
        addLog("保存済みの抽出テキストを再利用しました");
      } else {
        setStep(4, input instanceof File ? "success" : "processing", input instanceof File ? "手動PDFを使用" : "PDFを取得中");
        if (!(input instanceof File)) addLog("PDF URLからPDF取得を開始しました");

        pdf = await extractPdfText(input, effectiveSignal);
        setStep(4, "success", input instanceof File ? "手動PDFを使用" : "PDF取得完了");
        setStep(5, "success", `${pdf.totalPages}ページ / 抽出 ${pdf.rawText.length.toLocaleString("ja-JP")}文字`);
        addLog(`PDFテキスト抽出が完了しました（${pdf.totalPages}ページ）`);
        // 次回以降の再分析用に抽出テキストを保存（十分な文字数が取れた場合のみ）
        if (typeof input === "string" && pdf.rawText.replace(/\s/g, "").length >= 500) {
          setPdfTextCache(input, pdf);
        }
      }
      setPdfWarnings(pdf.warnings);

      setStep(6, "processing", "重要語句を検出中");
      const nextReport = analyzeDisclosureText({
        ticker: disclosure.ticker || sourceFetchResult?.ticker,
        companyName: disclosure.companyName || sourceFetchResult?.companyName,
        disclosure,
        pages: pdf.pages,
        quality: pdf.quality
      });
      setStep(6, "success", "重要語句検出完了");

      // XBRL が利用可能なら数値部分を上書き（PDF抽出より精度が高い）
      if (disclosure.xbrlUrl) {
        try {
          addLog("XBRLから業績数値を抽出中…");
          const xbrl = await extractXbrlMetrics(disclosure.xbrlUrl, effectiveSignal);
          if (xbrl.ok) {
            const merged = applyVerifiedXbrlToReport(nextReport, xbrl);
            if (merged.applied) {
              nextReport.structuredReport = buildStructuredReport(nextReport);
              addLog(`検証済みXBRLを統一factsへ反映しました（単位: ${xbrl.unit}）`);
            } else {
              const reason = merged.reasons.join(" / ") || "context・単位の品質条件を満たしませんでした";
              addLog(`XBRLは抽出できましたが自動上書きを抑止しました: ${reason}`);
            }
          } else if (xbrl.error) {
            addLog(`XBRL抽出失敗（PDF解析を採用）: ${xbrl.error}`);
          }
        } catch (xbrlError) {
          if (xbrlError instanceof DOMException && xbrlError.name === "AbortError") throw xbrlError;
          addLog(`XBRL取得エラー: ${xbrlError instanceof Error ? xbrlError.message : String(xbrlError)}`);
        }
      }

      // step 7: AI要約。外部Worker URL未設定でも同一オリジン /api/ai/summarize を自動利用する。
      // AI基盤が未設定でも「失敗」扱いにせず、ルールベースの構造化レポートで続行する。
      if (settings.aiSummaryEnabled) {
        setStep(7, "processing", "AI要約を生成中");
        addLog("Cloudflare Workers AI に要約をリクエストしました");
        const requestedPages = Array.from(new Set([
          ...nextReport.sourceCheckpoints.map((item) => item.pageNumber),
          ...Object.values(nextReport.financialFacts?.performance?.metrics ?? {}).flatMap((fact) => fact?.pageNumber ? [fact.pageNumber] : []),
          ...Object.values(nextReport.financialFacts?.forecast?.metrics ?? {}).flatMap((fact) => fact?.pageNumber ? [fact.pageNumber] : [])
        ])).slice(0, 8);
        const selectedPages = (requestedPages.length
          ? requestedPages.flatMap((pageNumber) => pdf.pages.filter((page) => page.pageNumber === pageNumber))
          : pdf.pages.slice(0, 6));
        const selectedPageNumbers = new Set(selectedPages.map((page) => page.pageNumber));
        const aiFacts = financialFactsToAiFacts(nextReport.financialFacts).map((fact) =>
          fact.page && !selectedPageNumbers.has(fact.page) ? { ...fact, page: undefined } : fact
        );
        const aiResult = await fetchAiSummary(
          settings.proxyUrl,
          {
            pages: selectedPages.map((page) => ({
              page: page.pageNumber,
              excerpt: compactText(page.lines?.map((line) => line.text).join("\n") || page.text, 2400)
            })),
            facts: aiFacts,
            ticker: nextReport.ticker,
            companyName: nextReport.companyName,
            title: disclosure.title
          },
          undefined,
          undefined,
          undefined,
          effectiveSignal
        );
        if (aiResult.ok && aiResult.summary) {
          nextReport.aiSummary = aiResult.summary;
          nextReport.aiSummaryAudit = {
            inputHash: aiResult.inputHash,
            model: aiResult.model,
            valid: aiResult.validation.valid,
            errors: aiResult.validation.errors
          };
          setStep(7, "success", `AI要約完了（${aiResult.model || "Workers AI"}）`);
          addLog("AI要約を取得しました");
        } else {
          nextReport.aiSummaryAudit = {
            inputHash: aiResult.inputHash,
            model: aiResult.model,
            valid: false,
            errors: aiResult.validation.errors
          };
          if (aiResult.status === "fallback") {
            setStep(7, "skipped", "検証不合格のため標準ルール分析を表示");
            addLog(`AI応答を採用しませんでした: ${aiResult.error}`);
          } else {
            setStep(7, "failed", "AI要約に失敗（標準ルール分析を表示）");
            addLog(`AI要約失敗: ${aiResult.error || "不明なエラー"}`);
          }
        }
      } else {
        setStep(7, "skipped", "AI要約OFF");
      }

      setStep(8, "success", "標準レポート生成完了");
      setStep(9, "success", "完了");
      setReport(nextReport);
      saveReportHistory(nextReport, sourceFetchResult, pdf.rawText);
      setDetailReport(false);
      setActive("report");
      notify("分析レポートを生成しました");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return; // 中断はキャンセル処理側で UI 更新済み
      }
      const message = error instanceof Error ? error.message : String(error);
      setStep(4, "failed", "PDF取得または解析に失敗");
      setStep(5, "failed", "テキスト抽出未完了");
      setFetchResult((current) =>
        current
          ? {
              ...current,
              status: "manual_required",
              errorMessage: message,
              userMessage: "PDFの自動取得に失敗しました。TDnetまたは企業IRページからPDFをダウンロードし、手動アップロードしてください。"
            }
          : {
              status: "manual_required",
              ticker: disclosure.ticker || "",
              companyName: disclosure.companyName,
              searchedAt: new Date().toISOString(),
              source: "manual",
              candidates: [],
              errorMessage: message,
              userMessage: "PDFの取得またはテキスト抽出に失敗しました。別のPDFを手動アップロードしてください。"
            }
      );
      setActive("fetch");
      notify("PDF取得または解析に失敗しました");
    } finally {
      // 同じ処理が他の新規開始に取って代わられていなければ processing を解除する。
      if (abortRef.current === ownerController) {
        setProcessing(false);
      }
    }
  }

  async function handleAnalyzeTicker(tickerInput: string, companyName?: string, forceRefresh = false) {
    if (!isOnline) {
      notify("オフラインのため自動取得できません。手動PDFアップロードを使ってください。");
      return;
    }
    const ticker = normalizeTicker(tickerInput);
    setActive("fetch");
    setDetailReport(false);
    setProcessing(true);
    setFetchResult(undefined);
    setSelectedDisclosure(undefined);
    setReport(undefined);
    setPdfWarnings([]);
    setSteps(createInitialSteps());
    setLogs(forceRefresh ? ["キャッシュを無視して再取得します"] : []);
    setLastTickerRequest({ ticker, companyName });
    if (isValidTicker(ticker)) saveLastTicker({ ticker, companyName });
    const tickerSignal = startAbortController();

    if (!isValidTicker(ticker)) {
      setStep(1, "failed", "4桁の銘柄コードを入力してください");
      setFetchResult({
        status: "manual_required",
        ticker,
        companyName,
        searchedAt: new Date().toISOString(),
        source: "tdnet-public",
        candidates: [],
        userMessage: "銘柄コード形式が正しくありません。4桁の日本株コードを入力するか、手動PDFアップロードで続行してください。"
      });
      setProcessing(false);
      return;
    }

    try {
      setStep(1, "success", ticker);
      setStep(2, "processing", "TDnet・JPX開示検索を実行中");
      addLog("TDnet・JPX開示検索を開始しました");
      const result = await fetchLatestDisclosureByTicker({ ticker, companyName, lookbackDays: settings.lookbackDays, forceRefresh, signal: tickerSignal });
      setFetchResult(result);

      if (result.status !== "success" || !result.selectedDisclosure) {
        setStep(2, result.status === "not_found" ? "success" : "failed", result.status === "not_found" ? "検索完了" : "取得失敗");
        setStep(3, "failed", "候補を選定できませんでした");
        setStep(4, "skipped", "手動PDFへ進んでください");
        setProcessing(false);
        addLog("自動取得を完了できませんでした");
        return;
      }

      const selected = result.selectedDisclosure;
      setSelectedDisclosure(selected);
      setStep(2, "success", `候補 ${result.candidates.length}件`);
      setStep(3, "success", selected.title);
      addLog(`最新候補を選定しました: ${selected.title}`);

      if (!selected.pdfUrl) {
        setStep(4, "failed", "PDF URLがありません");
        setFetchResult({
          ...result,
          status: "manual_required",
          userMessage: "PDF URLが取得できませんでした。TDnetまたは企業IRからPDFを保存し、手動アップロードしてください。"
        });
        setProcessing(false);
        return;
      }

      await runPdfAnalysis(selected.pdfUrl, selected, result, tickerSignal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStep(2, "failed", "ネットワークエラー");
      setStep(3, "failed", "候補抽出未完了");
      setFetchResult({
        status: "error",
        ticker,
        companyName,
        searchedAt: new Date().toISOString(),
        source: "tdnet-public",
        candidates: [],
        errorMessage: message,
        userMessage: "ネットワークエラーにより自動取得できませんでした。手動PDFアップロードまたはPDF URL貼り付けで続行してください。"
      });
      setProcessing(false);
    }
  }

  async function handleAnalyzeDisclosure(disclosure: DisclosureItem) {
    setActive("fetch");
    setSelectedDisclosure(disclosure);
    setSteps((current) => {
      const base = current.some((step) => step.status !== "waiting") ? current : createInitialSteps();
      return updateStepList(updateStepList(updateStepList(base, 1, "success"), 2, "success"), 3, "success", disclosure.title);
    });
    setLogs([]);
    if (!disclosure.pdfUrl) {
      setStep(4, "failed", "PDF URLがありません");
      notify("PDF URLがないため手動PDFを使ってください");
      return;
    }
    const signal = startAbortController();
    await runPdfAnalysis(disclosure.pdfUrl, disclosure, fetchResult, signal);
  }

  async function handleAnalyzeFile(file: File, ticker?: string, companyName?: string) {
    const disclosure = makeManualDisclosure({ fileName: file.name, ticker: ticker ? normalizeTicker(ticker) : undefined, companyName });
    setActive("fetch");
    setFetchResult({
      status: "success",
      ticker: disclosure.ticker || "",
      companyName: disclosure.companyName,
      searchedAt: new Date().toISOString(),
      source: "manual",
      selectedDisclosure: disclosure,
      candidates: [disclosure],
      userMessage: "手動アップロードPDFを分析対象にしました。"
    });
    setSelectedDisclosure(disclosure);
    setSteps(createInitialSteps().map((step) => (step.id <= 3 ? { ...step, status: "skipped", detail: "手動PDFのため省略" } : step)));
    setLogs(["手動PDFアップロードで分析を開始しました"]);
    const signal = startAbortController();
    await runPdfAnalysis(file, disclosure, undefined, signal);
  }

  async function handleAnalyzeUrl(url: string, ticker?: string, companyName?: string) {
    if (!isOnline) {
      notify("オフラインのためURL取得できません。PDFファイルアップロードを使ってください。");
      return;
    }
    const disclosure = makeManualDisclosure({ url, fileName: "PDF URL貼り付け資料", ticker: ticker ? normalizeTicker(ticker) : undefined, companyName });
    setActive("fetch");
    setFetchResult({
      status: "success",
      ticker: disclosure.ticker || "",
      companyName: disclosure.companyName,
      searchedAt: new Date().toISOString(),
      source: "manual",
      selectedDisclosure: disclosure,
      candidates: [disclosure],
      userMessage: "貼り付けられたPDF URLを分析対象にしました。"
    });
    setSelectedDisclosure(disclosure);
    setSteps(createInitialSteps().map((step) => (step.id <= 3 ? { ...step, status: "skipped", detail: "PDF URL指定のため省略" } : step)));
    setLogs(["PDF URL貼り付けで分析を開始しました"]);
    const signal = startAbortController();
    await runPdfAnalysis(url, disclosure, undefined, signal);
  }

  function retryLastTicker(forceRefresh = false) {
    if (!lastTickerRequest) {
      notify("再取得する銘柄コードがありません");
      return;
    }
    void handleAnalyzeTicker(lastTickerRequest.ticker, lastTickerRequest.companyName, forceRefresh);
  }

  function openHistoryItem(item: HistoryItem) {
    if (item.report) {
      setReport(migrateReport(item.report));
      setFetchResult(item.fetchResult);
      setSelectedDisclosure(item.report.sourceDisclosure);
      setDetailReport(false);
      setActive("report");
    }
  }

  function removeHistoryItem(id: string) {
    deleteHistoryItem(id);
    setHistory(listHistory());
    notify("履歴を削除しました");
  }

  function removeAllHistory() {
    if (typeof window !== "undefined" && !window.confirm("保存済みの全履歴を削除します。よろしいですか？")) return;
    clearHistory();
    setHistory([]);
    notify("履歴をすべて削除しました");
  }

  const header = (() => {
    if (active === "fetch") return { title: processing ? "最新決算短信を取得中" : fetchResult?.status === "manual_required" ? "資料取得に失敗しました" : "取得結果", sub: selectedDisclosure?.companyName || fetchResult?.companyName || lastTickerRequest?.ticker || "候補資料" };
    if (active === "report") return { title: detailReport ? "詳細レポート" : "決算分析レポート", sub: report?.companyName ? `${report.ticker || ""} ${report.companyName}` : "標準ルール分析" };
    if (active === "history") return { title: "分析履歴", sub: "保存済みレポート" };
    if (active === "settings") return { title: "設定", sub: "取得・分析オプション" };
    return { title: "決算短信AIリーダー", sub: `build: ${APP_BUILD_TAG}` };
  })();

  return (
    <div className="min-h-screen bg-[#eef6ff] text-slate-900">
      <header className="sticky top-0 z-20 bg-gradient-to-br from-[#006cf0] to-[#003a96] px-5 pb-7 pt-[calc(env(safe-area-inset-top)+24px)] text-white shadow-lg">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-[2rem] font-black leading-tight">{header.title}</h1>
            <p className="mt-1 break-words text-lg font-bold text-blue-100">{header.sub}</p>
          </div>
        </div>
      </header>

      {!isOnline ? (
        <div className="mx-auto flex max-w-xl items-center gap-2 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">
          <WifiOff className="h-5 w-5 shrink-0" />
          <span>オフラインです。TDnetからの自動取得・PDFダウンロードは使えません。手動PDFアップロードは可能です。</span>
        </div>
      ) : null}

      <main className="mx-auto max-w-xl px-4 pb-28 pt-4">
        {active === "home" ? (
          <HomePage
            latestHistory={latestHistory}
            isProcessing={processing}
            steps={steps}
            onAnalyzeTicker={(ticker, companyName) => void handleAnalyzeTicker(ticker, companyName)}
            onAnalyzeFile={(file, ticker, companyName) => void handleAnalyzeFile(file, ticker, companyName)}
            onAnalyzeUrl={(url, ticker, companyName) => void handleAnalyzeUrl(url, ticker, companyName)}
            onOpenReport={() => setActive("report")}
            onOpenHistory={() => setActive("history")}
            onCopy={(label, text) => void copyText(label, text)}
          />
        ) : null}

        {active === "fetch" ? (
          <FetchResultPage
            fetchResult={fetchResult}
            selectedDisclosure={selectedDisclosure}
            steps={steps}
            logs={logs}
            isProcessing={processing}
            onSelectDisclosure={setSelectedDisclosure}
            onAnalyzeDisclosure={(item) => void handleAnalyzeDisclosure(item)}
            onRetry={(forceRefresh) => retryLastTicker(forceRefresh)}
            onCancel={cancelProcessing}
            onAnalyzeFile={(file) => void handleAnalyzeFile(file, selectedDisclosure?.ticker || fetchResult?.ticker, selectedDisclosure?.companyName || fetchResult?.companyName)}
            onAnalyzeUrl={(url) => void handleAnalyzeUrl(url, selectedDisclosure?.ticker || fetchResult?.ticker, selectedDisclosure?.companyName || fetchResult?.companyName)}
          />
        ) : null}

        {active === "report" ? (
          <ReportPage
            report={report}
            fetchResult={fetchResult}
            pdfWarnings={pdfWarnings}
            detail={detailReport}
            onDetailChange={setDetailReport}
            onCopy={(label, text) => void copyText(label, text)}
            onBackToFetch={() => setActive("fetch")}
          />
        ) : null}

        {active === "history" ? (
          <HistoryPage
            history={history}
            filter={historyFilter}
            onFilterChange={setHistoryFilter}
            onOpen={openHistoryItem}
            onDelete={removeHistoryItem}
            onClear={removeAllHistory}
            onCopy={(label, text) => void copyText(label, text)}
          />
        ) : null}

        {active === "settings" ? (
          <SettingsPage settings={settings} onChange={persistSettings} historyCount={history.length} storageSize={storageSize} onClearHistory={removeAllHistory} />
        ) : null}

        {!report && active === "report" ? (
          <Card>
            <div className="flex items-center gap-3 text-slate-600">
              <FileText className="h-6 w-6" />
              <span>分析後にレポートが表示されます。</span>
            </div>
          </Card>
        ) : null}
      </main>

      {toast ? (
        <div className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-xl rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      <BottomNav active={active} onChange={setActive} />
    </div>
  );
}
