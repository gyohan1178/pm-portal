// 수주대장 › 코드 · BOM 정리 (v4.94.0)
//
//   ① 코드 부여 — 수주대장 줄 중 포털 코드가 없는 고객사 품번을 고객사별로 모아
//        포털 코드(ED-품번 · VM-품번 · CSK 완제품 CS+하이픈 없는 품번)와 분류(→ 기준코드 JS- 다음 번호)를 제안.
//        체크해서 한 번에 등록하면 같은 품번의 수주대장 줄이 모두 그 코드로 연결된다 (함수 pm_order_register_items).
//        작업비 · 외주비 · 소모성 묶음처럼 코드가 필요 없는 것은 「비품목」으로 표시해 목록에서 뺀다.
//   ② BOM 없는 품목 — 진행 중 수주 품목 중 BOM 이 없는 것. 분류로 「BOM 필요 / 단품」을 미리 나누고
//        「BOM 요청」 → 영업(받는 사람 · 기한) → 영업 업무 흐름 「BOM 요청」 건수. BOM 이 올라오면 자동 완료.
import { supabase } from './supabase'
import { logActivity } from './activityLog'
import { ORDER_CUSTOMERS } from './orderIntake'
import { createDocRequest, autoRecv } from './docRequest'

export const CATS = [
  { code: 'HS', label: '하네스 어셈블리', category: '하네스_도면' },
  { code: 'AS', label: '어셈블리 반제품·완제품', category: '조립도_도면' },
  { code: 'SM', label: '판금물', category: '가공물_도면' },
  { code: 'CA', label: '케이블 / 전선류', category: '와이어_케이블' },
  { code: 'CN', label: '커넥터 / 단자류', category: '부품' },
  { code: 'BK', label: '차단기 / 보호소자류', category: '부품' },
  { code: 'EL', label: '그외 전장부품류', category: '부품' },
  { code: 'HW', label: '하드웨어류', category: '부품' },
  { code: 'ET', label: '기타', category: '부품' },
]
export const catOf = (code) => CATS.find((c) => c.code === code) || CATS[CATS.length - 1]

const s = (v) => (v == null ? '' : String(v).trim())
export const pnKey = (v) => s(v).toUpperCase()

// 포털 코드 제안 — 고객사 접두 + 품번. CSK 완제품(SCS · SAR …)은 이카운트처럼 「CS + 하이픈 없는 품번」
export function suggestCode(cust, pn) {
  const p = pnKey(pn)
  if (!p) return ''
  if (cust === 'CSK') return /^S(CS|AR)\d/.test(p) ? 'CS' + p.replace(/[^0-9A-Z]/g, '') : 'CS-' + p
  return (ORDER_CUSTOMERS[cust]?.prefix || '') + p
}

// 코드가 필요 없어 보이는 것 — 작업비 · 외주비 · 소모성 묶음 · 품번 칸에 「PART」 「-」
export const looksNonItem = (pn, desc) => /SUBCONT|인건비|작업비|소모성|PACKING/i.test(`${pn} ${desc}`) || /^(LOCAL|PART|-|ETC)$/i.test(s(pn))

// 분류 짐작 — 품명 · 품번 글자로. 틀리면 화면에서 고친다
export function guessCat(cust, pn, desc) {
  const t = `${s(desc)} ${s(pn)}`.toUpperCase()
  if (/GLAND|CONNECTOR|TERMINAL|CONCENT|콘센트|END ?CAP|SOCKET|PLUG|RECEPTACLE|HI ?ROSE/.test(t)) return 'CN'
  if (/FUSE|BREAKER|ELCB|MCCB|\bCB\b|\bCP 1P/.test(t)) return 'BK'
  if (/HARNESS|하네스|CABLE DETAIL/.test(t)) return 'HS'
  if (cust === 'VM' && /^79\d-/.test(s(pn))) return 'HS'
  if (/\bASSY\b|ASSEMBLY|\bBOX\b|\bRACK\b|MODULE|\bKIT\b|PANEL ASSY/.test(t) || (cust === 'VM' && /^85\d-/.test(s(pn)))) return 'AS'
  if (/CABLE|WIRE|LAN ?CABLE|케이블|전선/.test(t)) return 'CA'
  if (/SWITCH|SENSOR|RELAY|SMPS|CONTROLLER|FILTER|METER|LAMP|PLC|HMI|INVERTER|CORE|PSU|DETECTOR|MONITOR/.test(t)) return 'EL'
  if (/TIE|MOUNT|HINGE|BRACKET|BOLT|SCREW|NUT\b|SEPARATOR/.test(t)) return 'HW'
  if (/COVER|PLATE|판금/.test(t)) return 'SM'
  return 'ET'
}

// 코드 없는 고객사 품번 묶기 — orders: fetchOrders() · flags: Map(`${cust}|${pnKey}` → flag)
export function unregGroups(orders, flags = new Map()) {
  const g = new Map()
  orders.forEach((o) => o.lines.forEach((l) => {
    if (l.item_id || !s(l.raw_pn)) return
    const k = `${o.customer_code}|${pnKey(l.raw_pn)}`
    if (!g.has(k)) g.set(k, { key: k, cust: o.customer_code, pn: pnKey(l.raw_pn), desc: '', rev: '', lines: 0, live: 0, pos: new Set(), due: null })
    const x = g.get(k)
    x.lines++
    const live = !l.cancelled && !o.cancelled && (+l.delivered_qty || 0) < (+l.qty || 0)
    if (live) { x.live++; if (l.due_date && (!x.due || l.due_date < x.due)) x.due = l.due_date }
    x.pos.add(o.id)
    if (!x.desc && l.raw_desc) x.desc = s(l.raw_desc)
    if (!x.rev && l.rev) x.rev = s(l.rev)
  }))
  return [...g.values()].map((x) => {
    const flag = flags.get(x.key) || null
    return { ...x, pos: x.pos.size, flag, nonItem: !!flag, guessNon: !flag && looksNonItem(x.pn, x.desc), code: suggestCode(x.cust, x.pn), cat: guessCat(x.cust, x.pn, x.desc) }
  }).sort((a, b) => b.live - a.live || a.pn.localeCompare(b.pn))
}

export async function fetchFlags() {
  const { data, error } = await supabase.from('pm_order_pn_flag').select('*')
  if (error) return new Map()          // SQL 전이면 빈 표시
  return new Map((data || []).map((f) => [`${f.customer_code}|${f.pn_key}`, f]))
}

export async function setNonItem(groups, on, meName) {
  if (!groups.length) return
  if (on) {
    const { error } = await supabase.from('pm_order_pn_flag').upsert(groups.map((x) => ({ customer_code: x.cust, pn_key: x.pn, kind: '비품목', created_name: meName || null })), { onConflict: 'customer_code,pn_key' })
    if (error) throw sqlHint(error)
  } else {
    for (const x of groups) {
      const { error } = await supabase.from('pm_order_pn_flag').delete().eq('customer_code', x.cust).eq('pn_key', x.pn)
      if (error) throw sqlHint(error)
    }
  }
}

const sqlHint = (e) => (/pm_order_pn_flag|pm_bom_need|pm_order_register_items|pm_order_bom_items|schema cache|does not exist/.test(e?.message || '') ? new Error('표 · 함수가 아직 없습니다 — 수주대장_직접등록_반영_261023.sql 을 먼저 실행하세요') : e)

// 코드 등록 — rows: [{ cust, pn, code, name, cat }]
export async function registerItems(rows, meName) {
  const bad = rows.filter((r) => !s(r.code))
  if (bad.length) throw new Error(`포털 코드가 비어 있는 품번이 있습니다 (${bad.map((r) => r.pn).slice(0, 3).join(', ')})`)
  const p = rows.map((r) => ({ customer_code: r.cust, pn: r.pn, std_code: s(r.code).toUpperCase(), name: s(r.name) || r.pn, js_cat: r.cat, category: catOf(r.cat).category }))
  const { data, error } = await supabase.rpc('pm_order_register_items', { p_rows: p })
  if (error) throw sqlHint(error)
  logActivity('create', 'items', `${rows.length}품번`, `수주대장 코드 부여 — 새 코드 ${data?.created || 0} · 수주 줄 연결 ${data?.linked || 0}`, null, null)
  return data || { created: 0, existed: 0, linked: 0, codes: [] }
}

// ── BOM ───────────────────────────────────────────────────
// 분류로 BOM 필요 / 단품 짐작 — 사람이 고른 값(need)이 먼저
export const needOf = (r) => r.need || (/하네스_도면|조립도_도면|가공물_도면/.test(r.category || '') ? '필요' : /부품|와이어_케이블/.test(r.category || '') ? '단품' : null)
export function bomState(r) {
  if (r.has_bom) return 'has'
  if (r.req_status === '요청') return 'req'
  const n = needOf(r)
  return n === '필요' ? 'need' : n === '단품' ? 'single' : 'unknown'
}
export const BOM_STATE = { need: 'BOM 필요', unknown: '미정', single: '단품', req: '요청함', has: 'BOM 있음' }

export async function fetchBomItems(custs) {
  const out = []
  for (const c of custs) {
    const { data, error } = await supabase.rpc('pm_order_bom_items', { p_cust: c })
    if (error) throw sqlHint(error)
    ;(data || []).forEach((r) => out.push({ ...r, cust: c }))
  }
  return out
}

// BOM 이 올라온 요청은 완료로 — 목록을 받을 때 같이 (편집 권한일 때만)
export async function closeDone(rows) {
  const ids = rows.filter((r) => r.has_bom && r.req_status === '요청').map((r) => r.item_id)
  if (ids.length) autoRecv()   // 자료 요청 쪽도 「받음」으로 (v4.98.0 · 실패해도 무시)
  if (!ids.length) return 0
  const { error } = await supabase.from('pm_bom_need').update({ req_status: '완료', done_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in('item_id', ids)
  if (error) throw sqlHint(error)
  return ids.length
}

export async function setNeed(itemIds, need) {
  if (!itemIds.length) return
  const t = new Date().toISOString()
  const { error } = await supabase.from('pm_bom_need').upsert(itemIds.map((id) => ({ item_id: id, need, updated_at: t })), { onConflict: 'item_id' })
  if (error) throw sqlHint(error)
}

export async function requestBom(rows, { assignee, due, memo }, meName) {
  if (!rows.length) throw new Error('BOM 을 요청할 품목을 고르세요')
  if (!s(assignee)) throw new Error('받는 사람을 넣으세요')
  const t = new Date().toISOString()
  const { error } = await supabase.from('pm_bom_need').upsert(rows.map((r) => ({
    item_id: r.item_id, need: '필요', req_status: '요청', assignee: s(assignee), due_date: due || null, memo: s(memo) || null, req_name: meName || null, req_at: t, done_at: null, updated_at: t,
  })), { onConflict: 'item_id' })
  if (error) throw sqlHint(error)
  logActivity('create', 'pm_bom_need', `${rows.length}품목`, `BOM 요청 → ${s(assignee)}${due ? ` · 기한 ${due}` : ''}`, null, null)
  // 📎 자료 요청에도 같이 올린다 (v4.98.0) — 영업 「받은 자료 요청」에서 받을 때까지 따라간다. 표가 없으면(SQL 전) 조용히 넘어간다
  let docs = 0
  try {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: me } = user ? await supabase.from('pm_profiles').select('name,dept').eq('id', user.id).maybeSingle() : { data: null }
    const dept = ['구매자재', '생산기술', '제조', '품질'].includes(me?.dept) ? me.dept : '구매자재'
    const need = due || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    for (const r of rows) {
      await createDocRequest({
        kind: 'BOM', part_no: r.std_code || r.pn, item_id: r.item_id, item_name: r.name || null, customer_code: r.cust,
        need_date: need, reason: `BOM 없는 품목 (수주대장 정리)${s(assignee) ? ` · 받는 사람 ${s(assignee)}` : ''}${s(memo) ? ` · ${s(memo)}` : ''}`,
        ref: r.pos ? `진행 중 PO ${r.pos}건` : null, source: 'cleanup', from_dept: dept,
      }, { name: meName || me?.name })
      docs++
    }
  } catch { /* 자료 요청 표가 없거나 권한이 없으면 BOM 요청만 남긴다 */ }
  return { at: t, docs }
}

export async function cancelBomRequest(rows) {
  const { error } = await supabase.from('pm_bom_need').update({ req_status: null, updated_at: new Date().toISOString() }).in('item_id', rows.map((r) => r.item_id))
  if (error) throw sqlHint(error)
  // 이 화면에서 올린 자료 요청도 거둔다 (받기 전 것만)
  try {
    const { data } = await supabase.from('pm_doc_request').select('id').eq('kind', 'BOM').eq('source', 'cleanup').eq('cancelled', false).lt('status', 2).in('item_id', rows.map((r) => r.item_id))
    for (const d of data || []) await supabase.rpc('pm_doc_request_cancel', { p_id: d.id, p_note: '수주대장 정리에서 요청을 거둠' })
  } catch { /* 표가 없으면 넘어간다 */ }
}
