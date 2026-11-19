// 📋 작업 기준 (v4.217.0 · v4.221.0 재정리) — 현장
//   현장이 지켜야 할 기준을 한곳에서 — 사내 SOP(작업표준서) · 고객사 스펙 요약 · 교육 자료.
//   · 고객사 스펙 · 교육은 품질 › 기술 문서에 올리면 자동으로 줄이 생긴다 (요약만 · 원문 · 번역 전체는 품질 권한자)
//   · SOP 는 여기서 「+ SOP 등록」 — 단계 · 사진 · ⚠ 주의 · ✔ 체크포인트 · 근거 기준. 승인(검토 완료)은 품질 · 팀장급 · 관리자
//   · 첫 화면 = 목록 (종류 · 대분류 · 적용 공정 · 찾기) → 줄을 누르면 보는 화면 (?doc= · 묶음은 ?series=)
//   · 보는 화면은 A4 로 인쇄해 현장에 게시할 수 있게 (인쇄할 때는 이 화면 내용만)
import { useState, useMemo, useDeferredValue, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import PageHead from '../components/PageHead'
import { KpiCard } from '../components/ui/Kpi'
import { SkelBar } from '../components/ux/Skeleton'
import { useConfirm } from '../components/ux/ConfirmDialog'
import TechDocReview from '../components/TechDocReview'
import { useMyProfile, canAccessSection, canEdit, isFieldOnly } from '../hooks/useProfile'
import { toastError, toastSuccess } from '../lib/toast'
import {
  fetchWorkStd, fetchDoc, fetchFigs, deleteDoc, saveSop, nextSopNo, photoToJpeg,
  TECHDOC_SQL_HINT, STATUS_TONE, KINDS, KIND_SHORT, KIND_ICON, PROCESSES, safeHtml,
  isUlDoc, UL_COPY_TITLE, UL_COPY_TEXT,
} from '../lib/techDoc'

const plain = (t) => String(t || '').replace(/<[^>]+>/g, '')
const KIND_TONE = { sop: 'bg-violet-50 text-violet-700', spec: 'bg-sky-50 text-sky-700', edu: 'bg-emerald-50 text-emerald-700', std: 'bg-emerald-50 text-emerald-700' }
const BTN = 'h-[34px] px-3 rounded-[9px] border border-slate-200 bg-white text-[12.5px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40'
const INP = 'w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-300'
const days = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 9999)
const PRINT_CSS = `@media print{
  body.printing-workstd *{visibility:hidden!important}
  body.printing-workstd [data-workstd-print],body.printing-workstd [data-workstd-print] *{visibility:visible!important}
  body.printing-workstd [data-workstd-print]{position:absolute;left:0;top:0;width:100%;padding:0 4mm}
  body.printing-workstd [data-noprint]{display:none!important}
  body.printing-workstd .ws-step{break-inside:avoid}
  @page{size:A4;margin:12mm}
}`
function printNow() {
  document.body.classList.add('printing-workstd')
  const off = () => { document.body.classList.remove('printing-workstd'); window.removeEventListener('afterprint', off) }
  window.addEventListener('afterprint', off)
  setTimeout(() => window.print(), 50)
}

export default function WorkStd() {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const canFull = !!profile && canAccessSection(profile, 'quality')
  const canSop = !!profile && canEdit(profile) && !isFieldOnly(profile)
  const me = (profile?.name || '').trim() || profile?.email || ''
  const [sp, setSp] = useSearchParams()
  const selDoc = sp.get('doc') || '', selSeries = sp.get('series') || ''
  const { data, isLoading, error } = useQuery({ queryKey: ['workStd'], queryFn: fetchWorkStd, staleTime: 60_000 })
  const rows = useMemo(() => data || [], [data])
  const go = (k, v) => { const n = new URLSearchParams(sp); n.delete('doc'); n.delete('series'); if (k) n.set(k, v); setSp(n); window.scrollTo?.({ top: 0 }) }
  const [edit, setEdit] = useState(null)        // SOP 등록 · 수정 { prev?, form, photos(새 사진), figs(있던 사진) }

  // 목록 줄 — 묶음(UL 508A 등)은 한 줄
  const items = useMemo(() => {
    const out = [], ser = new Map()
    for (const r of rows) {
      if (r.series) {
        const k = `${r.source}|${r.series}`
        if (!ser.has(k)) { const g = { key: k, series: true, kind: r.kind, source: r.source, doc_no: r.series, title_ko: '', docs: [], process: r.process, status: r.status, updated_at: r.updated_at, rev: r.tr_rev }; ser.set(k, g); out.push(g) }
        const g = ser.get(k); g.docs.push(r)
        if (!g.process && r.process) g.process = r.process
        if (r.updated_at > (g.updated_at || '')) g.updated_at = r.updated_at
      } else out.push({ key: r.doc_key, ...r })
    }
    for (const g of ser.values()) {
      const mods = g.docs.filter((d) => /^M\d/i.test(d.part_no || ''))
      const ov = g.docs.find((d) => !/^M\d/i.test(d.part_no || ''))
      g.title_ko = (ov?.title_ko || '').replace(/\s*개요$/, '').trim() || g.docs[0]?.title_ko || g.series
      g.sub = mods.length ? `${mods.map((d) => d.part_no).join(' · ')} · 모듈 ${mods.length}개` : `${g.docs.length}건`
      g.status = g.docs.every((d) => d.status === '검토 완료') ? '검토 완료' : g.docs.some((d) => d.status === '정리 중' || d.status === '번역 중') ? '정리 중' : '검토 전'
    }
    return out
  }, [rows])

  if (edit) return <SopEditor edit={edit} setEdit={setEdit} me={me} onSaved={(key) => { setEdit(null); qc.invalidateQueries({ queryKey: ['workStd'] }); qc.invalidateQueries({ queryKey: ['techDocs'] }); qc.invalidateQueries({ queryKey: ['techDoc', key] }); qc.invalidateQueries({ queryKey: ['techDocFigs', key] }); go('doc', key) }} />
  if (selDoc || selSeries) {
    const row = selDoc ? rows.find((r) => r.doc_key === selDoc) : null
    const group = selSeries ? items.find((g) => g.series && g.key === selSeries) : null
    return (
      <div className="space-y-4" data-workstd>
        <style>{PRINT_CSS}</style>
        <div className="flex flex-wrap items-center gap-2" data-noprint>
          <button type="button" onClick={() => go()} className={BTN} data-workstd-back>← 목록</button>
          <button type="button" onClick={printNow} className={BTN} data-workstd-print-btn>🖨 A4 인쇄 (현장 게시용)</button>
          {row && row.kind !== 'sop' && canFull && <Link to={`/quality/tech-docs?doc=${encodeURIComponent(row.doc_key)}`} className={`${BTN} inline-flex items-center`}>원문 · 번역 보기</Link>}
          <span className="ml-auto text-[12px] text-slate-400">참고 요약은 원문을 대신하지 않습니다 — 애매하면 품질팀에 확인</span>
        </div>
        {isLoading && <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">{[70, 90, 60].map((w, i) => <SkelBar key={i} w={w * 6} h={13} />)}</div>}
        {!isLoading && !row && !group && <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-[13px] text-slate-400">이 문서를 찾지 못했습니다 — 지워졌거나 열람 범위 밖입니다.</div>}
        {row && row.kind === 'sop' && <SopView row={row} profile={profile} canSop={canSop}
          onEdit={(prev, figs) => setEdit({ prev, figs, photos: {}, form: { doc_no: prev.doc_no, title_ko: prev.title_ko, process: prev.process || '', target: prev.body?.target || '', tools: prev.body?.tools || '', author: prev.body?.author || '', steps: (prev.body?.steps || []).map((s) => ({ ...s, photos: [...(s.photos || [])] })) } })}
          onDeleted={() => { qc.invalidateQueries({ queryKey: ['workStd'] }); go() }}
          onChanged={() => qc.invalidateQueries({ queryKey: ['workStd'] })} />}
        {row && row.kind !== 'sop' && <SummaryView rows={[row]} canFull={canFull} profile={profile} onChanged={() => qc.invalidateQueries({ queryKey: ['workStd'] })} />}
        {group && <SummaryView rows={group.docs} group={group} canFull={canFull} profile={profile} onChanged={() => qc.invalidateQueries({ queryKey: ['workStd'] })} />}
      </div>
    )
  }
  return <WorkStdList items={items} rows={rows} data={data} isLoading={isLoading} error={error} canSop={canSop} go={go}
    onNew={async () => setEdit({ prev: null, figs: {}, photos: {}, form: { doc_no: await nextSopNo().catch(() => 'JS-SOP-001'), title_ko: '', process: '', target: '', tools: '', author: me, steps: [{ title: '', text: '', warn: '', check: '', ref: '', photos: [] }] } })} />
}

// ── ① 첫 화면 — 목록 ──
function WorkStdList({ items, rows, data, isLoading, error, canSop, go, onNew }) {
  const [kind, setKind] = useState('')
  const [cat, setCat] = useState('')
  const [proc, setProc] = useState('')
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim().toLowerCase()
  const cats = [...new Set(items.map((r) => r.source || '기타'))]
  const kindOf = (r) => (r.kind === 'std' ? 'edu' : r.kind)
  const text = (r) => [r.doc_no, r.title_ko, r.title, r.sub, ...(r.series ? r.docs : [r]).flatMap((d) => [d.title_ko, d.sumTitle, ...(d.summary || []).flat().map(plain)])].join(' ').toLowerCase()
  const shown = items.filter((r) => (!kind || kindOf(r) === kind) && (!cat || (r.source || '기타') === cat)
    && (!proc || (proc === '-' ? !r.process : r.process === proc)) && (!qd || text(r).includes(qd)))
  const cnt = (k) => items.filter((r) => kindOf(r) === k).length
  const kpi = { sop: rows.filter((r) => r.kind === 'sop').length, spec: rows.filter((r) => r.kind === 'spec').length, edu: rows.filter((r) => r.kind === 'edu' || r.kind === 'std').length, recent: rows.filter((r) => days(r.updated_at) <= 30).length }
  const hasSop = kpi.sop > 0
  const first = (r) => plain((r.series ? r.docs.find((d) => d.summary?.length) : r)?.summary?.[0]?.[0] || '')
  return (
    <div className="space-y-4" data-workstd>
      <PageHead crumb="현장" title="작업 기준"
        desc="현장이 지켜야 할 작업 기준 — 사내 SOP(작업표준서) · 고객사 스펙 요약 · 교육 자료를 한곳에서 찾습니다. 줄을 누르면 단계 · 요약을 크게 보고 A4 로 인쇄할 수 있습니다.">
        {canSop && <button type="button" onClick={onNew} disabled={data === null} data-workstd-new
          className="h-[38px] px-4 rounded-[9px] bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-40">+ SOP 등록</button>}
      </PageHead>
      {data === null && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">⚠ {TECHDOC_SQL_HINT}</div>}
      {data?.noReviewCols && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">⚠ 적용 공정 · 검토 칸이 아직 없습니다 — 「기술문서_검토_작업기준_반영_261119」 SQL 을 먼저 실행하세요 (SOP 등록도 그 뒤에 됩니다).</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">불러오지 못했습니다 — {error.message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="SOP (작업표준서)" value={kpi.sop} note="사내 작성 · 공정별" loading={isLoading} onClick={() => setKind(kind === 'sop' ? '' : 'sop')} on={kind === 'sop'} />
        <KpiCard label="고객사 스펙 요약" value={kpi.spec} note="기술 문서에서 자동으로" tone="blue" loading={isLoading} onClick={() => setKind(kind === 'spec' ? '' : 'spec')} on={kind === 'spec'} />
        <KpiCard label="교육 자료" value={kpi.edu} note="UL 508A 등 · 모듈 수" tone="green" loading={isLoading} onClick={() => setKind(kind === 'edu' ? '' : 'edu')} on={kind === 'edu'} />
        <KpiCard label="최근 30일 개정" value={kpi.recent} note="바뀐 기준 — 현장 공지 필요" tone={kpi.recent ? 'amber' : ''} loading={isLoading} />
      </div>

      <div className="flex flex-wrap items-center gap-2" data-workstd-filter>
        {[['', '전체', items.length], ['sop', `${KIND_ICON.sop} SOP`, cnt('sop')], ['spec', `${KIND_ICON.spec} 고객사 스펙`, cnt('spec')], ['edu', `${KIND_ICON.edu} 교육`, cnt('edu')]].map(([k, t, n]) => (
          <button key={k || 'all'} type="button" onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-full border text-[12.5px] font-bold ${kind === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{t} <span className="opacity-60 font-mono">{n}</span></button>
        ))}
        <select value={cat} onChange={(e) => setCat(e.target.value)} data-workstd-cat className="h-10 px-3 text-[13px] font-bold border border-slate-200 rounded-[10px] bg-white text-slate-700">
          <option value="">대분류 — 전체</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={proc} onChange={(e) => setProc(e.target.value)} data-workstd-proc className="h-10 px-3 text-[13px] border border-slate-200 rounded-[10px] bg-white text-slate-600">
          <option value="">공정 — 전체</option>{PROCESSES.map((p) => <option key={p} value={p}>{p}</option>)}<option value="-">공정 미지정</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="찾기 — 라벨, 압착, 인장, AWG, 원산지 …"
          className="flex-1 min-w-[220px] h-10 px-3.5 text-[13px] border border-slate-200 rounded-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
        <span className="text-[12px] text-slate-400">{shown.length}건</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-workstd-list>
            <thead><tr className="bg-[#f7f8fb] text-slate-500 text-left border-b-2 border-slate-200">
              {['종류', '번호', '제목', '대분류', '적용 공정', 'Rev · 개정일', '상태'].map((h) => <th key={h} className="px-3 py-2.5 text-[12px] font-bold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-4"><div className="space-y-2">{[90, 70, 80].map((w, i) => <SkelBar key={i} w={w * 8} h={14} />)}</div></td></tr>}
              {!isLoading && canSop && !hasSop && (!kind || kind === 'sop') && !qd && (
                <tr className="border-t border-slate-100 text-slate-400 italic"><td className="px-3 py-2.5"><span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 not-italic">SOP</span></td>
                  <td className="px-3 py-2.5 font-mono">JS-SOP-001</td><td className="px-3 py-2.5" colSpan={5}>아직 SOP 가 없습니다 — 위 「+ SOP 등록」 으로 단계 · 사진 · 주의 · 체크포인트를 적어 첫 SOP 를 만드세요</td></tr>
              )}
              {!isLoading && !shown.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">{qd ? `「${q}」 이(가) 든 작업 기준이 없습니다` : '조건에 맞는 작업 기준이 없습니다'}</td></tr>}
              {shown.map((r) => (
                <tr key={r.key} onClick={() => (r.series ? go('series', r.key) : go('doc', r.doc_key))} className="border-t border-slate-100 hover:bg-violet-50/50 cursor-pointer h-12" data-workstd-row={r.key}>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${KIND_TONE[r.kind] || 'bg-slate-50 text-slate-500'}`}>{KIND_SHORT[r.kind] || r.kind}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono font-bold text-[#5b6ee8]">{r.doc_no}</td>
                  <td className="px-3 py-2"><div className="font-bold text-slate-800">{r.title_ko}</div><div className="text-[11.5px] text-slate-400 truncate max-w-[460px]">{r.series ? r.sub : r.kind === 'sop' ? `${(r.stepCount || []).length}단계` : first(r)}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.source || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.process ? <span className="text-[12px] text-slate-600">{r.process}</span> : <span className="text-[12px] text-slate-300">미지정</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-[12px]"><span className="font-mono">{r.series ? r.rev : (r.rev || r.tr_rev || '—')}</span> <span className="text-slate-400">{String(r.updated_at || '').slice(0, 10)}</span>{days(r.updated_at) <= 30 && <span className="ml-1 text-[10.5px] font-bold px-1.5 py-px rounded-full bg-rose-50 text-rose-600">개정</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_TONE[r.status] || 'bg-slate-50 text-slate-400 border-slate-200'}`}>{r.kind === 'sop' && r.status === '검토 완료' ? '승인' : r.status || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-slate-400">고객사 스펙 · 교육 자료는 품질 › 기술 문서에 올리면 자동으로 줄이 생깁니다 (요약만). 적용 공정은 기술 문서 상세에서 정합니다. SOP 승인 · 검토 완료는 품질 부서 · 팀장급 · 관리자.</p>
    </div>
  )
}

// ── ② 보는 화면 — 스펙 · 교육 요약 (묶음이면 모듈별) ──
function SummaryView({ rows, group, canFull, profile, onChanged }) {
  const lead = group || rows[0]
  return (
    <div className="space-y-4" data-workstd-print>
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${KIND_TONE[lead.kind] || ''}`}>{KINDS[lead.kind] || lead.kind}</span>
          <span className="font-mono font-bold text-[#5b6ee8]">{lead.doc_no}</span>
          <h1 className="text-[18px] font-extrabold text-slate-900">{lead.title_ko}</h1>
          <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_TONE[lead.status] || ''}`}>{lead.status}{lead.status !== '검토 완료' ? ' — 품질 확인 전 참고만' : ''}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-[13px]">
          <div><div className="text-[11.5px] text-slate-400">대분류</div><b>{lead.source || '—'}</b></div>
          <div><div className="text-[11.5px] text-slate-400">적용 공정</div><b>{lead.process || '미지정'}</b></div>
          <div><div className="text-[11.5px] text-slate-400">Rev</div><b className="font-mono">{lead.rev || lead.tr_rev || '—'}</b></div>
          <div><div className="text-[11.5px] text-slate-400">개정일</div><b>{String(lead.updated_at || '').slice(0, 10)}</b></div>
        </div>
      </section>
      {isUlDoc(lead) && <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800" data-workstd-copy>
        <b className="text-[13.5px]">🔒 {UL_COPY_TITLE}</b><p className="mt-0.5 text-rose-700/90">{UL_COPY_TEXT}</p></section>}
      {rows.filter((d) => d.summary?.length).map((d) => (
        <section key={d.doc_key} className="bg-white border border-slate-200 rounded-xl p-5 ws-step">
          {group && <div className="flex items-center gap-2 mb-2"><span className="font-mono font-bold text-violet-600">{d.part_no}</span><b className="text-[15px]">{d.title_ko}</b>
            <span className={`ml-auto text-[10.5px] font-bold px-1.5 py-px rounded-full border ${STATUS_TONE[d.status] || ''}`}>{d.status}</span></div>}
          {!group && d.sumTitle && <h2 className="text-[14px] font-extrabold text-amber-700 mb-2">{d.sumTitle}</h2>}
          <ol className="list-decimal pl-5 space-y-1.5 text-[14px] text-slate-700 leading-relaxed">
            {d.summary.map(([t, r], i) => <li key={i}><span dangerouslySetInnerHTML={{ __html: safeHtml(t) }} />{r && <span className="ml-1.5 font-mono text-[11px] font-bold text-amber-700">{r}</span>}</li>)}
          </ol>
          {group && canFull && <Link to={`/quality/tech-docs?doc=${encodeURIComponent(d.doc_key)}`} className="inline-block mt-2 text-[12px] font-bold text-violet-600 hover:underline" data-noprint>원문 · 번역 보기 →</Link>}
        </section>
      ))}
      {!group && rows[0] && <div data-noprint><TechDocReview doc={{ ...rows[0], body: {} }} profile={profile} editable={false} onChanged={onChanged} /></div>}
    </div>
  )
}

// ── ② 보는 화면 — SOP ──
function SopView({ row, profile, canSop, onEdit, onDeleted, onChanged }) {
  const [ask, confirmEl] = useConfirm()
  const { data: doc } = useQuery({ queryKey: ['techDoc', row.doc_key], queryFn: () => fetchDoc(row.doc_key), staleTime: 60_000 })
  const { data: figs } = useQuery({ queryKey: ['techDocFigs', row.doc_key], queryFn: () => fetchFigs(row.doc_key), staleTime: 300_000 })
  const [zoom, setZoom] = useState(null)
  const b = doc?.body || {}
  const steps = b.steps || []
  const refs = [...new Set(steps.map((s) => s.ref).filter(Boolean))]
  const goStep = (i) => document.getElementById(`ws-step-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  async function remove() {
    if (!(await ask({ title: `${row.doc_no} SOP 를 지울까요?`, desc: '단계 · 사진 · 검토 이력이 같이 지워지고 되돌릴 수 없습니다.', okText: '지우기', danger: true }))) return
    try { await deleteDoc(row.doc_key); toastSuccess('지웠습니다'); onDeleted() } catch (e) { toastError(e.message || String(e)) }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
      {confirmEl}
      <aside className="lg:sticky lg:top-[60px] space-y-3" data-noprint>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-[12px] font-bold text-slate-400 mb-1">단계</div>
          {steps.map((s, i) => <button key={i} type="button" onClick={() => goStep(i)} className="w-full text-left text-[12.5px] text-slate-600 px-1.5 py-1 rounded-md hover:bg-slate-50 truncate"><b className="text-violet-600 mr-1">{i + 1}.</b>{s.title || '(제목 없음)'}</button>)}
          {refs.length > 0 && (<><div className="text-[12px] font-bold text-slate-400 mt-3 mb-1">근거 기준</div>{refs.map((r) => <div key={r} className="text-[12px] text-slate-500 px-1.5 py-0.5 font-mono">{r}</div>)}</>)}
        </div>
        {canSop && <div className="flex gap-2"><button type="button" className={BTN} onClick={() => onEdit(doc, figs || {})} disabled={!doc} data-sop-edit>✎ 고치기</button><button type="button" onClick={remove} className="h-[34px] px-3 rounded-[9px] border border-rose-200 text-rose-600 text-[12.5px] font-bold hover:bg-rose-50">지우기</button></div>}
      </aside>
      <div className="space-y-3 min-w-0" data-workstd-print>
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">SOP</span>
            <span className="font-mono font-bold text-[#5b6ee8]">{row.doc_no}</span>
            <h1 className="text-[18px] font-extrabold text-slate-900">{row.title_ko}</h1>
            <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_TONE[row.status] || ''}`}>{row.status === '검토 완료' ? `승인 · Rev ${row.tr_rev}` : `${row.status} · Rev ${row.tr_rev}`}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-[13px]">
            <div><div className="text-[11.5px] text-slate-400">적용 공정</div><b>{row.process || '미지정'}</b></div>
            <div><div className="text-[11.5px] text-slate-400">대상</div><b>{b.target || '—'}</b></div>
            <div><div className="text-[11.5px] text-slate-400">필요 공구 · 자재</div><b>{b.tools || '—'}</b></div>
            <div><div className="text-[11.5px] text-slate-400">작성 · 승인</div><b>{b.author || row.uploaded_by || '—'}{row.reviewed_by ? ` · ${row.reviewed_by} ${String(row.reviewed_at || '').slice(0, 10)}` : ' · 승인 전'}</b></div>
          </div>
        </section>
        {!doc && <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">{[80, 60].map((w, i) => <SkelBar key={i} w={w * 6} h={13} />)}</div>}
        {steps.map((s, i) => (
          <section key={i} id={`ws-step-${i}`} className="ws-step bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-[44px_minmax(0,1fr)] md:grid-cols-[44px_220px_minmax(0,1fr)] gap-4 items-start scroll-mt-20">
            <div className="w-9 h-9 rounded-full bg-violet-600 text-white font-extrabold flex items-center justify-center text-[15px]">{i + 1}</div>
            <div className="col-start-2 md:col-start-auto space-y-2">
              {(s.photos || []).length ? s.photos.map((k) => figs?.[k]
                ? <img key={k} src={figs[k]} alt={`${i + 1}단계 사진`} className="w-full rounded-lg border border-slate-200 cursor-zoom-in" onClick={() => setZoom(figs[k])} />
                : <div key={k} className="h-28 rounded-lg border border-dashed border-slate-200 bg-slate-50" />)
                : <div className="h-24 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[12px] text-slate-300">사진 없음</div>}
            </div>
            <div className="col-start-2 md:col-start-auto min-w-0">
              <h2 className="text-[15.5px] font-extrabold text-slate-900 mb-1">{s.title || '(제목 없음)'}</h2>
              {s.text && <p className="text-[13.5px] text-slate-600 leading-relaxed whitespace-pre-line mb-2">{s.text}</p>}
              {s.warn && <div className="rounded-lg bg-rose-50 text-rose-600 font-bold px-3 py-1.5 text-[13px] mb-1.5 whitespace-pre-line">⚠ {s.warn}</div>}
              {s.check && <div className="rounded-lg bg-emerald-50 text-emerald-700 px-3 py-1.5 text-[13px] whitespace-pre-line">✔ {s.check}{s.ref && <span className="ml-1.5 font-mono text-[11px] font-bold text-amber-700">{s.ref}</span>}</div>}
              {!s.check && s.ref && <div className="font-mono text-[11px] font-bold text-amber-700">근거 {s.ref}</div>}
            </div>
          </section>
        ))}
        <div data-noprint><TechDocReview doc={row} profile={profile} editable={canSop} onChanged={onChanged} /></div>
      </div>
      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" data-noprint>
          <div className="bg-white rounded-xl p-3 max-w-[92vw] max-h-[92vh] flex flex-col gap-2">
            <div className="flex justify-end"><button type="button" className={BTN} onClick={() => setZoom(null)}>닫기</button></div>
            <img src={zoom} alt="" className="max-w-full max-h-[80vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── SOP 등록 · 고치기 ──
function SopEditor({ edit, setEdit, me, onSaved }) {
  const { prev, form, photos, figs } = edit
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setEdit((e) => ({ ...e, form: { ...e.form, [k]: v } }))
  const setStep = (i, k, v) => setEdit((e) => ({ ...e, form: { ...e.form, steps: e.form.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) } }))
  const move = (i, d) => setEdit((e) => { const st = [...e.form.steps]; const j = i + d; if (j < 0 || j >= st.length) return e; [st[i], st[j]] = [st[j], st[i]]; return { ...e, form: { ...e.form, steps: st } } })
  const addStep = () => setEdit((e) => ({ ...e, form: { ...e.form, steps: [...e.form.steps, { title: '', text: '', warn: '', check: '', ref: '', photos: [] }] } }))
  const delStep = (i) => setEdit((e) => ({ ...e, form: { ...e.form, steps: e.form.steps.filter((_, j) => j !== i) } }))
  const src = (k) => photos[k] || figs?.[k]
  useEffect(() => { window.scrollTo?.({ top: 0 }) }, [])
  async function addPhotos(i, files) {
    try {
      const add = {}
      for (const f of files) add[`sop${i}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`] = await photoToJpeg(f)
      setEdit((e) => ({ ...e, photos: { ...e.photos, ...add }, form: { ...e.form, steps: e.form.steps.map((s, j) => (j === i ? { ...s, photos: [...(s.photos || []), ...Object.keys(add)] } : s)) } }))
    } catch (err) { toastError(err.message || String(err)) }
  }
  const delPhoto = (i, k) => setStep(i, 'photos', (form.steps[i].photos || []).filter((x) => x !== k))
  async function save() {
    if (!form.doc_no.trim()) return toastError('SOP 번호를 적어 주세요')
    if (!form.title_ko.trim()) return toastError('제목을 적어 주세요')
    if (!form.steps.some((s) => s.title.trim() || s.text.trim())) return toastError('단계를 하나 이상 적어 주세요')
    setBusy(true)
    try {
      const steps = form.steps.filter((s) => s.title.trim() || s.text.trim() || (s.photos || []).length).map((s) => ({ ...s, title: s.title.trim(), text: s.text.trim(), warn: s.warn.trim(), check: s.check.trim(), ref: s.ref.trim() }))
      const key = await saveSop({ ...form, doc_no: form.doc_no.trim().toUpperCase(), title_ko: form.title_ko.trim(), steps }, photos, me, prev)
      toastSuccess(prev ? 'SOP 를 고쳤습니다 — 다시 승인 받아야 합니다' : 'SOP 를 등록했습니다 — 품질 승인 전까지 「검토 전」')
      onSaved(key)
    } catch (e) { toastError('저장 실패 — ' + (e.message || e)); setBusy(false) }
  }
  return (
    <div className="space-y-4" data-sop-editor>
      <PageHead crumb="현장 · 작업 기준" title={prev ? `SOP 고치기 — ${prev.doc_no}` : 'SOP 등록'}
        desc="단계마다 사진 · 설명 · ⚠ 주의 · ✔ 체크포인트 · 근거 기준(고객사 스펙 번호)을 적습니다. 저장하면 「검토 전」 — 품질 승인 뒤 현장 기준이 됩니다. 승인된 SOP 를 고치면 Rev 가 올라가고 다시 승인 받습니다.">
        <button type="button" className={BTN} onClick={() => setEdit(null)} disabled={busy}>취소</button>
        <button type="button" onClick={save} disabled={busy} data-sop-save className="h-[38px] px-4 rounded-[9px] bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-40">{busy ? '저장 중…' : '저장'}</button>
      </PageHead>
      <section className="bg-[#f9fafc] border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><label className="block text-[13px] font-bold mb-1">SOP 번호 <span className="text-rose-500">*</span></label><input className={`${INP} font-mono`} value={form.doc_no} onChange={(e) => set('doc_no', e.target.value)} disabled={!!prev} /><p className="text-[12px] text-slate-400 mt-1">자동으로 다음 번호 · 등록 뒤엔 못 바꿈</p></div>
        <div className="md:col-span-2"><label className="block text-[13px] font-bold mb-1">제목 <span className="text-rose-500">*</span></label><input className={INP} value={form.title_ko} onChange={(e) => set('title_ko', e.target.value)} placeholder="예: 하네스 탈피 · 압착 작업표준" data-sop-title /></div>
        <div><label className="block text-[13px] font-bold mb-1">적용 공정</label><select className={INP} value={form.process} onChange={(e) => set('process', e.target.value)}><option value="">— 고르기</option>{PROCESSES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        <div><label className="block text-[13px] font-bold mb-1">대상</label><input className={INP} value={form.target} onChange={(e) => set('target', e.target.value)} placeholder="예: AXCELIS 하네스 전체" /></div>
        <div><label className="block text-[13px] font-bold mb-1">필요 공구 · 자재</label><input className={INP} value={form.tools} onChange={(e) => set('tools', e.target.value)} placeholder="예: 스트리퍼 · 압착기(교정품)" /></div>
        <div><label className="block text-[13px] font-bold mb-1">작성</label><input className={INP} value={form.author} onChange={(e) => set('author', e.target.value)} placeholder={me} /></div>
      </section>
      {form.steps.map((s, i) => (
        <section key={i} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-sop-step={i}>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-violet-600 text-white font-extrabold flex items-center justify-center">{i + 1}</span>
            <input className={`${INP} flex-1 font-bold`} value={s.title} onChange={(e) => setStep(i, 'title', e.target.value)} placeholder="단계 제목 — 예: 탈피 · 피복만 깔끔하게" />
            <button type="button" className={BTN} onClick={() => move(i, -1)} disabled={i === 0} title="위로">↑</button>
            <button type="button" className={BTN} onClick={() => move(i, 1)} disabled={i === form.steps.length - 1} title="아래로">↓</button>
            <button type="button" className="h-[34px] px-3 rounded-[9px] border border-rose-200 text-rose-600 text-[12.5px] font-bold" onClick={() => delStep(i)} disabled={form.steps.length === 1}>단계 지우기</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-4">
            <div className="space-y-2">
              {(s.photos || []).map((k) => (
                <div key={k} className="relative">{src(k) ? <img src={src(k)} alt="" className="w-full rounded-lg border border-slate-200" /> : <div className="h-24 rounded-lg bg-slate-50" />}
                  <button type="button" onClick={() => delPhoto(i, k)} className="absolute top-1 right-1 h-7 px-2 rounded-md bg-white/90 border border-slate-200 text-[12px] font-bold text-rose-600">빼기</button></div>
              ))}
              <label className="flex items-center justify-center h-12 rounded-lg border border-dashed border-violet-300 bg-violet-50 text-[12.5px] font-bold text-violet-700 cursor-pointer">
                📷 사진 넣기<input type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) addPhotos(i, fs) }} />
              </label>
              <p className="text-[11.5px] text-slate-400">합격 · 불합격 사진을 같이 넣으면 좋습니다 (긴 쪽 1280px 로 줄여 저장)</p>
            </div>
            <div className="space-y-2">
              <textarea className={`${INP} h-24 py-2`} value={s.text} onChange={(e) => setStep(i, 'text', e.target.value)} placeholder="설명 — 무엇을 어떻게 하는지" />
              <input className={INP} value={s.warn} onChange={(e) => setStep(i, 'warn', e.target.value)} placeholder="⚠ 주의 — 예: 고전압 · 10 AWG 이상은 소선 끊어짐 0개" />
              <input className={INP} value={s.check} onChange={(e) => setStep(i, 'check', e.target.value)} placeholder="✔ 체크포인트 — 예: 끊어진 소선 허용 개수 표 확인" />
              <input className={`${INP} font-mono`} value={s.ref} onChange={(e) => setStep(i, 'ref', e.target.value)} placeholder="근거 기준 — 예: 8606757 01·01·01 표 1" />
            </div>
          </div>
        </section>
      ))}
      <button type="button" onClick={addStep} className="w-full h-11 rounded-xl border border-dashed border-slate-300 text-[13px] font-bold text-slate-500 hover:bg-white" data-sop-addstep>+ 단계 추가</button>
    </div>
  )
}
