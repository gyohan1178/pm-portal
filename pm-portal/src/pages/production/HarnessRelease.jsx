import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { toastError, toastSuccess } from '../../lib/toast'
import { logActivity } from '../../lib/activityLog'
import { refreshProcurement } from '../../lib/refresh'
import { markPoIssued, snapIssued, restoreIssued } from '../../lib/poIssue'
import { fetchAxLines } from '../../lib/axLines'
import { useUndo } from '../../components/UndoBar'
import { useFillHeight } from '../../hooks/useFillHeight'
import { useCompact } from '../../hooks/useCompact'
import PlanBadge from '../../components/PlanBadge'
import { fetchPlanByPo, fetchPlanChanges } from '../../lib/planExc'
import { useCanEdit } from '../../hooks/useProfile'
import { SkelBar, SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { parseHarnessPaste, matchHarnessPaste } from '../../lib/harnessPaste'
import PoCart, { addItemsToCart, fetchCart } from '../common/PoCart'
import { kst } from '../../lib/utils'

// 🧵 하네스 출도 · 불출 (v4.53.0, 2026-10-14)
//   미불출 AXCELIS 하네스(16번대) PO 줄을 골라 → 하네스 공정관리 「작업지시서 QR → AXCELIS」에 붙여넣을 글자로 복사
//   → 공정관리에서 출도(작업지시서 · 도면)하면 그 기록(harness_orders.qr_printed · harness_qr_history)을
//     PO · 오더라인 · 납품라인으로 맞춰 「출력됨」으로 보여주고 → 현장에 넘기면(출도) 「불출 처리」 = 고객사 PO 자재불출 체크.
//   v4.54.0: 출력 ≠ 출도 — 공정관리는 「출력」만 안다. 현장에 넘긴 시점은 포털 「불출 처리」로 남긴다 (표시 글자 출도 → 출력)
//   v4.54.0: 구분이 하네스(16번대)가 아니어도 하네스 공정관리에 등록된 줄(12번대 구매품 · 11번대 전장 등)은 같이 보여준다
//   ⚠ 공정관리 쪽 표는 읽기만 한다 (harness_* 는 하네스 공정관리 소유).
//   ⚠ 불출 처리는 표시만 — 재고 수량은 출고 화면에서 출고할 때만 줄어든다. 쇼티지 계산에서 그 PO 줄이 빠진다.
//   「🧺 다품목 출고로」: 고른 줄의 하네스 품번 · 잔량을 다품목 출고 「붙여넣기」 칸에 채워 넘긴다 → 담기 → 전개(BOM) → 출고.

export const AX_ID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'
const DIV_KEY = 'harness_release_div'   // 구분 바로잡기 (v4.150.0)
const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const yy = (d) => (d ? kst(d).slice(2, 10) : '')
const md = (d) => { if (!d) return ''; const t = new Date(d); if (isNaN(t)) return String(d).slice(5, 10); const k = new Date(t.getTime() + 9 * 3600000).toISOString(); return `${+k.slice(5, 7)}/${+k.slice(8, 10)} ${k.slice(11, 16)}` }
export const todayKST = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
const N = (s) => String(s ?? '').trim().replace(/\.0$/, '')
const P = (s) => String(s ?? '').trim().toUpperCase()
export const pnOf = (code) => String(code || '').replace(/^AX-/i, '')
export const leftOf = (p) => Math.max(0, Number(p.qty_remaining ?? ((p.qty_ordered || 0) - (p.qty_received || 0))) || 0)
const dDay = (d) => { if (!d) return null; const a = new Date(String(d).slice(0, 10)), b = new Date(todayKST()); return Math.round((a - b) / 86400000) }

// 공정관리 기록 → PO 줄마다 상태
//   harness_orders: PO+오더라인+납품라인이 같으면 그 건. 공정관리 옛 건(라인 없음)은 PO+도번으로 맞춘다.
//   출도 = harness_orders.qr_printed (출력하면 공정관리가 켠다) 또는 출도 이력(harness_qr_history, 삭제표시 제외)
export function matchHarness(pos, horders, hist) {
  const byLine = new Map(), byDwg = new Map()
  for (const o of horders || []) {
    const po = P(o.po); if (!po) continue
    const ol = N(o.ord_ln), dl = N(o.del_ln)
    if (ol) { const k = `${po}|${ol}|${dl}`; const e = byLine.get(k) || []; e.push(o); byLine.set(k, e) }
    else { const k = `${po}|${P(o.dwg_no)}`; const e = byDwg.get(k) || []; e.push(o); byDwg.set(k, e) }
  }
  const hLine = new Map(), hDwg = new Map()
  for (const h of hist || []) {
    if (h.deleted === true) continue
    const po = P(h.po); if (!po) continue
    const ol = N(h.ord_ln), dl = N(h.del_ln)
    const put = (m, k) => { const e = m.get(k); if (!e || String(h.ts || '') > String(e.ts || '')) m.set(k, h) }
    if (ol) put(hLine, `${po}|${ol}|${dl}`)
    else put(hDwg, `${po}|${P(h.dwg_no)}`)
  }
  const out = {}
  for (const p of pos) {
    const po = P(p.po_number), ol = N(p.order_line), dl = N(p.del_line), dwg = P(pnOf(p.items?.std_code))
    const osL = byLine.get(`${po}|${ol}|${dl}`), osD = byDwg.get(`${po}|${dwg}`)
    const os = osL || osD || []
    const printed = os.filter(o => o.qr_printed).sort((a, b) => String(b.qr_printed_at || '').localeCompare(String(a.qr_printed_at || '')))[0]
    const hl = hLine.get(`${po}|${ol}|${dl}`), hd = hDwg.get(`${po}|${dwg}`), h = hl || hd
    // 공정관리에 그 줄의 수주가 있으면 그 수주의 출력 표시로만 판단한다
    //   (출도 이력은 라인 없이 PO · 도번만 남는 경우가 있어, 같은 PO 에 같은 도번 줄이 여럿이면 다른 줄까지 출도로 보일 수 있다)
    // 이력이 PO · 도번뿐이면 — 공정관리 수주도 라인 없이 PO · 도번으로 맞은 경우(옛 건)거나 수주가 없을 때만 믿는다
    const isPrinted = !!printed || !!hl || (!!hd && (!osL || !osL.length))
    out[p.id] = {
      reg: os.length > 0,
      printed: isPrinted,
      at: isPrinted ? (printed?.qr_printed_at || h?.ts || null) : null,
      by: isPrinted ? (h?.issued_by || '') : '',
    }
  }
  return out
}

// 하네스 공정관리 AXCELIS 탭이 머리글을 보고 열을 잡는다 (CCN · Item · ItemDesc · OrderNumber · OrderLines · DelLine · Quantity · PromiseDate · SREV · BREV · 불출일)
export function pasteText(rows, rel) {
  const head = ['CCN', 'Item', 'ItemDesc', 'OrderNumber', 'OrderLines', 'DelLine', 'Quantity', 'PromiseDate', 'SREV', 'BREV', '불출일']
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim()
  return [head.join('\t'), ...rows.map(p => [
    P(p.ccn), pnOf(p.items?.std_code), p.items?.name, p.po_number, N(p.order_line), N(p.del_line),
    leftOf(p) || p.qty_ordered, String(p.promise_date || '').slice(0, 10), P(p.item_rev), P(p.item_brev), rel,
  ].map(clean).join('\t'))].join('\n')
}

// 다품목 출고 「붙여넣기」 칸 형식 — 품번 \t 수량 (같은 품번은 합친다)
export function issueText(rows) {
  const m = new Map()
  rows.forEach(p => { const c = p.items?.std_code; if (!c) return; m.set(c, (m.get(c) || 0) + (leftOf(p) || 0)) })
  return [...m].filter(([, q]) => q > 0).map(([c, q]) => `${c}\t${q}`).join('\n')
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok
    } catch { return false }
  }
}

const BADGE = {
  gray: 'bg-slate-50 text-slate-500 border-slate-200', blue: 'bg-sky-50 text-sky-700 border-sky-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200', amber: 'bg-amber-50 text-amber-700 border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200', red: 'bg-rose-50 text-rose-600 border-rose-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200', yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
}
const Badge = ({ tone = 'gray', children, title }) => <span title={title} className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${BADGE[tone]}`}>{children}</span>
function DBadge({ d }) {
  if (d == null) return null
  if (d < 0) return <Badge tone="red">지남 {-d}일</Badge>
  if (d === 0) return <Badge tone="red">오늘</Badge>
  return <Badge tone={d <= 7 ? 'red' : d <= 14 ? 'orange' : d <= 21 ? 'yellow' : 'green'}>D-{d}</Badge>
}
function Kpi({ tone, label, value, note, onClick, on, loading }) {
  const T = { amber: 'bg-amber-50 border-amber-200 text-amber-700', blue: 'bg-sky-50 border-sky-200 text-sky-700', red: 'bg-rose-50 border-rose-200 text-rose-600', green: 'bg-emerald-50 border-emerald-200 text-emerald-700' }[tone]
  return (
    <button type="button" onClick={onClick} className={`text-left rounded-xl border px-4 py-3 ${T} ${on ? 'ring-2 ring-offset-1 ring-slate-300' : ''}`}>
      <div className="text-[12px] font-bold opacity-70">{label}</div>
      {loading ? <div className="h-8 flex items-center" data-skeleton><SkelBar w={48} h={20} /></div>
        : <div className="text-2xl font-extrabold leading-tight">{value}</div>}
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </button>
  )
}

export default function HarnessRelease() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const canEdit = useCanEdit()
  const [justIssued, setJustIssued] = useState(null)   // 방금 불출 처리한 줄 — 다품목 출고로 이어 보내기
  const { remember, bar: undoBar } = useUndo()   // 방금 한 불출 표시 되돌리기 (v4.58.0)
  const compact = useCompact()
  const [tblRef, tblH] = useFillHeight(true, 360)   // 표가 화면 아래를 채우게 (v4.65.0)
  const [tab, setTab] = useState('todo')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [copied, setCopied] = useState(null)   // { text, n, at }
  const [busy, setBusy] = useState(false)
  const [ask, confirmEl] = useConfirm()   // 브라우저 기본 확인 창 대신 (v4.104.0)
  const [pasteOpen, setPasteOpen] = useState(false)   // 공정관리 출도 기록 붙여넣어 불출 (v4.144.0)
  const [divF, setDivF] = useState('all')   // 구분 거르기 — 하네스 · 구매품 · 전장 (v4.147.0)
  const [cartOpen, setCartOpen] = useState(false)   // 🛒 발주 담기함 (v4.150.0 — 자재요청 · 소요량과 같은 담기함)
  const { data: cartRows = [] } = useQuery({ queryKey: ['poCart'], queryFn: fetchCart, staleTime: 30 * 1000 })

  // 구분 바로잡기 (v4.150.0) — 고객사 PO 구분은 품번 앞자리로 정해져(16 하네스 · 11 전장 · 나머지 구매품) 10번대 하네스(100139060 등)가 「구매품」이 된다
  //   이 화면에서 품번마다 바꿔 두면 기억한다 (pm_settings 'harness_release_div' = { pn: { '100139060': '하네스' } } · 모든 PC 공통 · 다음 PO 에도)
  const { data: divOv = {} } = useQuery({
    queryKey: ['harnessRelease', 'divOv'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pm_settings').select('value').eq('key', DIV_KEY).maybeSingle()
      if (error) return {}
      return data?.value?.pn || {}
    },
    staleTime: 60 * 1000,
  })
  const divOf = (p) => divOv[pnOf(p.items?.std_code)] || p.division || '하네스'

  // 진행 중 AXCELIS PO 줄 — 생산관리에 들어간 줄(PO 연동 · production.po_id)만 빼고 전부 (v4.147.0)
  //   예전(v4.146 까지): 구분이 하네스(16번대)인 줄 + 공정관리 등록분 + 「출도 대상 품번」 → 12번대 출도품(120220971~4 등)이 등록 전엔 빠졌다
  //   이제 하네스 · 구매품(12번대 단품) · 전장(11번대 단품) 모두 — 생산관리에서 PD BOX 등으로 관리하는 줄만 뺀다. 위 「구분」 칩으로 거른다
  const { data: pos = [], isLoading, error } = useQuery({
    queryKey: ['harnessRelease', 'pos'],
    queryFn: async () => {
      // v4.158.0 — 고객사 PO 대신 수주대장 진행 중 줄 (정식 PO · 3rd party 「기타」 AX- 품번 포함)
      //   생산관리 호기가 붙은 줄(in_prod — PD BOX 등)은 그쪽 「자재불출」로 관리하므로 뺀다
      const base = await fetchAxLines()
      const all = base.filter(p => !p.in_prod)
      // HOT 등 Plan Exc — 수주대장 줄 값 (언제부터는 고객사 PO 에 이력이 있으면 그것)
      const cpoIds = all.map(p => p.cpo_id).filter(Boolean)
      const plan = cpoIds.length ? await fetchPlanByPo(supabase, cpoIds) : {}
      const chg = Object.keys(plan).length ? await fetchPlanChanges(supabase, Object.keys(plan)) : {}
      all.forEach(p => { if (!p.plan_exc && p.cpo_id && plan[p.cpo_id]) p.plan_exc = plan[p.cpo_id]; if (p.plan_exc && p.cpo_id) p.changes = chg[p.cpo_id] || null })
      return all.sort((a, b) => String(a.promise_date || '9999').localeCompare(String(b.promise_date || '9999')) || String(a.po_number).localeCompare(String(b.po_number)))
    },
    staleTime: 30 * 1000,
  })

  // 하네스 공정관리 기록 (읽기만)
  const poNos = useMemo(() => [...new Set(pos.map(p => String(p.po_number || '').trim()).filter(Boolean))].sort(), [pos])
  const { data: hx, error: hErr } = useQuery({
    queryKey: ['harnessRelease', 'hs', poNos.join(',')],
    enabled: poNos.length > 0,
    queryFn: async () => {
      const ho = [], hh = []
      for (let i = 0; i < poNos.length; i += 150) {
        const part = poNos.slice(i, i + 150)
        ho.push(...await fetchAll(() => supabase.from('harness_orders').select('*').in('po', part).order('id')))
        hh.push(...await fetchAll(() => supabase.from('harness_qr_history').select('*').in('po', part).order('id')))
      }
      return { ho, hh }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,   // 공정관리에서 출도하고 돌아오면 바로 보이게
  })
  const st = useMemo(() => matchHarness(pos, hx?.ho, hx?.hh), [pos, hx])

  // 하네스 품번에 고객사 BOM 이 있나 — 없으면 다품목 출고에서 전개가 안 되고 완제품 하네스 자체가 담긴다
  const codes = useMemo(() => [...new Set(pos.map(p => p.items?.std_code).filter(Boolean))].sort(), [pos])
  const { data: bomCnt } = useQuery({
    queryKey: ['harnessRelease', 'bom', codes.join(',')],
    enabled: codes.length > 0,
    queryFn: async () => {
      const out = {}
      for (let i = 0; i < codes.length; i += 200) {
        const rows = must(await supabase.from('projects').select('code, bom(count)').eq('customer_id', AX_ID).in('code', codes.slice(i, i + 200)), 'BOM 조회')
        ;(rows || []).forEach(r => { out[r.code] = (out[r.code] || 0) + (Number(r.bom?.[0]?.count) || 0) })
      }
      return out
    },
    staleTime: 5 * 60 * 1000,
  })
  const hasBom = (p) => !bomCnt || (bomCnt[p.items?.std_code] || 0) > 0
  // 단품(구매품 · 전장)은 BOM 이 없어도 그 품목 자체를 출고하면 된다 — BOM 이 꼭 있어야 하는 건 하네스(완제품을 만들어 내는 것)만
  const needBom = (p) => divOf(p) === '하네스'

  async function sendIssue(list) {
    const ok = list.filter(p => (hasBom(p) || !needBom(p)) && leftOf(p) > 0)
    const noBom = list.filter(p => needBom(p) && !hasBom(p))
    if (!ok.length) { toastError(noBom.length ? 'BOM 이 등록된 하네스가 없습니다 — 고객사 BOM 을 먼저 올려 주세요' : '잔량이 있는 줄이 없습니다'); return }
    if (noBom.length) {
      const pns = [...new Set(noBom.map(p => pnOf(p.items?.std_code)))]
      if (!(await ask({ title: `BOM 이 없는 ${noBom.length}줄은 빼고 보낼까요?`,
        desc: `고객사 BOM 이 없는 하네스는 다품목 출고에서 전개되지 않아 빼고, 나머지 ${ok.length}줄만 다품목 출고로 넘깁니다.`,
        items: pns.slice(0, 5).map(c => `BOM 없음 — ${c}`), more: Math.max(0, pns.length - 5), okText: `${ok.length}줄 보내기` }))) return
    }
    // v4.57.0: 출고가 끝난 뒤 다품목 출고 화면이 「넘겨받은 줄 불출 처리할까요?」를 묻는다 (아직 불출 안 된 줄만)
    //   → 출고 없이 불출만 먼저 찍혀 쇼티지에서 빠지는데 재고는 그대로인 일을 막는다
    const poIssue = ok.filter(p => !p.material_issued).map(p => ({ id: p.id, line: !!p.line, cpo_id: p.cpo_id || null, po_number: p.po_number, order_line: p.order_line, del_line: p.del_line, pn: pnOf(p.items?.std_code) }))
    nav('/issue', { state: { issuePaste: issueText(ok), csCode: 'ax', from: `하네스 출도 · 불출 ${ok.length}줄`, poIssue } })
  }

  const stage = (p) => p.material_issued ? 'done' : st[p.id]?.printed ? 'wait' : 'todo'
  const divCnt = useMemo(() => pos.reduce((m, p) => { m[divOf(p)] = (m[divOf(p)] || 0) + 1; return m }, {}), [pos, divOv])
  const dpos = useMemo(() => (divF === 'all' ? pos : pos.filter(p => divOf(p) === divF)), [pos, divF, divOv])
  const cnt = useMemo(() => {
    const c = { todo: 0, wait: 0, done: 0, urgent: 0 }
    dpos.forEach(p => { const s = stage(p); c[s]++; if (s === 'todo') { const d = dDay(p.promise_date); if (d != null && d <= 14) c.urgent++ } })
    return c
  }, [dpos, st])

  const kw = q.trim().toLowerCase()
  const rows = useMemo(() => dpos.filter(p => {
    if (tab === 'urgent') { if (stage(p) !== 'todo') return false; const d = dDay(p.promise_date); if (d == null || d > 14) return false }
    else if (tab !== 'all' && stage(p) !== tab) return false
    if (!kw) return true
    return `${p.po_number} ${pnOf(p.items?.std_code)} ${p.items?.name || ''} ${p.items?.manufacturer || ''} ${p.items?.manufacturer_code || ''}`.toLowerCase().includes(kw)
  }), [dpos, st, tab, kw])

  const selRows = rows.filter(p => sel.has(p.id))
  const allOn = rows.length > 0 && rows.every(p => sel.has(p.id))
  const toggle = (id) => setSel(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x })
  const toggleAll = () => setSel(s => { const x = new Set(s); if (allOn) rows.forEach(p => x.delete(p.id)); else rows.forEach(p => x.add(p.id)); return x })
  const go = (k) => { setTab(k); setSel(new Set()); setCopied(null); setJustIssued(null) }

  async function doCopy() {
    if (!selRows.length) return
    const text = pasteText(selRows, todayKST())
    const ok = await copyText(text)
    setCopied({ text, n: selRows.length, ok })
    if (ok) toastSuccess(`${selRows.length}줄 복사 — 하네스 공정관리 「작업지시서 QR → AXCELIS」에 붙여넣으세요`)
    else toastError('클립보드 복사가 막혔습니다 — 아래 글자를 직접 복사하세요')
  }

  // listArg: 붙여넣기 창에서 넘긴 줄 (없으면 표에서 고른 줄) · 성공하면 true
  async function setIssued(val, listArg) {
    const list = (listArg || selRows).filter(p => !!p.material_issued !== val)
    if (!list.length) return
    const lines = list.slice(0, 5).map(p => `${p.po_number} · ${N(p.order_line) || '-'}/${N(p.del_line) || '-'} · ${pnOf(p.items?.std_code)} · 잔량 ${n(leftOf(p))}`)
    if (!(await ask(val
      ? { title: `${list.length}줄을 「불출」로 표시할까요?`, desc: '수주대장 자재불출 체크 → 쇼티지 계산에서 빠집니다. 재고 수량은 바뀌지 않습니다 (출고는 출고 화면에서). 처리 뒤 위에 뜨는 「↩ 되돌리기」로 되돌릴 수 있습니다.',
          items: lines, more: Math.max(0, list.length - 5), okText: '불출 표시' }
      : { title: `${list.length}줄의 불출 표시를 풀까요?`, desc: '쇼티지 계산에 다시 들어갑니다. 처리 뒤 위에 뜨는 「↩ 되돌리기」로 되돌릴 수 있습니다.',
          items: lines, more: Math.max(0, list.length - 5), okText: '불출 표시 풀기', danger: true }))) return
    setBusy(true)
    try {
      const snap = await snapIssued(list.filter(p => !p.line).map(p => p.id).concat(list.map(p => p.cpo_id).filter(Boolean)), list.filter(p => p.line).map(p => p.id))   // 되돌리기용 — 바꾸기 전 값 (v4.58.0 · v4.158.0 수주대장 줄)
      await markPoIssued(list.map(p => ({ id: p.id, line: !!p.line, cpo_id: p.cpo_id || null, po_number: p.po_number, order_line: p.order_line, del_line: p.del_line, pn: pnOf(p.items?.std_code) })),
        val, val ? '하네스 출도 → 불출 처리' : '하네스 불출 취소')
      toastSuccess(val ? `${list.length}줄 불출 처리했습니다` : `${list.length}줄 불출 표시를 풀었습니다`)
      setSel(new Set())
      setJustIssued(val ? list : null)
      remember(val ? `${list.length}줄 불출 표시` : `${list.length}줄 불출 표시 풀기`, async () => {
        await restoreIssued(snap)
        await logActivity('update', 'purchase_orders', null, `하네스 불출 표시 되돌리기 ${list.length}줄`, { ids: list.map(p => p.id) }, 'AXCELIS')
      }, { after: () => {
        setJustIssued(null); refreshProcurement(qc)
        qc.invalidateQueries({ queryKey: ['harnessRelease'], exact: false })
        qc.invalidateQueries({ queryKey: ['production'], exact: false })
      } })
      refreshProcurement(qc)
      qc.invalidateQueries({ queryKey: ['harnessRelease'], exact: false })
      qc.invalidateQueries({ queryKey: ['production'], exact: false })
      return true
    } catch (e) { toastError(e.message); return false } finally { setBusy(false) }
  }

  // 🛒 발주 담기 (v4.150.0) — 구매품은 그 품목 그대로 · 하네스 · ASSY 는 BOM 하위로 펼쳐(다품목 출고와 같은 전개) 잔량만큼
  //   같은 품목은 합쳐 한 줄 · 비고에 어느 PO 몫인지 · 재고 · 발주 중 수량은 빼지 않는다 (담기함에서 수량 · 구매처 · 납기를 고쳐 등록)
  //   하위의 하네스(만드는 것)는 뺀다 · BOM 이 없는 하네스는 펼칠 수 없어 뺀다
  async function putCart() {
    const list = selRows.filter(p => leftOf(p) > 0 && p.items?.std_code)
    if (!list.length) { toastError('잔량이 있는 줄이 없습니다'); return }
    setBusy(true)
    try {
      const agg = new Map()
      let made = 0
      const noBom = []
      for (const p of list) {
        const q = leftOf(p), code = p.items.std_code, tag = `${p.po_number}-${N(p.order_line) || '-'}`
        let got = []
        if (divOf(p) === '구매품' || (!needBom(p) && !hasBom(p))) got = [{ item_id: p.item_id, std_code: code, name: p.items?.name, qty: q }]
        else if (!hasBom(p)) { noBom.push(pnOf(code)); continue }
        else {
          const { data, error } = await supabase.rpc('pm_explode_assy', { p_customer_id: AX_ID, p_items: [{ code, qty: q }] })
          if (error) throw error
          got = (data || []).filter(r => { if (r.make_type === 'harness' && r.std_code !== code) { made++; return false } return Number(r.qty) > 0 })
        }
        for (const r of got) {
          if (!r.item_id) continue
          const e = agg.get(r.item_id) || { item_id: r.item_id, std_code: r.std_code, name: r.name, qty: 0, from: new Set() }
          e.qty += Number(r.qty) || 0; e.from.add(tag); agg.set(r.item_id, e)
        }
      }
      const lines = [...agg.values()].sort((a, b) => String(a.std_code).localeCompare(String(b.std_code)))
      if (!lines.length) { toastError(noBom.length ? `BOM 이 없는 하네스라 펼칠 수 없습니다 — ${noBom.slice(0, 3).join(', ')}` : '담을 품목이 없습니다'); return }
      const inCart = new Set(cartRows.map(c => c.item_id))
      const dup = lines.filter(l => inCart.has(l.item_id)).length
      const notes = [made ? `하위 하네스 ${made}줄은 만드는 것이라 뺐습니다.` : '', noBom.length ? `BOM 없는 하네스 ${noBom.length}줄(${noBom.slice(0, 3).join(', ')}${noBom.length > 3 ? ' …' : ''})은 펼칠 수 없어 뺐습니다.` : '',
        dup ? `⚠ ${dup}개는 담기함에 이미 있어 한 줄씩 더 생깁니다.` : ''].filter(Boolean).join(' ')
      if (!(await ask({
        title: `${n(lines.length)}개 품목을 발주 담기함에 담을까요?`,
        desc: `고른 ${list.length}줄 — 구매품은 그 품목, 하네스 · ASSY 는 BOM 하위로 펼쳐 잔량만큼. 재고 · 발주 중 수량은 빼지 않았습니다 (🛒 담기함에서 수량 · 구매처 · 납기를 고쳐 구매처별로 등록). ${notes}`,
        items: lines.slice(0, 6).map(l => `${pnOf(l.std_code)} · ${l.name || ''} × ${n(Math.round(l.qty * 1000) / 1000)}`), more: Math.max(0, lines.length - 6),
        okText: '담기',
      }))) return
      const { added } = await addItemsToCart(lines.map(l => ({ item_id: l.item_id, customer_id: AX_ID, qty: Math.round(l.qty * 10000) / 10000,
        memo: ('하네스 출도 ' + [...l.from].join(', ')).slice(0, 200) })))
      qc.invalidateQueries({ queryKey: ['poCart'] })
      toastSuccess(`${added}개 품목을 발주 담기함에 담았습니다 — 🛒 담기함에서 구매처별로 묶어 등록`)
    } catch (e) { toastError('발주 담기 실패: ' + e.message) } finally { setBusy(false) }
  }

  // 구분 바꾸기 — 고른 줄의 품번을 기억 (__reset = PO 구분대로)
  async function setDivFor(v) {
    const pns = [...new Set(selRows.map(p => pnOf(p.items?.std_code)).filter(Boolean))]
    if (!pns.length) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('pm_settings').select('value').eq('key', DIV_KEY).maybeSingle()   // 그 사이 바뀐 것 위에
      if (error) throw error
      const map = { ...(data?.value?.pn || {}) }
      pns.forEach(pn => { if (v === '__reset') delete map[pn]; else map[pn] = v })
      must(await supabase.from('pm_settings').upsert({ key: DIV_KEY, value: { pn: map }, updated_at: new Date().toISOString() }, { onConflict: 'key' }), '구분 저장')
      logActivity('update', 'pm_settings', DIV_KEY, `하네스 출도 구분 ${v === '__reset' ? 'PO 구분대로' : v} — ${pns.join(', ')}`)
      await qc.invalidateQueries({ queryKey: ['harnessRelease', 'divOv'] })
      setSel(new Set())
      toastSuccess(`${pns.slice(0, 3).join(', ')}${pns.length > 3 ? ` 외 ${pns.length - 3}` : ''} → ${v === '__reset' ? 'PO 구분대로' : v}`)
    } catch (e) { toastError('구분 저장 실패: ' + e.message) } finally { setBusy(false) }
  }

  async function excel() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['PO', '오더라인', '납품라인', 'CCN', '구분', '품번', '품명', '제조사', '제조사품번', 'SREV', 'BREV', '잔량', '납기', '공정관리', '출력', '출력자', '불출'],
      ...rows.map(p => { const s = st[p.id] || {}; return [p.po_number, N(p.order_line), N(p.del_line), P(p.ccn), divOf(p), pnOf(p.items?.std_code), p.items?.name || '', p.items?.manufacturer || '', p.items?.manufacturer_code || '', p.item_rev || '', p.item_brev || '', leftOf(p), String(p.promise_date || '').slice(0, 10), s.reg ? '등록' : '미등록', s.printed ? md(s.at) : '', s.by || '', p.material_issued ? 'Y' : ''] }),
    ])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '하네스출도')
    XLSX.writeFile(wb, `하네스_출도불출_${todayKST()}.xlsx`)
  }

  const pill = (k) => `px-3 py-1.5 rounded-full border text-xs font-bold ${tab === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`
  const hsTxt = (p) => {
    const s = st[p.id]
    if (!hx) return <span className="text-slate-300">…</span>
    if (s?.printed) return <Badge tone="teal" title={s.at ? `공정관리 출력 ${s.at}` : ''}>🖨 출력{s.at ? ` ${md(s.at)}` : ''}{s.by ? ` · ${s.by}` : ''}</Badge>
    if (s?.reg) return <Badge tone="blue">등록됨 · 출력 전</Badge>
    return <Badge>미등록</Badge>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-slate-400">📦 자재 · AXCELIS 수주대장 진행 중 줄 (생산관리에 들어간 줄 빼고 전부 — 하네스 · 구매품 · 전장 단품)</p>
        <h1 className="text-xl font-extrabold text-slate-900">🧵 하네스 출도 · 불출</h1>
        <p className="page-desc text-[13px] text-slate-400 mt-0.5">
          아직 불출 안 한 하네스 PO 를 골라 하네스 공정관리에 붙여넣고(작업지시서 · 도면 출력), 출력된 건을 현장에 넘길 때(출도) 「🧺 다품목 출고 → 불출」로 자재를 빼고 불출 처리합니다.
          불출 처리 = 수주대장 「자재불출」 체크 → 쇼티지 계산에서 빠짐 (재고 수량은 그대로 — 출고는 출고 화면에서).
        </p>
      </div>

      {(error || hErr) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ {error ? '하네스 PO 를 못 불러왔습니다: ' + error.message : '하네스 공정관리 기록을 못 읽었습니다 (출력 여부가 안 보임): ' + hErr.message}
        </div>
      )}

      <div className="kpi-grid grid grid-cols-2 md:grid-cols-4 gap-3" data-hr-kpi>
        <Kpi tone="amber" label="출력 전" value={n(cnt.todo)} note="미불출 · 공정관리 출력 기록 없음" onClick={() => go('todo')} on={tab === 'todo'} loading={isLoading} />
        <Kpi tone="blue" label="출력됨 · 불출 대기" value={n(cnt.wait)} note="공정관리에서 출력함 → 현장에 넘기면 불출 처리" onClick={() => go('wait')} on={tab === 'wait'} loading={isLoading} />
        <Kpi tone="red" label="2주 안 납기 · 출력 전" value={n(cnt.urgent)} note="먼저 뽑아야 할 것" onClick={() => go('urgent')} on={tab === 'urgent'} loading={isLoading} />
        <Kpi tone="green" label="불출됨" value={n(cnt.done)} note="진행 중 하네스 PO 중" onClick={() => go('done')} on={tab === 'done'} loading={isLoading} />
      </div>

      {/* 일 순서 안내 — 노트북 화면에선 숨겨 표에 자리를 준다 (v4.65.0) */}
      <div className={`${compact ? 'hidden' : 'grid'} grid-cols-1 md:grid-cols-4 gap-2 text-[12px]`}>
        {[['① 고르기', '출력 전 목록에서 체크 (납기 빠른 순)'], ['② 「공정관리용 복사」', '머리글째 복사 — 불출일은 오늘로 채워짐'],
          ['③ 하네스 공정관리 → 작업지시서 QR → AXCELIS', '붙여넣기 → 폴더 고르고 만들기 (작업지시서 · 도면 출력, 수주 등록)'], ['④ 현장에 넘기면(출도) 「🧺 다품목 출고 → 불출」', '자재를 출고하고, 출고가 끝나면 그 줄을 불출 처리 (출고가 따로 없으면 「✅ 불출만 표시」)']]
          .map(([a, b], i) => (
            <div key={a} className={`rounded-lg border border-dashed px-3 py-2 ${i === 2 ? 'border-teal-300 bg-teal-50/60 text-teal-800' : 'border-indigo-200 bg-indigo-50/60 text-indigo-700'}`}>
              <b className="block">{a}</b>{b}
            </div>))}
      </div>

      {undoBar}{confirmEl}
      <PoCart open={cartOpen} onClose={() => setCartOpen(false)} />
      {pasteOpen && <PasteIssueModal busy={busy} onClose={() => setPasteOpen(false)}
        onIssue={async (list, toIssue) => {
          if (toIssue) { setPasteOpen(false); sendIssue(list); return }
          if (await setIssued(true, list)) setPasteOpen(false)
        }} />}
      {justIssued && justIssued.length > 0 && (
        <div data-hr-just className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-800">
          <b>✅ {justIssued.length}줄 불출 처리했습니다.</b>
          <span>자재도 바로 빼려면 → 다품목 출고에서 하네스 BOM 을 전개해 한 번에 출고합니다.</span>
          <button data-hr-just-send onClick={() => sendIssue(justIssued.map(p => ({ ...p, material_issued: true })))} className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700">🧺 이 {justIssued.length}줄 다품목 출고로</button>
          <button onClick={() => setJustIssued(null)} className="px-2 py-1 text-[11px] text-violet-400">닫기</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        {/* 구분 — 생산관리 밖 AX PO 전부라 하네스 · 단품을 나눠 본다 (v4.147.0) */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2" data-hr-div-filter>
          <span className="text-[11px] font-bold text-slate-400 mr-1">구분</span>
          {[['all', `전체 ${n(pos.length)}`], ...['하네스', '구매품', '전장'].filter(k => divCnt[k]).map(k => [k, `${k} ${n(divCnt[k])}`]),
            ...Object.keys(divCnt).filter(k => !['하네스', '구매품', '전장'].includes(k)).map(k => [k, `${k} ${n(divCnt[k])}`])].map(([k, l]) => (
            <button key={k} data-hr-div-btn={k} onClick={() => { setDivF(k); setSel(new Set()) }}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${divF === k ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        {/* 위 줄 = 보기(단계 · 검색) · 아래 줄 = 고른 줄로 할 일 — 버튼은 늘 같은 자리 · 같은 폭 (단계에 안 맞으면 흐리게) (v4.150.0)
            예전엔 단계마다 버튼이 생겼다 없어지고 「(3)」 개수가 글자에 붙어 고를 때마다 줄이 밀렸다 */}
        <div className="flex flex-wrap items-center gap-2 mb-2" data-hr-viewbar>
          {[['todo', `출력 전 ${n(cnt.todo)}`], ['wait', `출력됨 · 불출 대기 ${n(cnt.wait)}`], ['urgent', `2주 안 납기 ${n(cnt.urgent)}`], ['done', `불출됨 ${n(cnt.done)}`], ['all', '전체']].map(([k, l]) => (
            <button key={k} data-hr-tab={k} onClick={() => go(k)} className={pill(k)}>{l}</button>
          ))}
          <input data-hr-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO · 품번 · 품명 · 제조사품번 검색" className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-64" />
          <div className="ml-auto flex items-center gap-2">
            {canEdit && <button data-hr-paste onClick={() => setPasteOpen(true)} title="하네스 공정관리 출도 기록(고객사 · PO No · Order Line · Del Line · 도면번호 …)을 복사해 붙이면 그 PO 줄을 한 번에 불출 처리합니다"
              style={{ width: 170 }} className="py-1.5 text-xs font-bold rounded-lg border border-teal-300 text-teal-700 bg-white hover:bg-teal-50">📋 출도 기록 붙여넣어 불출</button>}
            <button data-hr-cart-open onClick={() => setCartOpen(true)} style={{ width: 96 }}
              className="py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50">🛒 담기함 <span className="font-mono">{n(cartRows.length)}</span></button>
            <button onClick={() => excel().catch(e => toastError('엑셀 실패: ' + e.message))} style={{ width: 72 }} className="py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📊 엑셀</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-hr-actbar>
          <span className="text-xs text-slate-500 whitespace-nowrap" style={{ width: 120 }} data-hr-selcount>
            {selRows.length ? <b className="text-indigo-700">{n(selRows.length)}줄 선택</b> : '줄을 골라 주세요'}<span className="text-slate-400"> / {n(rows.length)}</span>
          </span>
          {(() => {
            const has = selRows.length > 0, live = tab !== 'done'
            const B = (on, cls) => `py-1.5 text-xs font-bold rounded-lg border ${on ? cls : 'border-slate-200 bg-white text-slate-300 cursor-not-allowed'}`
            return <>
              <button data-hr-copy disabled={!has || !live} onClick={doCopy} style={{ width: 132 }} title={live ? '하네스 공정관리 「작업지시서 QR → AXCELIS」에 붙여넣을 글자로 복사' : '불출됨 목록에선 쓰지 않습니다'}
                className={B(has && live, 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700')}>📋 공정관리용 복사</button>
              {canEdit && <button data-hr-toissue disabled={!has || !live} onClick={() => sendIssue(selRows)} style={{ width: 150 }}
                title="고른 줄의 하네스 품번 · 잔량을 다품목 출고 붙여넣기 칸에 채워 엽니다 → 담기 · 전개 · 출고 → 출고가 끝나면 이 줄들을 불출 처리할지 묻습니다"
                className={B(has && live, 'border-violet-600 bg-violet-600 text-white hover:bg-violet-700')}>🧺 다품목 출고 → 불출</button>}
              {canEdit && <button data-hr-cart disabled={!has || busy} onClick={putCart} style={{ width: 104 }}
                title="구매품은 그 품목 그대로, 하네스 · ASSY 는 BOM 하위로 펼쳐 잔량만큼 발주 담기함에 담습니다 (담기함에서 수량 · 구매처 · 납기를 고쳐 구매처별로 등록)"
                className={B(has && !busy, 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100')}>🛒 발주 담기</button>}
              {canEdit && <button data-hr-issue disabled={!has || !live || busy} onClick={() => setIssued(true)} style={{ width: 104 }}
                title="자재 출고 없이 불출 표시만 (이미 출고했거나 출고가 따로 필요 없을 때)"
                className={B(has && live && !busy, 'border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100')}>✅ 불출만 표시</button>}
              {canEdit && <button data-hr-unissue disabled={!has || tab !== 'done' || busy} onClick={() => setIssued(false)} style={{ width: 84 }}
                title={tab === 'done' ? '고른 줄의 불출 표시를 풉니다' : '「불출됨」 목록에서 씁니다'}
                className={B(has && tab === 'done' && !busy, 'border-rose-300 bg-white text-rose-600 hover:bg-rose-50')}>불출 취소</button>}
              {canEdit && <select data-hr-setdiv value="" disabled={!has || busy} onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) setDivFor(v) }} style={{ width: 112 }}
                title="고객사 PO 구분이 틀린 품번(예: 10번대 하네스가 「구매품」으로 들어옴)을 이 화면에서 바로잡습니다 — 품번 기준으로 기억해 다음 PO 에도 적용"
                className={`py-1.5 px-1.5 text-xs font-bold rounded-lg border ${has && !busy ? 'border-amber-300 bg-white text-amber-700' : 'border-slate-200 bg-white text-slate-300'}`}>
                <option value="">구분 바꾸기…</option>
                <option value="하네스">→ 하네스</option><option value="구매품">→ 구매품</option><option value="전장">→ 전장</option>
                <option value="__reset">↩ PO 구분대로</option>
              </select>}
            </>
          })()}
        </div>

        <div ref={tblRef} className={`overflow-auto border border-slate-200 rounded-xl ${tblH ? '' : 'max-h-[640px]'}`} style={tblH ? { height: tblH + 'px' } : undefined}>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 w-8"><input type="checkbox" data-hr-all checked={allOn} onChange={toggleAll} className="w-4 h-4" /></th>
                <th className="px-2 py-2 text-left">PO / 라인 / 납품라인</th>
                <th className="px-2 py-2 text-left">품번 (도번)</th>
                <th className="px-2 py-2 text-left">품명</th>
                <th className="px-2 py-2 text-center">SREV / BREV</th>
                <th className="px-2 py-2 text-right">잔량</th>
                <th className="px-2 py-2 text-left">납기</th>
                <th className="px-2 py-2 text-left">공정관리</th>
                <th className="px-2 py-2 text-center">불출</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <SkeletonRows cols={9} rows={8} first={1} two={[3]} />}
              {!isLoading && !rows.length && <tr><td colSpan={9} className="py-6 text-center text-slate-400">{tab === 'wait' ? '공정관리에서 출력한 미불출 건이 없습니다.' : '해당하는 하네스 PO 가 없습니다.'}</td></tr>}
              {rows.map(p => (
                <tr key={p.id} data-hr-row={p.id} onClick={() => toggle(p.id)} className={`border-t border-slate-100 cursor-pointer ${sel.has(p.id) ? 'bg-indigo-50/70' : 'hover:bg-slate-50'}`}>
                  <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4" /></td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{p.po_number} <span className="text-slate-400">· {N(p.order_line) || '-'} · {N(p.del_line) || '-'}</span></td>
                  <td className="px-2 py-1.5 font-mono font-bold text-indigo-600 whitespace-nowrap">{pnOf(p.items?.std_code)}{(divOf(p) !== '하네스' || divOv[pnOf(p.items?.std_code)]) && <span data-hr-div={divOf(p)} className={`ml-1 px-1 py-0.5 rounded text-[10px] font-sans font-bold ${divOf(p) === '하네스' ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-600'}`}
                    title={divOv[pnOf(p.items?.std_code)] ? `이 화면에서 바꾼 구분 (PO 구분: ${p.division || '—'})` : '고객사 PO 구분 — 하네스(16번대)가 아닌 단품'}>{divOf(p)}{divOv[pnOf(p.items?.std_code)] ? ' ✎' : ''}</span>}{needBom(p) && !hasBom(p) && <span data-hr-nobom className="ml-1 px-1 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px] font-sans font-bold" title="고객사 BOM 이 없어 다품목 출고에서 전개되지 않습니다">BOM 없음</span>}</td>
                  <td className="px-2 py-1.5"><div className="truncate max-w-[300px]" title={p.items?.name}>{p.items?.name || '—'}</div>
                    {divOf(p) === '구매품' && (p.items?.manufacturer || p.items?.manufacturer_code) && <div className="text-[11px] text-slate-500 truncate max-w-[300px]" data-hr-maker>{p.items?.manufacturer || '—'} · <span className="font-mono">{p.items?.manufacturer_code || '—'}</span></div>}
                    {p.ccn && <div className="text-[11px] text-slate-400">CCN {P(p.ccn)}</div>}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{p.item_rev || '-'} / {p.item_brev || '-'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{n(leftOf(p))}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{yy(p.promise_date) || '—'} {!p.material_issued && <DBadge d={dDay(p.promise_date)} />}{p.plan_exc && <PlanBadge plan={p.plan_exc} changes={p.changes} className="ml-1" />}</td>
                  <td className="px-2 py-1.5" data-hr-hs>{hsTxt(p)}</td>
                  <td className="px-2 py-1.5 text-center" data-hr-iss>{p.material_issued ? <Badge tone="green">불출</Badge> : st[p.id]?.printed ? <Badge tone="amber">대기</Badge> : <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {copied && (
          <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[12px]" data-hr-copied>
            <b className="text-indigo-700">📋 {copied.ok ? `${copied.n}줄 복사됨` : '복사가 막혔습니다 — 아래를 직접 복사하세요'}</b>
            <span className="text-slate-500"> · 하네스 공정관리 「작업지시서 QR → AXCELIS」에 붙여넣으면 머리글을 보고 열을 잡습니다. 수량은 잔량, 불출일은 오늘입니다.</span>
            <textarea readOnly value={copied.text} onFocus={(e) => e.target.select()} className="mt-1.5 w-full h-28 font-mono text-[11px] bg-white border border-indigo-100 rounded p-2" />
          </div>
        )}
        <p className={`mt-2 text-[11px] text-slate-400 ${compact ? 'hidden' : ''}`}>
          줄을 누르면 선택됩니다 · 공정관리 기록은 출력(작업지시서 만들기) 때 켜지는 출력 표시와 QR 이력을 PO · 오더라인 · 납품라인으로 맞춰 봅니다 (라인 없는 옛 건은 PO · 도번).
          불출 취소는 「불출됨」에서 골라 풀면 됩니다.
        </p>
      </div>
    </div>
  )
}

// ── 공정관리 출도 기록 붙여넣어 불출 (v4.144.0) ─────────────────────────────
//   하네스 공정관리 「기록」 표를 그대로 복사해 붙이면 → PO · 오더라인 · 납품라인으로 고객사 PO 줄을 찾아 → 「✅ 불출 표시」 (또는 다품목 출고로)
//   이 화면 목록(진행 중)에 없는 줄도 찾도록 붙인 PO 번호로 고객사 PO 를 다시 읽는다 — 완료 · 취소 · 이미 불출은 건너뛴다
const PASTE_STATE = {
  ok: ['teal', '불출할 줄'], done: ['green', '이미 불출'], closed: ['gray', 'PO 완료 · 취소'],
  none: ['red', '수주대장에 없음'], many: ['amber', '라인 없음 · 같은 도번 여러 줄'], dup: ['gray', '같은 줄 중복'],
}
function PasteIssueModal({ onClose, onIssue, busy }) {
  const [text, setText] = useState('')
  const [res, setRes] = useState(null)      // { rows, skipped, matched }
  const [loading, setLoading] = useState(false)
  async function check(t = text) {
    const pr = parseHarnessPaste(t)
    if (!pr.rows.length) { setRes({ ...pr, matched: [] }); return }
    setLoading(true)
    try {
      const nos = [...new Set(pr.rows.map(r => r.po))]
      // v4.158.0 — 수주대장 줄 (그 PO 의 줄 전부 — 납품 · 취소는 status 로 「끝난 줄」)
      const pos = await fetchAxLines(nos)
      setRes({ ...pr, matched: matchHarnessPaste(pr.rows, pos) })
    } catch (e) { toastError('수주대장 읽기 실패: ' + e.message) } finally { setLoading(false) }
  }
  const m = res?.matched || []
  const okRows = m.filter(x => x.state === 'ok')
  const cnt = m.reduce((a, x) => ({ ...a, [x.state]: (a[x.state] || 0) + 1 }), {})
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()} data-hr-paste-modal>
        <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">📋 출도 기록 붙여넣어 불출</h3>
            <p className="text-[11px] text-slate-400">하네스 공정관리 기록 표(고객사 · PO No · Order Line · Del Line · 도면번호 · 수량 · 공정 …)를 머리글째 복사해 붙이세요. PO · 오더라인 · 납품라인으로 고객사 PO 줄을 찾습니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <textarea value={text} autoFocus data-hr-paste-text
            onChange={(e) => { setText(e.target.value); setRes(null) }}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); setText(t); check(t) } }}
            placeholder={'고객사\tPO No\tOrder Line\tDel Line\t프로젝트\t도면번호\t호기\t수량\t공정 …\nAxcelis\t824470\t7\t1\t\t160024189\t\t29\t출도 …'}
            className="w-full h-28 px-3 py-2 text-[11px] font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400" />
          <div className="flex items-center gap-2">
            <button onClick={() => check()} disabled={!text.trim() || loading} data-hr-paste-check
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white disabled:opacity-40">{loading ? '찾는 중…' : '🔍 수주대장 찾기'}</button>
            {res && <span className="text-[11px] text-slate-500" data-hr-paste-sum>
              붙인 줄 {res.rows.length}{res.skipped ? ` (중복 · 빈 줄 ${res.skipped} 뺌)` : ''} — {Object.entries(cnt).map(([k, v]) => `${PASTE_STATE[k][1]} ${v}`).join(' · ')}
            </span>}
          </div>
          {m.length > 0 && (
            <div className="overflow-x-auto border border-slate-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-2 py-1.5 text-left">붙인 PO / 라인</th><th className="px-2 py-1.5 text-left">도면번호</th><th className="px-2 py-1.5 text-right">붙인 수량</th>
                  <th className="px-2 py-1.5 text-left">수주대장 줄</th><th className="px-2 py-1.5 text-right">잔량</th><th className="px-2 py-1.5 text-left">상태</th>
                </tr></thead>
                <tbody>
                  {m.map((x, i) => {
                    const [tone, label] = PASTE_STATE[x.state]
                    return (
                      <tr key={i} className={`border-t border-slate-100 ${x.state === 'ok' ? '' : 'text-slate-400'}`} data-hr-paste-row={x.state}>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{x.po} · {x.ol || '-'} · {x.dl}</td>
                        <td className="px-2 py-1.5 font-mono">{x.dwg || '—'}{x.proc && x.proc !== '출도' && <span className="ml-1 text-[10px] text-amber-600">{x.proc}</span>}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{x.qty ?? '—'}</td>
                        <td className="px-2 py-1.5">{x.p ? <><span className="font-mono font-bold text-indigo-600">{pnOf(x.p.items?.std_code)}</span> <span className="text-slate-400">{x.p.items?.name || ''}</span>
                          {x.dwgDiff && <span className="ml-1 px-1 rounded bg-amber-50 text-amber-700 text-[10px] font-bold" title="공정관리 도면번호와 수주대장 품번이 다릅니다">⚠ 도번 다름</span>}
                          {x.how === 'dwg' && <span className="ml-1 text-[10px] text-slate-400">PO+도번으로 찾음</span>}</> : '—'}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${x.p && x.qty != null && leftOf(x.p) !== x.qty && x.state === 'ok' ? 'text-amber-600 font-bold' : ''}`}>{x.p ? n(leftOf(x.p)) : '—'}</td>
                        <td className="px-2 py-1.5"><Badge tone={tone}>{label}</Badge></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {res && !res.rows.length && <p className="text-xs text-rose-600">PO 번호를 못 읽었습니다 — 공정관리 기록 표를 머리글째 복사해 붙여 주세요.</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11px] text-slate-400">불출 표시 = 수주대장 자재불출 체크 (쇼티지에서 빠짐 · 재고는 그대로) · 처리 뒤 「↩ 되돌리기」 가능</span>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
          <button disabled={!okRows.length || busy} onClick={() => onIssue(okRows.map(x => x.p), true)} data-hr-paste-toissue
            title="자재도 같이 빼려면 — 다품목 출고에 하네스 품번 · 잔량을 채워 엽니다. 출고가 끝나면 불출 처리를 묻습니다"
            className="px-3 py-2 text-sm font-bold rounded-lg border border-violet-300 text-violet-700 bg-violet-50 disabled:opacity-40">🧺 다품목 출고 → 불출</button>
          <button disabled={!okRows.length || busy} onClick={() => onIssue(okRows.map(x => x.p), false)} data-hr-paste-issue
            className="px-4 py-2 text-sm font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40">✅ {okRows.length}줄 불출 표시</button>
        </div>
      </div>
    </div>
  )
}

