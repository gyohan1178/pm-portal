// AXCELIS 「Required Date」 = Supplier Portal need date (v4.242.0)
//   고객사가 실제로 필요로 하는 날 — 작업 순서는 promise date 가 아니라 이 날짜로 정한다
//   purchase_orders.need_date 에 PO 업로드 때마다 파일 값으로 맞추고, 바뀌면 그 줄 변경 이력(changes)에 field 'need_date' 로 남긴다
//   → 지난번보다 당겨졌는지(▲) · 늦춰졌는지(▼)를 이력으로 안다
//   칸이 없으면(SQL pm_need_date_261124 전) 저장 · 조회를 건너뛰고 화면은 promise date 로 대신 묶는다

export async function needDateReady(supabase) {
  const { error } = await supabase.from('purchase_orders').select('need_date').limit(1)
  return !error
}

// 고객사 PO id → { need, prev, at }
//   prev = 지금 값으로 바뀌기 직전 값 (이력에 있으면) · at = 바뀐 때
export async function fetchNeedByPo(supabase, poIds) {
  const out = {}
  const list = [...new Set((poIds || []).filter(Boolean))]
  const parts = []
  for (let i = 0; i < list.length; i += 150) parts.push(list.slice(i, i + 150))
  // 나눈 묶음을 같이 읽는다 (v4.244.0)
  const res = await Promise.all(parts.map(part => supabase.from('purchase_orders').select('id,need_date,changes').in('id', part)))
  for (const { data, error } of res) {
    if (error) throw error
    ;(data || []).forEach(p => {
      const need = p.need_date ? String(p.need_date).slice(0, 10) : null
      const hist = (Array.isArray(p.changes) ? p.changes : []).filter(c => c && c.field === 'need_date')
      const last = hist[hist.length - 1]
      const prev = last && String(last.to || '').slice(0, 10) === need && last.from && last.from !== '-' ? String(last.from).slice(0, 10) : null
      out[p.id] = { need, prev, at: prev ? last.at || null : null }
    })
  }
  return out
}

// 지난 값보다 당겨짐 ▲ · 늦춰짐 ▼ · 그대로 ''
export const needTrend = (prev, now) => (!prev || !now || prev === now ? '' : now < prev ? 'up' : 'down')
