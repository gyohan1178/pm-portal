import { useRef, useCallback, useEffect } from 'react'

// 표의 행을 눌러 선택하고, 끌어서 여러 줄을 한 번에 고르게 한다.
//
//   체크박스를 정확히 누르는 건 번거롭다. 행 아무 데나 눌러도 되게 하고,
//   누른 채 끌면 지나간 행이 같은 상태로 바뀌게 했다.
//   (첫 행이 선택되면 나머지도 선택, 해제면 나머지도 해제)
//
//   버튼·입력란·링크를 누른 경우는 선택으로 보지 않는다.
//   그 자리에서 수정·삭제 같은 다른 동작을 해야 하기 때문이다.
export function useRowSelect(setSel) {
  const drag = useRef(null)     // { mode: true|false } — 끄는 중인 상태

  // 마우스를 떼면 드래그 종료. 표 밖에서 떼도 풀리도록 창에 건다.
  useEffect(() => {
    const up = () => { drag.current = null }
    window.addEventListener('mouseup', up)
    window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchend', up)
    }
  }, [])

  const isControl = (e) =>
    !!e.target.closest('button,input,select,textarea,a,label,[data-no-select]')

  // 현재 선택 상태를 직접 읽어 다음 값을 정한다.
  // setSel 콜백 안에서 판단하면 드래그 모드를 즉시 못 잡기 때문이다.
  const start = useCallback((id, e, isOn) => {
    if (isControl(e)) return
    const next = !isOn
    drag.current = { mode: next }
    setSel(prev => ({ ...prev, [id]: next }))
  }, [setSel])

  const over = useCallback((id, e) => {
    if (!drag.current) return
    if (isControl(e)) return
    setSel(prev => prev[id] === drag.current.mode ? prev : { ...prev, [id]: drag.current.mode })
  }, [setSel])

  // 행에 붙일 속성 묶음. isOn 은 그 행의 현재 선택 여부.
  const rowProps = useCallback((id, isOn) => ({
    onMouseDown: (e) => start(id, e, isOn),
    onMouseEnter: (e) => over(id, e),
  }), [start, over])

  return { rowProps, start, over }
}
