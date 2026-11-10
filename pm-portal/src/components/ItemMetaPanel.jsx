// 품목 하나의 고객사 승인 제조사 · REV 이력 (v4.171.0) — 기준코드 DB 「품목 수정」 아래
//   AXCELIS Part Report 를 BOM 에 올릴 때 쌓인다 (pm_item_mfr · pm_item_rev)
import { useQuery } from '@tanstack/react-query'
import { fetchItemMetaDetail, mfrTone, inApproved, realPn, CPS_INFO } from '../lib/itemMeta'

const d = (s) => s ? String(s).slice(2, 10).replace(/-/g, '/') : ''

export default function ItemMetaPanel({ item }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['itemMetaDetail', item?.id],
    queryFn: () => fetchItemMetaDetail(item.id),
    enabled: !!item?.id,
    staleTime: 30_000,
  })
  if (!item?.id) return null
  const box = 'rounded-lg border border-slate-200 bg-white p-3'
  if (isLoading) return <div className={box + ' text-xs text-slate-400'} data-item-meta>승인 제조사 · REV 불러오는 중…</div>
  if (error) return <div className={box + ' text-xs text-rose-600'} data-item-meta>승인 제조사 · REV 를 불러오지 못했습니다 ({error.message})</div>
  if (data?.missingTable) return <div className={box + ' text-xs text-slate-400'} data-item-meta>승인 제조사 · REV 표가 아직 없습니다 (SQL 반영 전)</div>

  const act = (data?.mfrs || []).filter(m => m.active)
  const off = (data?.mfrs || []).filter(m => !m.active)
  const chk = inApproved(item, act)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" data-item-meta>
      <div className={box + ' lg:col-span-2'}>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-bold text-slate-700">🏷 고객사 승인 제조사</p>
          <span className="text-[11px] text-slate-400">AXCELIS 리포트 기준 · 사용 금지 · 단종이 아니면 써도 되는 것</span>
        </div>
        {data?.cps && (
          <p className="mb-2 text-[11px] text-slate-500" data-item-cps={data.cps.kind || ''}>
            <span className="font-semibold text-slate-600">CPS 구분 — </span>
            {data.cps.kind
              ? <><span className={`inline-block px-1.5 rounded border text-[10px] font-semibold ${CPS_INFO[data.cps.kind]?.cls}`}>{data.cps.kind} · {CPS_INFO[data.cps.kind]?.ko}</span> <span className="text-slate-400">{CPS_INFO[data.cps.kind]?.desc}</span></>
              : <span className="text-slate-400">문서는 있는데 체크를 못 읽음 ({data.cps.why || '-'})</span>}
            <span className="ml-1 text-slate-400">· {data.cps.file_name}{data.cps.prev_kind ? ` · 예전 ${data.cps.prev_kind}` : ''}</span>
          </p>
        )}
        {act.length === 0
          ? <p className="text-xs text-slate-400">기록 없음 — 이 품번이 들어 있는 AXCELIS 리포트(HTM)를 BOM 에 올리면 채워집니다.</p>
          : (
            <table className="w-full text-xs">
              <thead className="text-slate-400 border-b border-slate-100">
                <tr><th className="text-left py-1 px-1 font-semibold">상태</th><th className="text-left py-1 px-1 font-semibold">제조사</th><th className="text-left py-1 px-1 font-semibold">제조사품번</th><th className="text-left py-1 px-1 font-semibold">확인한 리포트</th></tr>
              </thead>
              <tbody>
                {act.map((m, i) => {
                  const t = mfrTone(m.status)
                  const mine = item.manufacturer_code && String(item.manufacturer_code).trim().toUpperCase() === String(m.mfr_pn).trim().toUpperCase()
                  return (
                    <tr key={i} className="border-b border-slate-50" data-item-mfr={m.mfr_pn}>
                      <td className="py-1 px-1"><span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${t.cls}`} title={m.status}>{t.label}</span></td>
                      <td className="py-1 px-1 text-slate-600">{m.mfr}</td>
                      <td className="py-1 px-1 font-mono font-semibold text-slate-800">{realPn(m.mfr_pn) ? m.mfr_pn : <span className="font-sans font-normal text-slate-400">품명대로 구매 (지정 품번 없음)</span>}
                        {mine && <span className="ml-1 text-[10px] px-1 rounded bg-indigo-50 text-indigo-600 font-bold font-sans">지금 대표</span>}</td>
                      <td className="py-1 px-1 text-slate-400">{[m.src_code, m.src_ver && `품목 ${m.src_ver}`, d(m.last_seen)].filter(Boolean).join(' · ')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        {chk === 'none' && <p className="mt-2 text-[11px] font-semibold text-amber-700" data-item-mfr-warn>⚠ 품목에 적힌 제조사품번 「{item.manufacturer_code}」 이 승인 목록에 없습니다 — 고객사 승인 제조사인지 확인하세요</p>}
        {chk === 'dnu' && <p className="mt-2 text-[11px] font-semibold text-rose-600" data-item-mfr-warn>⚠ 품목에 적힌 제조사품번이 고객사 「사용 금지」 입니다</p>}
        {chk === 'obs' && <p className="mt-2 text-[11px] font-semibold text-amber-700" data-item-mfr-warn>⚠ 품목에 적힌 제조사품번은 제조사 단종입니다 — 다른 승인 제조사를 검토하세요</p>}
        {off.length > 0 && (
          <details className="mt-2 text-[11px] text-slate-500">
            <summary className="cursor-pointer">최신 리포트에서 빠진 제조사 {off.length}건</summary>
            <ul className="mt-1 space-y-0.5">{off.map((m, i) => <li key={i} className="font-mono">{m.mfr} · {m.mfr_pn} <span className="font-sans text-slate-400">({m.status || '-'} · {d(m.off_on)} 빠짐)</span></li>)}</ul>
          </details>
        )}
        {data?.same?.length > 0 && (
          <div className="mt-2 text-[11px] text-slate-500" data-item-same-mpn>
            <span className="font-semibold text-slate-600">같은 제조사품번을 승인 목록에 가진 다른 품번 — </span>
            {data.same.slice(0, 8).map((x, i) => <span key={i} className="mr-2 font-mono">{x.code}<span className="font-sans text-slate-400"> ({x.mfr_pn})</span></span>)}
          </div>
        )}
      </div>
      <div className={box}>
        <p className="text-xs font-bold text-slate-700 mb-2">📚 REV 이력</p>
        {(data?.revs || []).length === 0
          ? <p className="text-xs text-slate-400">기록 없음</p>
          : (
            <ul className="space-y-1 text-xs" data-item-revs>
              {data.revs.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={`font-mono font-bold ${i === 0 ? 'text-violet-700' : 'text-slate-500'}`}>{r.ver}</span>
                  {i === 0 && <span className="text-[10px] px-1 rounded bg-violet-50 text-violet-700 font-bold">최신</span>}
                  <span className="text-[11px] text-slate-400 truncate">{r.first_seen ? `${r.src_code || ''} · ${d(r.first_seen)}부터` : '예전에 올린 BOM 에 적힌 REV'}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}
