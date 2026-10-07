"use client";

// Live lab: talks to the FastAPI server on the lab workstation (src/voldrag/api/server.py) through a
// public HTTPS tunnel. Without a reachable backend it shows the pre-computed results from
// web/public/data instead, so the section never goes blank. Live results are EXPLORATORY unless
// every knob sits at its pre-registered value (the server then reproduces results.json exactly).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { KO, PERIOD_LABEL, curves, fmt, pct, performance, signed, type PeriodId, type StrategyId } from "@/lib/data";
import { Figure, Footnote, MarkerShape, STYLE, Toggle, axisTick, gridProps } from "./kit";

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
  compute: { device: string; engine: string; ms: number };
};
type InferResponse = {
  date: string; asset: string; horizon: number;
  quantiles_pct: { step: number; q10: number; q50: number; q90: number }[];
  implied_annual: { mu_pct: number; sigma_pct: number };
  preregistered_cache: { mu_annual_pct: number; sigma_annual_pct: number; max_abs_sigma_diff_all_assets: number } | null;
  safeguard: { score: number | null; tau: number | null; k_tau: number; threshold: number | null; beta_preregistered: number; beta_at_k: number };
  compute: { device: string; dtype: string; model: string; gpu_ms: number; ms: number };
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

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<{ data: T; ms: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  outer?.addEventListener("abort", onAbort);
  const t0 = globalThis.performance.now();
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return { data, ms: globalThis.performance.now() - t0 };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

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
function LiveBadge({ status, health, ping }: { status: Status; health: Health | null; ping: number | null }) {
  if (status === "online" && health) {
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
  const why = status === "unset" ? "백엔드 주소 미설정" : status === "checking" ? "연결 확인 중" : "백엔드 응답 없음 · 자동 재시도";
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

function Card({ title, v, unit, digits = 2, ref_, refName }: { title: string; v: number; unit: string; digits?: number; ref_?: number; refName?: string }) {
  return (
    <article className="card card-real" aria-label={`${title} ${fmt(v, digits)}${unit}`}>
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
        }, 8000, ctl.signal);
        setSim({ res: data, rtt: ms }); setSimErr(null);
      } catch (e) {
        if (!ctl.signal.aborted) setSimErr(e instanceof Error ? e.message : "요청 실패");
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [online, params, period, url]);

  const live = online && sim !== null && sim.res.period === period ? sim : null;
  const set = (k: keyof Params) => (v: number) => setParams(params ? { ...params, [k]: v } : null);

  return (
    <div>
      <div className="lab-top">
        <LiveBadge status={status} health={health} ping={ping} />
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
          실시간 백엔드에 연결되어 있지 않아 사전 계산된 결과(사전등록 설정, 비용 {performance.base_cost_bp}bp)를 보여 준다. 조절기는 연결되면 나타난다.
        </div>
      )}

      {online && health && params && (
        <div className="lab-controls" role="group" aria-label="실험 조절기">
          <div className="field">
            <span>평가 기간</span>
            <Toggle label="평가 기간" options={[{ id: "primary" as PeriodId, label: "1차 (2017–)" }, { id: "secondary" as PeriodId, label: "2차 (2015–)" }]} value={period} onChange={setPeriod} />
          </div>
          <Slider label="거래비용" value={params.cost_bp} min={health.ranges.cost_bp[0]} max={health.ranges.cost_bp[1]} step={1}
            onChange={set("cost_bp")} show={(v) => `${fmt(v, 0)}bp`} hint={`사전등록 ${fmt(health.preregistered.cost_bp, 0)}bp`} />
          <Slider label="세이프가드 임계 배수 k (τ → kτ)" value={params.k_tau} min={health.ranges.k_tau[0]} max={health.ranges.k_tau[1]} step={0.05}
            onChange={set("k_tau")} show={(v) => fmt(v, 2)} hint={`작을수록 일찍 현금화 · 사전등록 ${fmt(health.preregistered.k_tau, 2)}`} />
          <Slider label="현금 오버레이 하한 β_min" value={params.cash_floor} min={health.ranges.cash_floor[0]} max={health.ranges.cash_floor[1]} step={0.05}
            onChange={set("cash_floor")} show={(v) => `${fmt(100 * v, 0)}%`} hint={`사전등록 ${fmt(100 * health.preregistered.cash_floor, 0)}%`} />
          <div className="field">
            <span>위험회피 λ (min λ/2·w′Σw − μ′w)</span>
            <Toggle label="위험회피 λ" options={health.ranges.lambda_param.map((l) => ({ id: String(l), label: fmt(l, 1) }))}
              value={String(params.lambda_param)} onChange={(v) => set("lambda_param")(Number(v))} />
          </div>
          {health.grids?.lambda_tc && params.lambda_tc !== undefined && <TurnoverPenalty grid={health.grids.lambda_tc} value={params.lambda_tc} onChange={set("lambda_tc")} period={period} />}
          <div className="field">
            <span>&nbsp;</span>
            <button type="button" onClick={() => setParams(health.preregistered)} disabled={sameParams(params, health.preregistered)}>사전등록 값으로</button>
          </div>
        </div>
      )}

      {simErr && online && <div className="lab-notice" role="alert">시뮬레이션 요청 실패({simErr}). 마지막 결과를 유지한다.</div>}

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
  const preregCosts = performance.costs_bp;
  const chip = res.is_preregistered && preregCosts.includes(res.params.cost_bp)
    ? <span className="chip chip-real">사전등록 설정 · results.json과 동일</span>
    : <span className="chip chip-explore">탐색적 · 사전등록 아님 (§8)</span>;
  return (
    <>
      <div className="controls" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {chip}
          <span className="cap" style={{ margin: 0 }}>{PERIOD_LABEL[res.period]} · {res.start} → {res.end} · 비용 {fmt(res.params.cost_bp, 0)}bp · k {fmt(res.params.k_tau, 2)} · β_min {fmt(100 * res.params.cash_floor, 0)}% · λ {fmt(res.params.lambda_param, 1)} {res.params.lambda_tc !== undefined && <> · λ<sub>tc</sub> {fmtTc(res.params.lambda_tc)}</>}</span>
        </span>
        <span className="compute">서버 계산 {fmt(res.compute.ms, 1)}ms · 왕복 {Math.round(rtt)}ms · {res.compute.engine}</span>
      </div>
      <div className="cards cards-5">
        <Card title="CAGR" v={p.cagr_pct} unit="%" ref_={ref?.cagr_pct} refName={refName} />
        <Card title="샤프 비율" v={p.sharpe} unit="" ref_={ref?.sharpe} refName={refName} />
        <Card title="최대 낙폭 MDD" v={p.mdd_pct} unit="%" ref_={ref?.mdd_pct} refName={refName} />
        <Card title="연변동성 σ" v={p.sigma_pct} unit="%" ref_={ref?.sigma_pct} refName={refName} />
        <Card title="연 회전율" v={p.turnover_annual_pct} unit="%" digits={1} ref_={ref?.turnover_annual_pct} refName={refName} />
      </div>
      <p className="cap" style={{ marginTop: "0.6rem" }}>
        세이프가드: S &gt; kτ로 발동한 날 {res.safeguard.days_triggered}일 · 평균 현금 비중 {fmt(res.safeguard.mean_cash_weight_pct, 1)}% ·
        거래 {res.safeguard.n_trades}회 (사전등록 설정 {res.safeguard.n_trades_prereg}회) ·
        같은 비용의 60/40 CAGR {pct(res.benchmarks["6040"].cagr_pct)}, MVO {pct(res.benchmarks.mvo.cagr_pct)}, 동일가중 {pct(res.benchmarks.ew.cagr_pct)}
      </p>
      <div className="lab-grid">
        <WealthChart rows={res.curves} showRef={!res.is_preregistered} live
          caption={`${res.start} → ${res.end} · 비용 ${fmt(res.params.cost_bp, 0)}bp 차감 · 주간 표본`} />
        <div className="lab-stack">
          <TurnoverChart rows={res.curves} showRef={!res.is_preregistered} />
          <SweepChart res={res} />
          <CashChart rows={res.curves} showRef={!res.is_preregistered} />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ results (static fallback)
function StaticResults({ period }: { period: PeriodId }) {
  const base = String(performance.base_cost_bp);
  const p = performance.performance[period][base].proposed;
  const c = curves[period];
  const rows = c.rows.map((r) => ({ date: r.date, proposed: r.proposed, "6040": r["6040"], mvo: r.mvo, ew: r.ew }));
  return (
    <>
      <div className="controls">
        <span className="chip chip-real">사전등록 설정 · 사전 계산</span>
        <span className="cap" style={{ margin: 0 }}>{PERIOD_LABEL[period]} · {c.start} → {c.end} · 비용 {base}bp</span>
      </div>
      <div className="cards cards-5">
        <Card title="CAGR" v={p.cagr_pct} unit="%" />
        <Card title="샤프 비율" v={p.sharpe} unit="" />
        <Card title="최대 낙폭 MDD" v={p.mdd_pct} unit="%" />
        <Card title="연변동성 σ" v={p.sigma_pct} unit="%" />
        <Card title="연 회전율" v={p.turnover_annual_pct} unit="%" digits={1} />
      </div>
      <div className="lab-grid">
        <WealthChart rows={rows} showRef={false} live={false} caption={`${c.start} → ${c.end} · 비용 ${c.cost_bp}bp 차감 · 주간 표본`} source={<Footnote sources={[c.source]} />} />
        <div className="lab-stack"><StaticSweep period={period} /></div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ charts
type TipItem = { dataKey?: unknown; value?: unknown };
const LABEL: Record<string, string> = {
  proposed: "제안 모델 · 현재 설정", proposed_prereg: "제안 모델 · 사전등록 설정",
  "6040": KO["6040"], mvo: KO.mvo, ew: KO.ew,
  cash_weight: "현금 비중 · 현재 설정", cash_weight_prereg: "현금 비중 · 사전등록 설정",
  turnover_1y_pct: "회전율 · 현재 설정", turnover_1y_pct_prereg: "회전율 · 사전등록 설정",
};

function Tip({ active, payload, label, unit, digits = 3 }: { active?: boolean; payload?: TipItem[]; label?: unknown; unit: string; digits?: number }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === "number");
  return (
    <div className="tooltip">
      <div className="t-date">{String(label)}</div>
      {rows.map((p) => (
        <div className="t-row" key={String(p.dataKey)}><span>{LABEL[String(p.dataKey)] ?? String(p.dataKey)}</span><span>{fmt(p.value as number, digits)}{unit}</span></div>
      ))}
    </div>
  );
}

function yearTicks(dates: string[]) {
  const out: string[] = [];
  let last = "";
  for (const d of dates) { const y = d.slice(0, 4); if (y !== last) { out.push(d); last = y; } }
  return out.slice(1);
}

function WealthChart({ rows, showRef, live, caption, source }: { rows: SimRow[] | Record<string, number | string>[]; showRef: boolean; live: boolean; caption: string; source?: React.ReactNode }) {
  const data = rows as Record<string, number | string>[];
  const ticks = useMemo(() => yearTicks(data.map((r) => String(r.date))), [data]);
  const last = data[data.length - 1] as Record<string, number>;
  const summary = `누적자산 (초기 1). 최종: ${LINES.map((s) => `${KO[s]} ${fmt(last[s], 2)}배`).join(", ")}${showRef ? `, 사전등록 설정 제안 모델 ${fmt(last.proposed_prereg, 2)}배` : ""}.`;
  return (
    <Figure title={live ? "누적자산 · 실시간 재계산" : "누적자산 · 사전 계산"} caption={caption} summary={summary}
      footnote={source ?? <p className="footnote">출처: 실시간 계산 <code>voldrag.api.server</code> (사전등록 코드 경로 재사용, 시작 시 results.json 대조)</p>}>
      <Legend ids={LINES} showRef={showRef} />
      <div style={{ height: "min(46vh, 430px)", minHeight: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => d.slice(0, 4)} tick={axisTick} stroke="var(--rule)" />
            <YAxis domain={[0, "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${fmt(v, 1)}×`} />
            <Tooltip content={<Tip unit="×" />} />
            {BENCH.map((id) => (
              <Line key={id} dataKey={id} stroke={STYLE[id].color} strokeWidth={STYLE[id].width} strokeDasharray={STYLE[id].dash} dot={false} isAnimationActive={false} />
            ))}
            {showRef && <Line dataKey="proposed_prereg" stroke="var(--s-proposed)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            <Line dataKey="proposed" stroke="var(--s-proposed)" strokeWidth={STYLE.proposed.width} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

function Legend({ ids, showRef }: { ids: StrategyId[]; showRef: boolean }) {
  return (
    <div className="legend" aria-hidden="true">
      {ids.map((id) => (
        <span key={id} className="btn" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}>
          <svg width="34" height="14"><line x1="1" y1="7" x2="33" y2="7" stroke={STYLE[id].color} strokeWidth={STYLE[id].width} strokeDasharray={STYLE[id].dash} /><MarkerShape shape={STYLE[id].shape} x={17} y={7} color={STYLE[id].color} size={8} /></svg>
          {id === "proposed" && showRef ? "제안 모델 · 현재 설정" : KO[id]}
        </span>
      ))}
      {showRef && (
        <span className="btn" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}>
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
  const summary = `거래비용 ${fmt(s.proposed.cost_bp[0], 0)}–${fmt(s.proposed.cost_bp[s.proposed.cost_bp.length - 1], 0)}bp에서 제안 모델 ${metric === "cagr_pct" ? "CAGR" : "샤프"}: ${fmt(data[0].proposed)}${unit} → ${fmt(data[data.length - 1].proposed)}${unit}.`;
  return (
    <Figure title="거래비용 민감도 · 1bp 간격 전체 재계산" caption={`현재 설정의 비용 ${fmt(res.params.cost_bp, 0)}bp: ${at ? `${fmt(at.proposed)}${unit}` : "—"}`} summary={summary}
      footnote={<p className="footnote">점 = 사전등록 비용 {performance.costs_bp.join("/")}bp. 그 밖의 비용 수준은 탐색적이다.</p>}>
      <div className="controls"><Toggle label="지표" options={[{ id: "cagr_pct" as const, label: "CAGR" }, { id: "sharpe" as const, label: "샤프" }]} value={metric} onChange={setMetric} /></div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="cost" type="number" domain={["dataMin", "dataMax"]} tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => `${v}bp`} />
            <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => fmt(v, metric === "sharpe" ? 2 : 1)} />
            <Tooltip content={<Tip unit={unit} digits={2} />} labelFormatter={(v) => `${v}bp`} />
            <ReferenceLine x={res.params.cost_bp} stroke="var(--ink-3)" strokeDasharray="4 3" />
            {showRef && <Line dataKey="proposed_prereg" stroke="var(--s-proposed)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            <Line dataKey="proposed" stroke="var(--s-proposed)" strokeWidth={3} dot={PreregDot} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

/** Marks the pre-registered cost levels on the sweep line. */
function PreregDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { cost: number } }) {
  if (cx == null || cy == null || !payload || !performance.costs_bp.includes(payload.cost)) return <g />;
  return <circle cx={cx} cy={cy} r={5} fill="var(--s-proposed)" stroke="var(--surface)" strokeWidth={2} />;
}

function StaticSweep({ period }: { period: PeriodId }) {
  const ex = performance.exploratory_costs;
  const costs = [...performance.costs_bp, ...ex.costs_bp].sort((a, b) => a - b);
  const data = costs.map((c) => {
    const exploratory = !performance.costs_bp.includes(c);
    const r = (exploratory ? ex.performance : performance.performance)[period][String(c)].proposed;
    return { cost: c, proposed: r.cagr_pct, exploratory };
  });
  return (
    <Figure title="거래비용 민감도 · 사전 계산" caption={`제안 모델 CAGR · ${costs.join("/")}bp (${ex.costs_bp.join("/")}bp는 탐색적)`}
      summary={`제안 모델 CAGR: ${data.map((d) => `${d.cost}bp ${fmt(d.proposed)}%`).join(", ")}.`}
      footnote={<Footnote sources={[performance.source, ex.source]} />}>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="cost" type="number" domain={["dataMin", "dataMax"]} ticks={costs} tick={axisTick} stroke="var(--rule)" tickFormatter={(v: number) => `${v}bp`} />
            <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => fmt(v, 1)} />
            <Tooltip content={<Tip unit="%" digits={2} />} labelFormatter={(v) => `${v}bp`} />
            <Line dataKey="proposed" stroke="var(--s-proposed)" strokeWidth={3} dot={{ r: 5, fill: "var(--s-proposed)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

function CashChart({ rows, showRef }: { rows: SimRow[]; showRef: boolean }) {
  const data = rows.filter((r) => r.cash_weight !== undefined).map((r) => ({
    date: r.date, cash_weight: 100 * (r.cash_weight ?? 0), cash_weight_prereg: showRef && r.cash_weight_prereg !== undefined ? 100 * r.cash_weight_prereg : undefined,
  }));
  const ticks = useMemo(() => yearTicks(data.map((r) => r.date)), [data]);
  const mean = data.reduce((a, r) => a + r.cash_weight, 0) / Math.max(1, data.length);
  return (
    <Figure title="현금 비중 (세이프가드 오버레이 포함) · 주간 평균" summary={`제안 모델의 주간 평균 현금 비중, 기간 평균 ${fmt(mean, 1)}%.`}
      footnote={<p className="footnote">현금 = SHV 비중. 최적화가 고른 현금과 세이프가드 β가 옮긴 현금의 합.</p>}>
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => d.slice(0, 4)} tick={axisTick} stroke="var(--rule)" />
            <YAxis domain={[0, 100]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip content={<Tip unit="%" digits={1} />} />
            <Area dataKey="cash_weight" stroke="var(--s-proposed)" strokeWidth={1.5} fill="var(--s-proposed)" fillOpacity={0.18} isAnimationActive={false} />
            {showRef && <Line dataKey="cash_weight_prereg" stroke="var(--s-proposed)" strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

// ------------------------------------------------------------------ turnover penalty (5th knob)
const fmtTc = (v: number) => (v === 0 ? "0" : v.toLocaleString("ko-KR", { maximumSignificantDigits: 2 }));

/** Discrete slider over the server's precomputed lambda_tc grid (the grid is not evenly spaced). */
function TurnoverPenalty({ grid, value, onChange, period }: { grid: number[]; value: number; onChange: (v: number) => void; period: PeriodId }) {
  const idx = Math.max(0, grid.findIndex((g) => Math.abs(g - value) < 1e-12));
  const prereg = performance.performance[period][String(performance.base_cost_bp)].proposed.turnover_annual_pct;
  return (
    <label className="slider" style={{ gridColumn: "span 2" }}>
      <span className="lbl">
        <span>회전율 페널티 (L1 Regularization, λ<sub>tc</sub>) <span className="chip chip-explore">탐색적 분석 (EXPLORATORY)</span></span>
        <output>{fmtTc(value)}</output>
      </span>
      <input type="range" min={0} max={grid.length - 1} step={1} value={idx} onChange={(e) => onChange(grid[Number(e.target.value)])}
        aria-valuetext={`λ_tc ${fmtTc(value)}`} />
      <span className="hint" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        {value === 0
          ? <span className="chip chip-real">미적용 (사전등록: {fmt(prereg, 0)}% 회전율)</span>
          : <span className="chip chip-explore">마찰 통제 (회전율 감쇠)</span>}
        <span>min ½w′Σw − μ′w + λ<sub>tc</sub>‖w − w<sub>t−1</sub>‖₁ · 격자 {grid.map(fmtTc).join(" / ")}</span>
      </span>
    </label>
  );
}

function TurnoverChart({ rows, showRef }: { rows: SimRow[]; showRef: boolean }) {
  const data = rows.filter((r) => r.turnover_1y_pct !== undefined).map((r) => ({
    date: r.date, turnover_1y_pct: r.turnover_1y_pct, turnover_1y_pct_prereg: showRef ? r.turnover_1y_pct_prereg : undefined,
  }));
  const ticks = useMemo(() => yearTicks(data.map((r) => r.date)), [data]);
  const last = data[data.length - 1];
  return (
    <Figure title="연환산 회전율 · 직전 1년 이동" summary={`제안 모델의 직전 1년 회전율, 마지막 값 ${fmt(last?.turnover_1y_pct ?? 0, 0)}%${showRef ? `, 사전등록 설정 ${fmt(last?.turnover_1y_pct_prereg ?? 0, 0)}%` : ""}.`}
      footnote={<p className="footnote">회전율 = Σ|w − w<sub>−</sub>| (세이프가드 오버레이 거래 포함). 점선은 사전등록 설정.</p>}>
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => d.slice(0, 4)} tick={axisTick} stroke="var(--rule)" />
            <YAxis domain={[0, "auto"]} tick={axisTick} stroke="var(--rule)" width={64} tickFormatter={(v: number) => `${fmt(v, 0)}%`} />
            <Tooltip content={<Tip unit="%" digits={0} />} />
            {showRef && <Line dataKey="turnover_1y_pct_prereg" stroke="var(--s-proposed)" strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            <Line dataKey="turnover_1y_pct" stroke="var(--s-proposed)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Figure>
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
        }, 8000, ctl.signal);
        setRes({ r: data, rtt: ms }); setErr(null);
      } catch (e) {
        if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "요청 실패");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [online, url, date, asset, h, kTau]);

  if (!online || !health) {
    return (
      <div className="figure" style={{ marginTop: "1rem" }}>
        <h3>Chronos 실시간 예측 · 세이프가드 판정</h3>
        <p className="cap" style={{ marginTop: "0.4rem" }}>백엔드가 연결되면 날짜·자산을 골라 GPU에서 Chronos를 바로 돌린다. 지금은 2020 팬데믹 섹션의 사전 계산된 S·τ·β 차트를 참고한다.</p>
      </div>
    );
  }

  const r = res?.r;
  const sg = r?.safeguard;
  const fan = r?.quantiles_pct.map((q) => ({ step: `t+${q.step}`, band: [q.q10, q.q90] as [number, number], q10: q.q10, q50: q.q50, q90: q.q90 })) ?? [];
  const on = !!sg && sg.beta_at_k > 0;
  const verdict = !sg ? "—" : sg.tau === null ? `τ 미정의 (세이프가드 첫 ${health.safeguard_spec.tau_window}일)`
    : on ? `S > kτ → 현금 ${fmt(100 * sg.beta_at_k, 0)}% 편입` : "S ≤ kτ → 오버레이 없음";
  return (
    <div className="lab-grid" style={{ marginTop: "1rem" }}>
      <Figure title={`Chronos 실시간 예측 · ${ASSET_KO[asset] ?? asset}`}
        caption={r ? `기준일 ${r.date} 종가까지의 ${r.horizon}일 일별 수익률 분위수 (10% · 50% · 90%) · ${r.compute.model} · ${r.compute.dtype}` : "계산 중…"}
        summary={r ? `${r.date} 기준 ${ASSET_KO[r.asset]} ${r.horizon}일 예측: ${r.quantiles_pct.map((q) => `t+${q.step} 중앙 ${fmt(q.q50)}% (${fmt(q.q10)}~${fmt(q.q90)}%)`).join("; ")}.` : "계산 중"}
        footnote={<p className="footnote">모델 출력만 전송한다. 가격과 실현 수익률은 서버 밖으로 나가지 않는다.</p>}>
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
        </div>
        {err && <div className="lab-notice" role="alert">예측 요청 실패({err}).</div>}
        <div style={{ height: 230 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={fan} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid {...gridProps} vertical={false} />
              <XAxis dataKey="step" tick={axisTick} stroke="var(--rule)" />
              <YAxis domain={["auto", "auto"]} tick={axisTick} stroke="var(--rule)" width={52} tickFormatter={(v: number) => `${fmt(v, 1)}%`} />
              <ReferenceLine y={0} stroke="var(--ink-3)" />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof fan)[number];
                return <div className="tooltip"><div className="t-date">{String(label)}</div>
                  <div className="t-row"><span>90% 분위</span><span>{fmt(d.q90)}%</span></div>
                  <div className="t-row"><span>중앙값</span><span>{fmt(d.q50)}%</span></div>
                  <div className="t-row"><span>10% 분위</span><span>{fmt(d.q10)}%</span></div></div>;
              }} />
              <Area dataKey="band" stroke="none" fill="var(--s-proposed)" fillOpacity={0.18} isAnimationActive={false} />
              <Line dataKey="q50" stroke="var(--s-proposed)" strokeWidth={3} dot={{ r: 4, fill: "var(--s-proposed)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {r && <p className="compute">GPU 추론 {fmt(r.compute.gpu_ms, 1)}ms · 서버 처리 {fmt(r.compute.ms, 1)}ms · 왕복 {Math.round(res!.rtt)}ms · {r.compute.device} {r.compute.dtype}</p>}
      </Figure>

      <div className="figure">
        <h3>세이프가드 판정 · {r?.date ?? date}</h3>
        <div className={`verdict${on ? " on" : ""}`} role="status">{verdict}</div>
        {sg && r && (
          <dl className="stat-list">
            <dt>이상 점수 S<sub>t</sub> (오토인코더)</dt><dd>{sg.score === null ? "—" : fmt(sg.score, 3)}</dd>
            <dt>임계값 τ<sub>t</sub> (직전 {health.safeguard_spec.tau_window}일 {fmt(100 * health.safeguard_spec.tau_q, 0)}% 분위)</dt><dd>{sg.tau === null ? "—" : fmt(sg.tau, 3)}</dd>
            <dt>현재 임계 kτ (k = {fmt(sg.k_tau, 2)})</dt><dd>{sg.threshold === null ? "—" : fmt(sg.threshold, 3)}</dd>
            <dt>β · 사전등록 (k = 1)</dt><dd>{fmt(100 * sg.beta_preregistered, 0)}%</dd>
            <dt>β · 현재 k</dt><dd>{fmt(100 * sg.beta_at_k, 0)}%</dd>
            <dt>Chronos 함의 연율 μ / σ</dt><dd>{pct(r.implied_annual.mu_pct, 1)} / {pct(r.implied_annual.sigma_pct, 1)}</dd>
            {r.preregistered_cache && <>
              <dt>사전등록 캐시와 σ 최대 차이 ({health.assets.length}개 자산)</dt>
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
