// 수주대장 → 초도품 진행관리 (v4.203.0)
//   영업이 수주대장 줄을 골라 「FA 대상」(Edwards 는 「PPAP 대상」)으로 지정하면 초도품 진행관리에 건이 생긴다.
//   품질은 진행관리 「새 접수」로 바로 안다. 지정한 줄은 pm_fa.order_line_id 로 이어져 생산관리 호기도 그 줄로 찾는다.
//   SQL: 초도품_수주지정_반영_261116.sql (order_line_id · kind)
import { supabase } from './supabase'
import { must } from './db'
import { faTypeOf } from './faTemplate'
import { todayISO } from './utils'

export const FA_SQL = '초도품_수주지정_반영_261116.sql'
export const faKindOfOrder = (o) => (String(o?.customer_code || '').toUpperCase() === 'ED' ? 'PPAP' : 'FA')
const noCol = (e) => /order_line_id|kind|schema cache|does not exist/i.test(e?.message || '')

// 줄 id → { id, kind } (지정된 줄만) · SQL 전이면 빈 Map
export async function fetchFaLineMap() {
  const { data, error } = await supabase.from('pm_fa').select('id,kind,order_line_id').not('order_line_id', 'is', null)
  if (error) { if (noCol(error)) return new Map(); throw error }
  return new Map((data || []).map((r) => [r.order_line_id, { id: r.id, kind: r.kind || 'FA' }]))
}

// lines: 펼친 수주 줄({ ...줄, o, items }) · 이미 지정된 줄은 건너뜀 · 같은 FA PO + 품번 건이 있으면 그 건에 줄만 연결
export async function designateFa(lines, meName) {
  const ls = (lines || []).filter((l) => !l.st?.cancelled)
  if (!ls.length) throw new Error('지정할 줄을 고르세요')
  const codes = [...new Set(ls.map((l) => l.o?.customer_code).filter(Boolean))]
  const cs = must(await supabase.from('customers').select('id,code').in('code', [...codes, ...codes.map((c) => c.toLowerCase())]), '고객사') || []
  const csOf = new Map(cs.map((c) => [String(c.code).toUpperCase(), c.id]))
  const pos = [...new Set(ls.map((l) => l.o?.po_no).filter(Boolean))]
  const { data: ex, error: e0 } = await supabase.from('pm_fa').select('id,item_code,po_number,order_line_id,kind').in('po_number', pos)
  if (e0) throw e0
  const exOf = new Map((ex || []).map((f) => [`${f.po_number}|${f.item_code}`, f]))
  const today = todayISO()
  const news = [], links = [], skip = []
  for (const l of ls) {
    const code = String(l.items?.std_code || l.raw_pn || '').trim().replace(/^AX-/i, '')
    if (!code) { skip.push(`${l.o?.po_no} ${l.line_no} — 품번 없음`); continue }
    const kind = faKindOfOrder(l.o)
    const old = exOf.get(`${l.o.po_no}|${code}`)
    if (old) { if (!old.order_line_id) links.push({ id: old.id, order_line_id: l.id }); else skip.push(`${code} — 이미 지정됨`); continue }
    const row = {
      customer_id: csOf.get(String(l.o.customer_code).toUpperCase()) || null,
      kind, order_line_id: l.id,
      item_code: code, po_number: l.o.po_no,
      item_desc: l.items?.name || l.raw_desc || null,
      srev: l.rev || null, brev: l.brev || l.rev || null,
      promise_date: l.due_date || null,
      fa_type: kind === 'PPAP' ? 'ASSY' : faTypeOf(null, code),
      steps: { g_po: { d: today } },
      created_name: meName || null,
    }
    news.push(row); exOf.set(`${row.po_number}|${code}`, row)
  }
  try {
    if (news.length) must(await supabase.from('pm_fa').insert(news), '초도품 등록')
    for (const k of links) must(await supabase.from('pm_fa').update({ order_line_id: k.order_line_id }).eq('id', k.id), '수주 줄 연결')
  } catch (e) {
    if (noCol(e)) throw new Error(`초도품 지정 칸이 아직 없습니다 — ${FA_SQL} 을 먼저 실행하세요`)
    throw e
  }
  // 품질이 보는 진행 기록에 남긴다 (누가 · 어느 PO)
  if (news.length || links.length) {
    const got = must(await supabase.from('pm_fa').select('id,item_code,po_number,kind').in('po_number', pos), '등록 확인') || []
    const mine = got.filter((f) => news.some((n) => n.po_number === f.po_number && n.item_code === f.item_code) || links.some((k) => k.id === f.id))
    if (mine.length) {
      await supabase.from('pm_fa_log').insert(mine.map((f) => ({
        fa_id: f.id, kind: '기록', body: `수주대장에서 ${f.kind === 'PPAP' ? 'PPAP' : 'FA'} 대상 지정 — PO ${f.po_number}`, created_name: meName || null,
      })))
    }
  }
  return { added: news.length, linked: links.length, skip }
}
