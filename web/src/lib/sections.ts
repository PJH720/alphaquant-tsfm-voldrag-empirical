// Section order shared by the nav (client) and the page (server).
export const SECTIONS = [
  { id: "hero", label: "항등식" },
  { id: "compare", label: "대시보드" },
  { id: "costs", label: "거래비용" },
  { id: "lambda", label: "λ_tc" },
  { id: "crisis", label: "2020 위기" },
  { id: "curves", label: "누적자산" },
  { id: "drag", label: "변동성 항력" },
  { id: "vs", label: "제출본 vs 실데이터" },
  { id: "significance", label: "유의성" },
  { id: "live", label: "실시간 실험실" },
  { id: "provenance", label: "재현성" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];
export const sectionNumber = (id: SectionId) => SECTIONS.findIndex((s) => s.id === id) + 1;
