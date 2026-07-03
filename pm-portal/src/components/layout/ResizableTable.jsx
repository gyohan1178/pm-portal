import { useResizableColumns } from '../hooks/useResizableColumns'

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
export function ResizableTable({ cols, storageKey, children, stickyHeader = true }) {
  const defaults = Object.fromEntries(cols.map(c => [c.key, c.defaultWidth || 100]))
  const { widths, startResize, resetWidths } = useResizableColumns(storageKey, defaults)

  const totalWidth = cols.reduce((a, c) => a + (widths[c.key] || c.defaultWidth || 100), 0)

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
                    {c.label}
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
