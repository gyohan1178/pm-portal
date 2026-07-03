import { useState, useMemo } from 'react'

// 표 정렬 공통 훅 — ResizableTable과 함께 써서 모든 표에 동일한 정렬 동작을 부여.
// 사용:
//   const { sorted, sortKey, sortDir, onSort } = useTableSort(rows, { defaultKey:'std_code' })
//   <ResizableTable cols={COLS} sortKey={sortKey} sortDir={sortDir} onSort={onSort} ...>
//     {() => <tbody>{sorted.map(...)}</tbody>}
//   accessors: 컬럼 표시값과 정렬값이 다를 때 { colKey: row => 정렬용값 }
export function useTableSort(rows, { defaultKey = null, defaultDir = 'asc', accessors = {} } = {}) {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDir, setSortDir] = useState(defaultDir)

  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows || []
    const get = accessors[sortKey] || (r => r?.[sortKey])
    const arr = [...(rows || [])]
    arr.sort((a, b) => {
      let x = get(a), y = get(b)
      const xe = x == null || x === '', ye = y == null || y === ''
      if (xe && ye) return 0
      if (xe) return 1
      if (ye) return -1
      if (typeof x === 'number' && typeof y === 'number') return sortDir === 'asc' ? x - y : y - x
      // 숫자 문자열도 숫자로
      const nx = Number(String(x).replace(/,/g, '')), ny = Number(String(y).replace(/,/g, ''))
      if (!isNaN(nx) && !isNaN(ny)) return sortDir === 'asc' ? nx - ny : ny - nx
      return sortDir === 'asc'
        ? String(x).localeCompare(String(y), 'ko')
        : String(y).localeCompare(String(x), 'ko')
    })
    return arr
  }, [rows, sortKey, sortDir])

  return { sorted, sortKey, sortDir, onSort }
}
