import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import QrScanner from '../../components/QrScanner'
import { logActivity } from '../../lib/activityLog'
import { toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'
import { useCanEdit } from '../../hooks/useProfile'
import { ilikeAny } from '../../lib/pgFilter'
import { refreshProcurement } from '../../lib/refresh'
import { useCycleBase } from '../../hooks/useCycleCount'
import { ownerCells, checkMap, todayPlan, ownerOfLoc, DAILY } from '../../lib/cycleCount'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// QR 을 스캔하면 열리는 화면. 폰에서 쓰므로 글자와 입력창을 크게 둔다.
//
//   1. 칸에 있는 품목과 장부 수량이 보인다
//   2. 실제 센 수량을 입력한다
//   3. 저장하면 재고에 바로 반영된다 (순환 실사 v4.76.0 — pm_cycle_save)
//      빈 칸이면 「비어 있음 확인」 한 번. 저장 뒤에는 담당자의 다음 칸으로 바로 간다.
//      (DB 설정 전이면 예전처럼 기록만 하고 「재고 반영」을 따로 누른다)
export default function CellAudit() {
  const { loc } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [counts, setCounts] = useState({})
  const [memos, setMemos] = useState({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [justDone, setJustDone] = useState(null)   // 방금 저장한 결과 → 다음 칸 안내
  const [scanOpen, setScanOpen] = useState(false)
  // 이 칸에 없는 품목을 찾아 넣거나, 다른 칸에 있던 것을 옮긴다
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)
  const [addQty, setAddQty] = useState('')
  const [picked, setPicked] = useState(null)
  const searchTimer = useRef(null)

  const location = (loc || '').toUpperCase()
  useEffect(() => { setJustDone(null) }, [location])

  // 순환 실사 — 이 칸 담당자 · 다음 칸
  const { data: cyc } = useCycleBase()
  const cycle = (() => {
    if (!cyc?.setup) return null
    const owner = ownerOfLoc(location, cyc.owners)
    if (!owner) return { owner: null }
    const o = ownerCells(cyc.racks, cyc.owners).get(owner)
    const plan = todayPlan(o?.cells || [], checkMap(cyc.checks), todayISO(), 1e9, o?.late)
    const next = plan.list.find(c => !c.done && c.loc !== location)?.loc || null
    return { owner, done: plan.done, next }
  })()

  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ['cellItems', location],
    enabled: !!location,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_cell_items', { p_loc: location })
      if (error) throw error
      return data || []
    },
    staleTime: 30 * 1000,   // 실사 중 반복 조회를 줄인다
  })

  // 오늘 이 칸을 이미 실사했는지
  const { data: prev = [] } = useQuery({
    queryKey: ['cellAuditToday', location],
    enabled: !!location,
    queryFn: async () => {
      const { data } = await supabase.from('pm_stock_audit')
        .select('id,item_id,book_qty,counted_qty,diff,applied,memo')
        .eq('location', location)
        .eq('audit_date', todayISO())
      return data || []
    },
  })

  // 이미 실사한 값이 있으면 채워둔다
  useEffect(() => {
    if (!prev.length) return
    const c = {}, m = {}
    prev.forEach(p => { c[p.item_id] = String(p.counted_qty); if (p.memo) m[p.item_id] = p.memo })
    setCounts(c); setMemos(m); setSaved(true)
  }, [prev])

  const diffOf = (it) => {
    const v = counts[it.item_id]
    if (v === undefined || v === '') return null
    return Number(v) - (Number(it.qty) || 0)
  }
  const filled = items.filter(it => counts[it.item_id] !== undefined && counts[it.item_id] !== '').length
  const diffCnt = items.filter(it => { const d = diffOf(it); return d !== null && d !== 0 }).length

  // 품목 검색 — 입력이 멈춘 뒤 조회
  function searchItems(v) {
    setQ(v); setPicked(null)
    clearTimeout(searchTimer.current)
    if (v.trim().length < 2) { setHits([]); return }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      const t = v.trim()
      const { data } = await supabase.from('items')
        .select('id,std_code,name,unit,manufacturer,manufacturer_code,spec, inventory(qty,location)')
        .or(ilikeAny(['std_code', 'name', 'manufacturer_code', 'manufacturer', 'spec'], t))
        .limit(20)
      setHits(data || []); setSearching(false)
    }, 300)
  }

  // 이 칸에 품목을 넣는다. 다른 칸에 있던 것이면 위치가 옮겨진다.
  async function addItem() {
    if (!picked) return
    const qty = Number(addQty)
    if (!(qty >= 0)) { toastError('수량을 입력하세요'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('inventory')
        .upsert({ item_id: picked.id, qty, location }, { onConflict: 'item_id' })
      if (error) throw error
      const prevLoc = picked.inventory?.[0]?.location
      logActivity('update', 'inventory', picked.std_code,
        prevLoc && prevLoc !== location
          ? `위치 이동 ${prevLoc} → ${location} · 수량 ${qty}`
          : `${location} 에 등록 · 수량 ${qty}`)
      toastSuccess(`${picked.std_code} → ${location}`)
      setAddOpen(false); setQ(''); setHits([]); setPicked(null); setAddQty('')
      qc.invalidateQueries({ queryKey: ['cellItems'] })
    } catch (e) {
      toastError('등록 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  // 이 칸에서 뺀다 (위치만 비우고 재고는 남긴다)
  async function removeFromCell(it) {
    if (!confirm(`${it.std_code} 를 이 칸에서 빼시겠습니까?\n\n재고 수량은 그대로 남고 위치만 비워집니다.`)) return
    try {
      const { error } = await supabase.from('inventory')
        .update({ location: null }).eq('item_id', it.item_id)
      if (error) throw error
      logActivity('update', 'inventory', it.std_code, `${location} 에서 위치 해제`)
      toastSuccess(`${it.std_code} 위치 해제`)
      qc.invalidateQueries({ queryKey: ['cellItems'] })
    } catch (e) {
      toastError('실패: ' + e.message)
    }
  }

  // 오늘 이 칸에서 기록만 하고 아직 재고에 반영 안 한 것 → 여기서 바로 반영 (차이만큼)
  const canEdit = useCanEdit()
  const pendingIds = prev.filter(p => !p.applied && Number(p.counted_qty) !== Number(p.book_qty)).map(p => p.id)
  const [applying, setApplying] = useState(false)
  async function applyNow() {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return }
    const ids = prev.filter(p => !p.applied).map(p => p.id)
    if (!ids.length) return
    setApplying(true)
    try {
      const { data, error } = await supabase.rpc('pm_audit_apply', { p_ids: ids })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      toastSuccess(`재고 반영 ${n(r?.done_cnt)}건 — 줄임 ${n(r?.out_cnt)} · 늘림 ${n(r?.in_cnt)}`)
      qc.invalidateQueries({ queryKey: ['cellItems'] })
      qc.invalidateQueries({ queryKey: ['cellAuditToday'] })
      qc.invalidateQueries({ queryKey: ['inventory'], exact: false })
      qc.invalidateQueries({ queryKey: ['pendingAuditCount'] })
    } catch (e) { toastError('반영 실패: ' + e.message) }
    finally { setApplying(false) }
  }

  // 저장 = 재고에 바로 반영. rows 가 비면 「빈 칸 확인」
  async function cycleSave(rows) {
    const { data, error } = await supabase.rpc('pm_cycle_save', { p_loc: location, p_rows: rows })
    if (error) throw error
    return Array.isArray(data) ? data[0] : data
  }
  const missingFn = (e) => e?.code === 'PGRST202' || /pm_cycle_save/.test(e?.message || '')
  function afterSave() {
    setSaved(true)
    qc.invalidateQueries({ queryKey: ['cellItems'] })
    qc.invalidateQueries({ queryKey: ['cellAuditToday'] })
    qc.invalidateQueries({ queryKey: ['cycle'] })
    qc.invalidateQueries({ queryKey: ['menuAlerts'] })   // 할 일 숫자 (오늘 실사)
    qc.invalidateQueries({ queryKey: ['cycleDiffs'] })
    qc.invalidateQueries({ queryKey: ['pendingAuditCount'] })
    refreshProcurement(qc)
  }

  async function save() {
    const rows = items
      .filter(it => counts[it.item_id] !== undefined && counts[it.item_id] !== '')
      .map(it => ({
        item_id: it.item_id, std_code: it.std_code,
        book_qty: Number(it.qty) || 0,
        counted_qty: Number(counts[it.item_id]),
        memo: memos[it.item_id] || null,
      }))
    if (!rows.length) { toastError('입력한 수량이 없습니다'); return }
    if (rows.some(r => !(r.counted_qty >= 0))) { toastError('수량은 0 이상 숫자로 넣어 주세요'); return }
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return }
    if (rows.length < items.length &&
      !window.confirm(`${items.length - rows.length}품목은 수량을 안 넣었습니다.\n\n넣은 ${rows.length}품목만 저장 · 반영할까요?`)) return
    setBusy(true)
    try {
      try {
        const r = await cycleSave(rows)
        afterSave()
        setJustDone({ saved: r?.saved_cnt ?? rows.length, diff: r?.diff_cnt ?? 0, empty: false })
        toastSuccess(`재고에 바로 반영 — ${n(r?.saved_cnt)}품목 · 차이 ${n(r?.diff_cnt)}${r?.diff_cnt ? ` (줄임 ${n(r?.out_cnt)} · 늘림 ${n(r?.in_cnt)})` : ''}`)
      } catch (e) {
        if (!missingFn(e)) throw e
        // DB 설정 전 — 예전 방식 (기록만)
        const { data, error } = await supabase.rpc('pm_audit_save', { p_loc: location, p_rows: rows })
        if (error) throw error
        setSaved(true)
        qc.invalidateQueries({ queryKey: ['cellAuditToday'] })
        toastSuccess(`${n(data)}건 실사 기록 — 아래 「재고 반영」을 누르면 재고가 바뀝니다 (재고현황 › 칸 실사 반영에서도 가능)`)
      }
    } catch (e) {
      toastError('저장 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  // 빈 칸 확인 — 센 기록만 남긴다
  async function confirmEmpty() {
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return }
    setBusy(true)
    try {
      await cycleSave([])
      afterSave()
      setJustDone({ saved: 0, diff: 0, empty: true })
      toastSuccess(`${location} 빈 칸 확인`)
    } catch (e) {
      toastError(missingFn(e) ? '순환 실사 DB 설정(순환실사_261020.sql)을 먼저 실행해야 합니다' : '저장 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  const goCell = (l) => { setCounts({}); setMemos({}); setSaved(false); nav(`/cell/${l}`) }

  // 전부 장부와 같다고 표시 (차이 없을 때 빠르게)
  const fillAllSame = () => {
    const c = { ...counts }
    items.forEach(it => { c[it.item_id] = String(Number(it.qty) || 0) })
    setCounts(c)
  }

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-24">
      {/* 품목 넣기 — 검색해서 이 칸에 등록하거나 다른 칸에서 옮긴다 */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setAddOpen(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-slate-800">품목 넣기</h3>
              <button onClick={() => setAddOpen(false)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              <span className="font-mono font-bold text-indigo-600">{location}</span> 에 넣을 품목을 찾으세요.
              다른 칸에 있던 품목이면 위치가 이곳으로 옮겨집니다.
            </p>

            <input value={q} onChange={e => searchItems(e.target.value)} autoFocus
              placeholder="품번·품명·제조사품번 (2자 이상)"
              className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />

            {searching && <p className="text-xs text-slate-400 mt-2">찾는 중…</p>}

            {!picked && hits.length > 0 && (
              <div className="mt-2 space-y-1">
                {hits.map(h => {
                  const inv = h.inventory?.[0]
                  const here = inv?.location === location
                  return (
                    <button key={h.id} onClick={() => { setPicked(h); setAddQty(String(inv?.qty ?? '')) }}
                      disabled={here}
                      className={`w-full text-left px-3 py-2 rounded-lg border ${here
                        ? 'border-slate-100 bg-slate-50 opacity-50'
                        : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'}`}>
                      <p className="font-mono text-sm font-bold text-indigo-600">{h.std_code}</p>
                      <p className="text-xs text-slate-600">{h.name}</p>
                      <p className="text-[11px] text-slate-400">
                        {h.manufacturer}{h.manufacturer && h.manufacturer_code ? ' · ' : ''}
                        <span className="font-mono">{h.manufacturer_code}</span>
                        {h.spec && (
                          <span className="ml-1.5 text-slate-400">{h.spec}</span>
                        )}
                        {inv && (
                          <span className={here ? 'ml-1.5 text-slate-400' : 'ml-1.5 text-amber-600 font-semibold'}>
                            · 재고 {n(inv.qty)}{inv.location ? ` @ ${inv.location}` : ' (위치 없음)'}
                            {here ? ' — 이미 이 칸' : ''}
                          </span>
                        )}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}

            {!picked && !searching && q.trim().length >= 2 && !hits.length && (
              <p className="text-xs text-slate-400 mt-3 text-center py-4">찾는 품목이 없습니다.</p>
            )}

            {picked && (
              <div className="mt-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 p-3">
                <p className="font-mono text-sm font-bold text-indigo-700">{picked.std_code}</p>
                <p className="text-xs text-slate-600">{picked.name}</p>
                {picked.inventory?.[0]?.location && picked.inventory[0].location !== location && (
                  <p className="text-[11px] text-amber-700 font-semibold mt-1">
                    ⚠ {picked.inventory[0].location} 에서 {location} 으로 이동합니다
                  </p>
                )}
                <div className="mt-2">
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">수량</label>
                  <input type="number" inputMode="decimal" value={addQty} autoFocus
                    onChange={e => setAddQty(e.target.value)}
                    className="w-full px-3 py-2.5 text-lg font-bold text-right border-2 border-slate-200 rounded-lg" />
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setPicked(null); setAddQty('') }}
                    className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white">
                    다시 찾기
                  </button>
                  <button onClick={addItem} disabled={busy || addQty === ''}
                    className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                    {busy ? '저장 중…' : `${location} 에 넣기`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {scanOpen && (
        <QrScanner onClose={() => setScanOpen(false)}
          onScan={(l) => { setScanOpen(false); goCell(l) }} />
      )}
      {/* 위치 */}
      <div className="rounded-2xl bg-slate-900 text-white p-5 relative">
        <button onClick={() => nav('/rack-layout')} title="창고 배치도"
          className="absolute top-3 right-3 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-white/10 text-slate-300 hover:bg-white/20">
          🗺 배치도
        </button>
        <p className="text-xs text-slate-400">재고 실사 · 위치</p>
        <p className="text-4xl font-bold font-mono tracking-tight mt-1">{location}</p>
        <p className="text-xs text-slate-400 mt-1">
          {location.split('-')[0]} 랙 · {Number(location.split('-')[1])}칸 · {location.split('-')[2]}층
          {!!items.length && ` · 품목 ${items.length}`}
          {cycle?.owner && ` · ${cycle.owner} 담당`}
        </p>
      </div>

      {/* 방금 저장 → 다음 칸 */}
      {justDone && (
        <div data-cycle-next className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-700">
            ✓ {justDone.empty ? '빈 칸 확인' : `저장 · 재고 반영됨 (${n(justDone.saved)}품목${justDone.diff ? ` · 차이 ${n(justDone.diff)}` : ' · 모두 맞음'})`}
          </p>
          {cycle?.owner && (
            <p className="text-xs text-emerald-700/80 mt-0.5">
              {cycle.owner} 오늘 {n(cycle.done)}칸{cycle.done >= DAILY ? ' — 오늘 목표 끝 ✓ 더 세도 됩니다' : ` / ${DAILY}칸`}
            </p>
          )}
          <div className="flex gap-2 mt-3">
            {cycle?.next && (
              <button onClick={() => goCell(cycle.next)}
                className="flex-1 py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white">다음 칸 → <span className="font-mono">{cycle.next}</span></button>
            )}
            <button onClick={() => nav('/inventory')}
              className="px-4 py-3 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-600">오늘 목록</button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}
      {error && <p className="text-center py-10 text-rose-500 text-sm">위치를 찾을 수 없습니다: {location}</p>}

      {!isLoading && !items.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-400">이 칸에 등록된 재고가 없습니다.</p>
          <p className="text-xs text-slate-400 mt-1">실제로도 비어 있으면 「비어 있음 확인」 · 물건이 있으면 품목을 찾아 넣으세요.</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center mt-4">
            <button data-cycle-empty onClick={confirmEmpty} disabled={busy || justDone?.empty}
              className="px-5 py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
              {justDone?.empty ? '✓ 확인됨' : '✓ 비어 있음 확인'}
            </button>
            <button onClick={() => setAddOpen(true)}
              className="px-5 py-2.5 text-sm font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
              ＋ 품목 넣기
            </button>
            <button onClick={() => setScanOpen(true)}
              className="px-5 py-2.5 text-sm font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800">
              📷 다른 칸 스캔
            </button>
          </div>
        </div>
      )}

      {!!items.length && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{items.length}품목 · 입력 {filled}</span>
            {diffCnt > 0 && <span className="text-xs font-bold text-amber-600">차이 {diffCnt}건</span>}
            {saved && <span className="text-xs font-bold text-emerald-600">저장됨</span>}
            <button onClick={fillAllSame}
              className="ml-auto text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
              전부 장부와 같음
            </button>
            <button onClick={() => setAddOpen(true)}
              className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
              ＋ 품목
            </button>
          </div>

          <div className="space-y-2">
            {items.map(it => {
              const d = diffOf(it)
              return (
                <div key={it.item_id} className={`rounded-xl border bg-white p-3 ${d !== null && d !== 0
                  ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                  <p className="font-mono text-sm font-bold text-indigo-600">{it.std_code}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{it.name}</p>
                  {(it.manufacturer || it.manufacturer_code) && (
                    <p className="text-[11px] text-slate-400">
                      {it.manufacturer}{it.manufacturer && it.manufacturer_code ? ' · ' : ''}
                      <span className="font-mono">{it.manufacturer_code}</span>
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400">장부</p>
                      <p className="text-lg font-bold text-slate-700">{n(it.qty)}</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-400 mb-0.5">실사 수량</p>
                      <input type="number" inputMode="decimal"
                        value={counts[it.item_id] ?? ''}
                        onChange={e => setCounts(p => ({ ...p, [it.item_id]: e.target.value }))}
                        placeholder="세어본 수량"
                        className="w-full px-3 py-2.5 text-lg font-bold text-right border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />
                    </div>
                    {d !== null && (
                      <div className="text-center min-w-[52px]">
                        <p className="text-[10px] text-slate-400">차이</p>
                        <p className={`text-lg font-bold ${d === 0 ? 'text-emerald-600' : d > 0 ? 'text-sky-600' : 'text-rose-600'}`}>
                          {d === 0 ? '—' : d > 0 ? `+${n(d)}` : n(d)}
                        </p>
                      </div>
                    )}
                  </div>
                  {d !== null && d !== 0 && (
                    <input value={memos[it.item_id] || ''}
                      onChange={e => setMemos(p => ({ ...p, [it.item_id]: e.target.value }))}
                      placeholder="차이 사유 (선택)"
                      className="w-full mt-2 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-400">{it.unit}</span>
                    <button onClick={() => removeFromCell(it)}
                      title="이 칸에서 빼기 — 재고 수량은 남고 위치만 비워집니다"
                      className="ml-auto text-[10px] px-2 py-0.5 rounded border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-500">
                      이 칸에서 빼기
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 저장 — 화면 아래 고정 */}
          <div className="fixed bottom-0 left-0 right-0 p-3 bg-white border-t border-slate-200">
            <div className="max-w-lg mx-auto flex gap-2">
              <button onClick={() => setScanOpen(true)}
                title="다음 칸 스캔"
                className="px-4 py-3 text-sm font-semibold rounded-xl bg-slate-900 text-white">
                📷
              </button>
              <button data-cycle-save onClick={save} disabled={busy || !filled}
                className="flex-1 py-3 text-sm font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                {busy ? '저장 중…' : cyc?.setup ? `저장 · 재고에 바로 반영 (${filled}/${items.length})` : `실사 기록 (${filled}/${items.length})`}
              </button>
              {/* 기록한 것 중 차이가 있고 아직 반영 안 한 것이 있으면 — 바로 재고에 반영 */}
              {saved && pendingIds.length > 0 && canEdit && (
                <button onClick={applyNow} disabled={applying}
                  className="px-4 py-3 text-sm font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 whitespace-nowrap">
                  {applying ? '반영 중…' : `재고 반영 (${pendingIds.length})`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
