// 같은품목(JS) 묶음 — 재고는 묶음 대표 품번 하나에서 움직인다 (v4.131.0)
//
//   같은 고객사에 품번이 여러 개로 나뉘어 등록된 같은 물건(제조사 · 제조사품번 같음)을
//   pm_item_same 에 묶어 두었다. 입출고는 원래 품번으로 하되 재고 수량 · 위치는 대표 품번에 쌓인다
//   (DB 함수 pm_rep · 트리거 update_inventory 가 대표로 돌린다).
//
//   화면에서 inventory 를 품번(item_id)으로 읽는 곳은 대표 품번 것을 읽어야 한다.
//   → invIn(): supabase.from('inventory').select(cols).in('item_id', ids) 대신 쓰면
//     묶음 품번 자리에 대표 품번의 재고 · 위치를 그대로 넣어 돌려준다 (item_id 는 물어본 품번 그대로).
//   pm_item_same 표가 없거나 못 읽으면(2단계 SQL 전 포함) 예전과 똑같이 동작한다.
import { supabase } from './supabase'

const TTL = 5 * 60 * 1000
let cache = null, at = 0, pending = null

// Map: 묶음 품번 id → { rep: 대표 id, js, repCode, code: 자기 품번 } (대표 자신은 넣지 않는다)
export async function sameMap(force = false) {
  if (!force && cache && Date.now() - at < TTL) return cache
  if (pending) return pending
  pending = (async () => {
    const m = new Map()
    try {
      // 2단계 SQL(재고 합치기 · pm_item_same_merge)을 돌리기 전에는 묶음을 쓰지 않는다
      //   — 그 전엔 재고가 품번마다 따로 있어서 대표 것을 보여 주면 틀린다
      const g = await supabase.from('pm_item_same_merge').select('id').limit(1)
      if (g.error) throw g.error
      // 1,000줄씩 끝까지 (Edwards 묶음이 더해지면 1,000줄을 넘을 수 있다)
      let data = [], error = null
      for (let from = 0; ; from += 1000) {
        const r = await supabase.from('pm_item_same').select('item_id,rep_item_id,js_code').order('item_id').range(from, from + 999)
        if (r.error) { error = r.error; break }
        data = data.concat(r.data || [])
        if (!r.data || r.data.length < 1000) break
      }
      if (!error) {
        const rows = (data || []).filter((r) => r.item_id && r.rep_item_id && r.item_id !== r.rep_item_id)
        const need = [...new Set(rows.flatMap((r) => [r.rep_item_id, r.item_id]))]
        const codeOf = new Map()
        for (let i = 0; i < need.length; i += 200) {
          const { data: its } = await supabase.from('items').select('id,std_code').in('id', need.slice(i, i + 200))
          ;(its || []).forEach((x) => codeOf.set(x.id, x.std_code))
        }
        rows.forEach((r) => m.set(r.item_id, {
          rep: r.rep_item_id, js: r.js_code || '', repCode: codeOf.get(r.rep_item_id) || '', code: codeOf.get(r.item_id) || '' }))
      }
    } catch { /* 묶음 없이 */ }
    cache = m; at = Date.now(); pending = null
    return m
  })()
  return pending
}

export const repOf = (map, id) => map?.get(id)?.rep || id
export const isMember = (map, id) => !!map?.get(id)

// 대표 품번 id (묶음이 아니면 그대로)
export async function repId(id) {
  if (!id) return id
  return repOf(await sameMap(), id)
}

// inventory 를 품번으로 읽기 — 묶음 품번은 대표 품번 줄을 item_id 만 바꿔 돌려준다
//   반환 모양은 supabase 와 같다: { data, error }
export async function invIn(cols, ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  const m = await sameMap()
  const sel = /\bitem_id\b/.test(cols) ? cols : `item_id,${cols}`
  const ask = m.size ? [...new Set(list.map((id) => repOf(m, id)))] : list
  // v4.154.0 — 150개씩 나눠 묻는다. 한 번에 1,600개(110211211 BOM 등)를 넣으면 주소가 너무 길어 실패하고,
  //   붙어도 1,000줄에서 잘려 위치 · 재고가 비어 보였다 (출고 화면 위치 안 보임 · 저장해도 안 된 것처럼 보임)
  const rows = []
  for (let i = 0; i < ask.length; i += 150) {
    const r = await supabase.from('inventory').select(sel).in('item_id', ask.slice(i, i + 150))
    if (r.error) return r
    rows.push(...(r.data || []))
  }
  const res = { data: rows, error: null }
  if (!m.size) return res
  const by = new Map()
  for (const r of res.data || []) if (!by.has(r.item_id)) by.set(r.item_id, r)
  const out = []
  for (const id of list) {
    const r = by.get(repOf(m, id))
    if (r) out.push({ ...r, item_id: id })
  }
  return { data: out, error: null }
}

// 대표 id → 묶음 품번들 [{ id, code }]
export function membersByRep(map) {
  const out = new Map()
  for (const [id, v] of map || []) { if (!out.has(v.rep)) out.set(v.rep, []); out.get(v.rep).push({ id, code: v.code }) }
  return out
}

// 테스트용
export function _resetSame() { cache = null; at = 0; pending = null }
