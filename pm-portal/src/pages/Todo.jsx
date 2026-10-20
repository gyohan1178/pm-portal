import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { useMe } from '../hooks/useProfile'
import { todayISO } from '../lib/utils'
import { dday, isOwnedBy, canEditTodo, isNewForMe, groupOf, postponeDate } from '../lib/todoView'
import { useCycleTodo, CycleTodoRow } from '../components/CycleTodo'

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

const todayStr = () => todayISO()
const ddayCls = (n) => n == null ? 'text-slate-300'
  : n < 0 ? 'text-red-600 font-bold' : n <= 3 ? 'text-amber-600 font-semibold' : 'text-slate-500'
const ddayText = (n) => n == null ? '' : n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `D-${n}`

// 급한 순서 묶음
const GROUPS = [
  { key: 'overdue', label: '기한 지남', icon: '🔴', cls: 'bg-red-50 text-red-700 border-red-200' },
  { key: 'soon',    label: '오늘 · 이번 주', icon: '🟡', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'later',   label: '나중 · 기한 없음', icon: '⚪', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  { key: 'done',    label: '최근 완료 (2주)', icon: '✅', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
]

async function fetchTodos() {
  const { data, error } = await supabase.rpc('pm_todo_items')
  if (error) throw error
  // id 가 없으면 뒤이은 수정·삭제가 엉뚱한 곳으로 간다. 미리 걸러 낸다.
  return (data || []).filter(r => r && r.id != null)
}
// 담당자 고르기용 사람 목록. 함수가 없으면(SQL 전) 빈 목록 → 이름을 직접 적는다.
async function fetchPeople() {
  const { data, error } = await supabase.rpc('pm_todo_people')
  if (error) return []
  return (data || []).filter(p => p && p.id && p.name)
}
async function fetchComments(todoId) {
  if (!todoId) return []
  const { data } = await supabase.from('pm_todo_comment')
    .select('*').eq('todo_id', todoId).order('created_at')
  return data || []
}

// 부서 할 일.
//
//   들어오면 「내 일」이 급한 순서로 먼저 보인다 (2026-10-12).
//   사람 칩으로 다른 사람 · 전체를 보고, 내 일은 고치고, 남의 일에는 댓글만 단다.
export default function Todo() {
  const qc = useQueryClient()
  const me = useMe()
  const [who, setWho] = useState('me')        // 'me' | 사람 id | 'all'
  const [agendaOnly, setAgendaOnly] = useState(false)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState(null)
  const [openCmt, setOpenCmt] = useState(null)  // 댓글 펼친 항목
  const [cmtText, setCmtText] = useState('')
  const [detail, setDetail] = useState(null)   // 펼쳐 볼 안건
  const [folded, setFolded] = useState({ later: true, done: true })

  const { data: rows = [], isLoading } = useQuery({ queryKey: ['todos'], queryFn: fetchTodos })
  const { data: people = [] } = useQuery({ queryKey: ['todoPeople'], queryFn: fetchPeople, staleTime: 10 * 60 * 1000 })
  const cmtFor = detail?.id ?? openCmt
  const { data: comments = [] } = useQuery({
    queryKey: ['todoCmt', cmtFor], queryFn: () => fetchComments(cmtFor), enabled: !!cmtFor,
  })
  const nameOf = (id) => people.find(p => p.id === id)?.name || ''
  // 오늘 순환 실사 줄 (v4.78.0) — 할 일 글이 아니라 센 기록으로 계산
  const cyc = useCycleTodo({ who, me, people })

  // 고칠 수 있는지 = 내가 담당이거나 내가 적은 일
  const isMine = (r) => canEditTodo(r, me)
  // 저장 뒤 목록과 사이드바 숫자를 함께 갱신 (사이드바 숫자는 저장 때 자동으로 다시 받지 않는다)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['todos'] })
    qc.invalidateQueries({ queryKey: ['menuAlerts'] })
  }

  const saveMut = useMutation({
    mutationFn: async (rec) => {
      const ownerName = (rec.owner || '').trim()
      // 고른 사람이면 그 사람에게 연결, 직접 적은 이름이면 같은 이름의 사람에게 연결
      const ownerId = rec.owner_id_pick || people.find(p => p.name === ownerName)?.id
        || (ownerName && me && ownerName === me.name ? me.id : null)
      const payload = {
        title: (rec.title || '').trim(), detail: rec.detail || null,
        status: rec.status || '대기', priority: rec.priority || '보통',
        owner: ownerName || null, owner_id: ownerId || null, due_date: rec.due_date || null,
        agenda: !!rec.agenda, tag: rec.tag || null,
      }
      if (!payload.title) throw new Error('내용을 적어 주세요')
      const hasSeen = rows.some(r => 'seen_at' in r)
      if (rec.id != null) {
        // 담당자가 바뀌면 새 담당자에게 「새로 받음」으로 뜨게 한다
        const before = rows.find(r => r.id === rec.id)
        if (hasSeen && before && (before.owner || '') !== (payload.owner || '')) {
          payload.seen_at = payload.owner_id && payload.owner_id === me?.id ? new Date().toISOString() : null
        }
        const { error } = await supabase.from('pm_todo').update(payload).eq('id', rec.id)
        if (error) throw error
      } else {
        if (hasSeen && payload.owner_id && payload.owner_id === me?.id) payload.seen_at = new Date().toISOString()
        // 누가 맡겼는지 남긴다 (「새로 받음 · 이름」 표시에 쓴다)
        if (me?.id) payload.created_by = me.id
        const { error } = await supabase.from('pm_todo').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => { refresh(); setDraft(null) },
    onError: (e) => toastError(e.message),
  })

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }) => {
      // id 가 없으면 엉뚱한 곳을 고치게 된다. 조회가 잘못됐다는 뜻이라 알린다.
      if (id == null) throw new Error('항목을 찾을 수 없습니다 (새로고침 후 다시 시도)')
      const { error } = await supabase.from('pm_todo').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
    onError: (e) => toastError('저장 실패: ' + e.message),
  })

  const delMut = useMutation({
    mutationFn: async (id) => {
      if (id == null) throw new Error('항목을 찾을 수 없습니다 (새로고침 후 다시 시도)')
      const { error } = await supabase.from('pm_todo').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { refresh(); toastSuccess('삭제됨') },
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
      qc.invalidateQueries({ queryKey: ['todoCmt'], exact: false }); qc.invalidateQueries({ queryKey: ['todos'] })
      setCmtText('')
    },
    onError: (e) => toastError('댓글 실패: ' + e.message),
  })

  // 새로 받은 일을 열면 「봤음」으로 — 담당자 본인이 열 때만
  function openDetail(r) {
    setDetail(r)
    if (isNewForMe(r, me)) patchMut.mutate({ id: r.id, patch: { seen_at: new Date().toISOString() } })
  }

  // 창이 열려 있을 때 Esc·뒤로가기로 닫히면 쓰던 내용이 날아간다.
  //   Esc 는 확인을 거치게 하고, 뒤로가기는 창만 닫는다.
  useEffect(() => {
    if (!draft && !detail) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); draft ? closeDraft() : setDetail(null) }
    }
    const onPop = (e) => { e.preventDefault?.(); draft ? closeDraft() : setDetail(null) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
  }, [draft, detail])

  // 적어 둔 것이 있으면 묻고 닫는다.
  //   배경을 잘못 눌러 쓰던 내용이 사라진 적이 있다.
  function closeDraft() {
    const dirty = (draft?.title || '').trim() || (draft?.detail || '').trim()
    if (dirty && !window.confirm('적은 내용이 사라집니다. 닫을까요?')) return
    setDraft(null)
  }

  // 사람 칩 — 남은 일 · 기한 지남 건수
  const chips = useMemo(() => {
    const open = rows.filter(r => r.status !== '완료')
    const cnt = (person) => {
      const mine = open.filter(r => isOwnedBy(r, person))
      const cy = person?.name && cyc.pendingNames.has(person.name) ? 1 : 0   // 오늘 실사 안 끝남
      return { open: mine.length + cy, over: mine.filter(r => groupOf(r) === 'overdue').length }
    }
    const list = [{ key: 'me', label: '나', ...cnt(me) }]
    people.filter(p => p.id !== me?.id).forEach(p => {
      const c = cnt(p)
      if (c.open > 0) list.push({ key: p.id, label: p.name, ...c })
    })
    // 사람 목록이 없으면(SQL 전) 적힌 담당자 이름으로 칩을 만든다
    if (!people.length) {
      ;[...new Set(open.map(r => (r.owner || '').trim()).filter(Boolean))]
        .filter(n => !me || !isOwnedBy({ owner: n }, me))
        .forEach(n => list.push({ key: 'name:' + n, label: n, ...cnt({ name: n }) }))
    }
    list.push({ key: 'all', label: '전체', open: open.length + cyc.pendingNames.size, over: open.filter(r => groupOf(r) === 'overdue').length })
    return list
  }, [rows, people, me, cyc.pendingNames])

  const whoPerson = who === 'me' ? me
    : who === 'all' ? null
    : who.startsWith('name:') ? { name: who.slice(5) }
    : people.find(p => p.id === who) || null

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const twoWeeks = new Date(Date.now() - 14 * 86400000).toISOString()
    return rows.filter(r => {
      if (who !== 'all' && !isOwnedBy(r, whoPerson)) return false
      if (agendaOnly && !r.agenda) return false
      // 완료는 최근 2주만 (검색하면 전부)
      if (r.status === '완료' && !kw && !(r.done_at && r.done_at >= twoWeeks)) return false
      if (!kw) return true
      return [r.title, r.detail, r.owner, r.tag]
        .some(v => String(v || '').toLowerCase().includes(kw))
    })
  }, [rows, who, whoPerson, agendaOnly, q])

  const grouped = useMemo(() => {
    const g = { overdue: [], soon: [], later: [], done: [] }
    list.forEach(r => g[groupOf(r)].push(r))
    // 새로 받은 일은 묶음 안에서 맨 위로
    Object.values(g).forEach(a => a.sort((x, y) => (isNewForMe(y, me) ? 1 : 0) - (isNewForMe(x, me) ? 1 : 0)))
    return g
  }, [list, me])

  const newCnt = list.filter(r => isNewForMe(r, me)).length
  // 검색 · 주간회의 안건만 볼 때는 실사 줄을 숨긴다
  const cycShown = q.trim() || agendaOnly ? [] : cyc.items

  function postpone(r, kind) {
    patchMut.mutate({ id: r.id, patch: { due_date: postponeDate(kind) } })
  }

  const renderRow = (r) => {
    const d = dday(r.due_date)
    const done = r.status === '완료'
    const mine = isMine(r)
    const isNew = isNewForMe(r, me)
    const cmtOpen = openCmt === r.id
    return (
      <div key={r.id} data-todo-row={r.id} className={`border-t border-slate-100 px-3 py-2.5 ${isNew ? 'bg-indigo-50/40' : ''}`}>
        <div className="flex items-center gap-2.5 flex-wrap">
          <input type="checkbox" checked={done} className="w-4 h-4"
            onChange={() => patchMut.mutate({ id: r.id, patch: { status: done ? '대기' : '완료' } })}
            title={done ? '되돌리기' : '완료로'} />
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <button onClick={() => openDetail(r)}
                className={`text-sm font-semibold text-left hover:underline ${
                  done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {r.title}
              </button>
              {isNew && (
                <span data-todo-new className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                  새로 받음{nameOf(r.created_by) ? ` · ${nameOf(r.created_by)}` : ''}
                </span>
              )}
              {r.agenda && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold">주간회의</span>
              )}
              {r.priority !== '보통' && (
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PR_CLS[r.priority]}`}>{r.priority}</span>
              )}
              {r.tag && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">{r.tag}</span>
              )}
            </div>
            <div className="flex items-center gap-2.5 mt-1 text-[11px] flex-wrap">
              {who !== 'me' && r.owner && <span className="text-slate-500">{r.owner}</span>}
              {r.due_date && (
                <span className={ddayCls(done ? null : d)}>{r.due_date.slice(5)} {!done && ddayText(d)}</span>
              )}
              {done && r.done_at && <span className="text-emerald-600">{String(r.done_at).slice(5, 10)} 완료</span>}
              <button onClick={() => { setOpenCmt(cmtOpen ? null : r.id); setCmtText('') }}
                className={`${r.comment_cnt > 0 ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                💬 {r.comment_cnt > 0 ? r.comment_cnt : '댓글'}
              </button>
            </div>
          </div>
          {/* 기한 바로 미루기 — 내 일만 */}
          {mine && !done && (
            <div className="flex gap-1">
              <button data-todo-postpone="tomorrow" onClick={() => postpone(r, 'tomorrow')}
                className="px-2 py-1 text-[11px] rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">내일로</button>
              <button data-todo-postpone="nextweek" onClick={() => postpone(r, 'nextweek')}
                className="px-2 py-1 text-[11px] rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">다음 주</button>
            </div>
          )}
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
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5 ml-6">
            {comments.map(c => (
              <div key={c.id} className="flex items-baseline gap-2 text-xs">
                <span className="font-semibold text-slate-600 flex-shrink-0">{c.author || '—'}</span>
                <span className="text-slate-600 flex-1">{c.body}</span>
                <span className="text-[10px] text-slate-300 flex-shrink-0">{String(c.created_at).slice(5, 10)}</span>
              </div>
            ))}
            {!comments.length && <p className="text-[11px] text-slate-400">아직 댓글이 없습니다</p>}
            <div className="flex gap-1.5 pt-1">
              <input value={cmtText} onChange={e => setCmtText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && cmtText.trim()) cmtMut.mutate({ todoId: r.id, body: cmtText }) }}
                placeholder="의견을 남기세요"
                className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <button onClick={() => cmtText.trim() && cmtMut.mutate({ todoId: r.id, body: cmtText })}
                disabled={!cmtText.trim() || cmtMut.isPending}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">등록</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const newDraft = () => setDraft({ status: '대기', priority: '보통', owner: me?.name || '', owner_id_pick: me?.id || '', due_date: '' })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📋 할 일</h1>
          <p className="page-desc text-xs text-slate-400">내 일이 급한 순서로 먼저 보입니다 · 사람을 누르면 그 사람 일만</p>
        </div>
        <button onClick={newDraft}
          className="ml-auto px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">
          + 추가
        </button>
      </div>

      {/* 사람 칩 — 들어오면 「나」 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map(c => (
          <button key={c.key} data-todo-who={c.key} onClick={() => setWho(c.key)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${
              who === c.key ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {c.label} <span className="font-normal">{c.open}</span>
            {c.over > 0 && <span className="ml-1 text-red-600">· 지남 {c.over}</span>}
          </button>
        ))}
        <button onClick={() => setAgendaOnly(v => !v)}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${
            agendaOnly ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>
          주간회의 안건만
        </button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="내용·담당자 검색"
          className="flex-1 min-w-[140px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg" />
        {q && <button onClick={() => setQ('')} className="text-xs text-slate-400 px-1">초기화</button>}
      </div>

      {who === 'me' && newCnt > 0 && (
        <p data-todo-newbanner className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
          🆕 새로 맡은 일이 {newCnt}건 있습니다 — 눌러서 열어 보면 표시가 사라집니다
        </p>
      )}

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !list.length && !cycShown.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500 font-semibold">
            {q ? '찾는 항목이 없습니다' : who === 'me' ? '남은 내 일이 없습니다' : '적어 둔 일이 없습니다'}
          </p>
          <p className="text-xs text-slate-400 mt-1">회의에서 언급할 내용을 미리 적어 두면 놓치지 않습니다</p>
        </div>
      )}

      {!isLoading && (list.length > 0 || cycShown.length > 0) && (
        <div className="space-y-3">
          {GROUPS.map(gr => {
            const items = grouped[gr.key]
            const cy = cycShown.filter(c => (gr.key === 'done') === c.complete && (gr.key === 'soon' || gr.key === 'done'))
            if (!items.length && !cy.length) return null
            const isFolded = !q && folded[gr.key]
            return (
              <div key={gr.key} data-todo-group={gr.key} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button onClick={() => setFolded(f => ({ ...f, [gr.key]: !f[gr.key] }))}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold border-b ${gr.cls}`}>
                  <span>{gr.icon}</span>{gr.label} <span>{items.length + cy.length}</span>
                  <span className="ml-auto font-normal">{isFolded ? '펼치기 ▾' : '접기 ▴'}</span>
                </button>
                {!isFolded && cy.map(c => <CycleTodoRow key={c.key} it={c} cyc={cyc} showName={who === 'all'} />)}
                {!isFolded && items.map(renderRow)}
              </div>
            )
          })}
        </div>
      )}

      {/* 안건 상세 — 회의에서 하나를 펼쳐 놓고 이야기할 때 쓴다 */}
      {detail && (() => {
        const r = rows.find(x => x.id === detail.id) || detail
        const d = dday(r.due_date)
        const done = r.status === '완료'
        const mine = isMine(r)
        return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setDetail(null) }}>
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
          onClick={() => closeDraft()}>
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
                  {/* 이름을 직접 치면 오타 · 직함 차이로 그 사람 화면에 안 떴다 → 포털 사용자 중에서 고른다 */}
                  {people.length ? (
                    <select data-todo-owner value={draft.owner_id_pick || people.find(p => p.name === (draft.owner || '').trim())?.id || (draft.owner?.trim() ? '__old' : '')}
                      onChange={e => {
                        const p = people.find(x => x.id === e.target.value)
                        setDraft(s => ({ ...s, owner_id_pick: p?.id || '', owner: p?.name || '' }))
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                      <option value="">(담당 없음)</option>
                      {draft.owner && !people.some(p => p.name === draft.owner.trim()) && (
                        <option value="__old" disabled>{draft.owner} (예전에 적은 이름 — 다시 골라 주세요)</option>
                      )}
                      {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === me?.id ? ' (나)' : ''}</option>)}
                    </select>
                  ) : (
                    <input value={draft.owner || ''}
                      onChange={e => setDraft(s => ({ ...s, owner: e.target.value }))}
                      placeholder={me?.name || '이름'}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  )}
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
                <button onClick={() => closeDraft()}
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
