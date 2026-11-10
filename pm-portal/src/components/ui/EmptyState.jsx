// 공용 빈 상태 · 조회 실패 (v4.167.0)
//   「불러오는 중」 글자 대신 스켈레톤(ux/Skeleton), 자료가 없으면 EmptyState, 조회가 실패하면 ErrorState.
//   조회 실패를 「0건」으로 보여 주면 자료가 정말 없는 줄 안다 — 실패는 반드시 ErrorState 로.

// 블록형 — 카드 · 목록 자리에
export function EmptyState({ icon = '📭', title = '자료가 없습니다', desc, action, className = '' }) {
  return (
    <div data-empty className={`flex flex-col items-center justify-center text-center py-10 px-4 ${className}`}>
      <div className="text-3xl mb-2 opacity-60">{icon}</div>
      <p className="text-sm font-bold text-slate-500">{title}</p>
      {desc && <p className="mt-1 text-xs text-slate-400 max-w-md leading-relaxed">{desc}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

// 표 안 — <tbody> 의 한 줄로
export function EmptyRow({ cols, ...p }) {
  return <tr><td colSpan={cols}><EmptyState {...p} /></td></tr>
}

// 조회 실패 — 다시 시도 버튼
export function ErrorState({ error, onRetry, title = '불러오지 못했습니다', className = '' }) {
  const msg = error?.message || (typeof error === 'string' ? error : '')
  return (
    <div data-error-state className={`flex flex-col items-center justify-center text-center py-10 px-4 ${className}`}>
      <div className="text-3xl mb-2">⚠️</div>
      <p className="text-sm font-bold text-rose-600">{title}</p>
      <p className="mt-1 text-xs text-slate-400 max-w-md leading-relaxed">
        자료가 없는 것이 아니라 조회가 실패했습니다.{msg && <> ({msg})</>} 잠시 뒤 다시 시도해 주세요.
      </p>
      {onRetry && <button type="button" onClick={() => onRetry()} className="mt-3 h-[34px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50">↻ 다시 불러오기</button>}
    </div>
  )
}
export function ErrorRow({ cols, ...p }) {
  return <tr><td colSpan={cols}><ErrorState {...p} /></td></tr>
}
