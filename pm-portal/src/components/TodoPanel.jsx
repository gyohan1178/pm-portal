import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

const P = {
  1: { label: '긴급', cls: 'border-rose-300 bg-rose-50', dot: 'bg-rose-500', txt: 'text-rose-700' },
  2: { label: '주의', cls: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500', txt: 'text-amber-700' },
  3: { label: '참고', cls: 'border-slate-200 bg-white', dot: 'bg-slate-300', txt: 'text-slate-500' },
}

// 오늘 할 일.
//
//   화면에 들어가야 보이던 것을 먼저 보여준다.
//   조치가 필요한 것만 우선순위대로 나오며, 없으면 나타나지 않는다.
export default function TodoPanel({ compact }) {
  const nav = useNavigate()

  const { data: todos = [], isLoading } = useQuery({
    queryKey: ['todoList'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_todo_list', { p_customer: null })
      if (error) throw error
      return data || []
    },
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })

  const urgent = todos.filter(t => t.priority === 1)
  const shown = compact ? todos.slice(0, 5) : todos

  if (isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-400">확인 중…</div>
  }

  if (!todos.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <p className="text-2xl mb-1">✓</p>
        <p className="text-sm font-bold text-emerald-800">조치가 필요한 항목이 없습니다</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-700">오늘 할 일</h2>
        {urgent.length > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-bold">
            긴급 {urgent.length}
          </span>
        )}
        <span className="text-xs text-slate-400 ml-auto">{todos.length}건</span>
      </div>

      {shown.map((t, i) => {
        const s = P[t.priority] || P[3]
        return (
          <button key={i} onClick={() => t.link && nav(t.link)}
            className={`w-full text-left rounded-xl border p-3.5 transition-all hover:shadow-md ${s.cls}`}>
            <div className="flex items-start gap-3">
              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold ${s.txt}`}>{t.kind}</span>
                  {t.customer && t.customer !== '전체' && (
                    <span className="text-[10px] text-slate-400">{t.customer}</span>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-800 mt-0.5">{t.title}</p>
                {t.detail && <p className="text-xs text-slate-500 mt-0.5">{t.detail}</p>}
              </div>
              <span className="text-slate-300 text-sm">›</span>
            </div>
          </button>
        )
      })}

      {compact && todos.length > shown.length && (
        <p className="text-center text-xs text-slate-400 pt-1">외 {todos.length - shown.length}건</p>
      )}
    </div>
  )
}
