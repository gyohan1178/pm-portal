import { useState, useCallback } from 'react'

export function useResizableColumns(storageKey, defaults = {}) {
  const [widths, setWidths] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? { ...defaults, ...JSON.parse(saved) } : { ...defaults }
    } catch { return { ...defaults } }
  })

  const startResize = useCallback((e, colKey) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widths[colKey] || defaults[colKey] || 100

    function onMove(e) {
      const newW = Math.max(40, startWidth + e.clientX - startX)
      setWidths(prev => {
        const next = { ...prev, [colKey]: newW }
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
        return next
      })
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [widths, storageKey])

  function resetWidths() {
    setWidths({ ...defaults })
    try { localStorage.removeItem(storageKey) } catch {}
  }

  return { widths, startResize, resetWidths }
}
