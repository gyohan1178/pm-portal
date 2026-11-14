// 기간 빠른 선택 (v4.192.0) — 날짜 칸 두 개를 매번 고르지 않게 · 계산만 (시험용)
const p2 = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
const at = (s) => new Date(`${s}T12:00:00Z`)
export const PERIODS = [['today', '오늘'], ['d7', '최근 7일'], ['m0', '이번 달'], ['m1', '지난달']]
// today: 'YYYY-MM-DD' (한국 날짜) → { from, to }
export function periodOf(key, today) {
  const t = at(today), y = t.getUTCFullYear(), m = t.getUTCMonth()
  if (key === 'today') return { from: today, to: today }
  if (key === 'd7') { const f = at(today); f.setUTCDate(f.getUTCDate() - 6); return { from: ymd(f), to: today } }
  if (key === 'm0') return { from: `${y}-${p2(m + 1)}-01`, to: today }
  if (key === 'm1') { const f = new Date(Date.UTC(y, m - 1, 1, 12)), e = new Date(Date.UTC(y, m, 0, 12)); return { from: ymd(f), to: ymd(e) } }
  return null
}
// 지금 고른 날짜가 어느 칩과 같은지 (칩 강조용)
export const periodKeyOf = (from, to, today) => (PERIODS.find(([k]) => { const p = periodOf(k, today); return p.from === from && p.to === to }) || [null])[0]
