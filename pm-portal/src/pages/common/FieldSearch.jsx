import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// 🏭 현장 검색 — 민감정보(재고·구매처·단가·고객사코드) 제외
//    노출: 품명·구분·제조사·제조사품번·위치 + 역전개 + BOM
const CUST_PREFIX = { ax: 'AXCELIS', csk: 'CSK', ed: 'Edwards', vm: 'VM' }
const prefixOf = code => (code || '').split('-')[0]?.slice(0, 2)?.toLowerCase()

// ── 제품 검색 (위치 포함, 재고·구매처 제외) ──
async function searchItems(q) {
  if (!q.trim()) return []
  const { data, error } = await supabase.from('items')
    .select('id,std_code,name,type,unit,manufacturer,manufacturer_code,spec')
    .or(`std_code.ilike.%${q}%,name.ilike.%${q}%,manufacturer.ilike.%${q}%,manufacturer_code.ilike.%${q}%,spec.ilike.%${q}%`)
    .limit(200)
  if (error) throw error
  const ids = (data || []).map(d => d.id)
  const locMap = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data: inv } = await supabase.from('inventory').select('item_id,location').in('item_id', ids.slice(i, i + 200))
    ;(inv || []).forEach(r => {
      if (r.location) {
        if (!locMap[r.item_id]) locMap[r.item_id] = new Set()
        locMap[r.item_id].add(r.location)
      }
    })
  }
  return (data || []).map(d => ({ ...d, location: locMap[d.id] ? [...locMap[d.id]].join(', ') : '' }))
}

// ── 자동완성 (2글자↑, 상위 8건) ──
async function suggestItems(q) {
  if (!q || q.trim().length < 2) return []
  const { data } = await supabase.from('items')
    .select('id,std_code,name,type,manufacturer_code')
    .or(`std_code.ilike.%${q}%,name.ilike.%${q}%,manufacturer_code.ilike.%${q}%`)
    .limit(8)
  return data || []
}

// ── 역전개 ──
async function whereUsedAll(q) {
  if (!q.trim()) return []
  const { data, error } = await supabase.rpc('get_where_used_all', { q })
  if (error) throw error
  return data || []
}

// ── BOM 조회 (어셈블리 코드 → 프로젝트 → BOM 전개) ──
async function fetchBOMByCode(code) {
  if (!code || !code.trim()) return { rows: [], assembly: null }
  const { data: projs } = await supabase.from('projects').select('id,customer_id,code,rev').eq('code', code.trim()).limit(1)
  const proj = projs && projs[0]
  if (!proj) return { rows: [], assembly: null }
  const { data } = await supabase.from('bom')
    .select('seq,qty_per_unit, items!bom_item_id_fkey(std_code,name,type,unit,manufacturer,manufacturer_code)')
    .eq('customer_id', proj.customer_id).eq('project_id', proj.id)
    .order('seq').order('created_at')
  return { rows: data || [], assembly: proj }
}

export default function FieldSearch() {
  const [tab, setTab] = useState('product')

  // 제품 검색
  const [pq, setPq] = useState('')
  const [pSubmitted, setPSubmitted] = useState('')
  const [showSug, setShowSug] = useState(false)

  // 자동완성 (디바운스)
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(pq), 250); return () => clearTimeout(t) }, [pq])
  const { data: suggestions = [] } = useQuery({
    queryKey: ['fieldSuggest', debounced], queryFn: () => suggestItems(debounced), enabled: debounced.trim().length >= 2,
  })

  const { data: items = [], isLoading: pLoading } = useQuery({
    queryKey: ['fieldProduct', pSubmitted], queryFn: () => searchItems(pSubmitted), enabled: !!pSubmitted.trim(),
  })

  // 역전개
  const [rq, setRq] = useState(''); const [rSubmitted, setRSubmitted] = useState('')
  const { data: used = [], isLoading: rLoading } = useQuery({
    queryKey: ['fieldWhereUsed', rSubmitted], queryFn: () => whereUsedAll(rSubmitted), enabled: !!rSubmitted.trim(),
  })
  const grouped = (() => {
    const m = {}
    used.forEach(r => {
      const k = r.child_code
      if (!m[k]) m[k] = { child_code: r.child_code, child_name: r.child_name, mfg: r.manufacturer, mfgpn: r.manufacturer_code, parents: [] }
      m[k].parents.push(r)
    })
    return Object.values(m)
  })()

  // BOM 조회
  const [bq, setBq] = useState(''); const [bSubmitted, setBSubmitted] = useState('')
  const { data: bom = { rows: [], assembly: null }, isLoading: bLoading } = useQuery({
    queryKey: ['fieldBOM', bSubmitted], queryFn: () => fetchBOMByCode(bSubmitted), enabled: !!bSubmitted.trim(),
  })

  function openBOM(code) { setBq(code); setBSubmitted(code); setTab('bom') }
  function pickSuggestion(s) { setPq(s.std_code); setPSubmitted(s.std_code); setShowSug(false) }

  const TABS = [['product', '🔎 제품 검색'], ['where', '🔍 역전개 (사용처)'], ['bom', '📋 BOM 조회']]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🏭 현장 검색</h1>
        <p className="text-xs text-slate-400 mt-0.5">품목 정보·사용처·BOM 조회 (현장용)</p>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {/* 제품 검색 */}
      {tab === 'product' && (
        <>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input value={pq}
                onChange={e => { setPq(e.target.value); setShowSug(true) }}
                onKeyDown={e => { if (e.key === 'Enter') { setPSubmitted(pq); setShowSug(false) } }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 150)}
                placeholder="품명·기준코드·제조사·제조사품번·규격 검색 (2글자↑ 자동완성)"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {showSug && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                  {suggestions.map(s => (
                    <button key={s.id} onMouseDown={() => pickSuggestion(s)}
                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-indigo-600">{s.std_code}</span>
                        {s.type && <span className="px-1 rounded text-[9px] font-bold bg-slate-100 text-slate-400">{s.type}</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{s.name}{s.manufacturer_code ? ` · ${s.manufacturer_code}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { setPSubmitted(pq); setShowSug(false) }} disabled={!pq.trim()}
              className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">검색</button>
          </div>

          {pSubmitted && (pLoading
            ? <div className="text-center py-10 text-slate-400 text-sm">검색 중...</div>
            : items.length === 0
              ? <div className="text-center py-12 text-slate-300 text-sm">결과가 없습니다</div>
              : <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-400">
                        {['기준코드', '품명', '구분', '제조사', '제조사품번', '규격', '위치', 'BOM'].map(h =>
                          <th key={h} className="px-3 py-2 text-left font-bold">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {items.map(it => (
                          <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-indigo-600">{it.std_code}</td>
                            <td className="px-3 py-2 text-slate-700 max-w-[240px] truncate">{it.name}</td>
                            <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${it.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>{it.type || '-'}</span></td>
                            <td className="px-3 py-2 text-slate-600">{it.manufacturer || '-'}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{it.manufacturer_code || '-'}</td>
                            <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate" title={it.spec}>{it.spec || '-'}</td>
                            <td className="px-3 py-2 font-semibold text-slate-700">{it.location || '-'}</td>
                            <td className="px-3 py-2">
                              <button onClick={() => openBOM(it.std_code)} className="text-[11px] text-indigo-500 hover:underline font-semibold">전개 ↗</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>)}
        </>
      )}

      {/* 역전개 */}
      {tab === 'where' && (
        <>
          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-bold text-slate-700">부품 → 사용처 (전 고객사 BOM)</p>
            <p className="text-[11px] text-slate-400">기준코드·제조사품번·품명 입력 → 그 부품이 들어가는 어셈블리 표시</p>
            <div className="flex gap-2">
              <input value={rq} onChange={e => setRq(e.target.value)} onKeyDown={e => e.key === 'Enter' && setRSubmitted(rq)}
                placeholder="기준코드 / 제조사품번 / 품명"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={() => setRSubmitted(rq)} disabled={!rq.trim()}
                className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">검색</button>
            </div>
          </div>

          {rSubmitted && (rLoading
            ? <div className="text-center py-10 text-slate-400 text-sm">검색 중...</div>
            : grouped.length === 0
              ? <div className="text-center py-12 text-slate-300 text-sm">사용처가 없습니다</div>
              : <div className="space-y-3">
                  {grouped.map((g, gi) => (
                    <div key={gi} className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-indigo-600 text-sm">{g.child_code}</span>
                        <span className="text-xs text-slate-500">{g.child_name}</span>
                        {g.mfgpn && <span className="font-mono text-[11px] text-slate-400">· {g.mfg} {g.mfgpn}</span>}
                        <span className="ml-auto text-xs text-slate-400">{g.parents.length}개 어셈블리</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs whitespace-nowrap">
                          <thead><tr className="border-b border-slate-100 text-slate-400">
                            {['고객사', '상위 어셈블리 (클릭→BOM)', '어셈블리명', '소요량', '레벨'].map(h =>
                              <th key={h} className="px-3 py-2 text-left font-bold">{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {g.parents.map((p, pi) => (
                              <tr key={pi} className="border-b border-slate-50 hover:bg-slate-50">
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                                    {CUST_PREFIX[prefixOf(p.parent_code)] || prefixOf(p.parent_code)?.toUpperCase() || '?'}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <button onClick={() => openBOM(p.parent_code)} className="font-mono text-xs font-bold text-indigo-600 hover:underline">{p.parent_code} ↗</button>
                                </td>
                                <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate">{p.parent_name}</td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-800">{p.qty}</td>
                                <td className="px-3 py-2 text-slate-400">L{p.level ?? '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>)}
        </>
      )}

      {/* BOM 조회 */}
      {tab === 'bom' && (
        <>
          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-bold text-slate-700">어셈블리 BOM 조회</p>
            <p className="text-[11px] text-slate-400">어셈블리(제품) 기준코드 입력 → 구성 부품 표시. 제품검색·역전개에서 "전개 ↗" 클릭으로도 진입</p>
            <div className="flex gap-2">
              <input value={bq} onChange={e => setBq(e.target.value)} onKeyDown={e => e.key === 'Enter' && setBSubmitted(bq)}
                placeholder="어셈블리 기준코드 (예: AX-110134250)"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={() => setBSubmitted(bq)} disabled={!bq.trim()}
                className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">조회</button>
            </div>
          </div>

          {bSubmitted && (bLoading
            ? <div className="text-center py-10 text-slate-400 text-sm">조회 중...</div>
            : !bom.assembly
              ? <div className="text-center py-12 text-slate-300 text-sm">해당 어셈블리를 찾을 수 없습니다</div>
              : bom.rows.length === 0
                ? <div className="text-center py-12 text-slate-300 text-sm">등록된 BOM이 없습니다</div>
                : <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-indigo-600 text-sm">{bom.assembly.code}</span>
                      {bom.assembly.rev && <span className="text-[11px] text-slate-400">Rev {bom.assembly.rev}</span>}
                      <span className="ml-auto text-xs text-slate-400">{bom.rows.length}개 부품</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs whitespace-nowrap">
                        <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-400">
                          {['No', '기준코드', '품명', '구분', '제조사', '제조사품번', '단위', '소요량'].map(h =>
                            <th key={h} className="px-3 py-2 text-left font-bold">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {bom.rows.map((r, i) => {
                            const it = r.items || {}
                            return (
                              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-2 text-center text-slate-400">{i + 1}</td>
                                <td className="px-3 py-2 font-mono text-indigo-600">{it.std_code || '-'}</td>
                                <td className="px-3 py-2 text-slate-700 max-w-[220px] truncate">{it.name || '-'}</td>
                                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${it.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>{it.type || '-'}</span></td>
                                <td className="px-3 py-2 text-slate-600">{it.manufacturer || '-'}</td>
                                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{it.manufacturer_code || '-'}</td>
                                <td className="px-3 py-2 text-slate-500">{it.unit || '-'}</td>
                                <td className="px-3 py-2 text-right font-bold text-slate-800">{r.qty_per_unit}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>)}
        </>
      )}
    </div>
  )
}
