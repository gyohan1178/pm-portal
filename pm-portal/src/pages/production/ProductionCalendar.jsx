import { useState, useMemo } from 'react'

const STATUS_COLOR = {
  '완료': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '납품대기': 'bg-blue-100 text-blue-700 border-blue-200',
  '품질검수': 'bg-violet-100 text-violet-700 border-violet-200',
  '제작중': 'bg-amber-100 text-amber-700 border-amber-200',
  'PO접수': 'bg-slate-100 text-slate-600 border-slate-200',
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ProductionCalendar({ rows }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [picked, setPicked] = useState(null)   // 클릭한 날짜

  // req_date별로 호기 묶기
  const byDate = useMemo(() => {
    const m = {}
    rows.forEach(r => {
      const dt = (r.req_date || '').slice(0, 10)
      if (!dt) return
      if (!m[dt]) m[dt] = []
      m[dt].push(r)
    })
    return m
  }, [rows])

  // 달력 격자 (월요일 시작)
  const cells = useMemo(() => {
    const y = cursor.getFullYear(), mo = cursor.getMonth()
    const first = new Date(y, mo, 1)
    const start = new Date(first)
    const dow = (first.getDay() + 6) % 7   // 월=0
    start.setDate(first.getDate() - dow)
    const arr = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i)
      arr.push(d)
    }
    return arr
  }, [cursor])

  const todayStr = ymd(new Date())
  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`
  const pickedRows = picked ? (byDate[picked] || []) : []

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">‹</button>
          <span className="text-sm font-bold text-slate-800 w-28 text-center">{monthLabel}</span>
          <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">›</button>
          <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)) }}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">오늘</button>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 flex-wrap">
          {Object.entries(STATUS_COLOR).map(([k, c]) => (
            <span key={k} className={`px-1.5 py-0.5 rounded border whitespace-nowrap ${c}`}>{k}</span>
          ))}
        </div>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-px">
        {['월', '화', '수', '목', '금', '토', '일'].map((d, i) => (
          <div key={d} className={`text-center text-xs font-bold py-1 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-rose-500' : 'text-slate-400'}`}>{d}</div>
        ))}
      </div>

      {/* 날짜 격자 */}
      <div className="grid grid-cols-7 gap-px bg-slate-100 rounded-xl overflow-hidden border border-slate-100">
        {cells.map((d, i) => {
          const ds = ymd(d)
          const inMonth = d.getMonth() === cursor.getMonth()
          const list = byDate[ds] || []
          const isToday = ds === todayStr
          const dow = i % 7
          return (
            <div key={i} onClick={() => list.length && setPicked(ds)}
              className={`min-h-[88px] bg-white p-1.5 ${!inMonth ? 'opacity-40' : ''} ${list.length ? 'cursor-pointer hover:bg-indigo-50/40' : ''}`}>
              <div className={`text-xs font-bold mb-1 flex items-center gap-1 ${dow === 5 ? 'text-blue-500' : dow === 6 ? 'text-rose-500' : 'text-slate-500'}`}>
                <span className={isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white' : ''}>{d.getDate()}</span>
                {list.length > 0 && <span className="text-[10px] text-indigo-400 font-semibold">{list.length}대</span>}
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((r, j) => (
                  <div key={j} className={`text-[10px] px-1 py-0.5 rounded border truncate ${STATUS_COLOR[r.status] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                    {r.pn} {r.hogi}
                  </div>
                ))}
                {list.length > 3 && <div className="text-[10px] text-slate-400 px-1">+{list.length - 3}대 더</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* 선택 날짜 상세 */}
      {picked && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-indigo-700">{picked} 납품 예정 — {pickedRows.length}대</p>
            <button onClick={() => setPicked(null)} className="text-xs text-slate-400 hover:text-slate-600">✕ 닫기</button>
          </div>
          <div className="space-y-1">
            {pickedRows.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-slate-100">
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_COLOR[r.status] || 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                <span className="font-mono text-indigo-600">{r.pn}</span>
                <span className="font-bold text-slate-700">{r.hogi}</span>
                <span className="text-slate-400">{r.name}</span>
                {r.ccn && <span className="text-slate-300 ml-auto">CCN {r.ccn}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
