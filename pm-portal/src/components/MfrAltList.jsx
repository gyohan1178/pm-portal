// 검색 결과 한 줄 아래 — 고객사 승인 제조사 (v4.173.0)
//   메인은 품목에 등록된 제조사 · 품번(위에 이미 보임). 여기는 보조 정보라 눈에 덜 띄게:
//     ↳ 대체 승인 · ↳ 단종 · ↳ 사용 금지 를 회색 글자 한 줄씩, 이름표만 상태 색
//   CPS 구분(Sole · Limited · Generic)은 테두리만 있는 작은 표
//   우리 메인 품번 자체가 사용 금지 · 단종 · 승인목록 밖이면 그건 메인 문제라 진하게 알린다.
import { splitMfrs, mfrHit, realPn, CPS_INFO } from '../lib/itemMeta'
import { isDnu, isMfrObs } from '../lib/axcelisBomReport'

const pn = (m) => realPn(m.mfr_pn) ? m.mfr_pn : '품명대로'

function Part({ m, q, strike }) {
  return (
    <span data-mfr-chip={strike ? 'dnu' : 'x'} title={`${m.mfr} ${m.mfr_pn} — 고객사 상태: ${m.status || '-'}`}
      className={`whitespace-nowrap ${strike ? 'line-through decoration-slate-300' : ''} ${mfrHit(m, q) ? 'bg-yellow-100 rounded px-0.5' : ''}`}>
      <span>{m.mfr}</span> <span className="font-mono">{pn(m)}</span>{/prefer/i.test(m.status || '') && <span className="ml-0.5 text-[9px] text-slate-400">(우선)</span>}
    </span>
  )
}

export default function MfrAltList({ item, list, cps, q = '', max = 4, className = '' }) {
  const kind = cps ?? item?.cps ?? null
  const L = list || []
  const { mine, alts, obs, dnu } = splitMfrs(item, L)
  const mineBad = mine && (isDnu(mine.status) ? 'dnu' : isMfrObs(mine.status) ? 'obs' : null)
  const noMine = !mine && item?.manufacturer_code && L.some(m => realPn(m.mfr_pn))
  if (!kind && !alts.length && !obs.length && !dnu.length && !mineBad && !noMine) return null
  const ci = kind && CPS_INFO[kind]
  const Row = ({ label, lc, data, children }) => (
    <div data-mfr-row={data} className="flex items-baseline gap-1.5 text-[10.5px] text-slate-400 leading-snug">
      <span className={`shrink-0 w-[52px] whitespace-nowrap ${lc}`}>↳ {label}</span>
      <span className="flex flex-wrap gap-x-2 min-w-0">{children}</span>
    </div>
  )
  return (
    <div data-mfr-alt className={`mt-0.5 flex flex-col gap-0.5 whitespace-normal ${className}`}>
      {(ci || mineBad || noMine) && (
        <div className="flex flex-wrap items-center gap-1">
          {ci && <span data-cps={kind} title={`고객사 CPS: ${kind} Manufacturer — ${ci.desc}`}
            className={`inline-block px-1.5 rounded border text-[9.5px] font-semibold leading-[16px] ${ci.cls}`}>{ci.label} · {ci.ko}</span>}
          {mineBad === 'dnu' && <span data-mfr-mine="dnu" className="inline-block px-1.5 rounded bg-rose-600 text-white text-[10px] font-bold leading-[16px]">⛔ 이 품번 고객사 사용 금지</span>}
          {mineBad === 'obs' && <span data-mfr-mine="obs" className="inline-block px-1.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold leading-[16px]">⚠ 이 품번 제조사 단종</span>}
          {noMine && <span data-mfr-mine="none" className="inline-block px-1.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold leading-[16px]" title="품목에 적힌 제조사품번이 고객사 승인 목록에 없습니다">⚠ 이 품번 승인목록 밖</span>}
        </div>
      )}
      {alts.length > 0 && <Row data="ok" label="대체 승인" lc="text-slate-500">
        {alts.slice(0, max).map((m, i) => <Part key={'a' + i} m={m} q={q} />)}
        {alts.length > max && <span title={alts.slice(max).map(m => `${m.mfr} ${m.mfr_pn}`).join('\n')}>+{alts.length - max}</span>}
      </Row>}
      {obs.length > 0 && <Row data="obs" label="단종" lc="text-amber-600">{obs.map((m, i) => <Part key={'o' + i} m={m} q={q} />)}</Row>}
      {dnu.length > 0 && <Row data="dnu" label="사용 금지" lc="text-rose-500">{dnu.map((m, i) => <Part key={'d' + i} m={m} q={q} strike />)}</Row>}
    </div>
  )
}
