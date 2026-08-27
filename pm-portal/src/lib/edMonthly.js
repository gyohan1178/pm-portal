// Edwards 월간 실적 시트를 생산일정 줄로 묶는다.
//
//   시트 한 줄은 품목 하나다 (6천 줄쯤).
//   한 장비를 부분마다 따로 만들고 따로 납품하므로
//   프로젝트 + 호기 + 구분 을 한 줄로 묶는다.
//
//   품목 상세는 담지 않는다. 그것은 관리 시트에서 본다.

import * as XLSX from 'xlsx'

const SHEET = '에드워드 월간 실적'

// 프로젝트명에서 호기를 꺼낸다 — 'Gen2 Plus_Hynix #27 (NKB943)' → 27
export function hogiOf(proj) {
  const m = /#\s*(\d+)/.exec(String(proj || ''))
  return m ? Number(m[1]) : null
}

// 프로젝트명을 정리한다.
//   같은 것이 '_' 나 '(NKB943)' 때문에 다르게 세어져 71종이 되었다.
//   정리하면 36종이다.
export function projOf(proj) {
  return String(proj || '')
    .replace(/#\s*\d+\s*(~\s*\d+)?/g, '')
    .replace(/\(NKB\d+\)/g, '')
    .replace(/[_,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, '')
}

const ymd = (v) => {
  if (!v) return ''
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/**
 * @returns { records, skipped, sheets }
 *   records — 생산일정 줄 (프로젝트+호기+구분)
 *   skipped — 호기가 없어 뺀 줄 수 (단품·ETC)
 */
export function parseEdMonthly(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheets = wb.SheetNames

  const name = sheets.find(n => n === SHEET)
    || sheets.find(n => n.includes('에드워드') && n.includes('월간'))
  if (!name) return { records: [], skipped: 0, sheets, error: `'${SHEET}' 시트를 찾을 수 없습니다` }

  // 2행이 머리글, 3행부터 값
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1, range: 1, blankrows: false, defval: null,
  })
  if (!grid.length) return { records: [], skipped: 0, sheets, error: '내용이 없습니다' }

  const head = (grid[0] || []).map(h => String(h || '').trim())
  const col = (...names) => {
    for (const n of names) {
      const i = head.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const cG1 = col('구분1')
  const cG2 = col('구분2')
  const cG3 = col('구분3')
  const cProj = col('PROJECT', '프로젝트')
  const cPn = col('품번')
  const cQty = col("Q'TY", 'QTY', '수량')
  const cNeed = col('납품 요청일', '납품요청일')
  const cDeliv = col('납품 일자', '납품일자')

  if (cProj < 0 || cG1 < 0) {
    return { records: [], skipped: 0, sheets, error: 'PROJECT 나 구분1 열을 찾을 수 없습니다' }
  }

  const box = new Map()
  let skipped = 0, blank = 0

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] || []
    const proj = r[cProj]
    if (!proj) {
      // 빈 줄이 이어지면 끝으로 본다. 시트가 백만 행으로 잡히기 때문이다.
      if (++blank > 200) break
      continue
    }
    blank = 0

    const h = hogiOf(proj)
    if (!h) { skipped++; continue }   // 단품·ETC 는 생산일정에 넣지 않는다

    const key = `${projOf(proj)}|${h}|${r[cG1] || '기타'}`
    let b = box.get(key)
    if (!b) {
      b = { pn: projOf(proj), hogi: `#${h}`,
            part: String(r[cG1] || '기타').trim(),
            // 구분2·3 은 묶음마다 하나로 정해진다. 처음 값을 쓴다.
            part2: cG2 >= 0 ? String(r[cG2] || '').trim() : '',
            part3: cG3 >= 0 ? String(r[cG3] || '').trim() : '',
            n: 0, need: [], deliv: [], nodeliv: 0 }
      box.set(key, b)
    }
    b.n++
    const need = ymd(r[cNeed]), deliv = ymd(r[cDeliv])
    if (need) b.need.push(need)
    if (deliv) b.deliv.push(deliv); else b.nodeliv++
  }

  const today = ymd(new Date())
  const records = [...box.values()].map(b => {
    const latest = b.deliv.length ? b.deliv.reduce((a, c) => (c > a ? c : a)) : ''
    // 납품 일자가 다 채워졌고 지났으면 완료로 본다
    const done = !!latest && latest <= today && b.nodeliv === 0
    return {
      pn: b.pn, name: b.pn, hogi: b.hogi,
      part: b.part, part2: b.part2 || null, part3: b.part3 || null,
      req_date: b.need.length ? b.need.reduce((a, c) => (c < a ? c : a)) : null,
      status: done ? '완료' : 'PO접수',
      po_received: true,
      // 비고는 사람이 쓰는 칸이다. 품목 수 같은 것으로 채우지 않는다.
      missing_parts: [],
    }
  })

  return { records, skipped, sheets }
}
