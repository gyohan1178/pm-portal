import { useResizableColumns } from '../hooks/useResizableColumns'
import { useFillHeight } from '../hooks/useFillHeight'

function ResizeHandle({ onMouseDown }) {
  return (
    <span
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-400 transition-colors z-10"
      style={{ userSelect: 'none' }}
    />
  )
}

/**
 * cols: [{ key, label, defaultWidth, style, align }]
 * storageKey: localStorage 키
 * children: (widths) => <tbody>...</tbody>
 */
// fill: 표가 화면에 남은 높이를 다 쓰고 표 안에서 스크롤 (머리글 고정) — 노트북 화면용 (v4.64.0)
//   after: 표 아래(같은 스크롤 안)에 붙일 것 — 「더 보기」 줄 등
//   footer: 표 칸 아래(화면 안)에 붙일 것 — 비고 · 처리 단추 등
export function ResizableTable({ cols, storageKey, children, stickyHeader = true, sortKey, sortDir, onSort, fill = false, fillMin = 320, after = null, footer = null }) {
  const defaults = Object.fromEntries(cols.map(c => [c.key, c.defaultWidth || 100]))
  const { widths, startResize, resetWidths } = useResizableColumns(storageKey, defaults)

  const totalWidth = cols.reduce((a, c) => a + (widths[c.key] || c.defaultWidth || 100), 0)

  const [fillRef, fillH] = useFillHeight(fill, fillMin)
  if (fill) return (
    <div ref={fillRef} data-rt-fill className="flex flex-col" style={fillH ? { height: fillH + 'px' } : undefined}>
      <div className="flex-1 min-h-0 rounded-xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="text-xs" style={{ tableLayout: 'fixed', width: totalWidth + 'px', minWidth: '100%' }}>
            <colgroup>
              {cols.map(c => <col key={c.key} style={{ width: (widths[c.key] || c.defaultWidth || 100) + 'px' }} />)}
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200">
                {cols.map(c => (
                  <th key={c.key}
                    className="sticky top-0 z-[5] bg-slate-50 group/th px-3 py-2 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap overflow-hidden shadow-[inset_0_-1px_0_#e2e8f0]"
                    style={c.style || {}}>
                    <span
                      onClick={onSort && c.sortable !== false ? () => onSort(c.key) : undefined}
                      className={onSort && c.sortable !== false ? 'cursor-pointer select-none hover:text-slate-600' : ''}>
                      {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </span>
                    <ResizeHandle onMouseDown={e => startResize(e, c.key)} />
                  </th>
                ))}
              </tr>
            </thead>
            {children(widths)}
          </table>
          {after}
        </div>
        <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-400">
          <span>💡 열 머리글 오른쪽 끝을 끌면 너비 조절</span>
          <button onClick={resetWidths} className="ml-auto hover:text-slate-600">열 너비 초기화</button>
        </div>
      </div>
      {footer && <div className="shrink-0 pt-2">{footer}</div>}
    </div>
  )

  return (
    <div>
      <div className="flex justify-end mb-1">
        <button onClick={resetWidths}
          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 border border-slate-200 rounded-lg">
          열 너비 초기화
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-xs" style={{ tableLayout: 'fixed', width: totalWidth + 'px', minWidth: '100%' }}>
            <colgroup>
              {cols.map(c => <col key={c.key} style={{ width: (widths[c.key] || c.defaultWidth || 100) + 'px' }} />)}
            </colgroup>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {cols.map(c => (
                  <th key={c.key}
                    className="relative group/th px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap overflow-hidden"
                    style={c.style || {}}>
                    <span
                      onClick={onSort && c.sortable !== false ? () => onSort(c.key) : undefined}
                      className={onSort && c.sortable !== false ? 'cursor-pointer select-none hover:text-slate-600' : ''}>
                      {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </span>
                    <ResizeHandle onMouseDown={e => startResize(e, c.key)} />
                  </th>
                ))}
              </tr>
            </thead>
            {children(widths)}
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-1">💡 열 헤더 오른쪽 끝을 드래그하면 너비를 조절할 수 있어요</p>
    </div>
  )
}
