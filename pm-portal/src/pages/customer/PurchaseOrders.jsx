import { useState } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'

const STATUS_STYLE = {
  '진행중': 'bg-blue-50 text-blue-600',
  '지연':   'bg-red-50 text-red-600',
  '완료':   'bg-emerald-50 text-emerald-700',
  '보류':   'bg-slate-100 text-slate-500',
}

const CS_MAP = {
  ax:  'AXCELIS',
  ed:  'Edwards',
  vm:  'VM',
  csk: 'CSK',
}

async function fetchPOs(csCode) {
  if (!csCode) return []
  const today = new Date().toISOString().split('T')[0]

  // 1. code로 customer_id 조회
  const { data: cs, error: csErr } = await supabase
    .from('customers')
    .select('id')
    .eq('code', csCode)
    .single()

  if (csErr || !cs) throw new Error('고객사 조회 실패: ' + csErr?.message)

  // 2. customer_id로 PO 조회
  const data = await fetchAll(() => supabase
    .from('purchase_orders')
    .select('*, items(std_code, name, type, lt_weeks), vendors(name)')
    .eq('customer_id', cs.id)
    .neq('status', '완료')
    .order('promise_date', { ascending: true }))

  if (error) throw error

  return (data || []).map(p => ({
    ...p,
    isDelayed: p.promise_date && p.promise_date < today && p.status === '진행중',
  }))
}

export default function PurchaseOrders() {
  const { customerId: csCode } = useParams()
  const [typeTab, setTypeTab] = useState('전체')
  const [csvPreview, setCsvPreview] = useState(null)
  const [showMapping, setShowMapping] = useState(false)

  const { data: pos = [], isLoading, error } = useQuery({
    queryKey: ['po', csCode],
    queryFn: () => fetchPOs(csCode),
    enabled: !!csCode,
  })

  const filtered = typeTab === '전체' ? pos : pos.filter(p => p.type === typeTab)
  const today = new Date().toISOString().split('T')[0]

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const headers = rows[0]
        const data = rows.slice(1).filter(r => r.some(c => c !== ''))
        setCsvPreview({ headers, data: data.slice(0, 5), total: data.length })
        setShowMapping(true)
      }
      reader.readAsBinaryString(file)
    } catch (err) {
      toastError('파일 파싱 오류: ' + err.message)
    }
    e.target.value = ''
  }

  if (error) return (
    <div className="text-center py-12 text-red-500 text-sm">
      오류: {error.message}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체', '가공', '자재'].map(t => (
            <button key={t} onClick={() => setTypeTab(t)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all
                ${typeTab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 cursor-pointer">
          <span>📤</span> 이카운트 CSV 업로드
          <input type="file" accept=".xlsx,.csv,.xls" className="hidden" onChange={handleCSVUpload} />
        </label>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
          <span>➕</span> PO 직접 추가
        </button>
      </div>

      {showMapping && csvPreview && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-indigo-700">CSV 미리보기 — 총 {csvPreview.total}행</p>
            <button onClick={() => setShowMapping(false)} className="text-xs text-indigo-400">✕ 닫기</button>
          </div>
          <p className="text-xs text-indigo-500">⚠️ 이카운트 CSV 컬럼 확인 후 매핑 확정 예정</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체 PO</p>
          <p className="text-xl font-bold text-slate-900">{filtered.length}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">납기 지연</p>
          <p className="text-xl font-bold text-red-600">{filtered.filter(p => p.isDelayed).length}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">D-7 임박</p>
          <p className="text-xl font-bold text-amber-700">
            {filtered.filter(p => {
              if (!p.promise_date) return false
              const diff = Math.round((new Date(p.promise_date) - new Date(today)) / 86400000)
              return diff >= 0 && diff <= 7
            }).length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">잔량 합계</p>
          <p className="text-xl font-bold text-slate-900">{filtered.reduce((a, p) => a + (p.qty_remaining || 0), 0)}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['PO번호','기준코드','품명','구분','LT','발주량','입고','잔량','요청일','약속일','협력사','상태'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-10 text-slate-400">PO 데이터가 없습니다</td></tr>
                ) : filtered.map(p => {
                  const diff = p.promise_date
                    ? Math.round((new Date(p.promise_date) - new Date(today)) / 86400000)
                    : null
                  return (
                    <tr key={p.id} className={`border-b border-slate-100 hover:bg-slate-50 ${p.isDelayed ? 'bg-red-50/30' : ''}`}>
                      <td className="px-3 py-2 font-mono text-slate-500">{p.po_number || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.items?.std_code || '-'}</td>
                      <td className="px-3 py-2 font-semibold text-slate-800">{p.items?.name || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold
                          ${p.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                          {p.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{p.items?.lt_weeks ? `${p.items.lt_weeks}W` : '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{p.qty_ordered}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{p.qty_received}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">{p.qty_remaining}</td>
                      <td className="px-3 py-2 text-slate-500">{p.required_date || '-'}</td>
                      <td className="px-3 py-2">
                        {p.promise_date ? (
                          <span className={`${diff !== null && diff < 0 ? 'text-red-600 font-bold' : diff !== null && diff <= 7 ? 'text-amber-700 font-semibold' : 'text-slate-600'}`}>
                            {p.promise_date}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{p.vendors?.name || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[p.isDelayed ? '지연' : p.status] || 'bg-slate-100 text-slate-500'}`}>
                          {p.isDelayed ? '지연' : p.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
