// 품목 단가 등록 — 여러 품목 붙여넣기 (v4.86.0)
//
//   견적서 표를 엑셀에서 복사해 붙여넣는다: 「품번 또는 제조사품번 · 단가 · 납기 · MOQ」 (납기 · MOQ 는 없어도 됨)
//   제조사품번은 띄어쓰기 · 하이픈 등 기호를 빼고 맞춘다 (QO1155237 = QO115-5237).
//   품번은 AX- 를 안 붙여도 찾는다 (5001238 → AX-5001238).
import { supabase } from './supabase'

// 기호 빼고 대문자 — DB 함수 pm_item_match 와 같은 규칙
export const normKey = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')

// 숫자 글 → 숫자 ('27,300' · '₩ 880,000' · '1.5') — 못 읽으면 null
export function numOf(s) {
  const t = String(s ?? '').replace(/[^0-9.]/g, '')
  if (!t || !/\d/.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

// 붙여넣은 글 → 줄 [{ line, raw, key, price, lead, moq }]
//   탭으로 나뉘면 칸 그대로. 탭이 없으면 「품번  단가」처럼 끝의 숫자를 단가로 본다.
export function parsePaste(text) {
  const out = []
  String(text || '').split(/\r?\n/).forEach((ln, i) => {
    if (!ln.trim()) return
    let cells = ln.split('\t').map((c) => c.trim())
    if (cells.length === 1) {
      const m = ln.trim().match(/^(.*?)\s+([\d,.]+)(?:\s+(.*))?$/)
      cells = m ? [m[1], m[2], ...(m[3] ? m[3].split(/\s{2,}/) : [])] : [ln.trim()]
    }
    const raw = cells[0] || ''
    if (!normKey(raw)) return
    out.push({ line: i + 1, raw, key: normKey(raw), price: numOf(cells[1]), lead: (cells[2] || '').trim(), moq: numOf(cells[3]) })
  })
  return out
}

// 납기 글 → 품목 LT(주) — 큰 숫자 기준. 2~3주 → 3 · 6~8주 → 8 · 10일 → 2 · 2개월 → 8 · 재고 → null
export function ltWeeksOf(s) {
  const t = String(s ?? '').replace(/\s/g, '')
  const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number)
  if (!nums.length) return null
  const n = Math.max(...nums)
  if (/개월|month/i.test(t)) return Math.ceil(n * 4)
  if (/일|day/i.test(t)) return Math.max(1, Math.ceil(n / 7))
  return Math.ceil(n)   // 주 · weeks · 숫자만
}

// 매입가 갱신을 기본으로 끌 만큼 차이가 큰가 — 3배 이상 오르거나 5분의 1 아래로 (단가 오타 · 단위 차이 의심)
export function bigJump(now, next) {
  const a = Number(now), b = Number(next)
  if (!(a > 0) || !(b > 0)) return false
  return b >= a * 3 || b <= a / 5
}

// 줄 키 → 품목 후보. DB 함수 pm_item_match 가 없으면(설정 전) 품번 · 제조사품번 그대로 같은 것만 찾는다.
//   반환: Map(key → [{ id, std_code, name, manufacturer, manufacturer_code, purchase_price, lt_weeks, unit, how }])
const COLS = 'id,std_code,name,manufacturer,manufacturer_code,purchase_price,lt_weeks,unit'
export async function matchItems(rows) {
  const keys = [...new Set((rows || []).map((r) => r.key).filter(Boolean))]
  const m = new Map(keys.map((k) => [k, []]))
  if (!keys.length) return { map: m, exact: true }
  const { data, error } = await supabase.rpc('pm_item_match', { p_keys: keys })
  if (!error) {
    ;(data || []).forEach((x) => { const a = m.get(x.match_key); if (a && !a.some((y) => y.id === x.id)) a.push(x) })
    return { map: m, exact: true }
  }
  // 함수 없음 → 붙여넣은 글자 그대로 (품번 · AX-품번 · 제조사품번)
  const raws = [...new Set((rows || []).flatMap((r) => [r.raw, /^AX-/i.test(r.raw) ? null : `AX-${r.raw}`]).filter(Boolean))]
  for (let i = 0; i < raws.length; i += 100) {
    const part = raws.slice(i, i + 100)
    const [a, b] = await Promise.all([
      supabase.from('items').select(COLS).in('std_code', part),
      supabase.from('items').select(COLS).in('manufacturer_code', part),
    ])
    if (a.error) throw a.error
    ;[...(a.data || []).map((x) => ({ ...x, how: '품번' })), ...(b.data || []).map((x) => ({ ...x, how: '제조사품번' }))].forEach((x) => {
      ;(rows || []).forEach((r) => {
        const hit = x.how === '품번' ? (x.std_code === r.raw || x.std_code === `AX-${r.raw}`) : x.manufacturer_code === r.raw
        const arr = m.get(r.key)
        if (hit && arr && !arr.some((y) => y.id === x.id)) arr.push(x)
      })
    })
  }
  return { map: m, exact: false }
}

// 견적 저장 — quotes 에 넣고, 고른 품목은 최근 매입가(· LT) 갱신
//   lines: [{ item_id, unit_price, lead_time, moq, updatePrice, ltWeeks }]
//   납기 · MOQ 칸이 아직 없으면(SQL 전) 메모에 붙여 저장한다
export async function saveQuotes(lines, { vendorId, quoteDate, validUntil, memo }) {
  const list = (lines || []).filter((l) => l.item_id && Number(l.unit_price) > 0)
  if (!list.length) throw new Error('저장할 줄이 없습니다')
  const base = (l) => ({
    item_id: l.item_id, vendor_id: vendorId || null, unit_price: Number(l.unit_price),
    quote_date: quoteDate, valid_until: validUntil || null,
  })
  const full = list.map((l) => ({ ...base(l), memo: memo || null, lead_time: l.lead_time || null, moq: Number(l.moq) > 0 ? Number(l.moq) : null }))
  let { error } = await supabase.from('quotes').insert(full)
  let fallback = false
  if (error && /lead_time|moq/.test(error.message || '')) {
    fallback = true
    const lite = list.map((l) => {
      const extra = [l.lead_time ? `납기 ${l.lead_time}` : '', Number(l.moq) > 0 ? `MOQ ${l.moq}` : ''].filter(Boolean).join(' · ')
      return { ...base(l), memo: [memo, extra].filter(Boolean).join(' · ') || null }
    })
    ;({ error } = await supabase.from('quotes').insert(lite))
  }
  if (error) throw error
  let priced = 0, lt = 0
  for (const l of list) {
    const patch = {}
    if (l.updatePrice) patch.purchase_price = Number(l.unit_price)
    if (Number(l.ltWeeks) > 0) patch.lt_weeks = Number(l.ltWeeks)
    if (!Object.keys(patch).length) continue
    const { error: e2 } = await supabase.from('items').update(patch).eq('id', l.item_id)
    if (e2) throw e2
    if (patch.purchase_price != null) priced++
    if (patch.lt_weeks != null) lt++
  }
  return { saved: list.length, priced, lt, fallback }
}
