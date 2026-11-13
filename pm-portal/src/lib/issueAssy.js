// 다품목 출고 — 어떤 상위품목(ASSY)을 몇 대분 뺐는지 (v4.183.0 · pm_issue_assy)
//   전개해서 담을 때 상위품목을 「대기」로 적어 두고(batch_at 없음),
//   출고 처리가 끝나면 그 출고의 처리 시각(stock_movements.processed_at)을 붙인다 → 출고 현황에서 같은 묶음에 표시
//   담기함은 고객사마다 공유되므로 대기 줄도 고객사 기준 · 표가 없으면(SQL 전) 조용히 넘어간다 (출고는 막지 않음)
import { supabase } from './supabase'

const T = 'pm_issue_assy'
const noTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /pm_issue_assy/.test(e.message || ''))
const soft = async (q) => { try { const { data, error } = await q; if (error) { if (!noTable(error)) console.warn('상위품목 기록', error.message); return null } return data } catch (e) { console.warn('상위품목 기록', e); return null } }

// 전개해서 담을 때 — 상위품목만 대기로 적는다
export async function addPendingAssys(customerId, assys, byName) {
  const rows = (assys || []).filter((a) => a && a.std_code && Number(a.qty) > 0)
    .map((a) => ({ customer_id: customerId, assy_code: a.std_code, assy_name: a.name || null, qty: Number(a.qty), created_name: byName || null }))
  if (!customerId || !rows.length) return
  await soft(supabase.from(T).insert(rows))
}

// 담기함을 비울 때 — 대기 줄도 지운다
export async function clearPendingAssys(customerId) {
  if (!customerId) return
  await soft(supabase.from(T).delete().eq('customer_id', customerId).is('batch_at', null))
}

// 출고 처리가 끝난 뒤 — 방금 출고의 처리 시각을 대기 줄에 붙인다. 붙인 시각을 돌려준다 (되돌리기용)
export async function stampPendingAssys(customerId) {
  if (!customerId) return null
  const last = await soft(supabase.from('stock_movements').select('processed_at')
    .eq('movement_type', '출고').eq('customer_id', customerId).like('memo', '출고작업%')
    .not('processed_at', 'is', null).order('processed_at', { ascending: false }).limit(1))
  const at = last?.[0]?.processed_at
  if (!at) return null
  const done = await soft(supabase.from(T).update({ batch_at: at }).eq('customer_id', customerId).is('batch_at', null).select('id'))
  return done?.length ? at : null
}

// 출고를 되돌릴 때 — 다시 대기로 (담기함에 도로 들어가므로)
export async function unstampAssys(customerId, at) {
  if (!customerId || !at) return
  await soft(supabase.from(T).update({ batch_at: null }).eq('customer_id', customerId).eq('batch_at', at))
}

// 출고 현황 — 기간 안 출고 묶음의 상위품목. 반환 Map(처리 시각 ms|고객사 id → [{ code, name, qty, by }])
export async function fetchIssueAssys({ from, to }) {
  const m = new Map()
  // 처리 시각은 시각(UTC) · 출고일은 한국 날짜 → 앞뒤 하루씩 넉넉히 받고 묶음에 맞는 것만 쓴다
  const lo = new Date(`${from}T00:00:00+09:00`); lo.setDate(lo.getDate() - 1)
  const hi = new Date(`${to}T00:00:00+09:00`); hi.setDate(hi.getDate() + 2)
  const data = await soft(supabase.from(T).select('customer_id,assy_code,assy_name,qty,created_name,batch_at')
    .not('batch_at', 'is', null).gte('batch_at', lo.toISOString()).lt('batch_at', hi.toISOString()).order('assy_code').limit(5000))
  for (const r of data || []) {
    const k = assyKey(r.batch_at, r.customer_id)
    const list = m.get(k) || []
    const same = list.find((x) => x.code === r.assy_code)
    if (same) same.qty += Number(r.qty) || 0
    else list.push({ code: r.assy_code, name: r.assy_name, qty: Number(r.qty) || 0, by: r.created_name })
    m.set(k, list)
  }
  return m
}
export const assyKey = (at, custId) => `${at ? new Date(at).getTime() : ''}|${custId || ''}`
