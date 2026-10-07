"use client";

// Live lab: talks to the FastAPI server on the lab workstation (src/voldrag/api/server.py) through a
// public HTTPS tunnel. Without a reachable backend it shows the pre-computed results from
// web/public/data instead, so the section never goes blank. Live results are EXPLORATORY unless
// every knob sits at its pre-registered value (the server then reproduces results.json exactly).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { KO, LBL, PERIOD_LABEL, decimals, fmt, pct, performance, signed, type PeriodId, type StrategyId } from "@/lib/data";
import Num from "./Num";
import { Figure, Footnote, LazyChart, MarkerShape, PERIOD_OPTIONS, STYLE, Toggle } from "./kit";
import { FanDraw, LiveSeriesDraw, LiveWealthDraw, SweepDraw } from "./lazy";

// ------------------------------------------------------------------ API types
type Summary = {
  cagr_pct: number; sharpe: number; mdd_pct: number; sigma_pct: number; turnover_annual_pct: number;
  emp_drag_pct: number; theo_drag_pct: number;
};
type Params = { cost_bp: number; k_tau: number; cash_floor: number; lambda_param: number; lambda_tc: number };
type Health = {
  status: "ok" | "starting";
  gpu: { available: boolean; device: string; name?: string; cuda_version?: string; vram_total_mb?: number; vram_allocated_process_mb?: number };
  chronos: { model: string; dtype: string; loaded: boolean };
  self_check: { ok: boolean; values_checked?: number; against?: string; detail?: string } | null;
  preregistered: Params;
  ranges: { cost_bp: [number, number]; k_tau: [number, number]; cash_floor: [number, number]; lambda_param: number[]; lambda_tc: [number, number]; horizon: [number, number] };
  grids?: { lambda_tc: number[] };   // absent on servers older than the turnover knob
  default_lambda_tc?: number;
  assets: string[];
  infer_dates: { first: string; last: string } | null;
  defaults: { horizon: number };
  safeguard_spec: { tau_window: number; tau_q: number; kappa: number };
};
type SimRow = {
  date: string; proposed: number; proposed_prereg?: number; "6040": number; mvo: number; ew: number;
  cash_weight?: number; cash_weight_prereg?: number; turnover_1y_pct?: number; turnover_1y_pct_prereg?: number;
};
type Sweep = { cost_bp: number[]; cagr_pct: number[]; sharpe: number[]; mdd_pct: number[] };
type SimResponse = {
  period: PeriodId; start: string; end: string; params: Params; is_preregistered: boolean; label: string;
  proposed: Summary; proposed_prereg_same_cost: Summary; benchmarks: Record<Bench, Summary>;
  safeguard: { days_triggered: number; max_beta: number; mean_cash_weight_pct: number; n_trades: number; n_trades_prereg: number };
  cost_sweep: { proposed: Sweep; proposed_prereg: Sweep };
  curves: SimRow[];
  compute: { device: string; engine: string; ms: number; cached?: boolean };
};
type InferResponse = {
  date: string; asset: string; horizon: number;
  quantiles_pct: { step: number; q10: number; q50: number; q90: number }[];
  implied_annual: { mu_pct: number; sigma_pct: number };
  preregistered_cache: { mu_annual_pct: number; sigma_annual_pct: number; max_abs_sigma_diff_all_assets: number } | null;
  safeguard: { score: number | null; tau: number | null; k_tau: number; threshold: number | null; beta_preregistered: number; beta_at_k: number };
  compute: { device: string; dtype: string; model: string; gpu_ms: number; ms: number; cached?: boolean };
};

type Bench = "6040" | "mvo" | "ew";
const BENCH: Bench[] = ["6040", "mvo", "ew"];
const LINES: StrategyId[] = ["proposed", ...BENCH];
const ASSET_KO: Record<string, string> = {
  KOSPI200: "KOSPI 200", KOSDAQ150: "KOSDAQ 150", KTB10Y: "국고채 10년", SP500: "S&P 500",
  NASDAQ100: "NASDAQ 100", GOLD: "금", CASH: "현금 (SHV)",
};

// ------------------------------------------------------------------ backend connection
const LS_KEY = "voldrag-gpu-api";
const POLL_MS = 5000;
const POLL_OFFLINE_MS = 15000;

const cleanUrl = (u: string) => u.trim().replace(/\/+$/, "");

function initialUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q) {
      try { localStorage.setItem(LS_KEY, cleanUrl(q)); } catch { /* storage unavailable */ }
      return cleanUrl(q);
    }
  } catch { /* no window */ }
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return s;
  } catch { /* storage unavailable */ }
  return cleanUrl(process.env.NEXT_PUBLIC_GPU_API_URL ?? "");
}

const REASON: Record<number, string> = { 429: "요청이 많아 잠시 제한됨 (429)", 503: "GPU 사용 중 (503)" };

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<{ data: T; ms: number }> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const onAbort = () => ctl.abort();
  outer?.addEventListener("abort", onAbort);
  const t0 = globalThis.performance.now();
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(REASON[res.status] ?? `HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return { data, ms: globalThis.performance.now() - t0 };
  } catch (e) {
    if (timedOut) throw new Error(`응답 시간 초과 (${Math.round(timeoutMs / 1000)}s)`);
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}
const SIM_TIMEOUT_MS = 8000;
const INFER_TIMEOUT_MS = 10000;

type Status = "unset" | "checking" | "online" | "offline";

// The backend URL lives outside React (query string / localStorage), read through an external store
// so the static prerender (no window) and the client agree on the first render.
const urlListeners = new Set<() => void>();
let urlCurrent: string | null = null;
const urlStore = {
  subscribe: (cb: () => void) => { urlListeners.add(cb); return () => { urlListeners.delete(cb); }; },
  get: () => (urlCurrent ??= initialUrl()),
  server: () => null,
  set: (u: string) => {
    urlCurrent = cleanUrl(u);
    try { if (urlCurrent) localStorage.setItem(LS_KEY, urlCurrent); else localStorage.removeItem(LS_KEY); } catch { /* storage unavailable */ }
    urlListeners.forEach((l) => l());
  },
};

type Poll = { url: string; ok: boolean; health: Health | null; ping: number | null };

function useBackend() {
  const url = useSyncExternalStore(urlStore.subscribe, urlStore.get, urlStore.server);
  const [poll, setPoll] = useState<Poll | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let first = true; // the first call pays DNS + TLS setup; re-poll soon so the badge shows a steady round trip
    const tick = async () => {
      let next = POLL_OFFLINE_MS;
      try {
        const { data, ms } = await fetchJson<Health>(`${url}/api/health`, {}, 3000);
        if (!alive) return;
        const ok = data.status === "ok";
        setPoll({ url, ok, health: ok ? data : null, ping: ms });
        if (ok) next = first ? 1000 : POLL_MS;
        first = false;
      } catch {
        if (!alive) return;
        setPoll({ url, ok: false, health: null, ping: null });
      }
      if (alive) timer = setTimeout(tick, next);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [url]);

  const current = url && poll?.url === url ? poll : null;
  const status: Status = url === null ? "checking" : !url ? "unset" : !current ? "checking" : current.ok ? "online" : "offline";
  return { url: url ?? "", setUrl: urlStore.set, status, health: current?.health ?? null, ping: current?.ping ?? null };
}

// ------------------------------------------------------------------ small pieces
function LiveBadge({ status, health, ping, reason }: { status: Status; health: Health | null; ping: number | null; reason?: string | null }) {
  if (status === "online" && health && !reason) {
    const g = health.gpu;
    return (
      <span className="live-badge online" role="status">
        <span className="pulse" aria-hidden="true" />
        {g.available ? "GPU 연결됨" : "서버 연결됨 (CPU)"}
        {g.available && <><span className="bar">|</span>{g.name}<span className="bar">|</span>CUDA {g.cuda_version}</>}
        <span className="bar">|</span><span className="num">왕복 {ping === null ? "—" : `${Math.round(ping)}ms`}</span>
      </span>
    );
  }
  const why = reason ?? (status === "unset" ? "백엔드 주소 미설정" : status === "checking" ? "연결 확인 중" : "백엔드 응답 없음 · 자동 재시도");
  return (
    <span className="live-badge static" role="status">
      <span className="pulse" aria-hidden="true" />
      정적 모드<span className="bar">|</span>사전 계산 결과 표시 중<span className="bar">|</span>{why}
    </span>
  );
}

function ApiSettings({ url, setUrl }: { url: string; setUrl: (u: string) => void }) {
  const [draft, setDraft] = useState(url);
  const submit = (e: FormEvent) => { e.preventDefault(); setUrl(draft); };
  return (
    <details className="api-settings">
      <summary>백엔드 주소 설정</summary>
      <form onSubmit={submit}>
        <input type="url" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://….trycloudflare.com" aria-label="백엔드 HTTPS 주소" />
        <button type="submit">연결</button>
        <button type="button" onClick={() => { setDraft(""); setUrl(""); }}>지우기</button>
      </form>
    </details>
  );
}

function Slider({ label, value, min, max, step, onChange, show, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show: (v: number) => string; hint?: string;
}) {
  return (
    <label className="slider">
      <span className="lbl"><span>{label}</span><output>{show(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

function Card({ title, v, unit, digits = 2, ref_, refName, label }: { title: string; v: number; unit: string; digits?: number; ref_?: number; refName?: string; label: string }) {
  return (
    <article className="card card-real" aria-label={`${title} ${fmt(v, digits)}${unit} · ${label}`}>
      <div className="card-head"><h3>{title}</h3></div>
      <div className="big real num">{fmt(v, digits)}{unit}</div>
      {ref_ !== undefined && (
        <div className="delta num">{refName} {fmt(ref_, digits)}{unit} <span className="note">(차이 {signed(v - ref_, digits)}{unit ? "%p" : ""})</span></div>
      )}
    </article>
  );
}

const sameParams = (a: Params, b: Params) =>
  (Object.keys(b) as (keyof Params)[]).every((k) => Math.abs(a[k] - b[k]) < 1e-9);

// ------------------------------------------------------------------ main
export default function LiveLab() {
  const { url, setUrl, status, health, ping } = useBackend();
  const online = status === "online" && health !== null;
  const [period, setPeriod] = useState<PeriodId>("primary");
  const [chosen, setParams] = useState<Params | null>(null);
  const params = chosen ?? health?.preregistered ?? null; // start from the server's pre-registered values
  const [sim, setSim] = useState<{ res: SimResponse; rtt: number } | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!online || !params) return;
    const timer = setTimeout(async () => {
      inflight.current?.abort();
      const ctl = new AbortController();
      inflight.current = ctl;
      try {
        const { data, ms } = await fetchJson<SimResponse>(`${url}/api/simulate`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, ...params }),
        }, SIM_TIMEOUT_MS, ctl.signal);
        setSim({ res: data, rtt: ms }); setSimErr(null);
      } catch (e) {
        if (!ctl.signal.aborted) setSimErr(e instanceof Error ? e.message : "요청 실패");
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [online, params, period, url]);

  // Any simulate failure (timeout, 429, 503, network) falls back to the static view with the reason on the badge.
  const live = online && !simErr && sim !== null && sim.res.period === period ? sim : null;
  const set = (k: keyof Params) => (v: number) => setParams(params ? { ...params, [k]: v } : null);

  return (
    <div>
      <div className="lab-top">
        <LiveBadge status={status} health={health} ping={ping} reason={online ? simErr : null} />
        <ApiSettings key={url} url={url} setUrl={setUrl} />
      </div>

      {online && health ? (
        <p className="lead" style={{ maxWidth: "none" }}>
          이 섹션의 수치는 발표장이 아니라 연구실 워크스테이션({health.gpu.available ? health.gpu.name : "CPU"})에서 지금 계산된다.
          사전등록 설정에서는 서버가 시작할 때 <code>results.json</code>의 {health.self_check?.values_checked ?? "—"}개 값과 대조해 일치를 확인했다
          {health.self_check?.ok ? " ✓" : " (불일치 — 결과를 쓰지 말 것)"}. 설정을 바꾼 결과는 사전등록되지 않은 <b>탐색적 분석</b>이다.
          백테스트는 날짜마다 앞의 결과에 의존하는 경로 계산이라 CPU float64로, Chronos 예측은 GPU에서 돌린다.
        </p>
      ) : (
        <div className="lab-notice" role="note">
          발표자 노트북의 GPU 백엔드가 연결될 때만 실시간으로 다시 계산한다. 지금은 사전 계산된 결과(사전등록 설정, 비용 <Num src="performance.base_cost_bp" kind="int" />bp)를 보여 준다.
        </div>
      )}

      {online && health && params && (
        <div className="lab-controls" role="group" aria-label="실험 조절기">
          <div className="field">
            <span>평가 기간</span>
            <Toggle label="실험실 기간" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
          </div>
          <Slider label="거래비용" value={params.cost_bp} min={health.ranges.cost_bp[0]} max={health.ranges.cost_bp[1]} step={0.5}
            onChange={set("cost_bp")} show={(v) => `${fmt(v, 1)}bp`} hint={`사전등록 ${fmt(health.preregistered.cost_bp, 0)}bp`} />
          <Slider label="세이프가드 임계 배수 k (τ → kτ)" value={params.k_tau} min={health.ranges.k_tau[0]} max={health.ranges.k_tau[1]} step={0.05}
            onChange={set("k_tau")} show={(v) => fmt(v, 2)} hint={`작을수록 일찍 현금화 · 사전등록 ${fmt(health.preregistered.k_tau, 2)}`} />
          <Slider label="현금 오버레이 하한 β_min" value={params.cash_floor} min={health.ranges.cash_floor[0]} max={health.ranges.cash_floor[1]} step={0.05}
            onChange={set("cash_floor")} show={(v) => `${fmt(100 * v, 0)}%`} hint={`사전등록 ${fmt(100 * health.preregistered.cash_floor, 0)}%`} />
          <div className="field">
            <span>위험회피 λ (min λ/2·w′Σw − μ′w)</span>
            <Toggle label="위험회피 λ" options={health.ranges.lambda_param.map((l) => ({ id: String(l), label: fmt(l, 1) }))}
              value={String(params.lambda_param)} onChange={(v) => set("lambda_param")(Number(v))} />
          </div>
          {health.grids?.lambda_tc && params.lambda_tc !== undefined && <TurnoverPenalty grid={health.grids.lambda_tc} value={params.lambda_tc} onChange={set("lambda_tc")} />}
          <div className="field">
            <span>&nbsp;</span>
            <button type="button" onClick={() => setParams(health.preregistered)} disabled={sameParams(params, health.preregistered)}>사전등록 값으로</button>
          </div>
        </div>
      )}

      {simErr && online && <div className="lab-notice" role="alert">실시간 계산 실패({simErr}) · 사전 계산 결과로 전환했다. 조절기를 움직이면 다시 시도한다.</div>}

      {live ? <LiveResults res={live.res} rtt={live.rtt} /> : <StaticResults period={period} />}

      <ChronosPanel online={online} url={url} health={health} kTau={params?.k_tau ?? 1} />
    </div>
  );
}

// ------------------------------------------------------------------ results (live)
function LiveResults({ res, rtt }: { res: SimResponse; rtt: number }) {
  const p = res.proposed;
  const ref = res.is_preregistered ? undefined : res.proposed_prereg_same_cost;
  const refName = "사전등록 설정";
  // Rule 5: the server's label, verbatim. Only a pre-registered request at a pre-registered cost is not exploratory.
  const prereg = res.is_preregistered && performance.costs_bp.includes(res.params.cost_bp);
  const chip = <span className={`chip ${prereg ? "chip-real" : "chip-explore"}`}>{res.label}</span>;
  return (
    <>
      <div className="controls" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {chip}
          <span className="cap" style={{ margin: 0 }}>{PERIOD_LABEL[res.period]} · {res.start} → {res.end} · 비용 {fmt(res.params.cost_bp, 1)}bp · k {fmt(res.params.k_tau, 2)} · β_min {fmt(100 * res.params.cash_floor, 0)}% · λ {fmt(res.params.lambda_param, 1)} {res.params.lambda_tc !== undefined && <> · λ<sub>tc</sub> {fmtTc(res.params.lambda_tc)}</>}</span>
        </span>
        <span className="compute">서버 계산 {fmt(res.compute.ms, 1)}ms · 왕복 {Math.round(rtt)}ms{res.compute.cached ? " · 캐시" : ""} · {res.compute.engine}</span>
      </div>
      <div className="cards cards-5">
        <Card title="CAGR" v={p.cagr_pct} unit="%" ref_={ref?.cagr_pct} refName={refName} label={res.label} />
        <Card title="샤프 비율" v={p.sharpe} unit="" ref_={ref?.sharpe} refName={refName} label={res.label} />
        <Card title="최대 낙폭 MDD" v={p.mdd_pct} unit="%" ref_={ref?.mdd_pct} refName={refName} label={res.label} />
        <Card title="연변동성 σ" v={p.sigma_pct} unit="%" ref_={ref?.sigma_pct} refName={refName} label={res.label} />
        <Card title="연 회전율" v={p.turnover_annual_pct} unit="%" digits={1} ref_={ref?.turnover_annual_pct} refName={refName} label={res.label} />
      </div>
      <p className="cap" style={{ marginTop: "0.6rem" }}>
        세이프가드: S &gt; kτ로 발동한 날 {res.safeguard.days_triggered}일 · 평균 현금 비중 {fmt(res.safeguard.mean_cash_weight_pct, 1)}% ·
        거래 {res.safeguard.n_trades}회 (사전등록 설정 {res.safeguard.n_trades_prereg}회) ·
        같은 비용의 60/40 CAGR {pct(res.benchmarks["6040"].cagr_pct)}, MVO {pct(res.benchmarks.mvo.cagr_pct)}, 동일가중 {pct(res.benchmarks.ew.cagr_pct)} · {res.label}
      </p>
      <div className="lab-grid">
        <Figure title="누적자산 · 실시간 재계산" caption={`${res.start} → ${res.end} · 비용 ${fmt(res.params.cost_bp, 1)}bp 차감 · 주간 표본 · ${res.label}`}
          footnote={<p className="footnote">출처: 실시간 계산 <code>voldrag.api.server</code> (사전등록 코드 경로 재사용, 시작 시 results.json 대조)</p>}>
          <Legend ids={LINES} showRef={!res.is_preregistered} />
          <LazyChart height="min(46vh, 430px)" minHeight={260} label="실시간 누적자산">{() => <LiveWealthDraw rows={res.curves as unknown as Record<string, number | string>[]} showRef={!res.is_preregistered} />}</LazyChart>
        </Figure>
        <div className="lab-stack">
          <Figure title="연환산 회전율 · 직전 1년 이동" footnote={<p className="footnote">회전율 = Σ|w − w<sub>−</sub>| (세이프가드 오버레이 거래 포함). 점선은 사전등록 설정.</p>}>
            <LazyChart height={170} label="직전 1년 회전율">{() => <LiveSeriesDraw rows={res.curves.filter((r) => r.turnover_1y_pct !== undefined).map((r) => ({ date: r.date, turnover_1y_pct: r.turnover_1y_pct, turnover_1y_pct_prereg: res.is_preregistered ? undefined : r.turnover_1y_pct_prereg }))}
              keys={[{ key: "turnover_1y_pct_prereg", dashed: true }, { key: "turnover_1y_pct" }]} unit="%" digits={0} />}</LazyChart>
          </Figure>
          <SweepChart res={res} />
          <Figure title="현금 비중 (세이프가드 오버레이 포함) · 주간 평균" footnote={<p className="footnote">현금 = SHV 비중. 최적화가 고른 현금과 세이프가드 β가 옮긴 현금의 합.</p>}>
            <LazyChart height={170} label="주간 평균 현금 비중">{() => <LiveSeriesDraw rows={res.curves.filter((r) => r.cash_weight !== undefined).map((r) => ({ date: r.date, cash_weight: 100 * (r.cash_weight ?? 0), cash_weight_prereg: !res.is_preregistered && r.cash_weight_prereg !== undefined ? 100 * r.cash_weight_prereg : undefined }))}
              keys={[{ key: "cash_weight", area: true }, { key: "cash_weight_prereg", dashed: true }]} unit="%" digits={1} domain={[0, 100]} />}</LazyChart>
          </Figure>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ results (static fallback)
function StaticResults({ period }: { period: PeriodId }) {
  const base = performance.base_cost_bp;
  const P = (m: string) => `performance.performance.${period}.${base}.proposed.${m}`;
  const ex = performance.exploratory_costs;
  const costs = [...performance.costs_bp, ...ex.costs_bp].sort((a, b) => a - b);
  const sweep = costs.map((c) => {
    const exploratory = !performance.costs_bp.includes(c);
    return { cost: c, proposed: (exploratory ? ex.performance : performance.performance)[period][String(c)].proposed.cagr_pct };
  });
  const cards: { t: string; m: string; kind: "pct" | "num"; d: number }[] = [
    { t: "CAGR", m: "cagr_pct", kind: "pct", d: 2 }, { t: "샤프 비율", m: "sharpe", kind: "num", d: 2 },
    { t: "최대 낙폭 MDD", m: "mdd_pct", kind: "pct", d: 2 }, { t: "연변동성 σ", m: "sigma_pct", kind: "pct", d: 2 },
    { t: "연 회전율", m: "turnover_annual_pct", kind: "pct", d: 1 },
  ];
  return (
    <>
      <div className="controls">
        <span className="chip chip-real">사전등록 설정 · 사전 계산</span>
        <span className="cap" style={{ margin: 0 }}>{PERIOD_LABEL[period]} · {performance.periods[period].start} → {performance.periods[period].end} · 비용 <Num src="performance.base_cost_bp" kind="int" />bp</span>
      </div>
      <div className="cards cards-5">
        {cards.map((c) => (
          <article className="card card-real" key={c.m}>
            <div className="card-head"><h3>{c.t}</h3></div>
            <div className="big real"><Num src={P(c.m)} kind={c.kind} d={c.d} /></div>
          </article>
        ))}
      </div>
      <div className="lab-grid">
        <Figure title="누적자산 · 사전 계산" caption={<>{performance.periods[period].start} → {performance.periods[period].end} · 비용 <Num src="performance.base_cost_bp" kind="int" />bp 차감 · 주간 표본</>}
          footnote={<Footnote sources={[performance.source]} />}>
          <Legend ids={LINES} showRef={false} />
          <LazyChart height="min(46vh, 430px)" minHeight={260} label="사전 계산 누적자산">{() => <LiveWealthDraw period={period} showRef={false} />}</LazyChart>
        </Figure>
        <div className="lab-stack">
          <Figure title="거래비용 민감도 · 사전 계산" caption={<>제안 모델 CAGR · {costs.map((c) => `${c}bp`).join("/")} ({ex.costs_bp.map((c) => `${c}bp`).join("/")}는 <span className="chip chip-explore">{LBL.exploratory}</span>)</>}
            footnote={<Footnote sources={[performance.source, ex.source]} />}>
            <LazyChart height={200} label="비용별 제안 모델 CAGR">{() => <SweepDraw data={sweep} unit="%" preregCosts={performance.costs_bp} />}</LazyChart>
          </Figure>
        </div>
      </div>
    </>
  );
}

function Legend({ ids, showRef }: { ids: StrategyId[]; showRef: boolean }) {
  return (
    <div className="legend" aria-hidden="true">
      {ids.map((id) => (
        <span key={id} className="legend-item">
          <svg width="34" height="14"><line x1="1" y1="7" x2="33" y2="7" stroke={STYLE[id].color} strokeWidth={STYLE[id].width} strokeDasharray={STYLE[id].dash} /><MarkerShape shape={STYLE[id].shape} x={17} y={7} color={STYLE[id].color} size={8} /></svg>
          {id === "proposed" && showRef ? "제안 모델 · 현재 설정" : KO[id]}
        </span>
      ))}
      {showRef && (
        <span className="legend-item">
          <svg width="34" height="14"><line x1="1" y1="7" x2="33" y2="7" stroke="var(--s-proposed)" strokeWidth={2} strokeDasharray="6 4" /></svg>
          제안 모델 · 사전등록 설정
        </span>
      )}
    </div>
  );
}

function SweepChart({ res }: { res: SimResponse }) {
  const [metric, setMetric] = useState<"cagr_pct" | "sharpe">("cagr_pct");
  const s = res.cost_sweep;
  const showRef = !res.is_preregistered;
  const data = s.proposed.cost_bp.map((c, i) => ({ cost: c, proposed: s.proposed[metric][i], proposed_prereg: showRef ? s.proposed_prereg[metric][i] : undefined }));
  const unit = metric === "cagr_pct" ? "%" : "";
  const at = data.find((d) => d.cost === res.params.cost_bp);
  return (
    <Figure title="거래비용 민감도 · 1bp 간격 전체 재계산" caption={`현재 설정의 비용 ${fmt(res.params.cost_bp, 1)}bp: ${at ? `${fmt(at.proposed)}${unit}` : "—"} · ${res.label}`}
      footnote={<p className="footnote">점 = 사전등록 비용 {performance.costs_bp.join("/")}bp. 그 밖의 비용 수준은 탐색적이다.</p>}>
      <div className="controls"><Toggle label="실험실 지표" options={[{ id: "cagr_pct" as const, label: "CAGR" }, { id: "sharpe" as const, label: "샤프" }]} value={metric} onChange={setMetric} /></div>
      <LazyChart height={200} label="실시간 비용 민감도">{() => <SweepDraw data={data} unit={unit} at={res.params.cost_bp} preregCosts={performance.costs_bp} />}</LazyChart>
    </Figure>
  );
}

// ------------------------------------------------------------------ turnover penalty (5th knob)
const fmtTc = (v: number) => fmt(v, decimals(v));

/** Discrete slider over the server's precomputed lambda_tc grid (the grid is not evenly spaced). */
function TurnoverPenalty({ grid, value, onChange }: { grid: number[]; value: number; onChange: (v: number) => void }) {
  const idx = Math.max(0, grid.findIndex((g) => Math.abs(g - value) < 1e-12));
  return (
    <label className="slider" style={{ gridColumn: "1 / -1" }}>
      <span className="lbl">
        <span>회전율 페널티 λ<sub>tc</sub> <span className="chip chip-explore">{LBL.exploratory}</span></span>
        <output>{fmtTc(value)}</output>
      </span>
      <input type="range" min={0} max={grid.length - 1} step={1} value={idx} onChange={(e) => onChange(grid[Number(e.target.value)])}
        aria-valuetext={`λ_tc ${fmtTc(value)}`} />
      <span className="hint">
        {value === 0 ? "λ_tc = 0: 사전등록 설정" : LBL.live} · min ½w′Σw − μ′w + λ<sub>tc</sub>‖w − w<sub>t−1</sub>‖₁ · 격자 {grid.map(fmtTc).join(" / ")}
      </span>
    </label>
  );
}

// ------------------------------------------------------------------ Chronos panel
function ChronosPanel({ online, url, health, kTau }: { online: boolean; url: string; health: Health | null; kTau: number }) {
  const presets = useMemo(() => Object.entries(performance.episodes).flatMap(([name, ep]) => {
    const y = name.slice(0, 4);
    const out: { label: string; date: string }[] = [];
    if (ep.proposed_safeguard.first_trigger) out.push({ label: `${y} 첫 발동일`, date: ep.proposed_safeguard.first_trigger });
    out.push({ label: `${y} 에피소드 시작`, date: performance.episode_windows[name].start });
    return out;
  }), []);
  const scrub = useMemo(() => tradingDaysBetween("2020-01-02", "2020-06-30"), []);
  const [date, setDate] = useState(presets[0]?.date ?? "");
  const [asset, setAsset] = useState("SP500");
  const [horizon, setHorizon] = useState<number | null>(null);
  const [res, setRes] = useState<{ r: InferResponse; rtt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const h = horizon ?? health?.defaults.horizon ?? null;

  useEffect(() => {
    if (!online || !date || h === null) return;
    const timer = setTimeout(async () => {
      inflight.current?.abort();
      const ctl = new AbortController();
      inflight.current = ctl;
      try {
        const { data, ms } = await fetchJson<InferResponse>(`${url}/api/infer_tsfm`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, asset, horizon: h, k_tau: kTau }),
        }, INFER_TIMEOUT_MS, ctl.signal);
        setRes({ r: data, rtt: ms }); setErr(null);
      } catch (e) {
        if (!ctl.signal.aborted || (e instanceof Error && e.message.startsWith("응답 시간 초과"))) setErr(e instanceof Error ? e.message : "요청 실패");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [online, url, date, asset, h, kTau]);

  if (!online || !health) {
    return (
      <div className="figure" style={{ marginTop: "1rem" }}>
        <h3>Chronos 실시간 예측 · 세이프가드 판정</h3>
        <p className="cap" style={{ marginTop: "0.4rem" }}>GPU 연결 시에만 동작. 지금은 2020 위기 섹션의 사전 계산된 β·현금 비중을 참고한다.</p>
      </div>
    );
  }

  const r = res?.r;
  const sg = r?.safeguard;
  const fan = r?.quantiles_pct.map((q) => ({ step: `t+${q.step}`, band: [q.q10, q.q90] as [number, number], q10: q.q10, q50: q.q50, q90: q.q90 })) ?? [];
  const on = !!sg && sg.beta_at_k > 0;
  const verdict = !sg ? "—" : sg.tau === null ? `τ 미정의 (세이프가드 첫 ${health.safeguard_spec.tau_window}일)`
    : on ? `S > kτ → 현금 ${fmt(100 * sg.beta_at_k, 0)}% 편입` : "S ≤ kτ → 오버레이 없음";
  const si = Math.max(0, scrub.indexOf(date));
  return (
    <div className="lab-grid" style={{ marginTop: "1rem" }}>
      <Figure title={`Chronos 실시간 예측 · ${ASSET_KO[asset] ?? asset}`}
        caption={<>{r ? `기준일 ${r.date} 종가까지의 ${r.horizon}일 일별 수익률 분위수 (10% · 50% · 90%) · ${r.compute.model} · ${r.compute.dtype}` : "계산 중…"} · <span className="chip chip-explore">{LBL.live}</span></>}
        footnote={<p className="footnote">모델 출력만 전송한다. 가격과 실현 수익률은 서버 밖으로 나가지 않는다. 같은 날짜·자산·기간은 서버 캐시에서 바로 응답한다.</p>}>
        <label className="slider">
          <span className="lbl"><span>2020 날짜 스크러버 (발표자용)</span><output>{date}</output></span>
          <input type="range" min={0} max={scrub.length - 1} step={1} value={si} onChange={(e) => setDate(scrub[Number(e.target.value)])} aria-valuetext={date} />
        </label>
        <div className="controls">
          <label className="field">기준일
            <input type="date" value={date} min={health.infer_dates?.first} max={health.infer_dates?.last} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label className="field">자산
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {health.assets.map((a) => <option key={a} value={a}>{ASSET_KO[a] ?? a}</option>)}
            </select>
          </label>
          <div style={{ minWidth: "11rem" }}>
            <Slider label="예측 기간" value={h ?? health.defaults.horizon} min={health.ranges.horizon[0]} max={health.ranges.horizon[1]} step={1} onChange={setHorizon} show={(v) => `${v}일`} />
          </div>
        </div>
        <div className="controls" role="group" aria-label="위기 날짜 바로가기">
          {presets.map((p) => <button key={p.label} type="button" aria-pressed={date === p.date} onClick={() => setDate(p.date)}>{p.label} {p.date}</button>)}
          {["SP500", "KOSPI200"].map((a) => <button key={a} type="button" aria-pressed={asset === a} onClick={() => setAsset(a)}>{ASSET_KO[a]}</button>)}
        </div>
        {err && <div className="lab-notice" role="alert">예측 요청 실패({err}).</div>}
        <LazyChart height={230} label="Chronos 분위수 예측 팬 차트">{() => <FanDraw fan={fan} />}</LazyChart>
        {r && <p className="compute">GPU 추론 {fmt(r.compute.gpu_ms, 1)}ms · 서버 처리 {fmt(r.compute.ms, 1)}ms · 왕복 {Math.round(res!.rtt)}ms{r.compute.cached ? " · 캐시" : ""} · {r.compute.device} {r.compute.dtype}</p>}
      </Figure>

      <div className="figure">
        <h3>세이프가드 판정 · {r?.date ?? date}</h3>
        <span className="chip chip-explore">{LBL.live}</span>
        <div className={`verdict${on ? " on" : ""}`} role="status">{verdict}</div>
        {sg && r && (
          <dl className="stat-list">
            <dt>이상 점수 S<sub>t</sub> (오토인코더)</dt><dd>{sg.score === null ? "—" : fmt(sg.score, 3)}</dd>
            <dt>임계값 τ<sub>t</sub> (직전 {health.safeguard_spec.tau_window}일 {fmt(100 * health.safeguard_spec.tau_q, 0)}% 분위)</dt><dd>{sg.tau === null ? "—" : fmt(sg.tau, 3)}</dd>
            <dt>현재 임계 kτ (k = {fmt(sg.k_tau, 2)})</dt><dd>{sg.threshold === null ? "—" : fmt(sg.threshold, 3)}</dd>
            <dt>β · 사전등록 (k = 1)</dt><dd>{fmt(100 * sg.beta_preregistered, 0)}%</dd>
            <dt>β · 현재 k</dt><dd>{fmt(100 * sg.beta_at_k, 0)}%</dd>
            <dt>Chronos 함의 연율 μ̂ / σ̂</dt><dd>{pct(r.implied_annual.mu_pct, 1)} / {pct(r.implied_annual.sigma_pct, 1)}</dd>
            {r.preregistered_cache && <>
              <dt>사전등록 캐시와 σ̂ 최대 차이 ({health.assets.length}개 자산)</dt>
              <dd>{r.preregistered_cache.max_abs_sigma_diff_all_assets === 0
                ? <span className="chip chip-ok">✓ 0 (완전 일치)</span>
                : fmt(r.preregistered_cache.max_abs_sigma_diff_all_assets, 6)}</dd>
            </>}
          </dl>
        )}
        <p className="footnote">S<sub>t</sub>·τ<sub>t</sub>는 사전등록 오토인코더 신호(기준일까지의 데이터만 사용). k는 위 조절기 값을 따른다. 사전등록 캐시 비교는 주간 결정일에 예측 기간이 {health.defaults.horizon}일일 때만 표시된다.</p>
      </div>
    </div>
  );
}

/** Weekdays between two dates (the server snaps a holiday to the previous trading day). */
function tradingDaysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let t = new Date(`${a}T00:00:00Z`); t <= new Date(`${b}T00:00:00Z`); t = new Date(t.getTime() + 864e5)) {
    const d = t.getUTCDay();
    if (d !== 0 && d !== 6) out.push(t.toISOString().slice(0, 10));
  }
  return out;
}
