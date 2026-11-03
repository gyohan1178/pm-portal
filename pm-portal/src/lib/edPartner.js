// Edwards 협력사 발주 → Edwards 생산관리 (v4.134.0)
//
//   남일 · 두웰처럼 Edwards 물건을 진선에 발주하는 협력사는 수주대장에 「기타」 고객사 + 업체 이름으로 들어간다.
//   AXCELIS 의 3rd party(동신 · 동원파츠)처럼 Edwards 생산관리에도 보이게 한다.
//     · 어느 업체가 Edwards 협력사인가 = 「BOM 기준 고객사」가 Edwards 인 기타 업체 (lib/etcCustomerRef — 남일 · 두웰 기본)
//     · 발주 한 줄 = 생산관리 한 줄 — 업체(company) · 품번 · 호기 칸 「수량EA」 · 납품요청일 = 발주 납기
//     · 줄을 알아보는 열쇠는 changes 첫 기록의 pkey (ETC|PO번호|줄) — 생산관리에 발주 줄을 가리키는 칸이 없어서
//   「📥 수주대장에서 불러오기」가 Edwards 발주와 함께 맞춘다:
//     없으면 만든다 · 납기 · 수량이 바뀌면 고친다 · 납품이 끝나면 완료 · 발주가 취소되면 「발주서 접수」를 끈다 (줄은 지우지 않음)
import { fetchAll } from './paginate'
import { fetchRefSetup, refCodeOf } from './etcCustomerRef'

const s = (v) => (v == null ? '' : String(v).trim())
const newId = () => 'pb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// 생산관리 줄이 협력사 줄인가 — 업체가 적혀 있고 열쇠가 있다
export const partnerInfo = (r) => {
  const c = (Array.isArray(r?.changes) ? r.changes : []).find((x) => x && x.pkey)
  return c && s(r.company) ? { key: c.pkey, po: c.po || '', line: c.line || '', company: s(r.company) } : null
}

// 수주대장의 Edwards 협력사 발주 줄 — [{ key, company, po, line, code, name, qty, due, done, cancelled }]
export async function fetchEdPartnerLines(supabase) {
  const setup = await fetchRefSetup()
  const heads = await fetchAll(() => supabase.from('pm_order')
    .select('id,po_no,customer_name,cancelled').eq('customer_code', 'ETC').order('id'))
  const mine = heads.filter((h) => s(h.customer_name) && refCodeOf(h.customer_name, setup) === 'ed')
  if (!mine.length) return []
  const hOf = new Map(mine.map((h) => [h.id, h]))
  const ids = mine.map((h) => h.id)
  const lines = []
  for (let i = 0; i < ids.length; i += 150) {
    lines.push(...await fetchAll(() => supabase.from('pm_order_line')
      .select('id,order_id,line_no,del_line,item_id,raw_pn,raw_desc,qty,delivered_qty,due_date,cancelled')
      .in('order_id', ids.slice(i, i + 150)).order('id')))
  }
  const itemIds = [...new Set(lines.map((l) => l.item_id).filter(Boolean))]
  const items = new Map()
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data, error } = await supabase.from('items').select('id,std_code,name').in('id', itemIds.slice(i, i + 200))
    if (error) throw error
    ;(data || []).forEach((x) => items.set(x.id, x))
  }
  return lines.map((l) => {
    const h = hOf.get(l.order_id), it = items.get(l.item_id)
    const line = `${s(l.line_no)}/${s(l.del_line) || '1'}`
    return {
      key: `ETC|${s(h.po_no)}|${line}`, company: s(h.customer_name), po: s(h.po_no), line,
      code: s(it?.std_code || l.raw_pn), name: s(it?.name || l.raw_desc),
      qty: Number(l.qty) || 0, due: l.due_date ? String(l.due_date).slice(0, 10) : null,
      done: (Number(l.delivered_qty) || 0) >= (Number(l.qty) || 0) && (Number(l.qty) || 0) > 0,
      cancelled: !!l.cancelled || !!h.cancelled,
    }
  })
}

// 맞출 계획 — rows: 지금 Edwards 생산관리 줄 전부 (완료 포함)
export function planEdPartner(lines, rows) {
  const have = new Map()
  for (const r of rows || []) { const p = partnerInfo(r); if (p && !have.has(p.key)) have.set(p.key, r) }
  const ins = [], upd = [], same = []
  for (const l of lines || []) {
    const r = have.get(l.key)
    if (!r) {
      if (!l.done && !l.cancelled) ins.push(l)
      continue
    }
    if (r.status === '완료') { same.push(l); continue }
    const patch = {}, chg = []
    if (l.cancelled) {
      if (r.po_received) { patch.po_received = false; chg.push({ type: 'PO해제', msg: `협력사 발주 취소 — ${l.po} ${l.line}` }) }
    } else if (l.done) {
      patch.status = '완료'; chg.push({ type: '완료', msg: `협력사 발주 납품 완료 — ${l.po} ${l.line}` })
    } else {
      const hogi = `${l.qty}EA`
      if (s(r.hogi) !== hogi) { patch.hogi = hogi; chg.push({ type: '수량변경', msg: `${r.hogi || '-'} → ${hogi}` }) }
      if ((l.due || '') !== s(r.req_date).slice(0, 10)) {
        patch.req_date = l.due
        if (s(r.req_date) && l.due) chg.push({ type: '납기변경', msg: `${s(r.req_date).slice(0, 10)} → ${l.due}`, from: s(r.req_date).slice(0, 10), to: l.due })
      }
      if (s(r.company) !== l.company) patch.company = l.company
    }
    if (Object.keys(patch).length) upd.push({ l, r, patch, chg })
    else same.push(l)
  }
  return { ins, upd, same }
}

export function rowFromPartner(l, by) {
  const now = new Date().toISOString()
  return {
    id: newId(), customer_code: 'ED', created_at: now, updated_at: now,
    company: l.company, name: l.name || l.code, pn: l.code.replace(/^ED-/i, ''), hogi: `${l.qty}EA`,
    part: null, part2: null, part3: null,
    status: 'PO접수', po_received: true, req_date: l.due || null, missing_parts: [],
    changes: [{ type: '수주대장 불러오기 (협력사)', at: now, by: by || null, pkey: l.key, po: l.po, line: l.line }],
  }
}

export async function applyEdPartner(supabase, plan, by) {
  const recs = plan.ins.map((l) => rowFromPartner(l, by))
  for (let i = 0; i < recs.length; i += 200) {
    const { error } = await supabase.from('production').insert(recs.slice(i, i + 200))
    if (error) throw error
  }
  const now = new Date().toISOString()
  for (const u of plan.upd) {
    const patch = { ...u.patch, updated_at: now }
    if (u.chg.length) patch.changes = [...(Array.isArray(u.r.changes) ? u.r.changes : []), ...u.chg.map((c) => ({ ...c, src: '수주대장', at: now, by: by || null }))]
    const { error } = await supabase.from('production').update(patch).eq('id', u.r.id)
    if (error) throw error
  }
  return { created: recs.length, updated: plan.upd.length }
}

// 미리 보기 글
export function planEdPartnerText(p) {
  const out = p.ins.map((l) => `＋ [${l.company}] ${l.code} ${l.qty}EA — 발주서 ${l.po} ${l.line} · 납기 ${String(l.due || '').slice(5) || '없음'}`)
  for (const u of p.upd) out.push(`✎ [${u.l.company}] ${u.l.code} — ${u.chg.map((c) => c.msg).join(' · ') || '업체 이름 맞춤'}`)
  return out
}
