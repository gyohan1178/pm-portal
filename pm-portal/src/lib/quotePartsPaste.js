// 매출견적 — 코드 부여 전 ASSY 를 부품표 붙여넣기로 견적 (v4.148.0)
//   고객사 BOM · 부품표(제조사 · 제조사품번 · 품명 · 수량 [· 단가] [· 기준코드])를 붙이면
//   제조사품번(또는 기준코드)으로 포털 품목을 찾아 실적가(items.purchase_price)를 채우고, 견적에 ASSY 한 줄로 넣는다.
//   · 붙인 단가가 있으면 그 값 (업체 견적가 등) · 없으면 포털 실적가 · 둘 다 없으면 「단가 없음」 → 견적 화면 부품표에서 적는다
//   · BOM · 품목을 등록하지 않는다 — 이 견적 안에서만 쓴다 (임시저장 · 보관함에는 같이 남음)
import { supabase } from './supabase'
import { pgQuote } from './pgFilter'

const s = (v) => String(v ?? '').trim()
export const normMpn = (v) => s(v).toUpperCase().replace(/[\s\-_./()]/g, '')
const num = (v) => { const t = s(v).replace(/[,₩$\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null }

const COLS = {
  maker: ['제조사', 'maker', 'manufacturer', 'mfr', 'mfg', 'vendor', '메이커'],
  mpn: ['제조사품번', '제조사 품번', 'maker p/n', 'maker pn', 'mpn', 'mfr p/n', 'mfr pn', 'manufacturer part number', 'part number', 'p/n', 'pn', '모델', 'model', '규격'],
  name: ['품명', 'description', 'desc', 'name', 'item name', '부품명', '품목명'],
  qty: ['수량', 'qty', "q'ty", 'quantity', 'ea', '소요량', '대당'],
  price: ['단가', 'price', 'unit price', '매입가', '실적가', 'cost'],
  unit: ['단위', 'unit', 'uom'],
  code: ['기준코드', '품번', 'std code', 'item', 'item no', 'code'],
}
// 머리글 없이 붙였을 때 — 제조사 · 제조사품번 · 품명 · 수량 · 단가
const DEFAULT_IDX = { maker: 0, mpn: 1, name: 2, qty: 3, price: 4 }

export function parsePartsPaste(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], header: false }
  const split = (l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}|,(?=\S)/))
  const head = split(lines[0]).map((h) => s(h).toLowerCase())
  let idx = DEFAULT_IDX, header = false
  if (head.some((h) => [...COLS.mpn, ...COLS.name, ...COLS.qty].includes(h))) {
    idx = {}
    for (const [k, names] of Object.entries(COLS)) {
      const i = head.findIndex((h) => names.includes(h))
      if (i >= 0 && !Object.values(idx).includes(i)) idx[k] = i
    }
    header = true
    lines.shift()
  }
  const rows = []
  for (const l of lines) {
    const c = split(l)
    const g = (k) => (idx[k] == null ? '' : s(c[idx[k]]))
    const r = { maker: g('maker'), mpn: g('mpn'), name: g('name'), qty: num(g('qty')), price: num(g('price')), unit: g('unit'), code: g('code') }
    if (!r.mpn && !r.name && !r.code) continue
    if (r.qty == null) r.qty = 1
    rows.push(r)
  }
  return { rows, header }
}

// 포털 품목 찾기 — 기준코드가 있으면 그것, 없으면 제조사품번(띄어쓰기 · 기호 무시). 같은 제조사품번이 여럿이면 실적가 있는 것 · 고객사 접두가 맞는 것 먼저
export async function matchPartsPaste(rows, prefix = '') {
  const codes = [...new Set(rows.map((r) => r.code).filter(Boolean).flatMap((c) => [c, prefix && !/^[A-Z]{2}-/i.test(c) ? prefix + c : null].filter(Boolean)))]
  const mpns = [...new Set(rows.map((r) => r.mpn).filter(Boolean))]
  const SEL = 'id,std_code,name,unit,manufacturer,manufacturer_code,purchase_price,lt_weeks,moq,vendors(name)'
  const byCode = new Map(), byMpn = new Map()
  for (let i = 0; i < codes.length; i += 150) {
    const { data, error } = await supabase.from('items').select(SEL).in('std_code', codes.slice(i, i + 150))
    if (error) throw error
    ;(data || []).forEach((x) => byCode.set(x.std_code.toUpperCase(), x))
  }
  // 제조사품번 — 띄어쓰기 · 하이픈 · 점 자리를 아무 글자로 보고(ilike 'BKN%3P%20A') 찾은 뒤, 기호를 떼고 정확히 같은 것만 쓴다
  //   (「bkn 3p 20a」 ↔ 「BKN-3P-20A」)
  const pat = (m) => s(m).replace(/[%_\\]/g, '').replace(/[\s\-./()]+/g, '%')
  const pats = [...new Set(mpns.map(pat).filter((x) => x.replace(/%/g, '').length >= 3))]
  for (let i = 0; i < pats.length; i += 40) {
    const or = pats.slice(i, i + 40).map((x) => `manufacturer_code.ilike.${pgQuote(x)}`).join(',')
    const { data, error } = await supabase.from('items').select(SEL).or(or).limit(2000)
    if (error) throw error
    ;(data || []).forEach((x) => { const k = normMpn(x.manufacturer_code); byMpn.set(k, [...(byMpn.get(k) || []).filter((y) => y.id !== x.id), x]) })
  }
  const pick = (list) => (list || []).slice().sort((a, b) =>
    (b.purchase_price != null) - (a.purchase_price != null) || (prefix ? (b.std_code.startsWith(prefix)) - (a.std_code.startsWith(prefix)) : 0))[0] || null
  return rows.map((r) => {
    const c = r.code ? (byCode.get(r.code.toUpperCase()) || (prefix ? byCode.get((prefix + r.code).toUpperCase()) : null)) : null
    const it = c || (r.mpn ? pick(byMpn.get(normMpn(r.mpn))) : null)
    const price = r.price != null ? r.price : it?.purchase_price != null ? Number(it.purchase_price) : null
    return { ...r, item: it, how: c ? 'code' : it ? 'mpn' : null, buyKrw: price, priceSrc: r.price != null ? '붙인 단가' : it?.purchase_price != null ? '실적가' : null }
  })
}

// 저장해 둔 부품표(pasteToMatched)는 품목의 id · 코드 · 이름만 갖고 있다 → 지금 품목 마스터의 L/T · MOQ · 구매처를 붙인다 (v4.186.1)
//   예전엔 견적 접수에서 넘어온 부품표 줄의 L/T 가 늘 「-」 라, 견적서 납기에 부품 L/T 가 반영되지 않았다
export async function hydratePasteItems(matched) {
  const ids = [...new Set((matched || []).filter((m) => m.item?.id && m.item.lt_weeks === undefined).map((m) => m.item.id))]
  if (!ids.length) return matched
  const by = new Map()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('items').select('id,lt_weeks,moq,vendors(name)').in('id', ids.slice(i, i + 150))
    if (error) throw error
    ;(data || []).forEach((x) => by.set(x.id, x))
  }
  return matched.map((m) => (m.item?.id && by.has(m.item.id) ? { ...m, item: { ...m.item, lt_weeks: by.get(m.item.id).lt_weeks ?? null, moq: by.get(m.item.id).moq ?? null, vendors: by.get(m.item.id).vendors || null } } : m))
}

// 견적 화면 부품 줄 모양 (QuoteSheet parts) — 레벨 1 · 등록 여부와 상관없이 단가가 있으면 원가에 들어감
export function partsFromPaste(matched) {
  return matched.map((m, i) => ({
    uid: 'pp' + i, level: 1, item_id: m.item?.id || null,
    std_code: m.item?.std_code || '', name: m.name || m.item?.name || '',
    manufacturer: m.maker || m.item?.manufacturer || '', manufacturer_code: m.mpn || m.item?.manufacturer_code || '',
    buyKrw: m.buyKrw, qty: Number(m.qty) || 0, unit: m.unit || m.item?.unit || 'EA', origin: 'dom',
    vendor: m.item?.vendors?.name || '', status: m.buyKrw != null ? 'ok' : 'noprice', skip: null, excluded: false,
    lt: m.item?.lt_weeks ?? null, moq: m.item?.moq ?? null, isParentNode: false,
    pasted: true, priceSrc: m.priceSrc,
  }))
}

// ── 부품표 단가 요청 (v4.149.0) ───────────────────────────────────────────────
//   부품표를 견적 접수 품목(pm_rfq_line.paste_parts)에 같이 저장 → 구매자재 「영업 견적 단가 요청」에 뜬다
//   paste_parts = { labor, parts: [{ maker, mpn, name, qty, unit, item_id, std_code, price, src, by, at }] }
//     src: '붙인 단가' · '실적가'(포털 품목 매입가) · '견적 입력'(견적 화면에서 적음) · '구매 입력'(구매자재가 요청 목록에서 적음)
//   단가 없는 부품의 요청 키 — 포털 품목이면 기준코드(구매자재가 지금처럼 품목 매입가로 넣음), 아니면 「MPN:제조사품번」
export const PASTE_KEY = /^(MPN|NAME):/
export const isPasteKey = (k) => PASTE_KEY.test(String(k || ''))
export const keyLabel = (k) => String(k ?? '').replace(PASTE_KEY, '')
export const pasteKey = (p) => (p.std_code ? p.std_code : s(p.mpn) ? 'MPN:' + s(p.mpn).toUpperCase() : 'NAME:' + s(p.name).toUpperCase())
const pos = (v) => (v == null || v === '' ? null : Number(v) > 0 ? Number(v) : null)

// 견적 화면 부품 줄(partsFromPaste 모양 · 단가를 고친 것 포함) → 저장 모양
export function toPasteParts(parts, labor = 0) {
  return {
    labor: Number(labor) || 0,
    parts: (parts || []).filter((p) => !p.excluded).map((p) => {
      const price = pos(p.buyKrw)
      return {
        maker: p.manufacturer || '', mpn: p.manufacturer_code || '', name: p.name || '', qty: Number(p.qty) || 0, unit: p.unit || 'EA',
        item_id: p.item_id || null, std_code: p.std_code || '', price,
        src: price == null ? null : p.priceSrc || '견적 입력',
      }
    }),
  }
}
// 붙여넣기 결과(matchPartsPaste) → 저장 모양
export function pasteFromMatched(matched, labor = 0) {
  return {
    labor: Number(labor) || 0,
    parts: (matched || []).map((m) => ({
      maker: m.maker || m.item?.manufacturer || '', mpn: m.mpn || m.item?.manufacturer_code || '', name: m.name || m.item?.name || '',
      qty: Number(m.qty) || 0, unit: m.unit || m.item?.unit || 'EA', item_id: m.item?.id || null, std_code: m.item?.std_code || '',
      price: pos(m.buyKrw), src: pos(m.buyKrw) == null ? null : m.priceSrc,
    })),
  }
}
// 저장 모양 → 견적 화면에 넣을 붙여넣기 결과 (partsFromPaste 로 넘김)
export function pasteToMatched(pp) {
  return (pp?.parts || []).map((p) => ({
    maker: p.maker, mpn: p.mpn, name: p.name, qty: p.qty, unit: p.unit, price: p.price,
    item: p.item_id ? { id: p.item_id, std_code: p.std_code, name: p.name, unit: p.unit } : null,
    buyKrw: pos(p.price), priceSrc: pos(p.price) == null ? null : p.src,
  }))
}
// 다시 붙일 때 쓸 글 (부품표 고치기)
export function pasteToText(pp) {
  const rows = (pp?.parts || []).map((p) => [p.maker, p.mpn, p.name, p.qty, p.price ?? '', p.std_code].map((v) => String(v ?? '').replace(/\t|\r?\n/g, ' ')).join('\t'))
  return ['제조사\t제조사품번\t품명\t수량\t단가\t기준코드', ...rows].join('\n')
}
export const pasteMissing = (pp) => [...new Set((pp?.parts || []).filter((p) => pos(p.price) == null && Number(p.qty) > 0).map(pasteKey))]

// 점검 — 포털 품목 단가를 지금 값으로 · 단가 없는 미등록 부품은 그 사이 등록됐는지 다시 찾는다
//   붙인 단가 · 견적 입력 · 구매 입력은 그대로 둔다 (사람이 정한 값)
export async function refreshPasteParts(pp, prefix = '') {
  const parts = (pp?.parts || []).map((p) => ({ ...p }))
  const auto = (p) => !p.src || p.src === '실적가'
  const ids = [...new Set(parts.filter((p) => p.item_id && auto(p)).map((p) => p.item_id))]
  const price = new Map()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('items').select('id,purchase_price').in('id', ids.slice(i, i + 150))
    if (error) throw error
    ;(data || []).forEach((x) => price.set(x.id, pos(x.purchase_price)))
  }
  parts.forEach((p) => { if (p.item_id && auto(p)) { const v = price.get(p.item_id) ?? null; p.price = v; p.src = v == null ? null : '실적가' } })
  const lost = parts.filter((p) => !p.item_id && pos(p.price) == null && (s(p.mpn) || s(p.std_code)))
  if (lost.length) {
    const m = await matchPartsPaste(lost.map((p) => ({ maker: p.maker, mpn: p.mpn, name: p.name, qty: p.qty, price: null, unit: p.unit, code: '' })), prefix)
    m.forEach((r, i) => { if (r.item) Object.assign(lost[i], { item_id: r.item.id, std_code: r.item.std_code, price: r.buyKrw, src: r.priceSrc }) })
  }
  return { ...(pp || {}), parts }
}
// 구매자재가 요청 목록에서 적은 단가 — 같은 키의 부품 전부
export function setPastePrice(pp, key, price, by) {
  const v = pos(price)
  return { ...(pp || {}), parts: (pp?.parts || []).map((p) => (pasteKey(p) === key ? { ...p, price: v, src: v == null ? null : '구매 입력', by: by || null, at: new Date().toISOString() } : p)) }
}
