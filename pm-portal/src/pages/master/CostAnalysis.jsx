import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../../hooks/useProfile'
import { orderedCustomers, primaryCsCode } from '../../lib/customers'
import { useCustomer } from '../../hooks/useCustomers'
import {
  explodeBOM, computeCost, suggestPrice, calcMargin, fxScenario, tierMargin, DEFAULT_CFG,
} from '../../lib/costAnalysis'

const won = n => (Math.round(Number(n) || 0)).toLocaleString()
const usd = n => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = n => ((Number(n) || 0) * 100).toFixed(1) + '%'

async function fetchAssemblies(csId) {
  if (!csId) return []
  const { data, error } = await supabase.rpc('get_bom_assemblies', { cs_id: csId })
  if (error) throw error
  return (data || []).map(p => ({ id: p.id, code: p.code, name: p.name || '', itemCount: Number(p.item_count) || 0 }))
}

async function fetchCostBOM(csId, projectId) {
  if (!csId || !projectId) return []
  const { data, error } = await supabase
    .from('bom')
    .select('level, qty_per_unit, seq, created_at, items!bom_item_id_fkey(std_code, name, purchase_price, vendor_id, vendors(name))')
    .eq('customer_id', csId).eq('project_id', projectId)
    .order('seq').order('created_at')
  if (error) throw error
  return data || []
}

export default function CostAnalysis() {
  const { data: profile } = useMyProfile()
  const custList = orderedCustomers(profile)
  const [csCode, setCsCode] = useState(null)
  const code = csCode || primaryCsCode(profile)
  const { data: cs } = useCustomer(code)

  const { data: assemblies = [] } = useQuery({
    queryKey: ['ca-assemblies', cs?.id], queryFn: () => fetchAssemblies(cs?.id), enabled: !!cs?.id,
  })
  const [projectId, setProjectId] = useState('')
  const [asmSearch, setAsmSearch] = useState('')
  const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '')
  const filteredAsm = asmSearch.trim()
    ? assemblies.filter(a => normCode(a.code + ' ' + (a.name || '')).includes(normCode(asmSearch)))
    : assemblies
  const { data: bomRows = [], isLoading } = useQuery({
    queryKey: ['ca-bom', cs?.id, projectId], queryFn: () => fetchCostBOM(cs?.id, projectId), enabled: !!cs?.id && !!projectId,
  })

  // 설정값
  const [buyRate, setBuyRate] = useState(DEFAULT_CFG.buyRate)
  const [sellRate, setSellRate] = useState(DEFAULT_CFG.sellRate)
  const [laborKrw, setLaborKrw] = useState(0)
  const [targetUsd, setTargetUsd] = useState('')   // 비우면 권장가 사용
  const cfg = { ...DEFAULT_CFG, buyRate: Number(buyRate) || 1, sellRate: Number(sellRate) || 1 }

  // 사용자 토글 (제외)
  const [excludeMap, setExcludeMap] = useState({})  // {uid: bool}

  const exploded = useMemo(() => {
    const mapped = bomRows.map((b, i) => ({
      uid: i, level: b.level, qty_per_unit: b.qty_per_unit,
      std_code: b.items?.std_code || '', name: b.items?.name || '',
      purchase_price: b.items?.purchase_price ?? null,
      vendor: b.items?.vendors?.name || '',
      registered: !!b.items,
    }))
    const ex = explodeBOM(mapped)
    return ex.map(r => ({ ...r, excluded: excludeMap[r.uid] != null ? excludeMap[r.uid] : r.excluded }))
  }, [bomRows, excludeMap])

  const cost = useMemo(() => computeCost(exploded, cfg, {}, Number(laborKrw) || 0), [exploded, buyRate, laborKrw])
  const suggested = useMemo(() => suggestPrice(cost.items, cfg, Number(laborKrw) || 0), [cost, sellRate, laborKrw])

  const targetNum = parseFloat(targetUsd)
  const usingTarget = !isNaN(targetNum) && targetNum > 0
  const sellUsd = usingTarget ? targetNum : suggested
  const margin = calcMargin({ sellUsd, totalBuyKrw: cost.totalBuyKrw, impUsd: cost.impUsd, sellRate: cfg.sellRate })
  const fx = fxScenario({ sellUsd, domKrw: cost.domKrw, laborKrw: cost.laborKrw, impUsd: cost.impUsd, baseBuyRate: cfg.buyRate, sellRate: cfg.sellRate })

  const toggleExclude = (uid, cur) => setExcludeMap(m => ({ ...m, [uid]: !cur }))

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">💵 원가분석</h1>
          <p className="text-xs text-slate-400">BOM을 펼쳐 매입원가를 합산 → 매출가 적정성·마진 검토</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={code} onChange={e => { setCsCode(e.target.value); setProjectId('') }}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
            {custList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={asmSearch} onChange={e => setAsmSearch(e.target.value)}
            placeholder="코드/품명 검색 (예: 110134250)"
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 w-48" />
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setExcludeMap({}) }}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white min-w-[220px]">
            <option value="">어셈블리 선택… ({filteredAsm.length})</option>
            {filteredAsm.map(a => <option key={a.id} value={a.id}>{a.code} {a.name ? `· ${a.name}` : ''} ({a.itemCount})</option>)}
          </select>
        </div>
      </div>

      {/* 설정값 */}
      <div className="flex items-end gap-3 flex-wrap bg-slate-50 rounded-xl p-3">
        <Field label="기준매입환율"><input type="number" value={buyRate} onChange={e => setBuyRate(e.target.value)} className="w-24 px-2 py-1.5 text-sm text-right rounded border border-slate-200" /></Field>
        <Field label="판매환율"><input type="number" value={sellRate} onChange={e => setSellRate(e.target.value)} className="w-24 px-2 py-1.5 text-sm text-right rounded border border-slate-200" /></Field>
        <Field label="작업비(원)"><input type="number" value={laborKrw} onChange={e => setLaborKrw(e.target.value)} className="w-28 px-2 py-1.5 text-sm text-right rounded border border-slate-200" /></Field>
        <Field label="목표 매출가($) — 비우면 권장가"><input type="number" value={targetUsd} onChange={e => setTargetUsd(e.target.value)} placeholder={suggested ? usd(suggested) : '권장가'} className="w-36 px-2 py-1.5 text-sm text-right rounded border border-slate-200" /></Field>
      </div>

      {!projectId && <div className="text-center text-slate-400 text-sm py-12">어셈블리를 선택하면 원가가 분석됩니다.</div>}
      {projectId && isLoading && <div className="text-center text-slate-400 text-sm py-12">불러오는 중…</div>}

      {projectId && !isLoading && (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="총 매입원가" value={won(cost.totalBuyKrw) + '원'} sub={`수입 ${won(cost.impKrw)} · 국내 ${won(cost.domKrw)} · 작업 ${won(cost.laborKrw)}`} />
            <Card label={usingTarget ? '목표 매출가' : '권장 판매가'} value={'$' + usd(sellUsd)} sub={usingTarget ? '입력값 기준' : '구간마진 자동'} accent={usingTarget ? 'amber' : 'sky'} />
            <Card label="매출 (KRW)" value={won(margin.revenueKrw) + '원'} sub={`@${cfg.sellRate}`} />
            <Card label="마진" value={won(margin.marginKrw) + '원'} sub={pct(margin.marginPct)} accent={margin.marginKrw >= 0 ? 'emerald' : 'rose'} />
          </div>

          {/* 환율 시나리오 */}
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-bold text-slate-500 mb-2">환율 시나리오 (판매환율 변동 시 마진)</div>
            <div className="flex gap-2 flex-wrap">
              {fx.map(s => (
                <div key={s.delta} className={`px-3 py-2 rounded-lg border text-sm ${s.delta === 0 ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="text-[11px] text-slate-400">{s.delta >= 0 ? '현재' : `${s.delta}원`} @{s.rate}</div>
                  <div className="font-bold text-slate-700">{won(s.marginKrw)}원</div>
                  <div className={`text-xs font-semibold ${s.marginPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{pct(s.marginPct)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 품목 테이블 */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="px-2 py-2 text-left">LV</th>
                  <th className="px-2 py-2 text-left">코드</th>
                  <th className="px-2 py-2 text-left">품명</th>
                  <th className="px-2 py-2 text-right">매입가</th>
                  <th className="px-2 py-2 text-right">전개수량</th>
                  <th className="px-2 py-2 text-center">수입/국내</th>
                  <th className="px-2 py-2 text-right">소계(원)</th>
                  <th className="px-2 py-2 text-center">제외</th>
                </tr>
              </thead>
              <tbody>
                {cost.items.map(r => (
                  <tr key={r.uid} className={`border-t border-slate-100 ${r.excluded ? 'opacity-40' : ''} ${r.status === 'noprice' ? 'bg-amber-50' : ''} ${r.status === 'unreg' ? 'bg-rose-50' : ''}`}>
                    <td className="px-2 py-1.5 text-slate-400">{r.level}</td>
                    <td className="px-2 py-1.5 font-mono text-xs" style={{ paddingLeft: `${8 + (Number(r.level) || 0) * 12}px` }}>{r.std_code || '—'}</td>
                    <td className="px-2 py-1.5 text-slate-600 max-w-[260px] truncate" title={r.name}>{r.name}</td>
                    <td className="px-2 py-1.5 text-right">{r.buyKrw == null ? <span className="text-amber-500 text-xs">미등록가</span> : won(r.buyKrw)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{r.qty}</td>
                    <td className="px-2 py-1.5 text-center text-xs">{r.origin === 'imp' ? <span className="text-blue-500">수입</span> : <span className="text-slate-400">국내</span>}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{r.counted ? won(r.buyKrwTotal) : '—'}</td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={!!r.excluded} onChange={() => toggleExclude(r.uid, r.excluded)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            · L0(KIT 자체)·제외 품목은 합산에서 빠집니다 (상하위 중복 방지). · <span className="text-amber-500">노랑=매입가 미등록</span>, <span className="text-rose-400">빨강=품목 미등록</span>.
            · 수입품은 매입가(원)를 기준매입환율로 나눠 달러원가로 환산해 환율 시나리오에 반영합니다.
          </p>
        </>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-slate-400">{label}</span>{children}</label>
}
function Card({ label, value, sub, accent }) {
  const ac = { emerald: 'text-emerald-600', rose: 'text-rose-600', sky: 'text-sky-600', amber: 'text-amber-600' }[accent] || 'text-slate-800'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${ac}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}
