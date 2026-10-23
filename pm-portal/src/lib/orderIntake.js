// 수주대장 (v4.87.0) — 전장 고객사 PO 접수 · 품목 맞추기 · 변경 비교 · 저장 · AXCELIS 이관
//
//   표: pm_order(PO 머리) · pm_order_line(줄 = 라인 + 분할) · pm_order_change(변경 이력) · pm_order_alias(품명 기억)
//   기존 고객 PO 표(purchase_orders)는 읽기만 한다 — AXCELIS 진행 중 PO 를 들여올 때.
import { supabase } from './supabase'
import { fetchAll } from './paginate'

export const ORDER_CUSTOMERS = {
  AX:  { name: 'AXCELIS', prefix: 'AX-', color: '#8b5cf6', badge: 'bg-violet-50 text-violet-700' },
  ED:  { name: 'Edwards', prefix: 'ED-', color: '#3b82f6', badge: 'bg-blue-50 text-blue-700' },
  CSK: { name: 'CSK',     prefix: 'CS-', color: '#f59e0b', badge: 'bg-amber-50 text-amber-700' },
  VM:  { name: 'VM',      prefix: 'VM-', color: '#10b981', badge: 'bg-emerald-50 text-emerald-700' },
}
export const AX_CUSTOMER_ID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'

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
  const own = make(ORDER_CUSTOMERS[cust]?.prefix || '')
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
    if (own) return { ...l, item: own, how: own.std_code.endsWith(`-${l.rev}`) && l.rev ? '품번+Rev' : l.pn && own.std_code.endsWith(stripPrefix(l.pn).toUpperCase()) ? '품번' : '품명 속 코드' }
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
export function diffOrder(oldLines, newLines) {
  const om = new Map(oldLines.map((o) => [lineKey(o), o]))
  const nm = new Map(newLines.map((n) => [lineKey(n), n]))
  const changes = [], added = [], removed = []
  newLines.forEach((n) => {
    const o = om.get(lineKey(n))
    if (!o) { added.push(n); return }
    FIELDS.forEach(([field, nk, f]) => {
      const before = field === 'item' ? (o.items?.std_code || o.raw_pn || '') : f(o[field])
      const after = field === 'item' ? (n.item?.std_code || n.pn || '') : f(n[nk])
      if (field === 'item' && (!n.item || !o.item_id)) return     // 품목을 못 찾은 쪽은 비교하지 않는다
      if (before !== after) changes.push({ line_key: lineKey(n), field, before_val: before, after_val: after })
    })
  })
  oldLines.forEach((o) => { if (!nm.has(lineKey(o)) && !o.cancelled) removed.push(o) })
  return { changes, added, removed, same: !changes.length && !added.length && !removed.length }
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
  }
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
    }
    const { data: o, error } = await supabase.from('pm_order').insert(head).select('id').single()
    if (error) throw error
    const rows = lines.map((l) => lineRow(o.id, l))
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e2 } = await supabase.from('pm_order_line').insert(rows.slice(i, i + 500))
      if (e2) { await supabase.from('pm_order').delete().eq('id', o.id); throw e2 }   // 반쪽 등록 방지
    }
    return { id: o.id, created: true, lines: rows.length }
  }
  // 같은 PO — 바뀐 줄만 고치고 이력 남김
  const d = diffOrder(existing.pm_order_line || [], lines)
  const byKey = new Map((existing.pm_order_line || []).map((o) => [lineKey(o), o]))
  const now = new Date().toISOString()
  const resetLogs = []
  for (const n of lines) {
    const o = byKey.get(lineKey(n))
    if (!o) continue
    const patch = {}
    if (+o.qty !== +(n.qty || 0)) patch.qty = Number(n.qty) || 0
    if ((o.due_date || '') !== (n.due || '')) patch.due_date = n.due || null
    if ((o.unit_price == null ? '' : +o.unit_price) !== (n.price == null ? '' : +n.price)) patch.unit_price = n.price ?? null
    if ((o.rev || '') !== (n.rev || '')) patch.rev = n.rev || null
    if (n.item?.id && n.item.id !== o.item_id) patch.item_id = n.item.id
    if (o.cancelled) patch.cancelled = false
    // 납기 · 수량 · Rev · 품목이 바뀐 줄은 회신을 다시 받는다 (단가만 바뀐 것은 그대로)
    if (o.reply && ['qty', 'due_date', 'rev', 'item_id'].some((k) => k in patch)) {
      Object.assign(patch, REPLY_CLEAR)
      resetLogs.push({ line_key: lineKey(o), field: 'reply_reset', before_val: replyText(o), after_val: '변경으로 재회신 필요' })
    }
    if (Object.keys(patch).length) {
      const { error } = await supabase.from('pm_order_line').update({ ...patch, updated_at: now }).eq('id', o.id)
      if (error) throw error
    }
  }
  if (d.added.length) {
    const { error } = await supabase.from('pm_order_line').insert(d.added.map((l) => lineRow(existing.id, l)))
    if (error) throw error
  }
  if (d.removed.length) {   // 지우지 않고 취소 표시 — 이력은 남긴다
    const { error } = await supabase.from('pm_order_line').update({ cancelled: true, updated_at: now }).in('id', d.removed.map((o) => o.id))
    if (error) throw error
  }
  const hist = [
    ...d.changes.map((c) => ({ ...c })),
    ...d.added.map((l) => ({ line_key: lineKey(l), field: 'line_add', before_val: null, after_val: `${l.item?.std_code || l.pn || l.desc || ''} ×${l.qty}` })),
    ...d.removed.map((o) => ({ line_key: lineKey(o), field: 'line_del', before_val: `${o.items?.std_code || o.raw_pn || o.raw_desc || ''} ×${o.qty}`, after_val: null })),
    ...resetLogs,
  ].map((h) => ({ ...h, order_id: existing.id, source, changed_name: meName || null }))
  if (hist.length) {
    const { error } = await supabase.from('pm_order_change').insert(hist)
    if (error) throw error
  }
  const { error } = await supabase.from('pm_order').update({ updated_at: now, file_name: fileName || existing.file_name, total: po.total ?? existing.total }).eq('id', existing.id)
  if (error) throw error
  return { id: existing.id, created: false, changed: hist.length - resetLogs.length, resets: resetLogs.length, diff: d }
}

// ── AXCELIS PO 파일 반영 (고객 PO 표 → 수주대장) ─────────────────
//   AXCELIS 는 납기 변경이 잦은데 발주서(PDF)가 새로 오지 않는다 — 바뀐 납기는 PO 파일(시트)로만 온다.
//   그래서 「고객사 PO」 화면에서 PO 파일을 올린 뒤, 여기서 그 내용을 수주대장에 맞춘다.
//     · 수주대장에 있는 AX PO → 같은 라인/분할의 납기 · 수량 · Rev · 단가 차이를 고치고 변경 이력을 남긴다
//                             PO 파일이 「완료」면 납품 완료로, 「취소」면 취소로. PO 파일에만 있는 줄은 추가.
//     · 수주대장에 없는 AX PO → 진행 중 전장 줄이 있으면 PO 째로 들여온다 (완료 줄은 납품 · 판매입력 완료로)
//   납기가 당겨지거나 수량이 늘면 구매자재 회신을 다시 받는다. 납기가 밀린 것은 기록만.
const PO_COLS = 'id,po_number,order_line,del_line,item_id,item_rev,qty_ordered,unit_price,promise_date,order_date,division,status,ccn,issued_at, items!purchase_orders_item_id_fkey(std_code,name)'
const keyOfPo = (r) => `${String(r.order_line || '1')}/${String(r.del_line || '1')}`
const numEq = (a, b) => (a == null || a === '' ? null : +a) === (b == null || b === '' ? null : +b)

export async function axSyncPreview() {
  const rows = await fetchAll(() => supabase.from('purchase_orders').select(PO_COLS)
    .eq('order_type', 'customer_po').eq('customer_id', AX_CUSTOMER_ID).order('id'))
  const heads = await fetchAll(() => supabase.from('pm_order').select('id,po_no').eq('customer_code', 'AX').order('id'))
  const hids = heads.map((h) => h.id)
  const lines = []
  for (let i = 0; i < hids.length; i += 200) {
    const part = await fetchAll(() => supabase.from('pm_order_line').select('*').in('order_id', hids.slice(i, i + 200)).order('id'))
    lines.push(...part)
  }
  const byPo = new Map()
  rows.forEach((r) => { if (!r.po_number) return; if (!byPo.has(r.po_number)) byPo.set(r.po_number, []); byPo.get(r.po_number).push(r) })
  const headByNo = new Map(heads.map((h) => [h.po_no, h]))

  const newPos = [], upd = [], add = []; const hist = []; let resets = 0
  for (const [po_no, ls] of byPo) {
    const h = headByNo.get(po_no)
    if (!h) {
      if (ls.some((l) => l.status === '진행중' && l.division === '전장')) newPos.push({ po_no, lines: ls })
      continue
    }
    const mine = new Map(lines.filter((l) => l.order_id === h.id).map((l) => [`${l.line_no}/${l.del_line}`, l]))
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
      if ((m.due_date || '') !== (r.promise_date || '')) {
        patch.due_date = r.promise_date || null; log('due_date', m.due_date, r.promise_date)
        if (r.promise_date && m.due_date && r.promise_date < m.due_date) reset = true   // 당겨짐
      }
      if (!numEq(m.qty, r.qty_ordered)) { patch.qty = Number(r.qty_ordered) || 0; log('qty', m.qty, r.qty_ordered); if (+r.qty_ordered > +m.qty) reset = true }
      if (reset && m.reply) { Object.assign(patch, REPLY_CLEAR); log('reply_reset', replyText(m), '납기 당겨짐 · 수량 증가로 재회신 필요'); resets++ }
      if ((m.rev || '') !== (r.item_rev || '') && r.item_rev) { patch.rev = r.item_rev; log('rev', m.rev, r.item_rev) }
      if (r.unit_price != null && !numEq(m.unit_price, r.unit_price)) { patch.unit_price = r.unit_price; log('unit_price', m.unit_price, r.unit_price) }
      if (r.item_id && m.item_id !== r.item_id && !m.item_id) patch.item_id = r.item_id
      if (r.division && !m.division) patch.division = r.division
      const q = Number(patch.qty ?? m.qty) || 0
      if (r.status === '완료' && (+m.delivered_qty || 0) < q) { patch.delivered_qty = q; patch.delivered_at = (r.issued_at || '').slice(0, 10) || null; log('delivered', m.delivered_qty, q) }
      if (r.status === '취소' && !m.cancelled) { patch.cancelled = true; log('line_del', `${r.items?.std_code || ''} ×${m.qty}`, '고객사 취소') }
      if (Object.keys(patch).length) upd.push({ id: m.id, order_id: h.id, po_no, key: k, patch })
    }
  }
  newPos.sort((a, b) => a.po_no.localeCompare(b.po_no))
  const cnt = (f) => hist.filter((x) => x.field === f).length
  return {
    newPos, upd, add, hist,
    summary: {
      newPos: newPos.length, newLines: newPos.reduce((a, p) => a + p.lines.length, 0),
      changedPos: new Set([...upd, ...add].map((u) => u.order_id)).size,
      due: cnt('due_date'), qty: cnt('qty'), rev: cnt('rev'), price: cnt('unit_price'),
      delivered: cnt('delivered'), cancelled: cnt('line_del'), added: add.length, resets,
    },
  }
}

const importRow = (orderId, l) => {
  const done = l.status === '완료'
  return {
    order_id: orderId, line_no: String(l.order_line || '1'), del_line: String(l.del_line || '1'), item_id: l.item_id || null,
    raw_pn: l.items?.std_code?.replace(/^AX-/, '') || null, raw_desc: l.items?.name || null, rev: l.item_rev || null,
    qty: Number(l.qty_ordered) || 0, unit_price: l.unit_price ?? null, due_date: l.promise_date || null, division: l.division || null,
    delivered_qty: done ? Number(l.qty_ordered) || 0 : 0, delivered_at: done ? (l.issued_at || '').slice(0, 10) || null : null,
    sales_done_at: null, cancelled: l.status === '취소',
  }
}

export async function axSyncRun(pv, meName) {
  const now = new Date().toISOString()
  // 1) 새 PO — 진행 중 PO 를 처음 들일 때 이미 완료된 줄은 지난 일이라 판매입력도 끝난 것으로 본다
  let created = 0
  for (const p of pv.newPos) {
    const f = p.lines[0]
    const { data: o, error } = await supabase.from('pm_order').insert({
      customer_code: 'AX', po_no: p.po_no, order_date: p.lines.map((l) => l.order_date).filter(Boolean).sort()[0] || null,
      currency: f.ccn === 'B' ? 'USD' : 'KRW', ccn: f.ccn || null, source: 'po_file', migrated: true, registered_name: meName || null,
    }).select('id').single()
    if (error) { if (/duplicate/i.test(error.message || '')) continue; throw error }
    const rows = [...new Map(p.lines.map((l) => [keyOfPo(l), importRow(o.id, l)])).values()]
      .map((r) => (r.delivered_qty > 0 ? { ...r, sales_done_at: now } : r))
    const { error: e2 } = await supabase.from('pm_order_line').insert(rows)
    if (e2) { await supabase.from('pm_order').delete().eq('id', o.id); throw e2 }
    created++
  }
  // 2) 기존 PO 고치기
  for (const u of pv.upd) {
    const { error } = await supabase.from('pm_order_line').update({ ...u.patch, updated_at: now }).eq('id', u.id)
    if (error) throw error
  }
  if (pv.add.length) {
    const { error } = await supabase.from('pm_order_line').insert(pv.add.map((a) => importRow(a.order_id, a.r)))
    if (error) throw error
  }
  const all = pv.hist.map(({ po_no, ...x }) => ({ ...x, source: 'po_file', changed_name: meName || null }))
  for (let i = 0; i < all.length; i += 500) {
    const { error } = await supabase.from('pm_order_change').insert(all.slice(i, i + 500))
    if (error) throw error
  }
  const touched = [...new Set([...pv.upd, ...pv.add].map((u) => u.order_id))]
  if (touched.length) await supabase.from('pm_order').update({ updated_at: now }).in('id', touched)
  return { created, changed: pv.upd.length + pv.add.length, logs: all.length, resets: pv.summary.resets }
}

// ── 목록 ────────────────────────────────────────────────────
export async function fetchOrders() {
  const heads = await fetchAll(() => supabase.from('pm_order').select('*').order('registered_at', { ascending: false }).order('id'))
  const lines = await fetchAll(() => supabase.from('pm_order_line').select(`*, items(${ITEM_COLS})`).order('id'))
  const by = new Map(heads.map((h) => [h.id, { ...h, lines: [] }]))
  lines.forEach((l) => by.get(l.order_id)?.lines.push(l))
  by.forEach((o) => o.lines.sort((a, b) => (+a.line_no - +b.line_no) || (+a.del_line - +b.del_line) || String(a.line_no).localeCompare(String(b.line_no))))
  return [...by.values()]
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

export const SOURCE_LABEL = { pdf: 'PDF', manual: '직접', ax_import: 'PO 파일', po_file: 'PO 파일', nas: 'NAS 자동' }
export const FIELD_LABEL = { qty: '수량', due_date: '납기', unit_price: '단가', rev: 'Rev', item: '품목', line_add: '줄 추가', line_del: '줄 삭제', reply_reset: '회신 초기화', delivered: '납품', reply: '회신' }

// 줄 상태 — 품번별 화면 (v4.88.0)
export function lineState(l, o) {
  const q = +l.qty || 0, d = Math.min(+l.delivered_qty || 0, q)
  const cancelled = !!l.cancelled || !!o?.cancelled
  return { cancelled, delivered: q > 0 && d >= q, partDelivered: d > 0 && d < q, live: !cancelled && !(q > 0 && d >= q), confirmed: !!o?.confirmed_at || !!l.reply, replied: !!l.reply }
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
  return { lines: ids.length, orders: orderIds.length }
}

export async function markDelivered(lines, delivered, meName) {
  const now = new Date().toISOString()
  for (const l of lines) {
    const patch = delivered ? { delivered_qty: l.qty, delivered_at: now.slice(0, 10), updated_at: now } : { delivered_qty: 0, delivered_at: null, sales_done_at: null, updated_at: now }
    const { error } = await supabase.from('pm_order_line').update(patch).eq('id', l.id)
    if (error) throw error
  }
  const logs = lines.map((l) => ({ order_id: l.order_id, line_key: `${l.line_no}/${l.del_line}`, field: 'delivered', before_val: String(+l.delivered_qty || 0), after_val: String(delivered ? +l.qty : 0), source: 'manual', changed_name: meName || null }))
  if (logs.length) { const { error } = await supabase.from('pm_order_change').insert(logs); if (error) throw error }
}
