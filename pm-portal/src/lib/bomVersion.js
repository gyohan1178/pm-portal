// BOM 버전(REV) 보관 · 불러오기 (v4.77.0)
//
//   지금 쓰는 BOM 은 그대로 bom 표에 한 벌만 있다 (모든 화면이 이것을 읽는다).
//   BOM 을 새로 올리기 직전에 그 어셈블리의 지금 BOM 을 「그때 REV」 이름으로 pm_bom_version 에 통째로 보관한다.
//     · REV 가 바뀌면 → 이전 REV 가 구버전으로 남는다
//     · 같은 REV 를 다시 올리면 → 그 REV 보관본이 고치기 전 내용으로 덮인다 (목록에는 안 보임 · 만일을 위한 사본)
//   구버전을 고르면 보관본 줄(bom 행 그대로)에 품목 정보를 붙여 지금 BOM 과 같은 모양으로 돌려준다.
import { supabase } from './supabase'

const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
export const normRev = (r) => String(r ?? '').trim().toUpperCase() || 'A'

// 올리기 직전 보관 — 이 고객사의 이 상위품번들. DB 설정 전(함수 없음)이면 조용히 건너뛴다.
//   반환: [{ code, rev, cnt }] (보관한 것) · null = 보관 기능 없음
export async function archiveBoms(customerId, codes) {
  const list = [...new Set((codes || []).filter(Boolean))]
  if (!customerId || !list.length) return []
  const out = []
  for (let i = 0; i < list.length; i += 300) {
    const { data, error } = await supabase.rpc('pm_bom_archive', { p_customer_id: String(customerId), p_codes: list.slice(i, i + 300) })
    if (error) {
      if (error.code === 'PGRST202' || /pm_bom_archive/.test(error.message || '')) return null
      throw new Error('이전 BOM 보관 실패: ' + error.message)
    }
    ;(data || []).forEach((r) => out.push({ code: r.a_code, rev: normRev(r.a_rev), cnt: Number(r.a_cnt) || 0 }))
  }
  return out
}

// 올린 결과 글 — 'AX-110158840 REV P → Q (이전 P 보관)'
//   before: archiveBoms 결과 · after: { code → 새 REV }
export function revChanges(before, after) {
  const out = []
  for (const b of before || []) {
    const nv = after?.[b.code]
    if (nv && normRev(nv) !== b.rev) out.push({ code: b.code, from: b.rev, to: normRev(nv), cnt: b.cnt })
  }
  return out
}

// 어셈블리의 구버전 목록 (지금 REV 는 뺀다) — 최근에 보관한 것 먼저
export async function fetchBomVersions(projectId, currentRev) {
  if (!projectId) return []
  const { data, error } = await supabase.from('pm_bom_version')
    .select('id,rev,row_cnt,saved_at,uploaded_on').eq('project_id', projectId)
    .order('saved_at', { ascending: false }).order('id', { ascending: false })
  if (error) return []   // 표가 없으면(설정 전) 버전 선택만 안 보인다
  const cur = normRev(currentRev)
  return (data || []).filter((v) => normRev(v.rev) !== cur)
    .map((v) => ({ ...v, rev: normRev(v.rev), label: `REV ${normRev(v.rev)}${v.uploaded_on ? ` · ${md(v.uploaded_on)} 올림` : ''} · ${Number(v.row_cnt || 0).toLocaleString('ko-KR')}줄` }))
}

// 보관본 줄 → 지금 BOM 과 같은 모양 ({...bom행, items:{…}})
//   itemCols: 화면마다 필요한 품목 칸 (bom 조회와 같은 것)
export async function fetchBomVersionRows(versionId, itemCols) {
  const { data, error } = await supabase.from('pm_bom_version').select('id,rev,rows').eq('id', Number(versionId)).single()
  if (error) throw new Error('구버전 BOM 을 읽지 못했습니다: ' + error.message)
  const rows = Array.isArray(data?.rows) ? data.rows : []
  const ids = [...new Set(rows.map((r) => r.item_id).filter(Boolean))]
  const meta = {}
  const cols = /(^|,)\s*id\s*(,|$)/.test(String(itemCols)) ? itemCols : `id,${itemCols}`
  for (let i = 0; i < ids.length; i += 200) {
    const { data: its, error: e2 } = await supabase.from('items').select(cols).in('id', ids.slice(i, i + 200))
    if (e2) throw e2
    ;(its || []).forEach((it) => { meta[it.id] = it })
  }
  return rows.map((r) => ({ ...r, items: meta[r.item_id] || null, _ver: data.rev }))
    .sort((a, b) => (a.seq == null) - (b.seq == null) || (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
}
