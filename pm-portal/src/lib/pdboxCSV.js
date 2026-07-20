// ─────────────────────────────────────────────────────────────
// PD BOX CSV 입출력 — 명세 5·6 (AXCELIS v30.6 pbExportCSV / pbImportCSV)
// 미불출 다중행 전개/병합, 품번+호기 upsert
// ─────────────────────────────────────────────────────────────

// 5-1. 컬럼 순서 (고정)
const BASE_COLS = [
  'name', 'pn', 'hogi', 'ccn', 'rev', 'status', 'po_received',
  'req_date', 'machine_date', 'arrival_date',
  'harness_issue', 'harness_done', 'part_issue', 'elec_done',
  'quality_req', 'elec_start',
  'note', 'manager', 'updated_at',
]
const MP_COLS = ['미불출품번', '미불출수량', '입고예정일', '비고']
const HEADER = [...BASE_COLS, ...MP_COLS]

// 5-2. 값 변환
function cellVal(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Y' : ''
  return String(v)
}
function csvEscape(s) { return `"${String(s).replace(/"/g, '""')}"` }

// ── EXPORT ──
export function exportPDBoxCSV(rows, csCode) {
  const lines = [HEADER.map(csvEscape).join(',')]

  for (const r of rows) {
    const base = BASE_COLS.map(c => {
      let v = r[c]
      if ((c === 'updated_at' || c === 'created_at') && v) v = String(v).slice(0, 10)
      return cellVal(v)
    })
    const mp = Array.isArray(r.missing_parts) ? r.missing_parts : []
    // 5-3. 미불출 다중 행 전개
    if (mp.length === 0) {
      lines.push([...base, '', '', '', ''].map(csvEscape).join(','))
    } else {
      for (const m of mp) {
        lines.push([...base, cellVal(m.pn), cellVal(m.qty), cellVal(m.expectedDate), cellVal(m.note)].map(csvEscape).join(','))
      }
    }
  }

  // 5-4. UTF-8 BOM
  const csv = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `PDBOX_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── IMPORT ──
// 간단 CSV 파서 (따옴표 처리)
function parseCSV(text) {
  const rows = []
  let row = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else inQ = false }
      else cell += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === ',') { row.push(cell); cell = '' }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
      else cell += ch
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// 헤더 매칭 (한/영, 소문자)
function colIndex(headers, candidates) {
  const low = headers.map(h => h.toLowerCase().trim())
  for (const c of candidates) { const i = low.indexOf(c.toLowerCase()); if (i !== -1) return i }
  return -1
}

// 6-4. SCHED_FIELDS (갱신 대상)
const SCHED_FIELDS = ['status', 'req_date', 'machine_date', 'arrival_date', 'harness_issue', 'harness_done', 'part_issue', 'elec_done', 'note', 'manager', 'po_received', 'ccn', 'rev', 'missing_parts']

// CSV 텍스트 → 레코드 배열 (미불출 병합)
export function parsePDBoxCSV(text) {
  const grid = parseCSV(text.replace(/^\uFEFF/, ''))
  if (grid.length < 2) return []
  const headers = grid[0]
  const idx = {
    name: colIndex(headers, ['name', 'pd명', '품명']),
    pn: colIndex(headers, ['pn', '품번']),
    hogi: colIndex(headers, ['hogi', '호기']),
    ccn: colIndex(headers, ['ccn']),
    rev: colIndex(headers, ['rev']),
    status: colIndex(headers, ['status', '상태']),
    po_received: colIndex(headers, ['po_received', 'poreceived']),
    req_date: colIndex(headers, ['req_date', 'reqdate', '납품일', '납품요청일']),
    machine_date: colIndex(headers, ['machine_date', 'machinedate', '가공발주일']),
    arrival_date: colIndex(headers, ['arrival_date', 'arrivaldate', '입고예정일']),
    harness_issue: colIndex(headers, ['harness_issue', 'harnessissue', '하네스불출']),
    harness_done: colIndex(headers, ['harness_done', 'harnessdone', '하네스완료예정']),
    part_issue: colIndex(headers, ['part_issue', 'partissue', '전장불출']),
    elec_done: colIndex(headers, ['elec_done', 'elecdone', '전장완료요청', '전장완료예정일']),
    note: colIndex(headers, ['note', '비고']),
    manager: colIndex(headers, ['manager', '담당자']),
    mp_pn: colIndex(headers, ['미불출품번']),
    mp_qty: colIndex(headers, ['미불출수량']),
    mp_date: colIndex(headers, ['입고예정일']),   // 미불출용 (주의: arrival과 다름 — 끝쪽)
    mp_note: colIndex(headers, ['비고']),
  }

  const get = (row, key) => idx[key] >= 0 ? (row[idx[key]] || '').trim() : ''
  const records = []
  let prev = null

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i]
    if (!row || row.every(c => !c?.trim())) continue
    const pn = get(row, 'pn'), hogi = get(row, 'hogi'), name = get(row, 'name')
    const mpPn = idx.mp_pn >= 0 ? (row[idx.mp_pn] || '').trim() : ''

    // 6-2. 미불출만 있는 행(품번/호기/이름 없음) → 직전 레코드에 붙임
    if (!pn && !hogi && !name && mpPn && prev) {
      prev.missing_parts.push({
        pn: mpPn,
        qty: idx.mp_qty >= 0 ? row[idx.mp_qty]?.trim() : '',
        expectedDate: idx.mp_date >= 0 ? row[idx.mp_date]?.trim() : '',
        note: idx.mp_note >= 0 ? row[idx.mp_note]?.trim() : '',
      })
      continue
    }

    // 같은 품번+호기 연속 → 직전에 미불출만 추가
    if (prev && prev.pn === pn && prev.hogi === hogi && mpPn) {
      prev.missing_parts.push({
        pn: mpPn,
        qty: idx.mp_qty >= 0 ? row[idx.mp_qty]?.trim() : '',
        expectedDate: idx.mp_date >= 0 ? row[idx.mp_date]?.trim() : '',
        note: idx.mp_note >= 0 ? row[idx.mp_note]?.trim() : '',
      })
      continue
    }

    const boolY = (v) => v === 'Y' || v === 'y' || v === 'true' || v === '완료'
    const rec = {
      name, pn, hogi,
      ccn: get(row, 'ccn'), rev: get(row, 'rev'),
      status: get(row, 'status') || 'PO접수',
      po_received: idx.po_received >= 0 ? boolY(get(row, 'po_received')) : true,
      req_date: get(row, 'req_date'), machine_date: get(row, 'machine_date'),
      arrival_date: get(row, 'arrival_date'),
      harness_issue: get(row, 'harness_issue'), harness_done: get(row, 'harness_done'),
      part_issue: get(row, 'part_issue'), elec_done: get(row, 'elec_done'),
      note: get(row, 'note'),
      manager: get(row, 'manager'),
      missing_parts: [],
    }
    if (mpPn) rec.missing_parts.push({
      pn: mpPn,
      qty: idx.mp_qty >= 0 ? row[idx.mp_qty]?.trim() : '',
      expectedDate: idx.mp_date >= 0 ? row[idx.mp_date]?.trim() : '',
      note: idx.mp_note >= 0 ? row[idx.mp_note]?.trim() : '',
    })
    records.push(rec)
    prev = rec
  }
  return records
}

export { SCHED_FIELDS }
