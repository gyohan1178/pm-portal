// 입고 현황 → 이카운트 「구매입력」 엑셀 업로드 양식 (Template_19 — 21칸, 2026-10-29)
//   같은 입고일 · 같은 구매처 · 같은 프로젝트 = 전표 1장(같은 순번)
//   ⚠ 이카운트 엑셀 업로드에는 발주서 연결 칸이 없다 — 이카운트 발주서 잔량은 이카운트에서 직접 정리
//   고정값은 「이카운트 발주서 내려받기」(PurchasePage)와 같게: 담당자 = 내려받는 사람, 입고창고 00009
//   프로젝트: AXCELIS 00012 · 그 밖의 고객사 00005 (사용자 확인 2026-10-29)

export const PURCHASE_HEAD = ['일자', '순번', '거래처코드', '거래처명', '담당자', '통화', '환율', '입고창고', '거래유형', '프로젝트', '메모',
  '품목코드', '품목명', '규격명', '수량', '단가', '단가\n\n(VAT포함)', '외화금액', '공급가액', '부가세', '적요']
export const ECOUNT_WH = '00009'
export const ecountProject = (custCode) => (/^ax$/i.test(String(custCode || '').trim()) ? '00012' : '00005')

const s = (v) => (v == null ? '' : String(v).trim())
const clip = (v, n) => { const t = s(v); return t.length > n ? t.slice(0, n) : t }

// 규격 = 제조사 제조사품번 (+ 가공물 REV) — 실제 산 것(발주 줄 값)이 먼저, 없으면 품목 값
export function purchaseSpec(r) {
  const po = r.purchase_orders || {}, it = r.items || {}
  const mfr = s(po.mfr) || s(it.manufacturer), mpn = s(po.mfr_code) || s(it.manufacturer_code)
  const base = [mfr, mpn].filter(Boolean).join(' ')
  const rev = s(po.item_rev)
  return clip(rev && !/\bREV\b/i.test(base) ? [base, `REV ${rev}`].filter(Boolean).join(' ') : base, 100)
}

// rows: 입고 현황 줄 (fetchInboundHistory 결과) · custCodeOf(customer_id) → 'ax' 등
// 돌려줌: { slips:[{ seq, date, vendorName, vendorCode, project, custCode, lines:[{ r, code, name, spec, qty, price, supply, vat, po }], supply, vat }],
//           issues:[{ id, kind, msg }], aoa }
export function buildPurchase(rows, { custCodeOf = () => '', staff = '' } = {}) {
  const issues = []
  const groups = new Map()
  for (const r of rows) {
    const po = r.purchase_orders || null
    const v = po?.vendors || null
    const custCode = custCodeOf(po?.customer_id || r.customer_id) || ''
    const project = ecountProject(custCode)
    const date = s(r.movement_date)
    const vkey = po?.vendor_id || (v?.name ? 'n:' + v.name : '')
    const key = `${date}|${vkey}|${project}`
    if (!groups.has(key)) groups.set(key, { date, vendorName: s(v?.name), vendorCode: s(v?.ecount_code), project, custCode, lines: [] })
    const qty = Number(r.qty) || 0, price = Number(r.unit_price) || 0
    const supply = Math.round(qty * price), vat = Math.round(supply * 0.1)
    groups.get(key).lines.push({ r, code: s(r.items?.std_code), name: clip(r.items?.name, 100), spec: purchaseSpec(r), qty, price, supply, vat, po: s(po?.po_number) })
    const tag = `${date} · ${s(r.items?.std_code) || '-'}`
    if (!r.po_id) issues.push({ id: r.id, kind: 'nopo', msg: `${tag} — 발주외 입고라 구매처가 없음 → 거래처 칸 비움 (이카운트에서 고르기)` })
    else if (!s(v?.ecount_code)) issues.push({ id: r.id, kind: 'nocode', msg: `${tag} — ${s(v?.name) || '구매처'} 이카운트 거래처코드 없음 → 거래처명만 넣음 (이카운트가 이름으로 찾음)` })
    if (!price) issues.push({ id: r.id, kind: 'noprice', msg: `${tag} — 단가 0 → 공급가 0 으로 들어감` })
    if (!s(r.items?.std_code)) issues.push({ id: r.id, kind: 'noitem', msg: `${date} · ${s(r.items?.name) || '품목'} — 기준코드 없음 → 품목명만 넣음` })
    const fx = s(po?.fx_currency).toUpperCase()
    if (fx && fx !== 'KRW') issues.push({ id: r.id, kind: 'fx', msg: `${tag} — 외화(${fx}) 발주 → 원화 단가로 넣음, 이카운트에서 확인` })
  }
  const slips = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.vendorName.localeCompare(b.vendorName, 'ko') || a.project.localeCompare(b.project))
  slips.forEach((g, i) => {
    g.seq = i + 1
    g.lines.sort((a, b) => a.code.localeCompare(b.code))
    g.supply = g.lines.reduce((t, l) => t + l.supply, 0)
    g.vat = g.lines.reduce((t, l) => t + l.vat, 0)
    g.memo = clip([...new Set(g.lines.map((l) => s(l.r.memo)).filter(Boolean))].join(' / '), 200)
  })
  const aoa = [PURCHASE_HEAD]
  for (const g of slips) {
    for (const l of g.lines) {
      const row = {
        일자: g.date.replace(/-/g, ''), 순번: String(g.seq), 거래처코드: g.vendorCode, 거래처명: g.vendorCode ? '' : g.vendorName,
        담당자: staff, 통화: '', 환율: '', 입고창고: ECOUNT_WH, 거래유형: '', 프로젝트: g.project, 메모: g.memo,
        품목코드: l.code, 품목명: l.name, 규격명: l.spec,   // 품목명도 넣음 — 발주서 내려받기와 같게 (이카운트는 코드로 찾음)
        수량: l.qty, 단가: l.price, '단가\n\n(VAT포함)': '', 외화금액: '', 공급가액: l.supply, 부가세: l.vat, 적요: clip(l.po, 200),
      }
      aoa.push(PURCHASE_HEAD.map((h) => row[h]))
    }
  }
  return { slips, issues, aoa }
}

// 엑셀 — 모든 칸을 글자로 (00009 · 00022 앞자리 0 보존 — 발주서 내려받기와 같은 방식)
export function purchaseWorkbook(XLSX, aoa) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell) { cell.t = 's'; cell.v = cell.v == null ? '' : String(cell.v); cell.z = '@' }
    }
  }
  ws['!cols'] = PURCHASE_HEAD.map((h) => ({ wch: ['품목명', '규격명', '메모'].includes(h) ? 28 : 12 }))
  XLSX.utils.book_append_sheet(wb, ws, '구매입력')
  return wb
}
