// 할 일 — 「내 일」 판정 · 묶음 · 알림 숫자 (2026-10-12)
//   할 일 화면과 사이드바 숫자가 같은 규칙을 쓰도록 한곳에 둔다.
import { todayISO } from './utils'

export const dday = (d, today = todayISO()) =>
  (d ? Math.round((new Date(d) - new Date(today)) / 86400000) : null)

// 담당자가 그 사람인지.
//   담당자 이름이 적혀 있으면 이름으로 본다 — 예전엔 담당자를 바꿔도 연결(owner_id)은 처음 사람에게
//   남아, 넘겨받은 사람 화면에 안 뜨고 넘긴 사람 화면에 계속 떴다. 이름이 비었을 때만 연결로 본다.
//   「남기문 대리」 처럼 직함이 붙어도 같은 사람으로 본다.
const norm = (s) => String(s || '').replace(/\s+/g, '')
export function isOwnedBy(r, person) {
  if (!r || !person) return false
  const o = norm(r.owner), n = norm(person.name)
  if (o) return !!n && (o === n || o.startsWith(n))
  return !!r.owner_id && r.owner_id === person.id
}

// 고치고 지울 수 있는 일 = 내가 담당이거나 내가 적은 일
export const canEditTodo = (r, me) => !!me && (isOwnedBy(r, me) || r.created_by === me.id)

// 남이 나에게 맡겼는데 아직 열어 보지 않은 일.
//   seen_at 칸이 없는 DB(SQL 전)에서는 표시하지 않는다.
export function isNewForMe(r, me) {
  if (!me || !r || r.status === '완료') return false
  if (!('seen_at' in r) || r.seen_at) return false
  if (!r.created_by || r.created_by === me.id) return false
  return isOwnedBy(r, me)
}

// 급한 순서 묶음
export function groupOf(r, today = todayISO()) {
  if (r.status === '완료') return 'done'
  const d = dday(r.due_date, today)
  if (d == null) return 'later'
  if (d < 0) return 'overdue'
  if (d <= 7) return 'soon'
  return 'later'
}

// 사이드바 숫자 = 내 일 중 기한 지남 + 오늘까지 + 새로 받은 일
export function alertCountFor(rows, me, today = todayISO()) {
  if (!me) return 0
  return (rows || []).filter(r => {
    if (r.status === '완료' || !isOwnedBy(r, me)) return false
    const d = dday(r.due_date, today)
    return (d != null && d <= 0) || isNewForMe(r, me)
  }).length
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// 「내일로」 · 「다음 주」 — 오늘 기준
export function postponeDate(kind, today = todayISO()) {
  const [y, m, dd] = today.split('-').map(Number)
  const d = new Date(y, m - 1, dd)
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1)
  else { const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add) }   // 다음 주 월요일
  return iso(d)
}
