import { useRef, useCallback, useEffect } from 'react'

// 표의 행을 눌러 선택하고, 끌어서 여러 줄을 한 번에 고르게 한다.
//
//   체크박스를 정확히 누르는 건 번거롭다. 행 아무 데나 눌러도 되게 하고,
//   누른 채 끌면 지나간 행이 같은 상태로 바뀌게 했다.
//
//   버튼·입력란·링크를 누른 경우는 선택으로 보지 않는다.
//   그 자리에서 수정·삭제 같은 다른 동작을 해야 하기 때문이다.
export function useRowSelect(setSel) {
  // { mode, x, y, moved } — 누른 위치와 실제로 끌었는지
  const drag = useRef(null)

  // 마우스를 떼면 드래그 종료. 표 밖에서 떼도 풀리도록 창에 건다.
  //   버튼이 이벤트를 삼켜 mouseup 을 놓치는 경우가 있어,
  //   click·mouseleave·창 전환에도 함께 풀어 준다.
  useEffect(() => {
    const end = () => { drag.current = null }
    window.addEventListener('mouseup', end)
    window.addEventListener('touchend', end)
    window.addEventListener('click', end)
    window.addEventListener('blur', end)
    document.addEventListener('mouseleave', end)
    return () => {
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchend', end)
      window.removeEventListener('click', end)
      window.removeEventListener('blur', end)
      document.removeEventListener('mouseleave', end)
    }
  }, [])

  const isControl = (e) =>
    !!e.target.closest('button,input,select,textarea,a,label,[data-no-select]')

  const start = useCallback((id, e, isOn) => {
    if (isControl(e)) return
    if (e.button !== undefined && e.button !== 0) return   // 왼쪽 버튼만
    const next = !isOn
    drag.current = { mode: next, x: e.clientX, y: e.clientY, moved: false }
    setSel(prev => ({ ...prev, [id]: next }))
  }, [setSel])

  const over = useCallback((id, e) => {
    const d = drag.current
    if (!d) return
    if (isControl(e)) return
    // 버튼을 뗀 상태로 지나가는 것은 드래그가 아니다.
    //   mouseup 을 놓쳤을 때 줄줄이 선택되던 문제를 막는다.
    if (e.buttons === 0) { drag.current = null; return }
    // 몇 픽셀은 움직여야 끄는 것으로 본다. 손떨림으로 옆 행이 잡히지 않게.
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return
      d.moved = true
    }
    const mode = d.mode
    setSel(prev => (prev[id] === mode ? prev : { ...prev, [id]: mode }))
  }, [setSel])

  // 행에 붙일 속성 묶음. isOn 은 그 행의 현재 선택 여부.
  const rowProps = useCallback((id, isOn) => ({
    onMouseDown: (e) => start(id, e, isOn),
    onMouseEnter: (e) => over(id, e),
  }), [start, over])

  return { rowProps, start, over }
}
