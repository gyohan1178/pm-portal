// 📥 견적 접수 (pm_rfq · pm_rfq_line) — 데이터 읽기 · 단계 · 점검 (v4.92.0)
//
//   단계(stage) — 상태(status)가 진행이면 품목 점검 결과로 정한다
//     BOM 필요   : 품목 중 BOM(어셈블리)도 단품 품목도 없는 것이 있음 → 영업이 고객 BOM 을 올린다
//     단가 요청  : BOM 은 다 있는데 단가 없는 부품이 있음 → 구매자재에 요청 (요청 전 = 「단가 없음」)
//     작성 가능  : 다 있음 → 견적 작성
//     점검 전    : 아직 점검을 안 함
//   제출 · 수주 · 실주 · 취소는 사람이 정한다
//
//   보류(v4.92.1) — 구매자재가 품목마다 「수급 어려움」 · 「단가 대기」를 표시하면 그 품목은 단계를 막지 않는다
//     준비된 품목(BOM · 단가 다 있음)만 먼저 견적 작성 · 제출할 수 있다
//     일부만 제출하면 남은 품목(보류 · 미준비)은 새 접수(「… (잔여)」)로 나눠 계속 진행한다
//   품목 상태: 제출됨(quoted_at) · 보류(hold) · 준비됨 · 막힘(BOM 없음 · 단가 없음)
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { codeCandidates } from '../../lib/custPrefix'
import { spliceSubBoms } from '../../lib/bomSubExpand'
import { explodeBOM, computeCost, needsPrice, DEFAULT_CFG } from '../../lib/costAnalysis'
import { fetchQuoteBOM } from './QuoteSheet'

export const RFQ_STAGES = [
  ['new', '① 점검 전'], ['bom', '② BOM 필요'], ['noprice', '③ 단가 없음'], ['price', '③ 단가 요청 (구매자재)'],
  ['ready', '④ 작성 가능'], ['hold', '보류 (수급 어려움)'], ['nq', '견적 불가 — 닫기 대기'], ['제출', '⑤ 제출'], ['수주', '⑥ 수주'], ['실주', '실주'], ['불가', '견적 불가'], ['취소', '취소'],
]
// 견적 불가 사유 (v4.100.0) — 품목마다. 나머지 품목은 계속 진행, 전부 불가면 접수를 「불가」로 닫는다
export const NOQUOTES = ['단종', '제작 불가', '사양 미확정', '수급 불가', '기타']
export const STAGE_TONE = {
  new: 'bg-slate-100 text-slate-600 border-slate-200', bom: 'bg-red-50 text-red-600 border-red-200',
  noprice: 'bg-amber-50 text-amber-700 border-amber-200', price: 'bg-amber-50 text-amber-700 border-amber-200',
  ready: 'bg-violet-50 text-violet-700 border-violet-200', hold: 'bg-slate-100 text-slate-500 border-slate-300', 제출: 'bg-slate-100 text-slate-700 border-slate-200',
  수주: 'bg-emerald-50 text-emerald-700 border-emerald-200', 실주: 'bg-white text-slate-400 border-slate-200', 취소: 'bg-white text-slate-400 border-slate-200',
  nq: 'bg-rose-50 text-rose-600 border-rose-200', 불가: 'bg-white text-rose-500 border-rose-200',
}
export const stageLabel = (k) => (RFQ_STAGES.find(([x]) => x === k) || [k, k])[1]

export const HOLDS = ['수급 어려움', '단가 대기']
export const isOpenLine = (l) => !l.quoted_at && !l.hold && !l.noquote      // 아직 견적 안 냈고 보류 · 견적 불가도 아님
export const isReadyLine = (l) => isOpenLine(l) && !!l.checked_at && (l.kind || 'none') !== 'none' && !(+l.noprice_count > 0)
export const readyLines = (r) => (r.lines || []).filter(isReadyLine)

export function stageOf(r) {
  if (r.status !== '진행') return r.status
  const ls = r.lines || []
  const open = ls.filter(isOpenLine)
  if (!ls.length || open.some((l) => !l.checked_at)) return 'new'
  if (open.some((l) => (l.kind || 'none') === 'none')) return 'bom'
  if (open.some((l) => (+l.noprice_count || 0) > 0)) return r.price_req_at && !r.price_done_at ? 'price' : 'noprice'
  if (!open.length) {
    if (ls.some((l) => l.hold && !l.quoted_at)) return 'hold'
    // 남은 품목이 모두 견적 불가 — 하나도 안 냈으면 「불가」로 닫을 차례 (v4.100.0)
    if (ls.some((l) => l.noquote && !l.quoted_at) && !ls.some((l) => l.quoted_at)) return 'nq'
    return 'ready'
  }
  return 'ready'
}

export async function fetchRfqs() {
  const rows = await fetchAll(() => supabase.from('pm_rfq').select('*').order('created_at', { ascending: false }).order('id'))
  const lines = await fetchAll(() => supabase.from('pm_rfq_line').select('*').order('line_no').order('id'))
  const by = new Map(rows.map((r) => [r.id, { ...r, lines: [] }]))
  // 단품으로 찾은 품목 — 기준정보 품명 · 매입가 · 그 단가의 근거(구매처 · 단가 이력)를 같이 보여 준다 (v4.99.0)
  //   품명을 안 붙여넣으면 무엇과 매칭됐는지 안 보였고, 근거 없는 매입가(처음 일괄 등록값)도 「작성 가능」으로 넘어갔다
  const ids = [...new Set(lines.filter((l) => l.item_id && !l.project_id).map((l) => l.item_id))]
  const info = new Map()
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150)
    const [{ data: its }, { data: ph }] = await Promise.all([
      supabase.from('items').select('id, name, purchase_price, vendors(name)').in('id', part),
      supabase.from('price_history').select('item_id, recorded_at').in('item_id', part).order('recorded_at', { ascending: false }),
    ])
    ;(its || []).forEach((x) => info.set(x.id, { name: x.name || '', price: x.purchase_price == null ? null : Number(x.purchase_price), vendor: x.vendors?.name || '', last: null }))
    ;(ph || []).forEach((h) => { const x = info.get(h.item_id); if (x && !x.last) x.last = h.recorded_at })
  }
  lines.forEach((l) => by.get(l.rfq_id)?.lines.push(l.item_id && info.has(l.item_id) ? { ...l, item: info.get(l.item_id) } : l))
  return [...by.values()]
}

// 품목 붙여넣기 — 「품번 · 품명 · Rev · 수량」 (탭 · 쉼표 · 2칸 이상 띄어쓰기). 머리줄(품번 · P/N)은 건너뜀
export function parsePaste(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split(/\t|,|\s{2,}/).map((x) => x.trim()))
    .filter((c) => c[0] && !/^(품번|p\/?n|part|item)/i.test(c[0]))
    .map((c, i) => {
      const last = c[c.length - 1]
      const qty = c.length > 1 && /^\d+(\.\d+)?$/.test(last) ? Number(last) : 1
      const body = c.length > 1 && /^\d+(\.\d+)?$/.test(last) ? c.slice(0, -1) : c
      return { line_no: i + 1, pn: body[0], name: body[1] || '', rev: body[2] || '', qty }
    })
}

// 한 품목 점검 — 견적 작성(QuoteSheet)이 품번을 넣을 때와 같은 규칙
//   어셈블리(projects + BOM) → 부품 단가 없는 수 / 단품(items) → 매입가 없으면 1 / 둘 다 없으면 BOM 필요
export async function checkLine(customerId, csCode, pn) {
  const cands = codeCandidates(pn, csCode)
  const pick = (list, key) => cands.map((c) => (list || []).find((x) => x[key] === c)).find(Boolean) || null
  const { data: projs, error: pErr } = customerId ? await supabase.from('projects').select('id, code, name').eq('customer_id', customerId).in('code', cands) : { data: [], error: null }
  if (pErr) throw new Error('어셈블리 조회 — ' + pErr.message)
  const proj = pick(projs, 'code')
  if (proj) {
    const rows = (await spliceSubBoms(customerId, await fetchQuoteBOM(customerId, proj.id), fetchQuoteBOM, proj.id)).rows || []
    if (rows.length) {
      const mapped = rows.map((b, i) => ({
        uid: i, level: b.level, qty_per_unit: b.qty_per_unit, std_code: b.items?.std_code || '', name: b.items?.name || '', unit: b.items?.unit || '',
        manufacturer: b.items?.manufacturer || '', manufacturer_code: b.items?.manufacturer_code || '', purchase_price: b.items?.purchase_price ?? null,
        category: b.items?.category || '', js_code: b.items?.js_code || '',
        lt_weeks: b.items?.lt_weeks ?? null, moq: b.items?.moq ?? null, vendor: b.items?.vendors?.name || '', registered: !!b.items,
      }))
      const c = computeCost(explodeBOM(mapped), DEFAULT_CFG, {}, 0)
      const miss = c.items.filter(needsPrice)   // 소요량 0 · 스펙 · 문서는 단가 제외 (v4.99.0)
      return { kind: 'assy', std_code: proj.code, project_id: proj.id, item_id: null, part_count: c.items.length, noprice_count: miss.length, noprice_codes: [...new Set(miss.map((r) => r.std_code).filter(Boolean))].slice(0, 200), found_name: proj.name || '' }
    }
  }
  const { data: its, error: iErr } = await supabase.from('items').select('id, std_code, name, purchase_price').in('std_code', cands)
  if (iErr) throw new Error('품목 조회 — ' + iErr.message)
  const it = pick(its, 'std_code')
  if (it && !proj) {
    const has = Number(it.purchase_price) > 0
    return { kind: 'item', std_code: it.std_code, project_id: null, item_id: it.id, part_count: 1, noprice_count: has ? 0 : 1, noprice_codes: has ? [] : [it.std_code], found_name: it.name || '' }
  }
  // 어셈블리 코드는 있는데 BOM 이 비어 있거나, 어디에도 없음 → BOM 필요
  return { kind: 'none', std_code: proj?.code || null, project_id: proj?.id || null, item_id: it?.id || null, part_count: 0, noprice_count: 0, noprice_codes: [] }
}

// 접수 건의 품목을 모두 점검해 저장
export async function checkRfq(r) {
  const now = new Date().toISOString()
  let customerId = r.customer_id
  if (!customerId) {
    const { data, error } = await supabase.from('customers').select('id').eq('code', String(r.customer_code).toLowerCase()).maybeSingle()
    if (error) throw error
    // 등록 안 된 고객사(「기타 · 직접 입력」 · v4.99.0)는 고객사 BOM 없이 품목(단품)만 찾는다
    customerId = data?.id || null
  }
  for (const l of r.lines || []) {
    if (l.quoted_at) continue                                   // 이미 견적 낸 품목은 다시 안 봄
    const { found_name: fname, ...res } = await checkLine(customerId, r.customer_code, l.pn)
    // 품명을 안 붙여넣었으면 찾은 품목 · 어셈블리 이름을 채운다 — 무엇과 매칭됐는지 보이게 (v4.99.0)
    const patch = { ...res, checked_at: now, ...(!String(l.name || '').trim() && fname ? { name: fname } : {}) }
    const { error } = await supabase.from('pm_rfq_line').update(patch).eq('id', l.id)
    if (error) throw error
  }
  await syncPriceDone(r)
}

// 단가 요청 끝 — 보류 · 제출된 품목을 빼고 남은 품목이 모두 준비되면 (구매자재가 따로 안 눌러도)
export async function syncPriceDone(r, meName) {
  const { data: ls, error } = await supabase.from('pm_rfq_line').select('*').eq('rfq_id', r.id)   // * — 견적 불가 칸(noquote)은 SQL 전엔 없음
  if (error) throw error
  const open = (ls || []).filter(isOpenLine)
  const done = (ls || []).length && open.every((l) => (l.kind || 'none') !== 'none' && !(+l.noprice_count > 0))
  if (done && r.price_req_at && !r.price_done_at) {
    const t = new Date().toISOString()
    const { error: e2 } = await supabase.from('pm_rfq').update({ price_done_at: t, price_done_by: meName || null, updated_at: t }).eq('id', r.id)
    if (e2) throw e2
  }
}

// 구매자재 — 품목 보류 표시 (수급 어려움 · 단가 대기 · 해제)
export async function setLineHold(r, line, hold, memo, meName) {
  const t = new Date().toISOString()
  const patch = hold ? { hold, hold_memo: memo || null, hold_by: meName || null, hold_at: t } : { hold: null, hold_memo: null, hold_by: null, hold_at: null }
  const { error } = await supabase.from('pm_rfq_line').update(patch).eq('id', line.id)
  if (error) throw error
  if (hold) await syncPriceDone(r, meName)
}

// 견적 불가 표시 · 해제 (v4.100.0) — 사유 필수. 칸이 없으면(SQL 전) 알려 준다
export const NOQUOTE_SQL_HINT = '견적 불가 칸이 아직 없습니다 — Supabase 에서 「견적불가_반영_261026.sql」을 먼저 실행해 주세요'
export async function setLineNoquote(r, line, reason, memo, meName) {
  const t = new Date().toISOString()
  const patch = reason ? { noquote: reason, noquote_memo: memo || null, noquote_by: meName || null, noquote_at: t } : { noquote: null, noquote_memo: null, noquote_by: null, noquote_at: null }
  const { error } = await supabase.from('pm_rfq_line').update(patch).eq('id', line.id)
  if (error) throw new Error(/noquote/.test(error.message || '') ? NOQUOTE_SQL_HINT : error.message)
  if (reason) await syncPriceDone(r, meName)
}
// 모든 품목이 견적 불가 — 접수를 「불가」로 닫는다 (사유는 품목 사유를 모아서)
export async function closeNoquote(r, memo) {
  const reasons = [...new Set((r.lines || []).filter((l) => l.noquote).map((l) => l.noquote))].join(' · ')
  const { error } = await supabase.from('pm_rfq').update({ status: '불가', result_at: new Date().toISOString().slice(0, 10), result_memo: memo || reasons || null, updated_at: new Date().toISOString() }).eq('id', r.id)
  if (error) throw new Error(/check constraint|pm_rfq_status_chk/.test(error.message || '') ? NOQUOTE_SQL_HINT : error.message)
}

// 접수 수정 (v4.100.0) — 머리(건명 · 고객사 · 기한 …)와 품목(고치기 · 빼기 · 더하기). 바뀐 품목은 다시 점검한다
//   이미 견적 낸 품목(quoted_at)은 고치거나 뺄 수 없다
export async function editRfq(r, { head, lines, removed, added }) {
  const t = new Date().toISOString()
  const { error } = await supabase.from('pm_rfq').update({ ...head, updated_at: t }).eq('id', r.id)
  if (error) throw error
  const csChanged = head.customer_code != null && head.customer_code !== r.customer_code
  for (const l of lines || []) {
    const o = (r.lines || []).find((x) => x.id === l.id)
    if (!o || o.quoted_at) continue
    const pnChanged = String(o.pn || '').trim() !== String(l.pn || '').trim()
    const p = { pn: String(l.pn || '').trim(), name: l.name || null, rev: l.rev || null, qty: Number(l.qty) || 1 }
    if (pnChanged || csChanged) Object.assign(p, { checked_at: null, kind: null, std_code: null, project_id: null, item_id: null, part_count: 0, noprice_count: 0, noprice_codes: [] })
    if (pnChanged || csChanged || o.name !== p.name || o.rev !== p.rev || Number(o.qty) !== p.qty) {
      const { error: e1 } = await supabase.from('pm_rfq_line').update(p).eq('id', l.id)
      if (e1) throw e1
    }
  }
  const del = (removed || []).filter((id) => !(r.lines || []).find((x) => x.id === id)?.quoted_at)
  if (del.length) {
    const { error: e2 } = await supabase.from('pm_rfq_line').delete().in('id', del)
    if (e2) throw e2
  }
  if ((added || []).length) {
    const start = Math.max(0, ...(r.lines || []).map((x) => Number(x.line_no) || 0))
    const { error: e3 } = await supabase.from('pm_rfq_line').insert(added.map((l, i) => ({ rfq_id: r.id, line_no: start + i + 1, pn: l.pn, name: l.name || null, rev: l.rev || null, qty: Number(l.qty) || 1 })))
    if (e3) throw e3
  }
}

// 제출 — 고른 품목만 제출로 표시. 남은 품목(보류 · 미준비)은 split 이면 새 접수로 옮긴다
export async function submitRfq(r, { lineIds, quote_no, submitted_at, submit_amount, currency, split, meName }) {
  const t = new Date().toISOString()
  const pick = new Set(lineIds)
  const rest = (r.lines || []).filter((l) => !l.quoted_at && !l.noquote && !pick.has(l.id))   // 견적 불가 품목은 잔여로 안 옮김
  if (pick.size) {
    const { error } = await supabase.from('pm_rfq_line').update({ quoted_at: t, quote_no: quote_no || null }).in('id', [...pick])
    if (error) throw error
  }
  let child = null
  if (split && rest.length) {
    const { data, error } = await supabase.from('pm_rfq').insert({
      status: '진행', parent_id: r.id, customer_code: r.customer_code, customer_id: r.customer_id, title: `${r.title} (잔여)`, cust_ref: r.cust_ref, due_date: r.due_date,
      owner_name: r.owner_name, memo: [r.memo, `${r.title} 에서 나눔 — 보류 · 미준비 ${rest.length}품목`].filter(Boolean).join(' · '),
      price_req_at: r.price_req_at, price_req_by: r.price_req_by, created_name: meName || null, updated_at: t,
    }).select('*').single()
    if (error) throw error
    child = Array.isArray(data) ? data[0] : data
    const { error: e2 } = await supabase.from('pm_rfq_line').update({ rfq_id: child.id }).in('id', rest.map((l) => l.id))
    if (e2) throw e2
  }
  const allDone = !rest.length || (split && child)
  const patch = { quote_no: quote_no || null, submitted_at: submitted_at || null, submit_amount: submit_amount === '' || submit_amount == null ? null : Number(submit_amount), currency: currency || null, updated_at: t }
  if (allDone) patch.status = '제출'
  const { error: e3 } = await supabase.from('pm_rfq').update(patch).eq('id', r.id)
  if (e3) throw e3
  return { child, partial: !allDone }
}

export async function saveRfq({ head, lines, meName }) {
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('pm_rfq').insert({ status: '진행', ...head, created_name: meName || null, updated_at: now }).select('*').single()
  if (error) throw error
  if (lines.length) {
    const { error: e2 } = await supabase.from('pm_rfq_line').insert(lines.map((l, i) => ({ rfq_id: data.id, line_no: i + 1, pn: l.pn, name: l.name || null, rev: l.rev || null, qty: Number(l.qty) || 1 })))
    if (e2) throw e2
  }
  return data
}

export async function patchRfq(id, patch) {
  const { error } = await supabase.from('pm_rfq').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteRfq(id) {
  const { error } = await supabase.from('pm_rfq').delete().eq('id', id)
  if (error) throw error
}

export const dday = (d, today) => {
  if (!d) return null
  return Math.round((new Date(d) - new Date(today)) / 86400000)
}
