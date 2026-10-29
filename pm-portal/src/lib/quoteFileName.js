// 견적서 파일 이름 규칙 (v4.113.0)
//   YYMMDD_업체_건명[_매입][_EN]
//   예) 261029_벨류엔지니어링_7700039 WIRE 단품 견적.xlsx
//   · 날짜 = 견적일 (발주번호 JS-261029 와 같은 6자리)
//   · 업체 = 매출견적은 수신(Issued to), 매입견적은 업체 — (주) · ㈜ · 주식회사 는 뺌, 비면 「업체미정」
//   · 건명이 비면 첫 품번, 그것도 없으면 「견적」
//   · 파일 이름에 못 쓰는 글자(\ / : * ? " < > |)는 - 로, 너무 길면 자름
//   엑셀 내려받기 · 인쇄(PDF 저장) 모두 이 이름을 쓴다 (PDF 는 크롬이 문서 제목을 파일 이름으로 씀)
const clean = (v) => String(v ?? '')
  .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
  .replace(/\s+/g, ' ')
  .replace(/^[\s.-]+|[\s.-]+$/g, '')

export const shortCompany = (v) => clean(String(v ?? '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, ' '))

export function quoteFileBase({ date, party, title, firstCode, purchase = false, en = false } = {}) {
  const d = String(date || '').replace(/\D/g, '')
  const ymd = d.length >= 8 ? d.slice(2, 8) : d || ''
  const who = shortCompany(party).slice(0, 30) || '업체미정'
  const what = (clean(title) || clean(firstCode) || '견적').slice(0, 60)
  return [ymd, who, what, purchase ? '매입' : '', en ? 'EN' : ''].filter(Boolean).join('_')
}
