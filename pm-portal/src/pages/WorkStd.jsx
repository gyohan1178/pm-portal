// 📋 작업 기준 (v4.217.0) — 현장
//   품질 › 기술 문서에 올린 고객사 스펙 · 규격 · 교육 자료의 「적용 요약」만 모아 현장에서 본다.
//   원문 · 번역 전체는 품질 › 기술 문서 (품질 메뉴 권한자) — 여기서는 요약과 근거 항목 번호만.
import { useState, useMemo, useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import PageHead from '../components/PageHead'
import { SkelBar } from '../components/ux/Skeleton'
import { useMyProfile, canAccessSection } from '../hooks/useProfile'
import { fetchWorkStd, TECHDOC_SQL_HINT, STATUS_TONE, KINDS, safeHtml } from '../lib/techDoc'

const plain = (t) => String(t || '').replace(/<[^>]+>/g, '')

export default function WorkStd() {
  const { data: profile } = useMyProfile()
  const canFull = !!profile && canAccessSection(profile, 'quality')
  const { data, isLoading, error } = useQuery({ queryKey: ['workStd'], queryFn: fetchWorkStd, staleTime: 120_000 })
  const rows = useMemo(() => data || [], [data])
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim().toLowerCase()

  // 카드 — 스펙은 문서 하나가 한 장, 교육 자료(UL 508A 등)는 묶음 하나가 한 장 (모듈별로 나눠 보임)
  const cards = useMemo(() => {
    const out = [], bySeries = new Map()
    for (const r of rows) {
      if (!r.summary?.length) continue
      if (r.series) {
        const k = `${r.source}|${r.series}`
        if (!bySeries.has(k)) { const c = { key: k, source: r.source, kind: r.kind, title: r.series, docs: [] }; bySeries.set(k, c); out.push(c) }
        bySeries.get(k).docs.push(r)
      } else out.push({ key: r.doc_key, source: r.source, kind: r.kind, title: r.doc_no, docs: [r] })
    }
    return out
  }, [rows])
  const cats = [...new Set(rows.map((r) => r.source || '기타'))]
  const hit = (r) => !qd || [r.doc_no, r.title_ko, r.series, r.part_no, r.sumTitle, ...(r.summary || []).flat().map(plain)].join(' ').toLowerCase().includes(qd)
  const shown = cards.filter((c) => !cat || (c.source || '기타') === cat)
    .map((c) => ({ ...c, docs: c.docs.filter(hit) })).filter((c) => c.docs.length)

  return (
    <div className="space-y-4" data-workstd>
      <PageHead crumb="현장" title="작업 기준"
        desc="고객사 스펙 · 규격 · 교육 자료에서 현장이 지켜야 할 것만 요약해 모았습니다. 오른쪽 작은 번호는 원문 근거 항목입니다." />

      {data === null && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">⚠ {TECHDOC_SQL_HINT}</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">불러오지 못했습니다 — {error.message}</div>}

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-slate-600">
        <b className="text-amber-700">참고 요약</b> — 원문을 대신하지 않습니다. 애매하면 품질팀에 확인하세요.{canFull ? ' 카드의 「원문 · 번역 보기」로 전체 문서를 볼 수 있습니다.' : ' 원문 · 번역 전체는 품질팀이 봅니다.'}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={cat} onChange={(e) => setCat(e.target.value)} data-workstd-cat
          className="h-10 px-3 text-[13px] font-bold border border-slate-200 rounded-[10px] bg-white text-slate-700">
          <option value="">대분류 — 전체</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="찾기 — 예: 라벨, 원산지, 인장, 14 AWG"
          className="flex-1 min-w-[220px] h-10 px-3.5 text-[13px] border border-slate-200 rounded-[10px] bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </div>

      {isLoading && <div className="grid md:grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">{[60, 90, 80].map((w, j) => <SkelBar key={j} w={w * 4} h={13} />)}</div>)}</div>}
      {!isLoading && !shown.length && data !== null && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-[13px] text-slate-400">{qd ? `「${q}」 이(가) 든 작업 기준이 없습니다` : '아직 올린 작업 기준이 없습니다 — 품질 › 기술 문서에 문서가 올라오면 여기에 요약이 보입니다'}</div>
      )}

      <div className="grid md:grid-cols-2 gap-3 items-start">
        {shown.map((c) => (
          <section key={c.key} className="bg-white border border-slate-200 rounded-xl p-4" data-workstd-card={c.key}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.kind === 'spec' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>{c.source} · {KINDS[c.kind] || c.kind}</span>
              {c.docs.length === 1 && !c.docs[0].series && <span className={`ml-auto text-[10.5px] font-bold px-1.5 py-px rounded-full border ${STATUS_TONE[c.docs[0].status] || ''}`}>{c.docs[0].status}</span>}
            </div>
            <h2 className="text-[15px] font-extrabold text-slate-900"><span className="font-mono text-[#5b6ee8]">{c.title}</span> {c.docs.length === 1 && !c.docs[0].series ? c.docs[0].title_ko : ''}</h2>
            {c.docs.map((d) => (
              <div key={d.doc_key} className="mt-2.5">
                {d.series && <div className="text-[12.5px] font-bold text-slate-700 mb-1"><span className="font-mono text-violet-600">{d.part_no}</span> {d.title_ko}</div>}
                <ul className="list-disc pl-5 space-y-1 text-[13px] text-slate-600 leading-relaxed">
                  {d.summary.map(([t, r], i) => (
                    <li key={i}><span dangerouslySetInnerHTML={{ __html: safeHtml(t) }} />{r && <span className="ml-1 font-mono text-[11px] font-bold text-amber-700">{r}</span>}</li>
                  ))}
                </ul>
                {canFull && <Link to={`/quality/tech-docs?doc=${encodeURIComponent(d.doc_key)}`} className="inline-block mt-1.5 text-[12px] font-bold text-violet-600 hover:underline">원문 · 번역 보기 →</Link>}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
