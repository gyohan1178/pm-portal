// Supabase 기본 1000행 제한 우회 — 전 페이지를 끝까지 가져온다.
//
//   makeQuery: 매 호출마다 "새" 쿼리빌더를 반환하는 함수 (select/eq/order 등 적용된 상태)
//
// ⚠ 정렬이 한 가지뿐이면 같은 값이 여럿일 때 순서가 매번 달라져,
//   페이지 경계에서 같은 행이 두 번 오거나 빠진다.
//   실제로 발주일이 같은 건이 두 번 보인 적이 있다.
//   여기서 걸러 내지만, 조회에도 .order('id') 를 붙이는 편이 낫다.
export async function fetchAll(makeQuery, pageSize = 1000) {
  const all = []
  const seen = new Set()
  let from = 0
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    for (const r of batch) {
      const k = r?.id
      if (k != null) {
        if (seen.has(k)) continue    // 페이지가 겹쳐 들어온 것
        seen.add(k)
      }
      all.push(r)
    }
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
