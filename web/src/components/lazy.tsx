"use client";

// next/dynamic entry points for the Recharts drawings in ./rc (client-only, loaded on demand).
import dynamic from "next/dynamic";

const ph = () => <div className="chart-ph" aria-hidden="true" />;
const rc = () => import("./rc");

export const CurvesDraw = dynamic(() => rc().then((m) => m.CurvesDraw), { ssr: false, loading: ph });
export const DragScatterDraw = dynamic(() => rc().then((m) => m.DragScatterDraw), { ssr: false, loading: ph });
export const ErgodicityDraw = dynamic(() => rc().then((m) => m.ErgodicityDraw), { ssr: false, loading: ph });
export const CrisisWealthDraw = dynamic(() => rc().then((m) => m.CrisisWealthDraw), { ssr: false, loading: ph });
export const CrisisSignalDraw = dynamic(() => rc().then((m) => m.CrisisSignalDraw), { ssr: false, loading: ph });
export const CostBarsDraw = dynamic(() => rc().then((m) => m.CostBarsDraw), { ssr: false, loading: ph });
export const TurnoverBarsDraw = dynamic(() => rc().then((m) => m.TurnoverBarsDraw), { ssr: false, loading: ph });
export const TurnoverRegDraw = dynamic(() => rc().then((m) => m.TurnoverRegDraw), { ssr: false, loading: ph });
export const LiveWealthDraw = dynamic(() => rc().then((m) => m.LiveWealthDraw), { ssr: false, loading: ph });
export const LiveSeriesDraw = dynamic(() => rc().then((m) => m.LiveSeriesDraw), { ssr: false, loading: ph });
export const SweepDraw = dynamic(() => rc().then((m) => m.SweepDraw), { ssr: false, loading: ph });
export const FanDraw = dynamic(() => rc().then((m) => m.FanDraw), { ssr: false, loading: ph });
