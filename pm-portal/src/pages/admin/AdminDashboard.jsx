import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'

const STATUS = ['대기', '진행중', '완료', '보류']
const PRIORITY = ['높음', '보통', '낮음']

const ST_CLS = {
  '대기':   'bg-slate-100 text-slate-600',
  '진행중': 'bg-blue-50 text-blue-700',
  '완료':   'bg-emerald-50 text-emerald-700',
  '보류':   'bg-amber-50 text-amber-700',
}
const PR_CLS = {
  '높음': 'bg-red-50 text-red-600 border-red-200',
  '보통': 'bg-slate-50 text-slate-500 border-slate-200',
  '낮음': 'bg-slate-50 text-slate-400 border-slate-200',
}

const today = () => new Date().toISOString().split('T')[0]
const dday = (d) => (d ? Math.round((new Date(d) - new Date(today())) / 86400000) : null)

function ddayCls(n) {
  if (n == null) return 'text-slate-300'
  if (n < 0) return 'text-red-600 font-bold'
  if (n <= 3) return 'text-amber-600 font-semibold'
  return 'text-slate-500'
}
function ddayText(n) {
  if (n == null) return ''
  if (n < 0) return `${-n}일 지남`
  if (n === 0) return '오늘'
  return `D-${n}`
}

async function fetchTodos() {
  const { data, error } = await supabase
    .from('pm_todo')
    .select('*')
    .order('status')
    .order('due_date', { nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// 주간회의에서 다룰 일과 처리할 항목.
//
//   노션에 매여 있던 액션 아이템을 여기에 바로 적어 쓰도록 바꿨다.
//   회의 자리에서 열어 두고 상태를 바꾸는 쓰임을 생각했다.
export default function AdminDashboard() {
  const qc = useQueryClient()
  const [view, setView] = useState('open')     // open = 남은 것 | all = 전부
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState(null)     // 추가·수정 중인 항목

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['todos'], queryFn: fetchTodos,
  })

  const saveMut = useMutation({
    mutationFn: async (rec) => {
      const payload = {
        title: (rec.title || '').trim(),
        detail: rec.detail || null,
        status: rec.status || '대기',
        priority: rec.priority || '보통',
        owner: rec.owner || null,
        due_date: rec.due_date || null,
        tag: rec.tag || null,
      }
      if (!payload.title) throw new Error('내용을 적어 주세요')
      if (rec.id) {
        const { error } = await supabase.from('pm_todo').update(payload).eq('id', rec.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pm_todo').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries(['todos']); setDraft(null) },
    onError: (e) => toastError(e.message),
  })

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('pm_todo').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['todos']),
    onError: (e) => toastError('저장 실패: ' + e.message),
  })

  const delMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('pm_todo').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['todos']); toastSuccess('삭제됨') },
    onError: (e) => toastError('삭제 실패: ' + e.message),
  })

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter(r => {
      if (view === 'open' && r.status === '완료') return false
      if (!kw) return true
      return [r.title, r.detail, r.owner, r.tag]
        .some(v => String(v || '').toLowerCase().includes(kw))
    })
  }, [rows, view, q])

  const open = rows.filter(r => r.status !== '완료')
  const overdue = open.filter(r => r.due_date && dday(r.due_date) < 0)
  const high = open.filter(r => r.priority === '높음')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📋 할 일</h1>
          <p className="text-xs text-slate-400">주간회의에서 다룰 내용과 처리할 항목</p>
        </div>
        <button onClick={() => setDraft({ status: '대기', priority: '보통', due_date: '' })}
          className="ml-auto px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">
          + 추가
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-400 mb-1">남은 일</p>
          <p className="text-xl font-bold text-slate-900">{open.length}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-bold text-red-400 mb-1">기한 지남</p>
          <p className="text-xl font-bold text-red-600">{overdue.length}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-500 mb-1">우선순위 높음</p>
          <p className="text-xl font-bold text-amber-700">{high.length}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['open', '남은 것'], ['all', '전부']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${
                view === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="내용·담당자 검색"
          className="flex-1 min-w-[160px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg" />
        <span className="text-xs text-slate-400">{list.length}건</span>
      </div>

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !list.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500 font-semibold">
            {q ? '찾는 항목이 없습니다' : '적어 둔 일이 없습니다'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            주간회의에서 언급할 내용을 미리 적어 두면 놓치지 않습니다
          </p>
        </div>
      )}

      <div className="space-y-2">
        {list.map(r => {
          const d = dday(r.due_date)
          const done = r.status === '완료'
          return (
            <div key={r.id}
              className={`rounded-xl border p-3 ${
                done ? 'border-slate-100 bg-slate-50'
                     : d != null && d < 0 ? 'border-red-200 bg-red-50/30'
                     : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start gap-2.5 flex-wrap">
                <input type="checkbox" checked={done} className="mt-1"
                  onChange={() => patchMut.mutate({
                    id: r.id, patch: { status: done ? '대기' : '완료' },
                  })}
                  title={done ? '되돌리기' : '완료로'} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className={`text-sm font-semibold ${
                      done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {r.title}
                    </span>
                    {r.priority !== '보통' && (
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PR_CLS[r.priority]}`}>
                        {r.priority}
                      </span>
                    )}
                    {r.tag && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                        {r.tag}
                      </span>
                    )}
                  </div>
                  {r.detail && (
                    <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{r.detail}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] flex-wrap">
                    {r.owner && <span className="text-slate-500">{r.owner}</span>}
                    {r.due_date && (
                      <span className={ddayCls(done ? null : d)}>
                        {r.due_date} {!done && ddayText(d)}
                      </span>
                    )}
                    {done && r.done_at && (
                      <span className="text-emerald-600">
                        {String(r.done_at).slice(0, 10)} 완료
                      </span>
                    )}
                  </div>
                </div>

                <select value={r.status}
                  onChange={e => patchMut.mutate({ id: r.id, patch: { status: e.target.value } })}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md border-0 cursor-pointer ${ST_CLS[r.status]}`}>
                  {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => setDraft({ ...r })}
                  className="text-slate-300 hover:text-indigo-500 px-1" title="수정">✎</button>
                <button onClick={() => { if (window.confirm(`"${r.title}" 을 지울까요?`)) delMut.mutate(r.id) }}
                  className="text-slate-300 hover:text-rose-500 px-1" title="삭제">✕</button>
              </div>
            </div>
          )
        })}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setDraft(null)}>
          <div className="bg-white w-full max-w-lg rounded-2xl max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800">
                {draft.id ? '할 일 수정' : '할 일 추가'}
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">내용 *</label>
                <input value={draft.title || ''} autoFocus
                  onChange={e => setDraft(s => ({ ...s, title: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && draft.title?.trim()) saveMut.mutate(draft) }}
                  placeholder="주간회의에서 언급할 내용"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상세</label>
                <textarea value={draft.detail || ''} rows={3}
                  onChange={e => setDraft(s => ({ ...s, detail: e.target.value }))}
                  placeholder="배경·경과 등"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">담당자</label>
                  <input value={draft.owner || ''}
                    onChange={e => setDraft(s => ({ ...s, owner: e.target.value }))}
                    placeholder="김교한"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">기한</label>
                  <input type="date" value={draft.due_date || ''}
                    onChange={e => setDraft(s => ({ ...s, due_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">상태</label>
                  <select value={draft.status || '대기'}
                    onChange={e => setDraft(s => ({ ...s, status: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                    {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">우선순위</label>
                  <select value={draft.priority || '보통'}
                    onChange={e => setDraft(s => ({ ...s, priority: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                    {PRIORITY.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">태그</label>
                  <input value={draft.tag || ''}
                    onChange={e => setDraft(s => ({ ...s, tag: e.target.value }))}
                    placeholder="주간회의 · 개선 · 확인 등"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => saveMut.mutate(draft)} disabled={saveMut.isPending}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                  {saveMut.isPending ? '저장 중…' : '저장'}
                </button>
                <button onClick={() => setDraft(null)}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg border border-slate-300 text-slate-600">
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
