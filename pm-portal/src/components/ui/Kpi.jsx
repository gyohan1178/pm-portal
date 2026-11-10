// 공용 지표 카드 (v4.167.0) — 화면마다 따로 만들던 지표 칸(14곳)을 같은 모양으로
//   라벨 · 숫자(천 단위 쉼표) · 보조 설명 3줄. 숫자 색은 상태에 따라(빨강 지연 · 주황 임박 · 초록 정상 · 파랑 정보 · 보라 실행 대상)
//   onClick 을 주면 누르면 걸러지는 버튼이 되고, on 이면 테두리가 진해진다. 값이 0 이어도 숨기지 않는다.
//   노트북 화면(html[data-compact])에서는 index.css 의 .kpi-grid 규칙으로 「라벨 숫자」 한 줄 칩이 된다 — 자식 순서 유지할 것
import { SkelBar } from '../ux/Skeleton'
import InfoTip from '../ux/InfoTip'

const TONE = {
  '':    ['bg-white border-slate-200', 'text-slate-900'],
  red:   ['bg-rose-50/70 border-rose-100', 'text-rose-600'],
  amber: ['bg-amber-50/70 border-amber-100', 'text-amber-600'],
  green: ['bg-emerald-50/70 border-emerald-100', 'text-emerald-700'],
  blue:  ['bg-sky-50/70 border-sky-100', 'text-sky-700'],
  pr:    ['bg-violet-50/70 border-violet-100', 'text-violet-700'],
}

const fmt = (v) => typeof v === 'number' ? v.toLocaleString('ko-KR') : (v ?? '—')

export function KpiCard({ tone = '', label, value, note, tip, onClick, on, loading, unit, data }) {
  const [box, num] = TONE[tone] || TONE['']
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} data-kpi={data || label} data-kpi-on={on ? '1' : undefined}
      aria-pressed={onClick ? !!on : undefined}
      title={onClick ? (on ? '다시 누르면 거르기 해제' : '누르면 이 조건으로 거릅니다') : undefined}
      className={`min-w-0 text-left rounded-xl border px-4 py-3 transition ${box} ${
        onClick ? (on ? 'ring-2 ring-violet-400' : 'hover:shadow-sm hover:border-slate-300 cursor-pointer') : ''}`}>
      <div className="text-[12px] font-semibold text-slate-500 flex items-center gap-1 truncate">{label}{tip && <InfoTip text={tip} />}</div>
      {loading
        ? <div className="h-[34px] flex items-center" data-skeleton><SkelBar w={54} h={20} /></div>
        : <div className={`text-[26px] font-extrabold leading-tight tabular-nums ${num}`}>{fmt(value)}{unit && <span className="ml-0.5 text-[13px] font-bold opacity-70">{unit}</span>}</div>}
      {note && <div className="text-[11px] text-slate-400 truncate">{note}</div>}
    </Tag>
  )
}

// 지표 한 줄 — 4~6개. 그 이상이면 줄을 나눈다.
export function KpiRow({ children, cols = 4, className = '', data }) {
  const g = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-3 lg:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' }[cols] || 'sm:grid-cols-4'
  return <div data-kpi-row={data || ''} className={`kpi-grid grid grid-cols-2 ${g} gap-3 ${className}`}>{children}</div>
}
