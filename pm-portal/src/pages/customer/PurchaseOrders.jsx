import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

const CS_NAMES = { ax: 'AXCELIS', ed: 'Edwards', vm: 'VM', csk: 'CSK' }
const STATUS_STYLE = {
  '진행중': 'bg-blue-50 text-blue-600',
  '지연':   'bg-red-50 text-red-600',
  '완료':   'bg-emerald-50 text-emerald-700',
  '보류':   'bg-slate-100 text-slate-500',
}

async function fetchCustomerId(code) {
  const { data } = await supabase.from('customers').select('id').eq('code', code).single()
  return data?.id
}

async function fetchPOs(customerId) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, items(std_code, name, type, lt_weeks), vendors(name)')
    .eq('customer_id', customerId)
    .neq('status', '완료')
    .order('promise_date', { ascending: true })
  if (error) throw error

  // 지연 자동 표시
  return (data || []).map(p => ({
    ...p,
    isDelayed: p.promise_date && p.promise_date < today && p.status === '진행중',
  }))
}

// 이카운트 CSV 컬럼 매핑 (실제 컬럼명은 나중에 맞춰서 수정)
function parseEcountCSV(file, customerId) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const headers = rows[0]
        const data = rows.slice(1).filter(r => r.some(c => c !== '')).map(r => {
          const obj = {}
          headers.forEach((h, i) => { obj[h] = r[i] })
          return obj
        })
        resolve({ headers, data })
      } catch (err) { reject(err) }
    }
    reader.readAsBinaryString(file)
  })
}

export default function PurchaseOrders() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [typeTab, setTypeTab] = useState('전체')
  const [uploading, setUploading] = useState(false)
  const [csvPreview, setCsvPreview] = useState(null)
  const [showMapping, setShowMapping] = useState(false)

  // 고객사 UUID 조회
  const { data: csId } = useQuery({
    queryKey: ['csId', csCode],
    queryFn: () => fetchCustomerId(csCode),
    enabled: !!csCode,
  })

  // PO 목록
  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['po', csId],
    queryFn: () => fetchPOs(csId),
    enabled: !!csId,
  })

  const filtered = typeTab === '전체' ? pos : pos.filter(p => p.type === typeTab)
  const today = new Date().toISOString().split('T')[0]

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const { headers, data } = await parseEcountCSV(file, csId)
      setCsvPreview({ headers, data: data.slice(0, 5), total: data.length, all: data })
      setShowMapping(true)
    } catch (err) {
      alert('파일 파싱 오류: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체', '가공', '자재'].map(t => (
            <button
              key={t}
              onClick={() => setTypeTab(t)}
              className={`px-3 py-1 text-xs font-600 rounded-md transition-all
                ${typeTab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 cursor-pointer">
          <span>📤</span> 이카운트 CSV 업로드
          <input type="file" accept=".xlsx,.csv,.xls" className="hidden" onChange={handleCSVUpload} />
        </label>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
          <span>➕</span> PO 직접 추가
        </button>
      </div>

      {/* CSV 미리보기 */}
      {showMapping && csvPreview && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-700 text-indigo-700">
              CSV 미리보기 — 총 {csvPreview.total}행 감지됨
            </p>
            <button onClick={() => setShowMapping(false)} className="text-xs text-indigo-400 hover:text-indigo-600">✕ 닫기</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-indigo-200 bg-white">
            <table className="text-[11px] w-full">
              <thead>
                <tr className="bg-indigo-50 border-b border-indigo-200">
                  {csvPreview.headers.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left font-700 text-indigo-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvPreview.data.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {csvPreview.headers.map((h, j) => (
                      <td key={j} className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{String(row[h] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-indigo-500">
            ⚠️ 컬럼 매핑은 이카운트 CSV 구조 확인 후 확정 예정. 지금은 미리보기만 가능합니다.
          </p>
        </div>
      )}

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-700 text-slate-400 uppercase tracking-widest mb-1">전체 PO</p>
          <p className="text-xl font-700 text-slate-900">{filtered.length}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-[10px] font-700 text-red-400 uppercase tracking-widest mb-1">납기 지연</p>
          <p className="text-xl font-700 text-red-600">{filtered.filter(p => p.isDelayed).length}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[10px] font-700 text-amber-500 uppercase tracking-widest mb-1">D-7 임박</p>
          <p className="text-xl font-700 text-amber-700">
            {filtered.filter(p => {
              if (!p.promise_date) return false
              const diff = Math.round((new Date(p.promise_date) - new Date(today)) / 86400000)
              return diff >= 0 && diff <= 7
            }).length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-700 text-slate-400 uppercase tracking-widest mb-1">잔량 합계</p>
          <p className="text-xl font-700 text-slate-900">{filtered.reduce((a, p) => a + (p.qty_remaining || 0), 0)}</p>
        </div>
      </div>

      {/* PO 테이블 */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['PO번호','기준코드','품명','구분','LT','발주량','입고','잔량','요청일','약속일','협력사','상태'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
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
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{p.items?.std_code || '-'}</td>
                      <td className="px-3 py-2 font-600 text-slate-800 max-w-[160px] truncate">{p.items?.name || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                          ${p.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                          {p.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{p.items?.lt_weeks ? `${p.items.lt_weeks}W` : '-'}</td>
                      <td className="px-3 py-2 text-right font-600 text-slate-700">{p.qty_ordered}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{p.qty_received}</td>
                      <td className="px-3 py-2 text-right font-700 text-slate-900">{p.qty_remaining}</td>
                      <td className="px-3 py-2 text-slate-500">{p.required_date || '-'}</td>
                      <td className="px-3 py-2">
                        {p.promise_date ? (
                          <span className={`${diff !== null && diff < 0 ? 'text-red-600 font-700' : diff !== null && diff <= 7 ? 'text-amber-700 font-600' : 'text-slate-600'}`}>
                            {p.promise_date}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{p.vendors?.name || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 ${STATUS_STYLE[p.isDelayed ? '지연' : p.status] || 'bg-slate-100 text-slate-500'}`}>
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
