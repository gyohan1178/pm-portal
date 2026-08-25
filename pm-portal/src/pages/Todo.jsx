import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { useMe } from '../hooks/useProfile'

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

const todayStr = () => new Date().toISOString().split('T')[0]
const dday = (d) => (d ? Math.round((new Date(d) - new Date(todayStr())) / 86400000) : null)
const ddayCls = (n) => n == null ? 'text-slate-300'
  : n < 0 ? 'text-red-600 font-bold' : n <= 3 ? 'text-amber-600 font-semibold' : 'text-slate-500'
const ddayText = (n) => n == null ? '' : n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `D-${n}`

async function fetchTodos() {
  const { data, error } = await supabase.rpc('pm_todo_items')
  if (error) throw error
  // id 가 없으면 뒤이은 수정·삭제가 엉뚱한 곳으로 간다. 미리 걸러 낸다.
  return (data || []).filter(r => r && r.id != null)
}
async function fetchComments(todoId) {
  if (!todoId) return []
  const { data } = await supabase.from('pm_todo_comment')
    .select('*').eq('todo_id', todoId).order('created_at')
  return data || []
}

// 부서 할 일.
//
//   주간회의에서 다룰 내용을 포털에 바로 적는다.
//   내 일은 고치고, 남의 일에는 댓글만 단다.
export default function Todo() {
  const qc = useQueryClient()
  const me = useMe()
  const [view, setView] = useState('open')      // open | mine | agenda | all
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState(null)
  const [openCmt, setOpenCmt] = useState(null)  // 댓글 펼친 항목
  const [cmtText, setCmtText] = useState('')
  const [ym, setYm] = useState(() => todayStr().slice(0, 7))
  const [detail, setDetail] = useState(null)   // 펼쳐 볼 안건

  const { data: rows = [], isLoading } = useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  const cmtFor = detail?.id ?? openCmt
  const { data: comments = [] } = useQuery({
    queryKey: ['todoCmt', cmtFor], queryFn: () => fetchComments(cmtFor), enabled: !!cmtFor,
  })

  // 담당자·작성자가 나인지. 값이 비면 남의 것으로 본다.
  const isMine = (r) => !!me && !!(r.owner_id === me.id || r.created_by === me.id
    || (r.owner && me.name && r.owner === me.name))

  const saveMut = useMutation({
    mutationFn: async (rec) => {
      const payload = {
        title: (rec.title || '').trim(), detail: rec.detail || null,
        status: rec.status || '대기', priority: rec.priority || '보통',
        owner: rec.owner || null, due_date: rec.due_date || null,
        agenda: !!rec.agenda, tag: rec.tag || null,
      }
      if (!payload.title) throw new Error('내용을 적어 주세요')
      if (rec.id != null) {
        const { error } = await supabase.from('pm_todo').update(payload).eq('id', rec.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pm_todo')
          .insert({ ...payload, owner_id: rec.owner === me?.name ? me?.id : null })
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries(['todos']); setDraft(null) },
    onError: (e) => toastError(e.message),
  })

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }) => {
      // id 가 없으면 엉뚱한 곳을 고치게 된다. 조회가 잘못됐다는 뜻이라 알린다.
      if (id == null) throw new Error('항목을 찾을 수 없습니다 (새로고침 후 다시 시도)')
      const { error } = await supabase.from('pm_todo').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['todos']),
    onError: (e) => toastError('저장 실패: ' + e.message),
  })

  const delMut = useMutation({
    mutationFn: async (id) => {
      if (id == null) throw new Error('항목을 찾을 수 없습니다 (새로고침 후 다시 시도)')
      const { error } = await supabase.from('pm_todo').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['todos']); toastSuccess('삭제됨') },
    onError: (e) => toastError('삭제 실패: ' + e.message),
  })

  const cmtMut = useMutation({
    mutationFn: async ({ todoId, body }) => {
      if (todoId == null) throw new Error('항목을 찾을 수 없습니다')
      const { error } = await supabase.from('pm_todo_comment')
        .insert({ todo_id: todoId, body: body.trim(), author: me?.name || null })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todoCmt'], exact: false }); qc.invalidateQueries(['todos'])
      setCmtText('')
    },
    onError: (e) => toastError('댓글 실패: ' + e.message),
  })

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return rows.filter(r => {
      if (view === 'open' && r.status === '완료') return false
      if (view === 'mine' && !isMine(r)) return false
      if (view === 'agenda' && !r.agenda) return false
      if (!kw) return true
      return [r.title, r.detail, r.owner, r.tag]
        .some(v => String(v || '').toLowerCase().includes(kw))
    })
  }, [rows, view, q, me])

  const open = rows.filter(r => r.status !== '완료')
  const overdue = open.filter(r => r.due_date && dday(r.due_date) < 0)
  const agendaCnt = open.filter(r => r.agenda).length
  const thisWeek = open.filter(r => { const d = dday(r.due_date); return d != null && d >= 0 && d <= 7 })

  // 달력 — 기한이 있는 일을 날짜에 흩뿌린다
  const cal = useMemo(() => {
    const [y, m] = ym.split('-').map(Number)
    const first = new Date(y, m - 1, 1)
    const start = new Date(first); start.setDate(1 - first.getDay())
    const byDate = {}
    rows.forEach(r => { if (r.due_date) (byDate[r.due_date] ||= []).push(r) })
    const cells = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      cells.push({ iso, day: d.getDate(), cur: d.getMonth() === m - 1, items: byDate[iso] || [] })
      if (i >= 34 && d.getMonth() !== m - 1) break
    }
    return cells
  }, [ym, rows])

  const shiftMonth = (n) => {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📋 할 일</h1>
          <p className="text-xs text-slate-400">부서 업무와 주간회의 안건</p>
        </div>
        <button onClick={() => setDraft({ status: '대기', priority: '보통', owner: me?.name || '', due_date: '' })}
          className="ml-auto px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">
          + 추가
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">남은 일</p>
          <p className="text-xl font-bold text-slate-900">{open.length}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">기한 지남</p>
          <p className="text-xl font-bold text-red-600">{overdue.length}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">이번 주</p>
          <p className="text-xl font-bold text-amber-700">{thisWeek.length}</p>
        </div>
        <button onClick={() => setView('agenda')}
          className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-left hover:shadow-sm">
          <p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">주간회의 안건</p>
          <p className="text-xl font-bold text-indigo-700">{agendaCnt}</p>
        </button>
      </div>

      {/* 달력 — 기한이 눈에 들어와야 회의에서 짚기 쉽다 */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-sm font-bold text-slate-800">
            {ym.split('-')[0]}년 {Number(ym.split('-')[1])}월
          </span>
          <button onClick={() => shiftMonth(-1)} className="px-2 py-0.5 text-xs border border-slate-200 rounded">←</button>
          <button onClick={() => setYm(todayStr().slice(0, 7))} className="px-2 py-0.5 text-xs border border-slate-200 rounded">오늘</button>
          <button onClick={() => shiftMonth(1)} className="px-2 py-0.5 text-xs border border-slate-200 rounded">→</button>
          <div className="ml-auto flex gap-2 text-[10px] text-slate-400">
            <span>🔴 지남</span><span>🟡 예정</span><span>🟢 완료</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <div key={d} className={`text-[10px] text-center py-0.5 ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-indigo-400' : 'text-slate-400'}`}>{d}</div>
          ))}
          {cal.map(c => {
            const isToday = c.iso === todayStr()
            return (
              <div key={c.iso}
                className={`min-h-[46px] rounded-md p-1 ${
                  !c.cur ? 'opacity-30' : ''} ${isToday ? 'ring-1 ring-indigo-400' : ''}`}>
                <span className={`text-[10px] ${isToday ? 'font-bold text-indigo-600' : 'text-slate-500'}`}>{c.day}</span>
                {c.items.slice(0, 2).map(it => {
                  const d = dday(it.due_date)
                  const done = it.status === '완료'
                  const cls = done ? 'bg-emerald-50 text-emerald-700'
                    : d < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                  return (
                    <p key={it.id} title={`${it.title}${it.owner ? ` · ${it.owner}` : ''}`}
                      onClick={() => { setQ(it.title); setView('all') }}
                      className={`text-[9px] leading-tight mt-0.5 px-1 rounded truncate cursor-pointer ${cls}`}>
                      {it.title}
                    </p>
                  )
                })}
                {c.items.length > 2 && (
                  <p className="text-[9px] text-slate-400 mt-0.5">+{c.items.length - 2}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['open', '남은 것'], ['mine', '내 것'], ['agenda', '주간회의'], ['all', '전부']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${
                view === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="내용·담당자 검색"
          className="flex-1 min-w-[140px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg" />
        {q && <button onClick={() => setQ('')} className="text-xs text-slate-400 px-1">초기화</button>}
        <span className="text-xs text-slate-400">{list.length}건</span>
      </div>

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !list.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500 font-semibold">
            {q ? '찾는 항목이 없습니다' : view === 'agenda' ? '주간회의 안건이 없습니다' : '적어 둔 일이 없습니다'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            회의에서 언급할 내용을 미리 적어 두면 놓치지 않습니다
          </p>
        </div>
      )}

      <div className="space-y-2">
        {list.map(r => {
          const d = dday(r.due_date)
          const done = r.status === '완료'
          const mine = isMine(r)
          const cmtOpen = openCmt === r.id
          return (
            <div key={r.id}
              className={`rounded-xl border p-3 ${
                done ? 'border-slate-100 bg-slate-50'
                     : d != null && d < 0 ? 'border-red-200 bg-red-50/30'
                     : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start gap-2.5 flex-wrap">
                <input type="checkbox" checked={done} className="mt-1"
                  onChange={() => patchMut.mutate({ id: r.id, patch: { status: done ? '대기' : '완료' } })}
                  title={done ? '되돌리기' : '완료로'} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <button onClick={() => setDetail(r)}
                      className={`text-sm font-semibold text-left hover:underline ${
                        done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {r.title}
                    </button>
                    {r.agenda && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold">주간회의</span>
                    )}
                    {r.priority !== '보통' && (
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PR_CLS[r.priority]}`}>
                        {r.priority}
                      </span>
                    )}
                    {r.tag && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">{r.tag}</span>
                    )}
                  </div>
                  {r.detail && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{r.detail}</p>}
                  <div className="flex items-center gap-2.5 mt-1.5 text-[11px] flex-wrap">
                    {r.owner && <span className="text-slate-500">{r.owner}</span>}
                    {r.due_date && (
                      <span className={ddayCls(done ? null : d)}>
                        {r.due_date} {!done && ddayText(d)}
                      </span>
                    )}
                    {done && r.done_at && (
                      <span className="text-emerald-600">{String(r.done_at).slice(0, 10)} 완료</span>
                    )}
                    <button onClick={() => { setOpenCmt(cmtOpen ? null : r.id); setCmtText('') }}
                      className={`${r.comment_cnt > 0 ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                      💬 {r.comment_cnt > 0 ? r.comment_cnt : '댓글'}
                    </button>
                  </div>
                </div>

                <select value={r.status}
                  onChange={e => patchMut.mutate({ id: r.id, patch: { status: e.target.value } })}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md border-0 cursor-pointer ${ST_CLS[r.status]}`}>
                  {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {/* 남의 일은 고치지 않는다. 의견은 댓글로 남긴다. */}
                {mine ? (
                  <>
                    <button onClick={() => setDraft({ ...r })}
                      className="text-slate-300 hover:text-indigo-500 px-1" title="수정">✎</button>
                    <button onClick={() => { if (window.confirm(`"${r.title}" 을 지울까요?`)) delMut.mutate(r.id) }}
                      className="text-slate-300 hover:text-rose-500 px-1" title="삭제">✕</button>
                  </>
                ) : (
                  <span className="text-[10px] text-slate-300 px-1" title="다른 사람의 일입니다">🔒</span>
                )}
              </div>

              {cmtOpen && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5">
                  {comments.map(c => (
                    <div key={c.id} className="flex items-baseline gap-2 text-xs">
                      <span className="font-semibold text-slate-600 flex-shrink-0">{c.author || '—'}</span>
                      <span className="text-slate-600 flex-1">{c.body}</span>
                      <span className="text-[10px] text-slate-300 flex-shrink-0">
                        {String(c.created_at).slice(5, 10)}
                      </span>
                    </div>
                  ))}
                  {!comments.length && <p className="text-[11px] text-slate-400">아직 댓글이 없습니다</p>}
                  <div className="flex gap-1.5 pt-1">
                    <input value={cmtText} onChange={e => setCmtText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && cmtText.trim()) cmtMut.mutate({ todoId: r.id, body: cmtText })
                      }}
                      placeholder="의견을 남기세요"
                      className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    <button onClick={() => cmtText.trim() && cmtMut.mutate({ todoId: r.id, body: cmtText })}
                      disabled={!cmtText.trim() || cmtMut.isPending}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                      등록
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 안건 상세 — 회의에서 하나를 펼쳐 놓고 이야기할 때 쓴다 */}
      {detail && (() => {
        const r = rows.find(x => x.id === detail.id) || detail
        const d = dday(r.due_date)
        const done = r.status === '완료'
        const mine = isMine(r)
        return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-2xl rounded-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className={`px-2 py-1 text-[11px] font-bold rounded-md ${ST_CLS[r.status]}`}>{r.status}</span>
              {r.agenda && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold">주간회의</span>
              )}
              {mine && (
                <button onClick={() => { setDraft({ ...r }); setDetail(null) }}
                  className="ml-auto text-xs font-semibold text-slate-500 px-2 py-1 border border-slate-200 rounded-lg">
                  ✎ 수정
                </button>
              )}
              <button onClick={() => setDetail(null)}
                className={`text-slate-400 text-xl px-2 ${mine ? '' : 'ml-auto'}`}>✕</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <h2 className={`text-xl font-bold ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {r.title}
                </h2>
                <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
                  {r.owner && <span className="text-slate-500">담당 <b className="text-slate-700">{r.owner}</b></span>}
                  {r.due_date && (
                    <span className={ddayCls(done ? null : d)}>
                      기한 {r.due_date} {!done && ddayText(d)}
                    </span>
                  )}
                  {r.priority !== '보통' && (
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PR_CLS[r.priority]}`}>
                      {r.priority}
                    </span>
                  )}
                  {r.tag && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">{r.tag}</span>
                  )}
                  {done && r.done_at && (
                    <span className="text-emerald-600">{String(r.done_at).slice(0, 10)} 완료</span>
                  )}
                </div>
              </div>

              {/* 내용 — 길게 적을 수 있게 그 자리에서 고친다 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">내용</label>
                {mine ? (
                  <textarea defaultValue={r.detail || ''} rows={10}
                    onBlur={e => {
                      const v = e.target.value
                      if (v !== (r.detail || '')) patchMut.mutate({ id: r.id, patch: { detail: v || null } })
                    }}
                    placeholder="배경·경과·결정 사항을 적어 두면 회의에서 바로 꺼내 쓸 수 있습니다"
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg leading-relaxed" />
                ) : (
                  <div className="px-3 py-2.5 text-sm border border-slate-100 bg-slate-50 rounded-lg whitespace-pre-wrap leading-relaxed min-h-[80px] text-slate-600">
                    {r.detail || <span className="text-slate-300">적힌 내용이 없습니다</span>}
                  </div>
                )}
                {mine && <p className="text-[11px] text-slate-400 mt-1">칸 밖을 누르면 저장됩니다</p>}
              </div>

              {/* 댓글 */}
              <div className="pt-1">
                <label className="block text-xs font-bold text-slate-500 mb-2">
                  댓글 {comments.length > 0 && <span className="text-indigo-600">{comments.length}</span>}
                </label>
                <div className="space-y-2 mb-2">
                  {comments.map(c => (
                    <div key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-bold text-slate-700">{c.author || '—'}</span>
                        <span className="text-[10px] text-slate-400">
                          {String(c.created_at).slice(5, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                  {!comments.length && (
                    <p className="text-xs text-slate-400">아직 댓글이 없습니다</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <input value={cmtText} onChange={e => setCmtText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && cmtText.trim()) cmtMut.mutate({ todoId: r.id, body: cmtText })
                    }}
                    placeholder="의견을 남기세요"
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  <button onClick={() => cmtText.trim() && cmtMut.mutate({ todoId: r.id, body: cmtText })}
                    disabled={!cmtText.trim() || cmtMut.isPending}
                    className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                    등록
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
              <select value={r.status}
                onChange={e => patchMut.mutate({ id: r.id, patch: { status: e.target.value } })}
                className={`px-2.5 py-1.5 text-xs font-bold rounded-md border-0 cursor-pointer ${ST_CLS[r.status]}`}>
                {STATUS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={!!r.agenda}
                  onChange={e => patchMut.mutate({ id: r.id, patch: { agenda: e.target.checked } })} />
                주간회의 안건
              </label>
              {mine && (
                <button onClick={() => {
                    if (window.confirm(`"${r.title}" 을 지울까요?`)) { delMut.mutate(r.id); setDetail(null) }
                  }}
                  className="ml-auto text-xs text-slate-400 hover:text-rose-500 px-2">삭제</button>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {draft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setDraft(null)}>
          <div className="bg-white w-full max-w-lg rounded-2xl max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800">{draft.id ? '할 일 수정' : '할 일 추가'}</h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">내용 *</label>
                <input value={draft.title || ''} autoFocus
                  onChange={e => setDraft(s => ({ ...s, title: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && draft.title?.trim()) saveMut.mutate(draft) }}
                  placeholder="회의에서 언급할 내용"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상세</label>
                <textarea value={draft.detail || ''} rows={3}
                  onChange={e => setDraft(s => ({ ...s, detail: e.target.value }))}
                  placeholder="배경·경과 등"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={!!draft.agenda}
                  onChange={e => setDraft(s => ({ ...s, agenda: e.target.checked }))} />
                주간회의 안건 <span className="font-normal text-slate-400 text-xs">(회의에서 다룰 것)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">담당자</label>
                  <input value={draft.owner || ''}
                    onChange={e => setDraft(s => ({ ...s, owner: e.target.value }))}
                    placeholder={me?.name || '이름'}
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
                    placeholder="개선 · 확인 등"
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
