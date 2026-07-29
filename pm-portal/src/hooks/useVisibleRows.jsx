import { useState, useEffect } from 'react'

/**
 * 긴 목록의 표시 건수를 제한한다.
 *
 * 수천 건을 한 번에 그리면 입력창에 글자 하나 칠 때마다 전체가 다시 그려져
 * 타이핑이 밀린다. 처음엔 일부만 그리고 '더 보기'로 늘린다.
 *
 *   const { shown, visible, total, more, showAll, hasMore } = useVisibleRows(filtered, 200, [search, tab])
 *   {shown.map(...)}
 *   <MoreRows {...{ visible, total, more, showAll, hasMore }} />
 *
 * @param rows     전체 목록
 * @param step     한 번에 늘릴 건수 (초기 표시 건수이기도 하다)
 * @param resetOn  이 값들이 바뀌면 처음으로 되돌린다 (검색어·탭 등)
 */
export function useVisibleRows(rows, step = 200, resetOn = []) {
  const [visible, setVisible] = useState(step)

  // 조회 조건이 바뀌면 처음부터
  useEffect(() => { setVisible(step) }, resetOn)   // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows?.length || 0
  return {
    shown: rows?.slice(0, visible) || [],
    visible: Math.min(visible, total),
    total,
    hasMore: total > visible,
    more: () => setVisible(v => v + step),
    showAll: () => setVisible(total),
    step,
  }
}

/** 목록 아래에 붙이는 '더 보기' 줄 */
export function MoreRows({ visible, total, hasMore, more, showAll, step = 200 }) {
  if (!hasMore) return null
  return (
    <div className="flex items-center justify-center gap-3 py-3">
      <span className="text-xs text-slate-400">
        {visible.toLocaleString()} / {total.toLocaleString()}건 표시
      </span>
      <button onClick={more}
        className="px-4 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50">
        더 보기 (+{step})
      </button>
      <button onClick={showAll}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-600">
        전체 보기
      </button>
    </div>
  )
}
