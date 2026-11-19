// 📚 기술 문서 (v4.216.0) — 품질
//   고객사 스펙 · 규격 · 교육 자료를 원문과 한글 번역으로 나란히 보고 찾는 곳.
//   원본 파일은 NAS 에 두고 경로만 적는다. 문서는 사내 표준 번역 양식으로 정리한 「문서 꾸러미(.json)」로 올린다.
//   UL 같은 교육 자료는 모듈 하나가 문서 한 건 — 강의를 들은 모듈만 따로 올린다 (series 로 묶여 보임).
import { useState, useMemo, useEffect, useDeferredValue, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { KpiCard } from '../../components/ui/Kpi'
import { SkelBar } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { toastError, toastSuccess } from '../../lib/toast'
import {
  TECHDOC_SQL_HINT, KINDS, STATUS_TONE, ACCESS, fetchDocList, fetchDoc, fetchFigs, fetchPageList, fetchPage, searchDocs,
  readPackage, savePackage, deleteDoc, setAccess, safeHtml, sectionsHtml, TECHDOC_CSS,
} from '../../lib/techDoc'

const RULES = [
  ['번호 · 순서는 원문 그대로', '원문에 번호가 없는 항목은 번호 없이 둡니다.'],
  ['문장 단위로 원문과 번역을 짝지어', '나란히 놓습니다. 원문 한 문장을 둘로 나누거나 합치지 않습니다.'],
  ['표는 원문의 행 · 열 · 병합 칸을 그대로', '옮기고, 칸마다 한글 아래 원문을 작게 붙입니다. 삭제된 행(Removed)도 지우지 않고 흐리게 둡니다.'],
  ['그림 · 사진은 원문 위치에', '넣고, 한글 설명을 캡션에 씁니다. 그림 속 글자는 캡션에서 번역합니다.'],
  ['품번 · 라벨 번호 · 스펙 번호 · 치수 · 단위 · 코드는 번역하지 않고', '원문 그대로 씁니다.'],
  ['용어는 「용어」 표의 번역어로 통일', '하고, 새 용어가 나오면 표에 먼저 추가합니다.'],
  ['진선 적용 요약은 본문과 분리', '하고, 근거 항목 번호를 붙이며 「확인 필요」를 표시합니다.'],
  ['문서 정보에 번역 기준 Rev', '를 적고, 원본 Rev 가 바뀌면 번역을 다시 검토합니다.'],
  ['항목마다 「원문 n쪽」', '으로 원본 화면과 바로 대조할 수 있게 합니다.'],
  ['기밀 표시는 원문 그대로 유지', '하고, 열람 권한이 있는 사람만 보게 합니다.'],
  ['원문이 없는 번역은 「원문 대조 전」', '으로 표시합니다. 원문의 오류 · 모호한 곳은 고치지 않고 「확인 필요」 주석을 붙입니다.'],
]
const BTN = 'h-[34px] px-3 rounded-[9px] border border-slate-200 bg-white text-[12.5px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40'
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)

export default function TechDocs() {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = !!profile && canEdit(profile)
  const isLead = !!profile && (profile.role === 'admin' || profile.is_lead === true)
  const me = (profile?.name || '').trim() || profile?.email || ''
  const [ask, confirmEl] = useConfirm()
  const [sp, setSp] = useSearchParams()
  const sel = sp.get('doc') || ''
  const { data: list, isLoading, error } = useQuery({ queryKey: ['techDocs'], queryFn: fetchDocList, staleTime: 60_000 })
  const docs = useMemo(() => list || [], [list])
  const noTable = list === null

  // 찾기 — 왼쪽 목록은 전체 문서에서, 오른쪽 본문은 그 말이 든 덩어리만
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim()
  const { data: hitKeys } = useQuery({ queryKey: ['techDocSearch', qd], queryFn: () => searchDocs(qd), enabled: qd.length >= 2, staleTime: 60_000 })
  const [kind, setKind] = useState('')
  // 대분류 — 고객사(AXCELIS 등) · 규격 · 교육(UL 등). 주소(?cat=)에 남겨 목록으로 돌아와도 그대로
  const cat = sp.get('cat') || ''
  const [stF, setStF] = useState('')
  const cats = useMemo(() => {
    const m = new Map()
    for (const d of docs) {
      const k = d.source || '기타'
      if (!m.has(k)) m.set(k, { key: k, kind: d.kind, n: 0 })
      m.get(k).n++
    }
    return [...m.values()].sort((a, b) => (a.kind === 'spec' ? 0 : 1) - (b.kind === 'spec' ? 0 : 1) || a.key.localeCompare(b.key))
  }, [docs])
  const setCat = (v) => { const n = new URLSearchParams(sp); if (v) n.set('cat', v); else n.delete('cat'); setSp(n, { replace: true }) }
  const shownDocs = docs.filter((d) => (!kind || d.kind === kind) && (!cat || (d.source || '기타') === cat) && (!stF || d.status === stF)
    && (qd.length < 2 || !hitKeys || hitKeys.has(d.doc_key)))

  const kpi = {
    all: docs.length,
    spec: docs.filter((d) => d.kind === 'spec').length,
    edu: docs.filter((d) => d.kind === 'edu').length,
    wait: docs.filter((d) => ['검토 전', '번역 중', '원문 없음', '정리 중'].includes(d.status)).length,
  }

  // 고른 문서 — 없으면 목록 화면
  const cur = sel
  const { data: doc, isLoading: docLoading } = useQuery({ queryKey: ['techDoc', cur], queryFn: () => fetchDoc(cur), enabled: !!cur && !noTable, staleTime: 300_000 })
  const { data: figs } = useQuery({ queryKey: ['techDocFigs', cur], queryFn: () => fetchFigs(cur), enabled: !!cur && !noTable, staleTime: 300_000 })
  const { data: pages } = useQuery({ queryKey: ['techDocPages', cur], queryFn: () => fetchPageList(cur), enabled: !!cur && !noTable, staleTime: 300_000 })
  const body = doc?.body || {}
  const edu = doc?.kind === 'edu'
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('techDocMode') || 'both' } catch { return 'both' } })
  const viewMode = body.noOriginal || edu ? 'ko' : mode
  const pick = (k) => { const n = new URLSearchParams(sp); n.set('doc', k); setSp(n); window.scrollTo?.({ top: 0 }) }
  const back = () => { const n = new URLSearchParams(sp); n.delete('doc'); setSp(n); window.scrollTo?.({ top: 0 }) }
  const { html: secHtml, shown } = useMemo(() => sectionsHtml(body.sections, qd, figs, pages), [body.sections, qd, figs, pages])

  // 원문 쪽 · 그림 크게 보기 (닫기 버튼으로만 닫힘)
  const [view, setView] = useState(null)       // { kind: 'page', n, src } | { kind: 'fig', src }
  async function openPage(n) {
    setView({ kind: 'page', n, src: null })
    try { const src = await fetchPage(cur, n); setView({ kind: 'page', n, src }) } catch (e) { toastError(e.message || String(e)); setView(null) }
  }
  const stepPage = (d) => { const i = (pages || []).indexOf(view?.n); const n = pages?.[i + d]; if (n) openPage(n) }
  function onBodyClick(e) {
    const p = e.target.closest('[data-page]'); if (p) return openPage(Number(p.dataset.page))
    const z = e.target.closest('[data-zoom]'); if (z && figs?.[z.dataset.zoom]) setView({ kind: 'fig', src: figs[z.dataset.zoom] })
  }
  const goSec = (id) => document.getElementById(`td-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  async function copyPath() {
    try { await navigator.clipboard.writeText(body.file || ''); toastSuccess('원본 경로를 복사했습니다') } catch { toastError('복사하지 못했습니다 — 경로를 직접 선택해 복사하세요') }
  }
  async function changeAccess(v) {
    try { await setAccess(cur, v); toastSuccess(`열람 범위 — ${ACCESS[v]}`); qc.invalidateQueries({ queryKey: ['techDocs'] }); qc.invalidateQueries({ queryKey: ['techDoc', cur] }) }
    catch (e) { toastError(e.message || String(e)) }
  }
  async function remove() {
    const ok = await ask({ title: `${doc.doc_no || doc.doc_key} ${doc.part_no || ''} 를 지울까요?`, desc: '번역 · 그림 · 원문 쪽 이미지가 같이 지워집니다. 문서 꾸러미(.json)가 있으면 다시 올릴 수 있습니다. NAS 원본은 그대로입니다.', okText: '지우기', danger: true })
    if (!ok) return
    try {
      await deleteDoc(cur); toastSuccess('지웠습니다')
      const n = new URLSearchParams(sp); n.delete('doc'); setSp(n, { replace: true })
      qc.invalidateQueries({ queryKey: ['techDocs'] })
    } catch (e) { toastError(e.message || String(e)) }
  }

  // ── 문서 올리기 ──
  const [up, setUp] = useState(null)           // { items: [{ pkg, err, exists }] }
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  async function onFiles(files) {
    const items = []
    for (const f of files) {
      try {
        const pkg = readPackage(await f.text(), f.name)
        items.push({ pkg, exists: docs.find((d) => d.doc_key === pkg.key) || null })
      } catch (e) { items.push({ err: e.message || String(e), fileName: f.name }) }
    }
    setUp({ items })
  }
  async function doUpload() {
    const ok = up.items.filter((x) => x.pkg)
    setBusy(true)
    let n = 0
    try {
      for (const x of ok) { await savePackage(x.pkg, me); n++ }
      toastSuccess(`문서 ${n}건 올림`)
      setUp(null)
      qc.invalidateQueries({ queryKey: ['techDocs'] })
      for (const x of ok) { qc.invalidateQueries({ queryKey: ['techDoc', x.pkg.key] }); qc.invalidateQueries({ queryKey: ['techDocFigs', x.pkg.key] }); qc.invalidateQueries({ queryKey: ['techDocPages', x.pkg.key] }) }
    } catch (e) { toastError(`${n}건 올리고 멈춤 — ${e.message || e}`); qc.invalidateQueries({ queryKey: ['techDocs'] }) } finally { setBusy(false) }
  }

  // 같은 묶음(UL 508A 등)의 다른 모듈
  const sibs = doc?.series ? docs.filter((d) => d.series === doc.series && d.source === doc.source) : []
  return (
    <div className="space-y-4" data-techdocs>
      <style>{TECHDOC_CSS}</style>
      {confirmEl}
      <PageHead crumb="품질" title="기술 문서"
        desc="고객사 스펙 · 규격 · 교육 자료를 원문과 한글 번역으로 나란히 보고 찾습니다. 원본 파일은 NAS 에 있고, 여기서는 번역 · 검색 · 원문 대조만 합니다.">
        {editable && <button type="button" onClick={() => fileRef.current?.click()} disabled={noTable} data-techdoc-upload
          className="h-[38px] px-4 rounded-[9px] bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-40">📤 문서 올리기</button>}
        <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden
          onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) onFiles(fs) }} />
      </PageHead>

      {noTable && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800" data-techdoc-nosql>⚠ {TECHDOC_SQL_HINT}</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">불러오지 못했습니다 — {error.message}</div>}

      {!cur && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="등록 문서" value={kpi.all} note="교육 자료는 모듈 하나가 한 건 · 누르면 전체" loading={isLoading} onClick={() => { setKind(''); setStF('') }} on={!kind && !stF} />
          <KpiCard label="고객사 스펙" value={kpi.spec} note="원문 · 번역 대조" tone="blue" loading={isLoading} onClick={() => setKind(kind === 'spec' ? '' : 'spec')} on={kind === 'spec'} />
          <KpiCard label="규격 · 교육 자료" value={kpi.edu} note="UL 등 · 한글 정리본" tone="green" loading={isLoading} onClick={() => setKind(kind === 'edu' ? '' : 'edu')} on={kind === 'edu'} />
          <KpiCard label="검토 기다림" value={kpi.wait} note="번역 중 · 검토 전 · 원문 없음" tone={kpi.wait ? 'amber' : 'green'} loading={isLoading} />
        </div>

        <div className="flex flex-wrap items-center gap-2" data-techdoc-filter>
          <select value={cat} onChange={(e) => setCat(e.target.value)} data-techdoc-cat
            className="h-10 px-3 text-[13px] font-bold border border-slate-200 rounded-[10px] bg-white text-slate-700">
            <option value="">대분류 — 전체</option>
            {cats.map((c) => <option key={c.key} value={c.key}>{c.key} ({c.kind === 'spec' ? '고객사' : '규격 · 교육'}) · {c.n}건</option>)}
          </select>
          <select value={stF} onChange={(e) => setStF(e.target.value)} data-techdoc-status
            className="h-10 px-3 text-[13px] border border-slate-200 rounded-[10px] bg-white text-slate-600">
            <option value="">상태 — 전체</option>
            {[...new Set(docs.map((d) => d.status).filter(Boolean))].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" data-techdoc-q
            placeholder="문서 내용까지 찾기 — 한글 · 영문 · 번호 (예: 원산지, AWG, 1918540, SCCR)"
            className="flex-1 min-w-[240px] h-10 px-3.5 text-[13px] border border-slate-200 rounded-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
          <span className="text-[12px] text-slate-400">{shownDocs.length}건{qd.length >= 2 ? ` · 「${qd}」 든 문서` : ''}</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-techdoc-list>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-[#f7f8fb] text-slate-500 text-left border-b-2 border-slate-200">
                {['대분류', '문서 번호', '제목', '구분', '원문 Rev', '번역 Rev', '상태', '열람', '갱신'].map((h) => <th key={h} className="px-3 py-2.5 text-[12px] font-bold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {isLoading && <tr><td colSpan={9} className="p-4"><div className="space-y-2">{[90, 70, 80].map((w, i) => <SkelBar key={i} w={w * 8} h={14} />)}</div></td></tr>}
                {!isLoading && !shownDocs.length && <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">{qd.length >= 2 ? `「${qd}」 이(가) 든 문서가 없습니다` : docs.length ? '조건에 맞는 문서가 없습니다' : '올린 문서가 없습니다'}</td></tr>}
                {shownDocs.map((d) => (
                  <tr key={d.doc_key} onClick={() => pick(d.doc_key)} className="border-t border-slate-100 hover:bg-violet-50/50 cursor-pointer h-12" data-techdoc-row={d.doc_key}>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${d.kind === 'spec' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>{d.source || '기타'}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono font-bold text-[#5b6ee8]">{d.series ? `${d.series} · ${d.part_no}` : d.doc_no}</td>
                    <td className="px-3 py-2"><div className="font-bold text-slate-800">{d.title_ko}</div><div className="text-[11.5px] text-slate-400 truncate max-w-[420px]">{d.title}</div></td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{KINDS[d.kind] || d.kind}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{d.rev || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{d.tr_rev || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_TONE[d.status] || 'bg-slate-50 text-slate-400 border-slate-200'}`}>{d.status || '—'}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px] text-slate-500">{d.access === 'lead' ? '🔒 팀장급' : '전체'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px] text-slate-400">{String(d.updated_at || '').slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {cur && (<>
      <div className="sticky top-0 z-10 bg-[#f7f8fb] py-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={back} className={BTN} data-techdoc-back>← 목록</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" data-techdoc-q
          placeholder={`이 문서에서 찾기 — 한글 · 영문 · 번호 (${body.ph || '예: 원산지, label'})`}
          className="flex-1 min-w-[220px] h-10 px-3.5 text-[13px] border border-slate-200 rounded-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
        {!(body.noOriginal || edu) && (
          <div className="flex bg-white border border-slate-200 rounded-[10px] p-[3px] gap-0.5" data-techdoc-mode>
            {[['both', '나란히'], ['ko', '한글만'], ['en', '원문만']].map(([k, t]) => (
              <button key={k} type="button" onClick={() => { setMode(k); try { localStorage.setItem('techDocMode', k) } catch { /* 저장 못 해도 화면은 바뀜 */ } }}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] font-bold ${mode === k ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>{t}</button>
            ))}
          </div>
        )}
        <span className="text-[12px] text-slate-400">{qd ? `${shown}개 항목` : doc ? `본문 ${body.sections?.length || 0}개 항목 · 표 ${body.tables ?? '—'}개` : ''}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
        <aside className="lg:sticky lg:top-[60px] space-y-3">
          {sibs.length > 1 && (
            <div className="bg-white border border-slate-200 rounded-xl p-3" data-techdoc-sibs>
              <div className="text-[12px] font-bold text-slate-400 mb-1">{doc?.series} 모듈</div>
              {sibs.map((d) => (
                <button key={d.doc_key} type="button" onClick={() => pick(d.doc_key)}
                  className={`w-full flex gap-2 text-left text-[12.5px] px-1.5 py-1 rounded-md ${d.doc_key === cur ? 'bg-violet-50 text-violet-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span className="font-mono min-w-[30px] flex-none">{d.part_no}</span><span className="truncate">{d.title_ko}</span>
                </button>
              ))}
            </div>
          )}
          {doc && body.sections?.length > 1 && (
            <nav className="bg-white border border-slate-200 rounded-xl p-3 hidden lg:block" data-techdoc-toc>
              <div className="text-[12px] font-bold text-slate-400 mb-1">목차</div>
              <div className="max-h-[60vh] overflow-y-auto space-y-0.5">
                {body.sections.map((s) => (
                  <button key={s.id} type="button" onClick={() => goSec(s.id)} className="w-full flex gap-2 text-left text-[12.5px] text-slate-600 px-1.5 py-1 rounded-md hover:bg-slate-50">
                    <span className="font-mono text-violet-600 text-[11.5px] min-w-[30px] flex-none">{s.no || '—'}</span><span className="truncate">{s.ko}</span>
                  </button>
                ))}
              </div>
            </nav>
          )}
        </aside>

        {/* 문서 */}
        <main className={`min-w-0 space-y-4 ${viewMode !== 'both' ? `mode-${viewMode}` : ''}`} data-techdoc data-techdoc-doc onClick={onBodyClick}>
          {docLoading && <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">{[95, 80, 88, 70, 92, 60].map((w, i) => <SkelBar key={i} w={w * 6} h={13} />)}</div>}
          {!docLoading && !doc && !isLoading && !noTable && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-[13px] text-slate-400">
              이 문서를 찾지 못했습니다 — 지워졌거나 열람 범위 밖입니다. 「← 목록」으로 돌아가세요.
            </div>
          )}
          {doc && (<>
            {body.notice && <section className={`rich rounded-xl border px-4 py-3 flex gap-3 text-[13px] text-slate-600 ${edu ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'}`} dangerouslySetInnerHTML={{ __html: safeHtml(body.notice) }} data-techdoc-notice />}

            <section className="bg-white border border-slate-200 rounded-xl p-5" data-techdoc-info>
              <div className="flex flex-wrap items-baseline gap-2 mb-3">
                <h2 className="text-[17px] font-extrabold text-slate-900">{doc.series ? `${doc.series} · ${doc.part_no}` : doc.doc_no} {doc.title_ko}</h2>
                <span className={`text-[11px] font-bold px-2 py-px rounded-full border ${STATUS_TONE[doc.status] || ''}`}>{doc.status}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3">
                {(body.meta || [
                  ['고객사 · 출처', doc.source], ['문서 번호', doc.doc_no], ['제목', `${doc.title}`], ['분류', body.cls],
                  ['현재 Rev', doc.rev], ['쪽수', body.pagesN ? `${body.pagesN}쪽` : '—'], ['번역 기준 Rev', doc.tr_rev], ['번역 · 검토', body.review],
                ]).map(([l, v]) => (
                  <div key={l} className="min-w-0"><div className="text-[11.5px] text-slate-400">{l}</div><div className="text-[13.5px] font-bold text-slate-800 break-words">{v || '—'}</div></div>
                ))}
              </div>
              {body.revs?.length > 0 && (<>
                <div className="text-[12px] font-bold text-slate-400 mt-5 mb-1.5">개정 이력</div>
                <div className="tbl-wrap"><table><thead><tr>{body.revHead.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{body.revs.map((r, i) => <tr key={i} className={i === body.revs.length - 1 ? 'hl' : ''}>{r.map((v, j) => <td key={j} className={[0, 1, 4].includes(j) ? 'mono' : ''}>{v}</td>)}</tr>)}</tbody></table></div>
              </>)}
              {body.approvals?.length > 0 && (<>
                <div className="text-[12px] font-bold text-slate-400 mt-5 mb-1.5">승인</div>
                <div className="tbl-wrap"><table><tbody>{body.approvals.map((a, i) => <tr key={i}><td>{a[0]} <span className="mono text-[11.5px] text-slate-400">{a[1]}</span></td><td>{a[2]}</td></tr>)}</tbody></table></div>
              </>)}
              {body.warn && <div className="rich mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-slate-600" dangerouslySetInnerHTML={{ __html: safeHtml(body.warn) }} />}
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-3.5 border-t border-slate-100">
                {body.file && <><code className="mono text-[12px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 break-all">{body.file}</code>
                  <button type="button" className={BTN} onClick={copyPath}>원본 경로 복사</button></>}
                {pages?.length > 0 && <button type="button" className={BTN} onClick={() => openPage(pages[0])}>원문 {pages[0]}쪽 보기</button>}
                <span className="ml-auto flex items-center gap-2 text-[12px] text-slate-400">
                  열람
                  {isLead ? (
                    <select value={doc.access || 'all'} onChange={(e) => changeAccess(e.target.value)} data-techdoc-access
                      className="h-[30px] px-2 text-[12.5px] border border-slate-200 rounded-lg bg-white text-slate-600">
                      {Object.entries(ACCESS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  ) : <b className="text-slate-600">{ACCESS[doc.access || 'all']}</b>}
                  {editable && <button type="button" onClick={remove} className="h-[30px] px-2.5 rounded-lg border border-rose-200 text-rose-600 text-[12px] font-bold hover:bg-rose-50">지우기</button>}
                </span>
              </div>
              <div className="text-[11.5px] text-slate-400 mt-2">올린 사람 {doc.uploaded_by || '—'} · {String(doc.updated_at || '').slice(0, 10)}</div>
            </section>

            {body.summary?.length > 0 && (
              <section className="sum rounded-xl border border-amber-200 bg-amber-50 p-5" data-techdoc-summary>
                <h3 className="text-[14px] font-extrabold text-amber-700 mb-1">{body.sumTitle || '진선 적용 요약'}</h3>
                <p className="text-[12px] text-slate-400 mb-2.5">{edu ? '실제 판정은 표준 원문과 당사 UL 파일을 따릅니다.' : '번역을 바탕으로 정리한 참고 요약입니다. 원문을 대신하지 않으며, 적용 전 품질팀 확인이 필요합니다.'}</p>
                <ul className="text-[13px] text-slate-600">{body.summary.map(([t, r], i) => <li key={i}><span dangerouslySetInnerHTML={{ __html: safeHtml(t) }} /> <span className="ref">{r}</span></li>)}</ul>
              </section>
            )}

            {secHtml ? <div className="space-y-4" dangerouslySetInnerHTML={{ __html: secHtml }} data-techdoc-body />
              : <div className="bg-white border border-slate-200 rounded-xl p-7 text-center text-[13px] text-slate-400">「{qd}」 이(가) 든 항목이 이 문서에 없습니다. 왼쪽 목록에서 그 말이 든 다른 문서를 보세요.</div>}

            {body.glossary?.length > 0 && (
              <section className="bg-white border border-slate-200 rounded-xl p-5" data-techdoc-gloss>
                <h3 className="text-[14px] font-extrabold mb-2.5">용어 (이 문서 기준 번역어)</h3>
                <div className="tbl-wrap"><table><thead><tr><th>원문</th><th>번역어</th><th>설명</th></tr></thead>
                  <tbody>{body.glossary.map((g, i) => <tr key={i}><td className="mono whitespace-nowrap">{g[0]}</td><td><b>{g[1]}</b></td><td>{g[2]}</td></tr>)}</tbody></table></div>
              </section>
            )}
            {!edu && (
              <section className="bg-white border border-slate-200 rounded-xl p-5" data-techdoc-rules>
                <h3 className="text-[14px] font-extrabold mb-2.5">이 양식의 작성 규칙 (사내 표준)</h3>
                <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-slate-600">{RULES.map(([b, t]) => <li key={b}><b className="text-slate-800">{b}</b> {t}</li>)}</ol>
              </section>
            )}
          </>)}
        </main>
      </div>
      </>)}

      {/* 원문 쪽 · 그림 크게 보기 */}
      {view && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" data-techdoc-viewer>
          <div className="w-full max-w-[760px] h-full bg-white flex flex-col" role="dialog" aria-modal="true">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
              <b className="flex-1 text-[14px]">{view.kind === 'page' ? `원문 ${view.n}쪽 / ${body.pagesN || pages?.length}쪽` : '그림 크게 보기'}</b>
              {view.kind === 'page' && <>
                <button type="button" className={BTN} onClick={() => stepPage(-1)} disabled={pages?.[0] === view.n}>이전 쪽</button>
                <button type="button" className={BTN} onClick={() => stepPage(1)} disabled={pages?.[pages.length - 1] === view.n}>다음 쪽</button>
              </>}
              <button type="button" className={BTN} onClick={() => setView(null)} data-techdoc-viewer-close>닫기</button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              {view.src ? <img src={view.src} alt="" className="block w-full h-auto border border-slate-200 bg-white" /> : <div className="text-center text-[13px] text-slate-400 py-20">불러오는 중…</div>}
            </div>
          </div>
        </div>
      )}

      {/* 문서 올리기 확인 */}
      {up && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-techdoc-upmodal>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-5 space-y-3" role="dialog" aria-modal="true">
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-extrabold flex-1">문서 올리기 — {up.items.filter((x) => x.pkg).length}건</h3>
              <button type="button" className={BTN} onClick={() => setUp(null)} disabled={busy}>닫기</button>
            </div>
            <p className="text-[12.5px] text-slate-400">같은 문서(번호 · 모듈)가 이미 있으면 새 것으로 바꿉니다 — 번역 · 그림 · 원문 쪽 이미지를 통째로 바꾸고, 열람 범위는 꾸러미에 적힌 대로 들어갑니다.</p>
            <div className="max-h-[50vh] overflow-auto border border-slate-200 rounded-xl">
              <table className="w-full text-[12.5px]">
                <thead><tr className="bg-slate-50 text-slate-500 text-left">{['문서', '구분', '번역 Rev', '상태', '그림 · 쪽', '크기', '처리'].map((h) => <th key={h} className="px-2.5 py-2 font-bold">{h}</th>)}</tr></thead>
                <tbody>{up.items.map((x, i) => x.err ? (
                  <tr key={i} className="border-t border-slate-100"><td colSpan={7} className="px-2.5 py-2 text-rose-600">⚠ {x.err}</td></tr>
                ) : (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2.5 py-2"><b className="font-mono">{x.pkg.row.series ? `${x.pkg.row.series} · ${x.pkg.row.part_no}` : x.pkg.row.doc_no}</b><div className="text-slate-400">{x.pkg.row.title_ko}</div></td>
                    <td className="px-2.5 py-2">{x.pkg.row.source} · {KINDS[x.pkg.row.kind] || x.pkg.row.kind}</td>
                    <td className="px-2.5 py-2 font-mono">{x.pkg.row.tr_rev || '—'}</td>
                    <td className="px-2.5 py-2">{x.pkg.row.status}</td>
                    <td className="px-2.5 py-2">{x.pkg.images.filter(([k]) => k.startsWith('fig:')).length} · {x.pkg.images.filter(([k]) => k.startsWith('page:')).length}쪽</td>
                    <td className="px-2.5 py-2">{kb(x.pkg.bytes)}</td>
                    <td className="px-2.5 py-2">{x.exists ? <span className="text-amber-700 font-bold">바꿈 (Rev {x.exists.tr_rev || '—'} → {x.pkg.row.tr_rev || '—'})</span> : <span className="text-emerald-700 font-bold">새로</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN} onClick={() => setUp(null)} disabled={busy}>취소</button>
              <button type="button" onClick={doUpload} disabled={busy || !up.items.some((x) => x.pkg)} data-techdoc-upok
                className="h-[38px] px-4 rounded-[9px] bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-40">{busy ? '올리는 중…' : `${up.items.filter((x) => x.pkg).length}건 올리기`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

