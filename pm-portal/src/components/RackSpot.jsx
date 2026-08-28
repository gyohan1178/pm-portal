// 창고 랙에서 어느 칸인지 그림으로 보여 준다.
//
//   위치가 'W7-05-3' 처럼 글자로만 나와서
//   창고에 서서 찾을 때 세어 가며 봐야 했다.
//
//   '라벨' · '방' 처럼 랙이 아닌 곳도 있어, 그런 것은 그리지 않는다.

// 'W7-05-3' → { rack: 'W7', row: 5, level: 3 }
export function parseLoc(loc) {
  const m = /^([A-Z]{1,2}\d?)\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})$/i.exec(String(loc || '').trim())
  if (!m) return null
  return { rack: m[1].toUpperCase(), row: Number(m[2]), level: Number(m[3]) }
}

/**
 * @param loc   'W7-05-3'
 * @param rack  { code, rows_cnt, levels_cnt, zone }
 */
export default function RackSpot({ loc, rack }) {
  const p = parseLoc(loc)

  // 랙이 아닌 곳은 글자로만 보여 준다
  if (!p || !rack) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
        <span className="font-mono text-sm font-bold text-slate-700">{loc || '위치 없음'}</span>
        {loc && !p && <p className="text-[11px] text-slate-400 mt-0.5">랙이 아닌 곳입니다</p>}
      </div>
    )
  }

  const rows = rack.rows_cnt || 0
  const levels = rack.levels_cnt || 0

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-mono text-base font-bold text-slate-900">{p.rack}</span>
        <span className="text-xs text-slate-400">{rack.zone}</span>
        <span className="ml-auto font-mono text-sm font-bold text-rose-600">
          {p.row}칸 {p.level}층
        </span>
      </div>

      {/* 위층이 위에 오도록 뒤집어 그린다 */}
      <div className="space-y-1">
        {Array.from({ length: levels }, (_, i) => levels - i).map(lv => (
          <div key={lv} className="flex items-center gap-1">
            <span className="w-6 text-[10px] text-slate-400 text-right flex-shrink-0">{lv}층</span>
            <div className="flex gap-0.5 flex-1">
              {Array.from({ length: rows }, (_, i) => i + 1).map(row => {
                const hit = row === p.row && lv === p.level
                return (
                  <div key={row}
                    className={`flex-1 min-w-0 rounded-sm text-center leading-none ${
                      hit
                        ? 'bg-rose-500 text-white font-bold py-2 ring-2 ring-rose-300'
                        : 'bg-slate-100 text-slate-300 py-2'}`}
                    style={{ fontSize: rows > 14 ? '8px' : '10px' }}>
                    {hit ? '★' : row}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-slate-400 mt-1.5 text-center">
        {rows}칸 × {levels}층
      </p>
    </div>
  )
}
