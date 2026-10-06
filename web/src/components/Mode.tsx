"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type Mode = "simulation" | "empirical";

export const MODES: { id: Mode; label: string }[] = [
  { id: "simulation", label: "제출본 시뮬레이션 (30P 논문)" },
  { id: "empirical", label: "실데이터 사전등록 재현 (Empirical)" },
];

const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: "empirical", setMode: () => {} });

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("empirical");
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);

export function ModeTabs() {
  const { mode, setMode } = useMode();
  return (
    <div className="mode-tabs" role="tablist" aria-label="데이터 모드">
      {MODES.map((m) => (
        <button
          key={m.id} type="button" role="tab" aria-selected={mode === m.id}
          className={`mode-tab mode-${m.id}`} onClick={() => setMode(m.id)}
        >
          <span className="dot" aria-hidden="true" />
          {m.label}
        </button>
      ))}
    </div>
  );
}
