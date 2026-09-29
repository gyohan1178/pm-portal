import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { todayISO, ymdKST } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { downloadSheet } from '../../lib/exportSheet'
import { useCanEdit, useMe } from '../../hooks/useProfile'
import { useCustomer } from '../../hooks/useCustomers'
import { ResizableTable } from '../../components/ResizableTable'
import { customerRows, customerSummary, custTone, CUST_COLS, exportFaCustomer } from '../../lib/faCustomerReport'
import {
  FA_TYPES, FA_GATES, faTypeLabel, faTypeTone, gatesOf, gateInfo, stepsOf, stepLabel, stepState, stepText,
  faProgress, faStage, faApproved, faDelay, dayDiff, parseFaPaste,
  FA_ISSUE_CATS, issueTone, CUST_CAT, splitFaLogs, revCheck, revDiff,
} from '../../lib/faTemplate'

// 초도품(FA) 진행관리
//
//   초도품 PO 를 받은 뒤 진행이 안 보였다 — 자재는 들어왔는지, 불출은 했는지, 제작은 시작했는지,
//   고객사에 물어볼 건 없는지, 품질팀 인계 · 성적서 · 고객사 승인은 언제인지.
//
//   큰 흐름은 단계 9개 (PO 접수 → … → 고객사 승인). 단계마다 담당 · 예정일 · 실적일.
//   품질이 챙기는 세부 항목(도면 · JIG · 케이블 · 성적서 …)은 각 단계 안의 하위 항목.
//
//   보드      단계별 칸에 건이 카드로 — 어디에 쌓였는지 · 예정 넘긴 건이 한눈에. 「▶ 넘기기」 = 그 단계 실적 오늘
//   목록      구분(전장 BOX · ASSY · 하네스 · 단품)별
//   주간 회의  막힌 것 → 이번 주 예정 → 지난 회의 뒤 바뀐 것, 결정 · 회의 메모는 이슈 기록으로 남는다
//   건 상세    단계별 예정 · 실적 (막대로 늦은 만큼) + 하위 항목 + 이슈 · 문의 기록. ◀ ▶ 로 다음 건

const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
// 기록 시각 → 날짜. 시각이 비었거나 이상해도 화면이 죽지 않게
const dayOf = (ts) => { const t = ts ? new Date(ts) : null; return t && !isNaN(t) ? ymdKST(t) : '' }
const fetchFa = () => fetchAll(() => supabase.from('pm_fa').select('*').order('id'))
const fetchLog = () => fetchAll(() => supabase.from('pm_fa_log').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }))
const OWNERS = ['영업', '구매자재', '생산', '품질']
const ownerHas = (g, o) => String(g?.owner || '').includes(o)

const STATE_BTN = [['', '미착수'], ['doing', '진행'], ['done', '완료'], ['na', '해당없음']]
const STATE_TONE = {
  '': 'bg-white text-slate-500 border-slate-200',
  doing: 'bg-amber-50 text-amber-700 border-amber-300',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  na: 'bg-slate-100 text-slate-500 border-slate-200',
}
const LOG_TONE = {
  문의: 'bg-rose-100 text-rose-800', 답변: 'bg-emerald-100 text-emerald-800', 결정: 'bg-indigo-100 text-indigo-800', 기록: 'bg-slate-200 text-slate-700',
  회의: 'bg-amber-100 text-amber-800', 진행: 'bg-slate-200 text-slate-700', 해결: 'bg-emerald-100 text-emerald-800', Rev: 'bg-sky-100 text-sky-800', 자재매칭: 'bg-violet-100 text-violet-800',
}
const revUp = (r) => !!(r.srev && r.brev && String(r.srev).trim().toUpperCase() !== String(r.brev).trim().toUpperCase())
// 열린 이슈 뱃지 — 고객사 문의(빨강)와 사내 이슈(노랑)를 따로 센다
function IssueBadge({ r }) {
  const list = r._issues || []
  const cust = list.filter((i) => i.cat === CUST_CAT).length
  const other = list.length - cust
  const title = list.map((i) => `[${i.cat || '기타'}] ${i.body}`).join('\n') || r.inquiry || ''
  return (
    <>
      {(cust > 0 || r.inquiry_open) && (
        <span title={title} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">문의{cust > 1 ? ` ${cust}` : ''}</span>
      )}
      {other > 0 && <span title={title} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">이슈 {other}</span>}
    </>
  )
}
const RevTag = ({ r }) => (revUp(r)
  ? <span title={`PO 발행 Rev(BREV) ${r.brev} · 지금 고객사 Rev(SREV) ${r.srev} — 제작은 최소 BREV 까지`} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-300">Rev {r.brev}→{r.srev}</span>
  : null)

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

export default function FaProgress() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const me = useMe()
  const { data: ax } = useCustomer('ax')
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['faList'], queryFn: fetchFa })
  const { data: logs = [], isSuccess: logOk } = useQuery({ queryKey: ['faLog'], queryFn: fetchLog })
  const [sp, setSp] = useSearchParams()

  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState('')
  const [ownerF, setOwnerF] = useState('')
  const [only, setOnly] = useState('')          // '' · late · issue · hold · week · done
  const [fold, setFold] = useState({})
  const [paste, setPaste] = useState(false)
  const [custOut, setCustOut] = useState(false)   // 고객사 제출용 내보내기
  // 보기 · 연 건 — 주소에 남겨 새로고침 · 링크 공유에도 그대로
  const view = sp.get('v') || 'board'
  const openId = sp.get('fa') ? Number(sp.get('fa')) : null
  const setParam = (k, v) => setSp((x) => { const s = new URLSearchParams(x); if (v) s.set(k, String(v)); else s.delete(k); return s })
  const setOpenId = (id) => setParam('fa', id)
  const setView = (v) => setParam('v', v === 'board' ? '' : v)

  const today = todayISO()
  const in7 = ymdKST(new Date(Date.now() + 6 * 86400000))

  // 건별 기록 — 이슈(열림) 계산용
  const logsBy = useMemo(() => {
    const m = new Map()
    for (const l of logs) if (l.fa_id) { if (!m.has(l.fa_id)) m.set(l.fa_id, []); m.get(l.fa_id).push(l) }
    return m
  }, [logs])

  const enriched = useMemo(() => rows.map((r) => {
    const approved = faApproved(r)
    // 열린 이슈 — 「고객사 문의」가 열려 있으면 문의 필요 (기록을 못 받았으면 표에 남은 값)
    const open = splitFaLogs(logsBy.get(r.id)).open
    const cust = open.filter((i) => i.cat === CUST_CAT)
    const stage = faStage(r)
    const gates = gateInfo(r, today)
    const cur = gates.find((g) => g.cur)
    // FA 가능일은 「고객사 제출」까지의 약속 — 제출이 끝났으면 더 따지지 않는다
    const readyLate = !approved && !r.hold && !r.steps?.g_submit?.d && r.fa_ready_date && r.fa_ready_date < today
    const late = !approved && !r.hold && (!!cur?.late || !!readyLate)
    const weekGates = gates.filter((g) => !g.done && g.v.p && g.v.p >= today && g.v.p <= in7)
    // 이 단계에 들어온 날 — 앞 단계 실적일
    const prev = stage.idx > 0 ? gates[stage.idx - 1]?.v?.d : null
    return {
      ...r,
      inquiry_open: logOk ? cust.length > 0 : !!r.inquiry_open,
      inquiry: logOk ? (cust[0]?.body || null) : r.inquiry,
      _issues: logOk ? open : [],
      _approved: approved, _stage: stage, _gates: gates, _cur: cur, _pct: faProgress(r), _readyLate: !!readyLate,
      _delay: faDelay(r, today), _late: late, _week: weekGates.length > 0, _weekGates: weekGates,
      _days: prev ? dayDiff(prev, today) : null,
    }
  }), [rows, today, in7, logsBy, logOk])

  const counts = useMemo(() => ({
    open: enriched.filter((r) => !r._approved).length,
    late: enriched.filter((r) => r._late).length,
    inquiry: enriched.filter((r) => !r._approved && r.inquiry_open).length,
    issue: enriched.filter((r) => !r._approved && (r._issues.length || r.inquiry_open)).length,
    hold: enriched.filter((r) => !r._approved && r.hold).length,
    week: enriched.filter((r) => r._week).length,
    done: enriched.filter((r) => r._approved).length,
  }), [enriched])

  const base = useMemo(() => {
    const k = q.trim().toUpperCase()
    const big = '9999-12-31'
    return enriched.filter((r) => {
      if (only === 'done') { if (!r._approved) return false }
      else if (r._approved) return false
      if (only === 'late' && !r._late) return false
      if (only === 'issue' && !(r._issues.length || r.inquiry_open)) return false
      if (only === 'hold' && !r.hold) return false
      if (only === 'week' && !r._week) return false
      if (typeF && r.fa_type !== typeF) return false
      if (ownerF && !ownerHas(r._stage, ownerF)) return false
      if (!k) return true
      return [r.item_code, r.item_desc, r.po_number, r.note, r.ccn, ...r._issues.map((i) => i.body)].some((x) => String(x || '').toUpperCase().includes(k))
    }).sort((a, b) =>
      (a.priority ?? 1e9) - (b.priority ?? 1e9)
      || String(a._cur?.v?.p || a.fa_ready_date || big).localeCompare(String(b._cur?.v?.p || b.fa_ready_date || big))
      || a.id - b.id)
  }, [enriched, q, typeF, ownerF, only])

  // 보드 — 단계별 칸
  const columns = useMemo(() => FA_GATES.map((g) => {
    const list = base.filter((r) => r._stage.k === g.k)
    return { ...g, list, late: list.filter((r) => r._late).length }
  }), [base])
  // 목록 — 구분별
  const groups = useMemo(() => FA_TYPES.map((t) => {
    const list = base.filter((r) => r.fa_type === t.key)
    const avg = list.length ? Math.round(list.reduce((a, r) => a + r._pct, 0) / list.length) : 0
    return { ...t, list, avg, late: list.filter((r) => r._late).length }
  }).filter((g) => g.list.length), [base])
  // ◀ ▶ 순서 — 보고 있던 보기의 순서
  const order = view === 'list' ? groups.flatMap((g) => g.list) : columns.flatMap((c) => c.list)

  const open = enriched.find((r) => r.id === openId) || null
  const reload = () => { qc.invalidateQueries({ queryKey: ['faList'] }); qc.invalidateQueries({ queryKey: ['faLog'] }) }

  // 단계 · 항목 하나 바꾸기 — 바로 저장하고 화면도 바로 고친다
  const setStep = useCallback(async (fa, key, next) => {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false }
    const clean = next ? Object.fromEntries(Object.entries(next).filter(([k, v]) =>
      !['by', 'at'].includes(k) && v !== '' && v !== null && v !== undefined)) : null
    const val = clean && Object.keys(clean).length ? clean : null
    try {
      const steps = must(await supabase.rpc('pm_fa_step_set',
        { p_id: fa.id, p_key: key, p_val: val, p_by: me?.name || null }), '초도품 저장')
      qc.setQueryData(['faList'], (old = []) => old.map((r) => {
        if (r.id !== fa.id) return r
        const s2 = steps && !Array.isArray(steps) ? steps : { ...(r.steps || {}), [key]: val || undefined }
        return { ...r, steps: s2, approved_at: key === 'g_approve' ? (val?.d ? (r.approved_at || new Date().toISOString()) : null) : r.approved_at }
      }))
      return true
    } catch (e) { toastError(e.message); return false }
  }, [canEdit, me, qc])

  // 보드의 「▶ 넘기기」 — 지금 단계 실적을 오늘로
  async function pass(fa) {
    const g = fa._stage
    if (!g?.k || g.k === 'done') return
    const ok = await setStep(fa, g.k, { ...(fa.steps?.[g.k] || {}), d: today })
    if (ok) toastSuccess(`${fa.item_code} — 「${g.l}」 끝 (${md(today)})`)
  }

  async function saveInfo(fa, patch) {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false }
    try {
      must(await supabase.from('pm_fa').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', fa.id), '초도품 정보 저장')
      qc.invalidateQueries({ queryKey: ['faList'] })
      toastSuccess('저장했습니다')
      return true
    } catch (e) { toastError(e.message); return false }
  }

  // 기록 — 이슈(kind 이슈 + 분류) · 이슈 답변(parent_id) · 진행 기록 · 결정 · 회의 메모
  //   「고객사 문의」 이슈가 열려 있는지는 DB 트리거가 pm_fa.inquiry_open 에도 맞춰 둔다 (pm_fa_v3 SQL)
  async function addLog(fa, kind, body, extra = {}) {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false }
    const text = String(body || '').trim()
    if (!text) { toastError('내용을 적으세요'); return false }
    try {
      must(await supabase.from('pm_fa_log').insert({ fa_id: fa?.id ?? null, kind, body: text, created_name: me?.name || null, ...extra }), '기록 남기기')
      reload()
      return true
    } catch (e) { toastError(e.message); return false }
  }
  // 이슈 해결 · 다시 열기 · 지우기
  async function setIssue(issue, act) {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false }
    try {
      if (act === 'delete') {
        if (!window.confirm(`이 이슈를 지울까요? 달린 답변 ${issue.replies?.length || 0}개도 같이 지워집니다.\n\n${issue.body}`)) return false
        must(await supabase.from('pm_fa_log').delete().eq('id', issue.id), '이슈 지우기')
      } else {
        const close = act === 'close'
        must(await supabase.from('pm_fa_log').update({
          closed_at: close ? new Date().toISOString() : null, closed_name: close ? (me?.name || null) : null,
        }).eq('id', issue.id), close ? '이슈 해결' : '이슈 다시 열기')
      }
      reload()
      return true
    } catch (e) { toastError(e.message); return false }
  }

  async function remove(fa) {
    if (!window.confirm(`${fa.item_code} (${fa.po_number}) 를 지울까요? 단계 · 체크 · 이슈 기록도 같이 지워집니다.`)) return
    try {
      must(await supabase.from('pm_fa').delete().eq('id', fa.id), '초도품 삭제')
      reload(); setOpenId(null); toastSuccess('지웠습니다')
    } catch (e) { toastError(e.message) }
  }

  async function exportList() {
    try {
      await downloadSheet({
        rows: order.map((r) => {
          const o = {
            구분: faTypeLabel(r.fa_type), 우선순위: r.priority ?? '', 품번: r.item_code, 품명: r.item_desc || '',
            SREV: r.srev || '', BREV: r.brev || '', 'FA PO': r.po_number, 'FA 가능일': r.fa_ready_date || r.fa_ready_text || '',
            '지금 단계': r._stage.l, 담당: r._stage.owner || '', '예정 대비': r._delay > 0 ? `+${r._delay}일` : r._delay < 0 ? `${r._delay}일` : '',
          }
          FA_GATES.forEach((g) => {
            const v = r.steps?.[g.k]
            o[g.l] = !g.t.includes(r.fa_type) ? '—' : v?.d ? `실적 ${v.d}` : v?.p ? `예정 ${v.p}` : ''
          })
          o['보류'] = r.hold ? 'Y' : ''
          o['열린 이슈'] = r._issues.length ? r._issues.map((i) => `[${i.cat || '기타'}] ${i.body}`).join(' / ') : (r.inquiry_open ? (r.inquiry || '고객사 문의') : '')
          o['비고'] = r.note || ''
          return o
        }),
        fileName: `초도품_진행_${today}.xlsx`, sheetName: '초도품', title: `초도품(FA) 진행 — ${today}`,
      })
    } catch (e) { toastError(e.message) }
  }

  // ── 한 건 상세 ──
  if (openId) {
    if (!open) {
      return (
        <div className="space-y-3">
          <button onClick={() => setOpenId(null)} className="text-sm font-bold text-indigo-600 hover:underline">← 돌아가기</button>
          <p className="py-10 text-center text-sm text-slate-400">{isLoading ? '불러오는 중…' : '이 건을 찾지 못했습니다 (지워졌을 수 있습니다)'}</p>
        </div>
      )
    }
    const i = order.findIndex((r) => r.id === open.id)
    return (
      <FaSheet key={open.id} fa={open} today={today} canEdit={canEdit}
        logs={logs.filter((l) => l.fa_id === open.id)}
        pos={i >= 0 ? `${i + 1} / ${order.length}` : ''}
        prev={i > 0 ? order[i - 1] : null} next={i >= 0 && i < order.length - 1 ? order[i + 1] : null}
        backLabel={{ board: '보드', list: '목록', meet: '주간 회의' }[view] || '보드'}
        onGo={setOpenId} onBack={() => setOpenId(null)}
        onStep={setStep} onSave={saveInfo} onLog={addLog} onIssue={setIssue} onDelete={remove} />
    )
  }

  const chip = (on) => `px-3 py-1.5 border-r last:border-r-0 border-slate-200 ${on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">🔬 품질</p>
          <h1 className="text-xl font-extrabold text-slate-900">초도품(FA) 진행관리</h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            초도품 PO 를 받은 뒤 PO 접수 → 자재 → 제작 → 품질 인계 · 성적서 → 고객사 제출 · 승인까지, 단계마다 예정일과 실적일로 봅니다.
            카드를 누르면 그 건의 단계 · 세부 항목 · 이슈 기록이 열립니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportList} title="사내용 — 단계별 예정 · 실적, 비고 · 문의까지"
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📑 엑셀 (사내)</button>
          <button onClick={() => setCustOut(true)} title="고객사에 보낼 영문 진행 보고 — 사내 비고 · 이슈 · 담당자는 빠집니다"
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">📤 고객사 제출용</button>
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
          ['late', '예정일 지남', counts.late, '지금 단계 예정 또는 FA 가능일이 지남 (보류 빼고)', counts.late ? 'warn' : ''],
          ['issue', '열린 이슈', counts.issue, `이슈가 해결 안 된 건 · 고객사 문의 대기 ${counts.inquiry}`, counts.issue ? 'warn' : ''],
          ['hold', '보류', counts.hold, '진행을 멈춘 건', ''],
          ['week', '이번 주 예정', counts.week, `${md(today)} ~ ${md(in7)} 에 예정된 단계가 있는 건`, ''],
          ['done', '승인 완료', counts.done, '고객사 승인까지 끝', 'ok'],
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

      {/* 보기 · 거르기 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          {[['board', '단계 보드'], ['list', '구분별 목록'], ['meet', '주간 회의']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={chip(view === k)}>{l}</button>
          ))}
        </div>
        {view !== 'meet' && (
          <>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
              {[{ key: '', label: '전체' }, ...FA_TYPES].map((t) => (
                <button key={t.key || 'all'} onClick={() => setTypeF(t.key)} className={`${chip(typeF === t.key)} inline-flex items-center gap-1.5`}>
                  {t.key && <span className={`w-2 h-2 rounded-full ${faTypeTone(t.key).dot}`} />}{t.label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
              {['', ...OWNERS].map((o) => (
                <button key={o || 'all'} onClick={() => setOwnerF(o)} className={chip(ownerF === o)}>{o || '담당 전체'}</button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 품명 · PO · 비고 · 이슈"
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-52" />
          </>
        )}
        {only && <button onClick={() => setOnly('')} className="text-xs text-indigo-600 hover:underline">필터 풀기</button>}
        {view !== 'meet' && <span className="text-xs text-slate-400 ml-auto">{n(base.length)}건</span>}
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
        : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            아직 초도품이 없습니다. 오른쪽 위 「📋 FA 목록 붙여넣기」로 고객사 FA 목록을 붙여 넣으세요.
          </div>
        ) : view === 'meet' ? (
          <Meeting rows={enriched} logs={logs} today={today} in7={in7} canEdit={canEdit} onOpen={setOpenId} onLog={addLog} />
        ) : view === 'list' ? (
          <FaList groups={groups} fold={fold} setFold={setFold} onOpen={setOpenId} />
        ) : (
          <Board columns={columns} today={today} canEdit={canEdit} onOpen={setOpenId} onPass={pass} showDone={only === 'done'} />
        )}

      {paste && (
        <PasteModal rows={rows} csId={ax?.id || null} me={me} onClose={() => setPaste(false)}
          onDone={() => { reload(); setPaste(false) }} />
      )}
      {custOut && (
        <CustomerExport view={base} all={enriched} today={today} filtered={!!(q || typeF || ownerF || only)}
          onClose={() => setCustOut(false)} />
      )}
    </div>
  )
}

/* ───────── 고객사 제출용 내보내기 ───────── */
function CustomerExport({ view, all, today, filtered, onClose }) {
  const [scope, setScope] = useState(filtered ? 'view' : 'all')
  const [withDone, setWithDone] = useState(true)
  const [busy, setBusy] = useState(false)
  const since = ymdKST(new Date(Date.now() - 30 * 86400000))
  // 최근 30일 안에 승인된 건 — 고객사도 「끝났다」를 확인할 수 있게
  const recentDone = all.filter((r) => r._approved && (r.steps?.g_approve?.d || '') >= since)
  const list = useMemo(() => {
    const baseList = scope === 'view' ? view.filter((r) => !r._approved) : all.filter((r) => !r._approved)
    return withDone ? [...baseList, ...recentDone.filter((r) => !baseList.includes(r))] : baseList
  }, [scope, withDone, view, all, recentDone])
  const rows = useMemo(() => customerRows(list), [list])
  const noNote = list.filter((r) => !r.cust_note && (r.hold || r._late)).length

  async function run() {
    setBusy(true)
    try {
      const n = await exportFaCustomer(list, { asOf: today, customer: 'Axcelis Technologies' })
      toastSuccess(`고객사 제출용 ${n}건을 내려받았습니다`)
      onClose()
    } catch (e) { toastError(e.message) }
    finally { setBusy(false) }
  }

  const summary = customerSummary(rows)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-6xl rounded-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">📤 고객사 제출용 — FA Status Report (영문 엑셀)</h3>
          <p className="text-xs text-slate-500 mt-1">
            고객사가 볼 것만 간단히 — 품목 · SRev · BRev · PO · 품명 · 상태 · FA 예정일 · 제출일 · Remarks.
            상태는 6가지로 묶어 나갑니다 (Material Prep · In Build · Inspection · Submitted · Approved · On Hold).
          </p>
          <p className="text-xs text-rose-700 mt-1 font-semibold">
            사내 정보는 들어가지 않습니다 — 비고 · 이슈 · 문의 기록 · 담당자 · 우선순위 · 세부 체크. Remarks 에는 건 상세의 「고객사 코멘트 (영문)」만 나갑니다.
          </p>
        </div>
        <div className="px-5 py-3 flex items-center gap-4 flex-wrap text-sm border-b border-slate-100">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
            <button onClick={() => setScope('all')} className={`px-3 py-1.5 border-r border-slate-200 ${scope === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500'}`}>진행 중 전체</button>
            <button onClick={() => setScope('view')} className={`px-3 py-1.5 ${scope === 'view' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500'}`}>지금 거른 것만</button>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.target.checked)} /> 최근 30일 승인된 건도 넣기 ({recentDone.length})
          </label>
          <span className="ml-auto text-xs text-slate-500">{rows.length}건</span>
        </div>
        {noNote > 0 && (
          <div className="mx-5 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ 늦거나 보류인데 「고객사 코멘트」가 비어 있는 건이 {noNote}건 있습니다 — 고객사가 이유를 물을 수 있으니 건 상세에서 영문으로 한 줄 적어 두면 좋습니다.
          </div>
        )}
        <div className="px-5 pt-3 flex items-center gap-4 flex-wrap text-xs text-slate-500">
          {summary.map(([k, n]) => <span key={k}>{k} <b className="text-sm text-slate-900">{n}</b></span>)}
        </div>
        <div className="px-5 py-3 max-h-[55vh] overflow-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-slate-800 text-white">
                {['No.', ...CUST_COLS].map((h) => <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.Item}-${r['PO No.']}`} className="border-b border-slate-100">
                  <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                  {CUST_COLS.map((h) => (
                    <td key={h} className={`px-2 py-1 ${h === 'Item' ? 'font-mono font-bold' : ''} ${h === 'Description' || h === 'Remarks' ? 'max-w-[260px] truncate' : 'whitespace-nowrap'}`}
                      title={String(r[h] || '')}>
                      {h === 'Status'
                        ? <span className={`inline-block px-2 py-0.5 rounded font-bold ${custTone(r.Status)?.tw || ''}`}>{r.Status}</span>
                        : r[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">닫기</button>
          <button onClick={run} disabled={busy || !rows.length}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '만드는 중…' : `영문 엑셀 내려받기 — ${rows.length}건`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── 단계 보드 ───────── */
function Board({ columns, today, canEdit, onOpen, onPass, showDone }) {
  if (showDone) return <p className="py-6 text-center text-sm text-slate-400">승인 완료 건은 「구분별 목록」에서 보세요.</p>
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(150px, 1fr))`, minWidth: columns.length * 156 }}>
        {columns.map((c) => (
          <div key={c.k} className="rounded-xl bg-slate-100 p-2 flex flex-col gap-2 min-w-0">
            <div className="px-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-extrabold text-slate-800">{c.l}</span>
                <span className="text-xs font-bold text-slate-500 tabular-nums">{c.list.length}</span>
              </div>
              <div className="text-[11px] text-slate-500">{c.owner}{c.late ? <b className="ml-1.5 text-rose-600">늦음 {c.late}</b> : null}</div>
            </div>
            {c.list.length === 0 && <div className="text-center text-xs text-slate-400 py-4">없음</div>}
            {/* 건이 많은 칸은 칸 안에서 내려 본다 — 한 칸 때문에 화면 전체가 길어지지 않게 */}
            <div className="flex flex-col gap-2 max-h-[68vh] overflow-y-auto pr-0.5">
            {c.list.map((r) => {
              const p = r._cur?.v?.p
              return (
                <div key={r.id} onClick={() => onOpen(r.id)}
                  className={`rounded-lg bg-white p-2 cursor-pointer hover:shadow-sm border ${r._late ? 'border-rose-500 border-2' : r.hold ? 'border-dashed border-slate-400' : 'border-slate-200'}`}>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="font-mono text-[13px] font-bold text-indigo-700">{r.item_code}</span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap" title="이 단계에 들어온 뒤 지난 날">{r._days != null ? `${r._days}일째` : ''}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 truncate" title={r.item_desc || ''}>{r.item_desc}</div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] whitespace-nowrap overflow-hidden">
                    <span className={`text-[10px] font-bold px-1.5 rounded ${faTypeTone(r.fa_type).badge}`}>{faTypeLabel(r.fa_type)}</span>
                    <span className={`truncate ${r._cur?.late ? 'font-bold text-rose-600' : 'text-slate-500'}`}>
                      {r._cur?.late ? `${md(p)} +${r._cur.diff}일 늦음` : p ? `예정 ${md(p)}` : '예정 없음'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                    {r.hold && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-white">보류</span>}
                    <IssueBadge r={r} />
                    <RevTag r={r} />
                    {!r._cur?.late && r._readyLate &&
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">FA 가능일 지남</span>}
                    {r._cur?.subs > 0 && <span className="text-[10px] text-slate-400">세부 {r._cur.subDone}/{r._cur.subs}</span>}
                    {canEdit && (
                      <button onClick={(e) => { e.stopPropagation(); onPass(r) }} title={`「${r._stage.l}」 실적을 오늘로 — 다음 단계로 넘깁니다`}
                        className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-200 text-indigo-700 hover:bg-indigo-50">▶ 넘기기</button>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────── 구분별 목록 ───────── */
function FaList({ groups, fold, setFold, onOpen }) {
  const COLS = [
    { key: 'pri', label: '우선', defaultWidth: 52 },
    { key: 'item', label: '품번 · 품명', defaultWidth: 280 },
    { key: 'rev', label: 'S / B', defaultWidth: 62 },
    { key: 'po', label: 'FA PO', defaultWidth: 100 },
    { key: 'ready', label: 'FA 가능일', defaultWidth: 96 },
    { key: 'stage', label: '지금 단계', defaultWidth: 150 },
    { key: 'plan', label: '단계 예정', defaultWidth: 110 },
    { key: 'pct', label: '진척도', defaultWidth: 130 },
    { key: 'note', label: '이슈 · 비고', defaultWidth: 230 },
  ]
  if (!groups.length) return <p className="py-10 text-center text-sm text-slate-400">조건에 맞는 건이 없습니다</p>
  return (
    <ResizableTable cols={COLS} storageKey="fa-progress-cols3">
      {() => (
        <tbody>
          {groups.map((g) => (
            <FaGroupRows key={g.key} g={g} folded={!!fold[g.key]} colSpan={COLS.length}
              onFold={() => setFold((f) => ({ ...f, [g.key]: !f[g.key] }))} onOpen={onOpen} />
          ))}
        </tbody>
      )}
    </ResizableTable>
  )
}

function FaGroupRows({ g, folded, colSpan, onFold, onOpen }) {
  return (
    <>
      <tr className="bg-slate-100/80 border-b border-slate-200">
        <td colSpan={colSpan} className="px-3 py-2">
          <button onClick={onFold} className="flex items-center gap-3 text-left w-full">
            <span className="text-slate-400 w-3">{folded ? '▸' : '▾'}</span>
            <span className={`px-2.5 py-0.5 rounded-md text-sm font-extrabold ${faTypeTone(g.key).badge}`}>{g.label}</span>
            <span className="text-xs font-bold text-slate-500">{g.list.length}건</span>
            <span className="text-xs text-slate-400">평균 진척도 <b className="text-slate-600">{g.avg}%</b></span>
            {g.late > 0 && <span className="text-xs font-bold text-rose-600">예정일 지남 {g.late}</span>}
          </button>
        </td>
      </tr>
      {!folded && g.list.map((r) => (
        <tr key={r.id} onClick={() => onOpen(r.id)}
          className={`border-b border-slate-100 cursor-pointer ${r.hold ? 'bg-slate-50/70' : 'hover:bg-indigo-50/40'}`}>
          <td className="px-3 py-2 text-center font-bold text-slate-500 tabular-nums">{r.priority ?? ''}</td>
          <td className="px-3 py-2 overflow-hidden">
            <button onClick={(e) => { e.stopPropagation(); onOpen(r.id) }} className="text-left w-full">
              <div className="whitespace-nowrap">
                <span className="font-mono font-bold text-indigo-600 hover:underline">{r.item_code}</span>
                {r.ccn ? <span className="ml-1.5 text-[10px] text-slate-400">CCN {r.ccn}</span> : null}
              </div>
              <div className="text-[11px] text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">{r.item_desc}</div>
            </button>
          </td>
          <td className={`px-3 py-2 font-mono whitespace-nowrap ${revUp(r) ? 'text-rose-600 font-bold' : 'text-slate-500'}`}
            title={revUp(r) ? `PO 발행 Rev(BREV) ${r.brev} → 지금 SREV ${r.srev}` : ''}>{r.srev || '-'} / {r.brev || '-'}</td>
          <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap overflow-hidden">{r.po_number}</td>
          <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis text-slate-600" title={r.fa_ready_text || ''}>
            {r.fa_ready_date ? md(r.fa_ready_date) : <span className="text-[11px] text-slate-400">{r.fa_ready_text || '-'}</span>}
          </td>
          <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
            <span className="font-bold text-slate-700">{r._stage.l}</span>
            {r._stage.owner && <span className="ml-1 text-[10px] text-slate-400">{r._stage.owner}</span>}
          </td>
          <td className={`px-3 py-2 whitespace-nowrap ${r._cur?.late ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
            {r._cur?.v?.p ? md(r._cur.v.p) : '-'}{r._cur?.late ? ` (+${r._cur.diff}일)` : ''}
          </td>
          <td className="px-3 py-2"><ProgressBar pct={r._pct} /></td>
          <td className="px-3 py-2 overflow-hidden">
            <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden">
              {r.hold && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-white">보류</span>}
              <IssueBadge r={r} />
              <span className="text-[11px] text-slate-500 overflow-hidden text-ellipsis">{r._issues[0]?.body || (r.inquiry_open && r.inquiry) || r.note}</span>
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}

/* ───────── 주간 회의 ───────── */
function Meeting({ rows, logs, today, in7, canEdit, onOpen, onLog }) {
  const [memo, setMemo] = useState('')
  const [dec, setDec] = useState({})
  const meets = logs.filter((l) => !l.fa_id && l.kind === '회의')
  const lastMeet = dayOf(meets[0]?.created_at) || ymdKST(new Date(Date.now() - 7 * 86400000))
  const live = rows.filter((r) => !r._approved)

  // ① 막힌 것 — 보류 · 열린 이슈 · 예정일 지남
  const blocks = live.map((r) => {
    const why = []
    if (r.hold) why.push(['보류', 'bg-slate-700 text-white'])
    if (r._issues.length) why.push([`이슈 ${r._issues.length}`, r.inquiry_open ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'])
    else if (r.inquiry_open) why.push(['고객사 문의', 'bg-rose-100 text-rose-800'])
    if (r._cur?.late) why.push([`${r._stage.l} 예정 +${r._cur.diff}일`, 'bg-rose-100 text-rose-800'])
    else if (r._readyLate) why.push([`FA 가능일 ${md(r.fa_ready_date)} 지남`, 'bg-rose-100 text-rose-800'])
    return { r, why }
  }).filter((x) => x.why.length)
  // ② 이번 주 예정 — 예정일이 이번 주인 단계
  const week = live.flatMap((r) => r._weekGates.map((g) => ({ r, g }))).sort((a, b) => a.g.v.p.localeCompare(b.g.v.p))
  // ③ 지난 회의 뒤 바뀐 것 — 그 뒤로 실적이 찍힌 단계
  const moved = rows.flatMap((r) => r._gates.filter((g) => g.done && g.v.d >= lastMeet).map((g) => ({ r, g })))
    .sort((a, b) => b.g.v.d.localeCompare(a.g.v.d))

  async function saveDec(r) {
    if (await onLog(r, '결정', dec[r.id])) { setDec((d) => ({ ...d, [r.id]: '' })); toastSuccess(`${r.item_code} — 결정을 기록했습니다`) }
  }
  async function saveMemo() {
    if (await onLog(null, '회의', memo)) { setMemo(''); toastSuccess('회의 메모를 남겼습니다') }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        기준 {today} · 지난 회의 {meets.length ? lastMeet : '없음 (최근 7일로 봄)'} — 막힌 것부터 보고, 결정은 그 자리에서 적으면 해당 건의 이슈 기록에 남습니다.
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
        <div className="rounded-2xl border-2 border-rose-300 bg-white p-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-extrabold text-rose-700">① 막힌 것 — 먼저 논의</h2>
            <span className="text-xs text-slate-400">{blocks.length}건</span>
          </div>
          {blocks.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">막힌 건이 없습니다</p>}
          {blocks.map(({ r, why }) => (
            <div key={r.id} className="rounded-xl border border-slate-200 p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => onOpen(r.id)} className="font-mono text-sm font-bold text-indigo-700 hover:underline">{r.item_code}</button>
                <div className="flex gap-1 flex-wrap justify-end">{why.map(([t, c]) => <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c}`}>{t}</span>)}</div>
              </div>
              <div className="text-[11px] text-slate-500 truncate">{r.item_desc}</div>
              <div className="text-[11px] text-slate-600">지금 <b>{r._stage.l}</b> · 담당 <b>{r._stage.owner || '-'}</b></div>
              {r._issues.map((i) => (
                <div key={i.id} className="flex items-start gap-1.5 text-[11px]">
                  <span className={`shrink-0 px-1 rounded text-[10px] font-bold ${issueTone(i.cat)}`}>{i.cat || '기타'}</span>
                  <span className="text-slate-700">{i.body}{i.replies.length ? <span className="text-slate-400"> — {i.replies[i.replies.length - 1].body}</span> : null}</span>
                </div>
              ))}
              {canEdit && (
                <div className="flex gap-1">
                  <input value={dec[r.id] || ''} onChange={(e) => setDec((d) => ({ ...d, [r.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveDec(r) }}
                    placeholder="결정 · 누가 · 언제까지" aria-label={`${r.item_code} 결정`}
                    className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 rounded" />
                  <button onClick={() => saveDec(r)} className="px-2 py-1 text-xs font-bold rounded bg-indigo-600 text-white hover:bg-indigo-700">남기기</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-1">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-extrabold text-slate-800">② 이번 주 예정 ({md(today)} ~ {md(in7)})</h2>
            <span className="text-xs text-slate-400">{week.length}건</span>
          </div>
          {week.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">이번 주 예정된 단계가 없습니다 — 건 상세에서 단계 예정일을 넣으세요</p>}
          {week.map(({ r, g }) => (
            <button key={`${r.id}-${g.k}`} onClick={() => onOpen(r.id)}
              className="w-full grid grid-cols-[44px_96px_1fr] items-center gap-2 py-1.5 border-b border-slate-100 text-left hover:bg-slate-50">
              <span className="text-xs font-bold tabular-nums text-slate-600">{md(g.v.p)}</span>
              <span className="font-mono text-xs font-bold text-indigo-700">{r.item_code}</span>
              <span className="text-xs"><b className="text-slate-700">{g.l}</b> <span className="text-slate-400">{g.owner}</span></span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-1">
            <h2 className="text-sm font-extrabold text-slate-800">③ 지난 회의 뒤 바뀐 것</h2>
            {moved.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">{lastMeet} 이후 끝난 단계가 없습니다</p>}
            {moved.map(({ r, g }) => (
              <button key={`${r.id}-${g.k}`} onClick={() => onOpen(r.id)}
                className="w-full grid grid-cols-[44px_96px_1fr] items-center gap-2 py-1.5 border-b border-slate-100 text-left hover:bg-slate-50">
                <span className="text-xs tabular-nums text-slate-500">{md(g.v.d)}</span>
                <span className="font-mono text-xs font-bold text-indigo-700">{r.item_code}</span>
                <span className="text-xs"><b className="text-emerald-700">{g.l}</b> 끝{g.diff > 0 ? <span className="text-rose-600"> (+{g.diff}일)</span> : ''}</span>
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
            <label className="flex flex-col gap-1 text-sm font-extrabold text-slate-800">회의 메모 · 결정 사항
              <textarea disabled={!canEdit} rows={4} value={memo} onChange={(e) => setMemo(e.target.value)}
                placeholder="이번 회의에서 정한 것 — 저장하면 다음 회의의 「지난 회의」 기준이 됩니다"
                className="px-2 py-1.5 text-xs font-normal border border-slate-200 rounded-lg" />
            </label>
            {canEdit && <button onClick={saveMemo} className="w-full py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">회의 메모 저장</button>}
            {meets.slice(0, 3).map((m) => (
              <div key={m.id} className="text-[11px] text-slate-600 border-t border-slate-100 pt-1.5 whitespace-pre-line">
                <span className="text-slate-400">{dayOf(m.created_at)} · {m.created_name || ''}</span>{'\n'}{m.body}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────── 한 건 상세 — 단계 예정 · 실적 + 세부 항목 + 이슈 기록 ───────── */
function FaSheet({ fa, today, canEdit, logs, pos, prev, next, backLabel, onGo, onBack, onStep, onSave, onLog, onIssue, onDelete }) {
  const pick = (f) => ({
    fa_type: f.fa_type || 'PD', priority: f.priority ?? '', fa_ready_date: f.fa_ready_date || '',
    fa_ready_text: f.fa_ready_text || '', note: f.note || '', hold: !!f.hold,
    srev: f.srev || '', brev: f.brev || '', promise_date: f.promise_date || '',
    cust_note: f.cust_note || '',
  })
  const [info, setInfo] = useState(() => pick(fa))
  const [openGate, setOpenGate] = useState(() => fa._stage?.k || null)
  const set = (k, v) => setInfo((s) => ({ ...s, [k]: v }))
  const dirty = JSON.stringify(info) !== JSON.stringify(pick(fa))
  async function save() {
    const ok = await onSave(fa, {
      fa_type: info.fa_type, priority: info.priority === '' ? null : Number(info.priority),
      fa_ready_date: info.fa_ready_date || null, fa_ready_text: info.fa_ready_text.trim() || null,
      note: info.note.trim() || null, hold: info.hold,
      srev: info.srev.trim() || null, brev: info.brev.trim() || null, promise_date: info.promise_date || null,
      // 고객사 코멘트는 고쳤을 때만 보낸다 (칸을 만드는 SQL 을 아직 안 돌렸어도 나머지 저장은 되게)
      ...(info.cust_note !== (fa.cust_note || '') ? { cust_note: info.cust_note.trim() || null } : {}),
    })
    if (ok && info.fa_type !== fa.fa_type) toastSuccess('구분을 바꿔 단계 · 세부 항목이 바뀌었습니다 (넣은 값은 남아 있습니다)')
    // Rev 가 바뀌었으면 기록에 남긴다 — 언제 · 누가 · 무엇에서 무엇으로
    const rd = revDiff(fa, { srev: info.srev.trim(), brev: info.brev.trim() })
    if (ok && rd.length) await onLog(fa, 'Rev', `${rd.join(' · ')} (직접 수정)`)
  }
  const go = (id) => { if (dirty && !window.confirm('저장하지 않은 정보가 있습니다. 그냥 넘어갈까요?')) return; onGo(id) }

  const gates = gateInfo(fa, today)
  const pct = faProgress(fa)
  const delay = faDelay(fa, today)
  const stage = faStage(fa)

  // 막대 축 — 예정 · 실적 · 오늘 중 가장 이른 날 ~ 가장 늦은 날
  const dates = gates.flatMap((g) => [g.v.p, g.v.d]).filter(Boolean).concat(today).sort()
  const a0 = dates[0], a1 = dates[dates.length - 1]
  const span = Math.max(dayDiff(a0, a1) + 4, 14)
  const x = (d) => ((dayDiff(a0, d) + 2) / span) * 100
  const bar = (from, to) => (from && to ? { left: `${x(from)}%`, width: `${Math.max(x(to) - x(from), 1.5)}%` } : null)

  async function exportOne() {
    const out = [
      { 단계: '정보', 담당: '', 예정: '', 실적: '', 차이: '', 내용: `${fa.item_code} ${fa.item_desc || ''} · FA PO ${fa.po_number} · REV ${fa.srev || '-'}/${fa.brev || '-'}` },
    ]
    gates.forEach((g) => {
      out.push({ 단계: g.l, 담당: g.owner, 예정: g.v.p || '', 실적: g.v.d || '', 차이: g.diff ? `${g.diff > 0 ? '+' : ''}${g.diff}일` : '', 내용: g.v.m || '' })
      stepsOf(fa.fa_type, g.k).forEach((s) => {
        const v = fa.steps?.[s.k] || {}
        out.push({ 단계: '', 담당: '', 예정: '', 실적: v.d || '', 차이: '', 내용: `· ${stepLabel(s, fa.fa_type)} — ${stepText(s, v) || '미착수'}${v.m ? ` (${v.m})` : ''}` })
      })
    })
    const { issues, notes } = splitFaLogs(logs)
    issues.forEach((i) => {
      out.push({ 단계: '이슈', 담당: i.created_name || '', 예정: '', 실적: dayOf(i.created_at), 차이: i.open ? '열림' : `해결 ${dayOf(i.closed_at)}`, 내용: `[${i.cat || '기타'}] ${i.body}` })
      i.replies.forEach((r) => out.push({ 단계: '', 담당: r.created_name || '', 예정: '', 실적: dayOf(r.created_at), 차이: r.kind, 내용: `  └ ${r.body}` }))
    })
    notes.slice().reverse().forEach((l) => out.push({ 단계: '기록', 담당: l.created_name || '', 예정: '', 실적: dayOf(l.created_at), 차이: l.kind, 내용: l.body }))
    try {
      await downloadSheet({ rows: out, fileName: `초도품_${fa.item_code}_${today}.xlsx`, sheetName: fa.item_code,
        title: `초도품 진행 — ${fa.item_code} (${faTypeLabel(fa.fa_type)}) · 진척도 ${pct}%` })
    } catch (e) { toastError(e.message) }
  }

  const inp = 'px-2 py-1.5 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50'
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => go(null)} className="px-3 py-1.5 text-sm font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">← {backLabel}</button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400 tabular-nums">{pos}</span>
          <button onClick={() => prev && go(prev.id)} disabled={!prev} title={prev ? `${prev.item_code} ${prev.item_desc || ''}` : ''}
            className="px-3 py-1.5 text-sm font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30">◀ 이전 건</button>
          <button onClick={() => next && go(next.id)} disabled={!next} title={next ? `${next.item_code} ${next.item_desc || ''}` : ''}
            className="px-3 py-1.5 text-sm font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30">다음 건 ▶</button>
          <button onClick={exportOne}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📑 이 건 엑셀</button>
        </div>
      </div>

      {/* 머리 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-400 flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${faTypeTone(fa.fa_type).badge}`}>{faTypeLabel(fa.fa_type)}</span>
            <span>CCN {fa.ccn || '-'} · FA PO <span className="font-mono text-slate-600">{fa.po_number}</span></span>
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-extrabold font-mono text-slate-900">{fa.item_code}</h1>
            <span className="text-base text-slate-600">{fa.item_desc}</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            SREV <b className="font-mono text-slate-700">{fa.srev || '-'}</b> · BREV <b className="font-mono text-slate-700">{fa.brev || '-'}</b>
            <span className="mx-2 text-slate-300">|</span>납기 <b className="text-slate-700">{fa.promise_date || '-'}</b>
            <span className="mx-2 text-slate-300">|</span>FA 가능일 <b className="text-slate-700">{fa.fa_ready_date || fa.fa_ready_text || '-'}</b>
            {fa.hold && <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold bg-slate-700 text-white">보류</span>}
            {fa._issues?.length > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${fa.inquiry_open ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
                열린 이슈 {fa._issues.length}{fa.inquiry_open ? ' · 고객사 문의 대기' : ''}
              </span>
            )}
            {revUp(fa) && <span className="ml-2"><RevTag r={fa} /></span>}
          </div>
        </div>
        <div className="flex gap-2">
          <div className="rounded-xl bg-indigo-50 px-4 py-2 text-right">
            <div className="text-xs font-bold text-indigo-700">지금 단계</div>
            <div className="text-lg font-extrabold text-indigo-900">{stage.k === 'done' ? '승인 완료' : stage.l}</div>
            <div className="text-[11px] text-indigo-700">{stage.owner}</div>
          </div>
          <div className={`rounded-xl px-4 py-2 text-right ${delay > 0 ? 'bg-rose-50' : 'bg-slate-50'}`}>
            <div className={`text-xs font-bold ${delay > 0 ? 'text-rose-700' : 'text-slate-500'}`}>예정 대비</div>
            <div className={`text-lg font-extrabold ${delay > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
              {delay == null ? '예정 없음' : delay > 0 ? `+${delay}일 늦음` : delay < 0 ? `${-delay}일 빠름` : '예정대로'}
            </div>
            <div className="text-[11px] text-slate-500">진척도 {pct}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
        {/* 단계 예정 · 실적 */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-extrabold text-slate-800">단계별 예정 · 실적</h2>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="w-4 h-2 rounded bg-indigo-200" />예정</span>
              <span className="inline-flex items-center gap-1"><span className="w-4 h-2 rounded bg-indigo-700" />실적</span>
              <span className="inline-flex items-center gap-1"><span className="w-0.5 h-3 bg-rose-600" />오늘 {md(today)}</span>
            </div>
          </div>
          <div className="grid grid-cols-[150px_142px_142px_56px_1fr] gap-2 px-4 py-1.5 text-[11px] font-bold text-slate-400 border-b border-slate-100">
            <div>단계 · 담당</div><div>예정</div><div>실적</div><div className="text-right">차이</div><div>{md(a0)} ~ {md(a1)}</div>
          </div>
          {gates.map((g, i) => {
            const prevP = i > 0 ? gates[i - 1].v.p : null
            const prevD = i > 0 ? (gates[i - 1].v.d || gates[i - 1].v.p) : null
            const pb = bar(prevP || g.v.p, g.v.p)
            const ab = g.done ? bar(prevD || g.v.d, g.v.d) : g.cur && prevD ? bar(prevD, today) : null
            const subs = stepsOf(fa.fa_type, g.k)
            const opened = openGate === g.k
            return (
              <div key={g.k} className={`border-b border-slate-100 ${g.cur ? 'bg-indigo-50/40' : ''}`}>
                <div className="grid grid-cols-[150px_142px_142px_56px_1fr] gap-2 px-4 py-2 items-center text-sm">
                  <div className="min-w-0">
                    <div className={`font-bold ${g.done ? 'text-emerald-700' : g.cur ? 'text-indigo-700' : 'text-slate-700'}`}>{g.done ? '✔ ' : ''}{g.l}</div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      {g.owner}
                      {subs.length > 0 && (
                        <button onClick={() => setOpenGate(opened ? null : g.k)} className="text-indigo-600 hover:underline font-semibold">
                          세부 {g.subDone}/{g.subs} {opened ? '▴' : '▾'}
                        </button>
                      )}
                    </div>
                  </div>
                  <input disabled={!canEdit} type="date" value={g.v.p || ''} aria-label={`${g.l} 예정일`}
                    onChange={(e) => onStep(fa, g.k, { ...g.v, p: e.target.value })}
                    className={`px-1.5 py-1 border rounded text-xs ${g.late ? 'border-rose-400 text-rose-600' : 'border-slate-200 text-slate-600'}`} />
                  <div className="flex items-center gap-1">
                    <input disabled={!canEdit} type="date" value={g.v.d || ''} aria-label={`${g.l} 실적일`}
                      onChange={(e) => onStep(fa, g.k, { ...g.v, d: e.target.value })}
                      className="w-full px-1.5 py-1 border border-slate-200 rounded text-xs text-slate-700" />
                    {canEdit && !g.done && (
                      <button onClick={() => onStep(fa, g.k, { ...g.v, d: today })} title="실적을 오늘로"
                        className="px-1.5 py-1 text-[10px] font-bold rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 whitespace-nowrap">오늘</button>
                    )}
                  </div>
                  <div className={`text-right text-xs font-bold tabular-nums ${g.diff > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {g.diff == null ? '' : g.diff > 0 ? `+${g.diff}` : g.diff}
                  </div>
                  <div className="relative h-6">
                    {pb && <div className="absolute top-0.5 h-2 rounded bg-indigo-200" style={pb} />}
                    {ab && <div className={`absolute top-3 h-2 rounded ${g.done ? 'bg-indigo-700' : 'bg-indigo-400'}`} style={ab} />}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500" style={{ left: `${x(today)}%` }} />
                  </div>
                </div>
                {opened && subs.length > 0 && (
                  <div className="mx-4 mb-2 rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                    {subs.map((s) => <StepRow key={`${fa.id}-${s.k}`} fa={fa} step={s} canEdit={canEdit} onStep={onStep} />)}
                  </div>
                )}
              </div>
            )
          })}
          <p className="px-4 py-2 text-[11px] text-slate-400">
            실적일을 넣으면 그 단계가 끝나고 다음 단계로 넘어갑니다. 「세부」를 누르면 품질이 챙기는 하위 항목(도면 · JIG · 케이블 · 성적서 …)이 열립니다.
          </p>
        </div>

        {/* 이슈 · 정보 */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <IssuePanel fa={fa} logs={logs} today={today} canEdit={canEdit} onLog={onLog} onIssue={onIssue} />

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 text-xs">
            <div className="text-sm font-extrabold text-slate-800">정보</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">구분</span>
                <select disabled={!canEdit} value={info.fa_type} onChange={(e) => set('fa_type', e.target.value)} className={inp}>
                  {FA_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select></label>
              <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">우선순위</span>
                <input disabled={!canEdit} type="number" min="1" value={info.priority} onChange={(e) => set('priority', e.target.value)} className={inp} /></label>
              <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold" title="지금 고객사 Rev — 바뀔 수 있다">SREV (현재)</span>
                <input disabled={!canEdit} value={info.srev} onChange={(e) => set('srev', e.target.value)} className={inp} /></label>
              <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold" title="PO 발행 시점 Rev — 제작은 최소 BREV 까지">BREV (PO 발행)</span>
                <input disabled={!canEdit} value={info.brev} onChange={(e) => set('brev', e.target.value)} className={inp} /></label>
              <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">납기 (Promise)</span>
                <input disabled={!canEdit} type="date" value={info.promise_date} onChange={(e) => set('promise_date', e.target.value)} className={inp} /></label>
              <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">FA 가능일</span>
                <input disabled={!canEdit} type="date" value={info.fa_ready_date} onChange={(e) => set('fa_ready_date', e.target.value)} className={inp} /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">가능일 메모 (날짜 대신)</span>
              <input disabled={!canEdit} value={info.fa_ready_text} placeholder="내부 협의 등" onChange={(e) => set('fa_ready_text', e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-1"><span className="text-slate-400 font-semibold">비고 (사내)</span>
              <textarea disabled={!canEdit} rows={2} value={info.note} onChange={(e) => set('note', e.target.value)} className={inp} /></label>
            <label className="flex flex-col gap-1"><span className="text-indigo-600 font-semibold">고객사 코멘트 (영문 · 고객사 제출용 Remarks 에 그대로 나감)</span>
              <textarea disabled={!canEdit} rows={2} value={info.cust_note} placeholder="e.g. Waiting for connector delivery (ETA 10/02)"
                onChange={(e) => set('cust_note', e.target.value)} className={inp} /></label>
            <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
              <input disabled={!canEdit} type="checkbox" checked={info.hold} onChange={(e) => set('hold', e.target.checked)} /> 보류
            </label>
            {canEdit && (
              <div className="flex gap-2 pt-1">
                <button onClick={save} disabled={!dirty}
                  className="flex-1 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">정보 저장</button>
                <button onClick={() => onDelete(fa)} className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300">삭제</button>
              </div>
            )}
            <div className="text-[10.5px] text-slate-400">등록 {fa.created_name || '-'} · {String(fa.created_at || '').slice(0, 10)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────── 이슈 (건마다 여러 개) + 진행 기록 ───────── */
function IssuePanel({ fa, logs, today, canEdit, onLog, onIssue }) {
  const { issues, open, notes } = useMemo(() => splitFaLogs(logs), [logs])
  const closed = issues.filter((i) => !i.open)
  const [cat, setCat] = useState(CUST_CAT)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [showDone, setShowDone] = useState(false)
  async function add() { if (await onLog(fa, '이슈', text, { cat })) setText('') }
  async function addNote(kind) { if (await onLog(fa, kind, note)) setNote('') }
  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-extrabold text-slate-800">이슈</h2>
          <span className="text-[11px] text-slate-400">열림 <b className={open.length ? 'text-rose-600' : 'text-slate-500'}>{open.length}</b> · 해결 {closed.length}</span>
        </div>
        {canEdit && (
          <div className="rounded-xl bg-slate-50 p-2 space-y-1.5">
            <div className="flex flex-wrap gap-1" role="group" aria-label="이슈 분류">
              {FA_ISSUE_CATS.map((c) => (
                <button key={c.k} onClick={() => setCat(c.k)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${cat === c.k ? `${c.tone} border-transparent` : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'}`}>{c.k}</button>
              ))}
            </div>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="새 이슈"
              placeholder="이슈 한 가지 — 여러 개면 하나씩 따로 등록 (따로 해결 처리됩니다)"
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white" />
            <button onClick={add} className="w-full py-1.5 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900">+ 「{cat}」 이슈 등록</button>
          </div>
        )}
        {open.length === 0 && <p className="py-2 text-center text-xs text-slate-400">열린 이슈가 없습니다</p>}
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {open.map((i) => <IssueCard key={i.id} fa={fa} i={i} today={today} canEdit={canEdit} onLog={onLog} onIssue={onIssue} />)}
          {closed.length > 0 && (
            <button onClick={() => setShowDone(!showDone)} className="text-[11px] font-semibold text-slate-500 hover:underline">
              해결된 이슈 {closed.length} {showDone ? '▴' : '▾'}
            </button>
          )}
          {showDone && closed.map((i) => <IssueCard key={i.id} fa={fa} i={i} today={today} canEdit={canEdit} onLog={onLog} onIssue={onIssue} />)}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-sm font-extrabold text-slate-800">진행 기록 <span className="text-[11px] font-semibold text-slate-400">결정 · 메모 · Rev 변경 · 자재 매칭</span></h2>
        {canEdit && (
          <div className="flex gap-1">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="진행 메모 · 결정" aria-label="진행 기록"
              className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
            <button onClick={() => addNote('결정')} className="px-2 py-1 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">결정</button>
            <button onClick={() => addNote('기록')} className="px-2 py-1 text-xs font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800">기록</button>
          </div>
        )}
        <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
          {notes.length === 0 && <p className="py-3 text-center text-xs text-slate-400">기록이 없습니다</p>}
          {notes.map((l) => (
            <div key={l.id} className="py-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${LOG_TONE[l.kind] || LOG_TONE.기록}`}>{l.kind}</span>
                <span className="text-[10px] text-slate-400">{dayOf(l.created_at)} · {l.created_name || ''}</span>
              </div>
              <div className="mt-0.5 text-slate-700 whitespace-pre-line">{l.body}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function IssueCard({ fa, i, today, canEdit, onLog, onIssue }) {
  const [t, setT] = useState('')
  const cust = i.cat === CUST_CAT
  const kind = cust ? '답변' : '진행'
  async function reply() { if (await onLog(fa, kind, t, { parent_id: i.id })) setT('') }
  // 적어 둔 말이 있으면 해결 내용으로 남기고 닫는다
  async function resolve() {
    if (t.trim()) { if (!(await onLog(fa, '해결', t, { parent_id: i.id }))) return; setT('') }
    await onIssue(i, 'close')
  }
  const age = dayDiff(dayOf(i.created_at), today)
  return (
    <div className={`rounded-xl border p-2 ${i.open ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`} data-issue={i.id}>
      <div className="flex items-start gap-1.5">
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${issueTone(i.cat)}`}>{i.cat || '기타'}</span>
        <div className={`flex-1 text-xs whitespace-pre-line ${i.open ? 'text-slate-800 font-semibold' : 'text-slate-500'}`}>{i.body}</div>
        {!i.open && <span className="shrink-0 text-[10px] font-bold text-emerald-700">✔ 해결</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400">
        {dayOf(i.created_at)} · {i.created_name || ''}
        {i.open ? (age != null && age > 0 ? <span className={age >= 7 ? 'text-rose-500 font-bold' : ''}> · {age}일째</span> : null)
          : ` · 해결 ${dayOf(i.closed_at)} ${i.closed_name || ''}`}
      </div>
      {i.replies.map((r) => (
        <div key={r.id} className="mt-1 ml-2 pl-2 border-l-2 border-slate-200 text-[11px]">
          <span className={`px-1 rounded text-[10px] font-bold ${LOG_TONE[r.kind] || LOG_TONE.기록}`}>{r.kind}</span>
          <span className="ml-1 text-[10px] text-slate-400">{dayOf(r.created_at)} · {r.created_name || ''}</span>
          <div className="text-slate-700 whitespace-pre-line">{r.body}</div>
        </div>
      ))}
      {canEdit && (
        <div className="mt-1.5 flex items-center gap-1">
          {i.open ? (
            <>
              <input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') reply() }}
                placeholder={cust ? '고객사 답변 · 진행' : '진행 · 조치'} aria-label={`이슈 ${i.id} 답변`}
                className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-slate-200 rounded" />
              <button onClick={reply} className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 text-slate-600 hover:bg-slate-50">{kind}</button>
              <button onClick={resolve} title="적은 내용이 있으면 해결 내용으로 남기고 닫습니다"
                className="px-2 py-1 text-[11px] font-bold rounded bg-emerald-600 text-white hover:bg-emerald-700">해결</button>
            </>
          ) : (
            <button onClick={() => onIssue(i, 'reopen')} className="text-[11px] font-semibold text-indigo-600 hover:underline">다시 열기</button>
          )}
          <button onClick={() => onIssue(i, 'delete')} title="잘못 등록한 이슈 지우기" className="ml-auto text-[10px] text-slate-300 hover:text-rose-600">지우기</button>
        </div>
      )}
    </div>
  )
}

function StepRow({ fa, step, canEdit, onStep }) {
  const v = fa.steps?.[step.k] || {}
  const st = stepState(step, v)
  const [memo, setMemo] = useState(v.m || '')
  const [pct, setPct] = useState(v.p ?? '')
  useEffect(() => { setPct(v.p ?? '') }, [v.p])
  useEffect(() => { setMemo(v.m || '') }, [v.m])
  const nav = useNavigate()
  const put = (patch) => onStep(fa, step.k, { ...v, ...patch })
  function pick(s) {
    if (s === 'done') put({ s: 'done', d: v.d || todayISO(), ...(step.kind === 'pct' ? { p: 100 } : {}) })
    else if (s === '') onStep(fa, step.k, v.m ? { m: v.m } : null)
    else if (s === 'doing') put({ s: 'doing', ...(step.kind === 'pct' && Number(v.p) >= 100 ? { p: '' } : {}) })
    else put({ s })
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs flex-wrap">
      <div className={`w-48 font-semibold ${st === 'na' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{stepLabel(step, fa.fa_type)}</div>
      <div className="inline-flex rounded-lg overflow-hidden border border-slate-200">
        {STATE_BTN.map(([k, l]) => (
          <button key={k || 'none'} disabled={!canEdit} onClick={() => pick(k)}
            className={`px-2 py-1 border-r last:border-r-0 font-bold ${st === k ? STATE_TONE[k] : 'bg-white text-slate-400 hover:text-slate-600'} disabled:cursor-default`}>{l}</button>
        ))}
      </div>
      {step.kind === 'pct' && (
        <label className="inline-flex items-center gap-1 text-slate-400">
          <input disabled={!canEdit || st === 'na'} type="number" min="0" max="100" value={pct} aria-label={`${stepLabel(step, fa.fa_type)} 진척률`}
            onChange={(e) => setPct(e.target.value)}
            onBlur={() => { if (String(pct) !== String(v.p ?? '')) put({ p: pct === '' ? '' : Math.max(0, Math.min(100, Number(pct))) }) }}
            className="w-14 px-1.5 py-1 text-right border border-slate-200 rounded" />%
        </label>
      )}
      <input disabled={!canEdit || st === 'na'} type="date" value={v.d || ''} title={st === 'done' ? '완료일' : '예정일'} aria-label={`${stepLabel(step, fa.fa_type)} 날짜`}
        onChange={(e) => put({ d: e.target.value })}
        className="px-1.5 py-1 border border-slate-200 rounded text-slate-600" />
      <input disabled={!canEdit} value={memo} placeholder="메모" aria-label={`${stepLabel(step, fa.fa_type)} 메모`}
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => { if (memo !== (v.m || '')) put({ m: memo.trim() }) }}
        className="flex-1 min-w-[120px] px-2 py-1 border border-slate-200 rounded" />
      <span className="w-24 text-right text-[10px] text-slate-400 whitespace-nowrap">
        {v.by ? `${v.by} · ${String(v.at || '').slice(5, 10).replace('-', '/')}` : ''}
      </span>
      {step.link === 'fai' && (
        <div className="basis-full flex items-center gap-2 pl-[12.5rem] -mt-0.5">
          <button onClick={() => nav(`/quality/fai?fa=${fa.id}`)}
            className="px-2 py-0.5 text-[11px] font-bold rounded border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100">🧾 초도품 자재 매칭 열기</button>
          {v.rev ? (() => { const c = revCheck(v.rev, fa); return <span className={`text-[11px] ${c.ok === false ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>Part Report {c.t}</span> })()
            : <span className="text-[11px] text-slate-400">Part Report 를 올려 판정한 뒤 「결과 반영」을 누르면 여기로 들어옵니다</span>}
        </div>
      )}
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
  const revChg = upds.map((r) => { const old = exist.get(`${r.po_number}|${r.item_code}`); return { r, old, d: revDiff(old, r) } }).filter((x) => x.d.length)
  const revOf = new Map(revChg.map((x) => [`${x.r.po_number}|${x.r.item_code}`, x.d]))

  async function run() {
    if (!parsed.rows.length) return
    setBusy(true)
    try {
      const base = (r, old) => ({
        customer_id: old?.customer_id || csId,
        ccn: r.ccn, product: r.product, item_code: r.item_code, po_number: r.po_number,
        item_desc: r.item_desc || old?.item_desc || null,
        srev: r.srev || old?.srev || null, brev: r.brev || old?.brev || null, buy_um: r.buy_um,
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
        // 새 건 — PO 는 받은 것이니 「PO 접수」는 오늘로 끝, FA 가능일은 「고객사 제출」 예정일로
        const today = todayISO()
        must(await supabase.from('pm_fa').insert(news.map((r) => ({
          ...base(r, null), created_name: me?.name || null,
          steps: { g_po: { d: today }, ...(r.fa_ready_date ? { g_submit: { p: r.fa_ready_date } } : {}) },
        }))), '초도품 등록')
      }
      if (upds.length) {
        must(await supabase.from('pm_fa').upsert(
          upds.map((r) => base(r, exist.get(`${r.po_number}|${r.item_code}`))),
          { onConflict: 'po_number,item_code' }), '초도품 갱신')
      }
      // Rev 가 바뀐 건은 그 건 기록에 남긴다 (목록 값이 바뀐 날 = 알게 된 날)
      if (revChg.length) {
        must(await supabase.from('pm_fa_log').insert(revChg.map(({ old, d }) => ({
          fa_id: old.id, kind: 'Rev', body: `${d.join(' · ')} (FA 목록 붙여넣기)`, created_name: me?.name || null,
        }))), 'Rev 변경 기록')
      }
      toastSuccess(`새로 ${news.length}건 · 갱신 ${upds.length}건${revChg.length ? ` · Rev 변경 ${revChg.length}건` : ''}`)
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
            새 건은 「PO 접수」가 오늘로 끝나고, FA 가능일이 「고객사 제출」 예정일로 들어갑니다. 같은 PO · 품번이 이미 있으면 Rev · 납기 · 가능일 · 비고만 갱신하고 단계 · 체크는 그대로 둡니다. 목록에서 빈 칸은 포털 값을 지우지 않습니다.
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
                {revChg.length > 0 && <> · <b className="text-sky-700">Rev 변경 {revChg.length}</b> <span className="text-slate-400">(건 기록에 남음)</span></>}
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
                          <td className="px-2 py-1"><span className={`px-1.5 rounded font-bold ${faTypeTone(old?.fa_type || r.fa_type).badge}`}>{faTypeLabel(old?.fa_type || r.fa_type)}</span></td>
                          <td className="px-2 py-1 font-mono">{r.item_code}</td>
                          <td className="px-2 py-1 max-w-[220px] truncate">{r.item_desc}</td>
                          <td className={`px-2 py-1 font-mono ${revOf.has(`${r.po_number}|${r.item_code}`) ? 'text-sky-700 font-bold' : ''}`}
                            title={(revOf.get(`${r.po_number}|${r.item_code}`) || []).join(' · ')}>{r.srev || '-'}/{r.brev || '-'}</td>
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
