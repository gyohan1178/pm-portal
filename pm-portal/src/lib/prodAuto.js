// 생산관리 상태 자동 변경 · 검수 (v4.116.0, 2026-10-29) — AXCELIS · VM · CSK
//   자재불출 끝 → 「제작대기」 · 제작완료 → 「품질검수」 · 품질 완료(검수 모두 합격) → 「납품대기」
//   · 앞으로만 자동 — 이미 더 뒤 단계(제작중 등 사람이 바꾼 것 포함)면 건드리지 않음
//   · 외주 · 현장작업 · 완료는 자동 대상 아님
//   · 체크를 풀면 「자동으로 바꾼 것」만 원래 상태로 (production.changes 에 남긴 자동 기록으로 찾음)
//   고객사별 체크
//     AXCELIS : 자재불출 = 전장 불출(part_issue) · 제작완료 = 전장 완료(elec_recv) · 품질 = 완료요청(quality_recv)
//     VM      : 자재불출 = 검수 대상 박스 자재가 모두 「완료」 · 제작완료 = 제작완료 칸(elec_recv) · 품질 = 대상 박스 검수 모두 합격 (또는 완료요청 ✔)
//     CSK     : 자재불출 = 자재불출 칸(part_issue) · 제작완료 = 제작완료 칸(elec_recv) · 품질 = 검수 합격 (또는 완료요청 ✔)
import { supabase } from './supabase'

export const AUTO_ORDER = ['PO접수', '자재발주', '제작대기', '제작중', '품질검수', '납품대기']
export const VM_BOXES = [['esc', 'ESC'], ['ac', 'AC'], ['ut', 'UT'], ['st', 'ST'], ['pm', 'PM'], ['etc', 'ETC']]
export const AUTO_CUST = ['AX', 'VM', 'CSK']

const truthy = (v) => v === true || (typeof v === 'string' && v.trim() !== '' && v !== 'false')
export const qcKey = (id, part) => `${id}|${part || 'all'}`

// VM 검수 대상 박스 — 자재 칸에 값이 있는 박스. 하나도 없으면 여섯 개 전부
export function vmBoxesNeeded(r) {
  const ks = VM_BOXES.map(([k]) => k).filter((k) => String(r?.vm?.[k] || '') !== '')
  return ks.length ? ks : VM_BOXES.map(([k]) => k)
}

// 검수 기록 → 지금 상태 · 이력  (rows: pm_prod_qc, id 순)
export function qcIndex(rows) {
  const latest = new Map(), hist = new Map()
  for (const q of rows || []) {
    const k = qcKey(q.production_id, q.part)
    latest.set(k, q)
    if (!hist.has(k)) hist.set(k, [])
    hist.get(k).push(q)
  }
  return { latest, hist }
}
export const qcResult = (latest, id, part) => {
  const q = latest?.get(qcKey(id, part))
  return q && q.result !== '취소' ? q.result : null
}

// 단계 체크 상태
export function stagesOf(r, cust, latest) {
  const c = String(cust || '').toUpperCase()
  if (c === 'VM') {
    const need = vmBoxesNeeded(r)
    const allPass = need.every((k) => qcResult(latest, r.id, k) === '합격')
    return { mat: need.every((k) => r.vm?.[k] === '완료'), made: !!r.elec_recv, qc: allPass || !!r.quality_recv, allPass, need }
  }
  if (c === 'CSK') {
    const pass = qcResult(latest, r.id, 'all') === '합격'
    return { mat: truthy(r.part_issue), made: !!r.elec_recv, qc: pass || !!r.quality_recv, allPass: pass }
  }
  return { mat: truthy(r.part_issue), made: !!r.elec_recv, qc: !!r.quality_recv }
}
const targetOf = (st) => (st.qc ? '납품대기' : st.made ? '품질검수' : st.mat ? '제작대기' : null)
const WHY = { 제작대기: '자재불출 끝', 품질검수: '제작완료', 납품대기: '품질 완료' }
const newKey = () => Math.random().toString(36).slice(2, 10)   // 자동 기록마다 고유 번호 (되돌릴 때 어느 것인지)

// 바꿀 상태 — 없으면 null. 반환 { status, changes(전체 새 배열), msg }
export function autoStatus(r, cust, latest, by) {
  if (!AUTO_CUST.includes(String(cust || '').toUpperCase())) return null
  const cur = r.status || 'PO접수'
  const ci = AUTO_ORDER.indexOf(cur)
  if (ci < 0) return null                                   // 외주 · 현장작업 · 완료
  const tgt = targetOf(stagesOf(r, cust, latest))
  const ti = tgt ? AUTO_ORDER.indexOf(tgt) : -1
  const at = new Date().toISOString()
  const chg = Array.isArray(r.changes) ? r.changes : []
  if (ti > ci) {                                            // 앞으로
    return { status: tgt, msg: `${r.hogi || ''} 상태 ${cur} → ${tgt} (${WHY[tgt]})`,
      changes: [...chg, { type: '자동상태', key: newKey(), src: '생산관리 체크', prev: cur, to: tgt, at, by: by || null }] }
  }
  if (ti < ci) {                                            // 체크를 풀었음 — 자동으로 바꾼 것만 되돌림
    const undone = new Set(chg.filter((c) => c?.type === '자동상태취소').map((c) => c.undo))
    const keyOf = (c) => c.key || c.at
    let entry = null
    for (let i = chg.length - 1; i >= 0; i--) {
      const c = chg[i]
      if (c?.type === '자동상태' && !undone.has(keyOf(c))) { entry = c; break }
    }
    if (!entry || entry.to !== cur) return null              // 마지막 자동 변경 뒤에 사람이 바꿨으면 그대로
    const pi = AUTO_ORDER.indexOf(entry.prev)
    const back = ti > pi ? tgt : entry.prev
    const add = [{ type: '자동상태취소', src: '생산관리 체크', undo: keyOf(entry), prev: cur, to: back, at, by: by || null }]
    if (back !== entry.prev) add.push({ type: '자동상태', key: newKey(), src: '생산관리 체크', prev: entry.prev, to: back, at, by: by || null })
    return { status: back, msg: `${r.hogi || ''} 상태 ${cur} → ${back} (체크 해제)`, changes: [...chg, ...add] }
  }
  return null
}

// 저장 — 바뀐 게 있으면 production 에 status · changes 를 쓰고 안내 글을 돌려준다
export async function applyAutoStatus(r, cust, latest, by) {
  const a = autoStatus(r, cust, latest, by)
  if (!a) return null
  const { error } = await supabase.from('production')
    .update({ status: a.status, changes: a.changes, updated_at: new Date().toISOString() }).eq('id', r.id)
  if (error) throw error
  return a.msg
}

// 검수 기록 불러오기 — 표가 없으면(SQL 전) setup:false
export async function fetchProdQc(ids) {
  const out = []
  if (!ids.length) {
    const { error } = await supabase.from('pm_prod_qc').select('id').limit(1)
    return { setup: !error, rows: [] }
  }
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_prod_qc')
      .select('id,production_id,part,result,memo,by_name,at').in('production_id', ids.slice(i, i + 200)).order('id')
    if (error) return { setup: false, rows: [] }
    out.push(...(data || []))
  }
  return { setup: true, rows: out }
}
