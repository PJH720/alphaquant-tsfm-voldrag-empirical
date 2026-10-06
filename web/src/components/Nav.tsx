"use client";

import { useEffect, useState } from "react";

export const SECTIONS = [
  { id: "cover", label: "표지" },
  { id: "compare", label: "제출본 vs 실데이터" },
  { id: "curves", label: "누적자산" },
  { id: "drag", label: "변동성 항력" },
  { id: "crisis", label: "2020 팬데믹" },
  { id: "costs", label: "거래비용" },
  { id: "significance", label: "유의성" },
  { id: "provenance", label: "재현성" },
] as const;

function currentIndex(): number {
  const navH = document.querySelector<HTMLElement>(".nav")?.offsetHeight ?? 0;
  let idx = 0;
  SECTIONS.forEach((s, i) => {
    const el = document.getElementById(s.id);
    if (el && el.getBoundingClientRect().top - navH <= 8) idx = i;
  });
  return idx;
}

function go(i: number) {
  const target = SECTIONS[Math.max(0, Math.min(SECTIONS.length - 1, i))];
  document.getElementById(target.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${target.id}`);
}

export default function Nav() {
  const [active, setActive] = useState(0);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const onScroll = () => setActive(currentIndex());
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Presentation remotes send PageUp/PageDown (some send arrows); move one section per press.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const next = ["ArrowRight", "PageDown"].includes(e.key);
      const prev = ["ArrowLeft", "PageUp"].includes(e.key);
      if (!next && !prev) return;
      e.preventDefault();
      go(currentIndex() + (next ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
  };

  return (
    <nav className="nav" aria-label="섹션">
      <span className="nav-title">실데이터 재현</span>
      <ol>
        {SECTIONS.map((s, i) => (
          <li key={s.id}>
            <a href={`#${s.id}`} aria-current={active === i ? "true" : undefined} title={s.label}>
              {i + 1}<span className="lbl">. {s.label}</span>
            </a>
          </li>
        ))}
      </ol>
      <div className="nav-tools">
        <span className="nav-hint">← → 섹션 이동</span>
        <button type="button" onClick={toggleTheme} aria-pressed={dark} aria-label="다크 모드">
          {dark ? "다크" : "라이트"}
        </button>
      </div>
    </nav>
  );
}
