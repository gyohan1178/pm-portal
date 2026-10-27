// 로딩 버튼 안의 작은 스피너 (v4.104.0) — {busy ? <><Spin /> 저장 중…</> : '저장'}
export default function Spin({ className = '' }) {
  return <span className={`inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin align-[-1px] ${className}`} aria-hidden="true" />
}
