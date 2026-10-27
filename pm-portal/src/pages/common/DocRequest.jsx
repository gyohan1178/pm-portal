// 📎 자료 요청 (v4.98.0) — 도면 · BOM · 사양서를 영업에 요청하고 받을 때까지 따라간다
//   영업: 「받은 자료 요청」 — 고객사별로 모아 한 번에 요청 문구 · 진행 앞으로 / 한 칸 뒤로(잘못 눌렀을 때)
//   그 밖 부서: 「우리 부서 요청」 — 내가(우리 부서가) 요청했거나 같이 기다리는 것만. 받으면 「확인」
//   보이는 범위: 요청한 부서 + 영업 + 팀장급 · 관리자 (다른 부서의 요청 · 필요일 지남은 보이지 않음)
import { useState, useMemo, useEffect, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHead from '../../components/PageHead'
import { DocRequestButton } from '../../components/DocRequestModal'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { isLead } from '../../lib/workflow'
import { toastError, toastSuccess } from '../../lib/toast'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { useCoach } from '../../components/ux/CoachMarks'
import { DOC_STEPS, DOC_CUSTOMERS, KIND_BADGE, kindLabel, custName, custBadge, dLeft, fetchDocRequests, moveDoc, cancelDoc, autoRecv, mailText, docPerms } from '../../lib/docRequest'

const Seg = ({ items, value, onChange, data }) => (
  <div className="inline-flex flex-wrap gap-1 p-1 rounded-lg bg-[#e9ebf2]" data-seg={data}>
    {items.map(([k, label]) => (
      <button key={k} type="button" onClick={() => onChange(k)} data-seg-item={k}
        className={`px-2.5 py-1 rounded-md text-[12px] font-bold whitespace-nowrap ${value === k ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>{label}</button>
    ))}
  </div>
)

export default function DocRequest() {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = canEdit(profile)
  const seeAll = isLead(profile) || profile?.dept === '영업'
  const [view, setView] = useState(null)       // inbox(영업) | mine(우리 부서)
  const [cust, setCust] = useState('all')
  const [st, setSt] = useState('open')         // open | recv | done | all
  const [open, setOpen] = useState(null)       // 이력 펼친 줄
  const [mail, setMail] = useState(false)
  const [note, setNote] = useState({})         // 받음 메모 (줄마다)
  const [busy, setBusy] = useState(false)
  const [ask, confirmEl] = useConfirm()
  useEffect(() => { if (profile && !view) setView(seeAll ? 'inbox' : 'mine') }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: rows = [], error, isLoading, refetch } = useQuery({ queryKey: ['docRequests', 'list'], queryFn: fetchDocRequests, retry: false })
  // 열 때 한 번 — BOM 이 올라왔거나 NAS 에 도면이 들어온 요청을 자동 「받음」
  useEffect(() => {
    if (!editable || error) return
    autoRecv().then((n) => { if (n > 0) { toastSuccess(`자동으로 받음 처리 ${n}건 (BOM 등록 · NAS 도면)`); qc.invalidateQueries({ queryKey: ['docRequests'], exact: false }) } })
  }, [editable, !!error]) // eslint-disable-line react-hooks/exhaustive-deps

  const myDept = profile?.dept
  const visible = useMemo(() => rows.filter((r) => {
    if (view === 'inbox') return seeAll
    return r.from_dept === myDept || (r.also_depts || []).includes(myDept)
  }), [rows, view, seeAll, myDept])
  const stOk = (r) => st === 'all' ? true : r.cancelled ? false : st === 'open' ? r.status < 2 : st === 'recv' ? r.status === 2 : r.status === 3
  const list = visible.filter((r) => (cust === 'all' || r.customer_code === cust) && stOk(r))
    .sort((a, b) => (a.cancelled - b.cancelled) || (a.status - b.status) || String(a.need_date || '9999').localeCompare(String(b.need_date || '9999')))
  const count = (pred) => visible.filter((r) => !r.cancelled && pred(r)).length
  const lateN = count((r) => r.status < 2 && dLeft(r.need_date) < 0)
  const openN = count((r) => r.status < 2), recvN = count((r) => r.status === 2)

  const mailCust = cust === 'all' ? 'AX' : cust
  const mailRows = visible.filter((r) => !r.cancelled && r.status === 0 && r.customer_code === mailCust)

  async function act(fn, ok) {
    if (busy) return
    setBusy(true)
    try { await fn(); qc.invalidateQueries({ queryKey: ['docRequests'], exact: false }); qc.invalidateQueries({ queryKey: ['flowCounts'] }); if (ok) toastSuccess(ok) }
    catch (e) { toastError(e.message || String(e)) } finally { setBusy(false) }
  }
  const move = (r, to, msg) => act(() => moveDoc(r.id, to, to === 2 ? note[r.id] : msg), `${r.part_no} → ${DOC_STEPS[to]}`)
  const cancel = async (r) => {
    const ok = await ask({ title: `${[r.part_no, kindLabel(r)].filter(Boolean).join(' ')} 요청을 취소할까요?`, desc: '영업 목록에서 빠지고 「전체 (취소 포함)」에서만 보입니다. 같이 기다리던 부서가 있으면 그 부서도 더 기다리지 않게 됩니다.', okText: '요청 취소', cancelText: '그대로 두기', danger: true })
    if (ok) act(() => cancelDoc(r.id, '취소'), '취소했습니다')
  }
  // 처음 여는 사람 안내 (v4.104.0)
  const coach = useCoach('doc-request', [
    { sel: '[data-doc-new]', title: '① 자료가 필요하면 요청', body: '도면 · BOM · 사양서 · CN 내역 등 고객사 자료가 필요하면 여기서 영업에 요청하세요. 같은 자료를 다른 부서가 이미 요청했으면 「같이 기다리기」로 붙습니다.' },
    { sel: '[data-doc-toolbar]', title: '② 내 요청 따라가기', body: '「우리 부서 요청」에서 처리 중 · 받음 · 끝을 골라 봅니다. 영업이 자료를 받아 올리면 「받음」으로 넘어오고 알림이 갑니다.' },
    { sel: '[data-doc-steps]', title: '③ 받았으면 확인', body: '막대 4칸이 요청됨 → 고객사에 요청함 → 받음 → 확인 완료 입니다. 받은 자료를 확인하고 「✔ 확인」을 누르면 끝납니다.' },
  ], !isLoading)
  async function copyMail() {
    const text = mailText(mailRows, mailCust)
    try { await navigator.clipboard.writeText(text); toastSuccess('요청 문구를 복사했습니다 — 메일에 붙여넣으세요') } catch { toastError('복사가 안 되는 브라우저입니다 — 아래 글을 직접 복사하세요') }
  }
  const markAsked = () => act(async () => { for (const r of mailRows) await moveDoc(r.id, 1, '고객사 메일 요청') }, `${mailRows.length}건 「고객사에 요청함」`)

  return (
    <div className="space-y-4" data-doc-page>
      <PageHead crumb="공통" title="📎 자료 요청"
        desc="도면 · BOM · 사양서 · 그 밖의 자료(「직접 입력」 — 예: CN 내역)가 필요하면 영업에 요청하세요. 영업이 고객사에 받아 올리면 요청한 부서로 알림이 갑니다. 같은 자료를 다른 부서가 이미 요청했으면 「같이 기다리기」로 붙습니다.">
        <button type="button" onClick={coach.start} data-coach-again className="px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">💡 안내</button>
        <span data-doc-new className="inline-flex"><DocRequestButton label="+ 자료 요청" className="px-3 py-2 text-xs font-bold rounded-lg bg-[#6c5ce7] text-white" /></span>
      </PageHead>
      {confirmEl}{coach.el}

      {error && <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-800" data-doc-missing>{error.message}</div>}

      <div className="grid grid-cols-3 gap-3" data-doc-kpi>
        {[['필요일 지남', lateN, 'text-[#e0505f]', '받기 전인데 필요일이 지난 요청'], ['처리 중', openN, 'text-[#d99400]', '요청됨 · 고객사에 요청함'], ['받음 · 확인 대기', recvN, 'text-violet-600', '요청 부서가 확인하면 끝']].map(([l, n, c, sub]) => (
          <div key={l} className="bg-white rounded-xl px-4 py-3 shadow-[0_1px_3px_rgba(20,30,50,.06)]">
            <div className="text-[12.5px] text-slate-400 font-bold">{l}</div>
            <div className={`font-mono text-[26px] font-bold leading-tight ${c}`}>{n.toLocaleString('ko-KR')}</div>
            <div className="text-[11px] text-slate-400">{sub}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-3 shadow-[0_1px_3px_rgba(20,30,50,.06)] flex flex-wrap items-center gap-2" data-doc-toolbar>
        <Seg data="view" value={view} onChange={setView}
          items={[...(seeAll ? [['inbox', '📥 받은 자료 요청 (영업)']] : []), ['mine', '우리 부서 요청']]} />
        <Seg data="cust" value={cust} onChange={setCust}
          items={[['all', '전체'], ...DOC_CUSTOMERS.map((c) => [c.code, `${c.name}${count((r) => r.customer_code === c.code && r.status < 2) ? ' ' + count((r) => r.customer_code === c.code && r.status < 2) : ''}`])]} />
        <Seg data="st" value={st} onChange={setSt} items={[['open', '처리 중'], ['recv', '받음'], ['done', '끝'], ['all', '전체 (취소 포함)']]} />
        {view === 'inbox' && editable && (
          <button type="button" onClick={() => setMail((v) => !v)} data-doc-mail-btn className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">✉ {custName(mailCust)} 한 번에 요청 문구 ({mailRows.length})</button>
        )}
      </div>

      {mail && view === 'inbox' && (
        <div className="bg-white rounded-xl p-4 shadow-[0_1px_3px_rgba(20,30,50,.06)] space-y-2" data-doc-mail>
          <div className="text-[12px] font-bold text-slate-500">{custName(mailCust)} 담당자에게 — 아직 고객사에 요청 안 한 {custName(mailCust)} 건만 한 메일로 {cust === 'all' && <span className="font-normal text-slate-400">(위에서 고객사를 고르면 바뀝니다)</span>}</div>
          <pre className="whitespace-pre-wrap font-mono text-[12px] bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3 text-slate-600" data-doc-mail-text>{mailRows.length ? mailText(mailRows, mailCust) : '(아직 고객사에 요청 안 한 건이 없습니다)'}</pre>
          {mailRows.length > 0 && <div className="flex gap-2">
            <button type="button" onClick={copyMail} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#6c5ce7] text-white">📋 복사</button>
            <button type="button" onClick={markAsked} disabled={busy} data-doc-mark-asked className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600">보냈으면 — 이 {mailRows.length}건 「고객사에 요청함」으로</button>
          </div>}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-[0_1px_3px_rgba(20,30,50,.06)] overflow-x-auto" data-doc-table>
        <table className="w-full text-[12.5px] min-w-[960px]">
          <thead><tr className="bg-slate-50 text-[11.5px] text-slate-500 text-left">
            {['고객사', '자료', '품번 · 품명', '요청 부서', '필요일', '진행', '받은 자료 · 메모', ''].map((h) => <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {isLoading && <SkeletonRows cols={8} rows={6} two={[2]} />}
            {!isLoading && !list.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">{view === 'mine' ? '우리 부서가 요청한 자료가 없습니다' : '요청이 없습니다'}</td></tr>}
            {list.map((r) => {
              const p = docPerms(profile, r, editable)
              const dl = dLeft(r.need_date)
              const late = !r.cancelled && r.status < 2 && dl !== null && dl < 0
              return (
                <Fragment key={r.id}>
                  <tr className={`border-t border-slate-100 ${r.cancelled ? 'opacity-50' : ''}`} data-doc-row={r.id} data-doc-status={r.status}>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${custBadge(r.customer_code)}`}>{custName(r.customer_code)}</span></td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${KIND_BADGE[r.kind]}`} data-doc-kind-label>{kindLabel(r)}</span></td>
                    <td className="px-3 py-2">
                      <div className="font-mono font-bold text-[#5b6ee8] whitespace-nowrap">{r.part_no || <span className="font-sans font-normal text-slate-400">품번 없음</span>}{r.rev && <span className="ml-1 text-slate-400 font-sans font-normal">Rev {r.rev}</span>}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[260px]">{[r.item_name, r.ref].filter(Boolean).join(' · ')}</div>
                      {/* 왜 필요한지 — 목록에서 바로 보이게 (v4.101.0). 길면 두 줄까지, 누르면 아래에 전체 */}
                      {r.reason && <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} title={r.reason} data-doc-reason-show
                        className="mt-0.5 max-w-[260px] text-left text-[11.5px] leading-snug text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 hover:bg-amber-100 line-clamp-2 break-words">💬 {r.reason}</button>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.from_dept}{r.requester_name && <span className="text-slate-400"> · {r.requester_name}</span>}
                      {(r.also_depts || []).length > 0 && <div className="text-[11px] text-violet-600">+ 같이 기다림: {r.also_depts.join(', ')}</div>}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{String(r.need_date || '').slice(5) || '—'}
                      {r.cancelled ? <span className="ml-1 px-1.5 rounded-full bg-slate-100 text-slate-500 text-[10.5px] font-bold font-sans">취소</span>
                        : r.status >= 2 ? null
                        : dl !== null && <span className={`ml-1 px-1.5 rounded-full text-[10.5px] font-bold font-sans ${late ? 'bg-red-50 text-red-600' : dl <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{late ? `${-dl}일 지남` : `D-${dl}`}</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-0.5" data-doc-steps>{[0, 1, 2, 3].map((i) => <i key={i} className={`block h-1.5 w-5 rounded ${!r.cancelled && r.status >= i ? 'bg-[#6c5ce7]' : 'bg-slate-200'}`} />)}</div>
                      <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="text-[11px] text-slate-500 hover:text-violet-600 mt-0.5">{DOC_STEPS[r.status]} {(r.history || []).length > 0 && '· 이력'}</button>
                    </td>
                    <td className="px-3 py-2">
                      {r.recv_note && <div className="text-[11.5px] text-slate-600 max-w-[220px] break-all">{r.recv_note}</div>}
                      {p.next && r.status === 1 && <input value={note[r.id] || ''} onChange={(e) => setNote((m) => ({ ...m, [r.id]: e.target.value }))}
                        placeholder="받은 파일 · NAS 경로 (선택)" className="mt-0.5 w-full min-w-[160px] px-2 py-1 text-[11.5px] border border-slate-200 rounded" data-doc-note />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {p.prev && <button type="button" disabled={busy} onClick={() => move(r, r.status - 1, '한 칸 되돌림')} data-doc-prev title="잘못 눌렀을 때 — 한 칸 뒤로"
                          className="px-2 py-1 text-[11.5px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">◀ {DOC_STEPS[r.status - 1]}</button>}
                        {p.next && <button type="button" disabled={busy} onClick={() => move(r, r.status + 1)} data-doc-next
                          className="px-2 py-1 text-[11.5px] font-bold rounded-lg bg-[#6c5ce7] text-white">{r.status === 0 ? '고객사에 요청함 ▶' : '받음 ▶'}</button>}
                        {p.confirm && <button type="button" disabled={busy} onClick={() => move(r, 3, '요청 부서 확인')} data-doc-confirm className="px-2 py-1 text-[11.5px] font-bold rounded-lg bg-emerald-600 text-white">✔ 확인</button>}
                        {p.unconfirm && <button type="button" disabled={busy} onClick={() => move(r, 2, '확인 취소')} data-doc-unconfirm className="px-2 py-1 text-[11.5px] font-bold rounded-lg border border-slate-200 text-slate-500">◀ 확인 취소</button>}
                        {p.cancel && <button type="button" disabled={busy} onClick={() => cancel(r)} data-doc-cancel className="px-2 py-1 text-[11.5px] font-bold rounded-lg text-slate-400 hover:text-red-500">취소</button>}
                      </div>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-slate-50/70" data-doc-history={r.id}><td colSpan={8} className="px-4 py-2 text-[11.5px] text-slate-600">
                      {r.reason && <div className="mb-2 px-3 py-2 rounded-lg bg-white border border-amber-200 text-[12.5px] text-slate-700 whitespace-pre-wrap break-words" data-doc-reason-full><b className="text-amber-700">💬 왜 필요한가요</b> — {r.reason}</div>}
                      <div className="font-bold text-slate-500 mb-1">이력 — 요청 {String(r.created_at || '').slice(0, 16).replace('T', ' ')} {r.requester_name || ''}</div>
                      {(r.history || []).map((h, i) => (
                        <div key={i}>{String(h.at || '').slice(0, 16).replace('T', ' ')} · {h.by} · {h.to === 'cancel' ? '취소' : h.from === h.to ? '' : `${DOC_STEPS[h.from] || h.from} → ${DOC_STEPS[h.to] || h.to}`}{h.note ? ` · ${h.note}` : ''}</div>
                      ))}
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 px-1">진행 4칸 = 요청됨 → 고객사에 요청함 → 받음 → 요청 부서 확인. 영업은 「◀」로 한 칸 되돌릴 수 있습니다(이력에 남음). BOM 이 등록되거나 NAS 에 필요한 Rev 도면이 들어오면 자동으로 「받음」, 받은 도면은 생산기술 「사내 도면 배포」 대기로 넘어갑니다.</p>
    </div>
  )
}
