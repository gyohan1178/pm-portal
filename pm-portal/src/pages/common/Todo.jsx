import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const PERIODS = ['일','주','월','분기']
const MEMBERS = ['교한','황주현','남기문','충원']

async function fetchTodos(period) {
  const { data } = await supabase
    .from('todos')
    .select('*')
    .eq('period', period)
    .order('created_at', { ascending: false })
  return data || []
}

export default function Todo() {
  const qc = useQueryClient()
  const [period, setPeriod] = useState('일')
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('교한')

  const { data: todos = [] } = useQuery({
    queryKey: ['todos', period],
    queryFn: () => fetchTodos(period),
  })

  const addMut = useMutation({
    mutationFn: async ({ title, period, assigned_to }) => {
      const { error } = await supabase.from('todos').insert({ title, period, assigned_to })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['todos', period]); setTitle('') },
  })

  const toggleMut = useMutation({
    mutationFn: async ({ id, done }) => {
      const { error } = await supabase.from('todos').update({ done: !done }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['todos', period]),
  })

  const deleteMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('todos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['todos', period]),
  })

  const done = todos.filter(t => t.done)
  const pending = todos.filter(t => !t.done)

  return (
    <div className="space-y-4 max-w-2xl">
      {/* 기간 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {PERIODS.map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 text-xs font-600 rounded-md transition-all
              ${period===p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {p}간
          </button>
        ))}
      </div>

      {/* 입력 */}
      <div className="flex gap-2">
        <input
          value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && title.trim()) addMut.mutate({ title, period, assigned_to: assignee }) }}
          placeholder="이슈 또는 할일 입력 후 Enter"
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <select value={assignee} onChange={e => setAssignee(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
          {MEMBERS.map(m => <option key={m}>{m}</option>)}
        </select>
        <button
          onClick={() => { if (title.trim()) addMut.mutate({ title, period, assigned_to: assignee }) }}
          disabled={!title.trim() || addMut.isPending}
          className="px-4 py-2 text-xs font-700 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
          추가
        </button>
      </div>

      {/* 미완료 */}
      <div className="space-y-1.5">
        {pending.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-xs">등록된 {period}간 항목이 없습니다</div>
        )}
        {pending.map(t => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:border-slate-300 group">
            <button onClick={() => toggleMut.mutate({ id: t.id, done: t.done })}
              className="w-4 h-4 rounded border-2 border-slate-300 flex-shrink-0 hover:border-indigo-500 transition-colors" />
            <span className="flex-1 text-sm text-slate-800">{t.title}</span>
            <span className="text-[10px] font-600 text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{t.assigned_to}</span>
            <button onClick={() => deleteMut.mutate(t.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 text-xs transition-opacity">✕</button>
          </div>
        ))}
      </div>

      {/* 완료 */}
      {done.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-700 text-slate-400 uppercase tracking-widest">완료 ({done.length})</p>
          {done.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl opacity-60 group">
              <button onClick={() => toggleMut.mutate({ id: t.id, done: t.done })}
                className="w-4 h-4 rounded bg-emerald-500 border-2 border-emerald-500 flex-shrink-0 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 stroke-white fill-none" viewBox="0 0 10 10" strokeWidth="2" strokeLinecap="round">
                  <path d="M1.5 5L4 7.5L8.5 2.5"/>
                </svg>
              </button>
              <span className="flex-1 text-sm text-slate-500 line-through">{t.title}</span>
              <span className="text-[10px] font-600 text-slate-400">{t.assigned_to}</span>
              <button onClick={() => deleteMut.mutate(t.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 text-xs transition-opacity">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
