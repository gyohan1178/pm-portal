import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { toastError, toastSuccess } from '../../lib/toast'
import { logActivity } from '../../lib/activityLog'
import { refreshProcurement } from '../../lib/refresh'
import { useCanEdit } from '../../hooks/useProfile'

// 🧵 하네스 출도 · 불출 (v4.53.0, 2026-10-14)
//   미불출 AXCELIS 하네스(16번대) PO 줄을 골라 → 하네스 공정관리 「작업지시서 QR → AXCELIS」에 붙여넣을 글자로 복사
//   → 공정관리에서 출도(작업지시서 · 도면)하면 그 기록(harness_orders.qr_printed · harness_qr_history)을
//     PO · 오더라인 · 납품라인으로 맞춰 「출도됨」으로 보여주고 → 「불출 처리」 = 고객사 PO 자재불출 체크.
//   ⚠ 공정관리 쪽 표는 읽기만 한다 (harness_* 는 하네스 공정관리 소유).
//   ⚠ 불출 처리는 표시만 — 재고 수량은 출고 화면에서 출고할 때만 줄어든다. 쇼티지 계산에서 그 PO 줄이 빠진다.
//   「🧺 다품목 출고로」: 고른 줄의 하네스 품번 · 잔량을 다품목 출고 「붙여넣기」 칸에 채워 넘긴다 → 담기 → 전개(BOM) → 출고.

export const AX_ID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'
const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const yy = (d) => (d ? String(d).slice(2, 10) : '')
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
function Kpi({ tone, label, value, note, onClick, on }) {
  const T = { amber: 'bg-amber-50 border-amber-200 text-amber-700', blue: 'bg-sky-50 border-sky-200 text-sky-700', red: 'bg-rose-50 border-rose-200 text-rose-600', green: 'bg-emerald-50 border-emerald-200 text-emerald-700' }[tone]
  return (
    <button type="button" onClick={onClick} className={`text-left rounded-xl border px-4 py-3 ${T} ${on ? 'ring-2 ring-offset-1 ring-slate-300' : ''}`}>
      <div className="text-[12px] font-bold opacity-70">{label}</div>
      <div className="text-2xl font-extrabold leading-tight">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </button>
  )
}

export default function HarnessRelease() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const canEdit = useCanEdit()
  const [justIssued, setJustIssued] = useState(null)   // 방금 불출 처리한 줄 — 다품목 출고로 이어 보내기
  const [tab, setTab] = useState('todo')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [copied, setCopied] = useState(null)   // { text, n, at }
  const [busy, setBusy] = useState(false)

  // 진행 중 AXCELIS 하네스 PO 줄
  const { data: pos = [], isLoading, error } = useQuery({
    queryKey: ['harnessRelease', 'pos'],
    queryFn: () => fetchAll(() => supabase.from('purchase_orders')
      .select('id,po_number,ccn,order_line,del_line,item_rev,item_brev,qty_ordered,qty_received,qty_remaining,promise_date,status,material_issued, items!purchase_orders_item_id_fkey(std_code,name)')
      .eq('customer_id', AX_ID).eq('order_type', 'customer_po').eq('division', '하네스')
      .not('status', 'in', '(완료,취소)').order('promise_date', { ascending: true }).order('id')),
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

  function sendIssue(list) {
    const ok = list.filter(p => hasBom(p) && leftOf(p) > 0)
    const noBom = list.filter(p => !hasBom(p))
    if (!ok.length) { toastError(noBom.length ? 'BOM 이 등록된 하네스가 없습니다 — 고객사 BOM 을 먼저 올려 주세요' : '잔량이 있는 줄이 없습니다'); return }
    if (noBom.length && !confirm(`BOM 이 없는 ${noBom.length}줄은 빼고 보냅니다 (${[...new Set(noBom.map(p => pnOf(p.items?.std_code)))].slice(0, 5).join(', ')}${noBom.length > 5 ? ' …' : ''}).\n계속할까요?`)) return
    nav('/issue', { state: { issuePaste: issueText(ok), csCode: 'ax', from: `하네스 출도 · 불출 ${ok.length}줄` } })
  }

  const stage = (p) => p.material_issued ? 'done' : st[p.id]?.printed ? 'wait' : 'todo'
  const cnt = useMemo(() => {
    const c = { todo: 0, wait: 0, done: 0, urgent: 0 }
    pos.forEach(p => { const s = stage(p); c[s]++; if (s === 'todo') { const d = dDay(p.promise_date); if (d != null && d <= 14) c.urgent++ } })
    return c
  }, [pos, st])

  const kw = q.trim().toLowerCase()
  const rows = useMemo(() => pos.filter(p => {
    if (tab === 'urgent') { if (stage(p) !== 'todo') return false; const d = dDay(p.promise_date); if (d == null || d > 14) return false }
    else if (tab !== 'all' && stage(p) !== tab) return false
    if (!kw) return true
    return `${p.po_number} ${pnOf(p.items?.std_code)} ${p.items?.name || ''}`.toLowerCase().includes(kw)
  }), [pos, st, tab, kw])

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

  async function setIssued(val) {
    const list = selRows.filter(p => !!p.material_issued !== val)
    if (!list.length) return
    const msg = val
      ? `${list.length}줄을 「불출」로 표시할까요?\n\n· 고객사 PO 자재불출 체크 → 쇼티지 계산에서 빠집니다\n· 재고 수량은 바뀌지 않습니다 (출고는 출고 화면에서)`
      : `${list.length}줄의 불출 표시를 풀까요?\n\n· 쇼티지 계산에 다시 들어갑니다`
    if (!confirm(msg)) return
    setBusy(true)
    try {
      const ids = list.map(p => p.id)
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200)
        must(await supabase.from('purchase_orders').update({ material_issued: val }).in('id', part), '고객사 PO 불출 표시')
        // 고객사 PO 화면 토글과 같게 — 연결된 생산 호기(po_id) 불출 체크도 맞춘다
        must(await supabase.from('production').update({ part_issue: val }).in('po_id', part), '생산 호기 불출 표시')
      }
      await logActivity('update', 'purchase_orders', null,
        `${val ? '하네스 출도 → 불출 처리' : '하네스 불출 취소'} ${list.length}줄`,
        { rows: list.map(p => ({ id: p.id, po: p.po_number, ol: p.order_line, dl: p.del_line, pn: pnOf(p.items?.std_code) })) }, 'AXCELIS')
      toastSuccess(val ? `${list.length}줄 불출 처리했습니다` : `${list.length}줄 불출 표시를 풀었습니다`)
      setSel(new Set())
      setJustIssued(val ? list : null)
      refreshProcurement(qc)
      qc.invalidateQueries({ queryKey: ['harnessRelease'], exact: false })
      qc.invalidateQueries({ queryKey: ['production'], exact: false })
    } catch (e) { toastError(e.message) } finally { setBusy(false) }
  }

  async function excel() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['PO', '오더라인', '납품라인', 'CCN', '품번', '품명', 'SREV', 'BREV', '잔량', '납기', '공정관리', '출도', '출도자', '불출'],
      ...rows.map(p => { const s = st[p.id] || {}; return [p.po_number, N(p.order_line), N(p.del_line), P(p.ccn), pnOf(p.items?.std_code), p.items?.name || '', p.item_rev || '', p.item_brev || '', leftOf(p), String(p.promise_date || '').slice(0, 10), s.reg ? '등록' : '미등록', s.printed ? md(s.at) : '', s.by || '', p.material_issued ? 'Y' : ''] }),
    ])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '하네스출도')
    XLSX.writeFile(wb, `하네스_출도불출_${todayKST()}.xlsx`)
  }

  const pill = (k) => `px-3 py-1.5 rounded-full border text-xs font-bold ${tab === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`
  const hsTxt = (p) => {
    const s = st[p.id]
    if (!hx) return <span className="text-slate-300">…</span>
    if (s?.printed) return <Badge tone="teal" title={s.at ? `공정관리 출도 ${s.at}` : ''}>🖨 출도{s.at ? ` ${md(s.at)}` : ''}{s.by ? ` · ${s.by}` : ''}</Badge>
    if (s?.reg) return <Badge tone="blue">등록됨 · 출도 전</Badge>
    return <Badge>미등록</Badge>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-slate-400">🏭 현장 · AXCELIS 하네스 (16번대)</p>
        <h1 className="text-xl font-extrabold text-slate-900">🧵 하네스 출도 · 불출</h1>
        <p className="text-[13px] text-slate-400 mt-0.5">
          아직 불출 안 한 하네스 PO 를 골라 하네스 공정관리에 붙여넣고(작업지시서 · 도면 출도), 공정관리에 출도 기록이 생기면 여기서 「불출 처리」합니다.
          불출 처리 = 고객사 PO 「자재불출」 체크 → 쇼티지 계산에서 빠짐 (재고 수량은 그대로 — 출고는 출고 화면에서).
        </p>
      </div>

      {(error || hErr) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ {error ? '하네스 PO 를 못 불러왔습니다: ' + error.message : '하네스 공정관리 기록을 못 읽었습니다 (출도 여부가 안 보임): ' + hErr.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-hr-kpi>
        <Kpi tone="amber" label="출도 전" value={n(cnt.todo)} note="미불출 · 공정관리 출도 기록 없음" onClick={() => go('todo')} on={tab === 'todo'} />
        <Kpi tone="blue" label="출도됨 · 불출 대기" value={n(cnt.wait)} note="공정관리에서 뽑음 → 불출 처리만 남음" onClick={() => go('wait')} on={tab === 'wait'} />
        <Kpi tone="red" label="2주 안 납기 · 출도 전" value={n(cnt.urgent)} note="먼저 뽑아야 할 것" onClick={() => go('urgent')} on={tab === 'urgent'} />
        <Kpi tone="green" label="불출됨" value={n(cnt.done)} note="진행 중 하네스 PO 중" onClick={() => go('done')} on={tab === 'done'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[12px]">
        {[['① 고르기', '출도 전 목록에서 체크 (납기 빠른 순)'], ['② 「공정관리용 복사」', '머리글째 복사 — 불출일은 오늘로 채워짐'],
          ['③ 하네스 공정관리 → 작업지시서 QR → AXCELIS', '붙여넣기 → 폴더 고르고 만들기 (작업지시서 · 도면 출력, 수주 등록)'], ['④ 「출도됨」 → 「불출 처리」', '공정관리 출도 기록을 PO · 라인으로 맞춰 자동으로 보여줌']]
          .map(([a, b], i) => (
            <div key={a} className={`rounded-lg border border-dashed px-3 py-2 ${i === 2 ? 'border-teal-300 bg-teal-50/60 text-teal-800' : 'border-indigo-200 bg-indigo-50/60 text-indigo-700'}`}>
              <b className="block">{a}</b>{b}
            </div>))}
      </div>

      {justIssued && justIssued.length > 0 && (
        <div data-hr-just className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-violet-800">
          <b>✅ {justIssued.length}줄 불출 처리했습니다.</b>
          <span>자재도 바로 빼려면 → 다품목 출고에서 하네스 BOM 을 전개해 한 번에 출고합니다.</span>
          <button data-hr-just-send onClick={() => sendIssue(justIssued)} className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700">🧺 이 {justIssued.length}줄 다품목 출고로</button>
          <button onClick={() => setJustIssued(null)} className="px-2 py-1 text-[11px] text-violet-400">닫기</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {[['todo', `출도 전 ${n(cnt.todo)}`], ['wait', `출도됨 · 불출 대기 ${n(cnt.wait)}`], ['urgent', `2주 안 납기 ${n(cnt.urgent)}`], ['done', `불출됨 ${n(cnt.done)}`], ['all', '전체']].map(([k, l]) => (
            <button key={k} data-hr-tab={k} onClick={() => go(k)} className={pill(k)}>{l}</button>
          ))}
          <input data-hr-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="PO · 품번 · 품명 검색" className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56" />
          <span className="ml-auto text-xs text-slate-400">{selRows.length ? `${n(selRows.length)}줄 선택 · ` : ''}{n(rows.length)}줄</span>
          {tab !== 'done' && (
            <button data-hr-copy disabled={!selRows.length} onClick={doCopy}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg ${selRows.length ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-400'}`}>📋 공정관리용 복사{selRows.length ? ` (${selRows.length})` : ''}</button>
          )}
          {canEdit && tab !== 'done' && (
            <button data-hr-issue disabled={!selRows.length || busy} onClick={() => setIssued(true)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg ${selRows.length && !busy ? 'bg-teal-600 text-white hover:bg-teal-700' : 'bg-slate-100 text-slate-400'}`}>✅ 불출 처리{selRows.length ? ` (${selRows.length})` : ''}</button>
          )}
          {canEdit && tab === 'done' && (
            <button data-hr-unissue disabled={!selRows.length || busy} onClick={() => setIssued(false)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${selRows.length && !busy ? 'border-rose-300 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-300'}`}>불출 취소{selRows.length ? ` (${selRows.length})` : ''}</button>
          )}
          {canEdit && (
            <button data-hr-toissue disabled={!selRows.length} onClick={() => sendIssue(selRows)} title="고른 줄의 하네스 품번 · 잔량을 다품목 출고 붙여넣기 칸에 채워 엽니다 (담기 → 전개 → 출고)"
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${selRows.length ? 'border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100' : 'border-slate-200 text-slate-300'}`}>🧺 다품목 출고로{selRows.length ? ` (${selRows.length})` : ''}</button>
          )}
          <button onClick={() => excel().catch(e => toastError('엑셀 실패: ' + e.message))} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📊 엑셀</button>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[640px] overflow-y-auto">
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
              {isLoading && <tr><td colSpan={9} className="py-6 text-center text-slate-400">불러오는 중…</td></tr>}
              {!isLoading && !rows.length && <tr><td colSpan={9} className="py-6 text-center text-slate-400">{tab === 'wait' ? '공정관리에서 출도한 미불출 건이 없습니다.' : '해당하는 하네스 PO 가 없습니다.'}</td></tr>}
              {rows.map(p => (
                <tr key={p.id} data-hr-row={p.id} onClick={() => toggle(p.id)} className={`border-t border-slate-100 cursor-pointer ${sel.has(p.id) ? 'bg-indigo-50/70' : 'hover:bg-slate-50'}`}>
                  <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4" /></td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{p.po_number} <span className="text-slate-400">· {N(p.order_line) || '-'} · {N(p.del_line) || '-'}</span></td>
                  <td className="px-2 py-1.5 font-mono font-bold text-indigo-600 whitespace-nowrap">{pnOf(p.items?.std_code)}{!hasBom(p) && <span data-hr-nobom className="ml-1 px-1 py-0.5 rounded bg-slate-100 text-slate-400 text-[10px] font-sans font-bold" title="고객사 BOM 이 없어 다품목 출고에서 전개되지 않습니다">BOM 없음</span>}</td>
                  <td className="px-2 py-1.5"><div className="truncate max-w-[300px]" title={p.items?.name}>{p.items?.name || '—'}</div>{p.ccn && <div className="text-[11px] text-slate-400">CCN {P(p.ccn)}</div>}</td>
                  <td className="px-2 py-1.5 text-center font-mono">{p.item_rev || '-'} / {p.item_brev || '-'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{n(leftOf(p))}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{yy(p.promise_date) || '—'} {!p.material_issued && <DBadge d={dDay(p.promise_date)} />}</td>
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
        <p className="mt-2 text-[11px] text-slate-400">
          줄을 누르면 선택됩니다 · 공정관리 기록은 출도(작업지시서 만들기) 때 켜지는 출력 표시와 출도 이력을 PO · 오더라인 · 납품라인으로 맞춰 봅니다 (라인 없는 옛 건은 PO · 도번).
          불출 취소는 「불출됨」에서 고르거나 고객사 PO 에서 체크를 풀면 됩니다.
        </p>
      </div>
    </div>
  )
}
