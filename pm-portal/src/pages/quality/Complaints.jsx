// 🛎 고객사 불만 접수 (v4.181.0) — 품질
//   고객사에서 들어온 불량 · 반품(RMA) 건을 고객사 양식 그대로 적고 모아 본다.
//   AXCELIS 는 「JINSUNTECH_RMA.xlsx」 대장 양식 (YY · DATE · RMA NO · Vendor ID · CASE_RESP_SITE_NAME · CASE_ID · CASE_PART_QTY
//   · PART_NUMBER · DESCRIPTION · CASE_TYPE_LVL2 · Disposition · CCN · 사유 · 비고). 다른 고객사 양식은 나중에.
import { useState, useMemo, useDeferredValue } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHead from '../../components/PageHead'
import { KpiCard } from '../../components/ui/Kpi'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import Spin from '../../components/ux/Spin'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import {
  AX_COLS, AX_DEFAULTS, DISPOSITIONS, CCNS, REASONS, COMPLAINT_SQL_HINT,
  STATUSES, STATUS_LABEL, COMPLAINT_STATUS_SQL, daysOpen,
  yyOf, nextRmaNo, fetchComplaints, saveComplaint, deleteComplaint, lookupPart, downloadComplaints,
} from '../../lib/complaint'

const CUSTS = [{ code: 'AX', name: 'AXCELIS', ready: true }, { code: 'ED', name: 'Edwards' }, { code: 'CS', name: 'CSK' }, { code: 'VM', name: 'VM' }]
const INP = 'w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-300'
const DISP_TONE = { Return: 'bg-sky-50 text-sky-700 border-sky-100', Scrap: 'bg-rose-50 text-rose-600 border-rose-100', Rework: 'bg-amber-50 text-amber-700 border-amber-100', Replacement: 'bg-emerald-50 text-emerald-700 border-emerald-100' }
const ST_TONE = { 접수: 'bg-amber-50 text-amber-700 border-amber-200', 조치중: 'bg-sky-50 text-sky-700 border-sky-200', 완료: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
const dispKey = (d) => DISPOSITIONS.find((x) => x.toLowerCase() === String(d || '').trim().toLowerCase()) || ''

export default function Complaints() {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = !!profile && canEdit(profile)
  const me = (profile?.name || '').trim() || profile?.email || ''
  const [cust] = useState('AX')
  const { data, isLoading, error } = useQuery({ queryKey: ['complaints', cust], queryFn: () => fetchComplaints(cust), staleTime: 30_000 })
  const rows = useMemo(() => data || [], [data])
  const [ask, confirmEl] = useConfirm()

  const [yy, setYy] = useState('all')
  const [disp, setDisp] = useState('')
  const [stF, setStF] = useState('')           // '' 전체 · open 미처리 · done 완료 (v4.204.0)
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim().toUpperCase()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const years = useMemo(() => [...new Set(rows.map(yyOf).filter(Boolean))].sort().reverse(), [rows])
  const thisYY = todayISO().slice(2, 4)
  const today = todayISO()
  // 처리 상태 칸이 있는지 (SQL 전이면 행에 status 키가 없다)
  const hasSt = !rows.length || rows.some((r) => 'status' in r)
  // 미처리 = 접수 · 조치 중 + 올해 건인데 상태를 아직 안 적은 것 (예전 이력의 빈 칸은 세지 않음)
  const isPending = (r) => r.status === '접수' || r.status === '조치중' || (!r.status && yyOf(r) === thisYY)
  const shown = rows.filter((r) => (yy === 'all' || yyOf(r) === yy)
    && (!stF || (stF === 'open' ? isPending(r) : r.status === '완료'))
    && (!disp || dispKey(r.disposition) === disp)
    && (!qd || ['rma_no', 'case_id', 'part_number', 'description', 'reason', 'note', 'action'].some((k) => String(r[k] || '').toUpperCase().includes(qd))))
  const yr = rows.filter((r) => yyOf(r) === thisYY)
  const kpi = {
    year: yr.length,
    ret: yr.filter((r) => dispKey(r.disposition) === 'Return').length,
    scrap: yr.filter((r) => dispKey(r.disposition) === 'Scrap').length,
    defect: yr.filter((r) => /불량/.test(r.reason || '')).length,
    pending: rows.filter(isPending).length,
  }

  const openNew = () => {
    const d = todayISO()
    setForm({ ...AX_DEFAULTS, ...(hasSt ? { status: '접수', _st: true } : {}), rma_date: d, rma_no: nextRmaNo(rows, d), case_id: '', qty: '', part_number: '', description: '', disposition: '', ccn: '', reason: '', note: '' })
  }
  const set = (k, v) => setForm((f) => {
    const n = { ...f, [k]: v }
    if (['status', 'action', 'done_date'].includes(k)) n._st = true
    if (k === 'status' && v === '완료' && !f.done_date) n.done_date = todayISO()
    // 날짜 연도를 바꾸면 새 접수의 RMA 번호도 그 해 번호로
    if (k === 'rma_date' && !f.id && String(v).slice(2, 4) !== String(f.rma_date || '').slice(2, 4)) n.rma_no = nextRmaNo(rows, v)
    return n
  })
  async function fillPart() {
    if (!form?.part_number || form.description) return
    const it = await lookupPart(form.part_number)
    if (it?.name) setForm((f) => (f && !f.description ? { ...f, description: it.name } : f))
  }
  async function save() {
    if (!form.rma_date) return toastError('DATE 를 넣어 주세요')
    if (!form.part_number && !form.description) return toastError('PART_NUMBER 나 DESCRIPTION 중 하나는 있어야 합니다')
    setBusy(true)
    try {
      await saveComplaint({ ...form, _by: me }, { cust, by: me })
      toastSuccess(`${form.rma_no || '불만 접수'} 저장`)
      setForm(null)
      qc.invalidateQueries({ queryKey: ['complaints', cust] })
    } catch (e) { toastError(e.message || String(e)) } finally { setBusy(false) }
  }
  async function remove() {
    const ok = await ask({ title: `${form.rma_no || '이 접수'} 를 지울까요?`, desc: '지우면 되돌릴 수 없습니다. 필요하면 먼저 엑셀로 받아 두세요.', okText: '지우기', danger: true })
    if (!ok) return
    setBusy(true)
    try { await deleteComplaint(form.id); toastSuccess('지웠습니다'); setForm(null); qc.invalidateQueries({ queryKey: ['complaints', cust] }) }
    catch (e) { toastError(e.message || String(e)) } finally { setBusy(false) }
  }
  async function excel() {
    try { await downloadComplaints(shown, { fileName: `JINSUNTECH_RMA_${todayISO().replace(/-/g, '').slice(2)}.xlsx` }) }
    catch (e) { toastError('엑셀 실패 — ' + (e.message || e)) }
  }

  const noTable = data === null
  return (
    <div className="space-y-4" data-complaints>
      {confirmEl}
      <PageHead crumb="품질" title="고객사 불만 접수"
        desc="고객사에서 들어온 불량 · 반품(RMA) 건을 고객사 양식 그대로 적고 모아 봅니다. AXCELIS 는 RMA 대장(JINSUNTECH_RMA) 양식이고, 엑셀도 같은 모양으로 내려받습니다.">
        <button type="button" onClick={excel} disabled={!shown.length} data-complaint-excel
          className="h-[38px] px-3.5 rounded-[9px] border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">📥 엑셀</button>
        {editable && <button type="button" onClick={openNew} disabled={noTable} data-complaint-new
          className="h-[38px] px-4 rounded-[9px] bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-40">+ 불만 접수</button>}
      </PageHead>

      <div className="flex flex-wrap items-center gap-2" data-complaint-custs>
        {CUSTS.map((c) => (
          <span key={c.code} title={c.ready ? '' : '이 고객사 양식은 준비 중입니다'}
            className={`px-3 py-1.5 rounded-full border text-[12.5px] font-bold ${c.code === cust ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-300'}`}>
            {c.name}{!c.ready && <span className="ml-1 text-[10.5px] font-medium">준비 중</span>}
          </span>
        ))}
      </div>

      {noTable && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800" data-complaint-nosql>⚠ {COMPLAINT_SQL_HINT}</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">불러오지 못했습니다 — {error.message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="미처리" value={hasSt ? kpi.pending : '—'} note={hasSt ? '접수 · 조치 중 + 올해 상태 미입력 · 누르면 그 건만' : `${COMPLAINT_STATUS_SQL} 실행 후 보임`} tone={kpi.pending ? 'red' : 'green'} loading={isLoading}
          onClick={hasSt ? () => setStF(stF === 'open' ? '' : 'open') : undefined} on={stF === 'open'} data-complaint-kpi-open />
        <KpiCard label={`올해(${thisYY}) 접수`} value={kpi.year} note="RMA 번호 기준" loading={isLoading} />
        <KpiCard label="Return (반품)" value={kpi.ret} note="올해 · 고객사에서 돌려받은 것" tone="blue" loading={isLoading} />
        <KpiCard label="Scrap (폐기)" value={kpi.scrap} note="올해 · 고객사에서 폐기한 것" tone="red" loading={isLoading} />
        <KpiCard label="제품 불량 사유" value={kpi.defect} note="올해 · 사유가 「불량」인 건" tone="amber" loading={isLoading} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={yy} onChange={(e) => setYy(e.target.value)} className="h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-white" data-complaint-year>
          <option value="all">전체 연도</option>
          {years.map((y) => <option key={y} value={y}>20{y}년</option>)}
        </select>
        <div className="flex gap-1">
          {['', ...DISPOSITIONS].map((d) => (
            <button key={d || 'all'} type="button" onClick={() => setDisp(d)} data-complaint-disp={d || 'all'}
              className={`h-9 px-3 rounded-full text-[12.5px] font-bold border ${disp === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{d || '전체'}</button>
          ))}
        </div>
        {hasSt && <div className="flex gap-1" data-complaint-stf>
          {[['', '처리 전체'], ['open', '미처리'], ['done', '완료']].map(([k, t]) => (
            <button key={k || 'all'} type="button" onClick={() => setStF(k)} data-complaint-st={k || 'all'}
              className={`h-9 px-3 rounded-full text-[12.5px] font-bold border ${stF === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{t}</button>
          ))}
        </div>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="RMA NO · CASE_ID · 품번 · 품명 · 사유 · 비고 검색" data-complaint-q
          className="h-9 flex-1 min-w-[240px] px-3 text-[13px] border border-slate-200 rounded-[10px] bg-white" />
        <span className="text-[12px] text-slate-400">{shown.length.toLocaleString('ko-KR')}건</span>
      </div>

      {/* 표 안에서 위아래 · 옆으로 스크롤 — 가로 스크롤 막대가 화면 안에 늘 보이게, 머리줄은 고정 (v4.204.0) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-auto max-h-[calc(100vh-150px)] min-h-[240px]" data-complaint-scroll>
        <table className="w-full min-w-[1500px] text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-[#f7f8fb] text-slate-600 shadow-[inset_0_-2px_0_#e2e8f0]">
            <tr>
              {hasSt && <th className="px-2.5 py-2.5 font-bold whitespace-nowrap text-left bg-[#f7f8fb]">처리</th>}
              {AX_COLS.map(([k, h]) => <th key={k} className={`px-2.5 py-2.5 font-bold whitespace-nowrap bg-[#f7f8fb] ${k === 'qty' ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonRows rows={6} cols={AX_COLS.length + (hasSt ? 1 : 0)} />}
            {!isLoading && !shown.length && <tr><td colSpan={AX_COLS.length + (hasSt ? 1 : 0)} className="px-3 py-10 text-center text-slate-400">{noTable ? 'SQL 반영 후 사용할 수 있습니다' : '접수 내역이 없습니다'}</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} onClick={() => editable && setForm({ ...r })} data-complaint-row={r.rma_no || r.id}
                className={`border-b border-slate-100 ${editable ? 'cursor-pointer hover:bg-violet-50/40' : ''}`}>
                {hasSt && <td className="px-2.5 py-2 whitespace-nowrap" data-complaint-status={r.status || ''} title={r.action ? `조치: ${r.action}` : ''}>
                  {r.status
                    ? <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-bold ${ST_TONE[r.status] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                    : <span className={`text-[11px] ${yyOf(r) === thisYY ? 'font-bold text-rose-500' : 'text-slate-300'}`}>미입력</span>}
                  {r.status === '완료' && r.done_date ? <span className="ml-1.5 font-mono text-[11px] text-slate-400">{r.done_date.slice(5).replace('-', '/')}</span>
                    : r.status && daysOpen(r, today) != null ? <span className={`ml-1.5 text-[11px] ${daysOpen(r, today) > 30 ? 'font-bold text-rose-500' : 'text-slate-400'}`}>{daysOpen(r, today)}일째</span> : null}
                </td>}
                <td className="px-2.5 py-2 text-slate-400">{yyOf(r)}</td>
                <td className="px-2.5 py-2 font-mono whitespace-nowrap">{r.rma_date || '—'}</td>
                <td className="px-2.5 py-2 font-mono font-bold text-[#5b6ee8] whitespace-nowrap">{r.rma_no || '—'}</td>
                <td className="px-2.5 py-2 font-mono text-slate-500">{r.vendor_id || ''}</td>
                <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{r.resp_site || ''}</td>
                <td className="px-2.5 py-2 font-mono whitespace-nowrap">{r.case_id || ''}</td>
                <td className="px-2.5 py-2 text-right font-mono">{r.qty || ''}</td>
                <td className="px-2.5 py-2 font-mono font-semibold">{r.part_number || ''}</td>
                <td className="px-2.5 py-2 max-w-[320px] truncate" title={r.description || ''}>{r.description || ''}</td>
                <td className="px-2.5 py-2 text-slate-500">{r.case_type || ''}</td>
                <td className="px-2.5 py-2">{r.disposition ? <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-bold ${DISP_TONE[dispKey(r.disposition)] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{r.disposition}</span> : ''}</td>
                <td className="px-2.5 py-2 text-center">{r.ccn || ''}</td>
                <td className="px-2.5 py-2 whitespace-nowrap">{r.reason || ''}</td>
                <td className="px-2.5 py-2 max-w-[240px] truncate text-slate-500" title={r.note || ''}>{r.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-start justify-center overflow-y-auto p-4">
          <div className="w-full max-w-[760px] mt-10 rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" data-complaint-form>
            <div className="px-6 pt-5 pb-3 border-b border-slate-100">
              <div className="text-[11px] text-slate-400">AXCELIS · RMA 대장 양식</div>
              <h2 className="text-lg font-extrabold text-slate-900">{form.id ? `불만 접수 수정 — ${form.rma_no || ''}` : '불만 접수'}</h2>
            </div>
            {/* 처리 상태 — 우리 쪽 관리용 (고객사 엑셀에는 안 나감) */}
            <div className="px-6 py-3 border-b border-slate-100" data-complaint-stbox>
              {hasSt ? (
                <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-start">
                  <div>
                    <span className="block text-[13px] font-bold text-slate-700 mb-1">처리 상태</span>
                    <div className="flex gap-1">
                      {STATUSES.map((st) => (
                        <button key={st} type="button" onClick={() => set('status', st)} data-f-status={st}
                          className={`h-9 px-3 rounded-lg border text-[12.5px] font-bold ${form.status === st ? ST_TONE[st] + ' ring-2 ring-offset-1 ring-violet-200' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'}`}>{STATUS_LABEL[st]}</button>
                      ))}
                    </div>
                    {form.status === '완료' && <input type="date" value={form.done_date || ''} onChange={(e) => set('done_date', e.target.value)} className={INP + ' mt-2 w-[160px]'} data-f="done_date" title="완료일" />}
                  </div>
                  <label className="block">
                    <span className="block text-[13px] font-bold text-slate-700 mb-1">조치 내용</span>
                    <textarea value={form.action || ''} onChange={(e) => set('action', e.target.value)} rows={2} data-f="action"
                      placeholder="예: 11/20 대체품 승인 회신 받음 · 재출하 완료" className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
                    <span className="block text-[11px] text-slate-400 mt-1">완료를 고르면 완료일이 오늘로 들어갑니다 · 이 칸은 고객사 엑셀에는 나가지 않습니다</span>
                  </label>
                </div>
              ) : <div className="text-[12px] text-amber-700">⚠ 처리 상태(접수 · 조치 중 · 완료)는 {COMPLAINT_STATUS_SQL} 실행 후 쓸 수 있습니다</div>}
            </div>
            <div className="px-6 py-4 bg-[#f9fafc] grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <F label="DATE" req help="접수일 — 연도가 바뀌면 RMA 번호도 그 해 번호로 바뀝니다">
                <input type="date" value={form.rma_date || ''} onChange={(e) => set('rma_date', e.target.value)} className={INP} data-f="rma_date" /></F>
              <F label="RMA NO" help="자동으로 그 해 다음 번호 (RMA#JS연도+4자리) — 고쳐도 됩니다">
                <input value={form.rma_no || ''} onChange={(e) => set('rma_no', e.target.value)} className={INP + ' font-mono'} data-f="rma_no" /></F>
              <F label="CASE_ID" help="고객사 케이스 번호 (CAS-… · C… / RQ…)">
                <input value={form.case_id || ''} onChange={(e) => set('case_id', e.target.value)} className={INP + ' font-mono'} placeholder="CAS-139295-Y6R8C6" data-f="case_id" /></F>
              <F label="CASE_PART_QTY" help="수량 — 「150 ft」 처럼 단위를 붙여도 됩니다">
                <input value={form.qty || ''} onChange={(e) => set('qty', e.target.value)} className={INP} data-f="qty" /></F>
              <F label="PART_NUMBER" help="AX- 없이 고객사 품번 — 칸을 벗어나면 품명이 자동으로 채워집니다">
                <input value={form.part_number || ''} onChange={(e) => set('part_number', e.target.value)} onBlur={fillPart} className={INP + ' font-mono'} placeholder="120005809" data-f="part_number" /></F>
              <F label="DESCRIPTION">
                <input value={form.description || ''} onChange={(e) => set('description', e.target.value)} className={INP} data-f="description" /></F>
              <F label="Disposition" help="Return 반품 · Scrap 폐기 · Rework 재작업 · Replacement 교체">
                <select value={dispKey(form.disposition) || form.disposition || ''} onChange={(e) => set('disposition', e.target.value)} className={INP} data-f="disposition">
                  <option value="">—</option>{DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
                </select></F>
              <F label="CCN">
                <select value={form.ccn || ''} onChange={(e) => set('ccn', e.target.value)} className={INP} data-f="ccn">
                  <option value="">—</option>{CCNS.map((d) => <option key={d}>{d}</option>)}
                </select></F>
              <F label="사유" help="목록에서 고르거나 직접 적기">
                <input value={form.reason || ''} onChange={(e) => set('reason', e.target.value)} list="complaint-reasons" className={INP} data-f="reason" />
                <datalist id="complaint-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist></F>
              <F label="CASE_TYPE_LVL2">
                <input value={form.case_type || ''} onChange={(e) => set('case_type', e.target.value)} className={INP} data-f="case_type" /></F>
              <F label="Vendor ID">
                <input value={form.vendor_id || ''} onChange={(e) => set('vendor_id', e.target.value)} className={INP + ' font-mono'} data-f="vendor_id" /></F>
              <F label="CASE_RESP_SITE_NAME">
                <input value={form.resp_site || ''} onChange={(e) => set('resp_site', e.target.value)} className={INP} data-f="resp_site" /></F>
              <div className="sm:col-span-2">
                <F label="비고"><input value={form.note || ''} onChange={(e) => set('note', e.target.value)} className={INP} placeholder="예: 본사 리워크 · 반환예상일" data-f="note" /></F>
              </div>
            </div>
            <div className="px-6 py-4 flex items-center gap-2 border-t border-slate-100">
              {form.id && <button type="button" onClick={remove} disabled={busy} data-complaint-del
                className="h-[38px] px-3.5 rounded-[9px] border border-rose-200 text-rose-600 text-[13px] font-bold hover:bg-rose-50 disabled:opacity-40">🗑 지우기</button>}
              <span className="flex-1" />
              <button type="button" onClick={() => setForm(null)} disabled={busy}
                className="h-[38px] px-4 rounded-[9px] border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" onClick={save} disabled={busy} data-complaint-save
                className="h-[38px] px-5 rounded-[9px] bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-40">{busy ? <Spin /> : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function F({ label, req, help, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-bold text-slate-700 mb-1">{label}{req && <span className="text-rose-500"> *</span>}</span>
      {children}
      {help && <span className="block text-[11px] text-slate-400 mt-1">{help}</span>}
    </label>
  )
}
