// CSV 양식(템플릿) 다운로드 헬퍼 — 헤더 + 예시행을 BOM 등 호환되게 내려받기
export function downloadCsvTemplate(filename, headers, sampleRows = []) {
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(esc).join(',')]
  sampleRows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(',')))
  // 엑셀 한글 깨짐 방지 BOM
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// 각 업로드별 양식 정의 (헤더 + 예시)
export const TEMPLATES = {
  bom: {
    filename: 'BOM_업로드_양식.csv',
    headers: ['상위PN', 'NO', 'LEVEL', 'Category', 'PN', 'Description', 'MFG', 'MFG PN', 'QTY', '실수량', '관리대상', 'UNIT', 'REV'],
    samples: [
      { 상위PN: '1600791', NO: 1, LEVEL: 1, Category: '부품', PN: '750000580', Description: 'TUBING HEAT SHRINK 3/4', MFG: 'ALPHAWIRE', 'MFG PN': 'FIT-221-3/4-CL', QTY: 0.5, 실수량: 0.5, 관리대상: 'N', UNIT: 'M', REV: 'A' },
      { 상위PN: '1600791', NO: 2, LEVEL: 1, Category: '부품', PN: '510002080', Description: 'CONN LUG STRAIGHT 6 1/4', MFG: 'JEONO', 'MFG PN': 'JOCO0102-SS06', QTY: 2, 실수량: 2, 관리대상: 'N', UNIT: 'Each', REV: 'A' },
      { 상위PN: '1600791', NO: 3, LEVEL: 1, Category: '와이어_케이블', PN: '7700063', Description: 'WIRE BRD 7AWG', MFG: 'ALPHAWIRE', 'MFG PN': '1235SV005', QTY: 0.5, 실수량: 0.5, 관리대상: 'Y', UNIT: 'M', REV: 'C' },
    ],
  },
  items: {
    filename: '기준코드_업로드_양식.csv',
    headers: ['기준코드', '품명', '구분', '단위', '규격', '제조사', '제조사품번', '매입가', 'LT주', '관리부서'],
    samples: [
      { 기준코드: 'AX-5100001', 품명: 'CONN 예시', 구분: '자재', 단위: 'EA', 규격: 'PANDUIT ABC-123', 제조사: 'PANDUIT', 제조사품번: 'ABC-123', 매입가: 1500, LT주: 4, 관리부서: '지원본부' },
    ],
  },
  customerPO: {
    filename: '고객사PO_업로드_양식.csv',
    headers: ['OrderNumber', 'Order Lines', 'Del Line', 'CCN', 'Item', 'Item Desc', 'SRev', 'Quantity', 'Promise Date'],
    samples: [
      { OrderNumber: '815745', 'Order Lines': '1', 'Del Line': '1', CCN: 'A', Item: '160021769', 'Item Desc': 'HARN 예시', SRev: 'B', Quantity: 4, 'Promise Date': '2026-07-15' },
    ],
  },
}
