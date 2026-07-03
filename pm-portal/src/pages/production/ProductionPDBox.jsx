import { useState, useMemo, useRef } from 'react'
import { isMainPn, MAIN_PNS } from './mainPns'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { exportPDBoxCSV, parsePDBoxCSV, SCHED_FIELDS } from '../../lib/pdboxCSV'

const STATUS_OPTS = ['PO접수', '자재발주', '제작중', '품질검수', '납품대기', '완료']
const STATUS_COLOR = {
  'PO접수': 'bg-slate-100 text-slate-600', '자재발주': 'bg-cyan-50 text-cyan-600',
  '제작중': 'bg-blue-50 text-blue-600', '품질검수': 'bg-violet-50 text-violet-600',
  '납품대기': 'bg-amber-50 text-amber-700', '완료': 'bg-emerald-50 text-emerald-700',
}
const dayMs = 86400000
function dday(d) { if (!d) return null; const x = new Date(String(d).slice(0, 10)); if (isNaN(x)) return null; return Math.round((x.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / dayMs) }
function ddayCls(n) { if (n == null) return 'text-slate-300'; if (n < 0) return 'text-red-600 font-bold'; if (n <= 7) return 'text-orange-600 font-bold'; if (n <= 14) return 'text-yellow-600 font-semibold'; return 'text-emerald-600' }
function md(d) { return d ? String(d).slice(5, 10) : '' }
function truthy(v) { return v === true || (typeof v === 'string' && v.trim() && v !== 'false') }

// ── 역산 상수 (영업일) — 필요시 여기만 조정 ──
const QC_LEAD_BD = 2  // 납품 전 품질 '완료요청' 여유
const QC_DUR_BD  = 2  // 품질 검사 기간 → 전장 완료예정 = 품질요청 - 이 값

// 영업일 빼기 (주말 제외)
function bdMinus(dateStr, n) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
  if (isNaN(d)) return null
  let left = Math.max(0, Math.round(n))
  while (left > 0) { d.setDate(d.getDate() - 1); const w = d.getDay(); if (w !== 0 && w !== 6) left-- }
  return d.toISOString().slice(0, 10)
}
// 역산: 품질 완료요청일 / 전장 완료예정일 / 전장 시작일(부하용)
function calcQuality(r) { return bdMinus(r.req_date, QC_LEAD_BD) }
function calcElec(r, qcMd) { return r.elec_done || bdMinus(calcQuality(r), Math.max(1, Math.ceil(Number(qcMd) || QC_DUR_BD))) }
function calcElecStart(r, qcMd, asmMd) { return bdMinus(calcElec(r, qcMd), Math.max(1, Math.ceil(Number(asmMd) || 1))) }
// 주차 키 (해당 주 월요일)
function weekKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00'); if (isNaN(d)) return null
  const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w)
  return d.toISOString().slice(0, 10)
}

// ① 상태 자동 전이 — 체크가 상태를 끌고 감 (승격만, 강등 없음 / 완료는 불가침)
const ST_RANK = { 'PO접수': 0, '자재발주': 1, '제작중': 2, '품질검수': 3, '납품대기': 4, '완료': 5 }
function autoStatus(row, field, value) {
  if (!row || row.status === '완료') return null
  const h = field === 'harness_recv' ? value : truthy(row.harness_recv)
  const p = field === 'part_issue' ? value : truthy(row.part_issue)
  const e = field === 'elec_recv' ? value : truthy(row.elec_recv)
  const q = field === 'quality_recv' ? value : truthy(row.quality_recv)
  let target = null
  if (q) target = '납품대기'
  else if (e) target = '품질검수'
  else if (h && p) target = '제작중'
  if (target && (ST_RANK[target] ?? 0) > (ST_RANK[row.status] ?? 0)) return target
  return null
}

// 납기변동 태그: 비고의 A→B 기록에서 최초 원납기 vs 현재 납품일 차이(일)
function delayTag(note, reqDate) {
  if (!note || !reqDate) return null
  const full = String(note)
  const re = /(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\s*→\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})/g
  let m, firstOld = null
  while ((m = re.exec(full)) !== null) { if (!firstOld) firstOld = m[1] }
  if (!firstOld) return null
  const yr = String(reqDate).slice(0, 4)
  const oldD = firstOld.length === 5 ? `${yr}-${firstOld}` : firstOld
  const a = new Date(oldD + 'T12:00:00'), b = new Date(String(reqDate).slice(0, 10) + 'T12:00:00')
  if (isNaN(a) || isNaN(b)) return null
  const diff = Math.round((b - a) / dayMs)
  if (diff === 0) return null
  return diff
}

// 비고: 납기변경 이력이 ' / '로 쌓임 → 화면엔 최근 1건만, 전체는 툴팁. 비-납기 메모는 유지.
function noteDisplay(note) {
  const full = (note || '').trim()
  if (!full) return { text: '', count: 0, full: '' }
  const parts = full.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean)
  const napgi = parts.filter(p => p.includes('납기'))
  const others = parts.filter(p => !p.includes('납기'))
  if (napgi.length <= 1 && others.length === 0) return { text: full, count: 0, full }
  const latest = napgi.length ? napgi[napgi.length - 1] : ''
  const text = [...others, latest].filter(Boolean).join(' / ')
  return { text, count: napgi.length, full }
}

const EMPTY = { name: '', pn: '', hogi: '', ccn: '', rev: '', status: 'PO접수', po_received: true, req_date: '', machine_date: '', arrival_date: '', harness_issue: '', harness_done: '', part_issue: '', elec_done: '', note: '' }

export default function ProductionPDBox({ rows, csCode, isLoading }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [view, setView] = useState('list') // list | model | kanban | load
  const [mainTab, setMainTab] = useState('main') // main=주요 관리 | sub
  const [expWk, setExpWk] = useState(null) // 주간부하 확장 주차
  const [edit, setEdit] = useState(null)   // 편집 중인 레코드 or null
  const [sel, setSel] = useState(new Set()) // 일괄수정 선택
  const [bulkField, setBulkField] = useState('arrival_date')
  const [bulkDate, setBulkDate] = useState('')

  // 품목별 기초 공수 MD (items.md_days)
  const { data: mdMap = {} } = useQuery({
    queryKey: ['pdboxMd'],
    queryFn: async () => {
      const { data } = await supabase.from('items').select('std_code,md_days,qc_md_days').like('std_code', 'AX-11%')
      return Object.fromEntries((data || []).map(i => [String(i.std_code).replace('AX-', ''), { md: i.md_days, qc: i.qc_md_days }]))
    },
  })
  const mdSaveMut = useMutation({
    mutationFn: async ({ pn, field, val }) => {
      const { error } = await supabase.from('items').update({ [field]: val === '' ? null : Number(val) }).eq('std_code', 'AX-' + pn)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['pdboxMd']); toastSuccess('MD 저장됨') },
    onError: (e) => toastError('MD 저장 오류: ' + e.message),
  })

  // 완료상태 토글 (모달과 분리 — 완료 보존 버그 방지)
  const toggleMut = useMutation({
    mutationFn: async ({ id, field, value, row }) => {
      const patch = { [field]: value, updated_at: new Date().toISOString() }
      // ① 불출/완료 체크 → 상태 자동 승격
      const auto = autoStatus(row, field, value)
      if (auto) patch.status = auto
      // ③ 완료 처리 시 실제 납품일 기록 (기존값 있으면 보존)
      if (field === 'status' && value === '완료' && row && !row.shipped_date) patch.shipped_date = new Date().toISOString().slice(0, 10)
      const { error } = await supabase.from('production').update(patch).eq('id', id)
      if (error) throw error
      if (auto) toast(`상태 자동 변경 → ${auto}`)
    },
    onSuccess: () => qc.invalidateQueries(['production', csCode]),
    onError: (e) => toastError('변경 오류: ' + e.message),
  })

  // 선택 항목 일괄 날짜수정
  const bulkMut = useMutation({
    mutationFn: async ({ ids, field, value }) => {
      const { error } = await supabase.from('production')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
      return ids.length
    },
    onSuccess: (n) => { toastSuccess(`일괄 수정 완료 — ${n}건`); setSel(new Set()); setBulkDate(''); qc.invalidateQueries(['production', csCode]) },
    onError: (e) => toastError('일괄 수정 오류: ' + e.message),
  })

  // 저장 (신규/편집) — 완료상태는 건드리지 않음
  const saveMut = useMutation({
    mutationFn: async (rec) => {
      const patch = { ...rec }
      delete patch.id; delete patch._month
      patch.updated_at = new Date().toISOString()
      if (rec.id) {
        const { error } = await supabase.from('production').update(patch).eq('id', rec.id)
        if (error) throw error
      } else {
        patch.id = 'pb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        patch.customer_code = csCode
        patch.created_at = new Date().toISOString()
        const { error } = await supabase.from('production').insert(patch)
        if (error) throw error
      }
    },
    onSuccess: () => { setEdit(null); qc.invalidateQueries(['production', csCode]) },
    onError: (e) => toastError('저장 오류: ' + e.message),
  })

  const fileRef = useRef(null)
  // CSV 가져오기 — 품번+호기 기준 upsert (명세 6-4)
  const importMut = useMutation({
    mutationFn: async (records) => {
      // 기존 데이터 (품번+호기 키)
      const keyOf = (pn, hogi) => `${(pn || '').trim()}|${(hogi || '').trim()}`
      const existMap = {}
      for (const r of rows) existMap[keyOf(r.pn, r.hogi)] = r

      let created = 0, updated = 0
      for (const rec of records) {
        if (!rec.pn) continue
        const exist = existMap[keyOf(rec.pn, rec.hogi)]
        if (exist) {
          // SCHED_FIELDS만 갱신, id/created_at/완료상태/history 보존
          const patch = { updated_at: new Date().toISOString() }
          for (const f of SCHED_FIELDS) {
            if (f === 'missing_parts') { patch.missing_parts = rec.missing_parts || [] }
            else if (rec[f] !== undefined && rec[f] !== '') patch[f] = rec[f]
          }
          const { error } = await supabase.from('production').update(patch).eq('id', exist.id)
          if (error) throw error
          updated++
        } else {
          const ins = {
            id: 'pb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            customer_code: csCode, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            name: rec.name, pn: rec.pn, hogi: rec.hogi, ccn: rec.ccn, rev: rec.rev,
            status: rec.status, po_received: rec.po_received,
            req_date: rec.req_date || null, machine_date: rec.machine_date || null, arrival_date: rec.arrival_date || null,
            harness_issue: rec.harness_issue || null, harness_done: rec.harness_done || null,
            part_issue: rec.part_issue || null, elec_done: rec.elec_done || null,
            note: rec.note, missing_parts: rec.missing_parts || [],
          }
          const { error } = await supabase.from('production').insert(ins)
          if (error) throw error
          created++
        }
      }
      return { created, updated }
    },
    onSuccess: (r) => { toastSuccess(`가져오기 완료 — 신규 ${r.created}건 · 일정수정 ${r.updated}건`); qc.invalidateQueries(['production', csCode]) },
    onError: (e) => toastError('가져오기 오류: ' + e.message),
  })

  const onFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const records = parsePDBoxCSV(String(reader.result))
        if (!records.length) { toastError('읽을 데이터가 없습니다'); return }
        if (window.confirm(`${records.length}개 호기를 가져올까요?\n(같은 품번+호기는 일정만 갱신, 완료상태는 보존)`)) importMut.mutate(records)
      } catch (err) { toastError('CSV 파싱 오류: ' + err.message) }
    }
    reader.readAsText(f, 'utf-8')
    e.target.value = ''
  }

  // 모델별 진행 요약 (품번=모델, 완료 포함 전체 기준)
  const modelSummary = useMemo(() => {
    const g = {}
    rows.forEach(r => {
      const k = r.pn || '?'
      g[k] ??= { pn: k, name: r.name, main: isMainPn(k), total: 0, done: 0, making: 0, waiting: 0, next: null }
      g[k].total++
      if (r.status === '완료') g[k].done++
      else if (['제작중','품질검수','납품대기'].includes(r.status)) g[k].making++
      else g[k].waiting++
      if (r.status !== '완료' && r.req_date) {
        if (!g[k].next || r.req_date < g[k].next) g[k].next = r.req_date
      }
    })
    return Object.values(g).sort((a, b) =>
      (b.main - a.main) || String(a.next || '9999').localeCompare(String(b.next || '9999')))
  }, [rows])

  // ② 가공물 입고 지연 (예정일 지났는데 미입고)
  const today = new Date().toISOString().slice(0, 10)
  const mchLateIds = useMemo(() => new Set(
    rows.filter(r => r.status !== '완료' && r.arrival_date && !truthy(r.machine_recv) && String(r.arrival_date).slice(0,10) < today).map(r => r.id)
  ), [rows])

  // ③ 납품 KPI (완료 + 실납품일 있는 호기 기준, 최근 90일)
  const shipKpi = useMemo(() => {
    const cut = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    const done = rows.filter(r => r.status === '완료' && r.shipped_date && r.req_date && String(r.shipped_date) >= cut)
    if (!done.length) return null
    const onTime = done.filter(r => String(r.shipped_date).slice(0,10) <= String(r.req_date).slice(0,10)).length
    const delays = done.map(r => Math.round((new Date(String(r.shipped_date).slice(0,10)) - new Date(String(r.req_date).slice(0,10))) / 86400000))
    const avgDelay = delays.reduce((a, b) => a + b, 0) / done.length
    return { n: done.length, rate: Math.round(onTime / done.length * 100), avgDelay: Math.round(avgDelay * 10) / 10 }
  }, [rows])

  const filtered = useMemo(() => {
    let r = rows.filter(x => showDone || x.status !== '완료')
    r = r.filter(x => isMainPn(x.pn) === (mainTab === 'main'))
    if (search.trim()) {
      const s = search.toLowerCase()
      r = r.filter(x => (x.pn || '').toLowerCase().includes(s) || (x.name || '').toLowerCase().includes(s) || (x.hogi || '').toLowerCase().includes(s))
    }
    r.sort((a, b) => {
      const d = (a.req_date || '9999').localeCompare(b.req_date || '9999')
      if (d !== 0) return d
      // 납품일 같으면 품번 → 호기번호 → id 순 (안정적)
      const p = (a.pn || '').localeCompare(b.pn || '')
      if (p !== 0) return p
      const ah = parseInt(String(a.hogi || '').replace(/\D/g, '')) || 9999
      const bh = parseInt(String(b.hogi || '').replace(/\D/g, '')) || 9999
      if (ah !== bh) return ah - bh
      return String(a.id).localeCompare(String(b.id))
    })
    // 월별 그룹 삽입
    const out = []; let cur = null
    for (const x of r) {
      const mk = x.req_date ? x.req_date.slice(0, 7) : '미정'
      if (mk !== cur) { out.push({ _month: mk }); cur = mk }
      out.push(x)
    }
    return out
  }, [rows, showDone, search, mainTab])

  // 주간 부하 (주요 품번 · 미완료): 전장 MD 합 / 품질 건수
  const weeklyLoad = useMemo(() => {
    const g = {}
    const mk = (w) => (g[w] ??= { wk: w, elecMd: 0, elecCnt: 0, qcMd: 0, qcCnt: 0, elecItems: [], qcItems: [] })
    rows.filter(r => isMainPn(r.pn) && r.status !== '완료' && r.req_date).forEach(r => {
      const m = mdMap[r.pn] || {}
      const asm = Number(m.md) || 1, qc = Number(m.qc) || 1
      const ew = weekKey(calcElec(r, m.qc)); const qw = weekKey(calcQuality(r))
      if (ew) { const b = mk(ew); b.elecMd += asm; b.elecCnt++; b.elecItems.push({ id: r.id, pn: r.pn, hogi: r.hogi, name: r.name, due: calcElec(r, m.qc), md: asm, req: r.req_date }) }
      if (qw) { const b = mk(qw); b.qcMd += qc; b.qcCnt++; b.qcItems.push({ id: r.id, pn: r.pn, hogi: r.hogi, name: r.name, due: calcQuality(r), md: qc, req: r.req_date }) }
    })
    Object.values(g).forEach(b => { b.elecItems.sort((a, c) => String(a.due).localeCompare(String(c.due))); b.qcItems.sort((a, c) => String(a.due).localeCompare(String(c.due))) })
    return Object.values(g).sort((a, b) => a.wk.localeCompare(b.wk))
  }, [rows, mdMap])

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품번·PD명·호기 검색"
          className="w-full sm:w-64 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <label className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 완료 포함
        </label>
        <button onClick={() => setEdit({ ...EMPTY })} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">+ 호기 추가</button>
        <div className="flex gap-1 p-0.5 bg-indigo-100/70 rounded-lg">
          <button onClick={() => { setMainTab('main') }} className={`px-2.5 py-1 text-xs font-bold rounded-md ${mainTab==='main'?'bg-white text-indigo-700 shadow-sm':'text-indigo-400'}`}>⭐ 주요 관리</button>
          <button onClick={() => { setMainTab('sub'); setView('list') }} className={`px-2.5 py-1 text-xs font-bold rounded-md ${mainTab==='sub'?'bg-white text-slate-700 shadow-sm':'text-slate-500'}`}>Sub Assy</button>
        </div>
        {mainTab === 'main' && (
        <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg">
          <button onClick={() => setView('list')} className={`px-2.5 py-1 text-xs font-semibold rounded-md ${view==='list'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>📃 리스트</button>
          <button onClick={() => setView('model')} className={`px-2.5 py-1 text-xs font-semibold rounded-md ${view==='model'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>📊 모델별</button>
          <button onClick={() => setView('kanban')} className={`px-2.5 py-1 text-xs font-semibold rounded-md ${view==='kanban'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>🗂 칸반</button>
          <button onClick={() => setView('load')} className={`px-2.5 py-1 text-xs font-semibold rounded-md ${view==='load'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>📈 주간부하</button>
        </div>
        )}
        <button onClick={() => exportPDBoxCSV(rows.filter(x => showDone || x.status !== '완료'), csCode)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 CSV 추출</button>
        <button onClick={() => fileRef.current?.click()} disabled={importMut.isPending} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">{importMut.isPending ? '가져오는 중...' : '📤 CSV 가져오기'}</button>
        <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
        {mchLateIds.size > 0 && mainTab === 'main' && (
          <button onClick={() => { setSearch(''); setView('list') }} title="가공물 입고예정일이 지났는데 미입고"
            className="px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-bold animate-pulse">⚙ 입고지연 {mchLateIds.size}건</button>
        )}
        <span className="text-xs text-slate-400 font-semibold ml-auto">{filtered.filter(x => !x._month).length}건</span>
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>
        : <><p className="sm:hidden text-[11px] text-slate-400 mb-1.5">← 좌우로 밀어서 상태·공정 전체 보기</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {view === 'model' && (
            <div className="flex gap-2 px-3 pt-3 flex-wrap">
              {shipKpi ? (<>
                <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <div className="text-lg font-black text-emerald-600">{shipKpi.rate}%</div>
                  <div className="text-[9px] font-bold text-emerald-500">정시납품률 (90일 · {shipKpi.n}대)</div>
                </div>
                <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <div className={`text-lg font-black ${shipKpi.avgDelay > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{shipKpi.avgDelay > 0 ? '+' : ''}{shipKpi.avgDelay}일</div>
                  <div className="text-[9px] font-bold text-slate-400">평균 지연 (실납품−납기)</div>
                </div>
              </>) : (
                <p className="text-[11px] text-slate-400 py-1">📊 납품 KPI는 완료 처리부터 쌓입니다 — 이제부터 완료 시 실납품일이 자동 기록돼요</p>
              )}
            </div>
          )}
          {view === 'kanban' ? (
            <KanbanBoard rows={filtered.filter(x => !x._month)} mdMap={mdMap}
              onStatus={(id, status, row) => toggleMut.mutate({ id, field: 'status', value: status, row })}
              onOpen={(r) => setEdit({ ...r })} showDone={showDone} />
          ) : view === 'load' ? (
            <div className="p-4">
              <p className="text-xs text-slate-400 mb-3">주요 품번 · 미완료 호기 기준 — <b className="text-violet-600">전장 부하</b>=완료예정 주차에 품목 MD 합산, <b className="text-rose-600">품질</b>=완료요청 주차 건수. 가공물 일정은 고정값이라 미포함.</p>
              {weeklyLoad.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">데이터 없음 (MD 미입력 시 1로 계산)</p> : (
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-bold">주차 (월요일)</th>
                    <th className="px-3 py-2 text-left font-bold">⚡ 전장 부하 (MD)</th>
                    <th className="px-3 py-2 text-center font-bold">전장 호기</th>
                    <th className="px-3 py-2 text-center font-bold">✅ 품질 건수</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(() => { const mx = Math.max(...weeklyLoad.map(w => w.elecMd), 1); return weeklyLoad.map(w => (<>
                      <tr key={w.wk} className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpWk(expWk === w.wk ? null : w.wk)} title="클릭하면 이 주차의 부하 원인(호기) 표시">
                        <td className="px-3 py-2 font-mono font-semibold text-slate-700">
                          <span className="inline-flex items-center gap-1">{expWk === w.wk ? '▾' : '▸'} {w.wk.slice(5)} 주</span>
                        </td>
                        <td className="px-3 py-2 w-72">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
                              <div className={`h-full ${w.elecMd >= mx * 0.85 ? 'bg-red-400' : 'bg-violet-400'}`} style={{ width: `${Math.round(w.elecMd / mx * 100)}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-slate-600 w-10 text-right">{Math.round(w.elecMd * 10) / 10}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center text-slate-500">{w.elecCnt}</td>
                        <td className="px-3 py-2 text-center font-bold text-rose-500">{w.qcCnt ? `${w.qcCnt}건 · ${Math.round(w.qcMd * 10) / 10}MD` : '-'}</td>
                      </tr>
                      {expWk === w.wk && (
                        <tr key={w.wk + 'x'} className="bg-slate-50/70">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div>
                                <p className="text-[10px] font-bold text-violet-600 mb-1">⚡ 전장 (완료예정 이 주) — {Math.round(w.elecMd * 10) / 10}MD</p>
                                {w.elecItems.length === 0 ? <p className="text-[10px] text-slate-300">없음</p> : w.elecItems.map(it => (
                                  <div key={it.id + 'e'} className="flex items-center gap-2 text-[11px] py-0.5">
                                    <span className="font-mono font-semibold text-slate-700">{it.pn} {it.hogi}</span>
                                    <span className="text-slate-400 truncate flex-1">{it.name}</span>
                                    <span className="text-violet-500 font-bold">{it.md}MD</span>
                                    <span className="text-slate-400">완료 {String(it.due).slice(5)}</span>
                                    <span className="text-slate-300">납품 {String(it.req).slice(5)}</span>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-rose-600 mb-1">✅ 품질 (완료요청 이 주) — {w.qcCnt}건 · {Math.round(w.qcMd * 10) / 10}MD</p>
                                {w.qcItems.length === 0 ? <p className="text-[10px] text-slate-300">없음</p> : w.qcItems.map(it => (
                                  <div key={it.id + 'q'} className="flex items-center gap-2 text-[11px] py-0.5">
                                    <span className="font-mono font-semibold text-slate-700">{it.pn} {it.hogi}</span>
                                    <span className="text-slate-400 truncate flex-1">{it.name}</span>
                                    <span className="text-rose-400 font-bold">{it.md}MD</span>
                                    <span className="text-slate-400">요청 {String(it.due).slice(5)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>)) })()}
                  </tbody>
                </table>
              )}
            </div>
          ) : view === 'model' ? (
            <div>
              {(() => {
                const cut = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
                const done = rows.filter(r => r.status === '완료' && r.shipped_date && r.req_date && r.shipped_date >= cut)
                if (!done.length) return <p className="px-4 pt-3 text-[10px] text-slate-400">📈 정시납품률·리드타임은 앞으로 완료 처리 시 자동 집계됩니다 (실납품일 기록 시작)</p>
                const onTime = done.filter(r => r.shipped_date <= r.req_date).length
                const delays = done.map(r => Math.round((new Date(r.shipped_date) - new Date(r.req_date)) / 86400000))
                const leads = done.filter(r => r.created_at).map(r => Math.round((new Date(r.shipped_date) - new Date(r.created_at)) / 86400000))
                const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : 0
                return (
                  <div className="flex gap-2 px-4 pt-3 flex-wrap">
                    <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px]"><b className="text-emerald-700 text-sm">{Math.round(onTime / done.length * 100)}%</b> <span className="text-emerald-600 font-bold">정시납품</span> <span className="text-slate-400">(90일 {done.length}대)</span></div>
                    <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px]"><b className="text-slate-700 text-sm">{avg(delays) > 0 ? '+' : ''}{avg(delays)}일</b> <span className="text-slate-500 font-bold">평균 납기편차</span></div>
                    {leads.length > 0 && <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px]"><b className="text-slate-700 text-sm">{avg(leads)}일</b> <span className="text-slate-500 font-bold">평균 리드타임</span></div>}
                  </div>
                )
              })()}
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-400 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">모델 (품번)</th>
                    <th className="px-3 py-2 text-left font-bold">품명</th>
                    <th className="px-3 py-2 text-center font-bold">진행률</th>
                    <th className="px-3 py-2 text-center font-bold">완료</th>
                    <th className="px-3 py-2 text-center font-bold">제작중</th>
                    <th className="px-3 py-2 text-center font-bold">PO접수</th>
                    <th className="px-3 py-2 text-center font-bold">전체</th>
                    <th className="px-3 py-2 text-center font-bold">다음 납품</th>
                    <th className="px-3 py-2 text-center font-bold">조립 MD</th>
                    <th className="px-3 py-2 text-center font-bold">품질 MD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modelSummary.map(m => (
                    <tr key={m.pn} className="hover:bg-indigo-50/40 cursor-pointer" onClick={() => { setSearch(m.pn); setView('list') }} title="클릭하면 리스트에서 이 모델만 보기">
                      <td className="px-3 py-2 font-mono font-bold text-slate-700">
                        {m.pn}{!m.main && <span className="ml-1 px-1 rounded bg-slate-100 text-slate-400 text-[9px] font-bold">sub</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600 text-left max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">{m.name}</td>
                      <td className="px-3 py-2 w-40">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${m.total ? Math.round(m.done / m.total * 100) : 0}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{m.total ? Math.round(m.done / m.total * 100) : 0}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-emerald-600">{m.done}</td>
                      <td className="px-3 py-2 text-center font-bold text-blue-600">{m.making}</td>
                      <td className="px-3 py-2 text-center text-slate-500">{m.waiting}</td>
                      <td className="px-3 py-2 text-center font-bold text-slate-700">{m.total}</td>
                      <td className="px-3 py-2 text-center font-semibold text-slate-600">{m.next ? m.next.slice(5) : '—'}</td>
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        {m.main ? (
                          <input type="number" step="0.5" min="0" defaultValue={mdMap[m.pn]?.md ?? ''} placeholder="—" title="전장 조립 공수 (MD)"
                            onBlur={e => { const v = e.target.value; if (String(mdMap[m.pn]?.md ?? '') !== v) mdSaveMut.mutate({ pn: m.pn, field: 'md_days', val: v }) }}
                            className="w-14 px-1 py-0.5 text-center text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        {m.main ? (
                          <input type="number" step="0.5" min="0" defaultValue={mdMap[m.pn]?.qc ?? ''} placeholder="—" title="품질 검사 공수 (MD) — 전장 완료예정 역산에 사용"
                            onBlur={e => { const v = e.target.value; if (String(mdMap[m.pn]?.qc ?? '') !== v) mdSaveMut.mutate({ pn: m.pn, field: 'qc_md_days', val: v }) }}
                            className="w-14 px-1 py-0.5 text-center text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-rose-300" />
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (<>
          {sel.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap px-3 py-2 mb-2 rounded-xl border border-indigo-200 bg-indigo-50/60 sticky top-0 z-20">
              <span className="text-xs font-bold text-indigo-700">✓ {sel.size}건 선택</span>
              <select value={bulkField} onChange={e=>setBulkField(e.target.value)}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                <option value="arrival_date">⚙ 가공물 입고예정</option>
                <option value="machine_date">⚙ 가공물 발주일</option>
                <option value="elec_done">⚡ 전장 완료요청</option>
                <option value="req_date">📦 납품요청일</option>
              </select>
              <input type="date" value={bulkDate} onChange={e=>setBulkDate(e.target.value)}
                className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              <button onClick={()=>{ if(!bulkDate){ toastError('날짜를 선택하세요'); return } bulkMut.mutate({ ids:[...sel], field:bulkField, value:bulkDate }) }}
                disabled={bulkMut.isPending}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {bulkMut.isPending?'적용 중...':'일괄 적용'}
              </button>
              <button onClick={()=>{ if(window.confirm(`선택 ${sel.size}건의 날짜를 비울까요?`)) bulkMut.mutate({ ids:[...sel], field:bulkField, value:null }) }}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">날짜 비우기</button>
              <button onClick={()=>setSel(new Set())}
                className="ml-auto px-2.5 py-1.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-600">선택 해제</button>
            </div>
          )}
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-400 text-center">
                <th rowSpan={2} className="px-1 py-1.5 w-7">
                  <input type="checkbox"
                    checked={(()=>{const ids=filtered.filter(r=>!r._month).map(r=>r.id); return ids.length>0 && ids.every(id=>sel.has(id))})()}
                    onChange={e=>{ const ids=filtered.filter(r=>!r._month).map(r=>r.id); setSel(e.target.checked? new Set(ids): new Set()) }} />
                </th>
                <th rowSpan={2} className="px-2 py-1.5 text-left font-bold">품번</th>
                <th rowSpan={2} className="px-2 py-1.5 text-left font-bold">PD명</th>
                <th rowSpan={2} className="px-2 py-1.5 font-bold">호기</th>
                <th rowSpan={2} className="px-2 py-1.5 font-bold">REV</th>
                <th rowSpan={2} className="px-2 py-1.5 font-bold">상태</th>
                <th rowSpan={2} className="px-2 py-1.5 font-bold">납품일</th>
                <th colSpan={1} className="px-2 py-1 font-bold text-amber-600 border-l border-slate-200">⚙ 가공물 <span className="text-[9px] text-slate-300 font-normal">(고정)</span></th>
                <th colSpan={3} className="px-2 py-1 font-bold text-violet-600 border-l border-slate-200">⚡ 전장</th>
                <th colSpan={1} className="px-2 py-1 font-bold text-rose-600 border-l border-slate-200">✅ 품질</th>
                <th rowSpan={2} className="px-2 py-1.5 font-bold border-l border-slate-200">미불출</th>
                <th rowSpan={2} className="px-2 py-1.5 text-left font-bold">비고</th>
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-[10px] text-slate-400 text-center">
                <th className="px-2 py-1 font-semibold border-l border-slate-200">입고예정<br /><span className="text-slate-300">클릭시완료</span></th>
                <th className="px-2 py-1 font-semibold border-l border-slate-200">하네스<br />불출</th>
                <th className="px-2 py-1 font-semibold">전장<br />불출</th>
                <th className="px-2 py-1 font-semibold">완료예정<br /><span className="text-slate-300">MD역산·✎수정</span></th>
                <th className="px-2 py-1 font-semibold border-l border-slate-200">완료요청<br /><span className="text-slate-300">역산·클릭완료</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => r._month ? (
                <tr key={'m' + i} className="bg-indigo-50/60">
                  <td colSpan={14} className="px-3 py-1.5 text-[11px] font-bold text-indigo-600">
                    {r._month === '미정' ? '납품일 미정' : `${r._month.slice(0, 4)}년 ${+r._month.slice(5, 7)}월`}
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 text-center ${sel.has(r.id)?'bg-indigo-50/50':''} ${!isMainPn(r.pn)?'opacity-90':''}`}>
                  <td className="px-1 py-2">
                    <input type="checkbox" checked={sel.has(r.id)}
                      onChange={()=>setSel(p=>{const n=new Set(p); n.has(r.id)?n.delete(r.id):n.add(r.id); return n})} />
                  </td>
                  <td className="px-2 py-2 font-mono text-slate-700 text-left cursor-pointer hover:text-indigo-600" onClick={() => setEdit({ ...r })}>
                    {r.pn}{!isMainPn(r.pn) && <span className="ml-1 px-1 rounded bg-slate-100 text-slate-400 text-[9px] font-bold align-middle">sub</span>}
                  </td>
                  <td className="px-2 py-2 text-slate-700 text-left max-w-[180px] overflow-hidden text-ellipsis">{r.name}</td>
                  <td className="px-2 py-2 font-mono font-bold text-indigo-600">{r.hogi || '-'}</td>
                  <td className="px-2 py-2 text-slate-400">{r.rev || '-'}</td>
                  <td className="px-2 py-2"><select value={r.status || 'PO접수'} onChange={e => toggleMut.mutate({ id: r.id, field: 'status', value: e.target.value, row: r })} onClick={e => e.stopPropagation()} className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400 ${STATUS_COLOR[r.status] || 'bg-slate-100 text-slate-500'}`}>{STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}</select></td>
                  <td className={`px-2 py-2 font-semibold ${ddayCls(dday(r.req_date))}`}>
                    <span className="inline-flex items-center gap-1">
                      {md(r.req_date) || '미정'}
                      {(() => { const t = delayTag(r.note, r.req_date); if (t == null) return null
                        return <span title={`원납기 대비 ${t>0?'밀림':'당겨짐'}`} className={`px-1 rounded text-[9px] font-bold ${t>0?'bg-amber-100 text-amber-700':'bg-red-100 text-red-600'}`}>{t>0?`+${t}일`:`${t}일`}</span> })()}
                    </span>
                  </td>
                  {isMainPn(r.pn) ? (<>
                  {/* 가공물 입고예정 — 날짜없으면 입력, 있으면 완료토글 */}
                  <DateCell row={r} dateField="arrival_date" doneField="machine_recv" done={r.machine_recv} doneColor="amber" late={mchLateIds.has(r.id)}
                    onDate={(v) => toggleMut.mutate({ id: r.id, field: 'arrival_date', value: v || null })}
                    onToggle={(v) => toggleMut.mutate({ id: r.id, field: 'machine_recv', value: v })} />
                  {/* 전장>하네스 불출 (토글) */}
                  <td className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center" onClick={() => toggleMut.mutate({ id: r.id, field: 'harness_recv', value: !truthy(r.harness_recv), row: r })}>
                    {truthy(r.harness_recv) ? <span className="text-teal-600 font-semibold">✔ 불출</span> : <span className="text-slate-300 hover:text-teal-500">불출</span>}
                  </td>
                  {/* 전장>부품 불출 (토글) */}
                  <td className="px-2 py-2 cursor-pointer text-center" onClick={() => toggleMut.mutate({ id: r.id, field: 'part_issue', value: !truthy(r.part_issue), row: r })}>
                    {truthy(r.part_issue) ? <span className="text-blue-600 font-semibold">✔ 불출</span> : <span className="text-slate-300 hover:text-blue-500">불출</span>}
                  </td>
                  {/* 전장 완료예정 — MD 역산 자동, ✎로 수동 고정(elec_done), 클릭=완료 */}
                  <AutoDateCell auto={calcElec(r, (mdMap[r.pn]||{}).qc)} manual={r.elec_done} done={r.elec_recv}
                    onDate={(v) => toggleMut.mutate({ id: r.id, field: 'elec_done', value: v || null })}
                    onToggle={(v) => toggleMut.mutate({ id: r.id, field: 'elec_recv', value: v, row: r })} />
                  {/* 품질 완료요청 — 역산, 클릭=완료 */}
                  <td className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center" onClick={() => toggleMut.mutate({ id: r.id, field: 'quality_recv', value: !truthy(r.quality_recv), row: r })}>
                    {truthy(r.quality_recv)
                      ? <span className="text-rose-600 font-bold">✔ 완료</span>
                      : <span className="text-slate-500 hover:text-rose-500">{md(calcQuality(r)) || '—'}</span>}
                  </td>
                  </>) : (<>
                  {/* sub assy: 진행상태만 관리 — 일정셀은 참고표시 */}
                  <td className="px-2 py-2 border-l border-slate-100 text-center text-slate-300">{md(r.arrival_date) || '—'}</td>
                  <td className="px-2 py-2 border-l border-slate-100 text-center text-slate-300">{truthy(r.harness_recv) ? '✔' : '—'}</td>
                  <td className="px-2 py-2 text-center text-slate-300">{truthy(r.part_issue) ? '✔' : '—'}</td>
                  <td className="px-2 py-2 text-center text-slate-300">{md(r.elec_done) || '—'}</td>
                  <td className="px-2 py-2 border-l border-slate-100 text-center text-slate-300">—</td>
                  </>)}
                  <td className="px-2 py-2 border-l border-slate-100">
                    {Array.isArray(r.missing_parts) && r.missing_parts.length > 0
                      ? <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">{r.missing_parts.length}건</span>
                      : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-2 py-2 text-slate-400 text-left max-w-[140px] overflow-hidden text-ellipsis">
                    {(() => { const nd = noteDisplay(r.note); return (
                      <span title={nd.count > 1 ? nd.full : undefined} className="inline-flex items-center gap-1">
                        <span className="truncate">{nd.text}</span>
                        {nd.count > 1 && <span className="shrink-0 text-[10px] px-1 rounded bg-slate-100 text-slate-500" title={nd.full}>이력 {nd.count}</span>}
                      </span>
                    ) })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>)}
        </div>
        </>}

      {/* 편집 모달 */}
      {edit && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-sm font-bold text-slate-800">{edit.id ? '호기 편집' : '호기 추가'}</h3>
              <button onClick={() => setEdit(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="품번"><input value={edit.pn} onChange={e => setEdit(s => ({ ...s, pn: e.target.value }))} className="inp" /></Field>
                <Field label="호기"><input value={edit.hogi} onChange={e => setEdit(s => ({ ...s, hogi: e.target.value }))} placeholder="#14" className="inp" /></Field>
              </div>
              <Field label="PD명"><input value={edit.name} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} className="inp" /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="CCN"><input value={edit.ccn || ''} onChange={e => setEdit(s => ({ ...s, ccn: e.target.value }))} className="inp" /></Field>
                <Field label="REV"><input value={edit.rev || ''} onChange={e => setEdit(s => ({ ...s, rev: e.target.value }))} className="inp" /></Field>
                <Field label="상태">
                  <select value={edit.status} onChange={e => setEdit(s => ({ ...s, status: e.target.value }))} className="inp">
                    {STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="납품요청일"><input type="date" value={edit.req_date || ''} onChange={e => setEdit(s => ({ ...s, req_date: e.target.value }))} className="inp" /></Field>
              <div className="rounded-lg bg-amber-50 p-3 space-y-2">
                <p className="text-xs font-bold text-amber-600">⚙ 가공물</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="발주일"><input type="date" value={edit.machine_date || ''} onChange={e => setEdit(s => ({ ...s, machine_date: e.target.value }))} className="inp" /></Field>
                  <Field label="입고예정일"><input type="date" value={edit.arrival_date || ''} onChange={e => setEdit(s => ({ ...s, arrival_date: e.target.value }))} className="inp" /></Field>
                </div>
              </div>
              <div className="rounded-lg bg-teal-50 p-3 space-y-2">
                <p className="text-xs font-bold text-teal-600">🧵 하네스</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="불출일"><input type="date" value={typeof edit.harness_issue === 'string' && edit.harness_issue.match(/^\d{4}-/) ? edit.harness_issue : ''} onChange={e => setEdit(s => ({ ...s, harness_issue: e.target.value }))} className="inp" /></Field>
                  <Field label="완료예정일"><input type="date" value={edit.harness_done || ''} onChange={e => setEdit(s => ({ ...s, harness_done: e.target.value }))} className="inp" /></Field>
                </div>
              </div>
              <div className="rounded-lg bg-violet-50 p-3 space-y-2">
                <p className="text-xs font-bold text-violet-600">⚡ 전장</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="불출일"><input type="date" value={typeof edit.part_issue === 'string' && edit.part_issue.match(/^\d{4}-/) ? edit.part_issue : ''} onChange={e => setEdit(s => ({ ...s, part_issue: e.target.value }))} className="inp" /></Field>
                  <Field label="완료요청일"><input type="date" value={edit.elec_done || ''} onChange={e => setEdit(s => ({ ...s, elec_done: e.target.value }))} className="inp" /></Field>
                </div>
              </div>
              <Field label="비고"><textarea value={edit.note || ''} onChange={e => setEdit(s => ({ ...s, note: e.target.value }))} rows={2} className="inp" /></Field>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button onClick={() => setEdit(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
              <button onClick={() => saveMut.mutate(edit)} disabled={saveMut.isPending || !edit.pn}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{saveMut.isPending ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
      <style>{`.inp{width:100%;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px}.inp:focus{outline:none;border-color:#6366f1}`}</style>
    </>
  )
}

function Field({ label, children }) {
  return <label className="block"><span className="text-[11px] font-semibold text-slate-400 block mb-1">{label}</span>{children}</label>
}

// 하이브리드 날짜 셀: 날짜 없으면 입력기, 날짜 있으면 클릭 시 완료 토글
// dateField: arrival_date 등 (날짜) / doneField: machine_recv 등 (완료 bool)
// 칸반보드 — 상태 열로 드래그해서 상태 변경
function KanbanBoard({ rows, mdMap, onStatus, onOpen, showDone }) {
  const cols = showDone ? STATUS_OPTS : STATUS_OPTS.filter(o => o !== '완료')
  const byStatus = {}
  cols.forEach(c => byStatus[c] = [])
  rows.forEach(r => { (byStatus[r.status] || (byStatus[r.status] = [])).push(r) })
  return (
    <div className="flex gap-2 p-3 overflow-x-auto min-h-[420px] items-start">
      {cols.map(col => (
        <div key={col} className="flex-shrink-0 w-52 rounded-xl bg-slate-50 border border-slate-200"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const row = rows.find(x => x.id === id); if (id) onStatus(id, col, row) }}>
          <div className={`px-3 py-2 text-[11px] font-bold rounded-t-xl flex items-center justify-between ${STATUS_COLOR[col]}`}>
            <span>{col}</span><span className="opacity-60">{(byStatus[col] || []).length}</span>
          </div>
          <div className="p-1.5 space-y-1.5 max-h-[70vh] overflow-y-auto">
            {(byStatus[col] || []).map(r => {
              const t = delayTag(r.note, r.req_date)
              return (
                <div key={r.id} draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', r.id)}
                  onClick={() => onOpen(r)}
                  className="bg-white rounded-lg border border-slate-200 px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-indigo-300 hover:shadow-sm">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] font-bold text-slate-700">{r.pn}</span>
                    <span className="font-mono text-[11px] font-bold text-indigo-600">{r.hogi}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{r.name}</div>
                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                    <span className={`text-[10px] font-bold ${ddayCls(dday(r.req_date))}`}>📦 {md(r.req_date) || '미정'}</span>
                    {t != null && <span className={`px-1 rounded text-[9px] font-bold ${t>0?'bg-amber-100 text-amber-700':'bg-red-100 text-red-600'}`}>{t>0?`+${t}`:t}일</span>}
                    {Number(mdMap?.[r.pn]?.md) > 0 && <span className="text-[9px] text-violet-500 font-bold">{mdMap[r.pn].md}MD</span>}
                    {Array.isArray(r.missing_parts) && r.missing_parts.length > 0 && <span className="text-[9px] px-1 rounded bg-red-50 text-red-500 font-bold">결품{r.missing_parts.length}</span>}
                    {(() => { if (!r.updated_at || r.status === 'PO접수') return null
                      const idle = Math.floor((Date.now() - new Date(r.updated_at)) / 86400000)
                      return idle >= 3 ? <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-500 font-bold" title={`마지막 변동 ${idle}일 전`}>⏸{idle}일</span> : null })()}
                  </div>
                </div>
              )
            })}
            {(byStatus[col] || []).length === 0 && <div className="py-6 text-center text-[10px] text-slate-300">여기로 드래그</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// 역산 자동날짜 셀: 자동값 표시(⚙), ✎로 수동고정, 클릭=완료토글
function AutoDateCell({ auto, manual, done, onDate, onToggle }) {
  const [editing, setEditing] = useState(false)
  const val = manual || auto
  if (done) {
    return <td className="px-2 py-2 cursor-pointer text-center" onClick={() => onToggle(false)}>
      <span className="font-bold text-emerald-600">✔ 완료</span>
      {val && <span className="block text-[9px] text-slate-300">{String(val).slice(5, 10)}</span>}
    </td>
  }
  if (editing) {
    return <td className="px-2 py-2">
      <input type="date" autoFocus defaultValue={val ? String(val).slice(0, 10) : ''}
        onBlur={(e) => { onDate(e.target.value); setEditing(false) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { onDate(e.target.value); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
        className="text-[11px] border border-indigo-300 rounded px-1 py-0.5 w-24" />
    </td>
  }
  return <td className="px-2 py-2 cursor-pointer text-center group" onClick={() => onToggle(true)}>
    <span className="inline-flex items-center gap-1">
      <span className={manual ? 'text-slate-600 font-semibold' : 'text-slate-400'}>{val ? String(val).slice(5, 10) : '—'}</span>
      {!manual && val && <span className="text-[8px] text-indigo-300 font-bold" title="MD 역산 자동값">자동</span>}
      <button type="button" title={manual ? '수동값 수정 (비우면 자동 복귀)' : '수동 고정'}
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        className="text-[10px] text-slate-300 hover:text-indigo-600 px-0.5">✎</button>
    </span>
    <span className="block text-[8px] text-slate-300 group-hover:text-emerald-400">클릭=완료</span>
  </td>
}

function DateCell({ row, dateField, doneField, done, onDate, onToggle, doneColor = 'emerald', late }) {
  const [editing, setEditing] = useState(false)
  const dateVal = row[dateField]
  const colorMap = { emerald: 'text-emerald-600', amber: 'text-amber-600' }

  if (done) {
    return <td className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center" onClick={() => onToggle(false)}>
      <span className={`font-bold ${colorMap[doneColor]}`}>✔ 완료</span>
      {dateVal && <span className="block text-[9px] text-slate-300">{String(dateVal).slice(5, 10)}</span>}
    </td>
  }
  if (editing) {
    return <td className="px-2 py-2 border-l border-slate-100">
      <input type="date" autoFocus defaultValue={dateVal ? String(dateVal).slice(0, 10) : ''}
        onBlur={(e) => { onDate(e.target.value); setEditing(false) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { onDate(e.target.value); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
        className="text-[11px] border border-indigo-300 rounded px-1 py-0.5 w-24" />
    </td>
  }
  // 날짜 있으면: 클릭=완료 토글 · ✎=날짜 수정 (비우고 확정하면 날짜 삭제)
  if (dateVal) {
    return <td className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center group" onClick={() => onToggle(true)}>
      <span className="inline-flex items-center gap-1">
        <span className={late ? 'text-red-600 font-bold' : 'text-slate-500 group-hover:text-emerald-600'}>{String(dateVal).slice(5, 10)}{late && ' ⚠'}</span>
        <button type="button" title="날짜 수정"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
          className="text-[10px] text-slate-300 hover:text-indigo-600 px-0.5">✎</button>
      </span>
      <span className="block text-[8px] text-slate-300 group-hover:text-emerald-400">클릭=완료 · ✎=수정</span>
    </td>
  }
  // 날짜 없으면: 클릭 시 입력
  return <td className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center text-slate-300 hover:text-indigo-500" onClick={() => setEditing(true)}>
    + 날짜
  </td>
}
