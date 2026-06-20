import type { NavKey } from "../components/BottomNav";
import type { AnalysisReport, AppSettings, DisclosureFetchResult, DisclosureItem, HistoryItem, LoadingStep } from "./types";

export type LastTickerRequest = {
  ticker: string;
  companyName?: string;
};

export type HistoryFilter = "all" | "success" | "warning";

/**
 * アプリ全体の集中ステート。
 * 旧来 useState 14個に分散していたのを1つに集約し、状態遷移を見通せるようにした。
 */
export type AppState = {
  active: NavKey;
  settings: AppSettings;
  history: HistoryItem[];
  historyFilter: HistoryFilter;
  fetchResult?: DisclosureFetchResult;
  selectedDisclosure?: DisclosureItem;
  report?: AnalysisReport;
  pdfWarnings: string[];
  steps: LoadingStep[];
  logs: string[];
  processing: boolean;
  toast: string;
  detailReport: boolean;
  lastTickerRequest?: LastTickerRequest;
  isOnline: boolean;
};

export type AppAction =
  | { type: "SET_ACTIVE"; payload: NavKey }
  | { type: "SET_SETTINGS"; payload: AppSettings }
  | { type: "SET_HISTORY"; payload: HistoryItem[] }
  | { type: "SET_HISTORY_FILTER"; payload: HistoryFilter }
  | { type: "SET_FETCH_RESULT"; payload: DisclosureFetchResult | undefined }
  | { type: "UPDATE_FETCH_RESULT"; payload: (current: DisclosureFetchResult | undefined) => DisclosureFetchResult | undefined }
  | { type: "SET_SELECTED_DISCLOSURE"; payload: DisclosureItem | undefined }
  | { type: "SET_REPORT"; payload: AnalysisReport | undefined }
  | { type: "SET_PDF_WARNINGS"; payload: string[] }
  | { type: "SET_STEPS"; payload: LoadingStep[] }
  | { type: "UPDATE_STEPS"; payload: (current: LoadingStep[]) => LoadingStep[] }
  | { type: "UPDATE_STEP"; payload: { id: number; status: LoadingStep["status"]; detail?: string } }
  | { type: "SET_LOGS"; payload: string[] }
  | { type: "PUSH_LOG"; payload: string }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_TOAST"; payload: string }
  | { type: "SET_DETAIL_REPORT"; payload: boolean }
  | { type: "SET_LAST_TICKER_REQUEST"; payload: LastTickerRequest | undefined }
  | { type: "SET_ONLINE"; payload: boolean };

export function createInitialAppState(settings: AppSettings, history: HistoryItem[], steps: LoadingStep[]): AppState {
  return {
    active: "home",
    settings,
    history,
    historyFilter: "all",
    fetchResult: undefined,
    selectedDisclosure: undefined,
    report: undefined,
    pdfWarnings: [],
    steps,
    logs: [],
    processing: false,
    toast: "",
    detailReport: false,
    lastTickerRequest: undefined,
    isOnline: typeof navigator === "undefined" ? true : navigator.onLine
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_ACTIVE":
      return { ...state, active: action.payload };
    case "SET_SETTINGS":
      return { ...state, settings: action.payload };
    case "SET_HISTORY":
      return { ...state, history: action.payload };
    case "SET_HISTORY_FILTER":
      return { ...state, historyFilter: action.payload };
    case "SET_FETCH_RESULT":
      return { ...state, fetchResult: action.payload };
    case "UPDATE_FETCH_RESULT":
      return { ...state, fetchResult: action.payload(state.fetchResult) };
    case "SET_SELECTED_DISCLOSURE":
      return { ...state, selectedDisclosure: action.payload };
    case "SET_REPORT":
      return { ...state, report: action.payload };
    case "SET_PDF_WARNINGS":
      return { ...state, pdfWarnings: action.payload };
    case "SET_STEPS":
      return { ...state, steps: action.payload };
    case "UPDATE_STEPS":
      return { ...state, steps: action.payload(state.steps) };
    case "UPDATE_STEP":
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === action.payload.id ? { ...s, status: action.payload.status, detail: action.payload.detail } : s
        )
      };
    case "SET_LOGS":
      return { ...state, logs: action.payload };
    case "PUSH_LOG":
      return { ...state, logs: [...state.logs, action.payload] };
    case "SET_PROCESSING":
      return { ...state, processing: action.payload };
    case "SET_TOAST":
      return { ...state, toast: action.payload };
    case "SET_DETAIL_REPORT":
      return { ...state, detailReport: action.payload };
    case "SET_LAST_TICKER_REQUEST":
      return { ...state, lastTickerRequest: action.payload };
    case "SET_ONLINE":
      return { ...state, isOnline: action.payload };
    default:
      return state;
  }
}
