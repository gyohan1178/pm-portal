// 기간 빠른 선택 칩 (v4.192.0) — 누르면 날짜가 들어가고 바로 조회
import { PERIODS, periodOf, periodKeyOf } from '../../lib/period'
import { todayISO } from '../../lib/utils'

export default function PeriodChips({ from, to, onPick }) {
  const today = todayISO(), cur = periodKeyOf(from, to, today)
  return (
    <div className="flex items-center gap-1" data-period-chips>
      {PERIODS.map(([k, l]) => (
        <button key={k} type="button" data-period={k} onClick={() => onPick(periodOf(k, today))}
          className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border whitespace-nowrap ${cur === k ? 'bg-[#eeebfd] border-[#6c5ce7] text-[#6c5ce7]' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
      ))}
    </div>
  )
}
