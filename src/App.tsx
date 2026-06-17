import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
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
import { buildMarkdownReport } from "./lib/promptBuilder";
import { analyzeDisclosureText } from "./lib/ruleAnalyzer";
import {
  clearHistory,
  deleteHistoryItem,
  estimateStorageSize,
  getSettings,
  listHistory,
  saveHistoryItem,
  saveLastTicker,
  saveSettings
} from "./lib/storage";
import type { AnalysisReport, DisclosureFetchResult, DisclosureItem, FreeAiDigest, HistoryItem, LoadingStep } from "./lib/types";
import { compactText, copyToClipboard, createId, createInitialSteps, formatDateTime, isValidTicker, normalizeTicker } from "./lib/utils";

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
  if (report.freeAiDigest) return report;
  return { ...report, freeAiDigest: defaultFreeAiDigest };
}

type LastTickerRequest = {
  ticker: string;
  companyName?: string;
};

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
  const [active, setActive] = useState<NavKey>("home");
  const [settings, setSettings] = useState(getSettings);
  const [history, setHistory] = useState<HistoryItem[]>(listHistory);
  const [historyFilter, setHistoryFilter] = useState<"all" | "success" | "warning">("all");
  const [fetchResult, setFetchResult] = useState<DisclosureFetchResult | undefined>();
  const [selectedDisclosure, setSelectedDisclosure] = useState<DisclosureItem | undefined>();
  const [report, setReport] = useState<AnalysisReport | undefined>();
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [steps, setSteps] = useState<LoadingStep[]>(createInitialSteps());
  const [logs, setLogs] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState("");
  const [detailReport, setDetailReport] = useState(false);
  const [lastTickerRequest, setLastTickerRequest] = useState<LastTickerRequest | undefined>();

  const latestHistory = history[0];
  const storageSize = useMemo(() => estimateStorageSize(), [history, settings]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function setStep(id: number, status: LoadingStep["status"], detail?: string) {
    setSteps((current) => updateStepList(current, id, status, detail));
  }

  function addLog(message: string) {
    setLogs((current) => [...current, `${new Date().toLocaleTimeString("ja-JP")} ${message}`]);
  }

  function persistSettings(next: typeof settings) {
    setSettings(next);
    saveSettings(next);
    notify("設定を保存しました");
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
    saveHistoryItem(item);
    setHistory(listHistory());
  }

  async function runPdfAnalysis(input: File | string, disclosure: DisclosureItem, sourceFetchResult?: DisclosureFetchResult) {
    try {
      setProcessing(true);
      setStep(4, input instanceof File ? "success" : "processing", input instanceof File ? "手動PDFを使用" : "PDFを取得中");
      if (!(input instanceof File)) addLog("PDF URLからPDF取得を開始しました");

      const pdf = await extractPdfText(input);
      setPdfWarnings(pdf.warnings);
      setStep(4, "success", input instanceof File ? "手動PDFを使用" : "PDF取得完了");
      setStep(5, "success", `${pdf.totalPages}ページ / 抽出 ${pdf.rawText.length.toLocaleString("ja-JP")}文字`);
      addLog(`PDFテキスト抽出が完了しました（${pdf.totalPages}ページ）`);

      setStep(6, "processing", "重要語句を検出中");
      const nextReport = analyzeDisclosureText({
        ticker: disclosure.ticker || sourceFetchResult?.ticker,
        companyName: disclosure.companyName || sourceFetchResult?.companyName,
        disclosure,
        pages: pdf.pages
      });
      setStep(6, "success", "重要語句検出完了");

      // step 7: AI要約（有効かつWorker URL設定済みのときのみ実行）
      if (settings.aiSummaryEnabled && settings.proxyUrl) {
        setStep(7, "processing", "AI要約を生成中");
        addLog("Cloudflare Workers AI に要約をリクエストしました");
        const aiResult = await fetchAiSummary(
          settings.proxyUrl,
          pdf.rawText,
          nextReport.ticker,
          nextReport.companyName,
          disclosure.title
        );
        if (aiResult.ok && aiResult.summary) {
          nextReport.aiSummary = aiResult.summary;
          setStep(7, "success", "AI要約完了");
          addLog("AI要約を取得しました");
        } else {
          setStep(7, "failed", aiResult.error || "AI要約に失敗");
          addLog(`AI要約失敗: ${aiResult.error || "不明なエラー"}`);
        }
      } else {
        setStep(7, "skipped", settings.aiSummaryEnabled ? "Worker URL未設定" : "AI要約OFF");
      }

      setStep(8, "success", "標準レポート生成完了");
      setStep(9, "success", "完了");
      setReport(nextReport);
      saveReportHistory(nextReport, sourceFetchResult, pdf.rawText);
      setDetailReport(false);
      setActive("report");
      notify("分析レポートを生成しました");
    } catch (error) {
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
      setProcessing(false);
    }
  }

  async function handleAnalyzeTicker(tickerInput: string, companyName?: string, forceRefresh = false) {
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
      setStep(2, "processing", "TDnet公開検索を実行中");
      addLog("TDnet公開ページ検索を開始しました");
      const result = await fetchLatestDisclosureByTicker({ ticker, companyName, lookbackDays: settings.lookbackDays, forceRefresh });
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

      await runPdfAnalysis(selected.pdfUrl, selected, result);
    } catch (error) {
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
    await runPdfAnalysis(disclosure.pdfUrl, disclosure, fetchResult);
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
    await runPdfAnalysis(file, disclosure);
  }

  async function handleAnalyzeUrl(url: string, ticker?: string, companyName?: string) {
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
    await runPdfAnalysis(url, disclosure);
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
    clearHistory();
    setHistory([]);
    notify("履歴をすべて削除しました");
  }

  const header = (() => {
    if (active === "fetch") return { title: processing ? "最新決算短信を取得中" : fetchResult?.status === "manual_required" ? "資料取得に失敗しました" : "取得結果", sub: selectedDisclosure?.companyName || fetchResult?.companyName || lastTickerRequest?.ticker || "候補資料" };
    if (active === "report") return { title: detailReport ? "詳細レポート" : "決算分析レポート", sub: report?.companyName ? `${report.ticker || ""} ${report.companyName}` : "標準ルール分析" };
    if (active === "history") return { title: "分析履歴", sub: "保存済みレポート" };
    if (active === "settings") return { title: "設定", sub: "取得・分析オプション" };
    return { title: "決算短信AIリーダー", sub: "build: 2026-05-09.1" };
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

      <main className="mx-auto max-w-xl px-4 pb-28 pt-4">
        {active === "home" ? (
          <HomePage
            latestHistory={latestHistory}
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
