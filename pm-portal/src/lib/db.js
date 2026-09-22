// 조회 결과를 풀어 주되, 실패하면 던진다.
//
//   const rows = must(await supabase.from('items').select('id'), '품목 조회')
//
// ⚠ 왜 필요한가
//   `const { data } = await supabase...` 로 받으면 실패해도 data 가 비어 있을 뿐이라
//   화면은 「0건」으로 조용히 넘어간다. (견적 하위품목이 0건으로 보였던 사례)
//   던지면 main.jsx 의 전역 오류 알림이 잡아서 화면에 띄운다.
export function must(res, what = '') {
  if (res?.error) throw new Error((what ? what + ' — ' : '') + res.error.message)
  return res?.data ?? null
}
