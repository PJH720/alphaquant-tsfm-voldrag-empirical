"use client";

// Below-the-fold client sections hydrate only when their section nears the viewport. Each is a
// React.lazy boundary: the static export renders it fully (text and numbers in the HTML); in the
// browser the lazy promise stays pending until the section is close, so React keeps the server HTML
// and neither downloads nor hydrates that code on first load.

import { lazy, Suspense, type ComponentType } from "react";

function whenNear(id: string): Promise<void> {
  return new Promise((resolve) => {
    const el = document.getElementById(id);
    if (!el || !("IntersectionObserver" in window)) return resolve();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); resolve(); }
    }, { rootMargin: "900px 0px" });
    io.observe(el);
  });
}

function island(id: string, load: () => Promise<{ default: ComponentType }>) {
  const L = lazy(() => (typeof window === "undefined" ? load() : whenNear(id).then(load)));
  function Island() {
    return <Suspense fallback={null}><L /></Suspense>;
  }
  return Island;
}

export const DashboardIsland = island("compare", () => import("./Dashboard"));
export const CostIsland = island("costs", () => import("./CostSection"));
export const LambdaIsland = island("lambda", () => import("./LambdaSection"));
export const CrisisChartsIsland = island("crisis", () => import("./Charts").then((m) => ({ default: m.CrisisCharts })));
export const CurvesIsland = island("curves", () => import("./Charts").then((m) => ({ default: m.CurvesChart })));
export const DragIsland = island("drag", () => import("./Charts").then((m) => ({ default: m.DragScatter })));
export const ErgodicityIsland = island("drag", () => import("./Charts").then((m) => ({ default: m.ErgodicityBars })));
export const SignificanceIsland = island("significance", () => import("./Charts").then((m) => ({ default: m.SignificancePlot })));
export const LiveIsland = island("live", () => import("./LiveSimulator"));
