import { useState, useEffect } from 'react'
import { toast, toastError, toastSuccess } from '../lib/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { CUSTOMERS, orderedCustomers } from '../lib/customers'

// 우측 상단 ⚙️에서 열리는 개인 설정. profile = 현재 사용자 pm_profiles row.
export default function SettingsModal({ profile, onClose }) {
  const qc = useQueryClient()
  const [order, setOrder] = useState(() => orderedCustomers(profile).map(c => c.id))
  useEffect(() => { setOrder(orderedCustomers(profile).map(c => c.id)) }, [profile])

  const move = (i, dir) => setOrder(prev => {
    const j = i + dir
    if (j < 0 || j >= prev.length) return prev
    const next = [...prev];[next[i], next[j]] = [next[j], next[i]]; return next
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('pm_profiles')
        .update({ customer_order: order, primary_customer: order[0] }).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['myProfile'] })
      onClose()
    },
    onError: (e) => toastError('저장 오류: ' + e.message),
  })

  const nameOf = id => CUSTOMERS.find(c => c.id === id)?.name || id
  const colorOf = id => CUSTOMERS.find(c => c.id === id)?.color || '#999'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">⚙️ 설정</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* 고객사 표시 순서 */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">고객사 표시 순서</label>
          <p className="text-xs text-slate-400">위에 둔 고객사가 메뉴·탭에서 먼저 표시되고, 맨 위가 기본 화면이 됩니다.</p>
          <div className="space-y-1.5">
            {order.map((id, i) => (
              <div key={id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white">
                <span className="text-xs font-bold text-slate-300 w-4">{i + 1}</span>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorOf(id) }} />
                <span className="text-sm font-semibold text-slate-700 flex-1">{nameOf(id)}</span>
                {i === 0 && <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">기본</span>}
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="w-7 h-7 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-25">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === order.length - 1}
                  className="w-7 h-7 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-25">▼</button>
              </div>
            ))}
          </div>
        </div>

        {/* 메뉴 순서 편집 자리 (다음 단계에서 추가) */}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">취소</button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {saveMut.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
