// 📥 견적 접수 (pm_rfq · pm_rfq_line) — 데이터 읽기 · 단계 · 점검 (v4.92.0)
//
//   단계(stage) — 상태(status)가 진행이면 품목 점검 결과로 정한다
//     BOM 필요   : 품목 중 BOM(어셈블리)도 단품 품목도 없는 것이 있음 → 영업이 고객 BOM 을 올린다
//     단가 요청  : BOM 은 다 있는데 단가 없는 부품이 있음 → 구매자재에 요청 (요청 전 = 「단가 없음」)
//     작성 가능  : 다 있음 → 견적 작성
//     점검 전    : 아직 점검을 안 함
//   제출 · 수주 · 실주 · 취소는 사람이 정한다
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { codeCandidates } from '../../lib/custPrefix'
import { spliceSubBoms } from '../../lib/bomSubExpand'
import { explodeBOM, computeCost, DEFAULT_CFG } from '../../lib/costAnalysis'
import { fetchQuoteBOM } from './QuoteSheet'

export const RFQ_STAGES = [
  ['new', '① 점검 전'], ['bom', '② BOM 필요'], ['noprice', '③ 단가 없음'], ['price', '③ 단가 요청 (구매자재)'],
  ['ready', '④ 작성 가능'], ['제출', '⑤ 제출'], ['수주', '⑥ 수주'], ['실주', '실주'], ['취소', '취소'],
]
export const STAGE_TONE = {
  new: 'bg-slate-100 text-slate-600 border-slate-200', bom: 'bg-red-50 text-red-600 border-red-200',
  noprice: 'bg-amber-50 text-amber-700 border-amber-200', price: 'bg-amber-50 text-amber-700 border-amber-200',
  ready: 'bg-violet-50 text-violet-700 border-violet-200', 제출: 'bg-slate-100 text-slate-700 border-slate-200',
  수주: 'bg-emerald-50 text-emerald-700 border-emerald-200', 실주: 'bg-white text-slate-400 border-slate-200', 취소: 'bg-white text-slate-400 border-slate-200',
}
export const stageLabel = (k) => (RFQ_STAGES.find(([x]) => x === k) || [k, k])[1]

export function stageOf(r) {
  if (r.status !== '진행') return r.status
  const ls = r.lines || []
  if (!ls.length || ls.some((l) => !l.checked_at)) return 'new'
  if (ls.some((l) => (l.kind || 'none') === 'none')) return 'bom'
  if (ls.some((l) => (+l.noprice_count || 0) > 0)) return r.price_req_at && !r.price_done_at ? 'price' : 'noprice'
  return 'ready'
}

export async function fetchRfqs() {
  const rows = await fetchAll(() => supabase.from('pm_rfq').select('*').order('created_at', { ascending: false }).order('id'))
  const lines = await fetchAll(() => supabase.from('pm_rfq_line').select('*').order('line_no').order('id'))
  const by = new Map(rows.map((r) => [r.id, { ...r, lines: [] }]))
  lines.forEach((l) => by.get(l.rfq_id)?.lines.push(l))
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
  const { data: projs, error: pErr } = await supabase.from('projects').select('id, code, name').eq('customer_id', customerId).in('code', cands)
  if (pErr) throw new Error('어셈블리 조회 — ' + pErr.message)
  const proj = pick(projs, 'code')
  if (proj) {
    const rows = (await spliceSubBoms(customerId, await fetchQuoteBOM(customerId, proj.id), fetchQuoteBOM, proj.id)).rows || []
    if (rows.length) {
      const mapped = rows.map((b, i) => ({
        uid: i, level: b.level, qty_per_unit: b.qty_per_unit, std_code: b.items?.std_code || '', name: b.items?.name || '', unit: b.items?.unit || '',
        manufacturer: b.items?.manufacturer || '', manufacturer_code: b.items?.manufacturer_code || '', purchase_price: b.items?.purchase_price ?? null,
        lt_weeks: b.items?.lt_weeks ?? null, moq: b.items?.moq ?? null, vendor: b.items?.vendors?.name || '', registered: !!b.items,
      }))
      const c = computeCost(explodeBOM(mapped), DEFAULT_CFG, {}, 0)
      const miss = c.items.filter((r) => !r.excluded && r.status !== 'ok')
      return { kind: 'assy', std_code: proj.code, project_id: proj.id, item_id: null, part_count: c.items.length, noprice_count: miss.length, noprice_codes: [...new Set(miss.map((r) => r.std_code).filter(Boolean))].slice(0, 200) }
    }
  }
  const { data: its, error: iErr } = await supabase.from('items').select('id, std_code, purchase_price').in('std_code', cands)
  if (iErr) throw new Error('품목 조회 — ' + iErr.message)
  const it = pick(its, 'std_code')
  if (it && !proj) {
    const has = Number(it.purchase_price) > 0
    return { kind: 'item', std_code: it.std_code, project_id: null, item_id: it.id, part_count: 1, noprice_count: has ? 0 : 1, noprice_codes: has ? [] : [it.std_code] }
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
    customerId = data?.id
    if (!customerId) throw new Error(`고객사 ${r.customer_code} 를 못 찾았습니다`)
  }
  for (const l of r.lines || []) {
    const res = await checkLine(customerId, r.customer_code, l.pn)
    const { error } = await supabase.from('pm_rfq_line').update({ ...res, checked_at: now }).eq('id', l.id)
    if (error) throw error
  }
  // 단가 없는 부품이 다 채워졌으면 단가 요청을 끝낸 것으로
  const { data: ls, error } = await supabase.from('pm_rfq_line').select('kind, noprice_count').eq('rfq_id', r.id)
  if (error) throw error
  const done = (ls || []).length && ls.every((l) => l.kind !== 'none' && !(+l.noprice_count > 0))
  if (done && r.price_req_at && !r.price_done_at) {
    const { error: e2 } = await supabase.from('pm_rfq').update({ price_done_at: now, updated_at: now }).eq('id', r.id)
    if (e2) throw e2
  }
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
