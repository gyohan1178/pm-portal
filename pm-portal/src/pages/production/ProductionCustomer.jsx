import { useState, useMemo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import ProductionCalendar from './ProductionCalendar'
import ProductionHarness from './ProductionHarness'
import ProductionPDBox from './ProductionPDBox'

const CUST_NAME = { AX: 'AXCELIS', ED: 'Edwards', VM: 'VM', CSK: 'CSK' }
const STATUS_COLOR = {
  'PO 접수':'bg-slate-100 text-slate-600','제작 중':'bg-blue-50 text-blue-600',
  '품질 검수':'bg-violet-50 text-violet-600','납품 대기':'bg-amber-50 text-amber-700','완료':'bg-emerald-50 text-emerald-700',
}

async function fetchByCustomer(code) {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('production')
      .select('*').eq('customer_code', code)
      .order('req_date', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

function dday(s) {
  if (!s) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const d = new Date(s); if (isNaN(d)) return null
  return Math.round((d - t) / 86400000)
}
function ddayCls(n) {
  if (n == null) return 'text-slate-300'
  if (n <= 0) return 'text-red-600 font-bold'
  if (n <= 7) return 'text-orange-500 font-bold'
  if (n <= 14) return 'text-yellow-600 font-semibold'
  return 'text-slate-500'
}
// 전장 완료요청일 = 납품일 영업일 -4 (elec_done 미입력 시 자동 — AXCELIS pbCalcElec 이식)
function calcElec(r) {
  if (r.elec_done) return r.elec_done
  if (!r.req_date) return ''
  const d = new Date(r.req_date); if (isNaN(d)) return ''
  let left = 4
  while (left > 0) { d.setDate(d.getDate() - 1); const w = d.getDay(); if (w !== 0 && w !== 6) left-- }
  return d.toISOString().split('T')[0]
}
const md = s => (s ? String(s).slice(5, 10) : '—')
const truthy = v => v === true || (v != null && String(v).trim() !== '' && String(v) !== 'false')

export default function ProductionCustomer() {
  const { code } = useParams()
  const cs = (code || 'AX').toUpperCase()
  const nav = useNavigate()
  const [tab, setTab] = useState('list')
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const qc = useQueryClient()

  const syncMut = useMutation({
    mutationFn: async (silent = false) => { const { data, error } = await supabase.rpc('sync_production_from_po', { cs_code: cs, p_silent: silent }); if (error) throw error; return data?.[0] },
    onSuccess: (r) => { qc.invalidateQueries(['production', cs]); toastSuccess(`PO 연동 완료 — 매칭 ${r?.matched||0}, 신규 호기 ${r?.created||0}, 갱신 ${r?.updated||0}`) },
    onError: (e) => toastError('연동 오류: ' + e.message),
  })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['production', cs],
    queryFn: () => fetchByCustomer(cs),
  })

  const filtered = useMemo(() => {
    let list = showDone ? rows : rows.filter(r => r.status !== '완료')
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        (r.pn || '').toLowerCase().includes(q) ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.hogi || '').toLowerCase().includes(q))
    }
    // 납품일 → 호기 번호순 (AXCELIS 정렬 규칙)
    return [...list].sort((a, b) => {
      const ra = a.req_date || '9999', rb = b.req_date || '9999'
      if (ra !== rb) return ra < rb ? -1 : 1
      const na = parseInt(String(a.hogi || '').replace(/[^0-9]/g, '')) || 999
      const nb = parseInt(String(b.hogi || '').replace(/[^0-9]/g, '')) || 999
      return na - nb
    })
  }, [rows, search, showDone])

  // 월별 구분 행 (납품일 기준 — AXCELIS 기본현황 방식)
  const grouped = useMemo(() => {
    const out = []
    let cur = null
    for (const r of filtered) {
      const mk = r.req_date ? r.req_date.slice(0, 7) : '미정'
      if (mk !== cur) { cur = mk; out.push({ _month: mk }) }
      out.push(r)
    }
    return out
  }, [filtered])

  const TABS = cs === 'AX'
    ? [['list', '📋 기본현황'], ['cal', '📅 생산일정'], ['hns', '🔧 하네스 우선순위']]
    : [['list', '📋 기본현황'], ['cal', '📅 생산일정']]

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            {[['AX','AXCELIS','#8b5cf6'],['CSK','CSK','#f59e0b'],['ED','Edwards','#3b82f6'],['VM','VM','#10b981']].map(([code,name,color])=>(
              <button key={code} onClick={()=>nav(`/production/${code}`)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${cs===code?'bg-indigo-600 text-white':'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{background:cs===code?'#fff':color}} />{name}
              </button>
            ))}
          </div>
          <h1 className="text-lg font-bold text-slate-900">{CUST_NAME[cs] || cs} 생산관리</h1>
          <p className="text-xs text-slate-400 mt-0.5">11번대 PO 연동 — 품번 기준 호기 매칭, 부족분 자동 생성, 납기·REV 동기화</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { if(window.confirm('11번대 PO를 호기에 연동할까요?\\n납품요청일·REV가 갱신되고, 부족한 호기는 새로 생성됩니다.')) syncMut.mutate(false) }}
            disabled={syncMut.isPending}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 disabled:opacity-40">
            {syncMut.isPending ? '연동 중...' : '↻ PO 연동'}
          </button>
          <button onClick={() => { if(window.confirm('납기변경 태그 없이 연동할까요?\\n(데이터 정리 직후·대량 변경 시 사용 — 비고에 납기변경 기록 안 남김)')) syncMut.mutate(true) }}
            disabled={syncMut.isPending}
            title="납기변경 태그를 남기지 않고 연동 (조용히)"
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50 disabled:opacity-40">
            ↻ 조용히 연동
          </button>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'cal' && <ProductionCalendar rows={rows} />}

      {tab === 'hns' && <ProductionHarness rows={rows} csCode={cs} />}

      {tab === 'list' && <ProductionPDBox rows={rows} csCode={cs} isLoading={isLoading} />}
    </div>
  )
}
