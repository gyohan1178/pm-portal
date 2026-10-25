// 화면 머리 — 구분 · 제목 · 한 줄 설명 · 오른쪽 끝 버튼 (v4.96.0 · B안)
//   화면마다 제목이 있다 없다 하고 크기도 제각각이던 것을 같은 모양으로.
//   휴대폰은 위 보라 머리 줄에 제목이 이미 있으므로 구분 · 제목은 숨기고 설명 · 버튼만 보인다.
//   children = 오른쪽 버튼들 (주요 버튼은 보라 하나만)
export default function PageHead({ crumb, title, desc, children }) {
  return (
    <div data-page-head className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-[320px]">
        {crumb && <div className="hidden sm:block text-[11px] font-medium text-slate-400" data-page-crumb>{crumb}</div>}
        <h1 className="hidden sm:block text-[21px] font-extrabold text-slate-900 leading-tight tracking-tight" data-page-title>{title}</h1>
        {desc && <p className="page-desc text-xs sm:text-[13px] text-slate-400 mt-0 sm:mt-1 leading-relaxed">{desc}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 [&>*]:whitespace-nowrap" data-page-actions>{children}</div>}
    </div>
  )
}
