import { useState } from 'react'
import { toast, toastError, toastSuccess } from '../lib/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

const CUSTOMERS = ['AXCELIS','Edwards','VM','CSK']

function getWeekRange(offset=0) {
  const now = new Date()
  const day = now.getDay()||7
  const mon = new Date(now); mon.setDate(now.getDate()-day+1+offset*7); mon.setHours(0,0,0,0)
  const sun = new Date(mon); sun.setDate(mon.getDate()+6)
  const fmt = d=>d.toISOString().split('T')[0]
  return { from:fmt(mon), to:fmt(sun), label:`${fmt(mon)} ~ ${fmt(sun)}` }
}

function fmtDate(v) {
  if (!v) return null
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 12*3600*1000) // 정오 보정 — 시간대로 인한 ±1일 방지
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth()+1).padStart(2,'0')
    const day = String(d.getUTCDate()).padStart(2,'0')
    return y+'-'+m+'-'+day
  }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  return null
}

function parseExcel(file, weekFrom, weekTo, submitter) {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type:'array', cellDates:true })
        const targetSheet = wb.SheetNames.find(s=>s.includes('발주입고내역')) || wb.SheetNames[0]
        const ws = wb.Sheets[targetSheet]
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
        // 헤더 찾기
        const headerRow = rows.findIndex(r => r.some(c=>String(c).includes('발주일자')||String(c).includes('입고일자')))
        if (headerRow < 0) { rej(new Error('헤더를 찾을 수 없습니다')); return }
        const headers = rows[headerRow].map(h=>String(h).trim())
        const hi = k => headers.findIndex(h=>h.includes(k))
        // 핵심 열은 인덱스 고정 (A=0,B=1,C=2,...,H=7,I=8,K=10)
        // 나머지는 헤더 이름으로 탐색
        const idx = {
          orderDate:  0,  // A열: 발주일자
          reqDate:    1,  // B열: 입고요청일자
          inDate:     2,  // C열: 입고일자 (없으면 미입고)
          vendor:     hi('공급업체'),
          pn:         hi('품목코드'),
          mfg:        headers.findIndex(h=>h==='제조사'),
          mfgPn:      hi('제조사품번'),
          qty:        hi('수량'),
          unitPrice:  8,  // I열: 단가
          totalAmt:   10, // K열: 합계금액
          orderAmt:   7,  // H열: 발주금액
          unit:       hi('단위'),
          payment:    hi('결제방식'),
          blno:       hi('BL'),
          note:       hi('비고'),
        }

        const today = new Date().toISOString().split('T')[0]
        const parsed = []
        for (let i = headerRow+1; i < rows.length; i++) {
          const r = rows[i]
          if (!r[idx.pn] && !r[idx.vendor]) continue
          const inDate   = fmtDate(r[idx.inDate])
          const reqDate  = fmtDate(r[idx.reqDate])
          const orderDate = fmtDate(r[idx.orderDate])
          const qty = Number(r[idx.qty])||0
          if (!qty) continue

          // 분류 기준:
          // - 입고일자 있음 → 실제 입고 완료
          //   이번주 범위면 inbound, 아니면 매입 이력용으로 inbound 저장
          // - 입고일자 없음 → 예정 or 지연
          let category
          if (inDate) {
            // 입고일자 있으면 항상 inbound (매입 실적)
            category = 'inbound'
          } else if (reqDate && reqDate < today) {
            category = 'delay'
          } else {
            category = 'plan'
          }
          // 주간 입고현황은 이번주 범위만 표시 (category 유지, 별도 필터)
          const isThisWeek = inDate && inDate >= weekFrom && inDate <= weekTo

          // 담당자별 자동 고객사 분류
          const noteStr = String(r[idx.note]||'')
          const autoCs = autoClassify(submitter, noteStr)

          const unitPrice = Number(r[idx.unitPrice])||0   // I열 단가
          const totalAmt  = Number(r[idx.totalAmt])||0    // K열 합계금액
          const orderAmt  = Number(r[idx.orderAmt])||0    // H열 발주금액
          // 합계금액 우선, 없으면 발주금액, 없으면 단가×수량
          const finalAmt  = totalAmt || orderAmt || unitPrice * qty

          parsed.push({
            category,
            customer: autoCs,
            pn:           String(r[idx.pn]||'').trim(),
            vendor:       String(r[idx.vendor]||'').trim(),
            manufacturer: idx.mfg>=0 ? String(r[idx.mfg]||'').trim() : '',
            manufacturer_pn: idx.mfgPn>=0 ? String(r[idx.mfgPn]||'').trim() : '',
            qty,
            unit_price:   unitPrice,
            amount:       finalAmt,
            target_date:  inDate || reqDate, // 입고일자 우선, 없으면 입고요청일자
            order_date:   orderDate,
            note: [
              r[idx.payment] ? `결제:${r[idx.payment]}` : '',
              r[idx.blno]    ? `BL:${r[idx.blno]}`     : '',
              r[idx.note]    ? String(r[idx.note])       : '',
            ].filter(Boolean).join(' | '),
          })
        }
        res(parsed)
      } catch(e){ rej(e) }
    }
    reader.onerror = ()=>rej(new Error('파일 읽기 실패'))
    reader.readAsArrayBuffer(file)
  })
}


// 담당자별 자동 고객사 분류
function autoClassify(submitter, noteVal) {
  const name = (submitter||'').trim()
  const note = (noteVal||'').toLowerCase()
  if (name.includes('남기문')) {
    return note.includes('csk') ? 'CSK' : 'VM'
  }
  if (name.includes('황주현')) return 'Edwards'
  if (name.includes('김교한')) return 'AXCELIS'
  return '' // 나머지는 수동 분류
}

export default function WeeklyUpload() {
  const qc = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const week = getWeekRange(weekOffset)
  const [selCustomer, setSelCustomer] = useState('AXCELIS')

  // 담당자 이름 변경 시 preview 재분류
  function handleSubmitterChange(name) {
    setSubmitter(name)
    if (preview) {
      setPreview(v => v.map(r => ({
        ...r,
        customer: autoClassify(name, r.note) || r.customer || '',
      })))
    }
  }
  const [submitter, setSubmitter] = useState('')
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [parseError, setParseError] = useState('')
  const [csFilter, setCsFilter] = useState('전체')
  // 자재불출 직접 입력
  const [outbounds, setOutbounds] = useState([{customer:'AXCELIS',project:'',pn:'',name:'',qty:'',note:''}])

  // 기존 이번주 보고 목록
  const { data: reports=[] } = useQuery({
    queryKey:['weeklyReports', week.from],
    queryFn: async () => {
      const { data } = await supabase.from('weekly_reports')
        .select('id,submitted_by,created_at,week_from')
        .eq('week_from', week.from)
        .order('created_at', { ascending:false })
      return data||[]
    }
  })

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f); setParseError(''); setPreview(null)
    try {
      const rows = await parseExcel(f, week.from, week.to, submitter)
      setPreview(rows.map(r=>({...r, customer: r.customer||''})))
    } catch(err) {
      setParseError(err.message)
    }
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      // 보고 헤더 생성
      const { data: report, error: rErr } = await supabase.from('weekly_reports')
        .insert({ week_from:week.from, week_to:week.to, submitted_by:submitter||selCustomer })
        .select().single()
      if (rErr) throw rErr

      // 입고(매입)·예정(plan) 모두 담당자별 '연 누적' 파일 → 이전 업로드분 제거 후 최신본만 유지 (중복 방지)
      const submitterName = submitter || selCustomer
      const { data: priorReports } = await supabase.from('weekly_reports')
        .select('id').eq('submitted_by', submitterName).neq('id', report.id)
      const priorIds = (priorReports || []).map(r => r.id)
      if (priorIds.length > 0) {
        const { error: delErr } = await supabase.from('weekly_items')
          .delete().in('category', ['inbound', 'plan']).in('report_id', priorIds)
        if (delErr) throw delErr
      }

      // 엑셀 파싱 결과
      const items = (preview||[]).map(r=>({
        report_id: report.id,
        category: r.category,
        customer: r.customer || autoClassify(submitter, r.note) || selCustomer,
        pn: r.pn,
        vendor: r.vendor,
        manufacturer: r.manufacturer,
        manufacturer_pn: r.manufacturer_pn,
        qty: r.qty,
        unit_price: r.unit_price||null,
        amount: r.amount||null,
        target_date: r.target_date,
        note: r.note,
      }))

      // 자재불출
      outbounds.filter(o=>o.qty).forEach(o=>{
        items.push({
          report_id: report.id,
          category: 'outbound',
          customer: o.customer,
          project: o.project,
          pn: o.pn,
          name: o.name,
          qty: Number(o.qty),
          note: o.note,
        })
      })

      if (items.length > 0) {
        const { error: iErr } = await supabase.from('weekly_items').insert(items)
        if (iErr) throw iErr
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(['weeklyReports'])
      setPreview(null); setFile(null); setOutbounds([{customer:'AXCELIS',project:'',pn:'',name:'',qty:'',note:''}])
      toastSuccess('✅ 제출 완료!')
    },
    onError: e => toastError('오류: '+e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('weekly_reports').delete().eq('id',id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['weeklyReports']),
  })

  const categoryCounts = preview ? {
    inbound: preview.filter(r=>r.category==='inbound').length,
    plan:    preview.filter(r=>r.category==='plan').length,
    delay:   preview.filter(r=>r.category==='delay').length,
  } : null

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* 주차 선택 */}
      <div className="flex items-center gap-2">
        <button onClick={()=>setWeekOffset(v=>v-1)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">← 전주</button>
        <button onClick={()=>setWeekOffset(0)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${weekOffset===0?'border-indigo-500 bg-indigo-50 text-indigo-700':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>이번 주</button>
        <button onClick={()=>setWeekOffset(v=>v+1)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">다음 주 →</button>
        <span className="text-xs text-slate-400 font-mono ml-1">{week.label}</span>
      </div>

      {/* 기제출 목록 */}
      {reports.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <p className="text-xs font-bold text-slate-600">이번 주 제출 현황 ({reports.length}건)</p>
          </div>
          <div className="divide-y divide-slate-100">
            {reports.map(r=>(
              <div key={r.id} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">{r.submitted_by}</span>
                  <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                </div>
                <button onClick={()=>{ if(window.confirm('삭제할까요?')) deleteMut.mutate(r.id) }}
                  className="text-xs text-red-400 hover:text-red-600">삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 업로드 폼 */}
      <div className="rounded-xl border border-slate-200 p-5 space-y-4">
        <p className="text-sm font-bold text-slate-700">주간보고 업로드</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">담당자</label>
            <input value={submitter} onChange={e=>handleSubmitterChange(e.target.value)} placeholder="이름"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
            <select value={selCustomer} onChange={e=>setSelCustomer(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {CUSTOMERS.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* 엑셀 업로드 */}
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">발주입고내역 엑셀 업로드</label>
          <input type="file" accept=".xlsx,.xls,.xlsm" onChange={handleFile}
            className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/>
          {parseError && <p className="text-xs text-red-500 mt-1">⚠️ {parseError}</p>}
        </div>

        {/* 파싱 미리보기 + 고객사 분류 */}
        {preview && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3 space-y-3">
            {/* 상단 요약 + 일괄 설정 */}
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs font-bold text-emerald-700">✅ 파싱 완료 — 총 {preview.length}행</p>
              <span className="text-xs text-emerald-600 font-semibold">입고 {categoryCounts.inbound}</span>
              <span className="text-xs text-blue-600 font-semibold">예정 {categoryCounts.plan}</span>
              <span className="text-xs text-red-600 font-semibold">지연 {categoryCounts.delay}</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-500 font-semibold">전체 일괄:</span>
                {['', ...CUSTOMERS].map(c=>(
                  <button key={c} onClick={()=>setPreview(v=>v.map(r=>({...r,customer:c})))}
                    className={`px-2 py-1 text-xs font-bold rounded border transition-all
                      ${c===''?'border-slate-200 text-slate-400 hover:bg-slate-50':'border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'}`}>
                    {c||'초기화'}
                  </button>
                ))}
              </div>
            </div>
            {/* 필터 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">필터:</span>
              {['전체', ...CUSTOMERS, '미분류'].map(f=>(
                <button key={f} onClick={()=>setCsFilter(f)}
                  className={`px-2 py-0.5 text-xs font-semibold rounded-full border transition-all
                    ${csFilter===f?'bg-slate-700 text-white border-slate-700':'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  {f}
                  {f==='미분류'&&<span className="ml-1 text-amber-400">{preview.filter(r=>!r.customer).length}</span>}
                  {f!=='전체'&&f!=='미분류'&&<span className="ml-1 opacity-60">{preview.filter(r=>r.customer===f).length}</span>}
                </button>
              ))}
            </div>
            {/* 테이블 */}
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border border-emerald-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-white border-b border-emerald-200 sticky top-0">
                  {['고객사','구분','품목코드','공급업체','제조사','제조사품번','수량','날짜'].map(h=>(
                    <th key={h} className="px-2 py-2 text-left font-bold text-slate-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {preview
                    .map((r,i)=>({...r,_i:i}))
                    .filter(r=>csFilter==='전체'||(csFilter==='미분류'?!r.customer:r.customer===csFilter))
                    .map(r=>(
                    <tr key={r._i} className={`border-b border-emerald-100 ${!r.customer?'bg-amber-50/30':''}`}>
                      <td className="px-2 py-1">
                        <select value={r.customer} onChange={e=>setPreview(v=>v.map((row,j)=>j===r._i?{...row,customer:e.target.value}:row))}
                          className={`px-1.5 py-1 text-xs border rounded font-semibold focus:outline-none
                            ${!r.customer?'border-amber-300 bg-amber-50 text-amber-700':'border-emerald-300 bg-white text-slate-700'}`}>
                          <option value="">미분류</option>
                          {CUSTOMERS.map(c=><option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold
                          ${r.category==='inbound'?'bg-emerald-100 text-emerald-700':
                            r.category==='delay'?'bg-red-100 text-red-700':
                            'bg-blue-100 text-blue-700'}`}>
                          {r.category==='inbound'?'입고':r.category==='delay'?'지연':'예정'}
                        </span>
                      </td>
                      <td className="px-2 py-1 font-mono text-indigo-600">{r.pn}</td>
                      <td className="px-2 py-1 text-slate-600">{r.vendor}</td>
                      <td className="px-2 py-1 text-slate-500">{r.manufacturer}</td>
                      <td className="px-2 py-1 font-mono text-slate-400">{r.manufacturer_pn}</td>
                      <td className="px-2 py-1 text-right font-semibold">{r.qty}</td>
                      <td className="px-2 py-1 text-slate-400 font-mono whitespace-nowrap">{r.target_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.filter(r=>!r.customer).length>0&&(
              <p className="text-xs text-amber-600 font-semibold">⚠️ 미분류 {preview.filter(r=>!r.customer).length}건 — 제출 전 고객사를 지정해주세요</p>
            )}
          </div>
        )}

        {/* 자재 불출 직접 입력 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-600">자재 불출 현황 (직접 입력)</p>
            <button onClick={()=>setOutbounds(v=>[...v,{customer:'AXCELIS',project:'',pn:'',name:'',qty:'',note:''}])}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">+ 행 추가</button>
          </div>
          {outbounds.map((o,i)=>(
            <div key={i} className="grid grid-cols-6 gap-2 items-center">
              <select value={o.customer} onChange={e=>setOutbounds(v=>v.map((r,j)=>j===i?{...r,customer:e.target.value}:r))}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none">
                {CUSTOMERS.map(c=><option key={c}>{c}</option>)}
              </select>
              <input value={o.project} onChange={e=>setOutbounds(v=>v.map((r,j)=>j===i?{...r,project:e.target.value}:r))}
                placeholder="프로젝트" className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none"/>
              <input value={o.pn} onChange={e=>setOutbounds(v=>v.map((r,j)=>j===i?{...r,pn:e.target.value}:r))}
                placeholder="품목코드" className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none font-mono"/>
              <input value={o.name} onChange={e=>setOutbounds(v=>v.map((r,j)=>j===i?{...r,name:e.target.value}:r))}
                placeholder="품명" className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none"/>
              <input type="number" value={o.qty} onChange={e=>setOutbounds(v=>v.map((r,j)=>j===i?{...r,qty:e.target.value}:r))}
                placeholder="수량" className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none text-right"/>
              <div className="flex gap-1">
                <input value={o.note} onChange={e=>setOutbounds(v=>v.map((r,j)=>j===i?{...r,note:e.target.value}:r))}
                  placeholder="비고" className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none"/>
                {outbounds.length>1&&<button onClick={()=>setOutbounds(v=>v.filter((_,j)=>j!==i))}
                  className="text-slate-300 hover:text-red-400 text-xs px-1">×</button>}
              </div>
            </div>
          ))}
        </div>

        <button onClick={()=>submitMut.mutate()}
          disabled={submitMut.isPending||!submitter||(!preview&&outbounds.every(o=>!o.qty))}
          className="w-full py-2.5 text-sm font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
          {submitMut.isPending?'제출 중...':'📤 주간보고 제출'}
        </button>
      </div>
    </div>
  )
}
