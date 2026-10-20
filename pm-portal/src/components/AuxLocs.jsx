// 보조 칸(넘쳐 보관) 위치 표시 — 본 칸 옆에 파랗게 「+N1-01-2 (35)」 (v4.79.0)
//   aux: [{ id, location, qty }] · withQty: 칸 수량도
export default function AuxLocs({ aux, withQty = true, className = '' }) {
  if (!aux?.length) return null
  return (
    <span data-aux-locs className={`inline-flex flex-wrap gap-1 ${className}`}>
      {aux.map((a) => (
        <span key={a.id || a.location} title="보조 칸 — 본 칸에 자리가 모자라 넘쳐 둔 곳"
          className="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 font-mono text-[11px] font-bold whitespace-nowrap">
          +{a.location}{withQty ? ` (${(Number(a.qty) || 0).toLocaleString('ko-KR')})` : ''}
        </span>
      ))}
    </span>
  )
}
