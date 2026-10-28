// 수주대장 — 직접 등록 · 엑셀 양식 · 줄 취소 · 정식 PO 전환 · 명세서번호 (v4.94.0)
//
//   PDF 가 없는 주문도 같은 대장에 둔다.
//     정식 PO   — PO 번호는 있는데 발주서 PDF 가 없음
//     구두 발주 — 전화 · 메일로 먼저 받음. 이카운트 명세서번호 필수(마감 · 월말 대조의 열쇠). PO 번호는 임시(구두-VM-2610-01)
//     선진행    — PO 전에 우리가 먼저 생산 시작. 임시 번호(선진-ED-2610-01)
//     발주 예정 — 고객사 계획(CSK Plnd 번호). 고객사별 「발주 예정」 머리 아래 줄로 — 실제 발주서가 오면 지금처럼 Plnd 로 옮김
//   정식 PO 가 오면 「정식 PO 번호로 바꾸기」 — 같은 PO 로 이어져 회신 · 명세서번호가 그대로 남는다.
//   줄 취소는 지우지 않고 표시 + 사유 · 이력. 편집 권한이면 누구나 (납품 끝난 줄은 못 함)
import { supabase } from './supabase'
import { logActivity } from './activityLog'
import { ORDER_CUSTOMERS, saveOrder, loadOrderByNo, lineKey, isManualCust, orderCustName } from './orderIntake'

export const KINDS = { po: '정식 PO', verbal: '구두 발주', advance: '선진행', planned: '발주 예정' }
export const KIND_SHORT = { verbal: '구두', advance: '선진행', planned: '예정' }
export const KIND_TONE = {
  po: 'bg-slate-100 text-slate-600', verbal: 'bg-amber-50 text-amber-700',
  advance: 'bg-blue-50 text-blue-700', planned: 'bg-violet-50 text-violet-700',
}
export const KIND_HELP = {
  po: 'PO 번호가 있는데 PDF 가 없음',
  verbal: '전화 · 메일로 먼저 받음 — 정식 PO 대기',
  advance: 'PO 전에 우리가 먼저 생산 시작',
  planned: '고객사 계획만 (CSK Plnd 번호 등)',
}
export const CHANNELS = ['메일', '전화', '회의']
export const CANCEL_REASONS = ['고객사 취소', '새 PO 로 재발행', '중복 등록', '기타']
export const kindOf = (o) => (o?.kind && KINDS[o.kind] ? o.kind : o?.planned ? 'planned' : 'po')
const TEMP_PREFIX = { verbal: '구두', advance: '선진' }
export const isTempPo = (o) => ['verbal', 'advance'].includes(kindOf(o))

const s = (v) => (v == null ? '' : String(v).trim())
const p2 = (n) => String(n).padStart(2, '0')
const now = () => new Date().toISOString()

// 날짜 칸 — 엑셀 날짜 · 2026-10-23 · 2026.10.23 · 20261023
export function ymd(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600 * 1000); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` }
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` }
  const t = s(v)
  let m = t.match(/^(\d{4})[-./ ](\d{1,2})[-./ ](\d{1,2})/)
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[,₩$\s]/g, '')); return Number.isFinite(n) ? n : null }

// 임시 PO 번호 — 구두-VM-2610-01 (같은 달 · 같은 고객사에서 다음 번호)
export function tempPoNo(kind, cust, takenNos, date = new Date()) {
  const pre = `${TEMP_PREFIX[kind] || '임시'}-${cust}-${String(date.getFullYear()).slice(2)}${p2(date.getMonth() + 1)}-`
  const used = (takenNos || []).filter((n) => String(n).startsWith(pre)).map((n) => +String(n).slice(pre.length) || 0)
  return pre + p2((used.length ? Math.max(...used) : 0) + 1)
}

// 고객사 글자 → 코드
export function custOf(v) {
  const t = s(v).toUpperCase().replace(/\s/g, '')
  if (!t) return null
  if (/^(AX|AXCELIS|엑셀리스|액셀리스)$/.test(t)) return 'AX'
  if (/^(ED|EDWARDS|EDWARDSKOREA|에드워드|에드워즈)/.test(t)) return 'ED'
  if (/^(VM|브이엠)/.test(t)) return 'VM'
  if (/^(CSK|CS|씨에스케이)/.test(t)) return 'CSK'
  return null
}
// 엑셀 양식 「고객사」 칸 — 4개 고객사가 아니면 그 글자를 업체 이름으로 「기타」 (v4.107.0)
//   「기타」 · 「ETC」 만 쓰면 어느 업체인지 몰라 받지 않는다
export function custOfCell(v) {
  const c = custOf(v)
  if (c) return { cust: c, name: null }
  const t = s(v)
  if (!t) return null
  if (/^(기타|ETC)$/i.test(t.replace(/\s/g, ''))) return { cust: 'ETC', name: null }
  return { cust: 'ETC', name: t }
}
// 기타 업체 이름 — 전에 쓴 이름 (직접 등록 칸의 고르기 목록). 칸이 없으면(SQL 전) 기본 이름만
export const ETC_NAME_SEED = ['동원파츠', '동신', '두웰']
export async function fetchEtcNames() {
  const { data, error } = await supabase.from('pm_order').select('customer_name').eq('customer_code', 'ETC').limit(1000)
  const used = error ? [] : (data || []).map((x) => s(x.customer_name)).filter(Boolean)
  return [...new Set([...used, ...ETC_NAME_SEED])].sort((a, b) => a.localeCompare(b, 'ko'))
}
export function kindOfText(v) {
  const t = s(v).replace(/\s/g, '')
  if (!t || /^(정식|정식PO|PO)$/i.test(t)) return 'po'
  if (/^구두/.test(t)) return 'verbal'
  if (/^선진/.test(t)) return 'advance'
  if (/예정|plan/i.test(t)) return 'planned'
  return null
}

// 붙여넣기 — 품번 · 수량 · 단가 · 납기 · (품명) — 탭 · 쉼표 · 두 칸 이상 띄움으로 구분. 머리글 줄은 건너뜀
export function parseEntryPaste(text) {
  return String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    // 탭이 있으면 탭으로만 (금액 속 쉼표 48,000 을 자르지 않게), 없으면 쉼표 뒤 띄움 · 두 칸 이상 띄움
    .map((x) => (x.includes('\t') ? x.split('\t') : x.split(/,\s+|\s{2,}/)).map((c) => c.trim()))
    .filter((c) => c[0] && !/^(품번|p\/?n|part|item)/i.test(c[0]))
    .map((c) => ({ pn: c[0], qty: num(c[1]) ?? 1, price: num(c[2]), due: ymd(c[3]), desc: c[4] || '' }))
}

// ── 엑셀 양식 ─────────────────────────────────────────────
export const TEMPLATE_HEAD = ['구분', '고객사', 'PO번호', '명세서번호', '발주일', '납품처', '받은 경로', '요청한 사람', '정식 PO 받을 날', '품번', 'Rev', '품명', '수량', '단가', '납기', 'Plnd 번호', '비고', '특이사항']
const TEMPLATE_SAMPLE = [
  ['구두', 'VM', '', '2026/10/23-4', '2026-10-23', '', '메일', 'VM 구매 박책임', '2026-10-30', '790-3003-320', '1', 'EDA PC ETHERNET', 11, 48000, '2026-11-20', '', '', ''],
  ['선진행', 'ED', '', '', '2026-10-23', '아산', '회의', '', '2026-11-06', 'NKB364074', '', 'FAC MOD ACC ELEC ASSY', 2, 1250000, '2026-12-04', '', '', '납품 전 담당자 연락'],
  ['정식', 'AX', '47900KF', '', '2026-10-22', '평택', '', '', '', '110153030', 'P', '', 3, 1000000, '2026-12-30', '', '', ''],
  ['정식', '동원파츠', 'DW-2610-01', '', '2026-10-28', '', '', '', '', '110153030', '', '', 2, 1000000, '2026-12-15', '', '기타 업체 — 고객사 칸에 업체 이름', '사급 자재 별도 전달'],
  ['예정', 'CSK', '', '', '', '안성', '', '', '', 'SCS0195S-0L1-ON084', '', 'SCSB116084AF', 1, 3502200, '2026-11-30', '505104554', '관리번호 JS2611-40', ''],
]
const TEMPLATE_GUIDE = [
  ['칸', '설명'],
  ['구분', '정식 · 구두 · 선진행 · 예정 (비우면 정식)'],
  ['고객사', 'AX · ED · VM · CSK — 그 밖의 업체(동원파츠 · 동신 · 두웰 …)는 업체 이름을 그대로 쓰면 「기타」 고객사로 들어감. 발주 예정은 4개 고객사만'],
  ['PO번호', '정식은 필수. 구두 · 선진행은 비우면 임시 번호(구두-VM-2610-01)를 붙임. 같은 PO번호 줄은 한 PO 로 묶음'],
  ['명세서번호', '이카운트 거래명세서 번호(일자-순번) — 구두 발주는 필수. PO 당 하나'],
  ['정식 PO 받을 날', '구두 · 선진행 — 이 날이 지나도 정식 PO 가 없으면 업무 흐름에 뜸'],
  ['품번', '고객사 품번 — 포털 코드로 자동으로 찾음 (못 찾으면 미등록으로 들어가고 「코드 · BOM 정리」에서 코드 부여)'],
  ['Plnd 번호', '발주 예정(CSK)만 — 실제 발주서가 오면 이 번호로 찾아 옮김'],
  ['비고', '관리번호 등 메모 (CSK 는 「관리번호 JS2611-40」처럼)'],
  ['특이사항', 'PO 에 따라붙는 메모 — 발주서 적요 · 참고 사항 · 사용처 등. 같은 PO 의 아무 줄에 한 번만 써도 됨 (수주대장 · PO 상세에 보임)'],
]
export function templateWorkbook(XLSX) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEAD, ...TEMPLATE_SAMPLE])
  ws['!cols'] = TEMPLATE_HEAD.map((h) => ({ wch: Math.max(8, h.length * 2 + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, '수주등록')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE), '설명')
  return wb
}

// 양식 읽기 → PO 단위로 묶음 { orders, errors }
export function parseEntryWorkbook(XLSX, wb) {
  const name = wb.SheetNames.find((n) => /수주등록/.test(n)) || wb.SheetNames[0]
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true })
  const hi = aoa.findIndex((r) => r.some((c) => s(c) === '품번') && r.some((c) => s(c) === '수량'))
  if (hi < 0) throw new Error('「품번」 · 「수량」 머리글이 있는 줄을 못 찾았습니다 — 수주등록 양식을 쓰세요')
  const H = aoa[hi].map((c) => s(c).replace(/\s/g, ''))
  const col = (n) => H.indexOf(n.replace(/\s/g, ''))
  const at = (r, n) => { const i = col(n); return i < 0 ? '' : r[i] }
  const groups = new Map(), errors = []
  aoa.slice(hi + 1).forEach((r, k) => {
    const rowNo = hi + 2 + k
    const pn = s(at(r, '품번'))
    if (!pn && !s(at(r, '고객사'))) return
    const kind = kindOfText(at(r, '구분'))
    const cc = custOfCell(at(r, '고객사'))
    const cust = cc?.cust || null, custName = cc?.name || null
    if (!kind) { errors.push(`${rowNo}행: 구분 「${s(at(r, '구분'))}」 — 정식 · 구두 · 선진행 · 예정 중 하나`); return }
    if (!cust) { errors.push(`${rowNo}행: 고객사가 비었습니다 — AX · ED · VM · CSK 또는 업체 이름`); return }
    if (cust === 'ETC' && !custName) { errors.push(`${rowNo}행: 고객사 「${s(at(r, '고객사'))}」 — 기타 업체는 업체 이름을 쓰세요 (예: 동원파츠)`); return }
    if (cust === 'ETC' && kind === 'planned') { errors.push(`${rowNo}행: 발주 예정은 4개 고객사만 — ${custName} 은 정식 · 구두 · 선진행으로`); return }
    if (!pn) { errors.push(`${rowNo}행: 품번이 비었습니다`); return }
    const qty = num(at(r, '수량'))
    if (!(qty > 0)) { errors.push(`${rowNo}행: 수량이 없습니다`); return }
    const po = s(at(r, 'PO번호')), slip = s(at(r, '명세서번호'))
    if (kind === 'po' && !po) { errors.push(`${rowNo}행: 정식 PO 는 PO번호가 필요합니다`); return }
    if (kind === 'verbal' && !slip) { errors.push(`${rowNo}행: 구두 발주는 명세서번호가 필요합니다`); return }
    // 묶는 열쇠 — PO번호가 있으면 그 번호, 없으면 같은 구분 · 고객사 · 명세서번호 · 요청자 · 받을 날
    const ck = custName ? `${cust}:${custName}` : cust
    const key = kind === 'planned' ? `planned|${ck}` : po ? `${ck}|${po}` : `${kind}|${ck}|${slip}|${s(at(r, '요청한 사람'))}|${ymd(at(r, '정식 PO 받을 날')) || ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        kind, cust, customer_name: custName, po_no: kind === 'planned' ? '' : po, slip_no: slip || null, order_date: ymd(at(r, '발주일')), ship_to: s(at(r, '납품처')) || null,
        req_channel: s(at(r, '받은 경로')) || null, req_person: s(at(r, '요청한 사람')) || null, po_due: ymd(at(r, '정식 PO 받을 날')), lines: [], rows: [], note: '',
      })
    }
    const g = groups.get(key)
    if (!g.note && s(at(r, '특이사항'))) g.note = s(at(r, '특이사항'))       // 특이사항 메모 (v4.109.0)
    if (g.kind !== kind) { errors.push(`${rowNo}행: 같은 PO번호 ${po} 인데 구분이 다릅니다`); return }
    if (!g.slip_no && slip) g.slip_no = slip
    g.rows.push(rowNo)
    g.lines.push({ pn, rev: s(at(r, 'Rev')) || null, desc: s(at(r, '품명')) || '', qty, price: num(at(r, '단가')), due: ymd(at(r, '납기')),
      plnd: kind === 'planned' ? (s(at(r, 'Plnd번호')) || s(at(r, 'PO번호')) || null) : null, note: s(at(r, '비고')) || null })
  })
  const orders = [...groups.values()].map((g) => ({ ...g, lines: g.lines.map((l, i) => ({ ...l, line_no: String(i + 1), del_line: '1' })) }))
  return { orders, errors, sheet: name }
}

// ── 등록 ─────────────────────────────────────────────────
//   e = { kind, cust, po_no, slip_no, order_date, ship_to, req_channel, req_person, po_due, lines: matchLines 결과 }
export async function registerEntry(e, meName) {
  const cust = e.cust
  if (!ORDER_CUSTOMERS[cust]) throw new Error('고객사를 고르세요')
  if (!KINDS[e.kind]) throw new Error('구분을 고르세요')
  const etc = isManualCust(cust)
  const custName = etc ? s(e.customer_name) : null
  if (etc && !custName) throw new Error('기타 고객사는 업체 이름을 넣으세요 (예: 동원파츠)')
  if (etc && e.kind === 'planned') throw new Error('발주 예정은 4개 고객사만 — 기타 업체는 정식 · 구두 · 선진행으로 등록하세요')
  const lines = (e.lines || []).filter((l) => s(l.pn) || l.item)
  if (!lines.length) throw new Error('품목을 넣으세요')
  if (lines.some((l) => !(Number(l.qty) > 0))) throw new Error('수량이 없는 품목이 있습니다')
  if (e.kind === 'po' && !s(e.po_no)) throw new Error('정식 PO 는 PO 번호를 넣으세요')
  if (e.kind === 'verbal' && !s(e.slip_no)) throw new Error('구두 발주는 이카운트 명세서번호를 넣으세요')
  if (e.kind === 'planned') return addPlanned(cust, lines, meName)

  let poNo = s(e.po_no)
  if (!poNo) {
    const pre = `${TEMP_PREFIX[e.kind]}-${cust}-`
    const { data, error } = await supabase.from('pm_order').select('po_no').eq('customer_code', cust).like('po_no', `${pre}%`)
    if (error) throw error
    poNo = tempPoNo(e.kind, cust, (data || []).map((x) => x.po_no))
  }
  if (await loadOrderByNo(cust, poNo, custName)) throw new Error(`${custName ? custName + ' ' : ''}${poNo} 는 이미 수주대장에 있습니다 — 그 PO 를 열어 고치세요`)
  const extra = { kind: e.kind, slip_no: s(e.slip_no) || null, req_channel: e.req_channel || null, req_person: s(e.req_person) || null, po_due: e.po_due || null, ...(etc ? { customer_name: custName } : {}) }
  const po = { customer: cust, po_no: poNo, order_date: e.order_date || null, ship_to: s(e.ship_to) || null, currency: e.currency || (cust === 'AX' && e.ccn === 'B' ? 'USD' : 'KRW'), ccn: e.ccn || null, extra, headNote: s(e.note) || null }
  const ls = lines.map((l, i) => ({ ...l, line_no: String(l.line_no || i + 1), del_line: String(l.del_line || '1'), deliveredAll: false }))
  const r = await saveOrder({ po, lines: ls, existing: null, fileName: null, migrated: false, meName, source: 'manual' })
  return { ...r, po_no: poNo, kind: e.kind }
}

// 발주 예정 — 고객사의 「발주 예정」 머리 아래에 줄을 더한다 (없으면 머리를 만든다)
async function addPlanned(cust, lines, meName) {
  let { data: head, error } = await supabase.from('pm_order').select('id,po_no').eq('customer_code', cust).eq('planned', true).order('registered_at').limit(1).maybeSingle()
  if (error) throw error
  if (!head) {
    const ins = await supabase.from('pm_order').insert({ customer_code: cust, po_no: '발주 예정', planned: true, kind: 'planned', source: 'manual', currency: 'KRW', registered_name: meName || null }).select('id,po_no').single()
    if (ins.error) throw colHint(ins.error)
    head = ins.data
  }
  const { data: ex, error: e2 } = await supabase.from('pm_order_line').select('line_no').eq('order_id', head.id)
  if (e2) throw e2
  let next = Math.max(0, ...(ex || []).map((x) => parseInt(x.line_no, 10) || 0))
  const rows = lines.map((l) => {
    next += 10
    return {
      order_id: head.id, line_no: String(next).padStart(5, '0'), del_line: '1', item_id: l.item?.id || null, raw_pn: s(l.pn) || null, raw_desc: l.desc || null,
      rev: l.rev || null, qty: Number(l.qty) || 0, unit_price: l.price ?? null, due_date: l.due || null, note: l.note || null, plnd_no: l.plnd ? String(l.plnd) : null,
    }
  })
  const { error: e3 } = await supabase.from('pm_order_line').insert(rows)
  if (e3) throw e3
  await supabase.from('pm_order_change').insert(rows.map((r) => ({ order_id: head.id, line_key: `${r.line_no}/1`, field: 'line_add', before_val: null, after_val: `${r.raw_pn || ''} ×${r.qty}${r.plnd_no ? ` · Plnd ${r.plnd_no}` : ''} (직접 등록)`, source: 'manual', changed_name: meName || null })))
  logActivity('create', 'pm_order', head.po_no, `발주 예정 직접 등록 · 품목 ${rows.length}`, null, ORDER_CUSTOMERS[cust]?.name)
  return { id: head.id, created: false, lines: rows.length, po_no: head.po_no, kind: 'planned' }
}

// ── 줄 취소 · 되돌리기 ────────────────────────────────────
const codeOf = (l) => l.items?.std_code || l.raw_pn || l.raw_desc || ''
// 새 칸(SQL 전)이 없을 때 알아듣게
export const colHint = (e) => (/cancel_reason|cancelled_name|cancelled_at|slip_no|kind|po_due|req_channel|req_person|column/.test(e?.message || '') ? new Error('새 칸이 아직 없습니다 — 수주대장_직접등록_반영_261023.sql 을 먼저 실행하세요') : e)

export async function cancelLines(lines, reason, memo, meName) {
  if (!lines.length) throw new Error('취소할 줄을 고르세요')
  if (!CANCEL_REASONS.includes(reason)) throw new Error('취소 사유를 고르세요')
  if (!s(memo)) throw new Error('사유 내용을 적어 주세요')
  const done = lines.filter((l) => (+l.delivered_qty || 0) > 0)
  if (done.length) throw new Error(`납품이 있는 줄은 취소할 수 없습니다 (${done.map((l) => lineKey(l)).join(', ')})`)
  const t = now()
  const text = `${reason} — ${s(memo)}`
  const patch = { cancelled: true, cancel_reason: text, cancelled_name: meName || null, cancelled_at: t, updated_at: t }
  const ids = lines.map((l) => l.id)
  const { error } = await supabase.from('pm_order_line').update(patch).in('id', ids)
  if (error) throw colHint(error)
  const logs = lines.map((l) => ({ order_id: l.order_id, line_key: lineKey(l), field: 'line_del', before_val: `${codeOf(l)} ×${+l.qty}`, after_val: `취소 — ${text}`, source: 'manual', changed_name: meName || null }))
  const { error: e2 } = await supabase.from('pm_order_change').insert(logs)
  if (e2) throw e2
  logActivity('update', 'pm_order', [...new Set(lines.map((l) => l.o?.po_no).filter(Boolean))].join(', ') || null, `줄 취소 ${lines.length}품목 · ${text}`, null, null)
  return { ids, patch }
}

export async function uncancelLines(lines, meName) {
  if (!lines.length) throw new Error('되돌릴 줄을 고르세요')
  const t = now()
  const patch = { cancelled: false, cancel_reason: null, cancelled_name: null, cancelled_at: null, updated_at: t }
  const { error } = await supabase.from('pm_order_line').update(patch).in('id', lines.map((l) => l.id))
  if (error) throw colHint(error)
  const { error: e2 } = await supabase.from('pm_order_change').insert(lines.map((l) => ({ order_id: l.order_id, line_key: lineKey(l), field: 'revive', before_val: l.cancel_reason || '취소', after_val: '취소 되돌림', source: 'manual', changed_name: meName || null })))
  if (e2) throw e2
  return { ids: lines.map((l) => l.id), patch }
}

// ── 정식 PO 번호로 바꾸기 · 명세서번호 ─────────────────────
export async function promotePo(o, newNo, meName) {
  const no = s(newNo)
  if (!no) throw new Error('정식 PO 번호를 넣으세요')
  if (no === o.po_no) throw new Error('지금 번호와 같습니다')
  const dup = await loadOrderByNo(o.customer_code, no, o.customer_name)
  if (dup) throw new Error(`${no} 는 이미 수주대장에 있습니다 (발주서 PDF 로 먼저 등록됨) — 이 임시 PO 의 줄은 「새 PO 로 재발행」으로 취소하세요`)
  const before = `${o.po_no} (${KINDS[kindOf(o)]})`
  const patch = { po_no: no, kind: 'po', updated_at: now() }
  const { error } = await supabase.from('pm_order').update(patch).eq('id', o.id)
  if (error) throw colHint(error)
  await supabase.from('pm_order_change').insert({ order_id: o.id, line_key: null, field: 'po_no', before_val: before, after_val: `${no} (정식 PO)`, source: 'manual', changed_name: meName || null })
  logActivity('update', 'pm_order', no, `${before} → 정식 PO ${no}`, null, orderCustName(o))
  return { id: o.id, patch }
}

export async function setSlipNo(o, slip, meName) {
  const v = s(slip) || null
  const was = o.slip_no || null
  if (was === v) return { id: o.id, patch: {} }
  const patch = { slip_no: v, updated_at: now() }
  const { error } = await supabase.from('pm_order').update(patch).eq('id', o.id)
  if (error) throw colHint(error)
  await supabase.from('pm_order_change').insert({ order_id: o.id, line_key: null, field: 'slip_no', before_val: was, after_val: v, source: 'manual', changed_name: meName || null })
  return { id: o.id, patch }
}
