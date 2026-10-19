// 절단 요청 내용 한 줄 — 「✂ 1,200mm · 탈피 좌 10 / 우 15」 (2026-09-30)
//   자재요청 화면 · 출력 · 엑셀이 같이 쓴다.
const mmTxt = v => Number(v).toLocaleString('ko-KR')
export function cutLabel(r, { icon = true } = {}) {
  if (!r || r.req_kind !== '절단' || !(Number(r.cut_mm) > 0)) return ''
  const L = Number(r.strip_l_mm) > 0, R = Number(r.strip_r_mm) > 0
  const strip = L || R ? ` · 탈피 좌 ${L ? mmTxt(r.strip_l_mm) : '-'} / 우 ${R ? mmTxt(r.strip_r_mm) : '-'}` : ''
  return `${icon ? '✂ ' : ''}${mmTxt(r.cut_mm)}mm${strip}`
}
