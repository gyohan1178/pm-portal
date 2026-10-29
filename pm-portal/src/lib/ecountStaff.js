// 이카운트 담당자 코드 — 엑셀을 내려받은 사람으로 찍힌다 (발주서 · 구매입력 공통).
//   여기 없는 계정은 기본값(김교한)을 쓴다.
export const ECOUNT_STAFF = {
  '4ansans@jinsuntech.co.kr': '12463',
  'hjh0524@jinsuntech.co.kr': '12544',
}
export const ECOUNT_STAFF_DEFAULT = '00022'
export const ecountStaffOf = (email) => ECOUNT_STAFF[String(email || '').toLowerCase()] || ECOUNT_STAFF_DEFAULT
