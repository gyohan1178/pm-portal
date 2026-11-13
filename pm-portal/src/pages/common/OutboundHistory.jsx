import ItemLink from '../../components/ItemLink'
import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { useCustomers } from '../../hooks/useCustomers'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { todayISO, ymdKST } from '../../lib/utils'
import { useFillHeight } from '../../hooks/useFillHeight'
import { useCompact } from '../../hooks/useCompact'
import { SkeletonRows } from '../../components/ux/Skeleton'
import PageHead from '../../components/PageHead'
import { KpiCard, KpiRow } from '../../components/ui/Kpi'
import { EmptyRow, ErrorRow } from '../../components/ui/EmptyState'
import { BTN } from '../../lib/uiText'
import { fetchIssueAssys, assyKey } from '../../lib/issueAssy'

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
  const compact = useCompact()
  const LBL = compact ? 'hidden' : 'block text-xs font-bold text-slate-500 mb-1'   // 노트북에선 칸 이름 줄을 빼고 한 줄로 (v4.64.0)
  const [tblRef, tblH] = useFillHeight(true, 360)
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(todayISO())
  const [hCustomer, setHCustomer] = useState('')
  const [hKind, setHKind] = useState('')            // 경로 — 화면에서만 거른다
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: todayISO(), customerId:'' })
  const { data: customers=[] } = useCustomers()
  const { data: history=[], isLoading: histLoading, error: histErr, refetch: histRefetch } = useQuery({
    queryKey:['outboundHistory', hQuery],
    queryFn:()=>fetchOutboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId }),
  })

  const histRows = hKind ? history.filter(r => r._kind === hKind) : history
  const histTotal = histRows.reduce((a,r)=>a+(Number(r.qty)||0),0)
  const custName = (id) => customers.find(c => c.id === id)?.name || ''
  const histGroups = useMemo(() => groupHistory(histRows), [histRows])
  const histView = useVisibleRows(histGroups, 300, [hQuery, hKind])
  const [openGroup, setOpenGroup] = useState({})   // 펼친 다품목 묶음
  // 다품목 출고 — 어떤 상위품목을 몇 대분 뺐는지 (v4.183.0 · 기록은 이 버전부터)
  const [mode, setMode] = useState('line')         // line 출고 줄 · assy 상위품목 기준
  const [openAssy, setOpenAssy] = useState({})
  const { data: assyMap = new Map() } = useQuery({ queryKey: ['outboundAssys', hQuery], queryFn: () => fetchIssueAssys(hQuery) })
  const assysOf = (r) => (r && r._kind === '다품목 출고' ? assyMap.get(assyKey(r.processed_at, r._custId)) : null) || null
  // 상위품목 기준 — 기간 안에서 상위품목마다 몇 대분 · 몇 번 (고객사 조건 반영)
  const assyRows = useMemo(() => {
    const by = new Map()
    for (const g of groupHistory(history)) {
      const r = g.rows[0], list = assysOf(r)
      if (!list) continue
      for (const a of list) {
        const k = `${r._custId || ''}|${a.code}`
        const e = by.get(k) || { key: k, code: a.code, name: a.name, custId: r._custId, qty: 0, batches: [] }
        e.qty += a.qty
        e.batches.push({ key: g.key, date: r.movement_date, at: r.processed_at, qty: a.qty, who: r._who || a.by || '', lines: g.rows.length, others: list.filter((x) => x.code !== a.code).map((x) => `${x.code} ×${x.qty}`) })
        by.set(k, e)
      }
    }
    return [...by.values()].sort((a, b) => b.qty - a.qty || a.code.localeCompare(b.code))
  }, [history, assyMap])
  const timeOf = (ts) => ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : ''

  function exportHistory() {
    if (mode === 'assy') {
      const data = assyRows.flatMap((e) => e.batches.map((b) => ({ '상위품목': e.code, '품명': e.name || '', '고객사': custName(e.custId), '출고일': b.date, '시각': timeOf(b.at), '대수': b.qty, '같이 뺀 상위품목': b.others.join(', '), '부품 줄': b.lines, '처리자': b.who })))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '상위품목기준')
      XLSX.writeFile(wb, `출고현황_상위품목_${hQuery.from}_${hQuery.to}.xlsx`)
      return
    }
    const data = histRows.map(r=>({
      '출고일':r.movement_date, '시각':timeOf(r.processed_at), '구분':r._kind,
      '기준코드':r.items?.std_code, '품명':r.items?.name,
      '단위':r.items?.unit, '수량':r.qty,
      '고객사PO':r.purchase_orders?.po_number||'',
      '고객사':(custName(r._custId) || r.purchase_orders?.customers?.name||'') + (r._custGuess ? ' (추정)' : ''),
      '프로젝트':(r._projCode||'') + (r._projGuess ? ' (추정)' : ''), '처리자':r._who||'', '비고':r._memo||'',
      '상위품목(다품목)': (assysOf(r) || []).map((a) => `${a.code} ×${a.qty}`).join(', '),
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'출고현황')
    XLSX.writeFile(wb,`출고현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <PageHead crumb="자재" title="출고 현황"
        desc="ASSY 출고 · 다품목 출고 · 자재요청 불출 · 실사 조정 이력을 봅니다. 어느 고객사 · 프로젝트로, 누가 뺐는지 확인합니다.">
        <Link to="/outbound" className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 whitespace-nowrap">📤 ASSY 출고</Link>
        <Link to="/issue" className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 whitespace-nowrap">🧺 다품목 출고</Link>
        <button onClick={exportHistory} disabled={mode === 'assy' ? !assyRows.length : !histRows.length}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">{BTN.excel}</button>
      </PageHead>

      <KpiRow cols={3} data="outhist">
        <KpiCard label="총 출고 건수" value={histRows.length} note="조회 기간 · 조건 기준" loading={histLoading} />
        <KpiCard tone="blue" label="총 출고 수량" value={histTotal} note="빠져나간 수량 합계" loading={histLoading} />
        <KpiCard tone="pr" label="품목 수" value={new Set(histRows.map(r=>r.item_id)).size} note="출고된 품목 종류" loading={histLoading} />
      </KpiRow>
    <div className="space-y-4">
      <div className={`flex ${compact ? 'items-center gap-2 p-2' : 'items-end gap-3 p-4'} rounded-xl border border-slate-200 bg-slate-50 flex-wrap`}>
        <div>
          <label className={LBL}>시작일</label>
          <input type="date" value={hFrom} onChange={e=>setHFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
        </div>
        {compact && <span className="text-slate-400">~</span>}
        <div>
          <label className={LBL}>종료일</label>
          <input type="date" value={hTo} onChange={e=>setHTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
        </div>
        <div>
          <label className={LBL}>고객사</label>
          <select value={hCustomer} onChange={e=>setHCustomer(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">전체</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={LBL}>구분</label>
          <select value={hKind} onChange={e=>setHKind(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
            <option value="">전체</option>
            {OUT_KINDS.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer})}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold" data-outhist-mode>
          {[['line', '출고 줄'], ['assy', '🧩 상위품목 기준']].map(([k, t]) => (
            <button key={k} type="button" onClick={() => setMode(k)} data-mode={k}
              className={`px-2.5 py-1.5 rounded-md ${mode === k ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-50'}`}>{t}</button>
          ))}
        </div>
        <div className="ml-auto text-xs text-slate-400 self-center">{mode === 'assy' ? `상위품목 ${assyRows.length}종` : `총 ${histRows.length}건`}</div>
      </div>


      {mode === 'assy' ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white" data-assy-view>
          <div className="px-4 py-2.5 text-[12px] text-slate-500 bg-slate-50 border-b border-slate-200">
            다품목 출고에서 ASSY 로 전개해 뺀 것을 상위품목마다 모았습니다 · 줄을 누르면 출고한 날마다 나옵니다.
            <span className="text-slate-400"> 11월 13일(v4.183.0) 이후 다품목 출고부터 기록됩니다 · 단품으로 담은 것 · 호기 키팅은 세지 않습니다.</span>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-400">
              <th className="px-3 py-2.5 text-left font-bold">상위품목</th><th className="px-3 py-2.5 text-left font-bold">품명</th>
              <th className="px-3 py-2.5 text-left font-bold">고객사</th><th className="px-3 py-2.5 text-right font-bold">출고 대수</th>
              <th className="px-3 py-2.5 text-right font-bold">출고 횟수</th><th className="px-3 py-2.5 text-left font-bold">마지막 출고</th>
            </tr></thead>
            <tbody>
              {histLoading ? <SkeletonRows cols={6} rows={6} />
                : !assyRows.length ? <EmptyRow cols={6} icon="🧩" title="상위품목 기록이 없습니다" desc="이 기간에 ASSY 를 전개해 다품목 출고한 기록이 없습니다 (v4.183.0 이전 출고는 기록이 없습니다)." />
                : assyRows.map((e) => {
                  const op = !!openAssy[e.key], last = e.batches.reduce((a, b) => (String(b.at || b.date) > String(a.at || a.date) ? b : a), e.batches[0])
                  return (
                    <Fragment key={e.key}>
                      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenAssy((o) => ({ ...o, [e.key]: !o[e.key] }))} data-assy-row={e.code}>
                        <td className="px-3 py-2 font-mono text-indigo-600 whitespace-nowrap"><span className="text-slate-300 mr-1">{op ? '▾' : '▸'}</span>{e.code}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{e.name || '—'}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{custName(e.custId) || '—'}</td>
                        <td className="px-3 py-2 text-right font-extrabold text-violet-700 tabular-nums" data-assy-qty>{e.qty.toLocaleString('ko-KR')}대</td>
                        <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{e.batches.length}번</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{last.date} <span className="text-slate-400">{timeOf(last.at)}</span></td>
                      </tr>
                      {op && e.batches.map((b, i) => (
                        <tr key={e.key + i} className="border-b border-slate-100 bg-violet-50/30 text-slate-600">
                          <td className="px-3 py-1.5 text-slate-300 pl-8">└</td>
                          <td className="px-3 py-1.5" colSpan={2}>{b.date} <span className="text-slate-400">{timeOf(b.at)}</span> · {b.who || '—'} · 부품 {b.lines}줄{b.others.length ? <span className="text-slate-400"> · 같이: {b.others.join(', ')}</span> : null}</td>
                          <td className="px-3 py-1.5 text-right font-bold tabular-nums">{b.qty.toLocaleString('ko-KR')}대</td>
                          <td colSpan={2} />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
        </div>
      ) : histLoading ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <table className="w-full text-xs"><tbody><SkeletonRows cols={11} rows={10} /></tbody></table>
        </div>
      ) : (
        <div ref={tblRef} className="rounded-xl border border-slate-200 overflow-hidden flex flex-col" style={tblH ? { height: tblH + 'px' } : undefined}>
          <div className={tblH ? 'flex-1 min-h-0 overflow-auto' : 'overflow-x-auto'}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10"><tr className="bg-slate-50 border-b border-slate-200">
                {['출고일','구분','기준코드','품명','수량','단위','고객사 PO','고객사','프로젝트','처리자','비고'].map(h=>(
                  <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {histRows.length===0
                  ? (histErr ? <ErrorRow cols={11} error={histErr} onRetry={histRefetch} />
                    : <EmptyRow cols={11} icon="📋" title="출고 이력이 없습니다" desc="조회 기간 · 고객사 · 구분 조건을 바꿔 다시 조회해 보세요." />)
                  : histView.shown.map(g => {
                    const r = g.rows[0], n = g.rows.length, open = !!openGroup[g.key]
                    const line = (r, sub, head) => (
                      <tr key={r.id} className={`border-b border-slate-100 ${sub ? 'bg-sky-50/40' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{sub ? <span className="text-slate-300 pl-3">└</span> : <>{r.movement_date}<span className="ml-1 font-normal text-slate-400">{timeOf(r.processed_at)}</span></>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{!sub && <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${KIND_TONE[r._kind] || ''}`}>{r._kind}</span>}</td>
                        <td className="px-3 py-2 font-mono text-xs text-indigo-600"><ItemLink code={r.items?.std_code} /></td>
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
                          {sub ? '' : assysOf(r) ? (
                            <span className="text-violet-700 font-semibold" data-row-assys title={assysOf(r).map((a) => `${a.code} ${a.name || ''} ×${a.qty}대`).join('\n')}>
                              🧩 {assysOf(r)[0].code} ×{assysOf(r)[0].qty}대{assysOf(r).length > 1 ? ` 외 ${assysOf(r).length - 1}종` : ''}
                            </span>
                          ) : <>
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
