// BOM 올리기 · 내려받기 엑셀 양식 (v4.237.0 · v4.238.0)
//   필수 칸(상위PN · NO · LEVEL · PN · Description · MFG · MFG PN · QTY · UNIT)은 노란 음영
//   선택 칸(Category · 관리대상 · REV)은 음영 없음 · 실수량은 자동 계산(회색)
//   ⚠ DB 에는 QTY(바로 위 상위 1개당)를 넣는다. 실수량 = QTY × 위 LEVEL 들의 QTY — 출고 · 부족자재가 같은 규칙으로 곱해 올린다
//     (실수량을 DB 에 넣으면 한 번 더 곱해져 2중 계산이 된다)
export const BOM_HEADERS = ['상위PN', 'NO', 'LEVEL', 'Category', 'PN', 'Description', 'MFG', 'MFG PN', 'QTY', '실수량', '관리대상', 'UNIT', 'REV']
export const BOM_REQUIRED = ['상위PN', 'NO', 'LEVEL', 'PN', 'Description', 'MFG', 'MFG PN', 'QTY', 'UNIT']
const REQ = new Set(BOM_REQUIRED)
const AUTO = '실수량'
const WIDTH = { 상위PN: 14, NO: 6, LEVEL: 7, Category: 12, PN: 16, Description: 40, MFG: 18, 'MFG PN': 22, QTY: 8, 실수량: 9, 관리대상: 9, UNIT: 8, REV: 6 }

const cell = (r, keys) => { for (const k of keys) { const v = r?.[k]; if (v != null && String(v).trim() !== '') return v } return '' }
const num = (v) => { const n = parseFloat(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0 }
export const bomQtyOf = (r) => num(cell(r, ['QTY', '수량', '실수량']))   // 실수량만 있는 예전 파일은 그 값을 QTY 로
export const bomLevelOf = (r) => parseInt(cell(r, ['LEVEL', 'LV'])) || 1
const round = (n) => Math.round(n * 10000) / 10000

// 실수량 계산 — 상위PN 마다 파일 순서대로: 실수량 = QTY × 바로 위 LEVEL 줄의 실수량 (LEVEL 1 은 QTY 그대로)
//   rows: 엑셀 줄 객체 · 돌려줌: 같은 순서의 실수량 배열
export function calcEffQty(rows, parentOf = (r) => String(cell(r, ['상위PN', '상위품번'])).trim()) {
  const stacks = {}
  return (rows || []).map((r) => {
    const p = parentOf(r)
    const st = (stacks[p] ||= [])
    const lv = bomLevelOf(r)
    while (st.length && st[st.length - 1].lv >= lv) st.pop()
    const eff = round(bomQtyOf(r) * (st.length ? st[st.length - 1].eff : 1))
    st.push({ lv, eff })
    return eff
  })
}
// 필수 칸이 빈 줄 수 — 미리보기 경고용 (막지는 않는다)
export function missingRequired(rows) {
  const miss = {}
  ;(rows || []).forEach((r) => BOM_REQUIRED.forEach((h) => {
    const keys = h === '상위PN' ? ['상위PN', '상위품번'] : h === 'PN' ? ['PN', '하위품번'] : h === 'QTY' ? ['QTY', '수량'] : h === 'LEVEL' ? ['LEVEL', 'LV'] : [h]
    if (String(cell(r, keys)).trim() === '') miss[h] = (miss[h] || 0) + 1
  }))
  return miss
}

const SAMPLE = [
  { 상위PN: '1600791', NO: 1, LEVEL: 1, Category: '부품', PN: '750000580', Description: 'TUBING HEAT SHRINK 3/4', MFG: 'ALPHAWIRE', 'MFG PN': 'FIT-221-3/4-CL', QTY: 0.5, 관리대상: 'N', UNIT: 'M', REV: 'A' },
  { 상위PN: '1600791', NO: 2, LEVEL: 1, Category: '부품', PN: '510002080', Description: 'CONN LUG STRAIGHT 6 1/4', MFG: 'JEONO', 'MFG PN': 'JOCO0102-SS06', QTY: 2, 관리대상: 'N', UNIT: 'Each', REV: 'A' },
  { 상위PN: '1600791', NO: 3, LEVEL: 1, Category: '하위ASSY', PN: '1600800', Description: 'SUB ASSY CABLE', MFG: 'JINSUNTECH', 'MFG PN': '1600800', QTY: 2, 관리대상: 'N', UNIT: 'Each', REV: 'A' },
  { 상위PN: '1600791', NO: 4, LEVEL: 2, Category: '와이어_케이블', PN: '7700063', Description: 'WIRE BRD 7AWG', MFG: 'ALPHAWIRE', 'MFG PN': '1235SV005', QTY: 0.5, 관리대상: 'Y', UNIT: 'M', REV: 'C' },
]
export const BOM_SAMPLES = SAMPLE.map((r, i, a) => ({ ...r, 실수량: calcEffQty(a)[i] }))

const HELP = [
  ['칸', '필수', '설명'],
  ['상위PN', '필수 (노랑)', '어셈블리(상위) 품번. AXCELIS 는 AX- 없이 숫자만 써도 됨'],
  ['NO', '필수 (노랑)', '줄 번호 (1, 2, 3 …)'],
  ['LEVEL', '필수 (노랑)', '트리 단계. 1 = 어셈블리 바로 아래, 2 = 그 아래 …  하위 줄은 상위 줄 바로 밑에 둔다'],
  ['PN', '필수 (노랑)', '하위 품번. 접두(AX- · ED- …)는 없어도 고객사에 맞춰 붙음'],
  ['Description · MFG · MFG PN', '필수 (노랑)', '품명 · 제조사 · 제조사품번 — 처음 생기는 품목에 들어감'],
  ['QTY', '필수 (노랑)', '바로 위 상위 1개에 드는 수량'],
  ['UNIT', '필수 (노랑)', '단위 (EA · M · Each …)'],
  ['실수량', '자동 (회색)', '어셈블리 1대에 드는 수량 = QTY × 위 LEVEL 들의 QTY. 비워 두면 올릴 때 계산됨 (써 넣어도 저장은 QTY 기준)'],
  ['Category', '선택', '분류 메모 — 처음 생기는 품목에 들어감'],
  ['관리대상', '선택 (Y/N)', '재고 · 부족 관리할 품목이면 Y. 처음 생기는 품목에만 적용 · 비우면 Y'],
  ['REV', '선택', '이 BOM 이 요구하는 부품 REV — 도면 REV 대조에 씀'],
]

const thin = { style: 'thin', color: { rgb: 'D0D5DD' } }
const border = { top: thin, bottom: thin, left: thin, right: thin }
const FILL = { req: 'FFF2CC', auto: 'EDEFF3', reqH: 'F6C343', autoH: 'B8BEC9', head: '4F46E5' }

// rows: BOM_HEADERS 키를 가진 객체 목록
//   pad: 빈 줄까지 음영을 깔 줄 수 (양식용) — 값 없는 칸이라 다시 읽을 때 줄로 안 잡힌다
export async function writeBomXlsx(rows, filename, pad = 0) {
  const XLSX = await import('xlsx-js-style')
  const aoa = [BOM_HEADERS, ...rows.map((r) => BOM_HEADERS.map((h) => r[h] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const nRows = aoa.length
  BOM_HEADERS.forEach((h, c) => {
    const kind = REQ.has(h) ? 'req' : h === AUTO ? 'auto' : ''
    for (let r = 0; r < Math.max(nRows, pad + 1, 2); r++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (!ws[ref]) ws[ref] = { t: 'z' }
      ws[ref].s = r === 0
        ? { font: { bold: true, color: { rgb: kind ? '1F2430' : 'FFFFFF' } }, fill: { fgColor: { rgb: kind ? FILL[kind + 'H'] : FILL.head } }, alignment: { horizontal: 'center', vertical: 'center' }, border }
        : { fill: kind ? { fgColor: { rgb: FILL[kind] } } : undefined, alignment: { horizontal: h === '관리대상' || h === 'LEVEL' || h === 'NO' || h === 'REV' ? 'center' : undefined }, border }
    }
  })
  if (pad + 1 > nRows) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: pad, c: BOM_HEADERS.length - 1 } })
  ws['!cols'] = BOM_HEADERS.map((h) => ({ wch: WIDTH[h] || 10 }))
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(nRows - 1, 1), c: BOM_HEADERS.length - 1 } }) }
  const help = XLSX.utils.aoa_to_sheet(HELP)
  Object.keys(help).filter((k) => !k.startsWith('!')).forEach((k) => {
    const { r } = XLSX.utils.decode_cell(k)
    const tag = String(help[XLSX.utils.encode_cell({ r, c: 1 })]?.v || '')
    help[k].s = r === 0 ? { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: FILL.head } }, border }
      : { fill: /노랑/.test(tag) ? { fgColor: { rgb: FILL.req } } : /회색/.test(tag) ? { fgColor: { rgb: FILL.auto } } : undefined, border, alignment: { wrapText: true, vertical: 'top' } }
  })
  help['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 70 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BOM')
  XLSX.utils.book_append_sheet(wb, help, '작성법')
  XLSX.writeFile(wb, filename)
}

export const downloadBomTemplate = () => writeBomXlsx(BOM_SAMPLES, 'BOM_업로드_양식.xlsx', 200)

// 등록된 BOM 을 같은 양식으로 — 고쳐서 다시 올릴 수 있게
const bare = (c) => String(c || '').replace(/^(AX|ED|CS|VM|HC)-/i, '')
export function bomRowsForXlsx(rows, assemblyCode) {
  const parent = /^AX-/i.test(assemblyCode || '') ? bare(assemblyCode) : (assemblyCode || '')
  const out = (rows || []).map((b, i) => ({
    상위PN: parent, NO: i + 1, LEVEL: b.level ?? 1, Category: b.items?.category || '', PN: bare(b.items?.std_code),
    Description: b.items?.name || '', MFG: b.items?.manufacturer || '', 'MFG PN': b.items?.manufacturer_code || '',
    QTY: b.qty_per_unit,
    관리대상: b.items?.stock_managed === false ? 'N' : 'Y',
    UNIT: b.items?.unit || '', REV: b.item_rev || '',
  }))
  const eff = calcEffQty(out)
  return out.map((r, i) => ({ ...r, 실수량: eff[i] }))
}
