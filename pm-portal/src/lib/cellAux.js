// 보조 칸 (넘쳐 보관) — v4.79.0
//
//   본 칸(inventory.location)에 자리가 모자라 같은 품목을 다른 칸에도 둘 때, 그 칸을 「보조 칸」으로 등록한다.
//   재고 수량(inventory.qty)은 지금처럼 품목당 하나 = 합계. 보조 칸마다 그 칸 수량만 따로 기억한다(pm_cell_aux).
//     본 칸 수량 = 합계 − 보조 칸 수량들
//   실사는 칸마다 그 칸 것만 세고, 차이만큼 합계에 반영된다 (DB pm_cycle_save 의 part:'aux').
//   표가 없으면(DB 설정 전) 모든 함수가 빈 값을 돌려준다 — 화면은 예전과 같다.
import { supabase } from './supabase'
import { normLoc } from './cycleCount'

const missing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /pm_cell_aux/.test(e.message || ''))

// 품목들의 보조 칸 — Map(item_id → [{ id, location, qty, counted_at }])
export async function fetchAuxByItems(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  const m = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_cell_aux')
      .select('id,item_id,location,qty,counted_at').in('item_id', ids.slice(i, i + 200)).order('location')
    if (error) { if (missing(error)) return m; throw error }
    ;(data || []).forEach((a) => { if (!m.has(a.item_id)) m.set(a.item_id, []); m.get(a.item_id).push(a) })
  }
  return m
}

// 전체 보조 칸 (재고현황용 — 많지 않다) — Map(item_id → [...])
export async function fetchAllAux() {
  const m = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('pm_cell_aux')
      .select('id,item_id,location,qty,counted_at').order('id').range(from, from + 999)
    if (error) { if (missing(error)) return m; throw error }
    ;(data || []).forEach((a) => { if (!m.has(a.item_id)) m.set(a.item_id, []); m.get(a.item_id).push(a) })
    if (!data || data.length < 1000) break
  }
  return m
}

// 이 칸이 보조 칸인 품목들 — [{ id, item_id, location, qty, counted_at, item:{…}, total, main }]
//   ok:false = 표 없음 (DB 설정 전)
export async function fetchAuxAt(loc) {
  const L = normLoc(loc)
  const { data, error } = await supabase.from('pm_cell_aux')
    .select('id,item_id,location,qty,counted_at').eq('location', L).order('id')
  if (error) { if (missing(error)) return { ok: false, rows: [] }; throw error }
  const rows = data || []
  if (!rows.length) return { ok: true, rows }
  const ids = rows.map((r) => r.item_id)
  const [{ data: its }, { data: inv }, all] = await Promise.all([
    supabase.from('items').select('id,std_code,name,unit,manufacturer,manufacturer_code').in('id', ids),
    supabase.from('inventory').select('item_id,qty,location').in('item_id', ids),
    fetchAuxByItems(ids),
  ])
  const iOf = new Map((its || []).map((x) => [x.id, x]))
  const vOf = new Map((inv || []).map((x) => [x.item_id, x]))
  return {
    ok: true,
    rows: rows.map((r) => {
      const total = Number(vOf.get(r.item_id)?.qty) || 0
      const auxSum = (all.get(r.item_id) || []).reduce((a, b) => a + (Number(b.qty) || 0), 0)
      return { ...r, item: iOf.get(r.item_id) || null, total, main: total - auxSum, mainLoc: vOf.get(r.item_id)?.location || '' }
    }),
  }
}

// 보조 칸 등록 — lines: [{ item_id, qty? }] · 수량을 넣으면 오늘 센 것으로
//   합계는 그대로 (본 칸에서 그만큼 옮겨 둔 것으로 본다)
export async function registerAux(loc, lines, today) {
  const L = normLoc(loc)
  const payload = (lines || []).filter((l) => l.item_id).map((l) => {
    const q = l.qty === '' || l.qty == null ? null : Number(l.qty)
    return { item_id: l.item_id, location: L, qty: q != null && q >= 0 ? q : 0, counted_at: q != null && q >= 0 ? today : null }
  })
  if (!payload.length) throw new Error('고른 품목이 없습니다')
  const { error } = await supabase.from('pm_cell_aux').upsert(payload, { onConflict: 'item_id,location' })
  if (error) throw new Error(missing(error) ? '보조 칸 DB 설정(보조칸_261020.sql)을 먼저 실행해야 합니다' : error.message)
  return payload.length
}

// 보조 칸 해제 — 그 칸 수량은 본 칸으로 넘어간 것으로 (합계 그대로)
export async function releaseAux(id) {
  const { error } = await supabase.from('pm_cell_aux').delete().eq('id', id)
  if (error) throw error
}

// 글 — 'N1-01-1 (+N1-01-2)' · withQty 면 '(+N1-01-2 35)'
export function locWithAux(main, aux, withQty = false) {
  const list = (aux || []).map((a) => `+${a.location}${withQty ? ` ${Number(a.qty) || 0}` : ''}`)
  if (!list.length) return main || ''
  return `${main || '(본 칸 없음)'} (${list.join(' ')})`
}
