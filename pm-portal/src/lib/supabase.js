import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Supabase 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.')
}

export const supabase = createClient(url, key)
// ── 대량 행 병렬 로딩 헬퍼 ──
// 순차 페이징(1000건씩 차례로) 대신, 총 개수를 먼저 구하고 페이지를 병렬 요청.
// 한국↔Supabase 왕복 지연을 페이지 수만큼 곱하지 않도록 한꺼번에 가져온다.
export async function fetchAllRows(table, { select = '*', match = {}, eq = {} } = {}) {
  const base = () => {
    let q = supabase.from(table)
    return q
  }
  // 1) 총 개수
  let countQ = base().select('*', { count: 'exact', head: true })
  for (const [k, v] of Object.entries(eq)) countQ = countQ.eq(k, v)
  const { count } = await countQ
  if (!count) return []
  // 2) 페이지 병렬 요청
  const pages = Math.ceil(count / 1000)
  const reqs = []
  for (let i = 0; i < pages; i++) {
    let q = base().select(select)
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v)
    reqs.push(q.range(i * 1000, i * 1000 + 999).then(r => r.data || []))
  }
  return (await Promise.all(reqs)).flat()
}
