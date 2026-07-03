import { useState } from 'react'
import { toast, toastError, toastSuccess } from '../lib/toast'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/paginate'
import * as XLSX from 'xlsx'

const CUSTOMERS = [
  { id: 'ax', name: 'AXCELIS' }, { id: 'ed', name: 'Edwards' },
  { id: 'vm', name: 'VM' },      { id: 'csk', name: 'CSK' },
]
const EXPORT_TYPES = [
  { key: 'po',      label: 'PO 현황',      desc: '발주잔량 목록' },
  { key: 'inbound', label: '입고 이력',    desc: '기간별 입고 내역' },
  { key: 'outbound',label: '출고 이력',    desc: '기간별 출고 내역' },
  { key: 'stock',   label: '재고 현황',    desc: '현재고 스냅샷 (보고용)' },
]

export default function ERPExport() {
  const [selType, setSelType] = useState('po')
  const [selCs, setSelCs] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      let data = []
      const csFilter = selCs ? [selCs] : CUSTOMERS.map(c => c.id)

      if (selType === 'po') {
        // 고객사 UUID 가져오기
        const { data: cs } = await supabase.from('customers').select('id, name').in('code', csFilter)
        const csIds = (cs || []).map(c => c.id)
        const pos = await fetchAll(() => supabase
          .from('purchase_orders')
          .select('*, items(std_code, name, type), customers(name), vendors(name)')
          .in('customer_id', csIds)
          .neq('status', '완료'))
        data = (pos || []).map(p => ({
          '고객사': p.customers?.name,
          'PO번호': p.po_number,
          '기준코드': p.items?.std_code,
          '품명': p.items?.name,
          '구분': p.type,
          '발주량': p.qty_ordered,
          '입고량': p.qty_received,
          '잔량': p.qty_remaining,
          '요청일': p.required_date,
          '약속일': p.promise_date,
          '협력사': p.vendors?.name,
          '상태': p.status,
        }))
      } else if (selType === 'stock') {
        const { data: inv } = await supabase
          .from('inventory')
          .select('*, items(std_code, name, type, unit, safety_stock)')
        data = (inv || []).map(r => ({
          '기준코드': r.items?.std_code,
          '품명': r.items?.name,
          '구분': r.items?.type,
          '단위': r.items?.unit,
          '현재고': r.qty,
          '안전재고': r.items?.safety_stock,
          '보관위치': r.location || '',
          '최종업데이트': r.updated_at?.split('T')[0],
        }))
      } else {
        const mvType = selType === 'inbound' ? '입고' : '출고'
        const { data: cs } = await supabase.from('customers').select('id, name').in('code', csFilter)
        const csIds = (cs || []).map(c => c.id)
        const mvs = await fetchAll(() => {
          let q = supabase
            .from('stock_movements')
            .select('*, items(std_code, name), customers(name), projects(name)')
            .eq('movement_type', mvType)
            .in('customer_id', csIds)
            .order('processed_at', { ascending: false })
          if (dateFrom) q = q.gte('processed_at', dateFrom)
          if (dateTo)   q = q.lte('processed_at', dateTo + 'T23:59:59')
          return q
        })
        data = (mvs || []).map(r => ({
          '일시': r.processed_at?.replace('T', ' ').slice(0, 16),
          '고객사': r.customers?.name,
          '프로젝트': r.projects?.name || '',
          '기준코드': r.items?.std_code,
          '품명': r.items?.name,
          '수량': r.qty,
          '단가': r.unit_price || '',
          '금액': r.unit_price ? r.qty * r.unit_price : '',
          '메모': r.memo || '',
        }))
      }

      if (!data.length) { toastError('추출할 데이터가 없습니다'); return }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), EXPORT_TYPES.find(t => t.key === selType)?.label)
      XLSX.writeFile(wb, `ERP_${selType}_${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (err) {
      toastError('추출 오류: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-xs text-slate-500">포털 데이터를 ERP 업로드용 파일로 추출합니다</p>

      <div className="space-y-2">
        <p className="text-[10px] font-700 text-slate-500 uppercase tracking-widest">추출 유형</p>
        <div className="grid grid-cols-2 gap-2">
          {EXPORT_TYPES.map(t => (
            <button key={t.key} onClick={() => setSelType(t.key)}
              className={`text-left px-4 py-3 rounded-xl border transition-all
                ${selType === t.key ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className={`text-xs font-700 ${selType === t.key ? 'text-indigo-700' : 'text-slate-700'}`}>{t.label}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-700 text-slate-500 uppercase tracking-widest">고객사 (미선택 시 전체)</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setSelCs('')}
            className={`px-3 py-1.5 text-xs font-600 rounded-lg border transition-all
              ${selCs === '' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
            전체
          </button>
          {CUSTOMERS.map(c => (
            <button key={c.id} onClick={() => setSelCs(c.id)}
              className={`px-3 py-1.5 text-xs font-600 rounded-lg border transition-all
                ${selCs === c.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {(selType === 'inbound' || selType === 'outbound') && (
        <div className="space-y-2">
          <p className="text-[10px] font-700 text-slate-500 uppercase tracking-widest">기간</p>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <span className="text-slate-400 text-sm">~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
      )}

      <button onClick={handleExport} disabled={exporting}
        className="w-full py-3 text-sm font-700 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center gap-2">
        {exporting ? '추출 중...' : '📥 엑셀 추출'}
      </button>
    </div>
  )
}
