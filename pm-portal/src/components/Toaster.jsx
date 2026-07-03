import { useEffect, useState } from 'react'
import { subscribeToast } from '../lib/toast'

const STYLE = {
  error:   { bg: '#fef2f2', bd: '#fecaca', tx: '#b91c1c', ic: '⚠' },
  success: { bg: '#ecfdf5', bd: '#a7f3d0', tx: '#047857', ic: '✓' },
  info:    { bg: '#eff6ff', bd: '#bfdbfe', tx: '#1d4ed8', ic: 'ℹ' },
}

export default function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => subscribeToast(t => {
    setItems(prev => [...prev, t])
    const ttl = t.type === 'error' ? 7000 : 3500
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), ttl)
  }), [])

  if (!items.length) return null
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
      {items.map(t => {
        const c = STYLE[t.type] || STYLE.info
        return (
          <div key={t.id} onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
            style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.tx, borderRadius: 10, padding: '10px 14px', fontSize: 13, lineHeight: 1.4, boxShadow: '0 4px 14px rgba(15,23,42,0.10)', display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>{c.ic}</span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
