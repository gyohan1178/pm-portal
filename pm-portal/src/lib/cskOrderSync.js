// CSK 생산관리 ← 수주대장 (v4.121.0)
//   예전에는 CSK 가 주는 「생산 Schedule」 엑셀을 생산관리에 올렸다(📅 일정표 올리기).
//   이제는 수주대장의 진행 중 CSK 줄 중 「관리번호」가 있는 줄(장비 1대 = 1줄 · pm_csk_order_units)로 만든다.
//   · 생산관리에 없는 관리번호 → 새 줄 (「📥 수주대장에서 불러오기」 — 미리 보고 실행)
//   · 있는 관리번호 → 발주 번호 · Plnd · Prod 번호만 수주대장 값으로 맞춘다
//     (발주 예정 → 실제 PO 로 바뀐 것을 생산관리에도 보이게. 상태 · 날짜 · 불출 · 메모는 그대로)
//   수주대장에 없는 칸(NO/ · Option · 자재 반출일 · 비고1)은 새 줄에서 비어 있다
import { cskOrdered } from './cskSchedule'

const s = (v) => (v == null ? '' : String(v).trim())
const numTxt = (v) => (v == null || v === '' ? '' : String(Number(v)))

// 받기 — 함수가 없으면(SQL 전) setup:false
export async function fetchCskOrderUnits(supabase) {
  const { data, error } = await supabase.rpc('pm_csk_order_units')
  if (error) return { setup: false, units: [] }
  return { setup: true, units: (data || []).filter((u) => s(u.mgmt)) }
}

// 수주대장 값 → production.csk 에 담는 칸 (일정표 머리글 이름 그대로)
const cskOf = (u) => ({
  mgmt: s(u.mgmt), po_no: s(u.po_no), spec: s(u.spec), gubun: s(u.model), pre_assy: s(u.pre_assy),
  plnd: s(u.plnd), prod: s(u.prod), qty: numTxt(u.qty),
  order_date: u.order_date || null, in_req: u.due || null, due: u.due || null,
  src: '수주대장',
})
// 있는 줄에서 맞추는 칸
const SYNC_KEYS = ['po_no', 'plnd', 'prod']
const LABEL = { po_no: '발주 번호', plnd: 'Plnd', prod: 'Prod' }

export function planCskImport(units, rows) {
  const byMgmt = new Map()
  for (const r of rows || []) if (s(r.hogi)) byMgmt.set(s(r.hogi), r)
  const ins = [], upd = [], same = [], seen = new Set()
  for (const u of units || []) {
    const m = s(u.mgmt)
    if (!m || seen.has(m)) continue
    seen.add(m)
    const ex = byMgmt.get(m)
    if (!ex) { ins.push(u); continue }
    const c = cskOf(u), old = ex.csk || {}
    const diff = SYNC_KEYS.filter((k) => c[k] && s(old[k]) !== c[k])
    if (diff.length) upd.push({ u, row: ex, diff })
    else same.push(u)
  }
  return { ins, upd, same }
}

const newId = () => 'pbcsk' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 9)

// 새 줄 모양 — 예전 일정표(pm_csk_schedule_apply)가 만들던 줄과 같은 칸
export function rowFromUnit(u, by) {
  const now = new Date().toISOString()
  const c = cskOf(u)
  return {
    id: newId(), company: 'CSK', customer_code: 'CSK', created_at: now, updated_at: now,
    pn: c.spec || c.mgmt, name: c.spec || c.mgmt, hogi: c.mgmt, part: c.gubun || null,
    status: 'PO접수', po_received: cskOrdered(c), req_date: c.due || '',
    missing_parts: [],
    changes: [{ type: '신규', src: '수주대장', at: now, by: by || null, msg: '수주대장에서 불러옴' }],
    csk: c,
  }
}

export async function applyCskImport(supabase, plan, by) {
  const recs = plan.ins.map((u) => rowFromUnit(u, by))
  for (let i = 0; i < recs.length; i += 200) {
    const { error } = await supabase.from('production').insert(recs.slice(i, i + 200))
    if (error) throw error
  }
  const now = new Date().toISOString()
  for (const { u, row, diff } of plan.upd) {
    const c = cskOf(u)
    const csk = { ...(row.csk || {}) }
    for (const k of diff) csk[k] = c[k]
    const patch = { csk, updated_at: now, po_received: !!row.po_received || cskOrdered(csk) }
    patch.changes = [...(Array.isArray(row.changes) ? row.changes : []),
      { type: '수주대장 맞춤', src: '수주대장', at: now, by: by || null, msg: diff.map((k) => `${LABEL[k]} ${s(row.csk?.[k]) || '—'} → ${c[k]}`).join(' · ') }]
    const { error } = await supabase.from('production').update(patch).eq('id', row.id)
    if (error) throw error
  }
  return { inserted: recs.length, updated: plan.upd.length }
}


// 미리 보기 글 (확인 창)
export function planCskText(plan) {
  const lines = plan.ins.map((u) =>
    `＋ ${u.mgmt} · ${s(u.spec)}${u.model ? ` (${u.model})` : ''} — ${s(u.po_no)} · 납기 ${String(u.due || '미정').slice(5)}`)
  for (const { u, row, diff } of plan.upd)
    lines.push(`↻ ${u.mgmt} — ${diff.map((k) => `${LABEL[k]} ${s(row.csk?.[k]) || '—'} → ${s(cskOf(u)[k])}`).join(' · ')}`)
  if (plan.same.length) lines.push(`이미 있음 ${plan.same.length}대 — 그대로 둠`)
  return lines
}
