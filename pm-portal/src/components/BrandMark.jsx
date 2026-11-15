// 포털 이름표 — 회사 로고(JS)만 (v4.197.2 · 11/16 시안 1번)
//   테두리 · 「포털」 글자는 뺐다 (로고와 안 어울림). 이름은 아직 고민 중 — 정해지면 여기만 고치면 된다
//   로고 그림은 public/logo-mark.png — logo.png 둘레의 빈 여백을 잘라낸 것
//   size: 'sm' 사이드바 · 'lg' 로그인 화면
export default function BrandMark({ size = 'sm' }) {
  const h = size === 'lg' ? 44 : 30
  return (
    <span data-brand-mark className="inline-flex items-center">
      <img src="/logo-mark.png" alt="JS 포털" style={{ height: h, width: 'auto' }} />
    </span>
  )
}
