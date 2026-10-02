// 3rd party PO (동신 · 동원파츠 …) — 고객사 PO 엑셀의 「3rd party」 시트 (2026-10-02)
//
//   AXCELIS 물건을 3rd party 가 진선에 발주한 건. 고객사 PO(AXCELIS)에 같이 넣되
//   purchase_orders.third_party 에 업체 이름을 적어 구분한다.
//     · 고객사 PO : 전부 넣는다 (16번대 케이블 포함)
//     · 생산관리  : 11 · 12번대만, PO 한 줄 = 한 줄 (Sub Assy · 호기 칸에 수량 「10EA」)
//                   16번대는 넣지 않는다.
//   ⚠ 예전 PO 연동(sync_production_from_po)은 PO 수량만큼 호기(#N)를 만든다.
//     3rd party 는 수량이 95 · 133개라 그대로 두면 수백 줄이 생긴다
//     → SQL pm_third_party_261002 가 연동에서 3rd party PO 를 빼고, 여기서 한 줄로 만든다.
//     (연동은 호기가 「#숫자」인 줄만 건드리므로 「10EA」 줄은 서로 간섭하지 않는다)
import { fetchAll } from './paginate'

const s = (v) => (v == null ? '' : String(v).trim())
const num = (v) => parseFloat(s(v).replace(/[^0-9.\-]/g, '')) || 0
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '')

// 3rd party 줄의 키 — PO번호 · 라인이 비어 있는 줄(별도요청)이 있어 품번까지 넣는다
export const tpKey = (r) => `3P|${s(r.third_party)}|${s(r.po_number)}|${s(r.order_line)}|${s(r.del_line)}|${s(r.pn)}`

// 생산관리에 올릴 품번인가 — 11 · 12번대만
export const isTpProdCode = (code) => /^(AX-)?1[12]\d/.test(s(code))
// 3rd party 생산 줄인가 (호기 칸이 「10EA」 · company 가 업체 이름)
export const isTpRow = (r) => !!r && !!s(r.company) && !/^axcelis$/i.test(s(r.company)) && /EA$/i.test(s(r.hogi))

// 시트 읽기.
//   머리글(M · N… = Item Desc · 열1…)이 실제 값 자리(Q · S · AG)와 어긋나 있어 칸 위치로 읽는다.
//   Current Data 와 같은 자리다: A 업체 · B/C 품번 · D SRev · F PO · G/H 라인 · I 수량 · K 납기 · Q 품명 · S 단가 · AG 현황
//   동원파츠는 B = AXCELIS 품번 · C = 자기 코드, 동신은 C = AXCELIS 품번 → AXCELIS 품번을 쓴다.
export function parseThirdPartySheet(XLSX, ws, dnorm) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const out = [], skipped = []
  if (!aoa.length) return { rows: out, skipped }
  const head = aoa[0].map((h) => s(h).replace(/\s/g, '').toLowerCase())
  if (!/item/.test(head[2] || '') || !/order/.test(head[5] || '')) {
    return { rows: out, skipped, badLayout: true }
  }
  const seen = new Set()
  aoa.slice(1).forEach((r, i) => {
    const third_party = s(r[0])
    const b = s(r[1]).replace(/\.0$/, ''), c = s(r[2]).replace(/\.0$/, '')
    const pn = /^\d{6,}/.test(b) ? b : c
    const po_number = s(r[5])
    if (!third_party && !pn && !po_number) return   // 빈 줄
    if (!third_party || !pn || !po_number) { skipped.push(`${i + 2}행: 업체 · 품번 · PO번호 중 빈 칸`); return }
    const d = dnorm(r[10])
    const stText = s(r[32])
    const row = {
      third_party, pn, po_number,
      order_line: s(r[6]).replace(/\.0$/, ''), del_line: s(r[7]).replace(/\.0$/, ''),
      ccn: '', item_rev: s(r[3]), item_brev: '',
      qty: num(r[8]),
      // 「선발주」처럼 날짜가 아닌 글자는 납기 없음 — 나중에 날짜가 채워지면 변경으로 잡힌다
      promise_date: isYmd(d) ? d : null,
      unit_price: num(r[18]),
      name: s(r[16]),
      division: pn.startsWith('16') ? '하네스' : pn.startsWith('11') ? '전장' : '구매품',
      state: /납품\s*완료|발송\s*완료/.test(stText) ? 'done' : /취소/.test(stText) ? 'cancel' : 'open',
      stText,
    }
    row._k = tpKey(row)
    if (seen.has(row._k)) { skipped.push(`${i + 2}행: 같은 PO 줄이 두 번 (${po_number} ${row.order_line}-${row.del_line} ${pn})`); return }
    seen.add(row._k)
    out.push(row)
  })
  return { rows: out, skipped }
}

// purchase_orders.third_party 칸이 있는가 (SQL pm_third_party_261002 실행 여부)
export async function thirdPartyReady(supabase) {
  const { error } = await supabase.from('purchase_orders').select('third_party').limit(1)
  return !error
}

// 3rd party PO → 생산관리 한 줄 맞추기
//   · 진행중 PO(11 · 12번대)에 줄이 없으면 만든다 — 호기 칸 = 「수량EA」, company = 업체
//   · 납기 · 수량 · Rev 가 바뀌면 고친다 (납기는 빈칸 → 날짜로 채워지는 것도)
//   · 취소된 PO 에 달린 진행 줄은 PO 연결만 푼다 (지우지 않는다)
//   완료 처리는 pm_sync_done_hogi(PO 완료 → 붙은 줄 완료)가 한다.
export async function syncThirdPartyProduction(supabase, csCode = 'AX') {
  const res = { created: 0, updated: 0, unlinked: 0 }
  if (!(await thirdPartyReady(supabase))) return { ...res, notReady: true }
  const { data: cs, error: ce } = await supabase.from('customers').select('id,code')
  if (ce) throw ce
  const csId = (cs || []).find((c) => s(c.code).toUpperCase() === s(csCode).toUpperCase())?.id
  if (!csId) return res
  const pos = (await fetchAll(() => supabase.from('purchase_orders')
    .select('id,po_number,order_line,del_line,qty_ordered,promise_date,item_rev,status,third_party, items!purchase_orders_item_id_fkey(std_code,name)')
    .eq('customer_id', csId).eq('order_type', 'customer_po').not('third_party', 'is', null).order('id')))
    .filter((p) => s(p.third_party))
  if (!pos.length) return res
  const prod = []
  const ids = pos.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('production')
      .select('id,po_id,status,hogi,req_date,rev,company,changes').in('po_id', ids.slice(i, i + 150))
    if (error) throw error
    prod.push(...(data || []))
  }
  const byPo = {}
  prod.forEach((r) => { (byPo[r.po_id] ||= []).push(r) })
  const now = new Date().toISOString()
  const prodCode = s(csCode).toUpperCase()
  for (const p of pos) {
    const code = p.items?.std_code || ''
    const mine = byPo[p.id] || []
    const live = mine.filter((r) => r.status !== '완료')
    if (p.status === '취소') {
      for (const r of live) {
        const { error } = await supabase.from('production').update({
          po_id: null, po_received: false,
          changes: [...(Array.isArray(r.changes) ? r.changes : []), { type: 'PO해제', msg: `3rd party PO 취소 — ${p.po_number} 연결 해제`, src: 'PO연동', at: now }],
          updated_at: now,
        }).eq('id', r.id)
        if (error) throw error
        res.unlinked++
      }
      continue
    }
    if (p.status !== '진행중' || !isTpProdCode(code)) continue
    const hogi = `${Number(p.qty_ordered) || 0}EA`
    const req = p.promise_date || ''
    if (!mine.length) {
      const { error } = await supabase.from('production').insert({
        id: 'pb' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4),
        company: p.third_party, name: p.items?.name || '', pn: code.replace(/^AX-/, ''), hogi,
        rev: p.item_rev || null, status: 'PO접수', po_received: true, req_date: req,
        missing_parts: [], changes: [{ type: '신규', msg: `3rd party PO 연동 생성 (${p.third_party} ${p.po_number})`, at: now }],
        customer_code: prodCode, po_id: p.id, created_at: now, updated_at: now,
      })
      if (error) throw error
      res.created++
      continue
    }
    const r = live[0]
    if (!r) continue
    const patch = {}, chg = []
    if ((r.req_date || '') !== req) {
      patch.req_date = req
      // 빈칸 → 날짜로 채워지는 것은 변경 기록을 남기지 않는다 (밀린 게 아니다)
      if (s(r.req_date) && req) chg.push({ type: '납기변경', msg: `${r.req_date} → ${req}`, from: r.req_date, to: req, src: 'PO연동', at: now })
    }
    if (s(r.hogi) !== hogi) { patch.hogi = hogi; chg.push({ type: '수량변경', msg: `${r.hogi || '-'} → ${hogi}`, src: 'PO연동', at: now }) }
    if (s(p.item_rev) && s(r.rev) !== s(p.item_rev)) patch.rev = p.item_rev
    if (s(r.company) !== s(p.third_party)) patch.company = p.third_party
    if (!Object.keys(patch).length) continue
    if (chg.length) patch.changes = [...(Array.isArray(r.changes) ? r.changes : []), ...chg]
    patch.updated_at = now
    const { error } = await supabase.from('production').update(patch).eq('id', r.id)
    if (error) throw error
    res.updated++
  }
  return res
}
