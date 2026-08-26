import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const KIND = {
  request:     { icon: '🙋', label: '자재 요청' },
  inboundLate: { icon: '📦', label: '입고 지연' },
  inboundSoon: { icon: '🚚', label: '입고 예정' },
  order:       { icon: '🛒', label: '발주 필요' },
  neg:         { icon: '⚠️', label: '재고 음수' },
  lot:         { icon: '🏷', label: '로트 기한' },
  todo:        { icon: '📋', label: '할 일' },
}

const ALL_KINDS = Object.keys(KIND)

async function fetchAlerts() {
  const { data, error } = await supabase.rpc('pm_alerts')
  if (error) throw error
  return data || []
}
async function fetchPref() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('pm_alert_pref')
    .select('*').eq('user_id', user.id).maybeSingle()
  return data || { user_id: user.id, kinds: ALL_KINDS, min_level: '보통', customers: null }
}

// 알림.
//
//   볼 정보가 많아 놓치는 일이 생긴다.
//   여기에 모아 두고, 사람마다 무엇을 받을지 고르게 한다.
export default function AlertBell() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState(false)
  const box = useRef(null)

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'], queryFn: fetchAlerts,
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
    retry: 1,
  })
  const { data: pref } = useQuery({ queryKey: ['alertPref'], queryFn: fetchPref, enabled: setup })

  const unread = alerts.filter(a => !a.is_read)
  const high = unread.filter(a => a.level === '높음')

  const markMut = useMutation({
    mutationFn: async (keys) => {
      if (!keys.length) return
      const { error } = await supabase.rpc('pm_alert_mark', { p_keys: keys })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['alerts']),
  })

  const prefMut = useMutation({
    mutationFn: async (patch) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.from('pm_alert_pref')
        .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['alertPref']); qc.invalidateQueries(['alerts']) },
  })

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setSetup(false) } }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = (a) => {
    markMut.mutate([a.alert_key])
    setOpen(false)
    if (a.link) nav(a.link)
  }

  const toggleKind = (k) => {
    const cur = pref?.kinds || ALL_KINDS
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]
    prefMut.mutate({ kinds: next, min_level: pref?.min_level || '보통', customers: pref?.customers || null })
  }

  return (
    <div className="relative flex-shrink-0" ref={box}>
      <button onClick={() => { setOpen(v => !v); setSetup(false) }}
        className="relative text-slate-400 hover:text-slate-600 p-1.5 rounded hover:bg-slate-100 transition-colors"
        title="알림">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1h6z" />
        </svg>
        {unread.length > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] px-1 rounded-full text-white text-[9px] font-bold leading-4 text-center ${
            high.length > 0 ? 'bg-rose-500' : 'bg-slate-400'}`}>
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-[340px] max-h-[70vh] bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800">알림</span>
            {unread.length > 0 && (
              <span className="text-[11px] text-slate-400">
                안 읽음 {unread.length}{high.length > 0 && ` · 급함 ${high.length}`}
              </span>
            )}
            <button onClick={() => setSetup(v => !v)}
              className={`ml-auto text-[11px] px-1.5 py-0.5 rounded ${
                setup ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-slate-400'}`}>
              설정
            </button>
            {unread.length > 0 && !setup && (
              <button onClick={() => markMut.mutate(unread.map(a => a.alert_key))}
                className="text-[11px] text-slate-400 hover:text-slate-600">모두 읽음</button>
            )}
          </div>

          {setup ? (
            <div className="p-3 space-y-3 overflow-y-auto">
              <div>
                <p className="text-xs font-bold text-slate-600 mb-1.5">받을 알림</p>
                <div className="space-y-1">
                  {ALL_KINDS.map(k => (
                    <label key={k} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={(pref?.kinds || ALL_KINDS).includes(k)}
                        onChange={() => toggleKind(k)} />
                      <span>{KIND[k].icon}</span> {KIND[k].label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-600 mb-1.5">받을 정도</p>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                  {[['보통', '전부'], ['높음', '급한 것만']].map(([v, l]) => (
                    <button key={v}
                      onClick={() => prefMut.mutate({
                        kinds: pref?.kinds || ALL_KINDS, min_level: v, customers: pref?.customers || null,
                      })}
                      className={`flex-1 px-2 py-1 text-[11px] font-bold rounded-md ${
                        (pref?.min_level || '보통') === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-600 mb-1.5">담당 고객사</p>
                <div className="flex gap-1 flex-wrap">
                  {[['ax', 'AXCELIS'], ['ed', 'Edwards'], ['vm', 'VM'], ['csk', 'CSK']].map(([v, l]) => {
                    const cur = pref?.customers || []
                    const on = cur.includes(v)
                    return (
                      <button key={v}
                        onClick={() => prefMut.mutate({
                          kinds: pref?.kinds || ALL_KINDS,
                          min_level: pref?.min_level || '보통',
                          customers: (on ? cur.filter(x => x !== v) : [...cur, v]),
                        })}
                        className={`px-2 py-1 text-[11px] font-bold rounded-md border ${
                          on ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-400'}`}>
                        {l}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">고르지 않으면 전부 받습니다</p>
              </div>
            </div>
          ) : (
            <div className="overflow-y-auto">
              {!alerts.length && (
                <div className="text-center py-10">
                  <p className="text-sm text-slate-400">알림이 없습니다 👍</p>
                </div>
              )}
              {alerts.map(a => (
                <button key={a.alert_key} onClick={() => go(a)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 ${
                    a.is_read ? 'opacity-45' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-sm flex-shrink-0 mt-0.5">{KIND[a.kind]?.icon || '•'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-slate-800 truncate">{a.title}</span>
                        {a.level === '높음' && !a.is_read && (
                          <span className="px-1 rounded bg-rose-100 text-rose-600 text-[9px] font-bold flex-shrink-0">급함</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{a.detail}</p>
                    </div>
                    {a.customer && (
                      <span className="text-[9px] font-bold text-slate-400 uppercase flex-shrink-0 mt-0.5">
                        {a.customer}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
