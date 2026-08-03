// BOM 표시 스타일 — 기초자료 BOM 과 현장 검색이 같은 모습이 되도록 공용화한다.
// 두 화면에서 따로 관리하면 어긋나기 때문이다.

// 레벨 배지 색 (L1 · L2 …)
export const LEVEL_COLOR = {
  1: 'bg-indigo-50 text-indigo-700',
  2: 'bg-blue-50 text-blue-600',
  3: 'bg-emerald-50 text-emerald-700',
  4: 'bg-amber-50 text-amber-700',
}

export const levelCls = (lv) => LEVEL_COLOR[lv] || 'bg-slate-100 text-slate-500'

// 구분 배지 색 (부품 · 와이어_케이블 · 문서 …)
export function catStyle(cat) {
  const c = String(cat || '')
  if (c.includes('부품')) return 'bg-blue-50 text-blue-600'
  if (c.includes('와이어') || c.includes('케이블')) return 'bg-amber-50 text-amber-700'
  if (c.includes('문서')) return 'bg-slate-100 text-slate-500'
  if (c.includes('라벨')) return 'bg-pink-50 text-pink-600'
  if (c.includes('도면')) return 'bg-indigo-50 text-indigo-600'
  if (c.includes('KIT')) return 'bg-emerald-50 text-emerald-600'
  if (c.includes('회로')) return 'bg-purple-50 text-purple-600'
  if (c === '가공') return 'bg-indigo-50 text-indigo-600'
  return 'bg-slate-50 text-slate-500'
}

// 하위 레벨 들여쓰기 — 구조가 눈에 들어오게 한다
// 기초자료 BOM 과 동일한 간격 (레벨당 22px)
export const indentOf = (lv) => 10 + Math.max((Number(lv) || 1) - 1, 0) * 22
