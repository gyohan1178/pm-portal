// 🏢 사내 배포 — 도면 배포이력 두 번째 탭 (v4.93.0)
//   영업이 고객사에서 받은 새 Rev 도면을 생산기술에 공유 → 생산기술이 부서를 골라 사내 배포 → 부서마다 수령 확인 → 옛 Rev 반납
//   아래 「도면별 현황」에서 도면번호 하나로 사내 · 외주에 어느 Rev 가 나가 있는지, 옛 Rev 가 남은 곳을 본다
import { useState, useMemo, useDeferredValue } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { CUSTOMERS } from '../../lib/customers'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { logActivity } from '../../lib/activityLog'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { RCV_DEPTS, REASONS, myRcvDepts, fetchDwgInt, stateOf, STATE_LABEL, STATE_TONE, lastRev, parseDwgPaste, shareDwg, distribute, markRcpt, cancelDwg, fetchExtDist, revMap } from './dwgInt'

const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
const INP = 'w-full px-2.5 py-2 text-[13px] border border-slate-200 rounded-lg bg-white'
const csName = (c) => CUSTOMERS.find((x) => x.id === c)?.name || (c ? String(c).toUpperCase() : '')

export default function InternalDist() {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = !!profile && canEdit(profile)
  const meName = (profile?.name || '').trim() || profile?.email || ''
  const mine = myRcvDepts(profile)
  const today = todayISO()

  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['dwgInt'], queryFn: fetchDwgInt, staleTime: 30 * 1000 })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['dwgInt'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] }) }
  const [ask, confirmEl] = useConfirm()   // v4.104.0 — 배포 기록 취소 확인 창

  const [only, setOnly] = useState('live')        // live 진행 중 · shared · unrcv · unret · all
  const [dept, setDept] = useState('all')
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim().toUpperCase()
  const [share, setShare] = useState(null)        // 영업 공유 폼
  const [dist, setDist] = useState(null)          // 사내 배포 폼 { id?, paste, ... }
  const [look, setLook] = useState('')            // 도면별 현황 — 도면번호
  const [busy, setBusy] = useState(null)

  const all = useMemo(() => rows.map((r) => ({ ...r, st: stateOf(r) })), [rows])
  const hit = (r) => !qd || [r.drawing_no, r.item_name, r.cn_no, r.share_name, r.dist_name, r.share_memo, ...r.rcpts.flatMap((x) => [x.dept, x.received_name])]
    .some((v) => String(v || '').toUpperCase().includes(qd))
  const scoped = all.filter((r) => hit(r) && (dept === 'all' || r.rcpts.some((x) => x.dept === dept)))
  const cnt = (k) => scoped.filter((r) => r.st === k).length
  const shown = scoped.filter((r) => (only === 'all' ? true : only === 'live' ? ['shared', 'unrcv', 'unret'].includes(r.st) : r.st === only))
  const month = today.slice(0, 7)
  const kpi = {
    shared: cnt('shared'),
    unrcv: scoped.reduce((a, r) => a + (r.status === '배포' ? r.rcpts.filter((x) => !x.received_at).length : 0), 0),
    unret: scoped.reduce((a, r) => a + (r.status === '배포' && r.recall_old ? r.rcpts.filter((x) => x.received_at && !x.returned_at).length : 0), 0),
    month: scoped.filter((r) => r.status === '배포' && String(r.dist_at).slice(0, 7) === month).length,
  }

  async function run(key, fn, ok) {
    setBusy(key)
    try { await fn(); if (ok) toastSuccess(ok); refresh() } catch (e) { toastError(e.message || String(e)) } finally { setBusy(null) }
  }

  async function saveShare() {
    if (!share.drawing_no.trim() || !share.rev.trim()) { toastError('도면번호 · 새 Rev 는 꼭 넣어 주세요'); return }
    await run('share', async () => {
      const r = await shareDwg(share, meName)
      logActivity('create', 'pm_dwg_int', r.drawing_no, `도면 공유(영업 → 생산기술) — ${r.drawing_no} Rev ${r.rev}`)
    }, '생산기술에 공유했습니다')
    setShare(null)
  }

  const openDist = (r) => {
    const prev = r ? (r.prev_rev || lastRev(rows, r.drawing_no, r.id)) : null
    setDist({
      id: r?.id || null, paste: r ? `${r.drawing_no}\t${r.item_name || ''}\t${r.rev || ''}` : '', customer_code: r?.customer_code || '',
      reason: r ? '설계변경' : '설계변경', cn_no: r?.cn_no || '', memo: '', recall: !!prev && prev !== r?.rev,
      depts: Object.fromEntries(RCV_DEPTS.map((d) => [d, d === '전장팀' || d === '품질팀' ? 1 : 0])),
    })
  }
  async function saveDist() {
    const items = parseDwgPaste(dist.paste)
    const depts = Object.entries(dist.depts).filter(([, c]) => Number(c) > 0).map(([d, c]) => ({ dept: d, copies: c }))
    if (!items.length) { toastError('도면을 넣어 주세요 (도면번호 · 품명 · Rev)'); return }
    if (!depts.length) { toastError('받을 부서를 하나 이상 골라 주세요'); return }
    if (dist.id && items.length > 1) { toastError('공유된 도면은 한 장씩 배포합니다'); return }
    await run('dist', async () => {
      for (const it of items) {
        const prev = lastRev(rows, it.drawing_no, dist.id)
        const head = { drawing_no: it.drawing_no, item_name: it.item_name || null, rev: it.rev || null, prev_rev: prev && prev !== it.rev ? prev : (dist.id ? rows.find((x) => x.id === dist.id)?.prev_rev || null : null),
          customer_code: dist.customer_code || null, reason: dist.reason, cn_no: dist.cn_no.trim() || null, memo: dist.memo.trim() || null, recall_old: !!dist.recall }
        const r = await distribute({ id: dist.id, head, depts, meName })
        logActivity('create', 'pm_dwg_int', r.drawing_no, `사내 배포 — ${r.drawing_no} Rev ${r.rev || '—'} → ${depts.map((d) => d.dept).join(' · ')}`)
      }
    }, `사내 배포 ${items.length}건`)
    setDist(null)
  }

  // 도면별 현황
  const lookKey = look.trim()
  const { data: ext = [] } = useQuery({ queryKey: ['dwgExt', lookKey], queryFn: () => fetchExtDist(lookKey), enabled: !!lookKey })
  const rm = lookKey ? revMap(rows, ext, lookKey) : null

  if (error && /pm_dwg_int/.test(error.message || '')) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">사내 배포 표가 아직 없습니다. Supabase SQL Editor 에서 <b>사내배포_반영_261023.sql</b> 을 먼저 실행해 주세요.<div className="text-xs mt-1 text-amber-600">{error.message}</div></div>
  }

  const Kpi = ({ tone, label, v, sub }) => (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}><div className="text-[12px] text-slate-500">{label}</div><div className="text-[26px] font-extrabold leading-tight tabular-nums">{n(v)}</div><div className="text-[11px] text-slate-500 truncate">{sub}</div></div>
  )
  const pill = (k, l, c, tone) => (
    <button key={k} type="button" onClick={() => setOnly(only === k ? 'live' : k)} data-dwg-only={k}
      className={`px-3 py-1.5 rounded-full text-xs font-bold border ${only === k ? 'bg-slate-800 text-white border-slate-800' : tone || 'bg-white text-slate-600 border-slate-200'}`}>{l} <b className="font-mono">{n(c)}</b></button>
  )

  return (
    <div className="space-y-3" data-dwg-int>
      {confirmEl}
      <p className="page-desc text-[13px] text-slate-400">
        영업이 고객사에서 받은 새 Rev 도면을 생산기술에 <b>공유</b>하면, 생산기술이 받을 부서를 골라 <b>사내 배포</b>합니다. 받은 부서는 <b>수령 확인</b>, Rev 가 바뀌었으면 옛 도면을 <b>반납</b>합니다.
        {mine.length > 0 && <span className="ml-1 text-violet-600 font-semibold">내가 확인하는 부서: {mine.length === RCV_DEPTS.length ? '전체 (팀장급)' : mine.join(' · ')}</span>}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="bg-violet-50/70 border-violet-100 text-violet-700" label="배포 대기 (영업 공유)" v={kpi.shared} sub="생산기술이 사내 배포할 새 Rev 도면" />
        <Kpi tone="bg-amber-50/70 border-amber-100 text-amber-700" label="수령 확인 대기" v={kpi.unrcv} sub="받은 부서가 아직 「수령 확인」 안 누름 (부서 수)" />
        <Kpi tone="bg-red-50/70 border-red-100 text-red-600" label="옛 Rev 반납 대기" v={kpi.unret} sub="새 Rev 를 받았는데 옛 도면이 현장에 남음" />
        <Kpi tone="bg-white border-slate-200 text-slate-800" label="이번 달 사내 배포" v={kpi.month} sub="도면 장 수" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {pill('live', '진행 중', scoped.filter((r) => ['shared', 'unrcv', 'unret'].includes(r.st)).length)}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          {pill('shared', '배포 대기', cnt('shared'), 'bg-violet-50 text-violet-700 border-violet-200')}
          {pill('unrcv', '수령 대기', cnt('unrcv'), 'bg-amber-50 text-amber-700 border-amber-200')}
          {pill('unret', '반납 대기', cnt('unret'), 'bg-red-50 text-red-600 border-red-200')}
          {pill('done', '끝', cnt('done'))}
          {pill('all', '전체', scoped.length)}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          {['all', ...RCV_DEPTS].map((d) => (
            <button key={d} type="button" onClick={() => setDept(d)} data-dwg-dept={d}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${dept === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{d === 'all' ? '모든 부서' : d}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 도면번호 · 품명 · CN 번호 · 공유한 사람 · 받은 사람" className="flex-1 min-w-0 basis-full md:basis-auto md:min-w-[260px] px-3 py-2 text-xs border border-slate-200 rounded-lg" />
          {editable && <button type="button" onClick={() => setShare({ customer_code: 'ax', drawing_no: '', item_name: '', rev: '', prev_rev: '', share_memo: '', file_ref: '' })} data-dwg-share-new
            className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-violet-300 text-violet-700 hover:bg-violet-50">📤 도면 공유 (영업 → 생산기술)</button>}
          {editable && <button type="button" onClick={() => openDist(null)} data-dwg-dist-new className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-700">＋ 사내 배포</button>}
        </div>
      </div>

      {share && (
        <div className="bg-white border border-violet-200 rounded-xl p-4 space-y-3" data-dwg-share-form>
          <div className="flex items-center"><b className="text-sm">📤 도면 공유 — 영업 → 생산기술</b><button type="button" onClick={() => setShare(null)} className="ml-auto text-xs font-bold text-slate-500">✕ 닫기</button></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50/70 rounded-lg p-3">
            <label className="text-xs font-bold text-slate-600 space-y-1">고객사<select value={share.customer_code} onChange={(e) => setShare({ ...share, customer_code: e.target.value })} className={INP}>{CUSTOMERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">도면번호 <span className="text-red-500">*</span><input value={share.drawing_no} onChange={(e) => setShare({ ...share, drawing_no: e.target.value })} className={`${INP} font-mono`} data-dwg-share-no /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-2">품명<input value={share.item_name} onChange={(e) => setShare({ ...share, item_name: e.target.value })} className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">새 Rev <span className="text-red-500">*</span><input value={share.rev} onChange={(e) => setShare({ ...share, rev: e.target.value })} className={INP} data-dwg-share-rev /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">지금 쓰는 Rev<input value={share.prev_rev} onChange={(e) => setShare({ ...share, prev_rev: e.target.value })} placeholder={lastRev(rows, share.drawing_no) ? `사내 배포 기준 ${lastRev(rows, share.drawing_no)}` : '모르면 비움'} className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-2">도면 위치 (NAS 경로 · 메일 제목)<input value={share.file_ref} onChange={(e) => setShare({ ...share, file_ref: e.target.value })} placeholder="\\jinsuntech-nas\…  또는  [Axcelis] Rev C drawing" className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-4">메모<input value={share.share_memo} onChange={(e) => setShare({ ...share, share_memo: e.target.value })} placeholder="예: PO Rev C 인데 사내 도면 B — 고객사에 요청해 받음" className={INP} /></label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShare(null)} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200">취소</button>
            <button type="button" disabled={busy === 'share'} onClick={saveShare} data-dwg-share-save className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">공유</button>
          </div>
        </div>
      )}

      {dist && (
        <div className="bg-white border border-violet-200 rounded-xl p-4 space-y-3" data-dwg-dist-form>
          <div className="flex items-center"><b className="text-sm">＋ 사내 배포{dist.id ? ' — 영업 공유 도면' : ''}</b><button type="button" onClick={() => setDist(null)} className="ml-auto text-xs font-bold text-slate-500">✕ 닫기</button></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50/70 rounded-lg p-3">
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-4">도면 <span className="text-red-500">*</span>
              <textarea rows={dist.id ? 1 : 3} value={dist.paste} readOnly={!!dist.id} onChange={(e) => setDist({ ...dist, paste: e.target.value })} data-dwg-dist-paste
                placeholder={'도면번호 · 품명 · Rev 순서로 붙여넣기 (여러 줄)\n110219638\tASSY PWR DIST EFEM\tB'} className={`${INP} font-mono text-[12px]`} /></label>
            <fieldset className="md:col-span-2 space-y-1.5">
              <legend className="text-xs font-bold text-slate-600 mb-1">받는 부서 · 부수 <span className="text-red-500">*</span></legend>
              {RCV_DEPTS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={Number(dist.depts[d]) > 0} onChange={(e) => setDist({ ...dist, depts: { ...dist.depts, [d]: e.target.checked ? 1 : 0 } })} data-dwg-dept-chk={d} className="w-4 h-4 accent-violet-600" /> {d}
                  <input value={dist.depts[d] || ''} onChange={(e) => setDist({ ...dist, depts: { ...dist.depts, [d]: e.target.value.replace(/\D/g, '') } })} aria-label={`${d} 부수`} className="ml-auto w-14 px-2 py-1 text-right text-xs border border-slate-200 rounded" /> 부
                </label>
              ))}
            </fieldset>
            <div className="md:col-span-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-slate-600 space-y-1">사유<select value={dist.reason} onChange={(e) => setDist({ ...dist, reason: e.target.value })} className={INP}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="text-xs font-bold text-slate-600 space-y-1">CN 번호<input value={dist.cn_no} onChange={(e) => setDist({ ...dist, cn_no: e.target.value })} placeholder="설계변경일 때" className={INP} /></label>
              </div>
              <label className="flex items-center gap-2 text-[13px] font-bold text-slate-700"><input type="checkbox" checked={dist.recall} onChange={(e) => setDist({ ...dist, recall: e.target.checked })} data-dwg-recall className="w-4 h-4 accent-red-600" /> 옛 Rev 회수 요청 (받은 부서가 옛 도면을 반납)</label>
              <label className="text-xs font-bold text-slate-600 space-y-1 block">메모<input value={dist.memo} onChange={(e) => setDist({ ...dist, memo: e.target.value })} className={INP} /></label>
              <p className="text-[11.5px] text-slate-500">받은 부서는 업무 흐름 · 이 화면에서 「수령 확인」을 누릅니다. Rev 가 바뀌었으면 「옛 Rev 회수」가 자동으로 켜집니다.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDist(null)} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200">취소</button>
            <button type="button" disabled={busy === 'dist'} onClick={saveDist} data-dwg-dist-save className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">배포 기록</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
            <th className="px-3 py-2.5 font-bold">날짜</th><th className="px-3 font-bold">도면번호 · 품명</th><th className="px-3 font-bold">Rev</th><th className="px-3 font-bold">사유</th>
            <th className="px-3 font-bold">받는 부서 · 수령 확인</th><th className="px-3 font-bold">옛 Rev 반납</th><th className="px-3 font-bold">공유 · 배포</th><th className="px-3 font-bold">상태</th>
          </tr></thead>
          <tbody>
            {isLoading && <SkeletonRows cols={8} rows={6} two={[0, 1]} />}
            {!isLoading && !shown.length && <tr><td colSpan={8} className="p-10 text-center text-slate-400">{rows.length ? '조건에 맞는 배포가 없습니다' : '아직 사내 배포 기록이 없습니다 — 영업은 「📤 도면 공유」, 생산기술은 「＋ 사내 배포」로 시작하세요'}</td></tr>}
            {shown.map((r) => {
              const myOpen = r.rcpts.filter((x) => mine.includes(x.dept) && !x.received_at)
              const myRet = r.recall_old ? r.rcpts.filter((x) => mine.includes(x.dept) && x.received_at && !x.returned_at) : []
              const b = busy === r.id
              const late = (x) => !x.received_at && r.dist_at && (Date.now() - new Date(r.dist_at)) / 86400000 > 2
              return (
                <tr key={r.id} className={`border-t border-slate-100 align-top ${r.st === 'cancel' ? 'opacity-40' : ''}`} data-dwg-row={`${r.drawing_no}|${r.rev || ''}`}>
                  <td className="px-3 py-3 font-mono text-slate-600 whitespace-nowrap">{md(r.dist_at || r.shared_at || r.created_at)}<div className="text-[10.5px] text-slate-400">#{r.seq}</div></td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setLook(r.drawing_no)} title="도면별 현황 보기" className="font-mono font-bold text-[#5b6ee8] hover:underline" data-dwg-look={r.drawing_no}>{r.drawing_no}</button>
                    <div className="text-[11px] text-slate-500">{[csName(r.customer_code), r.item_name].filter(Boolean).join(' · ')}</div>
                    {r.share_memo && <div className="text-[11px] text-sky-700 truncate max-w-[240px]" title={r.share_memo}>💬 {r.share_memo}</div>}
                    {r.file_ref && <div className="text-[10.5px] text-slate-400 truncate max-w-[240px]" title={r.file_ref}>📁 {r.file_ref}</div>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.prev_rev && <><span className="text-slate-400 line-through">{r.prev_rev}</span> → </>}<span className="px-1.5 py-[1px] rounded bg-violet-50 text-violet-700 font-bold">{r.rev || '—'}</span></td>
                  <td className="px-3 py-3"><div className="font-bold text-slate-700">{r.status === '공유됨' ? '새 Rev (영업)' : r.reason}</div>{r.cn_no && <div className="text-[11px] text-slate-500">CN {r.cn_no}</div>}</td>
                  <td className="px-3 py-3">
                    {r.status === '공유됨' ? <span className="text-slate-400">배포 전</span> : (
                      <div className="flex flex-wrap gap-1">
                        {r.rcpts.map((x) => (
                          <span key={x.id} title={x.received_at ? `${x.received_name || ''} ${String(x.received_at).slice(0, 16).replace('T', ' ')} · ${x.copies}부` : `${x.copies}부 · 수령 확인 전`} data-dwg-rcpt={x.dept}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${x.received_at ? 'bg-emerald-50 text-emerald-700' : late(x) ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                            {x.received_at ? `✓ ${x.dept} ${md(x.received_at)}` : `⏳ ${x.dept}`}
                          </span>
                        ))}
                      </div>
                    )}
                    {editable && myOpen.length > 0 && <button type="button" disabled={b} onClick={() => run(r.id, () => markRcpt(myOpen.map((x) => x.id), 'recv', meName), '수령 확인했습니다')} data-dwg-recv
                      className="mt-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-bold bg-emerald-600 text-white disabled:opacity-40">✓ 수령 확인 ({myOpen.map((x) => x.dept).join(' · ')})</button>}
                  </td>
                  <td className="px-3 py-3">
                    {!r.recall_old || r.status !== '배포' ? <span className="text-slate-300">—</span> : (
                      <div className="flex flex-wrap gap-1">
                        {r.rcpts.map((x) => <span key={x.id} className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${x.returned_at ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{x.returned_at ? `✓ ${x.dept}` : `⏳ ${x.dept} ${r.prev_rev || '옛 Rev'}`}</span>)}
                      </div>
                    )}
                    {editable && myRet.length > 0 && <button type="button" disabled={b} onClick={() => run(r.id, () => markRcpt(myRet.map((x) => x.id), 'ret', meName), '옛 Rev 반납 확인')} data-dwg-ret
                      className="mt-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-bold bg-white border border-red-200 text-red-600 disabled:opacity-40">옛 Rev 반납 ({myRet.map((x) => x.dept).join(' · ')})</button>}
                  </td>
                  <td className="px-3 py-3 text-[11.5px] text-slate-600 whitespace-nowrap">
                    {r.share_name && <div>공유 {r.share_name} {md(r.shared_at)}</div>}
                    {r.dist_name && <div>배포 {r.dist_name} {md(r.dist_at)}</div>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${STATE_TONE[r.st]}`} data-dwg-state={r.st}>{STATE_LABEL[r.st]}</span>
                    <div className="mt-1.5 flex gap-1.5">
                      {editable && r.status === '공유됨' && <button type="button" onClick={() => openDist(r)} data-dwg-dist-it className="px-2.5 py-1 rounded-lg text-[11.5px] font-bold bg-violet-600 text-white">사내 배포하기 →</button>}
                      {editable && r.status !== '취소' && r.rcpts.every((x) => !x.received_at) && <button type="button" onClick={async () => { if (await ask({ title: `${r.drawing_no} Rev ${r.rev || ''} 기록을 취소할까요?`, desc: '이 배포 기록이 「취소」 상태가 됩니다 (지워지지는 않음). 아직 수령한 부서가 없는 기록만 취소할 수 있습니다.', items: [`${r.drawing_no}${r.item_name ? ` · ${r.item_name}` : ''} · Rev ${r.rev || '-'}`], okText: '기록 취소', cancelText: '그대로 두기', danger: true })) run(r.id, () => cancelDwg(r.id), '취소했습니다') }} className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-red-500">취소</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-4" data-dwg-look-panel>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-[14px] font-extrabold text-slate-800">🔎 도면별 현황</h2>
          <input value={look} onChange={(e) => setLook(e.target.value)} placeholder="도면번호 (목록에서 도면번호를 눌러도 됨)" className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg font-mono w-64" data-dwg-look-input />
          {rm && <span className="text-[12px] text-slate-500">현재 Rev <b className="text-violet-700">{rm.cur || '—'}</b> · 옛 Rev 가 남은 곳 <b className="text-red-600" data-dwg-left>{rm.list.reduce((a, v) => a + v.leftInt.length + v.leftExt.length, 0)}</b></span>}
        </div>
        {!rm && <p className="text-[12px] text-slate-400">도면번호를 넣으면 사내(부서) · 외주(협력사)에 어느 Rev 가 나가 있는지 한 번에 봅니다.</p>}
        {rm && !rm.list.length && <p className="text-[12px] text-slate-400">이 도면번호로 배포한 기록이 없습니다.</p>}
        {rm && rm.list.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {rm.list.map((v) => (
              <div key={v.rev} className={`rounded-lg border p-3 ${v.current ? 'border-violet-200 bg-violet-50/40' : 'border-red-100 bg-red-50/30'}`} data-dwg-rev={v.rev}>
                <div className="text-[12.5px] font-extrabold mb-1">Rev {v.rev} {v.current ? <span className="ml-1 px-1.5 py-[1px] rounded-full bg-violet-100 text-violet-700 text-[10.5px]">현재</span> : <span className="ml-1 px-1.5 py-[1px] rounded-full bg-red-100 text-red-600 text-[10.5px]">옛 도면</span>}</div>
                <div className="text-[12px] leading-relaxed">
                  🏢 사내 — {v.int.length ? v.int.map((x, i) => <span key={i} className={!v.current && !x.returned_at ? 'text-red-600 font-bold' : ''}>{i ? ' · ' : ''}{x.dept} {x.received_at ? (v.current ? '✓' : x.returned_at ? '반납' : '회수 대기') : '수령 전'}</span>) : <span className="text-slate-400">없음</span>}
                  <br />🏭 외주 — {v.ext.length ? v.ext.map((x, i) => <span key={x.id} className={!v.current && !x.scrap_notified_at ? 'text-red-600 font-bold' : ''}>{i ? ' · ' : ''}{x.vendor_name} {md(x.dist_date)}{!v.current ? (x.scrap_notified_at ? ' 폐기통보' : ' 폐기통보 안 함') : ''}</span>) : <span className="text-slate-400">없음</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
