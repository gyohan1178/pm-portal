// 업무 흐름 — 「마지막으로 본 숫자」를 기억해서 새로 늘어난 것 · 처리된 것만 알려준다 (v4.97.0)
//   기록은 이 브라우저(PC · 폰 각각)에만 남는다. 처음 쓰는 브라우저는 지금 숫자를 그대로 기준으로 삼는다(알림 없음).
//   키: b:<배지 이름>(단계 · 보조 업무 배지, 같은 이름은 하나) · st:<단계 이름>(그 단계 합계) · i:<넘어온 일> · o:<넘긴 일>
import { supabase } from './supabase'
import { autoDeliverLegacy } from './legacyDeliver'

// 단계별 건수 — 업무 흐름 화면 · 사이드바가 같은 키로 한 번만 받는다. 함수가 아직 없으면(SQL 전) null
export const flowCountsQuery = {
  queryKey: ['flowCounts'],
  queryFn: async () => {
    await autoDeliverLegacy()   // 이관분 납기 지난 줄 — 하루 한 번 납품 처리한 뒤에 센다 (v4.108.0)
    const { data, error } = await supabase.rpc('pm_flow_counts')
    if (error) return null
    return data || null
  },
  staleTime: 2 * 60 * 1000,
  refetchInterval: 5 * 60 * 1000,
}

const KEY = (uid, dept) => `pm.flowSeen.${uid || 'me'}.${dept}`
export const FLOW_SEEN_EVENT = 'pm-flow-seen'

export function readSeen(uid, dept) {
  try { const v = JSON.parse(localStorage.getItem(KEY(uid, dept)) || 'null'); return v && typeof v === 'object' ? v : null } catch { return null }
}
export function writeSeen(uid, dept, map) {
  try { localStorage.setItem(KEY(uid, dept), JSON.stringify(map || {})) } catch { /* 저장 안 되는 브라우저 */ }
  try { window.dispatchEvent(new Event(FLOW_SEEN_EVENT)) } catch { /* noop */ }
}

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

// 흐름(flowOf 결과) → 숫자 사진. 다른 부서가 처리하는 단계(other)는 내 일이 아니므로 뺀다
export function flowSnapshot(f) {
  const m = {}
  if (!f) return m
  for (const s of f.steps || []) {
    if (s.other) continue
    let tot = 0, any = false
    for (const b of s.badges || []) { const n = num(b.n); if (n === null) continue; m['b:' + b.t] = n; tot += n; any = true }
    if (any) m['st:' + s.name] = tot
  }
  for (const s of f.subs || []) for (const b of s.badges || []) { const n = num(b.n); if (n !== null) m['b:' + b.t] = n }
  for (const h of f.inbox || []) { const n = num(h.n); if (n !== null) m['i:' + h.text] = n }
  for (const h of f.outbox || []) { const n = num(h.n); if (n !== null) m['o:' + h.text] = n }
  return m
}

// 기준보다 늘어난 만큼 (기준에 없던 키는 새 기능이므로 0 — 처음 보는 배지로 알림이 쏟아지지 않게)
export function grew(snap, base, key) {
  if (!snap || !base) return 0
  const now = snap[key], was = base[key]
  if (now === undefined || was === undefined) return 0
  return Math.max(0, now - was)
}
export function shrank(snap, base, key) {
  if (!snap || !base) return 0
  const now = snap[key], was = base[key]
  if (now === undefined || was === undefined) return 0
  return Math.max(0, was - now)
}

// 사이드바 · 탭 제목에 띄울 「새로 늘어난 내 일」 합계 — 단계 · 보조 업무 배지만 (넘어온 일은 같은 숫자가 겹치므로 뺀다)
export function freshTotal(snap, base) {
  if (!snap || !base) return 0
  let t = 0
  for (const k of Object.keys(snap)) if (k.startsWith('b:')) t += grew(snap, base, k)
  return t
}

// 탭 제목 앞에 「(3) 」 — 인쇄할 때 제목을 잠깐 바꾸는 화면이 있어 앞부분만 고친다
export function setTitleCount(n) {
  try {
    const bare = String(document.title || '').replace(/^\(\d+\+?\)\s*/, '')
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${bare}` : bare
  } catch { /* noop */ }
}
