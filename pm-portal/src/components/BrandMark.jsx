// 포털 이름표 (v4.195.0) — 회사 로고(JS) + 「포털」 을 한 줄로. 검은 테두리 + 보라 그림자
//   로고 그림은 public/logo-mark.png — logo.png 둘레의 빈 여백을 잘라낸 것 (여백 때문에 글자와 높이가 안 맞았다)
//   size: 'sm' 사이드바 · 'lg' 로그인 화면
export default function BrandMark({ size = 'sm' }) {
  const lg = size === 'lg'
  const h = lg ? 34 : 24
  return (
    <div data-brand-mark className="inline-flex flex-col rounded-lg border-2 border-slate-900 bg-white"
      style={{ boxShadow: '4px 4px 0 #6c5ce7', padding: lg ? '8px 16px 10px' : '5px 10px 7px', gap: 2 }}>
      <span className="font-mono font-bold text-indigo-700 whitespace-nowrap" style={{ fontSize: lg ? 11 : 9.5, letterSpacing: 1 }}>JINSUNTECH / 포털</span>
      <span className="flex items-center" style={{ gap: lg ? 10 : 7 }}>
        <img src="/logo-mark.png" alt="JS" style={{ height: h, width: 'auto' }} />
        <span className="font-extrabold text-slate-900 whitespace-nowrap" style={{ fontSize: h - 1, lineHeight: h + 'px', letterSpacing: '-0.04em' }}>포털</span>
      </span>
    </div>
  )
}
