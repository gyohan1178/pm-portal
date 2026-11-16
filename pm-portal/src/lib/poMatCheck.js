// 수주대장 PO 자재 점검 (v4.199.0)
//   PO 한 건의 BOM 을 풀어 부족 · 입고 늦음 · 충분을 가른다. 계산은 SQL pm_order_po_check (수주확인_자재점검_반영_261116.sql)
//   여기는 화면에 쓰는 정리 · 문구만 — 시험하기 쉽게 화면 파일과 나눴다
import { supabase } from './supabase'
import { kstDT } from './utils'

export const MATCHK_SQL = '수주확인_자재점검_반영_261116.sql'

export async function fetchPoCheck(orderId) {
  const { data, error } = await supabase.rpc('pm_order_po_check', { p_order_id: orderId })
  if (error) {
    if (['42883', 'PGRST202'].includes(error.code) || /Could not find the function|does not exist/i.test(error.message || '')) {
      const e = new Error(`자재 점검 SQL 이 아직 없습니다 — ${MATCHK_SQL} 을 먼저 실행하세요`)
      e.noFn = true
      throw e
    }
    throw error
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const n = (v) => Number(v) || 0
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')

// 판정별로 나눈다 — 하네스(제작)는 부족으로 세지 않는다
export function splitCheck(res) {
  const rows = res?.rows || []
  const by = (v) => rows.filter((r) => r.verdict === v)
  return {
    short: by('short'), late: by('late'), ok: by('ok'), harness: by('harness'),
    // 뒤 PO 영향 — 이 PO 는 되지만, 받으면 뒤에 「가능」 회신한 PO 가 모자라짐 (중간에 끼어든 PO · v4.199.0)
    squeeze: rows.filter((r) => r.squeeze && r.verdict !== 'short' && r.verdict !== 'harness'),
    parts: rows.filter((r) => r.verdict !== 'harness').length,
    nobomRows: rows.filter((r) => r.nobom && r.verdict !== 'harness'),
  }
}

export const hasProblem = (s) => s.short.length > 0 || s.late.length > 0 || (s.squeeze || []).length > 0

// 모자란 품목 · 늦은 입고가 들어간 이 PO 의 줄
export function affectedLineIds(s) {
  const ids = new Set()
  for (const r of [...s.short, ...s.late, ...(s.squeeze || [])]) for (const id of r.line_ids || []) ids.add(id)
  return ids
}

// 들어올 발주 중 가장 늦은 날 + 7일 — 「가능한 날」 제안. 부족인데 발주가 없으면 정할 수 없어 빈 칸
export function suggestDate(s) {
  if (s.short.some((r) => n(r.pend_all) <= 0)) return ''
  let last = ''
  for (const r of s.late) if (r.late_at && r.late_at > last) last = r.late_at
  for (const r of s.short) for (const x of r.ins || []) if (x.d && x.d > last) last = x.d
  if (!last) return ''
  const d = new Date(last + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}

const nextIn = (r) => (r.ins || []).filter((x) => x.d).map((x) => md(x.d)).slice(-1)[0]

// 조건부 회신 사유 — 점검 결과로 미리 채움 (영업 화면에 그대로 보임)
export function reasonText(res, s) {
  const out = []
  if (s.short.length) {
    const one = (r) => `${r.std_code} ${n(r.short).toLocaleString('ko-KR')}개${nextIn(r) ? ` (${nextIn(r)} 입고)` : ' (발주 없음)'}`
    out.push(`부족 ${s.short.length}품목 — ${s.short.slice(0, 5).map(one).join(' · ')}${s.short.length > 5 ? ` 외 ${s.short.length - 5}` : ''}`)
  }
  if (s.late.length) {
    out.push(`입고 늦음 ${s.late.length}품목 — ${s.late.slice(0, 5).map((r) => `${r.std_code} ${md(r.late_at)}`).join(' · ')}${s.late.length > 5 ? ` 외 ${s.late.length - 5}` : ''} (불출일 ${md(res?.rel_min)} 뒤)`)
  }
  if ((s.squeeze || []).length) {
    out.push(`뒤 PO 영향 ${s.squeeze.length}품목 — 이 PO 를 받으면 먼저 「가능」 회신한 PO 몫이 모자람: ${s.squeeze.slice(0, 5).map((r) => `${r.std_code} ${n(r.squeeze_q).toLocaleString('ko-KR')}개${r.later_pos ? ` (${r.later_pos})` : ''}`).join(' · ')}${s.squeeze.length > 5 ? ` 외 ${s.squeeze.length - 5}` : ''}`)
  }
  const nb = n(res?.lines?.nobom)
  if (nb) out.push(`BOM 없음 ${nb}줄 — 하위 구성 확인 필요`)
  return out.join('\n')
}

// 변경 이력에 남길 한 줄
export function checkLogText(res, s, reply) {
  return `자재 점검 ${res?.checked_at ? kstDT(res.checked_at) : ''} · 하위 ${s.parts}품목 · 부족 ${s.short.length}${s.short.length ? ` (${s.short.slice(0, 3).map((r) => r.std_code).join(', ')}${s.short.length > 3 ? ' 외' : ''})` : ''} · 입고 늦음 ${s.late.length}${(s.squeeze || []).length ? ` · 뒤 PO 영향 ${s.squeeze.length}` : ''} → ${reply}`
}
