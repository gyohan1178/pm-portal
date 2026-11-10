// 검색 결과 한 줄 아래 — 고객사 승인 제조사 (v4.172.0)
//   ✅ 대체 가능(우선 · 승인)  /  ⚠ 제조사 단종  /  ⛔ 사용 금지 를 나눠 보여 준다.
//   AXCELIS Part Report 의 상태(Approved · Preferred · Approved - OBS by Mfr · Do Not Use)를 그대로 따른다.
//   우리 대표 제조사품번이 사용 금지 · 단종이면 맨 앞에 크게 알린다.
import { splitMfrs, mfrHit, realPn } from '../lib/itemMeta'
import { isDnu, isMfrObs } from '../lib/axcelisBomReport'

const pn = (m) => realPn(m.mfr_pn) ? m.mfr_pn : '품명대로'

function Chip({ m, q, tone }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    pr: 'bg-violet-50 text-violet-700 border-violet-100',
    obs: 'bg-amber-50 text-amber-700 border-amber-100',
    dnu: 'bg-rose-50 text-rose-600 border-rose-200 line-through decoration-rose-300',
  }[tone]
  return (
    <span data-mfr-chip={tone} title={`${m.mfr} ${m.mfr_pn} — 고객사 상태: ${m.status || '-'}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls} ${mfrHit(m, q) ? 'ring-2 ring-indigo-300' : ''}`}>
      <span className="font-normal opacity-80">{m.mfr}</span><span className="font-mono">{pn(m)}</span>
    </span>
  )
}

export default function MfrAltList({ item, list, q = '', max = 4, className = '' }) {
  if (!list?.length) return null
  const { mine, alts, obs, dnu } = splitMfrs(item, list)
  const mineBad = mine && (isDnu(mine.status) ? 'dnu' : isMfrObs(mine.status) ? 'obs' : null)
  const noMine = !mine && item?.manufacturer_code && list.some(m => realPn(m.mfr_pn))
  if (!alts.length && !obs.length && !dnu.length && !mineBad && !noMine) return null
  return (
    <div data-mfr-alt className={`mt-1 flex flex-wrap items-center gap-1 whitespace-normal ${className}`}>
      {mineBad === 'dnu' && <span data-mfr-mine="dnu" className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">⛔ 지금 품번 고객사 사용 금지</span>}
      {mineBad === 'obs' && <span data-mfr-mine="obs" className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">⚠ 지금 품번 제조사 단종</span>}
      {noMine && <span data-mfr-mine="none" className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold" title="품목에 적힌 제조사품번이 고객사 승인 목록에 없습니다">⚠ 지금 품번 승인목록 밖</span>}
      {alts.length > 0 && <span className="text-[10px] font-bold text-emerald-700">✅ 대체 가능</span>}
      {alts.slice(0, max).map((m, i) => <Chip key={'a' + i} m={m} q={q} tone={/prefer/i.test(m.status || '') ? 'pr' : 'ok'} />)}
      {alts.length > max && <span className="text-[10px] text-slate-400" title={alts.slice(max).map(m => `${m.mfr} ${m.mfr_pn}`).join('\n')}>+{alts.length - max}</span>}
      {obs.length > 0 && <span className="ml-1 text-[10px] font-bold text-amber-700">⚠ 제조사 단종</span>}
      {obs.map((m, i) => <Chip key={'o' + i} m={m} q={q} tone="obs" />)}
      {dnu.length > 0 && <span className="ml-1 text-[10px] font-bold text-rose-600">⛔ 사용 금지</span>}
      {dnu.map((m, i) => <Chip key={'d' + i} m={m} q={q} tone="dnu" />)}
    </div>
  )
}
