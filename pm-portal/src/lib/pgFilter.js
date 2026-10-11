// PostgREST .or() 검색 조건 만들기 (2026-10-08)
//   사용자가 친 글자를 그대로 넣으면 쉼표 · 괄호가 조건 구분자로 읽혀 조회가 깨진다.
//   예) 「RES 1/4W, 5%」 「CABLE TIE (100EA)」 → 오류 → 화면엔 「결과 없음」
//   PostgREST 규칙대로 값을 큰따옴표로 감싸고, 안의 \ 와 " 는 \ 로 이스케이프한다.
export const pgQuote = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'

// ilikeAny(['std_code','name'], 'abc') → 'std_code.ilike."%abc%",name.ilike."%abc%"'
export function ilikeAny(cols, q) {
  const v = pgQuote('%' + String(q ?? '').trim() + '%')
  return cols.map((c) => `${c}.ilike.${v}`).join(',')
}
