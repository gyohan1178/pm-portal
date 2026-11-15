// 할 일 — 부서별 보기 · 일정 (v4.197.0)
//   · 보는 범위(scope): dept 내 부서 · req 유관부서 요청 · all 전사 공유 — 실제로 가리는 것은 DB 권한 규칙이고,
//     여기는 화면 표시(묶음 · 달력 · 대회의실 겹침 · 반복 다음 날짜)만 계산한다
//   · 종류(kind): todo 할 일 · note 일정/특이사항 (담당자 · 상태 없음, 그 날에 보이기만 한다)
//   · SQL 전(새 칸 없음)에는 hasSched 가 false → 화면이 예전 그대로 동작한다
import { isHoliday } from './bizdays'

export const SCOPES = [
  { key: 'dept', label: '내 부서', note: '우리 부서만' },
  { key: 'req', label: '유관부서 요청', note: '보낸 · 받는 부서만' },
  { key: 'all', label: '전사 공유', note: '전 부서가 봄' },
]
export const REPEATS = [['', '반복 안 함'], ['weekly', '매주 이 요일'], ['monthly', '매월 이 날짜'], ['monthend', '매월 말일']]
export const REPEAT_LABEL = { weekly: '매주', monthly: '매월', monthend: '매월 말일' }

// 새 칸이 DB 에 있나 — 목록 함수가 scope 칸을 돌려주면 있다. 줄이 하나도 없으면 알 수 없어 저장할 때 다시 본다
export const hasSched = (rows) => (rows || []).some((r) => r && 'scope' in r)
export const isNote = (r) => r?.kind === 'note'
export const scopeOf = (r) => r?.scope || 'dept'

const pad = (n) => String(n).padStart(2, '0')
const toDate = (ymd) => { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const toYmd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
export const addDays = (ymd, n) => { const d = toDate(ymd); d.setUTCDate(d.getUTCDate() + n); return toYmd(d) }
export const dowOf = (ymd) => toDate(ymd).getUTCDay()            // 0 일 … 6 토
const lastDom = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m: 1~12
export const isOff = (ymd) => { const w = dowOf(ymd); return w === 0 || w === 6 || isHoliday(ymd) }
// 쉬는 날이면 앞 평일로 당긴다 (월말 마감 · 주간 보고가 쉬는 날에 걸리지 않게)
export function toWorkday(ymd) { let d = ymd; for (let i = 0; i < 10 && isOff(d); i++) d = addDays(d, -1); return d }

// 반복 할 일 — 끝낸 뒤 다음 회차 날짜 (기준일 다음의 첫 회차). 기준 날짜가 없으면 null
export function nextRepeat(repeat, ymd) {
  if (!repeat || !ymd) return null
  const [y, m, d] = ymd.split('-').map(Number)
  if (repeat === 'weekly') return toWorkday(addDays(ymd, 7))
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  if (repeat === 'monthend') return toWorkday(`${ny}-${pad(nm)}-${pad(lastDom(ny, nm))}`)
  if (repeat === 'monthly') return toWorkday(`${ny}-${pad(nm)}-${pad(Math.min(d, lastDom(ny, nm)))}`)
  return null
}

// 그 날에 이 줄이 보이나
//   할 일: 기한 날 하루 (끝낸 것도 그 날에 남긴다)
//   일정 · 특이사항: 시작~끝 사이 매일. 반복이면 시작 뒤로 규칙에 맞는 날마다 (기간 길이는 그대로 따라간다)
export function occursOn(r, ymd) {
  const s = r?.due_date ? String(r.due_date).slice(0, 10) : null
  if (!s) return false
  if (!isNote(r)) return s === ymd
  const e = r.end_date && String(r.end_date).slice(0, 10) >= s ? String(r.end_date).slice(0, 10) : s
  if (ymd >= s && ymd <= e) return true
  if (!r.repeat || ymd < s) return false
  const span = Math.round((toDate(e) - toDate(s)) / 86400000)
  for (let back = 0; back <= span; back++) {       // 회차의 시작일 후보
    const st = addDays(ymd, -back)
    if (st <= s) break
    if (r.repeat === 'weekly' && dowOf(st) === dowOf(s)) return true
    const [y, m, d] = st.split('-').map(Number)
    if (r.repeat === 'monthly' && d === Math.min(Number(s.slice(8)), lastDom(y, m))) return true
    if (r.repeat === 'monthend' && d === lastDom(y, m)) return true
  }
  return false
}

// 대회의실 겹침 — 같은 날 · 시간이 겹치는 다른 줄 (시간을 안 적은 줄은 하루 종일로 본다)
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
export function roomClash(rows, draft) {
  if (!draft?.room || !draft.due_date) return []
  const a0 = mins(draft.time_from) ?? 0, a1 = mins(draft.time_to) ?? 24 * 60
  return (rows || []).filter((r) => {
    if (!r.room || r.id === draft.id || r.status === '완료') return false
    if (!occursOn(r, String(draft.due_date).slice(0, 10))) return false
    const b0 = mins(r.time_from) ?? 0, b1 = mins(r.time_to) ?? 24 * 60
    return a0 < b1 && b0 < a1
  })
}
export const hm = (t) => (mins(t) == null ? '' : String(t).slice(0, 5))
export const timeText = (r) => (hm(r.time_from) ? `${hm(r.time_from)}${hm(r.time_to) ? '~' + hm(r.time_to) : ''}` : '')

// 달력 칸 — 일요일 시작 (v4.198.0 — 월요일 시작에서 바꿈). month: 그 달이 들어간 6주(42칸) · week: 그 주 7칸
export function monthGrid(ym) {
  const first = `${ym}-01`, off = dowOf(first)
  const start = addDays(first, -off)
  return Array.from({ length: 42 }, (_, i) => { const d = addDays(start, i); return { ymd: d, inMonth: d.slice(0, 7) === ym } })
}
export function weekGrid(ymd) {
  const start = addDays(ymd, -dowOf(ymd))
  return Array.from({ length: 7 }, (_, i) => ({ ymd: addDays(start, i), inMonth: true }))
}
export const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` }

// 달력 · 위 줄에 쓰는 종류 — 색을 고른다
//   all 전사 공유 · req 유관부서 요청 · note 부서 특이사항 · rep 반복 할 일 · late 기한 지남 · done 끝남 · todo 할 일
export function chipKind(r, today) {
  if (scopeOf(r) === 'all') return 'all'
  if (scopeOf(r) === 'req') return 'req'
  if (isNote(r)) return 'note'
  if (r.status === '완료') return 'done'
  if (r.due_date && String(r.due_date).slice(0, 10) < today) return 'late'
  return r.repeat ? 'rep' : 'todo'
}
export function chipText(r, myDept) {
  const t = timeText(r)
  if (scopeOf(r) === 'all') return `${r.room ? '대회의실 ' : ''}${t ? t.split('~')[0] + ' ' : ''}${r.room ? (r.dept || '') : r.title}`.trim()
  if (scopeOf(r) === 'req') return `${r.to_dept === myDept ? '받음' : '보냄'} · ${r.title}`
  return `${r.repeat && !isNote(r) ? '↻ ' : ''}${r.title}`
}
// 그 날 보일 줄 — 전사 공유 → 부서 특이사항 → 요청 → 할 일 순서
const ORD = { all: 0, note: 1, req: 2, late: 3, rep: 4, todo: 4, done: 5 }
export function itemsOn(rows, ymd, today) {
  return (rows || []).filter((r) => occursOn(r, ymd))
    .map((r) => ({ r, kind: chipKind(r, today) }))
    .sort((a, b) => ORD[a.kind] - ORD[b.kind] || String(a.r.time_from || '').localeCompare(String(b.r.time_from || '')))
}
// 요청 — 내 부서가 받은 것 / 보낸 것 (끝난 것 제외)
export const reqInbox = (rows, myDept) => (rows || []).filter((r) => scopeOf(r) === 'req' && r.to_dept === myDept && r.status !== '완료' && !isNote(r))
export const reqSent = (rows, myDept) => (rows || []).filter((r) => scopeOf(r) === 'req' && r.dept === myDept && r.to_dept !== myDept && r.status !== '완료' && !isNote(r))
