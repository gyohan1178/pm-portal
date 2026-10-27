// 단계 표시 · 진행 바 — 업로드처럼 단계가 있는 작업 (v4.104.0)
export function Stepper({ steps, cur = 0 }) {
  return (
    <div className="flex items-center gap-0 select-none min-w-0" data-stepper>
      {steps.map((s, i) => {
        const done = i < cur, on = i === cur
        return (
          <div key={s} className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : ''}`}>
            <span className={`flex items-center gap-1.5 text-[12px] font-bold whitespace-nowrap ${done ? 'text-emerald-600' : on ? 'text-violet-600' : 'text-slate-400'}`} data-step={i} data-step-state={done ? 'done' : on ? 'on' : 'todo'}>
              <span className={`w-[22px] h-[22px] rounded-full border-2 inline-flex items-center justify-center text-[11px] ${done ? 'bg-emerald-500 border-emerald-500 text-white' : on ? 'border-violet-500 bg-white' : 'border-slate-300 bg-white'}`}>{done ? '✓' : i + 1}</span>
              {/* 휴대폰처럼 좁은 화면은 지금 단계 이름만 — 가로로 넘치지 않게 */}
              <span className={on ? '' : 'hidden sm:inline'}>{s}</span>
            </span>
            {i < steps.length - 1 && <span className={`flex-1 h-[2px] mx-2 min-w-[16px] ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
          </div>
        )
      })}
    </div>
  )
}
export function ProgressBar({ done, total, label = '진행 중', unit = '건' }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div data-progress>
      <div className="flex justify-between text-[11.5px] text-slate-600 mb-1"><span>{label}</span><span className="font-mono tabular-nums" data-progress-text>{done.toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}{unit}</span></div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#6c5ce7] transition-[width] duration-150" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
