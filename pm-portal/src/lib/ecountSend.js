// ⚡ 이카운트로 바로 보내기 (v4.253.0) — 발주서입력 · 구매입력을 이카운트 API 로.
//
//   포털은 이카운트를 직접 부르지 않는다. 「보낼 일」(pm_ecount_jobs)을 한 줄 쌓으면
//   사무실 중계(교한 PC 의 Gyohan Studio — 이카운트에 등록된 IP)가 몇 초 안에 이카운트로 보내고,
//   돌려받은 이카운트 번호를 포털 발주번호에 넣은 뒤 결과를 적는다.
//   (이카운트는 등록한 IP 에서만 API 를 받는다. Supabase 함수는 IP 가 고정되지 않아 못 부름.)
//
//   값은 「📑 이카운트 발주서」 · 「이카운트 구매입력」 엑셀과 같게 만든다 — 같은 화면의 엑셀과 결과가 같아야 하므로.
//   ⚠ 이카운트는 적요 · 메모에 특수문자(— 등)가 있으면 그 전표를 거절한다 → 글자를 걸러 보낸다.
import { supabase } from './supabase'
import { ecountSpec } from './bomProc'
import { isEcountPoNo, ecountOrdOf } from './poNumber'
import { ECOUNT_WH } from './ecountPurchaseInput'

const s = (v) => (v == null ? '' : String(v).trim())
// 이카운트가 받는 글자만 (한글 · 영문 · 숫자 · 띄어쓰기 · 흔한 기호)
export const ecountText = (v, n = 200) => s(v).replace(/[^\p{Script=Hangul}A-Za-z0-9 .,()[\]/#&+_:%'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const ymd = (d) => s(d).replace(/-/g, '').slice(0, 8)

/**
 * 발주서입력 — 체크한 발주 줄을 이카운트 발주서로.
 *   「📑 이카운트 발주서」 엑셀과 같은 규칙: 거래처코드 + 발주일 + 납기가 같으면 한 장.
 *   이미 이카운트 번호가 있는 줄은 빼고(두 번 보내지 않게) 알려 준다.
 * 돌려줌: { slips:[{ seq, refs, bulk, label }], skipped:[{ id, why }], issues:[문구] }
 */
export function buildPoSlips(items, vendors, staffCode, revOf = {}) {
  const vendorMap = Object.fromEntries((vendors || []).map((v) => [v.id, v]))
  const skipped = [], issues = []
  const todo = []
  for (const po of items) {
    if (isEcountPoNo(po.po_number)) { skipped.push({ id: po.id, why: `이미 이카운트 번호 있음 (${po.po_number})` }); continue }
    if (!(Number(po.qty_ordered) > 0)) { skipped.push({ id: po.id, why: '발주 수량 0' }); continue }
    todo.push(po)
  }
  const groups = new Map()
  for (const po of todo) {
    const v = po.vendor_id ? vendorMap[po.vendor_id] : null
    const key = `${v?.ecount_code || v?.name || ''}|${ymd(po.order_date)}|${ymd(po.promise_date)}`
    if (!groups.has(key)) groups.set(key, { v, date: ymd(po.order_date) || ymd(new Date().toISOString()), due: ymd(po.promise_date), lines: [] })
    groups.get(key).lines.push(po)
  }
  const slips = [...groups.values()].sort((a, b) => s(a.v?.ecount_code).localeCompare(s(b.v?.ecount_code)) || a.date.localeCompare(b.date) || a.due.localeCompare(b.due))
    .map((g, i) => {
      const seq = String(i + 1)
      if (!g.v) issues.push(`${g.date} 업체 없는 발주 ${g.lines.length}줄 — 이카운트에서 거래처를 못 찾아 실패할 수 있음`)
      else if (!g.v.ecount_code) issues.push(`${g.v.name} — 이카운트 거래처코드 없음 → 이름으로 보냄 (이카운트에 같은 이름이 없으면 실패)`)
      if (!g.due) issues.push(`${g.v?.name || '업체 없음'} ${g.date} — 납기 없음`)
      const bulk = g.lines.map((po) => {
        const qty = Number(po.qty_ordered) || 0, price = Number(po.unit_price) || 0
        const supply = Math.round(qty * price), vat = Math.round(supply * 0.1)
        return {
          UPLOAD_SER_NO: seq, IO_DATE: g.date, TIME_DATE: g.due, CUST: s(g.v?.ecount_code), CUST_DES: g.v?.ecount_code ? '' : s(g.v?.name),
          EMP_CD: staffCode, WH_CD: ECOUNT_WH, PJT_CD: '00012',
          PROD_CD: s(po.items?.std_code), PROD_DES: ecountText(po.items?.name, 100), SIZE_DES: ecountText(ecountSpec(po, po.item_rev || revOf[po.id] || ''), 100),
          QTY: String(qty), PRICE: String(price), SUPPLY_AMT: String(supply), VAT_AMT: String(vat), REMARKS: ecountText(po.memo),
        }
      })
      return { seq, refs: g.lines.map((po) => po.id), bulk, label: `${g.v?.name || '업체 없음'} · 발주 ${g.date} · 납기 ${g.due || '-'} · ${g.lines.length}줄` }
    })
  return { slips, skipped, issues }
}

/**
 * 구매입력 — 입고 현황 → 이카운트 구매입력. buildPurchase(ecountPurchaseInput.js) 의 전표 묶음을 그대로 쓴다.
 *   줄의 발주번호가 이카운트 번호면 발주에 연결(ORD_DATE · ORD_NO) → 이카운트 발주 잔량이 줄어든다.
 *   이카운트 번호가 없는 줄은 연결 없이 들어간다(미입고현황에는 남음).
 */
export function buildBuySlips(built, staffCode) {
  let linked = 0, unlinked = 0
  const slips = built.slips.map((g) => {
    const bulk = g.lines.map((l) => {
      const ord = isEcountPoNo(l.po) ? ecountOrdOf(l.po) : null
      ord ? linked++ : unlinked++
      return {
        UPLOAD_SER_NO: String(g.seq), IO_DATE: g.date.replace(/-/g, ''), CUST: g.vendorCode, CUST_DES: g.vendorCode ? '' : g.vendorName,
        EMP_CD: staffCode, WH_CD: ECOUNT_WH, PJT_CD: g.project,
        ...(ord || {}),
        PROD_CD: l.code, PROD_DES: ecountText(l.name, 100), SIZE_DES: ecountText(l.spec, 100),
        QTY: String(l.qty), PRICE: String(l.price), SUPPLY_AMT: String(l.supply), VAT_AMT: String(l.vat), REMARKS: ecountText(l.po),
      }
    })
    return { seq: String(g.seq), refs: g.lines.map((l) => l.r.id), bulk, label: `${g.vendorName || '구매처 없음'} · 입고 ${g.date} · ${g.lines.length}줄` }
  })
  return { slips, linked, unlinked }
}

/** 보낼 일 쌓기 */
export async function enqueueEcount(kind, slips, requestedName) {
  if (!slips.length) throw new Error('보낼 전표가 없습니다')
  const { data, error } = await supabase.from('pm_ecount_jobs')
    .insert({ kind, payload: { slips }, requested_name: requestedName || null }).select('id').single()
  if (error) {
    if (/pm_ecount_jobs|schema cache|does not exist/i.test(error.message)) throw new Error('「이카운트_보내기_반영_261127.sql」을 먼저 실행해 주세요')
    throw new Error('보낼 일을 쌓지 못했습니다 — ' + error.message)
  }
  return data.id
}

/** 최근 보낸 일 + 중계 상태 */
export async function fetchEcountJobs(limit = 8) {
  const [{ data: jobs, error }, { data: relay }] = await Promise.all([
    supabase.from('pm_ecount_jobs').select('id, kind, status, result, error, requested_name, created_at, done_at, payload->slips').order('id', { ascending: false }).limit(limit),
    supabase.from('pm_ecount_relay').select('seen_at, note').eq('id', 1).maybeSingle(),
  ])
  if (error) return { missing: /pm_ecount_jobs|schema cache|does not exist/i.test(error.message), jobs: [], relay: null }
  return { jobs: jobs || [], relay: relay || null }
}
