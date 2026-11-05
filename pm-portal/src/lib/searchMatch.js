// 목록 검색 (v4.152.0) — 낱말 여러 개 · 띄어쓰기 · 기호 무시
//   「5100490」 → AX-5100490 · 「bkn3p」 → BKN-3P-20A · 「로이코 db25」 → 구매처 로이코 이면서 DB-25 가 들어간 줄 (낱말마다 어딘가에 있으면)
//   칸 사이는 끊어 둔다 — 앞 칸 끝과 뒤 칸 처음이 붙어 엉뚱하게 맞지 않게
export const normQ = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_./(),·]+/g, '')
export function matcher(q) {
  const toks = String(q || '').toLowerCase().split(/\s+/).map(normQ).filter(Boolean)
  if (!toks.length) return null
  return (fields) => {
    const h = (Array.isArray(fields) ? fields : [fields]).map(normQ).join('|')
    return toks.every((t) => h.includes(t))
  }
}
