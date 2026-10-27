// 수주대장 (v4.87.0) — 전장 고객사 PO 접수 · 품목 맞추기 · 변경 비교 · 저장 · AXCELIS 이관
//
//   표: pm_order(PO 머리) · pm_order_line(줄 = 라인 + 분할) · pm_order_change(변경 이력) · pm_order_alias(품명 기억)
//   기존 고객 PO 표(purchase_orders)는 읽기만 한다 — AXCELIS 진행 중 PO 를 들여올 때.
import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { logActivity } from './activityLog'
import { divisionOf } from './axPoFile'

// 여러 건을 20개씩 동시에 저장 — 하나라도 실패하면 멈춘다
async function pool(arr, fn, n = 20) {
  for (let i = 0; i < arr.length; i += n) {
    const res = await Promise.all(arr.slice(i, i + n).map(fn))
    const bad = res.find((r) => r?.error)
    if (bad) throw bad.error
  }
}

export const ORDER_CUSTOMERS = {
  AX:  { name: 'AXCELIS', prefix: 'AX-', color: '#8b5cf6', badge: 'bg-violet-50 text-violet-700' },
  ED:  { name: 'Edwards', prefix: 'ED-', color: '#3b82f6', badge: 'bg-blue-50 text-blue-700' },
  CSK: { name: 'CSK',     prefix: 'CS-', color: '#f59e0b', badge: 'bg-amber-50 text-amber-700' },
  VM:  { name: 'VM',      prefix: 'VM-', color: '#10b981', badge: 'bg-emerald-50 text-emerald-700' },
}
export const AX_CUSTOMER_ID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'

// 묶음 표기 — Edwards 품명의 「_PK2」 「PK10」 = 한 개 주문에 2개 · 10개 들어감 (수량 1 이어도 실제 2개). PK1 은 표시 안 함 (v4.90.0)
export function packOf(l) {
  const txt = [l?.raw_desc, l?.desc, l?.spec, l?.items?.name, l?.item?.name].filter(Boolean).join(' ')
  const m = txt.match(/(?:^|[^A-Za-z0-9])PK ?(\d{1,3})(?!\d)/i)
  const n = m ? +m[1] : 0
  return n > 1 ? n : null
}
export const normKey = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z가-힣]/g, '')
export const lineKey = (l) => `${l.line_no}/${l.del_line || '1'}`
const ITEM_COLS = 'id,std_code,name,js_code'
const REPLY_CLEAR = { reply: null, reply_date: null, reply_memo: null, replied_name: null, replied_at: null }
export const replyText = (l) => (l?.reply ? `${l.reply}${l.reply_date ? ` · ${l.reply_date}` : ''}` : null)

// 품명 · 사양 속 코드 모양 글자 (ECK114111028-03 · 790-0010-062)
const codeTokens = (s) => String(s || '').toUpperCase().match(/[A-Z]{2,}\d{5,}(?:-\d{2})?|\d{3}-\d{4}-\d{3}/g) || []
const stripPrefix = (c) => String(c).replace(/^(AX|ED|CS|VM)-/i, '')

// 한 줄의 포털 품번 후보 — 고객사 접두를 붙인다 (+ -Rev: CSK MCK03381 Rev 00 → CS-MCK03381-00)
export function candidatesOf(cust, l) {
  const codes = [...new Set([l.pn, ...codeTokens(`${l.desc || ''} ${l.spec || ''}`)].filter(Boolean).map((c) => stripPrefix(String(c).trim().toUpperCase())))]
  const make = (p) => codes.flatMap((c) => [p + c, ...(l.rev ? [`${p}${c}-${l.rev}`] : [])])
  // CSK 완제품은 이카운트에서 하이픈 없이 「CS + 품번」으로 들어와 있다 (SCS0195S-0L1-ON084 → CSSCS0195S0L1ON084, v4.93.2)
  const squash = cust === 'CSK' ? codes.map((c) => 'CS' + c.replace(/[^0-9A-Z]/g, '')) : []
  const own = [...make(ORDER_CUSTOMERS[cust]?.prefix || ''), ...squash]
  const other = Object.entries(ORDER_CUSTOMERS).filter(([k]) => k !== cust).flatMap(([, v]) => make(v.prefix))
  return { own, other }
}
export const aliasKeyOf = (l) => normKey(l.desc || l.spec || l.pn)

// 줄들 → 포털 품목 맞추기
//   반환 줄에 item({id,std_code,name,js_code}) · how(찾은 방법) · otherCust(다른 고객사 접두로만 찾음) 를 붙인다.
//   순서: 고객사 접두 품번 → 품명 기억(pm_order_alias) → 다른 고객사 접두(⚠ 표시)
export async function matchLines(cust, lines) {
  const cand = lines.map((l) => candidatesOf(cust, l))
  const all = [...new Set(cand.flatMap((c) => [...c.own, ...c.other]))]
  const byCode = new Map()
  for (let i = 0; i < all.length; i += 150) {
    const { data, error } = await supabase.from('items').select(ITEM_COLS).in('std_code', all.slice(i, i + 150))
    if (error) throw error
    ;(data || []).forEach((x) => byCode.set(x.std_code, x))
  }
  const keys = [...new Set(lines.map(aliasKeyOf).filter(Boolean))]
  const alias = new Map()
  if (keys.length) {
    const { data, error } = await supabase.from('pm_order_alias').select(`alias_key, items(${ITEM_COLS})`).eq('customer_code', cust).in('alias_key', keys)
    if (!error) (data || []).forEach((a) => { if (a.items) alias.set(a.alias_key, a.items) })
  }
  return lines.map((l, i) => {
    const own = cand[i].own.map((c) => byCode.get(c)).find(Boolean)
    if (own) return { ...l, item: own, how: own.std_code.endsWith(`-${l.rev}`) && l.rev ? '품번+Rev' : l.pn && normKey(own.std_code).endsWith(normKey(stripPrefix(l.pn))) ? '품번' : '품명 속 코드' }
    const al = alias.get(aliasKeyOf(l))
    if (al) return { ...l, item: al, how: '기억' }
    const other = cand[i].other.map((c) => byCode.get(c)).find(Boolean)
    if (other) return { ...l, item: other, how: '다른 고객사', otherCust: true }
    return { ...l, item: null, how: null }
  })
}

// ── 기존 PO 와 비교 ──────────────────────────────────────────
const FIELDS = [
  ['qty', 'qty', (v) => (v == null ? '' : String(+v))],
  ['due_date', 'due', (v) => v || ''],
  ['unit_price', 'price', (v) => (v == null ? '' : String(+v))],
  ['rev', 'rev', (v) => v || ''],
  ['item', 'item', (v) => v || ''],
]
// oldLines: DB 줄(item_id · items.std_code 포함) / newLines: 읽은 줄(item 포함)
//   반환 { changes:[{line_key, field, before_val, after_val}], added:[newLine], removed:[oldLine], same }
// 이전 줄 ↔ 새 줄 짝짓기 — 라인/분할 번호가 같으면 그 줄.
//   번호가 안 맞는 줄은 같은 품목(품번)끼리 순서대로 다시 짝짓는다.
//   엑셀 이관 PO 는 줄 번호를 순서대로 매겼으므로 발주서 번호와 다를 수 있다 (v4.88.1).
const idOf = (x) => x.item_id || x.item?.id || null
const pnOf = (x) => normKey(x.raw_pn ?? x.pn) || null
const sameItem = (a, b) => (!!idOf(a) && idOf(a) === idOf(b)) || (!!pnOf(a) && pnOf(a) === pnOf(b))
export function pairLines(oldLines, newLines) {
  const live = oldLines.filter((o) => !o.cancelled)
  const om = new Map(oldLines.map((o) => [lineKey(o), o]))
  const pair = new Map()            // 새 줄 index → 이전 줄
  const used = new Set()
  const known = (x) => !!(idOf(x) || pnOf(x))
  // ① 번호가 같고 품목도 같은(또는 어느 한쪽 품목을 모르는) 줄
  newLines.forEach((n, i) => { const o = om.get(lineKey(n)); if (o && !used.has(o) && (!known(o) || !known(n) || sameItem(o, n))) { pair.set(i, o); used.add(o) } })   // 한 발주서에 같은 번호가 두 번이면 앞 줄만 (v4.90.6)
  // ② 번호가 달라도 같은 품목
  newLines.forEach((n, i) => {
    if (pair.has(i)) return
    const o = live.find((x) => !used.has(x) && sameItem(x, n))
    if (o) { pair.set(i, o); used.add(o) }
  })
  // ③ 남은 것 중 번호가 같은 줄 — 같은 라인에서 품번이 바뀐 경우
  newLines.forEach((n, i) => { if (pair.has(i)) return; const o = om.get(lineKey(n)); if (o && !used.has(o)) { pair.set(i, o); used.add(o) } })
  return { pair, used }
}

// oldLines: DB 줄(item_id · items.std_code 포함) / newLines: 읽은 줄(item 포함)
//   반환 { changes:[{line_key, field, before_val, after_val}], added:[newLine], removed:[oldLine], same, pair }
export function diffOrder(oldLines, newLines) {
  const { pair, used } = pairLines(oldLines, newLines)
  const changes = [], added = [], removed = []
  newLines.forEach((n, i) => {
    const o = pair.get(i)
    if (!o) { added.push(n); return }
    FIELDS.forEach(([field, nk, f]) => {
      const before = field === 'item' ? (o.items?.std_code || o.raw_pn || '') : f(o[field])
      const after = field === 'item' ? (n.item?.std_code || n.pn || '') : f(n[nk])
      if (field === 'item' && (!n.item || !o.item_id)) return     // 품목을 못 찾은 쪽은 비교하지 않는다
      if (field === 'rev' && !before) return                       // 비어 있던 Rev 를 채우는 것은 변경이 아니다 (저장은 함)
      if (field === 'unit_price' && !before) return                // 비어 있던 단가를 채우는 것도 「빈 칸 채우기」 (v4.90.1)
      if (field !== 'item' && after === '') return                 // 새 발주서에서 못 읽은 칸은 「변경 없음」 — 기존 값을 지우지 않는다 (v4.90.6)
      if (before !== after) changes.push({ line_key: lineKey(n), field, before_val: before, after_val: after })
    })
    // 취소됐던 줄이 새 발주서에 다시 있음 → 되살림 (조용히 되살아나지 않게 변경으로 보인다)
    if (o.cancelled) changes.push({ line_key: lineKey(n), field: 'revive', before_val: '취소', after_val: '다시 발주서에 있음' })
  })
  // 새 발주서에서 빠진 줄 — 납품이 끝난 줄은 취소하지 않는다 (마감된 줄을 빼고 오는 변경본 대비, v4.90.6)
  const doneLine = (o) => +o.qty > 0 && (+o.delivered_qty || 0) >= +o.qty
  oldLines.forEach((o) => { if (!used.has(o) && !o.cancelled && !doneLine(o)) removed.push(o) })
  return { changes, added, removed, same: !changes.length && !added.length && !removed.length, pair }
}

// 빈 칸 채우기 (v4.90.1) — 이미 있는 PO 에 발주서 PDF 를 다시 올리면, 비어 있던 칸만 PDF 값으로 채운다.
//   엑셀 이관 · AX PO 파일로 들어온 PO 는 납품처 · 발주일 · Rev · 품명 · 품목 연결이 비어 있다.
//   값이 이미 있는 칸은 건드리지 않는다 (사람이 고친 값 보호). 바뀐 것(수량 · 납기 등)이 없어도 저장할 수 있다.
//   pair: diffOrder 의 짝 (새 줄 index → 이전 줄)
export function fillPlan(existing, po, newLines, pair) {
  const head = {}, labels = []
  if (po.ship_to && !existing.ship_to) { head.ship_to = po.ship_to; labels.push(`납품처 ${po.ship_to}`) }
  if (po.order_date && !existing.order_date) { head.order_date = po.order_date; labels.push('발주일') }
  if (po.ccn && !existing.ccn) { head.ccn = po.ccn; labels.push(`CCN ${po.ccn}`) }
  if (po.total != null && existing.total == null) { head.total = po.total; labels.push('발주 합계') }
  const lines = [], cnt = { rev: 0, item: 0, price: 0, desc: 0, spec: 0, renum: 0, etc: 0 }
  newLines.forEach((n, i) => {
    const o = pair?.get(i)
    if (!o) return
    const p = {}
    if (lineKey(o) !== lineKey(n)) { p.line_no = String(n.line_no); p.del_line = String(n.del_line || '1'); cnt.renum++ }
    if (!o.rev && n.rev) { p.rev = n.rev; cnt.rev++ }
    if (!o.item_id && n.item?.id) { p.item_id = n.item.id; cnt.item++ }
    if (o.unit_price == null && n.price != null) { p.unit_price = n.price; cnt.price++ }
    if (!o.raw_desc && n.desc) { p.raw_desc = n.desc; cnt.desc++ }
    if (!o.spec && n.spec) { p.spec = n.spec; cnt.spec++ }
    const before = Object.keys(p).length
    if (!o.raw_pn && n.pn) p.raw_pn = n.pn
    if (!o.unit && n.unit) p.unit = n.unit
    if (Object.keys(p).length > before && !before) cnt.etc++
    if (Object.keys(p).length) lines.push({ id: o.id, key: lineKey(o), patch: p })
  })
  ;[['item', '품목 연결'], ['rev', 'Rev'], ['price', '단가'], ['desc', '품명'], ['spec', '사양'], ['renum', '줄 번호 맞춤']]
    .forEach(([k, l]) => { if (cnt[k]) labels.push(`${l} ${cnt[k]}`) })
  if (!labels.length && cnt.etc) labels.push(`품번 · 단위 ${cnt.etc}`)
  return { head, lines, labels, any: Object.keys(head).length > 0 || lines.length > 0 }
}

export async function loadOrderByNo(cust, poNo) {
  const { data, error } = await supabase.from('pm_order')
    .select(`*, pm_order_line(*, items(${ITEM_COLS}))`).eq('customer_code', cust).eq('po_no', poNo).maybeSingle()
  if (error) throw error
  return data
}

// 등록할 때 이미 납품된 줄(「이미 납품」 체크 · AXCELIS 잔량 0)은 납품 · 판매입력 완료로 넣는다 — 할 일에 안 뜬다
const lineRow = (orderId, l) => {
  const q = Number(l.qty) || 0
  const delivered = l.deliveredAll ? q : Math.min(Number(l.delivered) || 0, q)
  return {
    order_id: orderId, line_no: String(l.line_no), del_line: String(l.del_line || '1'),
    item_id: l.item?.id || null, raw_pn: l.pn || null, raw_desc: l.desc || null, spec: l.spec || null, rev: l.rev || null,
    qty: Number(l.qty) || 0, unit: l.unit || null, unit_price: l.price ?? null, due_date: l.due || null,
    division: l.division || null, delivered_qty: delivered,
    delivered_at: delivered > 0 ? (l.delivered_at || null) : null,
    sales_done_at: q > 0 && delivered >= q ? new Date().toISOString() : null,
    note: l.note || null,
    ...(l.plnd ? { plnd_no: String(l.plnd) } : {}),
  }
}

// ── 발주 예정 (v4.90.0) ───────────────────────────────────────
//   CSK 는 실제 PO 전에 「발주 예정」(SAP 계획오더)을 먼저 준다 — Plnd order number · Prod order number 로 구분.
//   수주대장에는 고객사별 「발주 예정」 머리(pm_order.planned) 아래 줄로 둔다.
//   실제 발주서가 오면 발주서 글 속의 Plnd(또는 Prod) 번호로 그 줄을 찾아 새 PO 로 옮긴다 — 회신 · 비고 · 관리번호 유지.
export const mgmtNoOf = (l) => (String(l?.note || '').match(/관리번호 ([^ ·]+)/) || [])[1] || null
export const planLabel = (p) => [mgmtNoOf(p), p.plnd_no && `Plnd ${p.plnd_no}`, p.due_date && `납기 ${String(p.due_date).slice(5).replace('-', '/')}`].filter(Boolean).join(' · ')

export async function fetchPlanned(cust) {
  const { data: heads, error } = await supabase.from('pm_order').select('id,po_no').eq('customer_code', cust).eq('planned', true)
  if (error || !heads?.length) return []        // planned 칸이 아직 없으면(SQL 전) 조용히 건너뜀
  const ls = await fetchAll(() => supabase.from('pm_order_line').select(`*, items(${ITEM_COLS})`).in('order_id', heads.map((h) => h.id)).order('id'))
  return ls.filter((l) => !l.cancelled && (+l.delivered_qty || 0) < (+l.qty || 0))
}

// 발주서 줄 ↔ 발주 예정 줄 — 줄 아래 글에 그 줄의 Plnd · Prod 번호가 있으면 짝.
//   줄이 하나뿐인 발주서는 발주서 어디에 있어도 짝 (번호 위치를 모르는 양식 대비)
//   only: 이 조건에 맞는 줄만 연결 (이미 있는 PO 를 다시 올릴 때 = 새로 생긴 줄만, v4.90.6)
export function linkPlanned(po, lines, planned, only = null) {
  if (!planned?.length) return lines
  const used = new Set()
  const byNo = new Map()
  planned.forEach((p) => [p.plnd_no, p.prod_no].filter(Boolean).forEach((n) => byNo.set(String(n), p)))
  return lines.map((l) => {
    if (l.plan) { used.add(l.plan.id); return l }
    if (only && !only(l)) return l
    const refs = [...(l.refs || []), ...(lines.length === 1 ? po.refs || [] : [])]
    const p = refs.map((n) => byNo.get(String(n))).find((x) => x && !used.has(x.id))
    if (!p) return l
    used.add(p.id)
    return { ...l, plan: p, planHow: '자동', item: l.item || p.items || null, how: l.item ? l.how : (p.items ? '발주 예정' : l.how) }
  })
}

// 발주 예정 줄 → 실제 PO 줄로 옮기기. 납기가 당겨지거나 수량이 늘면 회신을 다시 받는다
async function movePlanned(orderId, poNo, n, meName, source) {
  const p = n.plan
  const now = new Date().toISOString()
  const patch = {
    order_id: orderId, line_no: String(n.line_no), del_line: String(n.del_line || '1'),
    qty: Number(n.qty) || 0, due_date: n.due || p.due_date || null, unit_price: n.price ?? p.unit_price ?? null,
    rev: n.rev || p.rev || null, item_id: n.item?.id || p.item_id || null,
    raw_pn: n.pn || p.raw_pn || null, raw_desc: n.desc || p.raw_desc || null, spec: n.spec || p.spec || null,
    cancelled: false, updated_at: now,
  }
  const reset = p.reply && ((+patch.qty > +p.qty) || (patch.due_date && p.due_date && patch.due_date < p.due_date))
  if (reset) Object.assign(patch, REPLY_CLEAR)
  // 지금도 발주 예정 머리 아래에 있을 때만 옮긴다 — 같은 Plnd 를 가진 다른 발주서가 먼저 가져갔거나
  //   다른 사람이 먼저 옮긴 줄을 또 옮기지 않게 (v4.90.6). 못 옮기면 새 줄로 넣는다.
  const { data: moved, error } = await supabase.from('pm_order_line').update(patch).eq('id', p.id).eq('order_id', p.order_id).select('id')
  if (error) throw error
  if (!moved || !moved.length) {
    const { error: e3 } = await supabase.from('pm_order_line').insert(lineRow(orderId, { ...n, plan: null }))
    if (e3) throw e3
    await supabase.from('pm_order_change').insert({ order_id: orderId, line_key: lineKey(n), field: 'line_add', before_val: null, after_val: `${n.item?.std_code || n.pn || ''} ×${n.qty} (발주 예정 ${planLabel({ ...p, due_date: null })} 은 이미 다른 PO 로 옮겨짐)`, source, changed_name: meName || null })
    return 0
  }
  const from = planLabel({ ...p, due_date: null }) || '발주 예정'
  const logs = [
    { order_id: orderId, line_key: lineKey(n), field: 'plan_link', before_val: from, after_val: `PO ${poNo} 발주 확정`, source, changed_name: meName || null },
    { order_id: p.order_id, line_key: lineKey(p), field: 'plan_link', before_val: from, after_val: `PO ${poNo} / ${lineKey(n)} 로 옮김`, source, changed_name: meName || null },
  ]
  if (+p.qty !== +patch.qty) logs.push({ order_id: orderId, line_key: lineKey(n), field: 'qty', before_val: String(p.qty), after_val: String(patch.qty), source, changed_name: meName || null })
  if ((p.due_date || '') !== (patch.due_date || '')) logs.push({ order_id: orderId, line_key: lineKey(n), field: 'due_date', before_val: p.due_date, after_val: patch.due_date, source, changed_name: meName || null })
  if (reset) logs.push({ order_id: orderId, line_key: lineKey(n), field: 'reply_reset', before_val: replyText(p), after_val: '납기 당겨짐 · 수량 증가로 재회신 필요', source, changed_name: meName || null })
  const { error: e2 } = await supabase.from('pm_order_change').insert(logs)
  if (e2) throw e2
  return 1
}

// 새 PO 등록 · 같은 PO 다시 올림(변경 반영)
//   po: parsePO 결과(+ customer 확정) / lines: matchLines 결과(+ deliveredAll · pickedByHand)
//   existing: loadOrderByNo 결과(없으면 null)
export async function saveOrder({ po, lines, existing, fileName, migrated, meName, source = 'pdf' }) {
  const cust = po.customer
  if (!cust || !po.po_no) throw new Error('고객사 · PO번호가 없습니다')
  // 고른 품목 기억 (품번 없는 줄 · 직접 고른 줄)
  const alias = lines.filter((l) => l.pickedByHand && l.item?.id && aliasKeyOf(l)).map((l) => ({ customer_code: cust, alias_key: aliasKeyOf(l), item_id: l.item.id }))
  if (alias.length) {
    const { error } = await supabase.from('pm_order_alias').upsert(alias, { onConflict: 'customer_code,alias_key' })
    if (error) throw error
  }
  if (!existing) {
    const head = {
      customer_code: cust, po_no: po.po_no, order_date: po.order_date || null, currency: po.currency || 'KRW', ccn: po.ccn || null,
      total: po.total ?? null, source, file_name: fileName || null, migrated: !!migrated, registered_name: meName || null,
      ...(po.ship_to ? { ship_to: po.ship_to } : {}),
      ...(po.project ? { memo: [po.project, po.remark].filter(Boolean).join(' / ') } : {}),   // Edwards 발주서 프로젝트 줄 (v4.102.0)
      ...(po.extra || {}),          // 직접 등록 — 구분(kind) · 명세서번호 · 받은 경로 등 (v4.94.0)
    }
    let { data: o, error } = await supabase.from('pm_order').insert(head).select('id').single()
    // 납품처 칸을 만드는 SQL 을 아직 안 돌렸으면 납품처 없이 등록
    if (error && /ship_to/.test(error.message || '') && head.ship_to) {
      delete head.ship_to;
      ({ data: o, error } = await supabase.from('pm_order').insert(head).select('id').single())
    }
    if (error && po.extra && /kind|slip_no|req_channel|req_person|po_due/.test(error.message || '')) throw new Error('구분 · 명세서번호 칸이 아직 없습니다 — 수주대장_직접등록_반영_261023.sql 을 먼저 실행하세요')
    if (error) {
      if (error.code === '23505' || /duplicate|conflict/i.test(error.message || '')) throw new Error(`${po.po_no} 는 이미 수주대장에 있습니다 — 파일을 다시 올려 비교하세요`)
      throw error
    }
    const rows = lines.filter((l) => !l.plan).map((l) => lineRow(o.id, l))
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e2 } = await supabase.from('pm_order_line').insert(rows.slice(i, i + 500))
      if (e2) { await supabase.from('pm_order').delete().eq('id', o.id); throw e2 }   // 반쪽 등록 방지
    }
    let linked = 0
    for (const n of lines.filter((l) => l.plan)) linked += await movePlanned(o.id, po.po_no, n, meName, source)
    logActivity('create', 'pm_order', po.po_no, `${SOURCE_LABEL[source] || source} 등록 · 품목 ${lines.length}${linked ? ` · 발주 예정 ${linked}건 확정` : ''}`, null, ORDER_CUSTOMERS[cust]?.name)
    return { id: o.id, created: true, lines: lines.length, linked }
  }
  // 같은 PO — 바뀐 줄만 고치고 이력 남김
  const d = diffOrder(existing.pm_order_line || [], lines)
  const fp = fillPlan(existing, po, lines, d.pair)
  const fillBy = new Map(fp.lines.map((x) => [x.id, x.patch]))
  const now = new Date().toISOString()
  const resetLogs = []
  const upd = []                 // [{ o, n, patch }]
  for (const [i, n] of lines.entries()) {
    const o = d.pair.get(i)
    if (!o) continue
    const patch = { ...(fillBy.get(o.id) || {}) }
    // 번호가 달랐던 줄(엑셀 이관 등)은 발주서 번호로 맞춘다
    if (lineKey(o) !== lineKey(n)) { patch.line_no = String(n.line_no); patch.del_line = String(n.del_line || '1') }
    // 새 발주서에서 못 읽은 칸(비어 있음)은 기존 값을 그대로 둔다 (v4.90.6)
    if (n.qty != null && n.qty !== '' && +o.qty !== +n.qty) {
      patch.qty = Number(n.qty) || 0
      if ((+o.delivered_qty || 0) > patch.qty) patch.delivered_qty = patch.qty   // 납품 수량이 수량을 넘지 않게
    }
    if (n.due && (o.due_date || '') !== n.due) patch.due_date = n.due
    if (n.price != null && n.price !== '' && (o.unit_price == null ? '' : +o.unit_price) !== +n.price) patch.unit_price = n.price
    if (n.rev && (o.rev || '') !== n.rev) patch.rev = n.rev
    if (n.item?.id && n.item.id !== o.item_id) patch.item_id = n.item.id
    if (o.cancelled) patch.cancelled = false
    // 납기 · 수량 · Rev · 품목이 바뀐 줄 · 취소됐다 되살아난 줄은 회신을 다시 받는다 (단가만 바뀐 것은 그대로)
    if (o.reply && ('qty' in patch || 'due_date' in patch || ('item_id' in patch && o.item_id) || ('rev' in patch && o.rev) || o.cancelled)) {
      Object.assign(patch, REPLY_CLEAR)
      resetLogs.push({ line_key: lineKey(n), field: 'reply_reset', before_val: replyText(o), after_val: '변경으로 재회신 필요' })
    }
    if (Object.keys(patch).length) upd.push({ o, n, patch })
  }
  const addNew = d.added.filter((l) => !l.plan)
  const hist = [
    ...d.changes.map((c) => ({ ...c })),
    ...addNew.map((l) => ({ line_key: lineKey(l), field: 'line_add', before_val: null, after_val: `${l.item?.std_code || l.pn || l.desc || ''} ×${l.qty}` })),
    ...d.removed.map((o) => ({ line_key: lineKey(o), field: 'line_del', before_val: `${o.items?.std_code || o.raw_pn || o.raw_desc || ''} ×${o.qty}`, after_val: null })),
    ...resetLogs,
  ].map((h) => ({ ...h, order_id: existing.id, source, changed_name: meName || null }))
  if (fp.any) hist.push({ line_key: null, field: 'fill', before_val: null, after_val: fp.labels.join(' · '), order_id: existing.id, source, changed_name: meName || null })
  // 이력을 먼저 남긴다 — 중간에 끊겨도 「무엇을 바꾸려 했는지」는 남고, 같은 파일을 다시 올리면 남은 것만 다시 반영된다 (v4.90.6)
  if (hist.length) {
    const { error } = await supabase.from('pm_order_change').insert(hist)
    if (error) throw error
  }
  // 줄 번호 바꾸기 — 번호를 맞바꾸거나(1↔2) 빠진 줄 · 취소 줄이 그 번호를 쥐고 있으면 unique(PO·라인·분할)에 걸린다.
  //   ① 번호를 바꿀 줄은 임시 번호로 비켜 두고 ② 짝 없는 줄이 쓸 번호를 쥐고 있으면 옆으로 비킨 뒤 ③ 제 번호로 (v4.90.6)
  const renum = upd.filter((u) => 'line_no' in u.patch)
  const targets = new Set([...renum.map((u) => lineKey(u.n)), ...d.added.map((l) => lineKey(l))])
  const pairedIds = new Set([...d.pair.values()].map((o) => o.id))
  const blockers = (existing.pm_order_line || []).filter((o) => !pairedIds.has(o.id) && targets.has(lineKey(o)))
  await pool(renum, (u) => supabase.from('pm_order_line').update({ line_no: `~${u.o.id}` }).eq('id', u.o.id))
  await pool(blockers, (o) => supabase.from('pm_order_line').update({ line_no: `${o.line_no}~${String(o.id).slice(0, 6)}`, updated_at: now }).eq('id', o.id))
  await pool(upd, (u) => supabase.from('pm_order_line').update({ ...u.patch, updated_at: now }).eq('id', u.o.id))
  if (addNew.length) {
    const { error } = await supabase.from('pm_order_line').insert(addNew.map((l) => lineRow(existing.id, l)))
    if (error) throw error
  }
  let linked = 0
  for (const n of d.added.filter((l) => l.plan)) linked += await movePlanned(existing.id, po.po_no, n, meName, source)
  if (d.removed.length) {   // 지우지 않고 취소 표시 — 이력은 남긴다
    const { error } = await supabase.from('pm_order_line').update({ cancelled: true, updated_at: now }).in('id', d.removed.map((o) => o.id))
    if (error) throw error
  }
  const head = { updated_at: now, file_name: fileName || existing.file_name, total: po.total ?? existing.total, ...fp.head }
  // 납품처가 이미 있으면 그대로 둔다 — 구매자재가 고친 값일 수 있음 (빈 칸만 채움)
  let { error } = await supabase.from('pm_order').update(head).eq('id', existing.id)
  if (error && /ship_to/.test(error.message || '') && head.ship_to) { delete head.ship_to; ({ error } = await supabase.from('pm_order').update(head).eq('id', existing.id)) }
  if (error) throw error
  const nChanged = d.changes.length + d.added.length + d.removed.length + linked
  logActivity('update', 'pm_order', po.po_no, [nChanged ? `발주서 변경 ${nChanged}건 반영` : '', resetLogs.length ? `재회신 ${resetLogs.length}` : '', fp.any ? `빈 칸 채움: ${fp.labels.join(' · ')}` : ''].filter(Boolean).join(' · ') || '같은 발주서 다시 올림', null, ORDER_CUSTOMERS[cust]?.name)
  return { id: existing.id, created: false, changed: nChanged, resets: resetLogs.length, linked, fills: fp.labels, diff: d }
}

// ── AXCELIS PO 엑셀 반영 (PO 관리 엑셀 → 수주대장) ─────────────────
//   AXCELIS 는 납기 변경이 잦은데 발주서(PDF)가 새로 오지 않는다 — 바뀐 납기는 PO 엑셀로만 온다.
//   v4.90.5 — 「고객사 PO」 표를 거치지 않고, 수주대장에서 PO 엑셀(Current Data + Received 시트)을 바로 올려 맞춘다.
//     · 수주대장에 있는 AX PO → 같은 라인/분할의 납기 · 수량 · Rev · 단가 차이를 고치고 변경 이력을 남긴다
//                             Received 가 납품 완료면 납품 완료로, 발주 취소면 취소로. 엑셀에만 있는 줄은 추가.
//     · 수주대장에 없는 AX PO → PO 째로 들여온다 (납품 줄은 납품 · 판매입력 완료로) · 하네스 · 구매품 PO 포함
//     · 엑셀 어디에도 없는 수주대장 진행 중 줄은 바꾸지 않고 「확인 필요」로 알려만 준다
//   납기가 당겨지거나 수량이 늘면 구매자재 회신을 다시 받는다. 납기가 밀린 것은 기록만.
const keyOfPo = (r) => `${String(r.order_line || '1')}/${String(r.del_line || '1')}`
const numEq = (a, b) => (a == null || a === '' ? null : +a) === (b == null || b === '' ? null : +b)

// PO 엑셀(parseAxPoWorkbook 결과) → 비교용 줄 모양 + 포털 품목 연결 (v4.90.5)
//   예전엔 「고객사 PO」 표(purchase_orders)를 읽었다 — 이제는 수주대장에서 올린 PO 엑셀을 바로 읽는다
async function axRowsOfFile(fileRows) {
  const codes = [...new Set(fileRows.map((r) => `AX-${r.pn}`))]
  const byCode = new Map()
  for (let i = 0; i < codes.length; i += 150) {
    const { data, error } = await supabase.from('items').select(ITEM_COLS).in('std_code', codes.slice(i, i + 150))
    if (error) throw error
    ;(data || []).forEach((x) => byCode.set(x.std_code, x))
  }
  return fileRows.map((r, i) => {
    const it = byCode.get(`AX-${r.pn}`) || null
    return {
      id: `f${i}`, po_number: r.po_number, order_line: r.order_line || '1', del_line: r.del_line || '1',
      item_id: it?.id || null, items: it ? { std_code: it.std_code, name: it.name } : null, raw_pn: r.pn, raw_desc: r.desc || null,
      item_rev: r.item_rev || null, item_brev: r.item_brev || null, qty_ordered: r.qty, unit_price: r.unit_price, promise_date: r.promise_date, order_date: r.order_date || null,
      division: divisionOf(r.pn), status: r.status, ccn: r.ccn || null,
      issued_at: r.status === '완료' ? r.promise_date : null, fromRcv: r.src === 'rcv',
    }
  })
}

// fileRows: parseAxPoWorkbook(...).rows
export async function axSyncPreview(fileRows) {
  if (!fileRows?.length) throw new Error('PO 엑셀에서 읽은 줄이 없습니다')
  const rows = await axRowsOfFile(fileRows)
  const brevReady = await brevColReady()   // BREV 칸(SQL 전이면 없음) — 없으면 BREV 는 건너뛴다
  const heads = await fetchAll(() => supabase.from('pm_order').select('id,po_no').eq('customer_code', 'AX').order('id'))
  const hids = heads.map((h) => h.id)
  const lines = []
  for (let i = 0; i < hids.length; i += 200) {
    const part = await fetchAll(() => supabase.from('pm_order_line').select('*').in('order_id', hids.slice(i, i + 200)).order('id'))
    lines.push(...part)
  }
  const linesBy = new Map()
  lines.forEach((l) => { if (!linesBy.has(l.order_id)) linesBy.set(l.order_id, []); linesBy.get(l.order_id).push(l) })
  const byPo = new Map()
  rows.forEach((r) => { if (!r.po_number) return; if (!byPo.has(r.po_number)) byPo.set(r.po_number, []); byPo.get(r.po_number).push(r) })
  const headByNo = new Map(heads.map((h) => [h.po_no, h]))

  const newPos = [], upd = [], add = []; const hist = []; let resets = 0
  for (const [po_no, ls] of byPo) {
    const h = headByNo.get(po_no)
    if (!h) {
      if (ls.some((l) => l.status !== '취소')) newPos.push({ po_no, lines: ls, live: ls.some((l) => l.status === '진행중') })
      continue
    }
    const mine = new Map((linesBy.get(h.id) || []).map((l) => [`${l.line_no}/${l.del_line}`, l]))
    for (const r of ls) {
      const k = keyOfPo(r)
      const m = mine.get(k)
      if (!m) {
        if (r.status === '취소') continue
        add.push({ order_id: h.id, po_no, r })
        hist.push({ po_no, order_id: h.id, line_key: k, field: 'line_add', before_val: null, after_val: `${r.items?.std_code || ''} ×${r.qty_ordered}` })
        continue
      }
      const patch = {}
      const log = (field, before, after) => hist.push({ po_no, order_id: h.id, line_key: k, field, before_val: before == null ? null : String(before), after_val: after == null ? null : String(after) })
      let reset = false
      // 같은 번호인데 품목이 다름 → 품목 변경으로 기록하고 회신을 다시 받는다 (조용히 덮어쓰지 않게, v4.90.6)
      if (r.item_id && m.item_id && r.item_id !== m.item_id) { patch.item_id = r.item_id; log('item', m.raw_pn || m.item_id, r.items?.std_code || r.raw_pn); reset = true }
      if ((m.due_date || '') !== (r.promise_date || '')) {
        patch.due_date = r.promise_date || null; log('due_date', m.due_date, r.promise_date)
        if (r.promise_date && m.due_date && r.promise_date < m.due_date) reset = true   // 당겨짐
      }
      if (!numEq(m.qty, r.qty_ordered)) { patch.qty = Number(r.qty_ordered) || 0; log('qty', m.qty, r.qty_ordered); if (+r.qty_ordered > +m.qty) reset = true }
      if (reset && m.reply) { Object.assign(patch, REPLY_CLEAR); log('reply_reset', replyText(m), '납기 당겨짐 · 수량 증가로 재회신 필요'); resets++ }
      if ((m.rev || '') !== (r.item_rev || '') && r.item_rev) { patch.rev = r.item_rev; log('rev', m.rev, r.item_rev) }
      if (brevReady && r.item_brev && (m.brev || '') !== r.item_brev) { patch.brev = r.item_brev; log('brev', m.brev, r.item_brev) }
      if (r.unit_price != null && !numEq(m.unit_price, r.unit_price)) { patch.unit_price = r.unit_price; log('unit_price', m.unit_price, r.unit_price) }
      if (r.item_id && m.item_id !== r.item_id && !m.item_id) patch.item_id = r.item_id
      if (r.division && !m.division) patch.division = r.division
      const q = Number(patch.qty ?? m.qty) || 0
      if (r.status === '완료' && (+m.delivered_qty || 0) < q) { patch.delivered_qty = q; patch.delivered_at = (r.issued_at || '').slice(0, 10) || null; log('delivered', m.delivered_qty, q) }
      // 수량이 줄어 납품 수량이 더 커진 줄 (예: 4개 중 1개가 다른 분할로 빠짐) → 납품 수량을 수량에 맞춘다 (v4.90.6)
      if ((+m.delivered_qty || 0) > q && !('delivered_qty' in patch)) { patch.delivered_qty = q; log('delivered', m.delivered_qty, q) }
      if (r.status === '취소' && !m.cancelled) { patch.cancelled = true; log('line_del', `${r.items?.std_code || ''} ×${m.qty}`, '고객사 취소') }
      if (Object.keys(patch).length) upd.push({ id: m.id, order_id: h.id, po_no, key: k, patch })
    }
  }
  newPos.sort((a, b) => a.po_no.localeCompare(b.po_no))
  // PO 엑셀 어디에도(진행 중 · 올해 Received) 없는 수주대장 진행 중 줄 — 바꾸지 않고 알려만 준다
  const fileKeys = new Set(rows.map((r) => `${r.po_number}|${keyOfPo(r)}`))
  const noByHead = new Map(heads.map((h) => [h.id, h.po_no]))
  const missing = lines.filter((l) => !l.cancelled && (+l.delivered_qty || 0) < (+l.qty || 0) && !fileKeys.has(`${noByHead.get(l.order_id)}|${l.line_no}/${l.del_line}`))
    .map((l) => ({ po_no: noByHead.get(l.order_id), key: `${l.line_no}/${l.del_line}`, due: l.due_date }))
  const cnt = (f) => hist.filter((x) => x.field === f).length
  return {
    newPos, upd, add, hist, missing, brevReady,
    summary: {
      newPos: newPos.length, newLines: newPos.reduce((a, p) => a + p.lines.length, 0),
      newLive: newPos.filter((p) => p.live).length, newDone: newPos.filter((p) => !p.live).length,
      fromRcv: newPos.reduce((a, p) => a + p.lines.filter((l) => l.fromRcv).length, 0) + add.filter((x) => x.r.fromRcv).length,
      missing: missing.length,
      changedPos: new Set([...upd, ...add].map((u) => u.order_id)).size,
      due: cnt('due_date'), qty: cnt('qty'), rev: cnt('rev'), brev: cnt('brev'), price: cnt('unit_price'),
      delivered: cnt('delivered'), cancelled: cnt('line_del'), added: add.length, resets,
    },
  }
}

// BREV 칸이 있나 (수주대장_SREV_BREV_반영_261026.sql) — 없으면 BREV 는 넣지 않는다 (SQL 전에도 반영이 깨지지 않게)
export async function brevColReady() {
  const { error } = await supabase.from('pm_order_line').select('brev').limit(1)
  return !error
}
const importRow = (orderId, l, brevReady = false) => {
  const done = l.status === '완료'
  return {
    ...(brevReady ? { brev: l.item_brev || null } : {}),
    order_id: orderId, line_no: String(l.order_line || '1'), del_line: String(l.del_line || '1'), item_id: l.item_id || null,
    raw_pn: l.items?.std_code?.replace(/^AX-/, '') || l.raw_pn || null, raw_desc: l.items?.name || l.raw_desc || null, rev: l.item_rev || null,
    qty: Number(l.qty_ordered) || 0, unit_price: l.unit_price ?? null, due_date: l.promise_date || null, division: l.division || null,
    delivered_qty: done ? Number(l.qty_ordered) || 0 : 0, delivered_at: done ? (l.issued_at || '').slice(0, 10) || null : null,
    sales_done_at: l.fromRcv && done ? new Date().toISOString() : null, cancelled: l.status === '취소',   // Received 에서 온 납품 줄은 지난 일 → 판매입력도 끝난 것으로
  }
}

export async function axSyncRun(pv, meName) {
  const now = new Date().toISOString()
  // 1) 새 PO — 처음 들일 때 이미 완료된 줄은 지난 일이라 판매입력도 끝난 것으로 본다
  let created = 0
  for (const p of pv.newPos) {
    const f = p.lines[0]
    const { data: o, error } = await supabase.from('pm_order').insert({
      customer_code: 'AX', po_no: p.po_no, order_date: p.lines.map((l) => l.order_date).filter(Boolean).sort()[0] || null,
      currency: f.ccn === 'B' ? 'USD' : 'KRW', ccn: f.ccn || null, source: 'po_file', migrated: true, registered_name: meName || null,
    }).select('id').single()
    if (error) { if (/duplicate/i.test(error.message || '')) continue; throw error }
    const rows = [...new Map(p.lines.map((l) => [keyOfPo(l), importRow(o.id, l, pv.brevReady)])).values()]
      .map((r) => (r.delivered_qty > 0 ? { ...r, sales_done_at: now } : r))
    const { error: e2 } = await supabase.from('pm_order_line').insert(rows)
    if (e2) { await supabase.from('pm_order').delete().eq('id', o.id); throw e2 }
    created++
  }
  // 2) 기존 PO 고치기
  await pool(pv.upd, (u) => supabase.from('pm_order_line').update({ ...u.patch, updated_at: now }).eq('id', u.id))   // 20줄씩 동시에 (v4.90.6)
  if (pv.add.length) {
    const { error } = await supabase.from('pm_order_line').insert(pv.add.map((a) => importRow(a.order_id, a.r, pv.brevReady)))
    if (error) throw error
  }
  const all = pv.hist.map(({ po_no, ...x }) => ({ ...x, source: 'po_file', changed_name: meName || null }))
  for (let i = 0; i < all.length; i += 500) {
    const { error } = await supabase.from('pm_order_change').insert(all.slice(i, i + 500))
    if (error) throw error
  }
  const touched = [...new Set([...pv.upd, ...pv.add].map((u) => u.order_id))]
  if (touched.length) await supabase.from('pm_order').update({ updated_at: now }).in('id', touched)
  logActivity('upload', 'pm_order', pv.fileName || null, `AX PO 엑셀 반영 — 새 PO ${created}건 · 바뀐 품목 ${pv.upd.length + pv.add.length}${pv.summary.resets ? ` · 재회신 ${pv.summary.resets}` : ''}`, null, 'AXCELIS')
  return { created, changed: pv.upd.length + pv.add.length, logs: all.length, resets: pv.summary.resets }
}

// ── 목록 ────────────────────────────────────────────────────
// 큰 표를 1,000줄씩 「동시에」 받는다 — 예전엔 13,000줄을 14번 차례로 받아 화면 열기 · 작업 뒤마다 오래 걸렸다 (v4.90.6)
async function fetchParallel(table, cols, { order = 'id', conc = 6, page = 1000 } = {}) {
  const head = await supabase.from(table).select('id', { count: 'exact', head: true })
  if (head.error) throw head.error
  const total = head.count || 0
  const all = [], seen = new Set()
  const take = (rows) => rows.forEach((r) => { if (r?.id != null) { if (seen.has(r.id)) return; seen.add(r.id) } all.push(r) })
  const pages = Math.max(1, Math.ceil(total / page))
  for (let p = 0; p < pages; p += conc) {
    const res = await Promise.all(Array.from({ length: Math.min(conc, pages - p) }, (_, k) =>
      supabase.from(table).select(cols).order(order).range((p + k) * page, (p + k + 1) * page - 1)))
    const bad = res.find((x) => x.error)
    if (bad) throw bad.error
    res.forEach((x) => take(x.data || []))
  }
  // 세는 사이에 늘어난 줄 — 마지막 쪽이 가득 찼으면 이어서 더 받는다
  for (let from = pages * page; ; from += page) {
    const { data, error } = await supabase.from(table).select(cols).order(order).range(from, from + page - 1)
    if (error) throw error
    take(data || [])
    if (!data || data.length < page) break
  }
  return all
}
// 목록에 쓰는 칸만 (created_at · replied_at · unit 등 화면에 안 쓰는 칸은 뺌)
//   ⚠ v4.101.0 에 더한 칸(특이사항 확인 odd_ok* · BREV)이 빠져 있어, 새로고침하면 확인한 특이사항이 다시 나오고 BREV 가 「—」였다 (v4.103.0 고침)
const LINE_LIST_COLS = 'id,order_id,line_no,del_line,item_id,raw_pn,raw_desc,spec,rev,qty,unit_price,due_date,release_date,division,delivered_qty,delivered_at,sales_done_at,cancelled,reply,reply_date,reply_memo,replied_name,replied_at,note,plnd_no,prod_no,updated_at,cancel_reason,cancelled_name,cancelled_at,odd_ok,odd_ok_name,odd_ok_at,brev'
const LINE_LIST_COLS_OLD = LINE_LIST_COLS.replace(',odd_ok,odd_ok_name,odd_ok_at,brev', '')
// 지난 줄은 특이사항 · PO 단계 계산에 쓰는 칸만 (수주대장_빠르게_반영_261026.sql 의 pm_order_line_hist_v)
const HIST_COLS = 'id,order_id,line_no,del_line,item_id,raw_pn,rev,qty,unit_price,due_date,delivered_qty,cancelled,reply'
const sortLines = (ls) => ls.sort((a, b) => (+a.line_no - +b.line_no) || (+a.del_line - +b.del_line) || String(a.line_no).localeCompare(String(b.line_no)))
const fetchHeads = () => fetchAll(() => supabase.from('pm_order').select('*').order('registered_at', { ascending: false }).order('id'))
function assemble(heads, lines, extra = {}) {
  const by = new Map(heads.map((h) => [h.id, { ...h, ...extra, lines: [] }]))
  lines.forEach((l) => by.get(l.order_id)?.lines.push(l))
  by.forEach((o) => sortLines(o.lines))
  return [...by.values()]
}

// 전부 (납품 완료 · 취소 · 전체 보기 · 이번 달 접수 · 단가 없는 품목 · 이카운트 대조 · 코드 정리)
export async function fetchOrders() {
  const headsP = fetchHeads()
  let lines
  try { lines = await fetchParallel('pm_order_line', `${LINE_LIST_COLS}, items(${ITEM_COLS})`) } catch (e) {
    if (!/column|does not exist/i.test(e.message || '')) throw e
    lines = await fetchParallel('pm_order_line', `*, items(${ITEM_COLS})`)      // 칸 추가 SQL 전이면 전부
  }
  return assemble(await headsP, lines)
}

// 빠르게 (v4.103.0) — 진행 중 줄은 전체 칸 · 지난 줄은 계산에 필요한 줄 · 칸만 · 품목은 진행 중 줄 것만 따로
//   보기가 없으면(SQL 전) 오류 → 화면이 예전처럼 fetchOrders 로 받는다
export async function fetchOrdersFast() {
  // PO 머리 · 진행 중 줄 · 지난 줄을 「동시에」 받는다 (차례로 받으면 왕복이 쌓여 느림). 품목 코드 · 품명은 진행 중 줄 보기에 같이 들어 있다
  const ITEM_IN_VIEW = ',item_std_code,item_name,item_js_code'
  const liveP = fetchParallel('pm_order_line_live_v', LINE_LIST_COLS + ITEM_IN_VIEW).catch((e) => {
    if (!/odd_ok|brev/.test(e.message || '')) throw e
    return fetchParallel('pm_order_line_live_v', LINE_LIST_COLS_OLD + ITEM_IN_VIEW)
  })
  const histP = fetchAll(() => supabase.from('pm_order_line_hist_v').select(HIST_COLS).order('id'))
  const [heads, live, hist] = await Promise.all([fetchHeads(), liveP, histP])
  live.forEach((l) => {
    l.items = l.item_id && (l.item_std_code != null || l.item_name != null) ? { id: l.item_id, std_code: l.item_std_code, name: l.item_name, js_code: l.item_js_code } : null
    delete l.item_std_code; delete l.item_name; delete l.item_js_code
  })
  hist.forEach((l) => { l.items = null; l._slim = true })
  // 전부 받을 때와 같은 차례(줄 id 순)로 — 같은 줄번호가 겹친 PO 에서도 특이사항 「바로 앞 PO」 고르는 결과가 같게
  const all = [...live, ...hist].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return assemble(heads, all)
}
// PO 하나의 줄 전부 — 빠르게 받은 화면에서 PO 상세를 열 때
export async function fetchOrderLinesFull(orderId) {
  let r = await supabase.from('pm_order_line').select(`${LINE_LIST_COLS}, items(${ITEM_COLS})`).eq('order_id', orderId).order('id')
  if (r.error && /column|does not exist/i.test(r.error.message || '')) r = await supabase.from('pm_order_line').select(`*, items(${ITEM_COLS})`).eq('order_id', orderId).order('id')
  if (r.error) throw r.error
  return sortLines(r.data || [])
}
// 예상 매출 · 단가 없는 품목 — 고객사 · 달러 여부 · 납기 연도별 합계 (pm_order_money · 검색어 q 반영)
export async function fetchOrderMoney(q) {
  const { data, error } = await supabase.rpc('pm_order_money', { p_q: q || null })
  if (error) throw error
  return data || []
}

// 진행 단계 — 1단계는 접수 · 확인 · 회신 · 납품까지
export function stageOf(o) {
  const live = o.lines.filter((l) => !l.cancelled)
  const qty = live.reduce((a, l) => a + (+l.qty || 0), 0)
  const dlv = live.reduce((a, l) => a + Math.min(+l.delivered_qty || 0, +l.qty || 0), 0)
  return {
    received: true, confirmed: !!o.confirmed_at || live.some((l) => l.reply), replied: live.length > 0 && live.every((l) => l.reply || (+l.delivered_qty || 0) >= (+l.qty || 0)),
    delivered: qty > 0 && dlv >= qty, partDelivered: dlv > 0 && dlv < qty,
    cancelled: o.cancelled || (live.length === 0 && o.lines.length > 0),
    qty, dlv,
    dueMin: live.filter((l) => (+l.delivered_qty || 0) < (+l.qty || 0)).map((l) => l.due_date).filter(Boolean).sort()[0] || null,
  }
}

// 영업일 경과 (주말 제외)
export function bizDaysSince(ts, now = new Date()) {
  if (!ts) return 0
  const d = new Date(ts); let n = 0
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  while (cur < end) { cur.setDate(cur.getDate() + 1); const w = cur.getDay(); if (w !== 0 && w !== 6) n++ }
  return n
}

export const SOURCE_LABEL = { pdf: 'PDF', manual: '직접', ax_import: 'PO 파일', po_file: 'PO 파일', nas: 'NAS 자동', excel: '엑셀 이관' }
export const FIELD_LABEL = { po_no: 'PO 번호', slip_no: '명세서번호', kind: '구분', sales_done: '판매입력 마감', qty: '수량', due_date: '납기', unit_price: '단가', rev: 'Rev', item: '품목', line_add: '줄 추가', line_del: '줄 삭제', reply_reset: '회신 초기화', delivered: '납품', reply: '회신', ship_to: '납품처', plan_link: '발주 확정', release_date: '협력사 불출일', fill: '빈 칸 채움', revive: '취소 → 되살림', odd_ok: '특이사항 확인', brev: 'BREV' }

// 특이사항 — 같은 고객사 · 같은 품목의 「바로 앞 PO」와 Rev · 단가가 다른 줄 + 메모에 ⚠ 가 있는 줄 (v4.90.7)
//   lines: 펼친 줄({...줄, o: PO 머리}) · 반환 Map(줄 id → { rev?, price?, note? })
//   바로 앞 = 다른 PO 이면서 날짜(발주일 → 없으면 납기)가 더 이른 마지막 줄. 취소 · 발주 예정은 비교에서 뺀다.
//   단가는 통화(원 · 달러)가 같을 때만, ODD_PRICE_PCT(10%) 넘게 다를 때만 — AXCELIS 원화 단가는 환율 따라 몇 % 씩 늘 바뀌므로
//   (실데이터: AX 진행 중 비교 319줄 중 3% 넘게 139 · 5% 112 · 10% 24 · 20% 7)
export const ODD_PRICE_PCT = 10
const oddDate = (l) => String(l.o?.order_date || l.due_date || l.o?.registered_at || '').slice(0, 10)
const oddUsd = (o) => o?.currency === 'USD' || o?.ccn === 'B'
export function oddsOf(lines) {
  const groups = new Map()
  for (const l of lines) {
    if (l.cancelled || l.o?.cancelled || l.o?.planned) continue
    const pn = normKey(l.raw_pn)
    if (!l.item_id && !pn) continue
    const k = `${l.o?.customer_code}|${l.item_id || 'pn:' + pn}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(l)
  }
  const out = new Map()
  for (const g of groups.values()) {
    if (g.length < 2) continue
    g.sort((a, b) => oddDate(a).localeCompare(oddDate(b)))
    for (let i = 1; i < g.length; i++) {
      const l = g[i], d = oddDate(l)
      // Rev 는 바로 앞 PO 와 · 단가는 같은 통화의 바로 앞 PO 와
      let p = null, pp = null
      for (let j = i - 1; j >= 0 && !(p && pp); j--) {
        const x = g[j]
        if (x.order_id === l.order_id || oddDate(x) >= d) continue
        if (!p) p = x
        if (!pp && oddUsd(x.o) === oddUsd(l.o)) pp = x
      }
      if (!p) continue
      const r = {}
      const ra = String(l.rev || '').trim().toUpperCase(), rb = String(p.rev || '').trim().toUpperCase()
      if (ra && rb && ra !== rb) r.rev = { now: ra, prev: rb, po: p.o?.po_no }
      const a = +l.unit_price, b = +(pp?.unit_price)
      if (pp && a > 0 && b > 0 && (Math.abs(a - b) / b) * 100 > ODD_PRICE_PCT) r.price = { now: a, prev: b, pct: ((a - b) / b) * 100, po: pp.o?.po_no }
      if (r.rev || r.price) out.set(l.id, r)
    }
  }
  for (const l of lines) {
    if (l.cancelled || !/⚠/.test(l.note || '')) continue
    out.set(l.id, { ...(out.get(l.id) || {}), note: true })
  }
  // 확인한 특이사항은 뺀다 (v4.101.0) — 확인할 때의 내용(oddSig)과 지금이 같을 때만. 새 차이가 생기면 다시 나온다
  //   out.done = 확인해서 뺀 줄 (줄 id → { ...특이사항, ok: { name, at } }) — PO 상세에 「확인함」으로만 보인다
  out.done = new Map()
  for (const l of lines) {
    const x = out.get(l.id)
    if (!x || !l.odd_ok || l.odd_ok !== oddSig(x)) continue
    out.delete(l.id)
    out.done.set(l.id, { ...x, ok: { name: l.odd_ok_name || '', at: l.odd_ok_at || null } })
  }
  return out
}

// 특이사항 내용 표시 — 확인할 때 같이 저장한다. 바로 앞 PO 의 Rev · 단가가 다시 바뀌면 달라져서 또 나온다 (v4.101.0)
export const oddSig = (odd) => (!odd ? '' : [
  odd.rev && `R:${odd.rev.prev}>${odd.rev.now}`,
  odd.price && `P:${+odd.price.prev}>${+odd.price.now}`,
  odd.note && 'N',
].filter(Boolean).join('|'))
export const ODD_OK_SQL_HINT = '특이사항 확인 칸이 아직 없습니다 — Supabase SQL Editor 에서 수주대장_특이사항확인_반영_261026.sql 을 먼저 실행해 주세요'

// 특이사항 확인 / 확인 취소 — 줄마다 그때의 내용을 남기고 변경 이력에도 적는다 (v4.101.0)
//   lines: 특이사항이 붙은 줄({...줄, odd}) · on=false 면 확인 취소
export async function okOddLines(lines, meName, on = true) {
  const ls = (lines || []).filter((l) => (on ? l.odd : l.odd_ok))
  if (!ls.length) throw new Error(on ? '확인할 특이사항 줄이 없습니다' : '확인을 취소할 줄이 없습니다')
  const now = new Date().toISOString()
  const patches = new Map()
  await pool(ls, (l) => {
    const p = on ? { odd_ok: oddSig(l.odd), odd_ok_name: meName || null, odd_ok_at: now } : { odd_ok: null, odd_ok_name: null, odd_ok_at: null }
    patches.set(l.id, p)
    return supabase.from('pm_order_line').update({ ...p, updated_at: now }).eq('id', l.id)
  })
  const logs = ls.map((l) => ({ order_id: l.order_id, line_key: `${l.line_no}/${l.del_line}`, field: 'odd_ok',
    before_val: on ? null : l.odd_ok, after_val: on ? patches.get(l.id).odd_ok : null, source: 'manual', changed_name: meName || null }))
  for (let i = 0; i < logs.length; i += 500) {
    const { error } = await supabase.from('pm_order_change').insert(logs.slice(i, i + 500))
    if (error) throw error
  }
  return { n: ls.length, patches }
}

// 줄 상태 — 품번별 화면 (v4.88.0)
export function lineState(l, o) {
  const q = +l.qty || 0, d = Math.min(+l.delivered_qty || 0, q)
  const cancelled = !!l.cancelled || !!o?.cancelled
  return { cancelled, delivered: q > 0 && d >= q, partDelivered: d > 0 && d < q, live: !cancelled && !(q > 0 && d >= q), confirmed: !!o?.confirmed_at || !!l.reply, replied: !!l.reply, planned: !!o?.planned }
}

// 회신 — 고른 줄들에 한꺼번에 (줄마다 이력 · PO 는 확인 처리)
export async function replyLines(lines, { reply, date, memo }, meName) {
  if (!lines.length) throw new Error('회신할 줄을 고르세요')
  if (!['가능', '조건부', '불가'].includes(reply)) throw new Error('가능 · 조건부 · 불가 중 하나를 고르세요')
  if (reply !== '가능' && !String(memo || '').trim()) throw new Error('조건부 · 불가는 메모(사유)를 적어 주세요')
  const now = new Date().toISOString()
  const patch = { reply, reply_date: date || null, reply_memo: String(memo || '').trim() || null, replied_name: meName || null, replied_at: now, updated_at: now }
  const ids = lines.map((l) => l.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from('pm_order_line').update(patch).in('id', ids.slice(i, i + 200))
    if (error) throw error
  }
  const after = replyText(patch)
  const logs = lines.map((l) => ({ order_id: l.order_id, line_key: `${l.line_no}/${l.del_line}`, field: 'reply', before_val: replyText(l), after_val: after, source: 'manual', changed_name: meName || null }))
  for (let i = 0; i < logs.length; i += 500) {
    const { error } = await supabase.from('pm_order_change').insert(logs.slice(i, i + 500))
    if (error) throw error
  }
  const orderIds = [...new Set(lines.map((l) => l.order_id))]
  const { error } = await supabase.from('pm_order').update({ confirmed_at: now, confirmed_name: meName || null, updated_at: now }).in('id', orderIds).is('confirmed_at', null)
  if (error) throw error
  logActivity('update', 'pm_order', poNosOf(lines), `회신 「${reply}」 ${ids.length}품목${date ? ` · 준비일 ${date}` : ''}`, null, custNameOf(lines))
  // 화면은 다시 불러오지 않고 이 값으로 바로 고친다 (v4.90.6 속도)
  return { lines: ids.length, orders: orderIds.length, ids, patch, orderIds, head: { confirmed_at: now, confirmed_name: meName || null } }
}

// 활동 이력용 — 고른 줄들의 PO번호 · 고객사 (v4.90.3)
const poNosOf = (ls) => { const n = [...new Set(ls.map((l) => l.o?.po_no).filter(Boolean))]; return n.length ? `${n.slice(0, 3).join(', ')}${n.length > 3 ? ` 외 ${n.length - 3}` : ''}` : null }
const custNameOf = (ls) => { const c = [...new Set(ls.map((l) => l.o?.customer_code).filter(Boolean))]; return c.length === 1 ? ORDER_CUSTOMERS[c[0]]?.name : null }

// 협력사 불출일 — 협력사에 자재를 내줘야 하는 날 (Edwards 엑셀 「납품 요청일」). 납기(고객사 납품일)와 따로 관리 (v4.90.0)
export async function setReleaseDate(lines, date, meName) {
  if (!lines.length) throw new Error('줄을 고르세요')
  const now = new Date().toISOString()
  const ids = lines.map((l) => l.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from('pm_order_line').update({ release_date: date || null, updated_at: now }).in('id', ids.slice(i, i + 200))
    if (error) throw error
  }
  const logs = lines.filter((l) => (l.release_date || '') !== (date || ''))
    .map((l) => ({ order_id: l.order_id, line_key: `${l.line_no}/${l.del_line}`, field: 'release_date', before_val: l.release_date || null, after_val: date || null, source: 'manual', changed_name: meName || null }))
  if (logs.length) { const { error } = await supabase.from('pm_order_change').insert(logs); if (error) throw error }
  logActivity('update', 'pm_order', poNosOf(lines), `협력사 불출일 ${date || '지움'} · ${lines.length}품목`, null, custNameOf(lines))
  return { ids, patch: { release_date: date || null, updated_at: now } }
}

export async function markDelivered(lines, delivered, meName) {
  const now = new Date().toISOString()
  const patchOf = (l) => (delivered ? { delivered_qty: l.qty, delivered_at: now.slice(0, 10), updated_at: now } : { delivered_qty: 0, delivered_at: null, sales_done_at: null, updated_at: now })
  // 예전엔 한 줄씩 차례로 저장해 100줄이면 100번 기다렸다 — 납품 취소는 한 번에, 납품은 20줄씩 동시에 (v4.90.6)
  if (!delivered) {
    const ids = lines.map((l) => l.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('pm_order_line').update(patchOf({})).in('id', ids.slice(i, i + 200))
      if (error) throw error
    }
  } else {
    for (let i = 0; i < lines.length; i += 20) {
      const res = await Promise.all(lines.slice(i, i + 20).map((l) => supabase.from('pm_order_line').update(patchOf(l)).eq('id', l.id)))
      const bad = res.find((x) => x.error)
      if (bad) throw bad.error
    }
  }
  const logs = lines.map((l) => ({ order_id: l.order_id, line_key: `${l.line_no}/${l.del_line}`, field: 'delivered', before_val: String(+l.delivered_qty || 0), after_val: String(delivered ? +l.qty : 0), source: 'manual', changed_name: meName || null }))
  if (logs.length) { const { error } = await supabase.from('pm_order_change').insert(logs); if (error) throw error }
  if (lines.length) logActivity('update', 'pm_order', poNosOf(lines), `${delivered ? '납품 표시' : '납품 취소'} ${lines.length}품목`, null, custNameOf(lines))
  return { patches: new Map(lines.map((l) => [l.id, patchOf(l)])) }
}
