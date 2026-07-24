import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMyProfile } from '../../hooks/useProfile'
import { orderedCustomers, primaryCsCode } from '../../lib/customers'
import { useCustomer } from '../../hooks/useCustomers'
import { DEFAULT_CFG } from '../../lib/costAnalysis'
import QuoteSheet from './QuoteSheet'

const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')

// 협력업체가 보내온 견적을 그대로 입력해 보관하는 화면.
// 매출견적(고객사 제출)은 '견적 및 원가분석' 탭에서 따로 만든다.
// 탭을 나눠 두면 저장 단계에서 종류를 헷갈릴 여지가 없다.
export default function PurchaseQuote() {
  const { data: profile } = useMyProfile()
  const custList = orderedCustomers(profile)
  const [csCode, setCsCode] = useState(null)
  const code = csCode || primaryCsCode(profile)
  const { data: cs } = useCustomer(code)

  const [buyRate, setBuyRate] = useState(DEFAULT_CFG.buyRate)
  const [sellRate, setSellRate] = useState(DEFAULT_CFG.sellRate)
  const cfg = { ...DEFAULT_CFG, buyRate: Number(buyRate) || 1, sellRate: Number(sellRate) || 1 }

  // 최근 매입견적 (같은 업체·품번을 다시 받을 때 참고)
  const { data: recent = [] } = useQuery({
    queryKey: ['recentPurchaseQuotes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pm_quotes')
        .select('id, quote_no, quote_date, issued_to, currency, total_amount, project_name')
        .eq('quote_kind', 'purchase')
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
          <h1 className="text-lg font-bold text-slate-900">📥 매입견적 입력</h1>
          <p className="text-xs text-slate-400">
            협력업체에서 받은 견적을 등록합니다. 고객사에 제출하는 매출견적은 <b>견적 및 원가분석</b> 탭에서 작성하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={code} onChange={(e) => setCsCode(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
            {custList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Field label="매입환율">
            <input type="number" value={buyRate} onChange={(e) => setBuyRate(e.target.value)}
              className="w-24 px-2 py-1.5 text-sm text-right rounded border border-slate-200" />
          </Field>
          <Field label="판매환율">
            <input type="number" value={sellRate} onChange={(e) => setSellRate(e.target.value)}
              className="w-24 px-2 py-1.5 text-sm text-right rounded border border-slate-200" />
          </Field>
        </div>
      </div>

      <QuoteSheet
        fixedKind="purchase"
        customerId={cs?.id}
        customerName={custList.find((c) => c.id === code)?.name || ''}
        cfg={cfg}
      />

      {/* 최근 등록분 — 중복 입력 방지용 */}
      {!!recent.length && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-xs font-bold text-slate-500 mb-2">최근 등록한 매입견적</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1.5 text-left">견적번호</th>
                  <th className="py-1.5 text-left">일자</th>
                  <th className="py-1.5 text-left">업체</th>
                  <th className="py-1.5 text-left">건명</th>
                  <th className="py-1.5 text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((q) => (
                  <tr key={q.id} className="border-t border-slate-100">
                    <td className="py-1.5 font-mono font-bold text-amber-600">{q.quote_no}</td>
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
