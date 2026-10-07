// CSK 생산 일정표 → 생산관리 (2026-10-07)
//
//   CSK 가 주는 「생산 Schedule」 엑셀(생산_Schedule 시트)을 그대로 올리면 생산관리에 한 줄씩 나열된다.
//   머리글도 그 파일에 맞춘다:
//     NO/ · 구분 · 관리번호 · 발주 번호 · ITEM NO. · 규격 · Plnd order number · Prod order number · Q'TY ·
//     PRE ASSY 품번 · 품번 · 품명 · 발주일자 · 입고 요청일 · 납품 예정일 · 납품 완료일 · 회계 · 비고 ·
//     자재 반출일 · Option · 비고1 · 지난주 일정 · 변경 후 일정 · 변경 현황
//   한 줄의 열쇠 = 관리번호(JS2609-18). 생산관리에서는 호기 칸에 들어간다.
//   파일 값은 production.csk(jsonb)에 통째로 담는다 — 사람이 넣는 값(상태 · 메모 · 담당자)은 따로라 덮이지 않는다.
//   다시 올리면: 같은 관리번호는 파일 값만 갱신 · 새 관리번호는 새 줄 · 파일에서 빠진 줄은 지우지 않고 표시만.
const s = (v) => (v == null ? '' : String(v).trim())
const norm = (v) => s(v).replace(/\s+/g, '').toLowerCase()
const p2 = (n) => String(n).padStart(2, '0')
export const ymdOf = (v) => {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    // 엑셀 날짜가 시간대 때문에 전날 밤으로 읽히는 것을 막는다 (정오 보정)
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
  }
  const m = s(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${p2(m[2])}-${p2(m[3])}` : null
}

// 파일 머리글 → 담는 이름. 화면 열 순서도 이 순서다.
export const CSK_COLS = [
  ['no',       'NO/',               ['no/', 'no', 'no.']],
  ['gubun',    '구분',              ['구분']],
  ['mgmt',     '관리번호',          ['관리번호']],
  ['po_no',    '발주 번호',         ['발주번호']],
  ['item_no',  'ITEM NO.',          ['itemno.', 'itemno']],
  ['spec',     '규격',              ['규격']],
  ['plnd',     'Plnd order number', ['plndordernumber']],
  ['prod',     'Prod order number', ['prodordernumber']],
  ['qty',      "Q'TY",              ["q'ty", 'qty', '수량']],
  ['pre_assy', 'PRE ASSY 품번',     ['preassy품번']],
  ['pn',       '품번',              ['품번']],
  ['name',     '품명',              ['품명']],
  ['order_date', '발주일자',        ['발주일자']],
  ['in_req',   '입고 요청일',       ['입고요청일']],
  ['due',      '납품 예정일',       ['납품예정일']],
  ['done',     '납품 완료일',       ['납품완료일']],
  ['acct',     '회계',              ['회계']],
  ['memo',     '비고',              ['비고']],
  ['mat_out',  '자재 반출일',       ['자재반출일']],
  ['option',   'Option',            ['option']],
  ['memo1',    '비고1',             ['비고1']],
  ['prev',     '지난주 일정',       ['지난주일정']],
  ['next',     '변경 후 일정',      ['변경후일정']],
  ['chg',      '변경 현황',         ['변경현황']],
]
const DATE_KEYS = new Set(['order_date', 'in_req', 'due', 'done', 'mat_out', 'prev', 'next'])
export const CSK_LABEL = Object.fromEntries(CSK_COLS.map(([k, l]) => [k, l]))

// 워크북에서 일정 시트를 찾아 읽는다. 「지난주」 시트는 읽지 않는다.
export function parseCskSchedule(XLSX, wb) {
  const names = wb.SheetNames || []
  const pick = names.find((n) => /schedule/i.test(n) && !/지난/.test(n)) || names.find((n) => !/지난/.test(n))
  if (!pick) return { rows: [], error: '시트를 찾지 못했습니다' }
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[pick], { header: 1, defval: '', raw: true })
  // 머리글 줄 — 「관리번호」와 「규격」이 같이 있는 줄
  const hi = aoa.findIndex((r) => { const n = (r || []).map(norm); return n.includes('관리번호') && n.includes('규격') })
  if (hi < 0) return { rows: [], sheet: pick, error: `[${pick}] 시트에서 머리글(관리번호 · 규격)을 찾지 못했습니다` }
  const head = aoa[hi].map(norm)
  const used = new Set(), col = {}
  for (const [key, , alts] of CSK_COLS) {
    // 같은 이름이 두 번 나오면(비고 · 비고1) 앞에서부터 안 쓴 칸을 잡는다
    const i = head.findIndex((h, idx) => !used.has(idx) && alts.includes(h))
    if (i >= 0) { col[key] = i; used.add(i) }
  }
  if (col.memo == null && col.memo1 != null) {
    // 「비고1」이 두 번인 양식 — 앞의 것이 비고
    const j = head.findIndex((h, idx) => idx !== col.memo1 && h === '비고1')
    if (j >= 0) { col.memo = Math.min(j, col.memo1); col.memo1 = Math.max(j, col.memo1) }
  }
  // 파일 기준일 — 머리글 위 줄의 날짜
  let fileDate = null
  for (const r of aoa.slice(0, hi)) for (const c of r || []) { const d = ymdOf(c); if (d && !fileDate && (c instanceof Date || typeof c === 'number')) fileDate = d }
  const rows = [], skipped = [], seen = new Set()
  aoa.slice(hi + 1).forEach((r, i) => {
    const get = (k) => (col[k] == null ? '' : r[col[k]])
    const mgmt = s(get('mgmt')), spec = s(get('spec'))
    if (!mgmt && !spec) return
    if (!mgmt) { skipped.push(`${hi + 2 + i}행: 관리번호 없음 (${spec})`); return }
    if (seen.has(mgmt)) { skipped.push(`${hi + 2 + i}행: 관리번호 ${mgmt} 가 두 번`); return }
    seen.add(mgmt)
    const o = {}
    for (const [key] of CSK_COLS) {
      const v = get(key)
      if (DATE_KEYS.has(key)) o[key] = ymdOf(v)
      else {
        const t = v instanceof Date ? ymdOf(v) : s(v)
        o[key] = t === '#N/A' ? '' : t.replace(/\.0$/, '')
      }
    }
    o.option = s(get('option')).replace(/\r/g, '')
    rows.push(o)
  })
  return { rows, skipped, sheet: pick, fileDate, missing: CSK_COLS.filter(([k]) => col[k] == null).map(([, l]) => l) }
}

// 발주가 났는가 — 발주 번호가 「발주 예정」이 아니고 값이 있을 때
export const cskOrdered = (c) => !!s(c?.po_no) && !/예정/.test(s(c?.po_no))
// Option 줄 수 — 「1 …\n2 …」
export const optionLines = (t) => s(t).split('\n').map((x) => x.replace(/\t/g, ' ').trim()).filter(Boolean)

// 생산관리 한 줄로 — 파일 값 → 공통 칸
export const toProdRow = (c, fileDate) => ({
  mgmt: c.mgmt,
  pn: c.spec || c.pn || c.mgmt,
  name: c.name || c.spec || '',
  part: c.gubun || null,
  req_date: c.due || c.in_req || '',
  po_received: cskOrdered(c),
  done: !!c.done,
  csk: { ...c, file_date: fileDate || null },
})

const CMP_KEYS = CSK_COLS.map(([k]) => k)
// 무엇이 바뀌는지 미리 센다 (반영 전 확인 창)
export function planCsk(fileRows, existing, fileDate) {
  const byMgmt = new Map()
  ;(existing || []).forEach((r) => { if (s(r.hogi)) byMgmt.set(s(r.hogi), r) })
  const ins = [], upd = [], same = [], dueChg = []
  const inFile = new Set()
  for (const c of fileRows) {
    inFile.add(c.mgmt)
    const row = toProdRow(c, fileDate)
    const ex = byMgmt.get(c.mgmt)
    if (!ex) { ins.push(row); continue }
    const old = ex.csk || {}
    const diff = CMP_KEYS.filter((k) => s(old[k]) !== s(c[k]))
    if (!diff.length && !old.gone && s(ex.req_date) === s(row.req_date)) { same.push(row); continue }
    if (s(ex.req_date) && s(ex.req_date) !== s(row.req_date)) dueChg.push({ mgmt: c.mgmt, from: ex.req_date, to: row.req_date })
    upd.push({ ...row, id: ex.id, diff })
  }
  // 예전에 일정표로 들어온 줄인데 이번 파일에 없는 것 (끝난 줄은 빼고)
  const gone = (existing || []).filter((r) => r.csk && !r.csk.gone && r.status !== '완료' && !inFile.has(s(r.hogi)))
  return { ins, upd, same, dueChg, gone, goneIds: gone.map((r) => r.id), rows: [...ins, ...upd.map(({ diff, id, ...x }) => x)] }
}
export const planText = (p) => [
  `새 줄 ${p.ins.length}`,
  `바뀐 줄 ${p.upd.length}${p.dueChg.length ? ` (납품 예정일 변경 ${p.dueChg.length})` : ''}`,
  `그대로 ${p.same.length}`,
  p.gone.length ? `이번 일정표에서 빠진 줄 ${p.gone.length} — 지우지 않고 표시만` : '',
].filter(Boolean).join('\n')

export async function applyCsk(supabase, plan) {
  const { data, error } = await supabase.rpc('pm_csk_schedule_apply', { p_rows: plan.rows, p_gone: plan.goneIds || [] })
  if (error) {
    if (/pm_csk_schedule_apply|schema cache|Could not find|column .*csk/i.test(error.message || ''))
      throw new Error('SQL pm_csk_schedule_261007 을 먼저 실행하세요')
    throw error
  }
  return (Array.isArray(data) ? data[0] : data) || {}
}
