import { useFillHeight } from '../hooks/useFillHeight'

// 표 상자 — 화면에 남은 높이를 다 쓰고 상자 안에서 스크롤 (v4.65.0)
//   노트북에서 표가 페이지 아래로 밀려 몇 줄만 보이던 화면용. 표 머리글(thead)에 sticky top-0 을 같이 준다.
//   높이를 못 재면(맨 처음 · main 밖) 예전처럼 가로 스크롤만 하는 상자다.
export default function FillBox({ className = '', min = 360, enabled = true, children, ...rest }) {
  const [ref, h] = useFillHeight(enabled, min)
  return (
    <div ref={ref} data-fillbox className={`${className} ${h ? 'overflow-auto' : 'overflow-x-auto'}`} style={h ? { height: h + 'px' } : undefined} {...rest}>
      {children}
    </div>
  )
}
