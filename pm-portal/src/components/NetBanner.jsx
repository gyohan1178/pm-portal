import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { netBad, onNetChange, reportNetOk } from '../lib/netStatus'

// ⚠ 인터넷 불안정 줄 (v4.154.0) — 끊겼거나 방금 요청이 서버까지 못 갔을 때 화면 위에
//   다시 연결되면(브라우저 online) 보던 화면을 새로 불러온다 · 「다시 불러오기」로 직접도
export default function NetBanner() {
  const qc = useQueryClient()
  const [bad, setBad] = useState(netBad())
  const [off, setOff] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const upd = () => { setBad(netBad()); setOff(navigator.onLine === false) }
    const onOnline = () => { reportNetOk(); upd(); qc.refetchQueries({ type: 'active' }) }
    const un = onNetChange(upd)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', upd)
    const t = setInterval(upd, 5000)   // 45초 지나면 저절로 사라짐
    return () => { un(); window.removeEventListener('online', onOnline); window.removeEventListener('offline', upd); clearInterval(t) }
  }, [qc])
  if (!bad) return null
  return (
    <div data-net-banner className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-amber-50 border-b border-amber-200 text-amber-800">
      <span>{off ? '⚠ 인터넷이 끊겼습니다 — 다시 연결되면 화면을 저절로 새로 불러옵니다' : '⚠ 인터넷이 불안정합니다 — 불러오기는 저절로 다시 시도합니다. 저장이 안 된 칸은 다시 눌러 주세요'}</span>
      <button onClick={() => { reportNetOk(); setBad(false); qc.refetchQueries({ type: 'active' }) }} data-net-retry
        className="ml-auto px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-100">↻ 다시 불러오기</button>
    </div>
  )
}
