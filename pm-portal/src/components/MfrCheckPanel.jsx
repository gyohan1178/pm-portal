// 승인 제조사 점검 (v4.174.0) — 기준코드 DB 「🏷 승인 점검」
//   NAS Part Report · CPS 문서를 매일 읽어 쌓은 승인 목록과 품목 DB 를 맞대어 손볼 품목을 묶어 보여 준다.
//   줄의 「수정」 → 그 품목 수정 칸이 열린다 (대표 제조사 · 품번 고치기)
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchMfrCheck, CHECK_GROUPS, CPS_INFO, realPn } from '../lib/itemMeta'
import { KpiCard, KpiRow } from './ui/Kpi'
import { EmptyState, ErrorState } from './ui/EmptyState'
import MfrAltList from './MfrAltList'
import { downloadSheet } from '../lib/exportSheet'
import { toastError } from '../lib/toast'
import { BTN } from '../lib/uiText'
import { SkeletonRows } from './ux/Skeleton'

export default function MfrCheckPanel({ onEdit, onClose }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['mfrCheck'], queryFn: fetchMfrCheck, staleTime: 5 * 60_000 })
  const [g, setG] = useState('dnu')
  const [q, setQ] = useState('')
  const G = CHECK_GROUPS.find(x => x.k === g)
  const list = (data?.[g] || []).filter(r => !q.trim() || [r.std_code, r.js_code, r.name, r.manufacturer_code, ...(r.mfrs || []).map(m => m.mfr_pn)].join(' ').toUpperCase().includes(q.trim().toUpperCase()))

  async function excel() {
    try {
      await downloadSheet({
        fileName: `승인점검_${G.label}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheetName: G.label.slice(0, 28), title: `승인 제조사 점검 — ${G.label}`,
        meta: [['기준', G.note], ['건수', list.length]],
        rows: list.map(r => g === 'missing'
          ? { 품번: r.std_code, 품명: r.name, '본 리포트': r.src || '', '마지막 확인': r.last_seen || '' }
          : {
            기준코드: r.js_code || r.std_code, 고객사코드: r.std_code, 품명: r.name, CPS: r.cps || '',
            '등록 제조사': r.manufacturer || '', '등록 제조사품번': r.manufacturer_code || '',
            '고객사 승인 목록': (r.mfrs || []).map(m => `${m.mfr} ${realPn(m.mfr_pn) ? m.mfr_pn : '(품명대로)'} [${m.status || '-'}]`).join(' / '),
          }),
      })
    } catch (e) { toastError(e.message) }
  }

  return (
    <div data-mfr-check className="rounded-xl border border-violet-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-bold text-slate-800">🏷 승인 제조사 점검</p>
        <span className="text-[11px] text-slate-400">NAS Part Report · CPS 문서(매일 아침 도면 적재 때 읽음) 기준 · 승인 목록이 있는 품목 {data?.total?.toLocaleString('ko-KR') ?? '…'}개</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => refetch()} className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{BTN.refresh}</button>
          <button onClick={excel} disabled={!list.length} className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">{BTN.excel}</button>
          <button onClick={onClose} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600">✕</button>
        </div>
      </div>
      <KpiRow cols={7} data="mfr-check" className="lg:grid-cols-7">
        {CHECK_GROUPS.map(x => (
          <KpiCard key={x.k} data={'mc-' + x.k} tone={x.tone} label={x.label} loading={isLoading}
            value={x.k === 'missing' && data && !data.missingTable ? '—' : (data?.[x.k]?.length ?? 0)} note={x.note} tip={x.note}
            on={g === x.k} onClick={() => setG(x.k)} />
        ))}
      </KpiRow>
      <div className="flex items-center gap-2">
        <p className="text-xs text-slate-500"><b className="text-slate-700">{G.label}</b> — {G.note}</p>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="코드 · 품명 · 제조사품번으로 거르기"
          className="ml-auto w-64 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300" />
      </div>
      <div className="rounded-lg border border-slate-200 overflow-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#f7f8fb] text-slate-500 border-b border-slate-200">
            {g === 'missing'
              ? <tr><th className="px-3 py-2 text-left font-bold">품번</th><th className="px-3 py-2 text-left font-bold">품명</th><th className="px-3 py-2 text-left font-bold">본 리포트</th><th className="px-3 py-2 text-left font-bold">마지막 확인</th></tr>
              : <tr><th className="px-3 py-2 text-left font-bold">기준코드</th><th className="px-3 py-2 text-left font-bold">품명</th><th className="px-3 py-2 text-left font-bold">등록 제조사 · 품번 / 고객사 승인 목록</th><th className="px-3 py-2"></th></tr>}
          </thead>
          <tbody>
            {isLoading ? <SkeletonRows cols={4} rows={6} />
              : error ? <tr><td colSpan={4}><ErrorState error={error} onRetry={refetch} /></td></tr>
              : g === 'missing' && !data.missingTable ? <tr><td colSpan={4}><EmptyState icon="🗂" title="아직 기록이 없습니다" desc="「품목미등록품번_반영」 SQL 을 실행하고 도면 적재를 한 번 돌리면 채워집니다." /></td></tr>
              : !list.length ? <tr><td colSpan={4}><EmptyState icon="✅" title="해당 품목이 없습니다" /></td></tr>
              : list.slice(0, 500).map(r => g === 'missing' ? (
                <tr key={r.id} className="border-b border-slate-100" data-mc-row>
                  <td className="px-3 py-2 font-mono text-indigo-600">{r.std_code}</td>
                  <td className="px-3 py-2 text-slate-700">{r.name || '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{r.src || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{r.last_seen || '—'}</td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-slate-100 align-top hover:bg-slate-50" data-mc-row>
                  <td className="px-3 py-2 font-mono">
                    <div className="text-indigo-600">{r.js_code || r.std_code}</div>
                    {r.js_code && <div className="text-[10.5px] text-slate-400">{r.std_code}</div>}
                    {r.cps && <span className={`mt-0.5 inline-block px-1 rounded border text-[9.5px] font-semibold font-sans ${CPS_INFO[r.cps]?.cls}`}>{r.cps}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-700 max-w-[260px]">{r.name}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-700">{r.manufacturer || <span className="text-slate-300">제조사 없음</span>} <span className="font-mono text-slate-500">{r.manufacturer_code || ''}</span></div>
                    <MfrAltList item={r} list={r.mfrs} max={6} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onEdit?.(r.id)} className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">수정</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {list.length > 500 && <p className="px-3 py-2 text-[11px] text-slate-400">앞 500건만 보입니다 — 거르기 칸을 쓰거나 {BTN.excel} 로 전부 받으세요</p>}
      </div>
    </div>
  )
}
