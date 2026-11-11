// 품목 견적 특이사항 (v4.176.0) — pm_item_quote_note
//   구매자재가 「영업 견적 단가 요청」에서 부품마다 적는 메모 (MOQ · 납기 · 단종 예정 …)
//   품목에 붙어 다음 견적에도 따라간다. 견적 작성에서 품목을 넣으면 그 줄 「비고」에 자동으로 들어간다.
import { supabase } from './supabase'

export const NOTE_SQL_HINT = '견적 특이사항 표가 아직 없습니다 — 「견적특이사항_반영」 SQL 을 먼저 실행하세요'
const noTable = (e) => /pm_item_quote_note/.test(e?.message || '') && /(does not exist|schema cache|Could not find)/i.test(e?.message || '')

// item_id 목록 → Map(item_id → { note, by_name, updated_at }). 표가 없으면(SQL 전) 빈 Map
export async function fetchQuoteNotes(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  const out = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_item_quote_note').select('item_id,note,by_name,updated_at').in('item_id', ids.slice(i, i + 200))
    if (error) { if (noTable(error)) return out; throw error }
    for (const r of data || []) if (String(r.note || '').trim()) out.set(r.item_id, r)
  }
  return out
}

// 적기 · 고치기 — 빈 글이면 지운다
export async function saveQuoteNote(itemId, note, byName) {
  const t = String(note || '').trim()
  const q = t
    ? supabase.from('pm_item_quote_note').upsert({ item_id: itemId, note: t, by_name: byName || null, updated_at: new Date().toISOString() }, { onConflict: 'item_id' })
    : supabase.from('pm_item_quote_note').delete().eq('item_id', itemId)
  const { error } = await q
  if (error) throw new Error(noTable(error) ? NOTE_SQL_HINT : error.message)
}

// 견적 줄 비고 글 — 단품은 메모 그대로, 어셈블리는 「품번 메모」를 ' / ' 로 잇는다
//   제외된 부품 · 단가 제외(소요량 0 · 문서 · 스펙) 부품은 뺀다 — 실제로 사지 않으니까
export function remarksFromNotes(kind, parts, notes) {
  if (!notes?.size) return ''
  if (kind === 'item') return parts?.[0]?.item_id ? (notes.get(parts[0].item_id)?.note || '').trim() : ''
  const seen = new Set()
  const out = []
  for (const p of parts || []) {
    if (!p?.item_id || p.excluded || p.skip || p.status === 'skip' || !(Number(p.qty) > 0) || seen.has(p.item_id)) continue
    const n = notes.get(p.item_id)?.note
    if (!n) continue
    seen.add(p.item_id)
    out.push(`${p.std_code || ''} ${String(n).trim()}`.trim())
  }
  return out.join(' / ')
}
