// 스켈레톤 — 「불러오는 중…」 글자 대신 표 · 카드 모양을 먼저 깐다 (v4.104.0)
//   표가 한꺼번에 나타나며 화면이 덜컹 내려가지 않고, 기다리는 느낌이 줄어든다
const W = [62, 84, 120, 70, 96, 54, 76, 110, 66]
export function SkelBar({ w = 80, h = 11, className = '' }) {
  return <span className={`pm-skel block rounded-md ${className}`} style={{ width: typeof w === 'number' ? `${w}px` : w, height: h }} />
}
// 표 몸통 — cols 칸 × rows 줄. two = 두 줄 칸(품번 · 품명처럼) 번호들
export function SkeletonRows({ cols = 6, rows = 6, two = [], first = 0 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} className="border-t border-slate-100" data-skeleton>
      {Array.from({ length: cols }, (_, c) => (
        <td key={c} className={`py-3 ${c === 0 && first ? 'pl-4' : 'px-3'}`}>
          {c < first ? <SkelBar w={14} h={14} /> : <>
            <SkelBar w={W[(c + r) % W.length] * (two.includes(c) ? 1.4 : 1)} />
            {two.includes(c) && <SkelBar w={W[(c + r + 3) % W.length]} h={9} className="mt-1.5" />}
          </>}
        </td>
      ))}
    </tr>
  ))
}
// 휴대폰 카드 · 블록
export function SkeletonCards({ n = 4 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2" data-skeleton>
      <div className="flex gap-2"><SkelBar w={56} h={16} /><SkelBar w={110} h={16} /></div>
      <SkelBar w="70%" /><SkelBar w="45%" h={9} />
    </div>
  ))
}
