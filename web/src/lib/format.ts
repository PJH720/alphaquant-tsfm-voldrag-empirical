// Formatting and fixed display strings. No data imports here, so any component can use it
// without pulling JSON into its bundle.

export type StrategyId = "6040" | "ew" | "mvo" | "ito_hist" | "ito_tsfm" | "proposed";
export type PeriodId = "primary" | "secondary";

export const STRATEGIES: StrategyId[] = ["6040", "ew", "mvo", "ito_hist", "ito_tsfm", "proposed"];

// Korean display names for the strategies (labels in performance.json are English).
export const KO: Record<StrategyId, string> = {
  "6040": "전통 60/40",
  ew: "동일가중 1/N",
  mvo: "MVO (최대 샤프)",
  ito_hist: "이토-켈리 · 과거 모멘트",
  ito_tsfm: "이토-켈리 · Chronos",
  proposed: "제안 모델 (+ 세이프가드)",
};

/** Integrity labels (exact strings; see the site brief, rules 2–5). */
export const LBL = {
  exploratory: "탐색적 / 사전등록 외 (PREREGISTRATION.md §8)",
  submission: "제출본(시뮬레이션 파라미터)",
  live: "실시간 · 탐색적 — 사전등록 결과 아님",
  liveEn: "live / exploratory, not the pre-registered result",
  liveOk: "사전등록 설정 · results.json과 일치 (self-check ok)",
  secondary: "2차 · 제출본과 같은 기간 (2015–16 세이프가드 in-sample)",
  primary: "1차 평가 (2017–, 완전 표본 외)",
} as const;

export const PERIOD_LABEL: Record<PeriodId, string> = {
  primary: LBL.primary,
  secondary: LBL.secondary,
};
export const PERIOD_SHORT: Record<PeriodId, string> = {
  primary: "1차 (2017–)",
  secondary: "2차 (2015–)",
};

// ---------- numbers ----------
export const fmt = (v: number, d = 2) => v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number, d = 2) => `${fmt(v, d)}%`;
export const signed = (v: number, d = 2) => {
  const r = Number(v.toFixed(d));
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${fmt(Math.abs(v), d)}`;
};
/** Decimals needed to show a grid value exactly (0.0005 → 4, 0.2 → 1, 0 → 0). */
export const decimals = (v: number) => {
  for (let d = 0; d <= 6; d++) if (Math.abs(Number(v.toFixed(d)) - v) < 1e-12) return d;
  return 6;
};

// ---------- dates ----------
export const dateKo = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
};
export const shortDate = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}/${d}`;
};
export const dateTimeKo = (iso: string) => {
  const t = new Date(iso);
  return t.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};
export const timeKo = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
