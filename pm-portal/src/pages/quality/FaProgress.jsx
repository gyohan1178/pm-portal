import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { todayISO, ymdKST } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { downloadSheet } from '../../lib/exportSheet'
import { useCanEdit, useMe } from '../../hooks/useProfile'
import { useCustomer } from '../../hooks/useCustomers'
import { useRowSelect } from '../../hooks/useRowSelect'
import { ResizableTable } from '../../components/ResizableTable'
import {
  FA_TYPES, FA_STAGES, FA_STEPS, faTypeLabel, stepsOf, stepLabel, stepState, stepText,
  faProgress, faStage, faStageMarks, faApproved, parseFaPaste,
} from '../../lib/faTemplate'

// 초도품(FA) 진행관리
//
//   초도품 PO 를 받은 뒤 진행이 안 보였다 — 자재는 들어왔는지, 불출은 했는지, 제작은 시작했는지,
//   고객사에 물어볼 건 없는지, 품질팀 인계·성적서·고객사 승인은 언제인지.
//   「FA PD 5종 Project Stages」 엑셀을 옮겨, 건마다 체크리스트로 관리한다.
//
//   ① 고객사 FA 목록을 엑셀에서 복사해 붙이면 건이 생긴다 (다시 붙이면 Rev·납기·가능일·비고만 갱신)
//   ② 줄을 누르면 체크리스트 — 항목마다 미착수 / 진행 / 완료 / 해당없음 + 날짜 · 메모
//      누가 · 언제 눌렀는지 자동으로 남는다
//   ③ 전장 BOX 가 기준이고, ASSY · 하네스 · 단품은 해당 없는 항목이 빠진 틀을 쓴다
//   ④ 「진척표」 탭은 예전 엑셀처럼 건을 열로 놓고 본다 (엑셀로 내려받기)

const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5).replace('-', '/') : '')
const fetchFa = () => fetchAll(() => supabase.from('pm_fa').select('*').order('id'))

const STATE_BTN = [
  ['', '미착수'],
  ['doing', '진행'],
  ['done', '완료'],
  ['na', '해당없음'],
]
const STATE_TONE = {
  '': 'bg-white text-slate-500 border-slate-200',
  doing: 'bg-amber-50 text-amber-700 border-amber-300',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  na: 'bg-slate-100 text-slate-400 border-slate-200',
}
const CELL_TONE = { done: 'bg-emerald-50 text-emerald-700', doing: 'bg-amber-50 text-amber-700', na: 'bg-slate-50 text-slate-300', '': 'text-slate-300' }

function ProgressBar({ pct }) {
  const tone = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-indigo-500' : pct >= 30 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-2 ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] font-bold tabular-nums text-slate-600">{pct}%</span>
    </div>
  )
}

function StageDots({ fa }) {
  const marks = faStageMarks(fa)
  return (
    <div className="flex items-center gap-1">
      {marks.map((m) => (
        <span key={m.key} title={`${m.label} — ${{ done: '끝남', cur: '지금', todo: '남음', skip: '해당 없음' }[m.mark]}`}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
            m.mark === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : m.mark === 'cur' ? 'bg-indigo-600 text-white border-indigo-600'
                : m.mark === 'skip' ? 'bg-white text-slate-200 border-slate-100 line-through'
                  : 'bg-white text-slate-400 border-slate-200'}`}>
          {m.label}
        </span>
      ))}
    </div>
  )
}

export default function FaProgress() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const me = useMe()
  const { data: ax } = useCustomer('ax')
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['faList'], queryFn: fetchFa })

  const [tab, setTab] = useState('list')        // list · matrix
  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState('')
  const [only, setOnly] = useState('')          // '' · inquiry · hold · late · week · done
  const [openId, setOpenId] = useState(null)
  const [paste, setPaste] = useState(false)
  const [sel, setSel] = useState({})            // 진척표로 볼 건
  const { rowProps } = useRowSelect(setSel)

  const today = todayISO()
  const in7 = ymdKST(new Date(Date.now() + 7 * 86400000))

  const enriched = useMemo(() => rows.map((r) => {
    const approved = faApproved(r)
    const late = !approved && !r.hold && r.fa_ready_date && r.fa_ready_date < today
    const week = !approved && r.fa_ready_date && r.fa_ready_date >= today && r.fa_ready_date <= in7
    return { ...r, _pct: faProgress(r), _stage: faStage(r), _approved: approved, _late: late, _week: week }
  }), [rows, today, in7])

  const counts = useMemo(() => ({
    open: enriched.filter((r) => !r._approved).length,
    inquiry: enriched.filter((r) => !r._approved && r.inquiry_open).length,
    hold: enriched.filter((r) => !r._approved && r.hold).length,
    late: enriched.filter((r) => r._late).length,
    week: enriched.filter((r) => r._week).length,
    done: enriched.filter((r) => r._approved).length,
  }), [enriched])

  const view = useMemo(() => {
    const k = q.trim().toUpperCase()
    const list = enriched.filter((r) => {
      if (only === 'done') { if (!r._approved) return false }
      else if (r._approved) return false
      if (only === 'inquiry' && !r.inquiry_open) return false
      if (only === 'hold' && !r.hold) return false
      if (only === 'late' && !r._late) return false
      if (only === 'week' && !r._week) return false
      if (typeF && r.fa_type !== typeF) return false
      if (!k) return true
      return [r.item_code, r.item_desc, r.po_number, r.note, r.inquiry, r.ccn]
        .some((x) => String(x || '').toUpperCase().includes(k))
    })
    // 우선순위 → FA 가능일 → 납기
    const big = '9999-12-31'
    return list.sort((a, b) =>
      (a.priority ?? 1e9) - (b.priority ?? 1e9)
      || String(a.fa_ready_date || big).localeCompare(String(b.fa_ready_date || big))
      || String(a.promise_date || big).localeCompare(String(b.promise_date || big))
      || a.id - b.id)
  }, [enriched, q, typeF, only])

  const picked = view.filter((r) => sel[r.id])
  const open = enriched.find((r) => r.id === openId) || null

  // 항목 하나 바꾸기 — 바로 저장하고 화면도 바로 고친다
  const setStep = useCallback(async (fa, key, next) => {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return }
    const clean = next ? Object.fromEntries(Object.entries(next).filter(([k, v]) =>
      !['by', 'at'].includes(k) && v !== '' && v !== null && v !== undefined)) : null
    const val = clean && Object.keys(clean).length ? clean : null
    try {
      const steps = must(await supabase.rpc('pm_fa_step_set',
        { p_id: fa.id, p_key: key, p_val: val, p_by: me?.name || null }), '초도품 항목 저장')
      qc.setQueryData(['faList'], (old = []) => old.map((r) => (r.id === fa.id
        ? { ...r, steps: steps || {}, approved_at: key === 'approve' ? (val?.s === 'done' ? (r.approved_at || new Date().toISOString()) : null) : r.approved_at }
        : r)))
    } catch (e) { toastError(e.message) }
  }, [canEdit, me, qc])

  async function saveInfo(fa, patch) {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false }
    try {
      must(await supabase.from('pm_fa').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', fa.id), '초도품 정보 저장')
      qc.invalidateQueries({ queryKey: ['faList'] })
      toastSuccess('저장했습니다')
      return true
    } catch (e) { toastError(e.message); return false }
  }

  async function remove(fa) {
    if (!window.confirm(`${fa.item_code} (${fa.po_number}) 를 지울까요? 체크한 내용도 같이 지워집니다.`)) return
    try {
      must(await supabase.from('pm_fa').delete().eq('id', fa.id), '초도품 삭제')
      qc.invalidateQueries({ queryKey: ['faList'] })
      setOpenId(null); toastSuccess('지웠습니다')
    } catch (e) { toastError(e.message) }
  }

  // 진척표 — 고른 건(없으면 보이는 건, 최대 12)
  const matrixCols = (picked.length ? picked : view).slice(0, 12)

  async function exportMatrix() {
    const cols = matrixCols
    if (!cols.length) { toastError('진척표에 올릴 건이 없습니다'); return }
    const name = (r) => `${r.item_code} (${r.po_number})`
    const types = new Set(cols.map((r) => r.fa_type))
    const out = []
    const base = (label, f) => { const o = { 단계: '', 항목: label }; cols.forEach((r) => { o[name(r)] = f(r) }); out.push(o) }
    base('품명', (r) => r.item_desc || '')
    base('구분', (r) => faTypeLabel(r.fa_type))
    base('SREV / BREV', (r) => `${r.srev || '-'} / ${r.brev || '-'}`)
    base('FA 가능일', (r) => r.fa_ready_date || r.fa_ready_text || '')
    for (const g of FA_STAGES) {
      FA_STEPS.filter((s) => s.st === g.key && s.t.some((t) => types.has(t))).forEach((s) => {
        const o = { 단계: g.label, 항목: s.l }
        cols.forEach((r) => { o[name(r)] = s.t.includes(r.fa_type) ? stepText(s, r.steps?.[s.k]) : '—' })
        out.push(o)
      })
    }
    base('종합 진척도', (r) => `${faProgress(r)}%`)
    try {
      await downloadSheet({ rows: out, fileName: `초도품_진척표_${today}.xlsx`, sheetName: '진척표', title: `초도품(FA) 진척표 — 기준일 ${today}` })
    } catch (e) { toastError(e.message) }
  }

  async function exportList() {
    try {
      await downloadSheet({
        rows: view.map((r) => ({
          우선순위: r.priority ?? '', CCN: r.ccn || '', 구분: faTypeLabel(r.fa_type), 품번: r.item_code, 품명: r.item_desc || '',
          SREV: r.srev || '', BREV: r.brev || '', 'FA PO': r.po_number, 'Promise Date': r.promise_date || '',
          'FA 가능일': r.fa_ready_date || r.fa_ready_text || '', 진척도: `${r._pct}%`, '지금 단계': r._stage.label,
          보류: r.hold ? 'Y' : '', '고객사 문의': r.inquiry_open ? (r.inquiry || 'Y') : '', 비고: r.note || '',
        })),
        fileName: `초도품_진행_${today}.xlsx`, sheetName: '초도품', title: `초도품(FA) 진행 — ${today}`,
      })
    } catch (e) { toastError(e.message) }
  }

  const COLS = [
    { key: 'chk', label: '', defaultWidth: 34, sortable: false },
    { key: 'pri', label: '우선', defaultWidth: 52 },
    { key: 'type', label: '구분', defaultWidth: 76 },
    { key: 'item', label: '품번 · 품명', defaultWidth: 270 },
    { key: 'rev', label: 'S / B', defaultWidth: 62 },
    { key: 'po', label: 'FA PO', defaultWidth: 100 },
    { key: 'promise', label: '납기', defaultWidth: 62 },
    { key: 'ready', label: 'FA 가능일', defaultWidth: 104 },
    { key: 'pct', label: '진척도', defaultWidth: 140 },
    { key: 'stage', label: '단계', defaultWidth: 236 },
    { key: 'note', label: '비고 · 문의', defaultWidth: 230 },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">🔬 품질</p>
          <h1 className="text-xl font-extrabold text-slate-900">초도품(FA) 진행관리</h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            초도품 PO 를 받은 뒤 준비 → 자재 → 제작 → 품질 → 고객사 승인까지 건마다 체크합니다.
            고객사 FA 목록을 붙여 넣어 건을 만들고, 줄을 누르면 체크리스트가 열립니다. 누가 · 언제 눌렀는지는 자동으로 남습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportList}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📑 엑셀</button>
          {canEdit && (
            <button onClick={() => setPaste(true)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">📋 FA 목록 붙여넣기</button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">목록을 못 불러왔습니다 — {error.message}</div>}

      {/* 지표 — 누르면 그것만 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          ['', '진행 중', counts.open, '승인 전 전체', ''],
          ['inquiry', '고객사 문의 필요', counts.inquiry, '답을 받아야 진행되는 건', counts.inquiry ? 'warn' : ''],
          ['hold', '보류', counts.hold, '진행을 멈춘 건', ''],
          ['late', 'FA 가능일 지남', counts.late, '보류 빼고, 가능일이 지났는데 승인 전', counts.late ? 'warn' : ''],
          ['week', '7일 안에 FA 가능', counts.week, `${md(today)} ~ ${md(in7)}`, ''],
          ['done', '승인 완료', counts.done, '고객사 승인(FINAL) 끝', 'ok'],
        ].map(([key, t, v, s, tone]) => (
          <button key={t} onClick={() => setOnly(only === key ? '' : key)}
            className={`text-left rounded-xl border p-3 transition ${only === key && key !== '' ? 'ring-2 ring-indigo-400' : ''} ${
              tone === 'warn' ? 'border-rose-200 bg-rose-50/60' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
            <div className="text-[12px] font-semibold text-slate-400">{t}</div>
            <div className={`text-2xl font-extrabold tabular-nums ${tone === 'warn' ? 'text-rose-600' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-800'}`}>{n(v)}</div>
            <div className="text-[10.5px] text-slate-400 leading-snug">{s}</div>
          </button>
        ))}
      </div>

      {/* 도구줄 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          {[['list', '목록'], ['matrix', `진척표${picked.length ? ` (${picked.length})` : ''}`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 ${tab === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 품명 · PO · 비고 · 문의"
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-64" />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)}
          className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg">
          <option value="">구분 전체</option>
          {FA_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {only && <button onClick={() => setOnly('')} className="text-xs text-indigo-600 hover:underline">필터 풀기</button>}
        <span className="text-xs text-slate-400 ml-auto">
          {n(view.length)}건 {picked.length > 0 && <>· 고른 {n(picked.length)}건 <button onClick={() => setSel({})} className="text-indigo-600 hover:underline">선택 해제</button></>}
        </span>
      </div>

      {tab === 'list' && (
        isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
          : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
              아직 초도품이 없습니다. 오른쪽 위 「📋 FA 목록 붙여넣기」로 고객사 FA 목록을 붙여 넣으세요.
            </div>
          ) : (
            <ResizableTable cols={COLS} storageKey="fa-progress-cols">
              {() => (
                <tbody>
                  {view.map((r) => {
                    const on = !!sel[r.id]
                    return (
                      <tr key={r.id} {...rowProps(r.id, on)}
                        className={`border-b border-slate-100 cursor-pointer select-none ${on ? 'bg-indigo-50' : r.hold ? 'bg-slate-50/70' : 'hover:bg-slate-50'}`}>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={on} aria-label="진척표에 올리기"
                            onChange={() => setSel((x) => ({ ...x, [r.id]: !on }))} />
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-slate-500 tabular-nums">{r.priority ?? ''}</td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-600">
                          {faTypeLabel(r.fa_type)}{r.ccn ? <span className="ml-1 text-[10px] text-slate-400">{r.ccn}</span> : null}
                        </td>
                        <td className="px-3 py-2 overflow-hidden" data-no-select>
                          <button onClick={() => setOpenId(r.id)} className="text-left w-full">
                            <div className="font-mono font-bold text-indigo-600 hover:underline whitespace-nowrap">{r.item_code}</div>
                            <div className="text-[11px] text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">{r.item_desc}</div>
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                          {r.srev || '-'} / {r.brev || '-'}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap overflow-hidden">{r.po_number}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{md(r.promise_date)}</td>
                        <td className={`px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis ${r._late ? 'text-rose-600 font-bold' : r._week ? 'text-amber-700 font-bold' : 'text-slate-600'}`}
                          title={r.fa_ready_text || ''}>
                          {r.fa_ready_date ? md(r.fa_ready_date) : <span className="text-[11px] text-slate-400">{r.fa_ready_text || '-'}</span>}
                        </td>
                        <td className="px-3 py-2"><ProgressBar pct={r._pct} /></td>
                        <td className="px-3 py-2 overflow-hidden"><StageDots fa={r} /></td>
                        <td className="px-3 py-2 overflow-hidden">
                          <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden">
                            {r.hold && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-white">보류</span>}
                            {r.inquiry_open && <span title={r.inquiry || ''} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">문의</span>}
                            <span className="text-[11px] text-slate-500 overflow-hidden text-ellipsis">{r.inquiry_open && r.inquiry ? r.inquiry : r.note}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              )}
            </ResizableTable>
          )
      )}

      {tab === 'matrix' && (
        <Matrix cols={matrixCols} total={(picked.length ? picked : view).length} picked={picked.length > 0}
          onOpen={setOpenId} onExport={exportMatrix} />
      )}

      {open && (
        <FaDetail fa={open} canEdit={canEdit} onClose={() => setOpenId(null)}
          onStep={setStep} onSave={saveInfo} onDelete={remove} />
      )}
      {paste && (
        <PasteModal rows={rows} csId={ax?.id || null} me={me} onClose={() => setPaste(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['faList'] }); setPaste(false) }} />
      )}
    </div>
  )
}

/* ───────── 진척표 — 예전 엑셀처럼 건을 열로 ───────── */
function Matrix({ cols, total, picked, onOpen, onExport }) {
  if (!cols.length) return <p className="py-10 text-center text-sm text-slate-400">진척표에 올릴 건이 없습니다</p>
  const types = new Set(cols.map((r) => r.fa_type))
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {picked ? '목록에서 고른 건' : '지금 목록의 건'} {cols.length}건{total > cols.length ? ` (최대 12건 — ${total}건 중)` : ''}.
        목록 탭에서 줄을 눌러 고르면 그 건만 봅니다.
        <button onClick={onExport} className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📑 진척표 엑셀</button>
      </div>
      <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
        <table className="text-xs border-collapse" style={{ minWidth: 260 + cols.length * 128 }}>
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="px-2 py-2 text-left w-16 sticky left-0 bg-slate-800">단계</th>
              <th className="px-2 py-2 text-left w-52 sticky left-16 bg-slate-800">항목</th>
              {cols.map((r) => (
                <th key={r.id} className="px-2 py-2 w-32 text-center align-top">
                  <button onClick={() => onOpen(r.id)} className="font-mono font-bold hover:underline">{r.item_code}</button>
                  <div className="text-[10px] font-normal text-slate-300 truncate" title={r.item_desc || ''}>{r.item_desc}</div>
                  <div className="text-[10px] font-normal text-amber-300">REV {r.srev || '-'} / {r.brev || '-'} · {faTypeLabel(r.fa_type)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-2 py-1.5 font-bold text-slate-500 sticky left-0 bg-white">공통</td>
              <td className="px-2 py-1.5 text-slate-600 sticky left-16 bg-white">FA 가능일</td>
              {cols.map((r) => <td key={r.id} className="px-2 py-1.5 text-center text-slate-600">{r.fa_ready_date || r.fa_ready_text || '-'}</td>)}
            </tr>
            {FA_STAGES.map((g) => {
              const steps = FA_STEPS.filter((s) => s.st === g.key && s.t.some((t) => types.has(t)))
              return steps.map((s, i) => (
                <tr key={s.k} className="border-b border-slate-100">
                  <td className="px-2 py-1.5 font-bold text-slate-500 sticky left-0 bg-white">{i === 0 ? g.label : ''}</td>
                  <td className="px-2 py-1.5 text-slate-600 sticky left-16 bg-white whitespace-nowrap">{s.l}</td>
                  {cols.map((r) => {
                    if (!s.t.includes(r.fa_type)) return <td key={r.id} className="px-2 py-1.5 text-center text-slate-200">—</td>
                    const v = r.steps?.[s.k]
                    const st = stepState(s, v)
                    return (
                      <td key={r.id} className={`px-2 py-1.5 text-center whitespace-nowrap ${CELL_TONE[st]}`} title={v?.m || ''}>
                        {stepText(s, v) || '·'}
                      </td>
                    )
                  })}
                </tr>
              ))
            })}
            <tr className="bg-slate-50">
              <td colSpan={2} className="px-2 py-2 font-extrabold text-slate-700 sticky left-0 bg-slate-50">종합 진척도</td>
              {cols.map((r) => {
                const p = faProgress(r)
                return <td key={r.id} className={`px-2 py-2 text-center text-lg font-extrabold ${p >= 100 ? 'text-emerald-600' : p >= 60 ? 'text-indigo-600' : 'text-rose-600'}`}>{p}%</td>
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ───────── 한 건 — 정보 + 체크리스트 ───────── */
function FaDetail({ fa, canEdit, onClose, onStep, onSave, onDelete }) {
  const [info, setInfo] = useState(() => ({
    fa_type: fa.fa_type || 'PD', priority: fa.priority ?? '', fa_ready_date: fa.fa_ready_date || '',
    fa_ready_text: fa.fa_ready_text || '', note: fa.note || '', hold: !!fa.hold,
    inquiry: fa.inquiry || '', inquiry_open: !!fa.inquiry_open, item_desc: fa.item_desc || '',
    srev: fa.srev || '', brev: fa.brev || '', promise_date: fa.promise_date || '',
  }))
  const set = (k, v) => setInfo((s) => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(info) !== JSON.stringify({
    fa_type: fa.fa_type || 'PD', priority: fa.priority ?? '', fa_ready_date: fa.fa_ready_date || '',
    fa_ready_text: fa.fa_ready_text || '', note: fa.note || '', hold: !!fa.hold,
    inquiry: fa.inquiry || '', inquiry_open: !!fa.inquiry_open, item_desc: fa.item_desc || '',
    srev: fa.srev || '', brev: fa.brev || '', promise_date: fa.promise_date || '',
  })
  async function save() {
    const ok = await onSave(fa, {
      fa_type: info.fa_type, priority: info.priority === '' ? null : Number(info.priority),
      fa_ready_date: info.fa_ready_date || null, fa_ready_text: info.fa_ready_text.trim() || null,
      note: info.note.trim() || null, hold: info.hold, inquiry: info.inquiry.trim() || null,
      inquiry_open: info.inquiry_open, item_desc: info.item_desc.trim() || null,
      srev: info.srev.trim() || null, brev: info.brev.trim() || null, promise_date: info.promise_date || null,
    })
    if (ok && info.fa_type !== fa.fa_type) toastSuccess('구분을 바꿔 체크리스트 항목이 바뀌었습니다 (이미 체크한 값은 남아 있습니다)')
  }
  // 체크리스트는 저장된 구분 기준 — 구분을 바꾸면 저장한 뒤 바뀐다
  const steps = stepsOf(fa.fa_type)
  const pct = faProgress(fa)
  const stage = faStage(fa)
  const inp = 'px-2 py-1 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-5xl rounded-2xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="text-lg font-extrabold font-mono text-slate-900">{fa.item_code}</h3>
              <span className="text-sm text-slate-500">{fa.item_desc}</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              FA PO <span className="font-mono text-slate-600">{fa.po_number}</span> · CCN {fa.ccn || '-'} · {faTypeLabel(fa.fa_type)} · 요청일 {fa.required_date || '-'}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-40"><ProgressBar pct={pct} /></div>
            <span className="text-xs font-bold text-indigo-700">{stage.label}</span>
            <button onClick={onClose} aria-label="닫기" className="text-slate-300 hover:text-slate-500 text-xl leading-none">×</button>
          </div>
        </div>

        {/* 정보 */}
        <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2 text-xs">
          <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">구분 (체크리스트)</span>
            <select disabled={!canEdit} value={info.fa_type} onChange={(e) => set('fa_type', e.target.value)} className={inp}>
              {FA_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">우선순위</span>
            <input disabled={!canEdit} type="number" min="1" value={info.priority} onChange={(e) => set('priority', e.target.value)} className={inp} /></label>
          <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">SREV / BREV</span>
            <div className="flex gap-1">
              <input disabled={!canEdit} value={info.srev} onChange={(e) => set('srev', e.target.value)} className={`${inp} w-full`} />
              <input disabled={!canEdit} value={info.brev} onChange={(e) => set('brev', e.target.value)} className={`${inp} w-full`} />
            </div></label>
          <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">납기 (Promise)</span>
            <input disabled={!canEdit} type="date" value={info.promise_date} onChange={(e) => set('promise_date', e.target.value)} className={inp} /></label>
          <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">FA 가능일</span>
            <input disabled={!canEdit} type="date" value={info.fa_ready_date} onChange={(e) => set('fa_ready_date', e.target.value)} className={inp} /></label>
          <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">가능일 메모 (날짜 대신)</span>
            <input disabled={!canEdit} value={info.fa_ready_text} placeholder="내부 협의 등" onChange={(e) => set('fa_ready_text', e.target.value)} className={inp} /></label>
          <label className="flex flex-col gap-1 md:col-span-3"><span className="text-slate-400 font-semibold">비고</span>
            <input disabled={!canEdit} value={info.note} onChange={(e) => set('note', e.target.value)} className={inp} /></label>
          <label className="flex flex-col gap-1 md:col-span-3"><span className="text-slate-400 font-semibold">고객사 문의 내용</span>
            <input disabled={!canEdit} value={info.inquiry} placeholder="도면 문의 · Rev 확인 등" onChange={(e) => set('inquiry', e.target.value)} className={inp} /></label>
          <div className="md:col-span-6 flex items-center gap-4 flex-wrap">
            <label className="inline-flex items-center gap-1.5 font-semibold text-rose-700">
              <input disabled={!canEdit} type="checkbox" checked={info.inquiry_open} onChange={(e) => set('inquiry_open', e.target.checked)} /> 고객사 문의 필요 (답 받으면 끄기)
            </label>
            <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
              <input disabled={!canEdit} type="checkbox" checked={info.hold} onChange={(e) => set('hold', e.target.checked)} /> 보류
            </label>
            {canEdit && (
              <>
                <button onClick={save} disabled={!dirty}
                  className="ml-auto px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">정보 저장</button>
                <button onClick={() => onDelete(fa)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300">삭제</button>
              </>
            )}
          </div>
        </div>

        {/* 체크리스트 */}
        <div className="px-5 py-3 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="text-[11px] text-slate-400">
            항목을 누르면 바로 저장됩니다. 「완료」를 누르면 날짜가 오늘로 들어가고, 진행 중이면 날짜 칸에 끝낼 예정일을 적으세요.
            이 건에 없는 항목은 「해당없음」 — 진척도 계산에서 빠집니다.
          </p>
          {FA_STAGES.map((g) => {
            const mine = steps.filter((s) => s.st === g.key)
            if (!mine.length) return null
            return (
              <div key={g.key}>
                <div className="text-xs font-extrabold text-slate-700 mb-1">{g.label}</div>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {mine.map((s) => (
                    <StepRow key={s.k} fa={fa} step={s} canEdit={canEdit} onStep={onStep} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StepRow({ fa, step, canEdit, onStep }) {
  const v = fa.steps?.[step.k] || {}
  const st = stepState(step, v)
  const [memo, setMemo] = useState(v.m || '')
  const [pct, setPct] = useState(v.p ?? '')
  const put = (patch) => onStep(fa, step.k, { ...v, ...patch })
  function pick(s) {
    if (s === 'done') put({ s: 'done', d: v.d || todayISO(), ...(step.kind === 'pct' ? { p: 100 } : {}) })
    else if (s === '') onStep(fa, step.k, v.m ? { m: v.m } : null)
    else if (s === 'doing') put({ s: 'doing', ...(step.kind === 'pct' && Number(v.p) >= 100 ? { p: '' } : {}) })
    else put({ s })
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs flex-wrap">
      <div className={`w-52 font-semibold ${st === 'na' ? 'text-slate-300 line-through' : 'text-slate-700'}`}>{stepLabel(step, fa.fa_type)}</div>
      <div className="inline-flex rounded-lg overflow-hidden border border-slate-200">
        {STATE_BTN.map(([k, l]) => (
          <button key={k || 'none'} disabled={!canEdit} onClick={() => pick(k)}
            className={`px-2 py-1 border-r last:border-r-0 font-bold ${st === k ? STATE_TONE[k] : 'bg-white text-slate-300 hover:text-slate-600'} disabled:cursor-default`}>{l}</button>
        ))}
      </div>
      {step.kind === 'pct' && (
        <label className="inline-flex items-center gap-1 text-slate-400">
          <input disabled={!canEdit || st === 'na'} type="number" min="0" max="100" value={pct}
            onChange={(e) => setPct(e.target.value)}
            onBlur={() => { if (String(pct) !== String(v.p ?? '')) put({ p: pct === '' ? '' : Math.max(0, Math.min(100, Number(pct))) }) }}
            className="w-14 px-1.5 py-1 text-right border border-slate-200 rounded" />%
        </label>
      )}
      <input disabled={!canEdit || st === 'na'} type="date" value={v.d || ''} title={st === 'done' ? '완료일' : '예정일'}
        onChange={(e) => put({ d: e.target.value })}
        className="px-1.5 py-1 border border-slate-200 rounded text-slate-600" />
      <input disabled={!canEdit} value={memo} placeholder="메모"
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => { if (memo !== (v.m || '')) put({ m: memo.trim() }) }}
        className="flex-1 min-w-[140px] px-2 py-1 border border-slate-200 rounded" />
      <span className="w-28 text-right text-[10px] text-slate-400 whitespace-nowrap">
        {v.by ? `${v.by} · ${String(v.at || '').slice(5, 10).replace('-', '/')}` : ''}
      </span>
    </div>
  )
}

/* ───────── FA 목록 붙여넣기 ───────── */
function PasteModal({ rows, csId, me, onClose, onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => parseFaPaste(text), [text])
  const exist = useMemo(() => new Map(rows.map((r) => [`${r.po_number}|${r.item_code}`, r])), [rows])
  const news = parsed.rows.filter((r) => !exist.has(`${r.po_number}|${r.item_code}`))
  const upds = parsed.rows.filter((r) => exist.has(`${r.po_number}|${r.item_code}`))

  async function run() {
    if (!parsed.rows.length) return
    setBusy(true)
    try {
      const base = (r, old) => ({
        customer_id: old?.customer_id || csId,
        ccn: r.ccn, product: r.product, item_code: r.item_code, po_number: r.po_number,
        item_desc: r.item_desc || old?.item_desc || null,
        srev: r.srev, brev: r.brev, buy_um: r.buy_um,
        promise_date: r.promise_date, required_date: r.required_date,
        // 목록에 비어 있으면 포털에서 적은 값을 지우지 않는다
        fa_ready_date: (r.fa_ready_date || r.fa_ready_text) ? r.fa_ready_date : (old?.fa_ready_date ?? null),
        fa_ready_text: (r.fa_ready_date || r.fa_ready_text) ? r.fa_ready_text : (old?.fa_ready_text ?? null),
        note: r.note || old?.note || null,
        // 구분은 처음 만들 때만 — 포털에서 바꿨으면 그대로 둔다
        fa_type: old?.fa_type || r.fa_type,
        updated_at: new Date().toISOString(),
      })
      if (news.length) {
        must(await supabase.from('pm_fa').insert(news.map((r) => ({ ...base(r, null), created_name: me?.name || null }))), '초도품 등록')
      }
      if (upds.length) {
        must(await supabase.from('pm_fa').upsert(
          upds.map((r) => base(r, exist.get(`${r.po_number}|${r.item_code}`))),
          { onConflict: 'po_number,item_code' }), '초도품 갱신')
      }
      toastSuccess(`새로 ${news.length}건 · 갱신 ${upds.length}건`)
      onDone()
    } catch (e) { toastError(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl rounded-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">📋 FA 목록 붙여넣기</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            고객사 FA 목록을 머리줄째 복사해 붙이세요 — CCN · Product · Item · SRev · BRev · OrderNumber · Buy UM · Promise Date · Required Date · Item Desc · FA 가능일자 · 비고.
            같은 PO · 품번이 이미 있으면 Rev · 납기 · 가능일 · 비고만 갱신하고, 체크한 내용은 그대로 둡니다. 목록에서 빈 칸은 포털 값을 지우지 않습니다.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
            placeholder={'CCN\tProduct\tItem\tSRev\tBRev\tOrderNumber\t…\nK\tHARNESS\t160023026\tA\tA\tG44866KF\t…'}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg" />
          {parsed.rows.length > 0 && (
            <>
              <div className="text-xs text-slate-600">
                읽은 줄 <b>{parsed.rows.length}</b> · 새로 <b className="text-indigo-700">{news.length}</b> · 갱신 <b className="text-emerald-700">{upds.length}</b>
                <span className="ml-2 text-slate-400">
                  ({FA_TYPES.map((t) => `${t.label} ${parsed.rows.filter((r) => r.fa_type === t.key).length}`).join(' · ')})
                </span>
              </div>
              <div className="max-h-60 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-400 sticky top-0"><tr>
                    {['', '구분', '품번', '품명', 'S/B', 'PO', '납기', 'FA 가능일', '비고'].map((h) => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {parsed.rows.map((r) => {
                      const old = exist.get(`${r.po_number}|${r.item_code}`)
                      return (
                        <tr key={`${r.po_number}|${r.item_code}`} className="border-t border-slate-100">
                          <td className="px-2 py-1">{old ? <span className="text-emerald-700 font-bold">갱신</span> : <span className="text-indigo-700 font-bold">새로</span>}</td>
                          <td className="px-2 py-1">{faTypeLabel(old?.fa_type || r.fa_type)}</td>
                          <td className="px-2 py-1 font-mono">{r.item_code}</td>
                          <td className="px-2 py-1 max-w-[220px] truncate">{r.item_desc}</td>
                          <td className="px-2 py-1 font-mono">{r.srev || '-'}/{r.brev || '-'}</td>
                          <td className="px-2 py-1 font-mono">{r.po_number}</td>
                          <td className="px-2 py-1">{r.promise_date || ''}</td>
                          <td className="px-2 py-1">{r.fa_ready_date || r.fa_ready_text || ''}</td>
                          <td className="px-2 py-1 max-w-[160px] truncate">{r.note}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {parsed.bad.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 space-y-0.5">
              {parsed.bad.map((b, i) => <div key={i}>⚠ {b}</div>)}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">닫기</button>
          <button onClick={run} disabled={busy || !parsed.rows.length}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '넣는 중…' : `넣기 — 새로 ${news.length} · 갱신 ${upds.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
