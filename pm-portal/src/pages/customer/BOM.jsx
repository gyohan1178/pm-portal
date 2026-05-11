import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

async function fetchCustomerId(code) {
  const { data } = await supabase.from('customers').select('id').eq('code', code).single()
  return data?.id
}
async function fetchProjects(customerId) {
  const { data } = await supabase.from('projects').select('id, code, name').eq('customer_id', customerId)
  return data || []
}
async function fetchBOM(customerId, projectId) {
  let q = supabase.from('bom').select('*, items(std_code, name, type, unit, lt_weeks)').eq('customer_id', customerId)
  if (projectId) q = q.eq('project_id', projectId)
  const { data } = await q
  return data || []
}

export default function BOM() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [selProj, setSelProj] = useState('')
  const [uploading, setUploading] = useState(false)

  const { data: csId } = useQuery({ queryKey: ['csId', csCode], queryFn: () => fetchCustomerId(csCode) })
  const { data: projects = [] } = useQuery({ queryKey: ['projects', csId], queryFn: () => fetchProjects(csId), enabled: !!csId })
  const { data: bom = [], isLoading } = useQuery({
    queryKey: ['bom', csId, selProj],
    queryFn: () => fetchBOM(csId, selProj || null),
    enabled: !!csId,
  })

  async function handleCSVUpload(e) {
    const file = e.target.files[0]; if (!file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const wb = XLSX.read(ev.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws)
        // CSV 컬럼: 기준코드, 품명, 소요량, 프로젝트코드(선택)
        // 실제 이카운트 컬럼 확인 후 매핑 수정 필요
        alert(`${rows.length}행 감지. 이카운트 BOM CSV 컬럼 매핑 확정 후 import 기능 활성화 예정`)
        setUploading(false)
      }
      reader.readAsBinaryString(file)
    } catch (err) { alert(err.message); setUploading(false) }
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={selProj} onChange={e => setSelProj(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">전체 프로젝트</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code}{p.name ? ' - ' + p.name : ''}</option>)}
        </select>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 cursor-pointer">
          📤 ERP CSV 업로드
          <input type="file" accept=".xlsx,.csv,.xls" className="hidden" onChange={handleCSVUpload} />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['기준코드','품명','구분','단위','LT(주)','소요량/단위','프로젝트','메모'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
            ) : bom.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400">
                <p>BOM 데이터가 없습니다</p>
                <p className="mt-1 text-[11px]">ERP CSV 업로드 또는 직접 추가해주세요</p>
              </td></tr>
            ) : bom.map(b => (
              <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{b.items?.std_code}</td>
                <td className="px-3 py-2 font-600 text-slate-800">{b.items?.name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                    ${b.items?.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                    {b.items?.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">{b.items?.unit}</td>
                <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-600 bg-slate-100 text-slate-600">{b.items?.lt_weeks}W</span></td>
                <td className="px-3 py-2 text-right font-700 text-slate-900">{b.qty_per_unit}</td>
                <td className="px-3 py-2 text-slate-500">{projects.find(p => p.id === b.project_id)?.code || '-'}</td>
                <td className="px-3 py-2 text-slate-400">{b.memo || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
