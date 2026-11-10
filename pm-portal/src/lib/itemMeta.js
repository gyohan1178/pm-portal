// 품목별 고객사 승인 제조사 · REV (v4.171.0)
//   AXCELIS Part Report 를 BOM 에 올릴 때 품목마다
//     · 승인 제조사(Mfr Part) 전부 → pm_item_mfr   (예: 500001491 = EYECAP INTERNATIONAL + EYECAP KOREA)
//     · 품목 버전(A.23)          → pm_item_rev   (올라가면 「REV 바뀜」)
//   items.manufacturer · manufacturer_code 는 「우리가 실제로 사는 대표 제조사」로 그대로 두고, 이 목록은 따로 보여 준다.
//   표가 아직 없으면(SQL 전) 조회는 빈 값, 저장은 { missingTable:true } — 화면은 예전처럼 동작한다.
import { supabase } from './supabase'
import { isDnu, isMfrObs } from './axcelisBomReport'
import { pgQuote, ilikeAny } from './pgFilter'

const isMissing = (e) => e && (e.code === '42P01' || e.code === 'PGRST202' || e.code === 'PGRST205' || /does not exist|could not find/i.test(e.message || ''))

// 리포트 → 품목별 한 줄 (같은 품번이 여러 자리에 나오면 처음 것 · 제조사는 합침)
export function buildMetaRows(parsed) {
  const by = new Map()
  for (const p of parsed?.parts || []) {
    if (!p.code || p.isVM) continue
    const cur = by.get(p.code)
    if (!cur) {
      by.set(p.code, {
        code: p.code, ver: p.ver || (p.revRaw ? `${p.revRaw}.${p.edition || 0}` : ''),
        rev: p.rev || '', edition: p.edition ?? null, state: p.state || '',
        mfrs: Array.isArray(p.mfrs) ? p.mfrs.map(m => ({ mfr: m.mfr || '', mfr_pn: m.mfrPn || '', status: m.status || '' })) : null,
      })
    } else if (Array.isArray(p.mfrs) && cur.mfrs) {
      for (const m of p.mfrs) if (!cur.mfrs.some(x => x.mfr === (m.mfr || '') && x.mfr_pn === (m.mfrPn || ''))) cur.mfrs.push({ mfr: m.mfr || '', mfr_pn: m.mfrPn || '', status: m.status || '' })
    }
  }
  return [...by.values()].filter(r => r.ver || r.mfrs)
}

// 저장 — 300품목씩. 결과를 합쳐 돌려준다
export async function syncItemMeta(rows, src) {
  const out = { items: 0, missing: 0, missing_codes: [], rev_new: 0, rev_up: [], older: 0, mfr_new: 0, mfr_off: 0 }
  for (let i = 0; i < rows.length; i += 300) {
    const { data, error } = await supabase.rpc('pm_item_meta_sync', { p_rows: rows.slice(i, i + 300), p_src: src || null })
    if (error) { if (isMissing(error)) return { ...out, missingTable: true }; throw error }
    const d = data || {}
    for (const k of ['items', 'missing', 'rev_new', 'older', 'mfr_new', 'mfr_off']) out[k] += Number(d[k]) || 0
    out.rev_up.push(...(d.rev_up || [])); out.missing_codes.push(...(d.missing_codes || []))
  }
  return out
}

// 화면에 보이는 품목들의 승인 제조사 · 최신 REV
//   → { mfr: { itemId: [{mfr, mfr_pn, status, active}] }, rev: { itemId: { ver, n } }, cps: { itemId: 'Sole'|'Limited'|'Generic' } }
export async function fetchItemMeta(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  const mfr = {}, rev = {}, cps = {}
  if (!ids.length) return { mfr, rev, cps }
  // CPS 구분 (v4.173.0) — 표가 없으면(SQL 전) 조용히 건너뜀
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_item_cps').select('item_id,kind').in('item_id', ids.slice(i, i + 200)).not('kind', 'is', null)
    if (error) break
    for (const r of data || []) cps[r.item_id] = r.kind
  }
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const [a, b] = await Promise.all([
      supabase.from('pm_item_mfr').select('item_id,mfr,mfr_pn,status,active').in('item_id', part).eq('active', true).limit(5000),
      supabase.from('pm_item_rev').select('item_id,ver,vkey').in('item_id', part).limit(5000),
    ])
    if (a.error) { if (isMissing(a.error)) return { mfr, rev, cps, missingTable: true }; throw a.error }
    if (b.error) { if (isMissing(b.error)) return { mfr, rev, cps, missingTable: true }; throw b.error }
    for (const r of a.data || []) (mfr[r.item_id] = mfr[r.item_id] || []).push(r)
    for (const r of b.data || []) {
      const c = rev[r.item_id]
      if (!c) rev[r.item_id] = { ver: r.ver, vkey: r.vkey, n: 1 }
      else { c.n++; if (r.vkey > c.vkey) { c.ver = r.ver; c.vkey = r.vkey } }
    }
  }
  for (const k of Object.keys(mfr)) mfr[k].sort(byMfrRank)
  return { mfr, rev, cps }
}

// 한 품목 자세히 — 승인 제조사(빠진 것 포함) · REV 이력 · 같은 제조사품번을 쓰는 다른 품번
export async function fetchItemMetaDetail(itemId) {
  if (!itemId) return null
  const [a, b] = await Promise.all([
    supabase.from('pm_item_mfr').select('mfr,mfr_pn,status,active,src_code,src_ver,first_seen,last_seen,off_on').eq('item_id', itemId),
    supabase.from('pm_item_rev').select('ver,vkey,state,src_code,first_seen,last_seen').eq('item_id', itemId).order('vkey', { ascending: false }),
  ])
  if (a.error) { if (isMissing(a.error)) return { missingTable: true, mfrs: [], revs: [], same: [] }; throw a.error }
  if (b.error) { if (isMissing(b.error)) return { missingTable: true, mfrs: [], revs: [], same: [] }; throw b.error }
  const mfrs = (a.data || []).sort((x, y) => (y.active - x.active) || byMfrRank(x, y))
  const { data: cpsRow } = await supabase.from('pm_item_cps').select('kind,why,ver,file_name,prev_kind,changed_on,last_seen').eq('item_id', itemId).maybeSingle()
    .then(r => r, () => ({ data: null }))
  // 같은 제조사품번(ORDER BY DESCRIPTION 같은 자리표시 빼고)을 승인 목록에 가진 다른 품번
  const pns = [...new Set(mfrs.filter(m => m.active && realPn(m.mfr_pn)).map(m => m.mfr_pn))]
  let same = []
  if (pns.length) {
    const { data } = await supabase.from('pm_item_mfr').select('mfr,mfr_pn,items(id,std_code,name)')
      .in('mfr_pn', pns.slice(0, 50)).eq('active', true).neq('item_id', itemId).limit(50)
    same = (data || []).filter(r => r.items).map(r => ({ code: r.items.std_code, name: r.items.name, mfr: r.mfr, mfr_pn: r.mfr_pn }))
  }
  return { mfrs, revs: b.data || [], same, cps: cpsRow || null }
}

// 검색 — 승인 제조사품번 · 제조사명으로 품목 찾기 (기준코드 DB 검색에 보탬)
//   사용 금지 품번으로 찾아도 품목은 나온다 — 화면이 「사용 금지」로 따로 보여 준다
export async function searchItemIdsByMfr(pattern) {
  const v = pgQuote(pattern)
  const { data, error } = await supabase.from('pm_item_mfr').select('item_id')
    .or(`mfr_pn.ilike.${v},mfr.ilike.${v}`).eq('active', true).limit(300)
  if (error) return []
  return [...new Set((data || []).map(r => r.item_id))]
}

export const realPn = (pn) => !!pn && !/^order by description$/i.test(String(pn).trim())

// 상태 → 화면 표시
export function mfrTone(status) {
  if (isDnu(status)) return { label: '사용 금지', cls: 'bg-rose-50 text-rose-600 border-rose-100' }
  if (isMfrObs(status)) return { label: '제조사 단종', cls: 'bg-amber-50 text-amber-700 border-amber-100' }
  if (/prefer/i.test(status || '')) return { label: '우선', cls: 'bg-violet-50 text-violet-700 border-violet-100' }
  if (/approv/i.test(status || '')) return { label: '승인', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
  return { label: status || '—', cls: 'bg-slate-50 text-slate-500 border-slate-200' }
}
const rank = (s) => isDnu(s) ? 4 : isMfrObs(s) ? 3 : /prefer/i.test(s || '') ? 0 : /approv/i.test(s || '') ? 1 : 2
function byMfrRank(a, b) { return rank(a.status) - rank(b.status) || String(a.mfr).localeCompare(String(b.mfr)) }

// 쓸 수 있는 승인 제조사 (사용 금지 · 제조사 단종 빼고)
export const usableMfrs = (list) => (list || []).filter(m => !isDnu(m.status) && !isMfrObs(m.status))

// 우리 대표 제조사품번이 승인 목록에 있는지 — 목록이 없으면 null (판단 안 함)
export function inApproved(item, list) {
  const L = (list || []).filter(m => realPn(m.mfr_pn))
  if (!L.length || !item?.manufacturer_code) return null
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s\-_/.]/g, '')
  const me = norm(item.manufacturer_code)
  const hit = L.find(m => norm(m.mfr_pn) === me)
  if (!hit) return 'none'
  return isDnu(hit.status) ? 'dnu' : isMfrObs(hit.status) ? 'obs' : 'ok'
}

// 검색 화면용 — 검색어(q)가 승인 제조사품번에 걸리는 품목 id → items 조회 .or() 에 덧붙일 조건
export async function mfrSearchCond(q) {
  const t = String(q || '').trim()
  if (t.length < 2) return ''
  const { data, error } = await supabase.from('pm_item_mfr').select('item_id').or(ilikeAny(['mfr_pn'], t)).eq('active', true).limit(200)
  if (error || !data?.length) return ''
  return `id.in.(${[...new Set(data.map(r => r.item_id))].join(',')})`
}

// 검색 결과에 승인 제조사 붙이기 — it.mfrs = [...] (표가 없거나 실패하면 그대로)
export async function attachMfrs(items) {
  if (!items?.length) return items || []
  try {
    const { mfr, cps } = await fetchItemMeta(items.map(i => i.id))
    return items.map(i => ({ ...i, mfrs: mfr[i.id] || [], cps: cps?.[i.id] || null }))
  } catch { return items }
}

const normPn = (s) => String(s || '').toUpperCase().replace(/[\s\-_/.]/g, '')
// 품목 하나의 승인 제조사를 화면용으로 나누기
//   mine  : 우리 대표 제조사품번에 해당하는 줄 (없으면 null)
//   alts  : 그 밖에 써도 되는 것 (우선 · 승인)
//   obs   : 승인은 돼 있지만 제조사 단종
//   dnu   : 고객사 사용 금지
//   hit(q): 검색어가 걸린 줄인지
export function splitMfrs(item, list) {
  const L = (list || []).filter(m => realPn(m.mfr_pn) || m.mfr)
  const me = normPn(item?.manufacturer_code)
  const mine = me ? L.find(m => normPn(m.mfr_pn) === me) || null : null
  const rest = L.filter(m => m !== mine)
  return {
    mine,
    alts: rest.filter(m => !isDnu(m.status) && !isMfrObs(m.status)),
    obs: rest.filter(m => isMfrObs(m.status) && !isDnu(m.status)),
    dnu: rest.filter(m => isDnu(m.status)),
    total: L.length,
  }
}
export const mfrHit = (m, q) => { const t = normPn(q); return t.length >= 2 && normPn(m.mfr_pn).includes(t) }

// CPS 구분 → 화면 표시 (v4.173.0)
export const CPS_INFO = {
  Sole:    { label: 'Sole', ko: '단독 지정', desc: '목록의 제조사 품번 하나만 — 다른 품번 구매 불가', cls: 'border-rose-200 text-rose-600' },
  Limited: { label: 'Limited', ko: '목록 내만', desc: '승인 목록에 있는 제조사 품번만 — 목록 밖 구매 불가', cls: 'border-amber-200 text-amber-700' },
  Generic: { label: 'Generic', ko: '조건부 대체', desc: '목록 외 제조사도 CPS 조건(Acceptability Criteria)을 맞으면 가능', cls: 'border-slate-300 text-slate-500' },
}

// ── 승인 제조사 점검 목록 (v4.174.0) — 기준코드 DB 「🏷 승인 점검」 ─────────────
//   NAS Part Report · CPS 문서에서 읽어 둔 승인 목록과 품목 DB 대표 제조사품번을 맞대어, 손볼 품목을 묶는다.
export const CHECK_GROUPS = [
  { k: 'dnu',     label: '대표 품번 사용 금지', tone: 'red',   note: '고객사가 Do Not Use 로 막은 품번이 대표로 등록됨' },
  { k: 'soleRisk',label: 'Sole 위험',           tone: 'red',   note: 'Sole(단독 지정)인데 대표 품번이 안 맞거나 · 단종 · 쓸 수 있는 승인품이 없음' },
  { k: 'nouse',   label: '쓸 승인품 없음',      tone: 'amber', note: '승인 목록이 전부 사용 금지 · 제조사 단종 — 대체 검토' },
  { k: 'obs',     label: '대표 품번 단종',      tone: 'amber', note: '대표 품번이 제조사 단종(OBS) — 다른 승인품으로 바꿀지' },
  { k: 'none',    label: '승인목록 밖',         tone: 'amber', note: '대표 제조사품번이 고객사 승인 목록에 없음 (표기만 다른 것 포함)' },
  { k: 'blank',   label: '대표 품번 비어 있음', tone: 'blue',  note: '승인 목록은 있는데 품목에 제조사품번이 비어 있음 — 채우면 됨' },
  { k: 'missing', label: '품목 DB 에 없는 품번', tone: 'pr',   note: 'NAS 리포트에는 있는데 기준코드 DB 에 없음 — 신규 등록 후보' },
]
export async function fetchMfrCheck() {
  const { fetchAll } = await import('./paginate')
  const mf = await fetchAll(() => supabase.from('pm_item_mfr').select('id,item_id,mfr,mfr_pn,status').eq('active', true).order('id'))
  const byItem = {}
  for (const m of mf) (byItem[m.item_id] = byItem[m.item_id] || []).push(m)
  const ids = Object.keys(byItem)
  const items = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('items').select('id,std_code,js_code,name,manufacturer,manufacturer_code').in('id', ids.slice(i, i + 200))
    if (error) throw error
    items.push(...(data || []))
  }
  const cps = {}
  const { data: cr } = await supabase.from('pm_item_cps').select('item_id,kind').not('kind', 'is', null).limit(20000)
  for (const r of cr || []) cps[r.item_id] = r.kind
  const out = Object.fromEntries(CHECK_GROUPS.map(g => [g.k, []]))
  for (const it of items) {
    const L = (byItem[it.id] || []).sort(byMfrRank)
    if (!L.some(m => realPn(m.mfr_pn))) continue          // 「품명대로 구매」만 있는 품목은 맞댈 품번이 없다
    const chk = inApproved(it, L)
    const use = usableMfrs(L)
    const row = { ...it, mfrs: L, cps: cps[it.id] || null, chk, usable: use.length }
    if (chk === 'dnu') out.dnu.push(row)
    if (chk === 'obs') out.obs.push(row)
    if (chk === 'none') out.none.push(row)
    if (!String(it.manufacturer_code || '').trim()) out.blank.push(row)
    if (!use.length) out.nouse.push(row)
    if (row.cps === 'Sole' && (chk !== 'ok' || !use.length)) out.soleRisk.push(row)
  }
  // 리포트에만 있는 품번 — 그 사이 등록된 것은 뺀다
  const { data: miss, error: me } = await supabase.from('pm_item_meta_missing').select('code,name,src_code,last_seen').order('code').limit(5000)
  out.missingTable = !me
  if (!me && miss?.length) {
    const have = new Set()
    for (let i = 0; i < miss.length; i += 200) {
      const { data } = await supabase.from('items').select('std_code').in('std_code', miss.slice(i, i + 200).map(m => m.code))
      for (const x of data || []) have.add(x.std_code)
    }
    out.missing = miss.filter(m => !have.has(m.code)).map(m => ({ id: 'm:' + m.code, std_code: m.code, name: m.name || '', src: m.src_code, last_seen: m.last_seen, mfrs: [] }))
  }
  for (const g of CHECK_GROUPS) if (g.k !== 'missing') out[g.k].sort((a, b) => String(a.std_code).localeCompare(String(b.std_code)))
  out.total = items.length
  return out
}
