import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { useCustomers } from '../../hooks/useCustomers'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { todayISO, ymdKST } from '../../lib/utils'

// 출고 현황 — ASSY 출고 · 다품목 출고 · 자재요청 불출 · 실사 조정을 한 곳에서 본다.
//   (예전엔 ASSY 출고 화면의 탭이었다. 다른 경로 출고도 다 나오므로 따로 뺐다)

function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return ymdKST(d)
}

// 출고가 어느 경로로 나갔는지 — DB 함수마다 비고 앞머리가 정해져 있다
//   자재요청 불출: 「자재요청 MR-…」 · 다품목 출고: 「출고작업…」 · 실사: 「실사 조정…」 · 나머지 = ASSY 출고
export const OUT_KINDS = ['ASSY 출고', '다품목 출고', '자재요청', '실사 조정']
export function outKindOf(memo) {
  const m = String(memo || '')
  if (m.startsWith('자재요청')) return '자재요청'
  if (m.startsWith('출고작업')) return '다품목 출고'
  if (m.startsWith('실사 조정')) return '실사 조정'
  return 'ASSY 출고'
}
// 기준코드 앞자리 → 고객사 코드 (AX-… → ax, CS-… → csk)
const custCodeOf = (std) => {
  const p = (/^([A-Za-z]+)-/.exec(String(std || '')) || [])[1]
  if (!p) return null
  return p.toUpperCase() === 'CS' ? 'csk' : p.toLowerCase()
}

// 출고 현황 — 기간 안의 출고를 끝까지 받는다.
//   · 고객사·프로젝트·처리자는 출고할 때 줄마다 저장된다 (customer_id · project_id · processed_by)
//   · 칸이 빈 예전 기록: 고객사 PO 가 있으면 PO 에서, 그래도 없으면 기준코드 앞자리로 「추정」
//   · 비고는 DB 에 memo 칸으로 저장된다 (note 칸이 아니다)
export async function fetchOutboundHistory({ from, to, customerId }) {
  const rows = await fetchAll(() => supabase.from('stock_movements')
    .select('*, items(std_code,name,unit), purchase_orders(po_number,customer_id,project_id,customers(name,code),projects(code,name))')
    .eq('movement_type','출고')
    .gte('movement_date', from)
    .lte('movement_date', to)
    .order('movement_date', { ascending: false }).order('id'))

  // 고객사 PO 없이 저장된 프로젝트는 이름을 따로 찾아 온다
  const projIds = [...new Set(rows.map(r => r.project_id).filter(Boolean))]
  const projOf = {}
  for (let i = 0; i < projIds.length; i += 100) {
    const { data, error } = await supabase.from('projects').select('id,code,name').in('id', projIds.slice(i, i + 100))
    if (error) throw error
    ;(data || []).forEach(p => { projOf[p.id] = p })
  }

  // 처리자 이름 — SQL 적용 전이면 함수가 없으니 이름 없이 보여 준다
  const userIds = [...new Set(rows.map(r => r.processed_by).filter(Boolean))]
  const nameOf = {}
  if (userIds.length) {
    const { data, error } = await supabase.rpc('pm_user_names', { p_ids: userIds })
    if (error && error.code !== 'PGRST202') throw error
    ;(data || []).forEach(u => { nameOf[u.id] = u.name })
  }

  // 예전 출고에 나중에 채운 프로젝트 — BOM 대조로 채운 것은 「추정」 표시
  //   (표가 아직 없으면 = 채우기 SQL 전이면 그냥 넘어간다)
  const filled = {}
  try {
    const fl = await fetchAll(() => supabase.from('pm_outbound_project_fill')
      .select('sm_id,method').gte('movement_date', from).lte('movement_date', to).order('sm_id'))
    fl.forEach(f => { filled[f.sm_id] = f.method })
  } catch (e) {
    if (!['42P01', 'PGRST205', 'PGRST200'].includes(e?.code)) throw e
  }

  // 기준코드로 고객사 추정할 때 쓰는 목록
  const { data: custs, error: cErr } = await supabase.from('customers').select('id,code,name')
  if (cErr) throw cErr
  const custByCode = Object.fromEntries((custs || []).map(c => [String(c.code || '').toLowerCase(), c.id]))

  const out = rows.map(r => {
    const po = r.purchase_orders
    const pj = projOf[r.project_id] || po?.projects || null
    const known = r.customer_id || po?.customer_id || null
    const guess = known ? null : (custByCode[custCodeOf(r.items?.std_code)] || null)
    const memo = r.memo ?? r.note ?? ''
    return {
      ...r,
      _custId: known || guess,
      _custGuess: !!guess,                 // 기준코드로 추정한 고객사
      _projCode: pj?.code || '',
      _projName: pj?.name || '',
      _projGuess: filled[r.id] === 'BOM 대조',   // 부품 구성으로 찾은 프로젝트
      _memo: memo,
      _kind: outKindOf(memo),
      _who: r.processed_by ? (nameOf[r.processed_by] || '(이름 없음)') : '',
    }
  })
  return customerId ? out.filter(r => r._custId === customerId) : out
}

// 다품목 출고는 한 번 처리한 것을 한 줄로 묶는다.
//   한 번의 처리(DB 트랜잭션)로 들어간 줄은 처리 시각(processed_at)이 똑같다 → 그걸로 묶는다.
//   ASSY 출고·자재요청은 그대로 한 줄씩.
//   반환: [{ key, rows: [...] }] — rows 가 1개면 보통 줄, 여러 개면 「대표품목 외 N건」
export function groupHistory(rows) {
  const out = [], at = new Map()
  for (const r of rows) {
    if (r._kind !== '다품목 출고') { out.push({ key: r.id, rows: [r] }); continue }
    const k = `${r.processed_at || r.movement_date}|${r._custId || ''}`
    const g = at.get(k)
    if (g) g.rows.push(r)
    else { const n = { key: 'g:' + k, rows: [r] }; at.set(k, n); out.push(n) }
  }
  return out
}

const KIND_TONE = {
  'ASSY 출고': 'bg-indigo-50 text-indigo-600',
  '다품목 출고': 'bg-sky-50 text-sky-600',
  '자재요청': 'bg-emerald-50 text-emerald-600',
  '실사 조정': 'bg-slate-100 text-slate-500',
}

export default function OutboundHistory() {
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(todayISO())
  const [hCustomer, setHCustomer] = useState('')
  const [hKind, setHKind] = useState('')            // 경로 — 화면에서만 거른다
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: todayISO(), customerId:'' })
  const { data: customers=[] } = useCustomers()
  const { data: history=[], isLoading: histLoading } = useQuery({
    queryKey:['outboundHistory', hQuery],
    queryFn:()=>fetchOutboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId }),
  })

  const histRows = hKind ? history.filter(r => r._kind === hKind) : history
  const histTotal = histRows.reduce((a,r)=>a+(Number(r.qty)||0),0)
  const custName = (id) => customers.find(c => c.id === id)?.name || ''
  const histGroups = useMemo(() => groupHistory(histRows), [histRows])
  const histView = useVisibleRows(histGroups, 300, [hQuery, hKind])
  const [openGroup, setOpenGroup] = useState({})   // 펼친 다품목 묶음
  const timeOf = (ts) => ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : ''

  function exportHistory() {
    const data = histRows.map(r=>({
      '출고일':r.movement_date, '시각':timeOf(r.processed_at), '구분':r._kind,
      '기준코드':r.items?.std_code, '품명':r.items?.name,
      '단위':r.items?.unit, '수량':r.qty,
      '고객사PO':r.purchase_orders?.po_number||'',
      '고객사':(custName(r._custId) || r.purchase_orders?.customers?.name||'') + (r._custGuess ? ' (추정)' : ''),
      '프로젝트':(r._projCode||'') + (r._projGuess ? ' (추정)' : ''), '처리자':r._who||'', '비고':r._memo||'',
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'출고현황')
    XLSX.writeFile(wb,`출고현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📋 출고 현황</h1>
          <p className="text-xs text-slate-400 mt-0.5">ASSY 출고 · 다품목 출고 · 자재요청 불출 · 실사 조정 — 어느 고객사·프로젝트로, 누가 뺐는지</p>
        </div>
        <div className="flex gap-1.5">
          <Link to="/outbound" className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">📤 ASSY 출고</Link>
          <Link to="/issue" className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">🧺 다품목 출고</Link>
        </div>
      </div>
    <div className="space-y-4">
      <div className="flex items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">시작일</label>
          <input type="date" value={hFrom} onChange={e=>setHFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">종료일</label>
          <input type="date" value={hTo} onChange={e=>setHTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
          <select value={hCustomer} onChange={e=>setHCustomer(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">전체</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">구분</label>
          <select value={hKind} onChange={e=>setHKind(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">전체</option>
            {OUT_KINDS.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer})}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
        {histRows.length>0&&(
          <button onClick={exportHistory}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
        )}
        <div className="ml-auto text-xs text-slate-400 self-center">총 {histRows.length}건</div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">총 출고 건수</p><p className="text-xl font-bold text-slate-900">{histRows.length}</p></div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-xs font-bold text-rose-400 uppercase tracking-wide mb-1">총 출고 수량</p><p className="text-xl font-bold text-rose-700">{histTotal.toLocaleString()}</p></div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">품목 수</p><p className="text-xl font-bold text-indigo-700">{new Set(histRows.map(r=>r.item_id)).size}</p></div>
      </div>

      {histLoading ? <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div> : (
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['출고일','구분','기준코드','품명','수량','단위','고객사 PO','고객사','프로젝트','처리자','비고'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {histRows.length===0
                  ? <tr><td colSpan={11} className="text-center py-10 text-slate-400">출고 이력이 없습니다</td></tr>
                  : histView.shown.map(g => {
                    const r = g.rows[0], n = g.rows.length, open = !!openGroup[g.key]
                    const line = (r, sub, head) => (
                      <tr key={r.id} className={`border-b border-slate-100 ${sub ? 'bg-sky-50/40' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{sub ? <span className="text-slate-300 pl-3">└</span> : <>{r.movement_date}<span className="ml-1 font-normal text-slate-400">{timeOf(r.processed_at)}</span></>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{!sub && <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${KIND_TONE[r._kind] || ''}`}>{r._kind}</span>}</td>
                        <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.items?.std_code}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">
                          {r.items?.name}
                          {head && (
                            <button onClick={() => setOpenGroup(o => ({ ...o, [g.key]: !o[g.key] }))}
                              className="ml-2 px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[11px] font-bold hover:bg-sky-200 whitespace-nowrap">
                              {open ? '접기 ▴' : `외 ${n - 1}건 …`}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-rose-700">{r.qty}</td>
                        <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{sub ? '' : (r.purchase_orders?.po_number||'-')}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                          {sub ? '' : <>
                            {custName(r._custId) || r.purchase_orders?.customers?.name || '-'}
                            {r._custGuess && <span className="ml-1 text-[10px] text-amber-500" title="예전 기록이라 고객사가 저장돼 있지 않아 기준코드 앞자리로 추정했습니다">추정</span>}
                          </>}
                        </td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap" title={r._projName||''}>
                          {sub ? '' : <>
                            {r._projCode||'-'}
                            {r._projGuess && <span className="ml-1 text-[10px] text-amber-500" title="예전 기록이라 프로젝트가 저장돼 있지 않아, 출고된 부품을 전부 가진 BOM으로 찾았습니다">추정</span>}
                          </>}
                        </td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{sub ? '' : (r._who||'-')}</td>
                        <td className="px-3 py-2 text-slate-400">{r._memo||'-'}</td>
                      </tr>
                    )
                    if (n === 1) return line(r, false, false)
                    return (
                      <Fragment key={g.key}>
                        {line(r, false, true)}
                        {open && g.rows.slice(1).map(x => line(x, true, false))}
                      </Fragment>
                    )
                  })
                }
              </tbody>
            </table>
            <MoreRows {...histView} />
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
