import { supabase } from './supabase'
import { must } from './db'
import { mergeMissing, clearMissing, missKey, distributeShort, orderHogis } from './missingBulk'
import { stripPrefix } from './custPrefix'
import { applyAutoStatus } from './prodAuto'

// ASSY 출고 ↔ 생산관리 호기 (v4.241.0)
//   · ASSY 출고할 때 생산관리 호기를 고르면, 덜 뺀 수량을 그 호기들 미불출(missing_parts)에 넣고 「파트 불출」 체크를 켠다
//   · 어느 호기에 얼마 — 미불출 일괄 입력과 같은 규칙: 납기 빠른 호기부터 채우고 모자란 만큼만 뒤 호기에 (distributeShort)
//   · 다 받은 호기는 같은 품목의 예전 미불출을 지운다 (이번 BOM 품목만 손댄다)
//   · 나중에 들어오면 「미불출 모아보기」에서 불출 → 재고 차감 + 미불출 줄이기

const COLS = 'id,pn,hogi,name,status,req_date,part_issue,missing_parts,changes,customer_code'
const bare = (c) => stripPrefix(String(c || '').trim())

// 이 상위품번의 진행 중 호기 (pn 은 AX- 가 붙은 것 · 안 붙은 것이 섞여 있다)
export async function fetchProjHogis(code) {
  const c = String(code || '').trim()
  if (!c) return []
  const pns = [...new Set([c, bare(c)].filter(Boolean))]
  const data = must(await supabase.from('production').select(COLS).in('pn', pns).limit(500), '생산관리 호기 읽기') || []
  return orderHogis(data.filter((r) => r.status !== '완료'))
}

// 처음 고를 호기 — 아직 파트 불출 안 한 호기를 납기 순으로 n 대
export function defaultHogis(rows, n) {
  const open = orderHogis(rows).filter((r) => !(r.part_issue === true || /^(true|1|y)$/i.test(String(r.part_issue ?? ''))))
  return open.slice(0, Math.max(0, Number(n) || 0)).map((r) => r.id)
}

/**
 * 고른 호기들에 미불출 쓰기
 * @param ids    호기 id 목록
 * @param parts  [{ std_code, item_id, name, maker, makerPn, per(대당), have(이번에 뺀 수 — 고른 호기 전체) }]
 * @param opt    { by, label, markIssued }
 * @returns { before: [{id, missing_parts, part_issue, changes, status}], touched, lines, short }
 */
export async function writeHogiMissing(ids, parts, opt = {}) {
  if (!ids?.length) return { before: [], touched: 0, lines: 0, short: 0 }
  const fresh = must(await supabase.from('production').select(COLS).in('id', ids), '생산관리 호기 읽기') || []
  const rows = orderHogis(fresh)
  const before = JSON.parse(JSON.stringify(rows.map((r) => ({ id: r.id, missing_parts: r.missing_parts ?? [], part_issue: r.part_issue ?? null, changes: r.changes ?? [], status: r.status }))))
  const list = (parts || []).filter((p) => p && (p.std_code || p.pn) && Number(p.per) > 0)
    .map((p) => ({ ...p, pn: bare(p.std_code || p.pn), key: missKey(p) }))
  const dist = Object.fromEntries(list.map((p) => [p.key, distributeShort(rows, p.per, p.have)]))
  const now = new Date().toISOString()
  let touched = 0, lines = 0, short = 0
  for (const r of rows) {
    const mine = list.map((p) => ({ ...p, qty: dist[p.key]?.[r.id] ?? 0 }))
    const add = mine.filter((p) => p.qty > 0)
    const res = mergeMissing(r.missing_parts, add, 'set')
    let next = res.next
    const full = mine.filter((p) => !(p.qty > 0)).map((p) => p.key)
    const cl = clearMissing(next, full); next = cl.next
    short += add.reduce((a, p) => a + p.qty, 0)
    const patch = { missing_parts: next, updated_at: now }
    if (opt.markIssued) patch.part_issue = true
    const msg = `${opt.label || 'ASSY 출고'} — 미불출 ${add.length}품목${add.length ? ` (${add.slice(0, 6).map((p) => `${p.pn}×${p.qty}`).join(', ')}${add.length > 6 ? ' …' : ''})` : ''}${cl.removed ? ` · 다 받아 지움 ${cl.removed}` : ''}${opt.markIssued ? ' · 파트 불출 체크' : ''}`
    patch.changes = [...(Array.isArray(r.changes) ? r.changes : []), { type: '미불출입력', msg, at: now, by: opt.by || null }]
    must(await supabase.from('production').update(patch).eq('id', r.id), '생산관리 미불출 저장')
    touched++; lines += add.length
    // 파트 불출 체크 → 상태 자동 (생산관리 화면에서 체크한 것과 같게)
    if (opt.markIssued) {
      try { await applyAutoStatus({ ...r, ...patch }, String(r.customer_code || 'AX').toUpperCase(), new Map(), opt.by) } catch { /* 상태 자동만 못 한다 */ }
    }
  }
  return { before, touched, lines, short }
}

// 되돌리기 — 쓰기 전 값 그대로
export async function restoreHogis(before) {
  for (const b of before || [])
    must(await supabase.from('production').update({ missing_parts: b.missing_parts, part_issue: b.part_issue, changes: b.changes, status: b.status, updated_at: new Date().toISOString() }).eq('id', b.id), '호기 되돌리기')
}
