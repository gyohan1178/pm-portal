// ecount 매입 내역 파서
//
// 두 가지 형태를 모두 받는다.
//   ① 연간 통합 파일 — 'N월 매입' 시트가 12개
//   ② 주간 다운로드   — 매입 시트 1개
// 어느 쪽이든 시트 안 구조는 같다.
//   상단 요약 블록(에드워드/VM/... 총 매입) → 빈 줄 → 헤더 → 상세
//
// 헤더: 구매번호 | 거래처 | 품 목 | 수량 | 공급가액 | 부가세 | 금액합계 | 메모 | 담당자명 | 고객사

export const CUSTOMERS = ['에드워드', 'VM', 'CSK', '엑셀리스', '하네스', '기타']

// 예상매입까지 관리하는 고객사 (구매자재팀 소관)
export const FORECAST_CUSTOMERS = ['에드워드', 'VM', 'CSK', '엑셀리스']

// 구 분류값 → 신 분류값. 외주업체·잡자재는 기타로 흡수한다.
const CUSTOMER_ALIAS = {
  '외주업체': '기타', '잡자재': '기타', '기타': '기타',
  '에드워드': '에드워드', 'edwards': '에드워드',
  'vm': 'VM',
  'csk': 'CSK',
  '엑셀리스': '엑셀리스', 'axcelis': '엑셀리스', '액셀리스': '엑셀리스',
  '하네스': '하네스',
}

// 담당자 + 메모로 고객사를 자동 분류한다.
// ecount 파일에 '고객사' 열이 없을 때 이 규칙으로 채운다.
//   김교한                → 엑셀리스
//   황주현·문순옥·박웅진   → 에드워드
//   남기문 → 메모 csk 있으면 CSK / vm·em·ex·ep 있으면 VM / 나머지 기타
//   윤여민·황동일          → 하네스
//   그 외                  → 기타
export function classifyByManager(manager, memo) {
  const name = String(manager || '').replace(/\s*(차장|과장|대리|주임|부장|이사|사원|팀장|실장|대표)\s*/g, '').trim()
  const m = String(memo || '').toLowerCase()
  if (!name) return '기타'   // 담당자 없는 절사·NEGO 등은 기타
  if (name.includes('김교한')) return '엑셀리스'
  if (['황주현', '문순옥', '박웅진'].includes(name)) return '에드워드'
  if (name.includes('남기문')) {
    if (m.includes('csk')) return 'CSK'
    if (/vm|em|ex|ep/.test(m)) return 'VM'
    return '기타'
  }
  if (['윤여민', '황동일'].includes(name)) return '하네스'
  return '기타'
}

export function normCustomer(v) {
  const k = String(v ?? '').trim()
  if (!k) return null
  return CUSTOMER_ALIAS[k] || CUSTOMER_ALIAS[k.toLowerCase()] || null
}

const num = (v) => {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

// '2026/07/24 -8' → '2026-07-24'
export function dateFromPurchaseNo(no) {
  const m = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(String(no || ''))
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * 시트 배열(sheet_to_json header:1 결과) 하나를 파싱
 * @returns { rows, skipped }
 */
function parseSheet(aoa, sheetName, fileName) {
  // 헤더 행 찾기 — 요약 블록을 건너뛰기 위해 이름으로 탐색
  const hi = aoa.findIndex((r) =>
    r.some((c) => String(c).replace(/\s/g, '') === '구매번호'))
  if (hi < 0) return { rows: [], skipped: 0, noHeader: true }

  const headers = aoa[hi].map((h) => String(h ?? '').replace(/\s/g, '').trim())
  const find = (...names) => {
    for (const n of names) {
      const i = headers.findIndex((h) => h === n)
      if (i >= 0) return i
    }
    for (const n of names) {
      const i = headers.findIndex((h) => h.includes(n))
      if (i >= 0) return i
    }
    return -1
  }

  const ix = {
    no:       find('구매번호'),
    vendor:   find('거래처'),
    item:     find('품목'),
    qty:      find('수량'),
    supply:   find('공급가액'),
    vat:      find('부가세'),
    total:    find('금액합계', '합계금액'),
    memo:     find('메모'),
    manager:  find('담당자명', '담당자'),
    customer: find('고객사', '구분'),
  }

  const rows = []
  let skipped = 0
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i]
    const no = String(r[ix.no] ?? '').trim()
    if (!no) continue
    const purchase_date = dateFromPurchaseNo(no)
    if (!purchase_date) { skipped++; continue }

    const supply = num(r[ix.supply])
    const vat = num(r[ix.vat])
    const total = num(r[ix.total]) || supply + vat

    rows.push({
      purchase_no:   no,
      purchase_date,
      year:  Number(purchase_date.slice(0, 4)),
      month: Number(purchase_date.slice(5, 7)),
      vendor:    String(r[ix.vendor] ?? '').trim() || null,
      item_desc: String(r[ix.item] ?? '').trim() || null,
      qty:       num(r[ix.qty]),
      supply_amt: supply,
      vat,
      total_amt:  total,
      memo:      String(r[ix.memo] ?? '').trim() || null,
      manager:   String(r[ix.manager] ?? '').trim() || null,
      // 고객사 열이 있으면 그 값을, 없으면 담당자+메모 규칙으로 자동 분류
      customer:  ix.customer >= 0
        ? normCustomer(r[ix.customer])
        : classifyByManager(r[ix.manager], r[ix.memo]),
      source_file: fileName || null,
      _sheet: sheetName,
    })
  }
  return { rows, skipped, hasCustomerCol: ix.customer >= 0 }
}

/**
 * 워크북 전체 파싱. '매입' 이 들어간 시트만 읽는다.
 * @param wb  XLSX.read 결과
 * @returns { rows, sheets, skipped, hasCustomerCol, dupInFile }
 */
export function parseEcountWorkbook(wb, XLSX, fileName) {
  const targets = wb.SheetNames.filter((n) => n.includes('매입'))
  const sheetNames = targets.length ? targets : wb.SheetNames

  const all = []
  const sheets = []
  let skipped = 0
  let hasCustomerCol = false

  for (const name of sheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
    const res = parseSheet(aoa, name, fileName)
    if (res.noHeader) continue
    if (res.hasCustomerCol) hasCustomerCol = true
    skipped += res.skipped
    if (res.rows.length) {
      sheets.push({ name, count: res.rows.length, amount: res.rows.reduce((a, r) => a + r.supply_amt, 0) })
      all.push(...res.rows)
    }
  }

  // 파일 안에서의 중복 (같은 구매번호가 여러 시트에 있는 경우) — 뒤엣것을 남긴다
  const seen = new Map()
  for (const r of all) seen.set(r.purchase_no, r)
  const rows = [...seen.values()]

  return {
    rows,
    sheets,
    skipped,
    hasCustomerCol,
    dupInFile: all.length - rows.length,
  }
}

export function summarize(rows) {
  const byCustomer = {}
  let supply = 0, total = 0, unclassified = 0
  for (const r of rows) {
    const k = r.customer || '미분류'
    if (!byCustomer[k]) byCustomer[k] = { cnt: 0, supply: 0, total: 0 }
    byCustomer[k].cnt += 1
    byCustomer[k].supply += r.supply_amt
    byCustomer[k].total += r.total_amt
    supply += r.supply_amt
    total += r.total_amt
    if (!r.customer) unclassified += 1
  }
  const dates = rows.map((r) => r.purchase_date).filter(Boolean).sort()
  return {
    count: rows.length, supply, total, unclassified, byCustomer,
    from: dates[0] || null, to: dates[dates.length - 1] || null,
  }
}
