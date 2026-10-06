// 자재 요청 목록 — 담당자가 보기 좋게 (2026-10-06)
//   요청이 쌓이면 등록 순 한 줄 목록에서는 「내 것 · 급한 것」을 눈으로 찾아야 했다.
//     ① 처리자별 건수 · 「내 담당」 · 미배정
//     ② 급한 순 구간: 지금 볼 것(필요일 지남 · 긴급) → 이번 주 → 다음 주 이후 → 필요일 없음
//     ③ 요약 지표: 필요일 지남 · 불출 예정일 지남 · 미배정 · 긴급
//   화면과 떼어 두어 시험하기 쉽게 한다. 건수는 「요청(요청번호)」 단위다 — 품목 줄 수가 아니다.
const isOpen = (s) => s !== '완료' && s !== '반려'
const p2 = (n) => String(n).padStart(2, '0')
export const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const atNoon = (ymd) => { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12) }
// 오늘부터 며칠 뒤인가 (지났으면 음수). 날짜가 아니면 null
//   ⚠ new Date('2026-10-06') 은 UTC 자정(한국 09시)이라 그대로 빼면 하루 어긋난다 → 둘 다 이 PC 날짜로 센다
export const daysTo = (date, today = ymdLocal()) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(date || ''))) return null
  return Math.round((atNoon(date) - atNoon(today)) / 86400000)
}
// 이번 주 일요일까지 며칠 남았나 (월요일 시작)
export const daysToWeekEnd = (today = ymdLocal()) => { const w = atNoon(today).getDay() || 7; return 7 - w }

// 같은 요청번호끼리 묶는다
export function groupRequests(list) {
  const groups = [], by = new Map()
  ;(list || []).forEach((r) => {
    const key = r.req_no || `_${r.id}`
    let g = by.get(key)
    if (!g) { g = { key, head: r, items: [] }; by.set(key, g); groups.push(g) }
    g.items.push(r)
  })
  return groups
}

export const BUCKETS = [
  { key: 'now',   label: '지금 볼 것',   tone: 'red' },
  { key: 'week',  label: '이번 주',      tone: 'amber' },
  { key: 'later', label: '다음 주 이후', tone: 'blue' },
  { key: 'none',  label: '필요일 없음',  tone: 'gray' },
]

export function decorate(g, today = ymdLocal()) {
  const h = g.head
  const openItems = g.items.filter((r) => isOpen(r.status))
  const live = openItems.length > 0
  const d = daysTo(h.need_date, today)
  const handlers = [...new Set(g.items.map((r) => String(r.handler || '').trim()).filter(Boolean))]
  // 주겠다고 한 날(불출 예정일)이 지났는데 아직 안 나간 품목
  const late = openItems.map((r) => daysTo(r.ready_date, today)).filter((x) => x !== null && x < 0)
  const overdue = live && d !== null && d < 0
  const urgent = live && h.urgency === '긴급'
  const bucket = overdue || urgent ? 'now' : d === null ? 'none' : d <= daysToWeekEnd(today) ? 'week' : 'later'
  return { ...g, d, live, overdue, urgent, handlers, unassigned: live && handlers.length === 0,
    readyLate: late.length > 0, readyLateDays: late.length ? -Math.min(...late) : 0, bucket }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const SORT = {
  // 긴급 먼저 → 오래 지난 순
  now:   (a, b) => (b.urgent - a.urgent) || cmp(a.head.need_date || '9999', b.head.need_date || '9999') || cmp(a.key, b.key),
  week:  (a, b) => cmp(a.head.need_date, b.head.need_date) || cmp(a.key, b.key),
  later: (a, b) => cmp(a.head.need_date, b.head.need_date) || cmp(a.key, b.key),
  // 오래된 요청 순
  none:  (a, b) => cmp(a.head.req_date || '', b.head.req_date || '') || cmp(a.key, b.key),
}

export const KPI_TEST = {
  overdue: (g) => g.overdue, readyLate: (g) => g.readyLate, unassigned: (g) => g.unassigned, urgent: (g) => g.urgent,
}

// who: null(전체) · '__me' · '__none'(미배정) · '__etc'(그 외) · 처리자 이름
export function buildView(list, { who = null, kpi = null, me = '', today = ymdLocal(), top = 4 } = {}) {
  const groups = groupRequests(list).map((g) => decorate(g, today))
  const counts = { overdue: 0, readyLate: 0, unassigned: 0, urgent: 0 }
  const byHandler = new Map()
  groups.forEach((g) => {
    Object.keys(counts).forEach((k) => { if (KPI_TEST[k](g)) counts[k]++ })
    g.handlers.forEach((hn) => byHandler.set(hn, (byHandler.get(hn) || 0) + 1))
  })
  const ranked = [...byHandler.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
  const named = ranked.slice(0, top), rest = ranked.slice(top)
  const etcNames = new Set(rest.map(([nm]) => nm))
  const myName = String(me || '').trim()
  const chips = [{ key: null, label: '전체', count: groups.length }]
  if (myName) chips.push({ key: '__me', label: '내 담당', count: groups.filter((g) => g.handlers.includes(myName)).length, me: true })
  named.forEach(([nm, c]) => chips.push({ key: nm, label: nm, count: c }))
  if (rest.length) chips.push({ key: '__etc', label: '그 외', count: groups.filter((g) => g.handlers.some((x) => etcNames.has(x))).length })
  chips.push({ key: '__none', label: '미배정', count: groups.filter((g) => g.handlers.length === 0).length, none: true })

  const passWho = (g) => who === null ? true
    : who === '__me' ? g.handlers.includes(myName)
    : who === '__none' ? g.handlers.length === 0
    : who === '__etc' ? g.handlers.some((x) => etcNames.has(x))
    : g.handlers.includes(who)
  const shown = groups.filter((g) => passWho(g) && (!kpi || KPI_TEST[kpi](g)))
  const sections = BUCKETS.map((b) => ({ ...b, groups: shown.filter((g) => g.bucket === b.key).sort(SORT[b.key]) }))
  return { groups, shown, counts, chips, sections, filtered: who !== null || !!kpi, items: (list || []).length }
}
