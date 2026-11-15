// 할 일 — 일정 조각들 (v4.197.0): 오늘 줄 · 달력 · 추가 창의 범위/일정 칸 · 범위 표시
//   계산은 lib/todoSched.js. 여기는 그리기만 한다
import { useState } from 'react'
import { DEPTS } from '../hooks/useProfile'
import {
  SCOPES, REPEATS, REPEAT_LABEL, isNote, scopeOf, itemsOn, chipText, roomClash, timeText,
  monthGrid, weekGrid, shiftMonth, addDays, reqInbox, isOff,
} from '../lib/todoSched'

// 종류별 색 — 전사 공유 파랑 · 요청 검정 · 부서 특이사항 노랑 · 반복 보라 · 지남 빨강 · 끝남 회색 · 할 일 흰색
const CHIP = {
  all: 'bg-blue-50 text-blue-700 border-blue-200',
  req: 'bg-slate-800 text-white border-slate-800',
  note: 'bg-amber-50 text-amber-800 border-amber-200',
  rep: 'bg-violet-50 text-violet-700 border-violet-200',
  late: 'bg-red-50 text-red-700 border-red-200',
  done: 'bg-slate-50 text-slate-400 border-slate-200 line-through',
  todo: 'bg-white text-slate-700 border-slate-300',
}
const LEGEND = [['all', '전사 공유'], ['req', '유관부서 요청'], ['note', '부서 특이사항'], ['todo', '할 일'], ['rep', '반복']]
const WD = ['월', '화', '수', '목', '금', '토', '일']
const md = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}`

// 줄 옆 작은 표시 — 누가 보는 줄인지
export function ScopeBadge({ r, myDept }) {
  const s = scopeOf(r)
  if (s === 'all') return <span data-todo-scope="all" className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">전사 공유{r.room ? ' · 대회의실' : ''}</span>
  if (s === 'req') {
    const got = r.to_dept === myDept
    return <span data-todo-scope="req" className="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-bold">{got ? `요청 받음 · ${r.dept || ''}` : `요청 보냄 → ${r.to_dept || ''}`}</span>
  }
  return null
}

// 맨 위 한 줄 — 오늘 부서 특이사항 · 전사 공유 · 받은 요청 수
export function SchedStrip({ rows, today, myDept, onOpen }) {
  const it = itemsOn(rows, today, today)
  const notes = it.filter((x) => x.kind === 'note'), alls = it.filter((x) => x.kind === 'all')
  const inbox = reqInbox(rows, myDept)
  if (!notes.length && !alls.length && !inbox.length) return null
  const part = (label, list, cls) => list.length > 0 && (
    <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
      <b className={`text-xs whitespace-nowrap ${cls}`}>{label} {list.length}</b>
      {list.slice(0, 2).map(({ r }) => (
        <button key={r.id} type="button" onClick={() => onOpen(r)} className="text-sm font-bold text-slate-800 text-left hover:underline">
          {r.room ? `대회의실 ${timeText(r)} · ${r.dept || ''}` : r.title}
        </button>
      ))}
      {list.length > 2 && <span className="text-xs text-slate-500">외 {list.length - 2}</span>}
    </span>
  )
  return (
    <div data-sched-strip className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-x-4 gap-y-1.5 flex-wrap">
      {part('오늘 부서 특이사항', notes, 'text-amber-800')}
      {part('전사 공유', alls, 'text-blue-700')}
      {inbox.length > 0 && <span data-sched-inbox className="ml-auto px-2 py-0.5 rounded-full border border-slate-800 bg-white text-xs font-bold text-slate-800 whitespace-nowrap">요청 받음 {inbox.length}</span>}
    </div>
  )
}

// 달력 (PC) — 월 · 주. 칸을 누르면 그 날짜로 추가, 줄을 누르면 열어 본다
//   cycOn: 날짜 → 「실사 3/5」 같은 글 (구매자재만 · 없으면 안 그린다)
export function SchedCalendar({ rows, today, myDept, onOpen, onAdd, cycOn }) {
  const [mode, setMode] = useState('month')
  const [ym, setYm] = useState(today.slice(0, 7))
  const [wk, setWk] = useState(today)
  const cells = mode === 'month' ? monthGrid(ym) : weekGrid(wk)
  const max = mode === 'month' ? 3 : 12
  const move = (n) => (mode === 'month' ? setYm(shiftMonth(ym, n)) : setWk(addDays(wk, 7 * n)))
  const title = mode === 'month' ? `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월` : `${md(cells[0].ymd)} ~ ${md(cells[6].ymd)}`
  return (
    <div data-sched-cal className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" aria-label="이전" onClick={() => move(-1)} data-cal-prev className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600">‹</button>
        <b data-cal-title className="text-sm text-slate-800 min-w-[104px] text-center">{title}</b>
        <button type="button" aria-label="다음" onClick={() => move(1)} data-cal-next className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600">›</button>
        <button type="button" onClick={() => { setYm(today.slice(0, 7)); setWk(today) }} className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600">오늘</button>
        <span className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-xs font-bold">
          {[['month', '월'], ['week', '주']].map(([k, l]) => (
            <button key={k} type="button" data-cal-mode={k} onClick={() => setMode(k)} className={`h-7 px-3 rounded-md ${mode === k ? 'bg-white text-slate-900' : 'text-slate-500'}`}>{l}</button>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-3 flex-wrap">
          {LEGEND.map(([k, l]) => (
            <span key={k} className="flex items-center gap-1 text-[11px] text-slate-600"><i className={`w-2.5 h-2.5 rounded-sm border ${CHIP[k]}`} />{l}</span>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[11px] font-bold text-slate-500">{WD.map((w) => <span key={w} className="px-1.5">{w}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ ymd, inMonth }) => {
          const it = itemsOn(rows, ymd, today), isToday = ymd === today, cy = cycOn?.(ymd)
          return (
            <div key={ymd} data-cal-day={ymd} className={`rounded-lg border p-1 flex flex-col gap-0.5 overflow-hidden ${mode === 'month' ? 'h-[88px]' : 'min-h-[260px]'} ${isToday ? 'border-2 border-indigo-500 bg-white' : inMonth ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-100'}`}>
              <button type="button" onClick={() => onAdd(ymd)} title="이 날짜로 추가" data-cal-add={ymd}
                className={`text-left text-[11px] leading-4 font-bold hover:text-indigo-600 ${isToday ? 'text-indigo-700' : !inMonth || isOff(ymd) ? 'text-slate-400' : 'text-slate-700'}`}>
                {Number(ymd.slice(8)) === 1 ? md(ymd) : Number(ymd.slice(8))}{isToday ? ' · 오늘' : ''}
              </button>
              {it.slice(0, max).map(({ r, kind }) => (
                <button key={r.id} type="button" onClick={() => onOpen(r)} data-cal-item={kind} title={r.title}
                  className={`h-[18px] shrink-0 rounded border px-1 text-left text-[10.5px] font-bold leading-4 truncate ${CHIP[kind]}`}>{chipText(r, myDept)}</button>
              ))}
              {it.length > max && <span className="text-[10px] text-slate-500 px-1">외 {it.length - max}건</span>}
              {cy && it.length < max && <span data-cal-cyc className="h-[18px] shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1 text-[10.5px] font-bold leading-4 text-emerald-700 truncate">{cy}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 추가 · 수정 창 맨 위 — 누가 보나 · 종류 · 받는 부서 · 대회의실 · 반복
//   mine: 내 부서. clash: 같은 시간 대회의실 일정 (경고만 — 저장은 된다)
export function SchedFields({ draft, setDraft, rows, myDept }) {
  const s = draft.scope || 'dept', note = draft.kind === 'note'
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const clash = roomClash(rows, draft)
  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white'
  return (
    <div data-sched-fields className="space-y-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1">누가 보나요</label>
        <div className="grid grid-cols-3 gap-1.5">
          {SCOPES.map((o) => (
            <button key={o.key} type="button" data-scope={o.key}
              onClick={() => set({ scope: o.key, ...(o.key === 'req' ? { kind: 'todo', room: false } : {}), ...(o.key !== 'all' ? { room: false } : {}), ...(o.key !== 'req' ? { to_dept: '' } : {}) })}
              className={`rounded-lg border px-2 py-1.5 text-left ${s === o.key ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white'}`}>
              <span className={`block text-xs font-bold ${s === o.key ? 'text-indigo-700' : 'text-slate-700'}`}>{o.label}</span>
              <span className="block text-[10.5px] text-slate-500">{o.key === 'dept' ? `${myDept}만 (기본)` : o.note}</span>
            </button>
          ))}
        </div>
      </div>
      {s === 'req' ? (
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">받는 부서 *</label>
          <select data-sched-todept value={draft.to_dept || ''} onChange={(e) => set({ to_dept: e.target.value })} className={inp}>
            <option value="">(부서를 고르세요)</option>
            {DEPTS.filter((d) => d !== myDept && d !== '기타').map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">자재 요청 · 도면/BOM 자료 요청은 각 전용 화면을 씁니다. 여기는 확인 부탁 · 일정 협의 같은 일에 씁니다.</p>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">무엇을 적나요</label>
          <div className="grid grid-cols-2 gap-1.5">
            {[['todo', '할 일', '담당자 · 기한이 있는 일'], ['note', s === 'all' ? '일정 · 공지' : '부서 특이사항', '그 날에 보이기만 함']].map(([k, l, n]) => (
              <button key={k} type="button" data-kind={k} onClick={() => set({ kind: k, ...(k === 'todo' ? { room: false, end_date: '' } : {}) })}
                className={`rounded-lg border px-2 py-1.5 text-left ${(draft.kind || 'todo') === k ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white'}`}>
                <span className="block text-xs font-bold text-slate-700">{l}</span><span className="block text-[10.5px] text-slate-500">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {note && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">날짜 *</label>
            <input type="date" data-sched-date value={draft.due_date || ''} onChange={(e) => set({ due_date: e.target.value })} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">끝 날 <span className="font-normal">(하루면 비움)</span></label>
            <input type="date" data-sched-end value={draft.end_date || ''} min={draft.due_date || undefined} onChange={(e) => set({ end_date: e.target.value })} className={inp} />
          </div>
        </div>
      )}
      {note && s === 'all' && (
        <div className="rounded-lg border border-blue-200 bg-white p-2.5 space-y-2">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" data-sched-room checked={!!draft.room} onChange={(e) => set({ room: e.target.checked })} className="w-4 h-4" />대회의실 사용
          </label>
          {draft.room && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-[11px] font-bold text-slate-500 mb-0.5">시작</label><input type="time" data-sched-from value={(draft.time_from || '').slice(0, 5)} onChange={(e) => set({ time_from: e.target.value })} className={inp} /></div>
              <div><label className="block text-[11px] font-bold text-slate-500 mb-0.5">끝</label><input type="time" data-sched-to value={(draft.time_to || '').slice(0, 5)} onChange={(e) => set({ time_to: e.target.value })} className={inp} /></div>
            </div>
          )}
          {clash.length > 0 && (
            <p data-sched-clash className="rounded-md bg-red-50 px-2 py-1.5 text-[11.5px] font-bold text-red-700">
              같은 시간에 대회의실 일정이 있습니다 — {clash.slice(0, 2).map((r) => `${timeText(r) || '종일'} · ${r.dept || ''}`).join(', ')}. 그래도 저장할 수 있습니다.
            </p>
          )}
        </div>
      )}
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1">반복</label>
        <select data-sched-repeat value={draft.repeat || ''} onChange={(e) => set({ repeat: e.target.value })} className={inp}>
          {REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {draft.repeat && <p className="text-[11px] text-slate-500 mt-1">{note ? '적은 날짜부터 규칙에 맞는 날마다 보입니다.' : '끝내면 다음 회차가 자동으로 생깁니다. 쉬는 날이면 앞 평일로 당깁니다.'}</p>}
      </div>
    </div>
  )
}

// 목록 보기에서 일정 · 특이사항을 고치고 지우는 곳 — 오늘부터 30일 안에 걸리는 것
export function NotesList({ rows, today, myDept, canEdit, onEdit, onDelete }) {
  const until = addDays(today, 30)
  const list = (rows || []).filter(isNote).map((r) => {
    let next = null
    for (let d = today; d <= until; d = addDays(d, 1)) { if (itemsOn([r], d, today).length) { next = d; break } }
    return { r, next }
  }).filter((x) => x.next).sort((a, b) => a.next.localeCompare(b.next))
  if (!list.length) return null
  return (
    <div data-notes-list className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold border-b border-amber-200 bg-amber-50 text-amber-800">일정 · 특이사항 <span>{list.length}</span> <span className="font-normal text-amber-700">· 앞으로 30일</span></div>
      {list.map(({ r, next }) => (
        <div key={r.id} data-note-row={r.id} className="border-t border-slate-100 first:border-0 px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-500 w-[72px] shrink-0">{next === today ? '오늘' : md(next)}{r.end_date && r.end_date > r.due_date ? ` ~ ${md(r.end_date)}` : ''}</span>
          <span className="text-sm font-semibold text-slate-800 flex-1 min-w-[160px]">{r.title}{timeText(r) ? <span className="font-normal text-slate-500"> · {timeText(r)}</span> : null}</span>
          <ScopeBadge r={r} myDept={myDept} />
          {scopeOf(r) === 'dept' && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">{r.dept || myDept}</span>}
          {r.repeat && <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-bold">↻ {REPEAT_LABEL[r.repeat]}</span>}
          {canEdit(r) ? (
            <>
              <button type="button" onClick={() => onEdit(r)} title="수정" className="text-slate-300 hover:text-indigo-500 px-1">✎</button>
              <button type="button" onClick={() => onDelete(r)} title="삭제" data-note-del className="text-slate-300 hover:text-rose-500 px-1">✕</button>
            </>
          ) : <span className="text-[10px] text-slate-300 px-1" title="다른 부서가 적은 일정입니다">🔒</span>}
        </div>
      ))}
    </div>
  )
}
