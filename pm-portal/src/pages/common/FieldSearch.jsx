import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// 🏭 현장 검색 — 민감정보(재고·구매처·단가·고객사코드) 제외
//    노출: 품명·구분·제조사·제조사품번·위치 + 역전개 + BOM
const CUST_PREFIX = { ax: 'AXCELIS', csk: 'CSK', ed: 'Edwards', vm: 'VM' }
const prefixOf = code => (code || '').split('-')[0]?.slice(0, 2)?.toLowerCase()

async function searchItems(q) {
  if (!q.trim()) return []
  const { data, error } = await supabase.from('items')
    .select('id,std_code,name,type,unit,manufacturer,manufacturer_code,spec')
    .or(`std_code.ilike.%${q}%,name.ilike.%${q}%,manufacturer.ilike.%${q}%,manufacturer_code.ilike.%${q}%,spec.ilike.%${q}%`)
    .limit(200)
  if (error) throw error
  // 위치만 수집 (재고 수량은 노출 안 함)
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
  return (data || []).map(d => ({
    ...d,
    location: locMap[d.id] ? [...locMap[d.id]].join(', ') : '',
  }))
}

async function whereUsedAll(q) {
  if (!q.trim()) return []
  const { data, error } = await supabase.rpc('get_where_used_all', { q })
  if (error) throw error
  return data || []
}

export default function FieldSearch() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('product')
  const [pq, setPq] = useState(''); const [pSubmitted, setPSubmitted] = useState('')
  const [rq, setRq] = useState(''); const [rSubmitted, setRSubmitted] = useState('')

  const { data: items = [], isLoading: pLoading } = useQuery({
    queryKey: ['fieldProduct', pSubmitted], queryFn: () => searchItems(pSubmitted), enabled: !!pSubmitted.trim(),
  })
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

  function goBOM(parentCode) {
    const pf = prefixOf(parentCode) === 'ax' ? 'ax' : prefixOf(parentCode)
    navigate(`/customer/${pf}/bom?assembly=${encodeURIComponent(parentCode)}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🏭 현장 검색</h1>
        <p className="text-xs text-slate-400 mt-0.5">품목 정보·사용처·BOM 조회 (현장용)</p>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['product', '🔎 제품 검색'], ['where', '🔍 역전개 (사용처)']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {/* 제품 검색 */}
      {tab === 'product' && (
        <>
          <div className="flex gap-2">
            <input value={pq} onChange={e => setPq(e.target.value)} onKeyDown={e => e.key === 'Enter' && setPSubmitted(pq)}
              placeholder="품명·기준코드·제조사·제조사품번·규격 검색"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={() => setPSubmitted(pq)} disabled={!pq.trim()}
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
                        {['기준코드', '품명', '구분', '제조사', '제조사품번', '규격', '위치'].map(h =>
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
                                  <button onClick={() => goBOM(p.parent_code)} className="font-mono text-xs font-bold text-indigo-600 hover:underline">{p.parent_code} ↗</button>
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
    </div>
  )
}
