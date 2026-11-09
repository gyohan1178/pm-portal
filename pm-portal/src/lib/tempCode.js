// 견적용 임시코드 (v4.160.0)
//   견적 접수에 들어온 부품이 포털에 없을 때 — 품목을 「TMP-YYMM-0001」 임시코드로 등록해 구매자재 단가 요청으로 넘긴다
//   · 먼저 제조사품번으로 이미 있는 품목을 찾고(띄어쓰기 · 기호 무시), 없을 때만 임시코드를 새로 만든다
//   · 임시 품목은 재고관리 제외 · 메모에 「견적용 임시코드 — 접수 제목」
//   · 견적 접수 품목에는 그 품목 하나짜리 부품표(paste_parts)를 붙인다 → 단가 없음이면 구매자재 「영업 견적 단가 요청」에 기준코드로 뜨고,
//     구매자재가 적은 단가는 품목 매입가에 남아 다음 견적 때 그대로 쓴다
//   · 나중에 고객사 코드(AX- · ED- …)가 나오면 「정식 코드로」 — 이력 · 단가를 그대로 이어서 코드만 바꾸거나, 이미 있는 코드면 그쪽으로 옮긴다
import { supabase } from './supabase'
import { matchPartsPaste, normMpn } from './quotePartsPaste'
import { prefixOf } from './custPrefix'
import { logActivity } from './activityLog'

export const TMP_RE = /^TMP-/i
export const isTempCode = (c) => TMP_RE.test(String(c || ''))

// 견적 품번 「APC SMT750RM2UC」 → 제조사 · 제조사품번. 띄어쓰기 없이 붙은 「SCHURTERRC320-10」 은 알려진 제조사 이름으로 떼어 본다
const MAKERS = ['SCHURTER', 'SCHNEIDER', 'PHOENIX', 'MEANWELL', 'MEAN WELL', 'MERSEN', 'LITTELFUSE', 'BUSSMANN', 'OMRON', 'WAGO', 'WEIDMULLER',
  'EATON', 'TYCO', 'TE', 'MOLEX', 'APC', 'HPS', 'IDEC', 'ABB', 'SIEMENS', 'FUJI', 'LS', 'HARTING', 'LAPP', 'PANDUIT', 'HOFFMAN', 'RITTAL', 'FINDER', 'ALLEN BRADLEY']
export function splitMakerMpn(pn) {
  const t = String(pn || '').trim().replace(/\s+/g, ' ')
  if (!t) return { maker: '', mpn: '' }
  const up = t.toUpperCase()
  const known = MAKERS.filter((m) => up.startsWith(m + ' ') || (up.startsWith(m) && up.length > m.length + 2)).sort((a, b) => b.length - a.length)[0]
  if (known) return { maker: t.slice(0, known.length).trim(), mpn: t.slice(known.length).trim() }
  const sp = t.indexOf(' ')
  if (sp > 0) return { maker: t.slice(0, sp), mpn: t.slice(sp + 1).trim() }
  return { maker: '', mpn: t }
}

async function nextTempCodes(n) {
  const d = new Date()
  const ym = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0')
  const head = `TMP-${ym}-`
  const { data, error } = await supabase.from('items').select('std_code').like('std_code', head + '%').order('std_code', { ascending: false }).limit(1)
  if (error) throw error
  let seq = Number(String(data?.[0]?.std_code || '').slice(head.length)) || 0
  return Array.from({ length: n }, () => head + String(++seq).padStart(4, '0'))
}

// 임시코드를 붙일 견적 품목 — 아직 견적 안 냄 · 견적 불가 아님 · BOM · 품목을 못 찾음 · 부품표 아직 없음
export const tempTargets = (r) => (r.lines || []).filter((l) => !l.quoted_at && !l.noquote && l.kind === 'none' && !(l.paste_parts?.parts?.length))

// 견적 접수 한 건의 대상 품목에 임시코드 발행 → 부품표로 붙임 (점검은 부르는 쪽에서)
export async function issueTempCodes(r, meName) {
  const lines = tempTargets(r)
  if (!lines.length) return { linked: 0, created: 0, lines: 0 }
  const prefix = prefixOf(r.customer_code)
  const rows = lines.map((l) => { const { maker, mpn } = splitMakerMpn(l.pn); return { maker, mpn, name: String(l.name || '').trim(), qty: 1, code: '' } })
  let matched = await matchPartsPaste(rows, prefix)
  // 제조사로 떼어 낸 것이 틀렸을 수 있으니 — 못 찾은 줄은 품번 전체로 한 번 더
  const miss = matched.map((m, i) => (m.item ? null : i)).filter((i) => i != null)
  if (miss.length) {
    const again = await matchPartsPaste(miss.map((i) => ({ ...rows[i], mpn: String(lines[i].pn || '').trim() })), prefix)
    again.forEach((m, k) => { if (m.item) matched[miss[k]] = { ...matched[miss[k]], item: m.item, buyKrw: m.buyKrw, priceSrc: m.priceSrc } })
  }
  // 같은 접수 안 같은 제조사품번은 임시코드 하나로
  const need = []
  matched.forEach((m, i) => { if (!m.item) { const k = normMpn(rows[i].mpn) || normMpn(lines[i].pn); if (!need.some((x) => x.k === k)) need.push({ k, i }) } })
  const made = new Map()
  if (need.length) {
    const codes = await nextTempCodes(need.length)
    const payload = need.map(({ i }, j) => ({
      std_code: codes[j], name: rows[i].name || String(lines[i].pn || '').trim(), type: '자재', unit: 'EA',
      manufacturer: rows[i].maker || null, manufacturer_code: rows[i].mpn || String(lines[i].pn || '').trim(),
      stock_managed: false, lt_weeks: 0, safety_stock: 0,
      memo: `견적용 임시코드 — ${r.title || ''}${meName ? ` (${meName})` : ''}`.trim(),
    }))
    const { data, error } = await supabase.from('items').insert(payload).select('id,std_code,name,unit,manufacturer,manufacturer_code,purchase_price')
    if (error) throw new Error('임시코드 등록 실패 — ' + error.message)
    need.forEach(({ k }, j) => made.set(k, data.find((x) => x.std_code === codes[j])))
  }
  for (let i = 0; i < lines.length; i++) {
    const m = matched[i]
    const it = m.item || made.get(normMpn(rows[i].mpn) || normMpn(lines[i].pn))
    if (!it) continue
    const price = it.purchase_price != null && Number(it.purchase_price) > 0 ? Number(it.purchase_price) : null
    const pp = { labor: 0, parts: [{ maker: it.manufacturer || rows[i].maker || '', mpn: it.manufacturer_code || rows[i].mpn || '', name: it.name || rows[i].name || '',
      qty: 1, unit: it.unit || 'EA', item_id: it.id, std_code: it.std_code, price, src: price == null ? null : '실적가' }] }
    const { error } = await supabase.from('pm_rfq_line').update({ paste_parts: pp, ...(!String(lines[i].name || '').trim() && it.name ? { name: it.name } : {}) }).eq('id', lines[i].id)
    if (error) throw new Error(/paste_parts|schema cache|does not exist/i.test(error.message || '') ? '부품표 칸이 아직 없습니다 — Supabase 에서 「견적접수_부품표_반영_261104.sql」을 먼저 실행해 주세요' : error.message)
  }
  const linked = matched.filter((m) => m.item).length
  logActivity('create', 'items', r.title, `견적 임시코드 — ${r.title} · 기존 품목 ${linked} · 임시코드 ${made.size}개 (${[...made.values()].map((x) => x.std_code).slice(0, 5).join(', ')})`)
  return { linked, created: made.size, lines: lines.length, codes: [...made.values()].map((x) => x.std_code) }
}

// 임시코드 → 정식 코드 (품목 화면 「정식 코드로」)
//   · 새 코드가 없으면: 그 품목의 기준코드만 바꾼다 (단가 · 이력 · 견적 부품표가 그대로 이어짐) · 재고관리 다시 켬
//   · 이미 있는 코드면: 견적 부품표를 그 품목으로 옮기고, 그쪽에 매입가가 없으면 임시 품목 매입가를 넘긴 뒤 임시 품목을 지운다 (못 지우면 「옮김」 표시만)
export async function promoteTempCode(item, newCode, meName) {
  const code = String(newCode || '').trim().toUpperCase()
  if (!code) throw new Error('정식 코드를 적어 주세요')
  if (isTempCode(code)) throw new Error('TMP- 가 아닌 정식 코드를 적어 주세요')
  if (code === String(item.std_code).toUpperCase()) throw new Error('같은 코드입니다')
  const { data: ex, error: e0 } = await supabase.from('items').select('id,std_code,purchase_price,name').eq('std_code', code).maybeSingle()
  if (e0) throw e0
  const target = ex || null
  if (!target) {
    const { error } = await supabase.from('items').update({ std_code: code, stock_managed: true,
      memo: `${item.memo ? item.memo + ' / ' : ''}정식 코드 전환 ${item.std_code} → ${code}` }).eq('id', item.id)
    if (error) throw error
  } else if ((target.purchase_price == null || !(Number(target.purchase_price) > 0)) && Number(item.purchase_price) > 0) {
    const { error } = await supabase.from('items').update({ purchase_price: item.purchase_price }).eq('id', target.id)
    if (error) throw error
  }
  // 견적 부품표 — 옛 임시코드를 쓰는 견적 품목을 새 코드(· 있던 품목)로
  const { data: ls, error: e1 } = await supabase.from('pm_rfq_line').select('id,rfq_id,paste_parts').contains('paste_parts', { parts: [{ std_code: item.std_code }] })
  if (e1 && !/paste_parts|schema cache|does not exist/i.test(e1.message || '')) throw e1
  for (const l of ls || []) {
    const pp = { ...l.paste_parts, parts: (l.paste_parts.parts || []).map((p) => (p.std_code === item.std_code
      ? { ...p, std_code: code, item_id: target ? target.id : p.item_id } : p)) }
    const { error } = await supabase.from('pm_rfq_line').update({ paste_parts: pp }).eq('id', l.id)
    if (error) throw error
  }
  let removed = false
  if (target) {
    const { error } = await supabase.from('items').delete().eq('id', item.id)
    if (!error) removed = true
    else {
      const { error: e2 } = await supabase.from('items').update({ stock_managed: false, name: `[→${code}] ${item.name || ''}`.trim(),
        memo: `${item.memo ? item.memo + ' / ' : ''}정식 코드 ${code} 로 옮김 (지울 수 없어 남김)` }).eq('id', item.id)
      if (e2) throw e2
    }
  }
  logActivity('update', 'items', code, `임시코드 정식 전환 ${item.std_code} → ${code}${target ? ' (이미 있던 품목으로 옮김)' : ''}`)
  return { code, merged: !!target, removed, rfqIds: [...new Set((ls || []).map((l) => l.rfq_id))] }
}
