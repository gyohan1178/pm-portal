import ItemLink from '../../components/ItemLink'
import { codeCandidates } from '../../lib/custPrefix'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { ResizableTable } from '../../components/ResizableTable'

const MP_COLS = [
  { key:'cs',     label:'고객사',    defaultWidth:70  },
  { key:'pn',     label:'품번',      defaultWidth:120 },
  { key:'hogi',   label:'호기',      defaultWidth:70  },
  { key:'part',   label:'결품 품목', defaultWidth:220 },
  { key:'need',   label:'필요',      defaultWidth:70, style:{textAlign:'right'} },
  { key:'stock',  label:'재고',      defaultWidth:70, style:{textAlign:'right'} },
  { key:'status', label:'상태',      defaultWidth:100 },
]

// 미불출 모아보기 (2026-10-08)
//   · 전 고객사 (예전엔 AXCELIS 만) · 완료된 호기는 뺀다 · 1,000줄에서 잘리지 않게 끝까지 읽는다
//   · 미불출은 저장 모양이 세 가지다 — 출고 연동 {std_code,name,qty,item_id} · 호기 편집 {pn(AX- 없음),name,maker,qty}
//     · CSV {pn,expectedDate} → 품번을 하나로 맞추고, 재고는 품번으로 찾는다 (item_id 가 없는 줄도 재고가 보이게)
//   v4.57.0: 호기 편집으로 넣은 품번은 접두 없이 저장된다 → [고객사 접두+품번, 품번] 둘 다 찾아 있는 쪽으로 (예전엔 AX 만 접두를 붙여 Edwards · VM · CSK 재고가 0 으로 보였다)
const candsOf = (m, cs) => m.std_code ? [String(m.std_code).trim()] : codeCandidates(m.pn, cs)
async function fetchMissing() {
  const prod = await fetchAll(() => supabase.from('production')
    .select('id,pn,hogi,name,missing_parts,req_date,status,customer_code')
    .order('id'))
  const rows = []
  for (const p of (prod || [])) {
    if (p.status === '완료') continue
    const mp = Array.isArray(p.missing_parts) ? p.missing_parts : []
    for (const m of mp) {
      if (!m) continue
      rows.push({
        prodId: p.id, cs: p.customer_code || 'AX', pn: p.pn, hogi: p.hogi, prodName: p.name, reqDate: p.req_date,
        item_id: m.item_id || null, _cands: candsOf(m, p.customer_code), name: m.name || '', need: Number(m.qty) || 0,
        due: m.expectedDate || m.date || null,
      })
    }
  }
  // 재고 — item_id 가 없으면 품번으로 품목을 찾아 붙인다
  const codes = [...new Set(rows.filter(r => !r.item_id).flatMap(r => r._cands))]
  const idOf = {}
  for (let i = 0; i < codes.length; i += 300) {
    const { data, error } = await supabase.from('items').select('id,std_code,name').in('std_code', codes.slice(i, i + 300))
    if (error) throw error
    ;(data || []).forEach(x => { idOf[x.std_code] = x })
  }
  rows.forEach(r => {
    const hit = r._cands.find(c => idOf[c])
    r.std_code = hit || r._cands[0] || ''
    if (!r.item_id && hit) { r.item_id = idOf[hit].id; if (!r.name) r.name = idOf[hit].name }
    delete r._cands
  })
  const ids = [...new Set(rows.map(r => r.item_id).filter(Boolean))]
  const invMap = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data: inv, error } = await supabase.from('inventory').select('item_id,qty').in('item_id', ids.slice(i, i + 300))
    if (error) throw error
    ;(inv || []).forEach(x => { invMap[x.item_id] = (invMap[x.item_id] || 0) + (Number(x.qty) || 0) })
  }
  return rows.map(r => {
    const stock = invMap[r.item_id] ?? 0
    return { ...r, stock, ready: stock >= r.need && r.need > 0 }
  })
}

export default function MissingParts() {
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['missingParts'], queryFn: fetchMissing })

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (b.ready - a.ready) || String(a.pn).localeCompare(String(b.pn))), [rows])
  const readyCnt = rows.filter(r => r.ready).length
  const hogiCnt = new Set(rows.map(r => r.prodId)).size

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">결품 현황</h1>
        <p className="text-xs text-slate-400 mt-0.5">불출 못 한 부품 모아보기 (전 고객사 · 완료 호기 제외) · 재불출은 출고 작업 화면에서</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-600">결품 {rows.length}건</span>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500">호기 {hogiCnt}대</span>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">입고됨 · 재불출 가능 {readyCnt}건</span>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">불러오지 못했습니다 — {error.message}</p>}
      {isLoading ? (
        <div className="border border-slate-200 rounded-xl"><p className="px-3 py-8 text-center text-sm text-slate-400">불러오는 중…</p></div>
      ) : rows.length === 0 ? (
        <div className="border border-slate-200 rounded-xl"><p className="px-3 py-8 text-center text-sm text-slate-400">결품이 없습니다 👍</p></div>
      ) : (
        <ResizableTable cols={MP_COLS} storageKey="missing_cols">
          {() => (
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className={`border-t border-slate-100 ${r.ready ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-3 py-2 text-[11px] font-bold text-slate-500 overflow-hidden truncate">{r.cs}</td>
                  <td className="px-3 py-2 font-mono text-slate-500 overflow-hidden truncate">{r.pn}</td>
                  <td className="px-3 py-2 font-mono font-bold text-indigo-600 overflow-hidden truncate">{r.hogi}</td>
                  <td className="px-3 py-2 overflow-hidden truncate"><ItemLink code={r.std_code} className="font-mono font-semibold text-slate-700" /> <span className="text-slate-500">{r.name}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.need}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.stock <= 0 ? 'text-red-500' : 'text-slate-600'}`}>{r.stock}</td>
                  <td className="px-3 py-2">
                    {r.ready
                      ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">재불출 가능</span>
                      : <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700">입고 대기</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </ResizableTable>
      )}
    </div>
  )
}
