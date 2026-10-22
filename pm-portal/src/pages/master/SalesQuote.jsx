import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../../hooks/useProfile'
import { orderedCustomers, primaryCsCode } from '../../lib/customers'
import { useCustomer } from '../../hooks/useCustomers'
import { DEFAULT_CFG } from '../../lib/costAnalysis'
import QuoteSheet from './QuoteSheet'
import QuoteHistory from './QuoteHistory'
import { fetchQuoteMarginCfg, QUOTE_CFG_KEY } from '../../lib/quoteSettings'

const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')

// 고객사에 제출할 견적서를 작성·저장·출력하는 화면.
// 업체에서 받은 매입단가는 '매입견적' 탭에서 등록한다.
// 탭마다 종류가 고정돼 있어 저장 단계에서 헷갈릴 여지가 없다.
export default function SalesQuote() {
  const { data: profile } = useMyProfile()
  const custList = orderedCustomers(profile)
  const [tab, setTab] = useState('write')   // write=견적 작성 / history=견적 이력
  const [csCode, setCsCode] = useState(null)
  // 견적 이력 「✏ 수정」 → 작성 탭으로 넘어가 그 견적을 불러온다 (n: 같은 견적을 다시 눌러도 다시 불러오게)
  const [reviseReq, setReviseReq] = useState(null)
  const code = csCode || primaryCsCode(profile)
  const { data: cs } = useCustomer(code)

  const [buyRate, setBuyRate] = useState(DEFAULT_CFG.buyRate)
  const [sellRate, setSellRate] = useState(DEFAULT_CFG.sellRate)
  // 기준 환율 — ⚙ 마진구간에서 고정한 값으로 시작한다 (모든 PC 공통 · v4.86.0)
  //   화면 칸에서 고친 값은 이 견적에만. 기준을 다시 저장하면 그 값으로 맞춘다.
  const { data: qcfg } = useQuery({ queryKey: QUOTE_CFG_KEY, queryFn: fetchQuoteMarginCfg, staleTime: 10 * 60 * 1000 })
  const baseBuy = qcfg?.buyRate || DEFAULT_CFG.buyRate
  const baseSell = qcfg?.sellRate || DEFAULT_CFG.sellRate
  useEffect(() => { setBuyRate(baseBuy); setSellRate(baseSell) }, [baseBuy, baseSell])
  const offBase = Number(buyRate) !== Number(baseBuy) || Number(sellRate) !== Number(baseSell)
  const cfg = { ...DEFAULT_CFG, buyRate: Number(buyRate) || 1, sellRate: Number(sellRate) || 1 }

  // 최근 매출견적 (같은 건을 다시 견적할 때 참고)
  const { data: recent = [] } = useQuery({
    queryKey: ['recentSalesQuotes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pm_quotes')
        .select('id, quote_no, quote_date, issued_to, currency, total_amount, project_name')
        .eq('quote_kind', 'sales')
        .order('quote_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10)
      return data || []
    },
    staleTime: 60 * 1000,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📤 매출견적</h1>
          <p className="page-desc text-xs text-slate-400">
고객사에 제출할 견적서를 작성하고 지난 견적을 조회합니다. 업체 매입단가는 구매 → <b>품목 단가 등록</b>에서 관리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {[['write', '✍ 견적 작성'], ['history', '📋 견적 이력']].map(([k, l]) => (
              <button key={k} onClick={() => { setTab(k); if (k === 'history') setReviseReq(null) }}
                className={`px-3 py-1.5 text-xs font-bold rounded-md ${tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <select value={code} onChange={(e) => setCsCode(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
            {custList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {tab === 'write' && <Field label="매입환율">
            <input type="number" value={buyRate} onChange={(e) => setBuyRate(e.target.value)}
              className="w-24 px-2 py-1.5 text-sm text-right rounded border border-slate-200" />
          </Field>}
          {tab === 'write' && <Field label="판매환율">
            <input type="number" value={sellRate} onChange={(e) => setSellRate(e.target.value)}
              className="w-24 px-2 py-1.5 text-sm text-right rounded border border-slate-200" />
          </Field>}
          {tab === 'write' && (offBase ? (
            <button type="button" data-rate-reset onClick={() => { setBuyRate(baseBuy); setSellRate(baseSell) }}
              title={`기준 환율(매입 ${baseBuy} · 판매 ${baseSell})로 되돌립니다 — 기준은 견적서의 ⚙ 마진구간에서 고정`}
              className="self-end mb-0.5 px-2 py-1.5 text-[11px] font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50">↺ 기준 {Number(baseBuy).toLocaleString()} · {Number(baseSell).toLocaleString()}</button>
          ) : (
            <span data-rate-base className="self-end mb-1.5 text-[10px] text-slate-400" title="기준 환율은 견적서의 ⚙ 마진구간에서 고정합니다 (모든 PC 공통)">📌 기준 환율</span>
          ))}
        </div>
      </div>

      {tab === 'history' ? <QuoteHistory onRevise={(q) => { setReviseReq({ id: q.id, n: Date.now() }); setTab('write') }} /> : (
      <QuoteSheet
        fixedKind="sales"
        reviseReq={reviseReq}
        onReviseLoaded={async (q) => {
          setReviseReq(null)   // 탭을 오가도 다시 불러와 덮어쓰지 않게
          // 그 견적의 고객사 · 환율로 맞춘다 (마진 표시 · 품번 추가가 같은 기준으로 돌게)
          if (Number(q.sell_rate) > 0) setSellRate(q.sell_rate)
          if (Number(q.buy_rate) > 0) setBuyRate(q.buy_rate)
          if (q.customer_id) {
            const { data } = await supabase.from('customers').select('code').eq('id', q.customer_id).maybeSingle()
            if (data?.code) setCsCode(String(data.code).toLowerCase())
          }
        }}
        customerId={cs?.id}
        customerName={custList.find((c) => c.id === code)?.name || ''}
        cfg={cfg}
      />
      )}

      {/* 최근 등록분 — 중복 입력 방지용 */}
      {tab === 'write' && !!recent.length && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-bold text-slate-500 mb-2">최근 작성한 매출견적</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1.5 text-left">견적번호</th>
                  <th className="py-1.5 text-left">일자</th>
                  <th className="py-1.5 text-left">고객사</th>
                  <th className="py-1.5 text-left">건명</th>
                  <th className="py-1.5 text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((q) => (
                  <tr key={q.id} className="border-t border-slate-100">
                    <td className="py-1.5 font-mono font-bold text-indigo-600">{q.quote_no}</td>
                    <td className="py-1.5 text-slate-500">{q.quote_date}</td>
                    <td className="py-1.5 text-slate-700">{q.issued_to || '-'}</td>
                    <td className="py-1.5 text-slate-500">{q.project_name || '-'}</td>
                    <td className="py-1.5 text-right font-semibold">
                      {q.currency === 'KRW' ? '₩' + won(q.total_amount) : '$' + (Number(q.total_amount) || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      {children}
    </label>
  )
}
