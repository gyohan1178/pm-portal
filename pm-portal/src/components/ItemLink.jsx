import { Link } from 'react-router-dom'

// 품번(기준코드)을 누르면 통합검색에서 그 품목을 연다 — 재고 · 고객사 코드 · 사용처(역전개) · BOM 으로 이어진다 (v4.57.0)
//   줄 전체에 클릭(선택 등)이 걸린 표 안에서도 쓰도록 클릭이 줄로 번지지 않게 막는다.
//   새 탭으로 열려면 Ctrl(⌘)+클릭.
export const itemSearchPath = (code) => `/search?q=${encodeURIComponent(String(code || '').trim())}`
export default function ItemLink({ code, children, className = '' }) {
  const c = String(code || '').trim()
  if (!c) return children ?? null
  return (
    <Link to={itemSearchPath(c)} data-item-link={c} onClick={(e) => e.stopPropagation()}
      title={`${c} — 통합검색에서 보기 (재고 · 사용처 · BOM)`}
      className={`hover:underline decoration-dotted underline-offset-2 ${className}`}>
      {children ?? c}
    </Link>
  )
}
