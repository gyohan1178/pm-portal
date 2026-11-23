// BOM 올리기 양식 · BOM 내려받기 (v4.237.0) — 같은 칸 · 같은 모양의 엑셀(.xlsx)
//   필수 칸(상위PN · PN · 실수량)은 노란 음영, 관리대상(Y/N)은 파란 음영 — 무엇을 꼭 채워야 하는지 보이게
//   Category 는 뺐다 — 올릴 때 새 품목의 분류 메모로만 쓰여 없어도 된다 (있으면 지금처럼 읽음)
//   내려받은 파일을 고쳐 그대로 다시 올릴 수 있다
export const BOM_HEADERS = ['상위PN', 'NO', 'LEVEL', 'PN', 'Description', 'MFG', 'MFG PN', 'QTY', '실수량', '관리대상', 'UNIT', 'REV']
const REQ = new Set(['상위PN', 'PN', '실수량'])
const MGD = '관리대상'
const WIDTH = { 상위PN: 14, NO: 6, LEVEL: 7, PN: 16, Description: 40, MFG: 18, 'MFG PN': 22, QTY: 8, 실수량: 9, 관리대상: 9, UNIT: 8, REV: 6 }
export const BOM_SAMPLES = [
  { 상위PN: '1600791', NO: 1, LEVEL: 1, PN: '750000580', Description: 'TUBING HEAT SHRINK 3/4', MFG: 'ALPHAWIRE', 'MFG PN': 'FIT-221-3/4-CL', QTY: 0.5, 실수량: 0.5, 관리대상: 'N', UNIT: 'M', REV: 'A' },
  { 상위PN: '1600791', NO: 2, LEVEL: 1, PN: '510002080', Description: 'CONN LUG STRAIGHT 6 1/4', MFG: 'JEONO', 'MFG PN': 'JOCO0102-SS06', QTY: 2, 실수량: 2, 관리대상: 'N', UNIT: 'Each', REV: 'A' },
  { 상위PN: '1600791', NO: 3, LEVEL: 1, PN: '7700063', Description: 'WIRE BRD 7AWG', MFG: 'ALPHAWIRE', 'MFG PN': '1235SV005', QTY: 0.5, 실수량: 0.5, 관리대상: 'Y', UNIT: 'M', REV: 'C' },
]
const HELP = [
  ['칸', '필수', '설명'],
  ['상위PN', '필수 (노랑)', '어셈블리(상위) 품번. AXCELIS 는 AX- 없이 숫자만 써도 됨'],
  ['PN', '필수 (노랑)', '하위 품번. 접두(AX- · ED- …)는 없어도 고객사에 맞춰 붙음'],
  ['실수량', '필수 (노랑)', '어셈블리 1대에 드는 수량. 비우면 QTY 를 씀'],
  ['관리대상', 'Y / N (파랑)', '재고 · 부족 관리할 품목이면 Y. 처음 생기는 품목에만 적용 · 비우면 Y'],
  ['LEVEL', '선택', '트리 단계 (비우면 1)'],
  ['REV', '선택', '이 BOM 이 요구하는 부품 REV — 도면 REV 대조에 씀'],
  ['NO · Description · MFG · MFG PN · QTY · UNIT', '선택', '처음 생기는 품목의 품명 · 제조사 · 단위로 들어감'],
  ['Category', '안 써도 됨', '예전 양식 칸 — 있으면 분류 메모로만 읽음'],
]

const thin = { style: 'thin', color: { rgb: 'D0D5DD' } }
const border = { top: thin, bottom: thin, left: thin, right: thin }
const FILL = { req: 'FFF2CC', mgd: 'DDEBF7', reqH: 'F6C343', mgdH: '6FA8DC', head: '4F46E5' }

// rows: BOM_HEADERS 키를 가진 객체 목록
//   pad: 빈 줄까지 음영을 깔 줄 수 (양식용) — 값 없는 칸이라 다시 읽을 때 줄로 안 잡힌다
export async function writeBomXlsx(rows, filename, pad = 0) {
  const XLSX = await import('xlsx-js-style')
  const aoa = [BOM_HEADERS, ...rows.map((r) => BOM_HEADERS.map((h) => r[h] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const nRows = aoa.length
  BOM_HEADERS.forEach((h, c) => {
    const kind = REQ.has(h) ? 'req' : h === MGD ? 'mgd' : ''
    for (let r = 0; r < Math.max(nRows, pad + 1, 2); r++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (!ws[ref]) ws[ref] = { t: 'z' }
      ws[ref].s = r === 0
        ? { font: { bold: true, color: { rgb: kind ? '1F2430' : 'FFFFFF' } }, fill: { fgColor: { rgb: kind ? FILL[kind + 'H'] : FILL.head } }, alignment: { horizontal: 'center', vertical: 'center' }, border }
        : { fill: kind ? { fgColor: { rgb: FILL[kind] } } : undefined, alignment: { horizontal: kind === 'mgd' || h === 'LEVEL' || h === 'NO' || h === 'REV' ? 'center' : undefined }, border }
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
      : { fill: /노랑/.test(tag) ? { fgColor: { rgb: FILL.req } } : /파랑/.test(tag) ? { fgColor: { rgb: FILL.mgd } } : undefined, border, alignment: { wrapText: true, vertical: 'top' } }
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
  return (rows || []).map((b, i) => ({
    상위PN: parent, NO: i + 1, LEVEL: b.level ?? 1, PN: bare(b.items?.std_code),
    Description: b.items?.name || '', MFG: b.items?.manufacturer || '', 'MFG PN': b.items?.manufacturer_code || '',
    QTY: b.qty_per_unit, 실수량: b.qty_per_unit,
    관리대상: b.items?.stock_managed === false ? 'N' : 'Y',
    UNIT: b.items?.unit || '', REV: b.item_rev || '',
  }))
}
