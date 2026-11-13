// Supabase 기본 1000행 제한 우회 — 전 페이지를 끝까지 가져온다.
//
//   makeQuery: 매 호출마다 "새" 쿼리빌더를 반환하는 함수 (select/eq/order 등 적용된 상태)
//
// ⚠ 정렬이 한 가지뿐이면 같은 값이 여럿일 때 순서가 매번 달라져,
//   페이지 경계에서 같은 행이 두 번 오거나 빠진다.
//   실제로 발주일이 같은 건이 두 번 보인 적이 있다.
//   여기서 걸러 내지만, 조회에도 .order('id') 를 붙이는 편이 낫다.
//
// v4.186.0 — 첫 쪽이 가득 차면 다음 쪽들은 「동시에」 받는다 (2쪽 → 그다음부터 4쪽씩).
//   예전엔 한 쪽씩 차례로 받아, 서버 왕복(약 0.2초)이 쪽 수만큼 쌓였다 (품목 1.1만 줄 = 11번 차례로).
//   1,000줄 안 되는 조회는 예전과 똑같이 요청 한 번. 받은 순서 · 중복 거르기는 그대로.
//   serial: true — 계산이 무거운 보기(호기 연결 등)는 쪽마다 다시 계산하므로 빈 쪽을 미리 묻지 않게 예전처럼 차례로
export async function fetchAll(makeQuery, pageSize = 1000, { serial = false } = {}) {
  const all = []
  const seen = new Set()
  const take = (batch) => {
    for (const r of batch) {
      const k = r?.id
      if (k != null) {
        if (seen.has(k)) continue    // 페이지가 겹쳐 들어온 것
        seen.add(k)
      }
      all.push(r)
    }
  }
  const page = async (n) => {
    const { data, error } = await makeQuery().range(n * pageSize, (n + 1) * pageSize - 1)
    if (error) throw error
    return data || []
  }
  const first = await page(0)
  take(first)
  if (first.length < pageSize) return all
  for (let n = 1, wave = serial ? 1 : 2; ; n += wave, wave = serial ? 1 : 4) {
    const w = wave
    const res = await Promise.all(Array.from({ length: w }, (_, k) => page(n + k)))
    let done = false
    for (const batch of res) {      // 쪽 순서대로 · 덜 찬 쪽이 나오면 그 뒤는 버린다 (끝난 것)
      take(batch)
      if (batch.length < pageSize) { done = true; break }
    }
    if (done) break
  }
  return all
}
