// Supabase 기본 1000행 제한 우회 — 전 페이지를 끝까지 가져옴.
// makeQuery: 매 호출마다 "새" 쿼리빌더를 반환하는 함수 (select/eq/order 등 적용된 상태)
export async function fetchAll(makeQuery, pageSize = 1000) {
  let all = []
  let from = 0
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    all = all.concat(batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
