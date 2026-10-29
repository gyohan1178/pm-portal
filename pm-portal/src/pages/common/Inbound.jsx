import { useUndo } from '../../components/UndoBar'
import PageHead from '../../components/PageHead'
import { useFillHeight } from '../../hooks/useFillHeight'
import { useCompact } from '../../hooks/useCompact'
import { moveRows, pickNew, undoMoves } from '../../lib/undoMove'
import ItemLink from '../../components/ItemLink'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { useDebounced } from '../../hooks/useDebounced'
import { refreshProcurement } from '../../lib/refresh'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomers } from '../../hooks/useCustomers'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCanEdit, useMe } from '../../hooks/useProfile'
import EcountPurchaseModal from '../../components/EcountPurchaseModal'
import { supabase } from '../../lib/supabase'
import { useRowSelect } from '../../hooks/useRowSelect'
import { logActivity } from '../../lib/activityLog'
import AutoInput from '../../components/AutoInput'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'
import { todayISO, ymdKST } from '../../lib/utils'
import { useSearchParams } from 'react-router-dom'
import { pendingHay, histHay, histMemo } from '../../lib/inboundSearch'
import LotInboundModal from '../../components/LotInboundModal'
import { ilikeAny } from '../../lib/pgFilter'
import { fetchVendors } from '../../lib/vendorsQuery'
import { SkelBar, SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import Spin from '../../components/ux/Spin'

function todayStr() { return todayISO() }
function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return ymdKST(d)
}

async function fetchPendingPOs(customerId, vendorId) {
  const make = () => {
    let q = supabase.from('purchase_orders')
      .select('*, items!purchase_orders_item_id_fkey(std_code,name,unit,manufacturer,manufacturer_code,lot_managed), vendors(name), customers(name,code)')
      .eq('order_type','purchase').not('status','in','(완료,취소)')
    if (customerId) q = q.eq('customer_id', customerId)
    if (vendorId) q = q.eq('vendor_id', vendorId)
    return q.order('order_date', { ascending: true }).order('id', { ascending: true })
  }
  return await fetchAll(make)
}
async function fetchInboundHistory({ from, to, customerId, vendorId }) {
  // movement_date가 null인 경우 created_at 기준으로 대체 조회
  // po_id로 발주(purchase_orders)를 조인해 발주 당시 구매처(vendor)를 가져옴
  // (item의 기본 vendor가 아니라, 실제 발주한 구매처를 표시하기 위함)
  // 500건에서 잘리던 것을 5,000건까지 넓혔다.
  // 그 이상은 기간을 좁히는 것이 맞고, 화면 표시는 '더 보기'로 나눈다.
  //   고객사는 서버에서 거른다 — 예전엔 5,000건을 자른 뒤 화면에서 걸러 더 많이 빠졌다 (2026-10-08)
  //   5,000건에 닿으면 capped 로 알려 화면에 「기간을 좁혀 주세요」를 띄운다.
  const CAP = 5000
  const PAGE = 1000
  let data = [], capped = false
  for (let off = 0; off < CAP; off += PAGE) {
    let q = supabase.from('stock_movements')
      .select('*, items(std_code,name,unit,manufacturer,manufacturer_code), customers(name,code), purchase_orders(po_number, memo, mfr, mfr_code, item_rev, customer_id, vendor_id, fx_currency, vendors(name, ecount_code), projects(code))')
      .eq('movement_type','입고')
      .gte('movement_date', from)
      .lte('movement_date', to)
    if (customerId) q = q.eq('customer_id', customerId)
    const { data: batch, error } = await q
      .order('movement_date', { ascending: false }).order('id', { ascending: true })
      .range(off, off + PAGE - 1)
    if (error) throw error
    data = data.concat(batch || [])
    if (!batch || batch.length < PAGE) break
    if (off + PAGE >= CAP) capped = true
  }
  return { rows: data || [], capped }
}

// 입고현황 정렬 — 머리글 이름 → 정렬 값
const histMfr = r => r.purchase_orders?.mfr || r.items?.manufacturer || ''
const histMpn = r => r.purchase_orders?.mfr_code || r.items?.manufacturer_code || ''
const numOr = v => (v == null || v === '' ? null : Number(v))
export const HIST_SORT = {
  '입고일': r => r.movement_date || '', '기준코드': r => r.items?.std_code || '', '품명': r => r.items?.name || '',
  '제조사': histMfr, '제조사품번': histMpn, '수량': r => numOr(r.qty), '단위': r => r.items?.unit || '',
  '단가': r => numOr(r.unit_price), '금액': r => (r.unit_price ? (Number(r.qty) || 0) * Number(r.unit_price) : null),
  '발주번호': r => r.purchase_orders?.po_number || '', '상위품목': r => r.purchase_orders?.projects?.code || '',
  '구매처': r => r.purchase_orders?.vendors?.name || '', '고객사': r => r.customers?.name || '', '비고': r => histMemo(r),
}
// 입고현황 전체 검색 — 표에 보이는 칸 전부
export const histAllHay = r => [r.movement_date, histHay(r), histMfr(r), histMpn(r), r.items?.unit, r.qty, r.unit_price,
  r.purchase_orders?.projects?.code, r.purchase_orders?.vendors?.name, r.customers?.name, r.customers?.code, histMemo(r)]
  .filter(v => v != null && v !== '').join(' ').toLowerCase()

async function processInbound({ items, inboundData, note, inboundDate }) {
  // 입고 처리 전체를 Postgres 함수에서 트랜잭션으로 — 전부 성공 아니면 전부 취소(중복/부분반영 없음)
  const lines = items.map(item => {
    const qty = Number(inboundData[item.id]?.qty)
    if (!qty || qty <= 0) return null
    const up = inboundData[item.id]?.unit_price
    return { po_id: item.id, qty, unit_price: (up !== undefined && up !== '') ? Number(up) : null, item_id: item.item_id }
  }).filter(Boolean)
  if (!lines.length) return null
  // 되돌리기용 — 처리 전 이 발주들의 입고 줄을 떠 둔다 (v4.58.0)
  const poIds = lines.map(l => l.po_id)
  const before = await moveRows({ type: '입고', poIds }).catch(() => null)
  // RPC엔 기존 형식(po_id·qty·unit_price)만 전달
  const { error } = await supabase.rpc('pm_process_inbound', {
    p_lines: lines.map(({ item_id, ...l }) => l), p_note: note || null, p_date: inboundDate,
  })
  if (error) throw error
  let moveIds = []
  if (before) { try { moveIds = pickNew(before, await moveRows({ type: '입고', poIds }), lines.map(l => ({ po_id: l.po_id, qty: l.qty }))) } catch { /* 되돌리기만 못 한다 */ } }
  const res = { moveIds, n: lines.length }
  logActivity('create', 'stock_movements', null,
    `입고 처리 ${lines.length}건 · ${inboundDate}${note ? ` · ${note}` : ''}`)
  // 입고 시 확정/수정된 단가를 최근 매입단가로 items.purchase_price에 반영 (입고가 발주단가보다 우선)
  //   ⚠ 지난 날짜로 입고를 잡으면(뒤늦은 입력) 그보다 최근 입고가 이미 있을 수 있다.
  //     그때 옛 단가로 덮으면 최근 매입가가 거꾸로 돌아가므로, 더 최근 입고가 있는 품목은 건너뛴다.
  //   같은 품목이 여러 줄이면 마지막 줄 단가를 쓴다.
  const latest = {}
  for (const l of lines) {
    if (l.item_id && l.unit_price != null && l.unit_price > 0) latest[l.item_id] = l.unit_price
  }
  const ids = Object.keys(latest)
  if (!ids.length) return res
  const { data: newer, error: nErr } = await supabase.from('stock_movements')
    .select('item_id').eq('movement_type', '입고').in('item_id', ids)
    .gt('movement_date', inboundDate).not('unit_price', 'is', null).limit(1000)
  if (nErr) return res   // 입고는 이미 끝났다. 최근 매입가 갱신만 건너뛴다.
  const skip = new Set((newer || []).map(r => r.item_id))
  const upd = ids.filter(id => !skip.has(id))
  for (let i = 0; i < upd.length; i += 20) {
    await Promise.all(upd.slice(i, i + 20).map(id =>
      supabase.from('items').update({ purchase_price: latest[id] }).eq('id', id)))
  }
  return res
}

// 발주외(구두발주·단건) 입고 — PO 없이 품목 직접 입고
async function processDirectInbound({ item_id, qty, unit_price, customer_id, memo, date }) {
  const before = await moveRows({ type: '입고', itemIds: [item_id], poNull: true, since: date }).catch(() => null)
  const { error } = await supabase.rpc('pm_direct_inbound', {
    p_item_id: item_id,
    p_qty: Number(qty),
    p_unit_price: (unit_price !== undefined && unit_price !== '') ? Number(unit_price) : null,
    p_customer_id: customer_id || null,
    p_vendor_note: memo || null,
    p_date: date,
  })
  if (error) throw error
  let moveIds = []
  if (before) { try { moveIds = pickNew(before, await moveRows({ type: '입고', itemIds: [item_id], poNull: true, since: date }), [{ item_id, qty: Number(qty) }]) } catch { /* 되돌리기만 못 한다 */ } }
  return { moveIds }
}

const today = todayISO()

export default function Inbound() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('process') // process | direct | history
  // 발주외 입고 (단건)
  const [dItem, setDItem] = useState(null)      // 선택된 품목 {id,std_code,name,unit}
  const [dSearch, setDSearch] = useState('')
  const [dQty, setDQty] = useState('')
  const [dPrice, setDPrice] = useState('')
  const [dCustomer, setDCustomer] = useState('')
  const [dMemo, setDMemo] = useState('')
  const [dDate, setDDate] = useState(todayStr())
  // 입고 처리
  const [selCustomer, setSelCustomer] = useState('')
  const [selVendor, setSelVendor] = useState('')
  const [checked, setChecked] = useState({})
  const [rowSearch, setRowSearch] = useState('')
  // 발주 목록이 많으면 한 글자마다 다시 거르느라 입력이 멈춘다
  const dRowSearch = useDebounced(rowSearch, 250)
  const [vendorText, setVendorText] = useState('')
  const [inboundData, setInboundData] = useState({})
  const [note, setNote] = useState('')
  const [inboundDate, setInboundDate] = useState(todayStr())
  const [result, setResult] = useState(null)
  const [sort, setSort] = useState({ key:'order_date', dir:'asc' })  // 입고처리 표 헤더 정렬
  // 입고 현황
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(todayStr())
  const [hCustomer, setHCustomer] = useState('')
  const [hVendor, setHVendor] = useState('')
  const [cartOpen, setCartOpen] = useState(true)   // 담은 품목 패널
  const [lotAsk, setLotAsk] = useState(null)       // 입고 직후 로트 입력 { rows, date }
  const [hVendorText, setHVendorText] = useState('')
  const [hItem, setHItem] = useState('')
  // 입력이 멈춘 뒤 거른다 — 한 글자마다 전체를 훑으면 느려진다
  const dHVendor = useDebounced(hVendorText, 250)
  const dHItem = useDebounced(hItem, 250)
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: todayStr(), customerId:'', vendorId:'' })
  const [selHist, setSelHist] = useState(new Set())
  // 입고현황 전체 검색 · 헤더 정렬 (2026-10-08)
  const [hAll, setHAll] = useState('')
  const dHAll = useDebounced(hAll, 250)
  const [hSort, setHSort] = useState({ key: null, dir: 'asc' })

  const { data: customers=[] } = useCustomers()
  // 발주외 품목 자동완성 (공용 AutoInput 사용)
  const fetchDirectSuggest = async (q) => {
    const { data, error } = await supabase.from('items').select('id,std_code,name,unit,manufacturer,manufacturer_code,lot_managed')
      .or(ilikeAny(['std_code', 'name', 'manufacturer_code', 'manufacturer', 'spec'], q)).limit(20)
    if (error) throw error
    return data || []
  }
  const iCanEdit = useCanEdit()
  const { remember, bar: undoBar, undo, run: runUndo, busy: undoBusy, clear: clearUndo, dialog: undoDialog } = useUndo()
  const [ask, confirmEl] = useConfirm()   // 브라우저 기본 확인 창 대신 포털 확인 창 (v4.104.0)
  // 입고 처리 칸 높이 = 화면에 남은 높이 (노트북에서도 표가 넉넉하게, 페이지 스크롤 없이) (v4.62.0)
  const [procRef, procH] = useFillHeight(tab === 'process', 420)
  const compact = useCompact()
  const LBL = compact ? 'hidden' : 'block text-xs font-bold text-slate-500 mb-1'   // 노트북에선 칸 이름 줄을 빼고 한 줄로
  const [histRef, histH] = useFillHeight(tab === 'history', 360)
  const UNDO_NOTE = '방금 넣은 입고 줄을 지웁니다 — 재고 · 발주 입고수량 · 완료 상태가 입고 전으로 돌아갑니다.\n지운 줄은 복구 기록으로 남습니다. (최근 매입가 · 단가 이력은 그대로 · 로트를 등록했다면 로트 관리에서 따로 지워 주세요)'
  const afterUndo = () => { refreshProcurement(qc); qc.invalidateQueries({ queryKey: ['inboundHistory'], exact: false }); qc.invalidateQueries({ queryKey: ['pendingPOs'], exact: false }) }
  const guardEdit = () => { if (!iCanEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false } return true }
  const directMut = useMutation({
    mutationFn: () => { if (!guardEdit()) throw new Error('__READONLY__'); return processDirectInbound({ item_id:dItem.id, qty:dQty, unit_price:dPrice, customer_id:dCustomer, memo:dMemo, date:dDate }) },
    onSuccess: (r) => {
      if (r?.moveIds?.length) remember(`발주외 입고 ${dItem.std_code} ${dQty}${dItem.unit || ''}`, async () => { const x = await undoMoves(r.moveIds); return `입고 ${x.cnt}줄을 되돌렸습니다${x.snap_id ? ` (복구 기록 #${x.snap_id})` : ''}` }, { note: UNDO_NOTE, after: afterUndo })
      if (dItem?.lot_managed && Number(dQty) > 0) setLotAsk({ date: dDate, rows: [{
        key: 'direct', item_id: dItem.id, std_code: dItem.std_code, name: dItem.name,
        maker: dItem.manufacturer, maker_code: dItem.manufacturer_code, vendor: dMemo || '', qty: Number(dQty) }] })
      setResult(`발주외 입고 완료 — ${dItem.std_code} ${dQty}${dItem.unit||''}`)
      setDItem(null); setDSearch(''); setDQty(''); setDPrice(''); setDMemo('')
      refreshProcurement(qc)
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('오류: ' + e.message) },
  })
  const { data: vendors=[] } = useQuery({ queryKey:['vendors'], queryFn:fetchVendors })
  // 다시 불러오는 동안에도 이전 목록을 그대로 보여준다.
  //   담아둔 품목이 사라졌다가 돌아오면 입력하던 흐름이 끊긴다.
  const { data: pendingPOs=[], isLoading, refetch } = useQuery({
    queryKey:['pendingPOs',selCustomer],
    queryFn:()=>fetchPendingPOs(selCustomer||null, null),
    placeholderData: (prev) => prev,
  })

  // 입고 단가 경고 (v4.98.0) — 품목마다 직전 입고 단가(단가 이력)와 ±10% 넘게 다르면 줄에 표시
  const priceItemIds = useMemo(() => [...new Set(pendingPOs.map(p => p.item_id).filter(Boolean))].sort(), [pendingPOs])
  const { data: lastPrice = {} } = useQuery({
    queryKey: ['lastPrices', priceItemIds.length, priceItemIds[0] || '', priceItemIds[priceItemIds.length - 1] || ''],
    enabled: priceItemIds.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const out = {}
      for (let i = 0; i < priceItemIds.length; i += 150) {
        const { data } = await supabase.from('price_history').select('item_id,price,recorded_at')
          .in('item_id', priceItemIds.slice(i, i + 150)).order('recorded_at', { ascending: false }).limit(1000)
        for (const r of data || []) if (!(r.item_id in out) && Number(r.price) > 0) out[r.item_id] = Number(r.price)
      }
      return out
    },
  })
  const priceGap = (po) => {
    const last = lastPrice[po.item_id]
    const raw = inboundData[po.id]?.unit_price
    const now = Number(raw !== undefined && raw !== '' ? raw : po.unit_price)
    if (!last || !now) return null
    const r = (now - last) / last
    return Math.abs(r) > 0.1 ? { pct: Math.round(r * 100), last } : null
  }

  // 구매발주 화면의 「입고 처리」로 오면 ?po=id,id… — 그 발주를 체크하고 잔량을 채워 둔다
  const [sp, setSp] = useSearchParams()
  const [poFromUrl] = useState(() => (sp.get('po') || '').split(',').filter(Boolean))
  const [poApplied, setPoApplied] = useState(false)
  useEffect(() => {
    if (poApplied || !poFromUrl.length || isLoading) return
    setPoApplied(true)
    setSp({}, { replace: true })   // 새로고침해도 다시 걸리지 않게
    const found = pendingPOs.filter(p => poFromUrl.includes(p.id))
    if (!found.length) { toastError('고른 발주가 입고 대기 목록에 없습니다 — 이미 입고가 끝났을 수 있습니다'); return }
    setTab('process')
    setChecked(prev => ({ ...prev, ...Object.fromEntries(found.map(p => [p.id, true])) }))
    setInboundData(prev => {
      const d = { ...prev }
      found.forEach(p => { if (!d[p.id]) d[p.id] = { qty: p.qty_remaining || 0, unit_price: p.unit_price || '' } })
      return d
    })
    setCartOpen(true)
    const miss = poFromUrl.length - found.length
    toastSuccess(`발주 ${found.length}건을 담았습니다${miss ? ` (${miss}건은 이미 입고 완료)` : ''} — 수량·단가 확인 후 입고 처리`)
  }, [poFromUrl, poApplied, isLoading, pendingPOs])   // eslint-disable-line react-hooks/exhaustive-deps
  const { data: histData, isLoading: histLoading, error: histErr } = useQuery({
    queryKey:['inboundHistory', hQuery],
    queryFn:()=>fetchInboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId, vendorId:hQuery.vendorId }),
    enabled: tab==='history',
    placeholderData: (prev) => prev,
  })
  const history = histData?.rows || []
  const histCapped = !!histData?.capped

  const [doneIds, setDoneIds] = useState(() => new Set())   // 방금 입고 처리한 줄 — 번쩍 표시 (v4.97.0)
  const inboundMut = useMutation({
    mutationFn: () => { if (!guardEdit()) throw new Error('__READONLY__'); return processInbound({ items: checkedRows, inboundData, note, inboundDate }) },
    onSuccess: (r) => {
      if (r?.moveIds?.length) remember(`입고 처리 ${r.moveIds.length}줄 (${inboundDate})`, async () => { const x = await undoMoves(r.moveIds); return `입고 ${x.cnt}줄을 되돌렸습니다${x.snap_id ? ` (복구 기록 #${x.snap_id})` : ''}` }, { note: UNDO_NOTE, after: () => { afterUndo(); refetch() } })
      // 입고 → 로트: 로트 관리 대상이 섞여 있으면 바로 시리얼을 받는다
      const lotRows = checkedRows
        .filter(r => r.items?.lot_managed && Number(inboundData[r.id]?.qty) > 0)
        .map(r => ({ key: r.id, po_id: r.id, item_id: r.item_id, std_code: r.items?.std_code, name: r.items?.name,
                     maker: r.items?.manufacturer, maker_code: r.items?.manufacturer_code,
                     vendor: r.vendors?.name || '', qty: Number(inboundData[r.id].qty) }))
      if (lotRows.length) setLotAsk({ rows: lotRows, date: inboundDate })
      setResult(`입고 처리 완료 (${inboundDate}) — ${checkedRows.length}건`)
      // 처리한 줄을 초록으로 번쩍 → 0.9초 뒤 목록을 새로 받아 빠지게 (v4.97.0)
      //   체크는 바로 풀어 같은 줄을 두 번 처리하지 못하게 한다. 검색어도 함께 지운다.
      setDoneIds(new Set(checkedRows.map(r => r.id)))
      setChecked({}); setNote('')
      setTimeout(() => {
        setDoneIds(new Set()); setInboundData({}); setRowSearch('')
        refreshProcurement(qc)
        // 입고 현황 캐시 명시적 갱신 (hQuery 포함 키까지 확실히 무효화)
        qc.invalidateQueries({ queryKey:['inboundHistory'], exact:false })
        refetch()
      }, 900)
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('오류: ' + e.message) },
  })

  // 입고일만 바꾼다. 8월에 잡은 것을 9월로 이월하는 경우가 있다.
  //   지웠다 다시 넣으면 재고가 두 번 움직여 위험하므로 날짜만 고친다.
  const [dateForm, setDateForm] = useState(null)   // { date, memo }
  const [ecpOpen, setEcpOpen] = useState(false)   // 이카운트 구매입력 변환 창
  const me = useMe()

  const dateMut = useMutation({
    mutationFn: async ({ ids, date, memo }) => {
      if (!guardEdit()) throw new Error('__READONLY__')
      const { data, error } = await supabase.rpc('pm_movement_date_change',
        { p_ids: ids, p_date: date, p_memo: memo || null })
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
    onSuccess: (r) => {
      if (Number(r?.skipped) > 0) toastError(`${r.updated}건 변경 · ${r.note || ''}`)
      else toastSuccess(`${r?.updated ?? 0}건 입고일 변경`)
      setDateForm(null); setSelHist(new Set())
      qc.invalidateQueries({ queryKey:['inboundHistory'], exact:false })
      refetch()
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('입고일 변경 오류: ' + e.message) },
  })

  const delHistMut = useMutation({
    mutationFn: async (ids) => {
      if (!guardEdit()) throw new Error('__READONLY__')
      // 지우기 전에 기록을 남긴다. 재고까지 함께 바뀌어 되돌리기 어렵기 때문이다.
      const { data, error } = await supabase.rpc('pm_movement_delete_safe', { p_ids: ids })
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
    onSuccess: (r) => {
      if (r?.snap_id) toastSuccess(`${r.cnt}건 삭제 — 되돌리려면 복구 기록 #${r.snap_id}`)
      setSelHist(new Set())
      qc.invalidateQueries(['inboundHistory']); qc.invalidateQueries(['inventory'])
      qc.invalidateQueries(['purchase']); qc.invalidateQueries(['shortage'])
      qc.invalidateQueries(['pendingPOs']); refetch()
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('삭제 오류: ' + e.message) },
  })
  const PROC_COLS = [
    { key:'order_date', label:'발주일자', get:po=>po.order_date||'', num:false },
    { key:'promise_date', label:'입고요청일', get:po=>po.vendor_date||po.promise_date||'', num:false },   // 정렬은 받을 날(변경 납기 > 요청일) 순 (v4.108.0)
    { key:'std_code', label:'기준코드·품명', get:po=>po.items?.std_code||'', num:false },
    { key:'mfg', label:'제조사·품번', get:po=>po.items?.manufacturer||'', num:false },
    { key:'vendor', label:'구매처', get:po=>po.vendors?.name||'', num:false },
    { key:'customer', label:'고객사', get:po=>po.customers?.code||po.customers?.name||'', num:false },
    { key:'qty_ordered', label:'발주', get:po=>po.qty_ordered||0, num:true },
    { key:'qty_received', label:'입고', get:po=>po.qty_received||0, num:true },
    { key:'qty_remaining', label:'잔량', get:po=>po.qty_remaining||0, num:true },
    { key:'unit_price', label:'발주단가', get:po=>po.unit_price||0, num:true },
    { key:'qty_input', label:'입고수량', sortable:false },
  ]
  function toggleSort(key) {
    setSort(s => s.key===key ? { key, dir: s.dir==='asc'?'desc':'asc' } : { key, dir:'asc' })
  }

  // 미입고 발주를 "품목 행"으로 나열 (검색 + 헤더 정렬) + 제조사/품번/코드/품명 검색
  const rows = useMemo(() => {
    const q = dRowSearch.trim().toLowerCase()
    const vq = vendorText.trim().toLowerCase()
    // 비고(발주 메모) · 발주번호로도 찾는다 — 세트로 묶어 낸 발주를 비고에 적은 이름으로 불러 본다
    let list = !q ? pendingPOs : pendingPOs.filter(po => pendingHay(po).includes(q))
    if (vq) list = list.filter(po => (po.vendors?.name||'').toLowerCase().includes(vq))
    const col = PROC_COLS.find(c => c.key === sort.key)
    if (col && col.get) {
      list = [...list].sort((a, b) => {
        const va = col.get(a), vb = col.get(b)
        const c = col.num ? (Number(va)||0) - (Number(vb)||0) : String(va).localeCompare(String(vb), 'ko')
        return sort.dir === 'asc' ? c : -c
      })
    }
    return list
  }, [pendingPOs, dRowSearch, vendorText, sort])

  // 발주가 수천 건이면 검색·체크 조작이 밀린다
  const vis = useVisibleRows(rows, 150, [dRowSearch, vendorText, sort])
  // 행을 끌어 여러 건을 한 번에 고를 수 있게 한다.
  // 선택될 때 입고 수량 기본값(잔량)을 함께 채운다.
  const { rowProps } = useRowSelect(useCallback((updater) => {
    setChecked(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      const added = Object.keys(next).filter(id => next[id] && !prev[id])
      if (added.length) {
        setInboundData(d => {
          const nd = { ...d }
          added.forEach(id => {
            if (!nd[id]) {
              const po = rows.find(r => r.id === id)
              if (po) nd[id] = { qty: po.qty_remaining || 0, unit_price: po.unit_price || '' }
            }
          })
          return nd
        })
      }
      return next
    })
  }, [rows]))

  function toggleRow(po) {
    setChecked(prev => ({ ...prev, [po.id]: !prev[po.id] }))
    setInboundData(prev => prev[po.id] ? prev : ({ ...prev, [po.id]: { qty: po.qty_remaining||0, unit_price: po.unit_price||'' } }))
  }
  // 지금 보이는 것만 토글한다. 검색 밖에서 담아둔 건은 건드리지 않는다.
  function toggleAll() {
    const allOn = rows.length > 0 && rows.every(r => checked[r.id])
    setChecked(prev => {
      const next = { ...prev }
      rows.forEach(r => { if (allOn) delete next[r.id]; else next[r.id] = true })
      return next
    })
    if (!allOn) {
      setInboundData(prev => {
        const d = { ...prev }
        rows.forEach(r => {
          if (!d[r.id]) d[r.id] = { qty: r.qty_remaining || 0, unit_price: r.unit_price || '' }
        })
        return d
      })
    }
  }
  function updateData(id, field, val) {
    setInboundData(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  // 검색 결과(rows)가 아니라 전체(pendingPOs)에서 고른다.
  // 검색어를 바꿔도 앞서 체크한 건이 사라지지 않아야
  // 여러 품목을 찾아가며 담을 수 있다.
  const checkedRows = pendingPOs.filter(r => checked[r.id])
  const hasInput = checkedRows.some(r => inboundData[r.id]?.qty && Number(inboundData[r.id].qty) > 0)

  // 선택한 건의 공급가 합계 — 명세표와 대조할 때 쓴다.
  // 단가를 안 넣었으면 발주 단가를 쓴다.
  const checkedAmt = checkedRows.reduce((sum, r) => {
    const d = inboundData[r.id] || {}
    const qty = Number(d.qty) || 0
    // 빈 문자열은 ?? 로 안 걸러진다. 값이 실제로 있을 때만 쓴다.
    const price = Number(
      d.unit_price !== '' && d.unit_price != null ? d.unit_price : r.unit_price
    ) || 0
    return sum + qty * price
  }, 0)
  // 검색은 디바운스된 값으로 거른다.
  // 한 글자마다 전체를 훑으면 건수가 많을 때 입력이 밀린다.
  const histShown = useMemo(() => {
    const vq = dHVendor.trim().toLowerCase()
    const iq = dHItem.trim().toLowerCase()
    const words = dHAll.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let list = (!vq && !iq && !words.length) ? (history || []) : (history || []).filter(r => {
      const vname = (r.purchase_orders?.vendors?.name || r.items?.vendors?.name || '').toLowerCase()
      if (vq && !vname.includes(vq)) return false
      if (iq) {
        // 기준코드·품명뿐 아니라 제조사·제조사품번 · 비고(입고 · 발주) · 발주번호로도 찾는다
        if (!histHay(r).includes(iq)) return false
      }
      if (words.length) {
        // 전체 검색 — 표에 보이는 칸 전부 (낱말 여러 개면 모두 들어간 줄)
        const hay = histAllHay(r)
        if (!words.every(w => hay.includes(w))) return false
      }
      return true
    })
    if (hSort.key) {
      const get = HIST_SORT[hSort.key]
      const dir = hSort.dir === 'asc' ? 1 : -1
      list = [...list].sort((a, b) => {
        const x = get(a), y = get(b)
        const xe = x == null || x === '', ye = y == null || y === ''
        if (xe && ye) return 0
        if (xe) return 1
        if (ye) return -1
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
        return String(x).localeCompare(String(y), 'ko') * dir
      })
    }
    return list
  }, [history, dHVendor, dHItem, dHAll, hSort])
  // 거르는 조건이 바뀌면 선택을 푼다 — 안 보이는 줄이 삭제 · 입고일 변경에 섞이지 않게 (2026-10-08)
  useEffect(() => { setSelHist(new Set()) }, [hQuery, dHVendor, dHItem, dHAll])
  // 실행은 지금 보이는 줄 중 고른 것만
  const selShown = useMemo(() => histShown.filter(r => selHist.has(r.id)).map(r => r.id), [histShown, selHist])
  const sortBy = (key) => setHSort(s => s.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' }) : { key, dir: 'asc' })
  // 제조사·제조사품번 — 발주 줄에 적힌 값이 먼저다(실제 산 것). 비어 있으면 기준코드 DB 값
  const mfrOf = r => r.purchase_orders?.mfr || r.items?.manufacturer || ''
  const mpnOf = r => r.purchase_orders?.mfr_code || r.items?.manufacturer_code || ''
  const histTotal = histShown.reduce((a,r)=>a+r.qty,0)
  // 화면에는 200건씩 그린다. 수천 건을 한 번에 그리면 검색이 밀린다.
  const hVis = useVisibleRows(histShown, 200, [dHVendor, dHItem, dHAll, hQuery, hSort])

  function exportHistory() {
    const data = histShown.map(r=>({
      '입고일':r.movement_date, '기준코드':r.items?.std_code, '품명':r.items?.name,
      '제조사':mfrOf(r), '제조사품번':mpnOf(r),
      '단위':r.items?.unit, '수량':r.qty,
      '단가':Number(r.unit_price)||0,
      '금액':(Number(r.qty)||0) * (Number(r.unit_price)||0),
      '발주번호':r.purchase_orders?.po_number||'',
      '구매처':r.purchase_orders?.vendors?.name||'', '고객사':r.customers?.name||'',
      '비고':histMemo(r),
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'입고현황')
    XLSX.writeFile(wb,`입고현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {confirmEl}
      {/* 되돌리기 확인 창 — 「발주외 입고」 탭은 undoBar 안에 같이 그려지므로 그 밖의 탭에서만 */}
      {tab !== 'direct' && undoDialog}
      {lotAsk && <LotInboundModal rows={lotAsk.rows} date={lotAsk.date} onClose={() => setLotAsk(null)}
        onDone={() => { qc.invalidateQueries({ queryKey: ['lotSummary'] }); qc.invalidateQueries({ queryKey: ['lotList'], exact: false }) }} />}
      <PageHead crumb="자재 · 일일 업무" title="입고"
        desc="들어온 물건을 발주에 맞춰 입고합니다. 발주를 체크하고 수량을 확인한 뒤 맨 아래 「입고 처리」를 누르면 재고와 입고 현황에 바로 반영됩니다.">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {[['process','📥 입고 처리'],['direct','✍️ 발주외 입고'],['history','📋 입고 현황']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
      </PageHead>

      {tab==='process' && (
        // 노트북 화면에서도 표가 넉넉히 보이게 (v4.62.0) — 위 칸은 한 줄로 줄이고, 표가 남은 높이를 다 쓰고, 담은 품목 · 입고 처리는 맨 아래
        <div ref={procRef} data-inb-process className="flex flex-col gap-2" style={{ height: procH ? procH + 'px' : undefined }}>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <CsTabs className="" sel={selCustomer} customers={customers} onSel={async (v) => {
              // 고객사를 바꾸면 담은 발주가 목록에서 빠져 입고 대상에서도 말없이 사라졌다 → 묻고 비운다 (2026-10-08)
              const n = Object.values(checked).filter(Boolean).length
              if (v !== selCustomer && n > 0) {
                if (!(await ask({ title: `고객사를 바꿀까요? 담은 발주 ${n}건이 비워집니다`, desc: '다른 고객사 목록에서는 지금 담은 발주가 보이지 않아 담은 목록을 비웁니다. 입고는 아직 처리되지 않았고, 다시 돌아와 담으면 됩니다.',
                  items: checkedRows.slice(0, 5).map(r => `${r.items?.std_code || '-'} · ${r.items?.name || ''} · 입고 ${inboundData[r.id]?.qty ?? '-'}`), more: Math.max(0, checkedRows.length - 5),
                  okText: '바꾸고 비우기', cancelText: '그대로 두기' }))) return
                setChecked({})
              }
              setSelCustomer(v)
            }} />
            <input value={vendorText} onChange={e=>setVendorText(e.target.value)} placeholder="구매처명 검색"
              className="w-36 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            <input value={rowSearch} onChange={e=>setRowSearch(e.target.value)}
              placeholder="품번·품명·제조사·비고·발주번호 검색"
              title="기준코드 · 품명 · 제조사 · 제조사품번 · 발주할 때 적은 비고(세트 이름 등) · 발주번호로 찾습니다"
              className="w-60 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            <span className="text-xs text-slate-400">입고일</span>
            <input type="date" value={inboundDate} onChange={e=>setInboundDate(e.target.value)}
              className={`px-2 py-1 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                inboundDate !== todayStr() ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white'}`}/>
            {inboundDate !== todayStr() && (
              <button onClick={()=>setInboundDate(todayStr())}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">오늘로</button>
            )}
            <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
              미입고 <b key={rows.length} className="pm-pop font-mono text-slate-600">{rows.length}</b>건 · 정렬 {(PROC_COLS.find(c=>c.key===sort.key)?.label)||''} {sort.dir==='asc'?'▲':'▼'}
            </span>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {isLoading && !pendingPOs.length ? (
              <div data-inb-loading className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-100 border-b border-slate-200 px-3 py-2.5 flex gap-6" data-skeleton>{[40, 56, 90, 80, 60, 44].map((w, i) => <SkelBar key={i} w={w} h={9} />)}</div>
                <table className="w-full text-xs"><tbody><SkeletonRows cols={PROC_COLS.length + 1} rows={8} first={1} two={[3, 4]} /></tbody></table>
              </div>)
            : rows.length === 0
              ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400 text-xs">
                  미입고 발주가 없습니다
                </div>
              : (
                <div className="flex-1 min-h-0 rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                  <div data-inb-table className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                          <th className="px-2 py-2 text-center">
                            <input type="checkbox" checked={rows.length>0 && rows.every(r=>checked[r.id])} onChange={toggleAll} />
                          </th>
                          {PROC_COLS.map(c=>(
                            <th key={c.key} onClick={c.sortable===false?undefined:()=>toggleSort(c.key)}
                              className={`px-3 py-2 text-left font-bold whitespace-nowrap ${c.sortable===false?'':'cursor-pointer select-none hover:text-indigo-600'}`}>
                              {c.label}
                              {sort.key===c.key && <span className="ml-0.5 text-indigo-500">{sort.dir==='asc'?'▲':'▼'}</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vis.shown.map(po=>{
                          const on = !!checked[po.id]
                          const delayed = (po.vendor_date || po.promise_date) && (po.vendor_date || po.promise_date) < today   // 받을 날 기준 (v4.108.0)
                          const justDone = doneIds.has(po.id)
                          return (
                            <tr key={po.id} {...rowProps(po.id, on)} data-inb-done={justDone ? '1' : undefined}
                              className={`border-b border-slate-100 cursor-pointer select-none ${justDone ? 'pm-row-done' : on?'bg-indigo-50':'hover:bg-slate-50'}`}>
                              <td className="px-2 py-2 text-center" onClick={e=>e.stopPropagation()}>
                                {justDone
                                  ? <span className="pm-stamp w-4 h-4 rounded-full bg-emerald-500 items-center justify-center" aria-label="입고됨"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg></span>
                                  : <input type="checkbox" checked={on} onChange={()=>toggleRow(po)} />}
                              </td>
                              <td className="px-3 py-2 text-slate-500">{po.order_date||'-'}</td>
                              <td className="px-3 py-2 text-slate-500">{po.promise_date||'-'}{delayed && <span className="ml-1 text-red-500 font-bold">지연</span>}
                                {/* 협력사 변경 납기 (v4.98.0) — 지연은 받을 날(변경 납기) 기준 (v4.108.0) */}
                                {po.vendor_date && <span data-inb-vendor-date className={`block text-[10.5px] font-bold ${po.vendor_date < today ? 'text-red-600' : 'text-amber-700'}`}>→ 변경 {po.vendor_date.slice(5)}{po.vendor_date < today ? ' (지남)' : ''}</span>}</td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5 max-w-[260px]">
                                  <span className="font-mono text-indigo-600 shrink-0">{po.items?.std_code}</span>
                                  {/* 발주할 때 적어 둔 메모. 입고 때도 봐야 한다 — 줄이 높아지지 않게 품번 옆에 (v4.62.0) */}
                                  {po.memo && <span className="text-[10.5px] text-amber-700 bg-amber-50 rounded px-1 truncate" title={po.memo}>{po.memo}</span>}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={po.items?.name||''}>{po.items?.name||''}</div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="text-slate-700 truncate max-w-[130px]">{po.items?.manufacturer||'-'}</div>
                                <div className="font-mono text-[11px] text-slate-400 truncate max-w-[130px]">{po.items?.manufacturer_code||''}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-500">{po.vendors?.name||'-'}</td>
                              <td className="px-3 py-2 text-indigo-500 font-semibold">{po.customers?.code||po.customers?.name||'-'}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{po.qty_ordered}</td>
                              <td className="px-3 py-2 text-right text-emerald-600">{po.qty_received}</td>
                              <td className="px-3 py-2 text-right font-bold text-slate-900">{po.qty_remaining}</td>
                              <td className="px-3 py-2" onClick={e=>e.stopPropagation()}>
                                <input type="number" min={0} value={inboundData[po.id]?.unit_price??''}
                                  onChange={e=>updateData(po.id,'unit_price',e.target.value)}
                                  placeholder={po.unit_price||'단가'} disabled={!on}
                                  className="w-24 px-2 py-1 text-xs border border-slate-200 rounded text-right disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                                {(() => { const g = priceGap(po); return g && <span data-inb-price-gap={g.pct} title={`직전 입고 단가 ${g.last.toLocaleString()}원과 ${g.pct > 0 ? '+' : ''}${g.pct}% 차이 — 단가 확인`}
                                  className={`block mt-0.5 text-[10.5px] font-bold ${g.pct > 0 ? 'text-red-600' : 'text-blue-600'}`}>{g.pct > 0 ? '▲' : '▼'} {Math.abs(g.pct)}% · 직전 {g.last.toLocaleString()}</span> })()}
                              </td>
                              <td className="px-3 py-2" onClick={e=>e.stopPropagation()}>
                                <input type="number" min={0} value={inboundData[po.id]?.qty??''}
                                  onChange={e=>updateData(po.id,'qty',e.target.value)} disabled={!on}
                                  title={Number(inboundData[po.id]?.qty||0) > (po.qty_remaining||0) ? '잔량 초과 입고 (MOQ 등)' : ''}
                                  className={`w-20 px-2 py-1 text-xs border rounded text-right disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${Number(inboundData[po.id]?.qty||0) > (po.qty_remaining||0) ? 'border-amber-400 text-amber-700 font-bold' : 'border-slate-200'}`}/>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <MoreRows {...vis} />
                  </div>

                </div>
              )
            }
          </div>

          {/* 담은 품목 + 입고 처리 — 화면 아래에 붙여 둔다 (v4.61.0)
              예전엔 표 위에 있어서, 담는 순간 칸이 바뀌며 표가 밀려 누르던 자리 아래 다른 줄이 눌렸다.
              아래에 붙어 있으면 담아도 표 위쪽은 그대로다. */}
          {(pendingPOs.length > 0 || checkedRows.length > 0 || result || undo) && (
            <div data-inb-dock className={`shrink-0 rounded-xl border-2 bg-white overflow-hidden shadow-[0_-8px_20px_-10px_rgba(15,23,42,0.25)] ${
              checkedRows.length > 0 ? 'border-indigo-300' : 'border-slate-200'}`}>
              {/* 방금 한 일 — 위에 띄우면 표가 밀려서, 누른 단추 바로 위 한 줄로 */}
              {(result || undo) && (
                <div data-inb-notice className="px-3.5 py-1.5 flex items-center gap-2 text-xs border-b border-slate-100 bg-emerald-50/70">
                  {result && <span className="font-semibold text-emerald-700 truncate">✅ {result}</span>}
                  {undo && (<>
                    <span data-undo className="text-amber-700 truncate">{result ? '·' : ''} 방금 한 작업: <b>{undo.label}</b></span>
                    <button data-undo-run disabled={undoBusy} onClick={runUndo}
                      className="px-2.5 py-0.5 text-[11px] font-bold rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 shrink-0">{undoBusy ? '되돌리는 중…' : '↩ 되돌리기'}</button>
                  </>)}
                  <button onClick={() => { setResult(null); clearUndo() }} title="닫기" className="ml-auto text-slate-400 hover:text-slate-600 shrink-0">✕</button>
                </div>
              )}
              <div className={`px-3.5 py-1.5 flex items-center gap-2 flex-wrap ${checkedRows.length > 0 ? 'bg-indigo-50/70 border-b border-indigo-100' : 'bg-slate-50'}`}>
                <span className={`text-xs font-bold ${checkedRows.length > 0 ? 'text-indigo-700' : 'text-slate-400'}`}>
                  {checkedRows.length > 0 ? `담은 품목 ${checkedRows.length}건` : '담은 품목 없음 — 위 표에서 체크하세요'}
                </span>
                {checkedAmt > 0 && <span className="text-xs font-bold text-slate-700">{checkedAmt.toLocaleString('ko-KR')}원</span>}
                {checkedRows.length > 0 && (<>
                  <button data-inb-cart-toggle onClick={() => setCartOpen(v => !v)} className="text-[11px] text-indigo-600 font-semibold hover:underline">
                    {cartOpen ? '목록 접기 ▼' : '목록 펼치기 ▲'}
                  </button>
                  <button onClick={() => { setChecked({}); setInboundData({}) }} className="ml-auto text-[11px] text-slate-400 hover:text-rose-500">전체 해제</button>
                </>)}
              </div>
              {cartOpen && checkedRows.length > 0 && (
                <div data-inb-cart className="max-h-[min(132px,16vh)] overflow-y-auto divide-y divide-indigo-100 border-b border-indigo-100">
                  {checkedRows.map(r => {
                    const d = inboundData[r.id] || {}
                    const qty = Number(d.qty) || 0
                    const price = Number(
                      d.unit_price !== '' && d.unit_price != null ? d.unit_price : r.unit_price
                    ) || 0
                    return (
                      <div key={r.id} className="px-3.5 py-1 flex items-center gap-2 text-xs bg-white/60">
                        <span className="font-mono text-indigo-600 w-28 flex-shrink-0 truncate">
                          {r.items?.std_code || '-'}
                        </span>
                        <span className="text-slate-600 flex-1 min-w-0 truncate">
                          {r.items?.name}
                          {r.memo && (
                            <span className="ml-1 px-1 rounded bg-amber-50 text-amber-700 text-[10px]" title={r.memo}>{r.memo}</span>
                          )}
                        </span>
                        <span className="text-slate-400 w-20 flex-shrink-0 truncate text-right">
                          {r.vendors?.name || ''}
                        </span>
                        {/* 검색을 바꾸면 그 건이 표에서 사라져 수량을 고칠 수 없다.
                            부분 입고가 흔하므로 여기서 바로 고치게 한다. */}
                        <span className="flex items-center gap-0.5 flex-shrink-0">
                          <input type="number" min="0" value={d.qty ?? ''}
                            onChange={e => updateData(r.id, 'qty', e.target.value)}
                            className="w-14 px-1 py-0.5 text-right font-bold border border-slate-200 rounded" />
                          <span className="text-slate-400 w-8">/{r.qty_remaining}</span>
                        </span>
                        <span className="w-20 flex-shrink-0 text-right text-slate-600">
                          {(qty * price).toLocaleString('ko-KR')}
                        </span>
                        <button onClick={() => {
                            setChecked(prev => { const n = { ...prev }; delete n[r.id]; return n })
                          }}
                          className="text-slate-300 hover:text-rose-500 px-1 flex-shrink-0">✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="px-3 py-1.5 flex items-center gap-3 flex-wrap">
                    <input value={note} onChange={e=>setNote(e.target.value)} placeholder="입고 비고 (선택)"
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    <p className="text-xs text-slate-400 whitespace-nowrap">
                      입고일 <span className="font-semibold text-indigo-600">{inboundDate}</span>
                    </p>
                    <button onClick={async ()=>{
                      // 잔량보다 많이 받으면 한 번 확인한다 — MOQ 로 일부러 더 받는 건 그대로 진행,
                      //   부분입고 뒤 주문 수량을 통째로 다시 넣는 실수(예: 150 받은 뒤 1600 입력)를 막는다
                      const over = checkedRows.filter(r => Number(inboundData[r.id]?.qty || 0) > Number(r.qty_remaining || 0))
                      if (over.length && !(await ask({ title: `잔량보다 많이 입고합니다 (${over.length}건) — 맞나요?`,
                        desc: 'MOQ 등으로 더 받은 게 맞으면 「그대로 입고」를 누르세요. 부분입고 뒤 발주 수량을 통째로 다시 넣은 거라면 「수량 다시 보기」를 눌러 고쳐 주세요.',
                        items: over.slice(0, 5).map(r => `${r.items?.std_code || '-'} · 잔량 ${Number(r.qty_remaining || 0)} → 입고 ${Number(inboundData[r.id]?.qty || 0)}`),
                        more: Math.max(0, over.length - 5), okText: '그대로 입고', cancelText: '수량 다시 보기' }))) return
                      inboundMut.mutate()
                    }} disabled={inboundMut.isPending||!hasInput}
                      className="px-6 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                      {inboundMut.isPending?<span className="inline-flex items-center gap-1.5"><Spin />처리 중...</span>:`✅ 선택 ${checkedRows.length}건 입고 처리`}
                    </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='direct' && (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 max-w-2xl">
            <div>
              <p className="text-sm font-bold text-slate-700">✍️ 발주외 입고 (구두발주·단건)</p>
              <p className="text-[11px] text-slate-400 mt-0.5">PO 없이 품목을 직접 입고합니다. 재고가 바로 증가하고, 입고 현황에 "발주외"로 기록됩니다.</p>
            </div>

            {/* 품목 검색 (자동완성) */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">품목 <span className="text-rose-400">*</span></label>
              {dItem ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-indigo-200 rounded-lg">
                  <span className="font-mono text-xs text-indigo-600">{dItem.std_code}</span>
                  <span className="text-xs text-slate-600 truncate flex-1">{dItem.name}</span>
                  <button onClick={()=>{ setDItem(null); setDSearch('') }} className="text-xs text-slate-400 hover:text-rose-500">✕ 변경</button>
                </div>
              ) : (
                <AutoInput value={dSearch} setValue={setDSearch} buttonLabel={null}
                  fetchSuggest={fetchDirectSuggest} keyName="directItemSuggest"
                  onPick={it => setDItem(it)}
                  placeholder="기준코드·품명·제조사품번 검색 (2글자↑)"
                  renderSuggest={it => (<>
                    <div className="font-mono text-xs text-indigo-600">{it.std_code}</div>
                    <div className="text-[11px] text-slate-500 truncate">{it.name}{it.manufacturer_code ? ` · ${it.manufacturer_code}` : ''}</div>
                  </>)} />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">입고 수량 <span className="text-rose-400">*</span></label>
                <input type="number" min={0} value={dQty} onChange={e=>setDQty(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">단가 <span className="text-slate-300 font-normal">(선택)</span></label>
                <input type="number" min={0} value={dPrice} onChange={e=>setDPrice(e.target.value)}
                  placeholder="입력 시 매입단가 갱신" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">입고일</label>
                <input type="date" value={dDate} onChange={e=>setDDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 <span className="text-slate-300 font-normal">(선택)</span></label>
                <select value={dCustomer} onChange={e=>setDCustomer(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  <option value="">-</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">메모 <span className="text-slate-300 font-normal">(구매처·사유 등)</span></label>
              <input value={dMemo} onChange={e=>setDMemo(e.target.value)}
                placeholder="예: OO상사 구두발주 / 긴급건" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
            </div>

            <button onClick={()=>directMut.mutate()}
              disabled={!dItem || !dQty || Number(dQty)<=0 || directMut.isPending}
              className="w-full px-4 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {directMut.isPending?<span className="inline-flex items-center gap-1.5"><Spin />처리 중...</span>:'📥 발주외 입고 처리'}
            </button>
          </div>

          {undoBar}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center max-w-2xl">
              ✅ {result}
              <button onClick={()=>setResult(null)} className="ml-auto text-emerald-400">✕</button>
            </div>
          )}
        </>
      )}

      {tab==='history' && (
        <div className="space-y-4">
          <CsTabs sel={hCustomer} onSel={setHCustomer} customers={customers} />
          <div className={`flex ${compact ? 'items-center gap-2 p-2' : 'items-end gap-3 p-4'} rounded-xl border border-slate-200 bg-slate-50 flex-wrap`}>
            <div>
              <label className={LBL}>시작일</label>
              <input type="date" value={hFrom} onChange={e=>setHFrom(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
            </div>
            {compact && <span className="text-slate-400">~</span>}
            <div>
              <label className={LBL}>종료일</label>
              <input type="date" value={hTo} onChange={e=>setHTo(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
            </div>
            <div>
              <label className={LBL}>구매처 검색</label>
              <input value={hVendorText} onChange={e=>setHVendorText(e.target.value)} placeholder="구매처명 입력"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className={LBL}>품번 검색</label>
              <input value={hItem} onChange={e=>setHItem(e.target.value)} placeholder="기준코드·품명·제조사·제조사품번·비고·발주번호" title="입고 비고 · 발주 비고(세트 이름 등) · 발주번호로도 찾습니다"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div className="min-w-[220px] flex-1">
              <label className={LBL}>전체 검색</label>
              <input data-hist-all value={hAll} onChange={e=>setHAll(e.target.value)} placeholder="표의 모든 칸 — 낱말 여러 개 가능 (예: 동신 2026-10)"
                title="입고일 · 기준코드 · 품명 · 제조사 · 제조사품번 · 단위 · 수량 · 단가 · 발주번호 · 구매처 · 고객사 · 비고"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer,vendorId:null})}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
            {histShown.length>0&&(
              <button onClick={exportHistory}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
            )}
            {selShown.length>0&&(<>
              <button data-hist-ecount onClick={()=>setEcpOpen(true)}
                title="체크한 입고 줄을 이카운트 「구매입력」 엑셀 업로드 양식으로 — 같은 입고일 · 구매처 = 전표 1장"
                className="px-3 py-2 text-xs font-bold rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100">
                📤 이카운트 구매입력 {selShown.length}건</button>
              <button data-hist-date onClick={()=>setDateForm({ date:'', memo:'' })}
                title="수량·단가·재고는 그대로 두고 날짜만 바꿉니다"
                className="px-3 py-2 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50">
                📅 입고일 변경 {selShown.length}건</button>
              <button data-hist-del onClick={async ()=>{
                  const ids = [...selShown]
                  const pick = histShown.filter(r => selHist.has(r.id))
                  if(await ask({ title: `선택한 입고 이력 ${ids.length}건을 삭제할까요?`,
                    desc: '재고와 발주 입고수량(qty_received)도 그만큼 되돌립니다. 지우기 전 내용은 복구 기록으로 남습니다 (완료 알림에 번호 표시).',
                    items: pick.slice(0, 5).map(r => `${r.movement_date} · ${r.items?.std_code || '-'} · ${r.items?.name || ''} · ${r.qty}${r.items?.unit || ''}`),
                    more: Math.max(0, ids.length - 5), okText: '삭제', danger: true }))
                    delHistMut.mutate(ids)
                }} disabled={delHistMut.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-40">
                {delHistMut.isPending && <Spin />}🗑 선택 {selShown.length}건 삭제</button>
            </>)}
            <div className="ml-auto text-xs text-slate-400 self-center">
              총 {histShown.length}건 / {histTotal.toLocaleString()} {history[0]?.items?.unit||''}
            </div>
          </div>

          {histErr && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">입고 현황을 불러오지 못했습니다 — {histErr.message}</p>}
          {histCapped && <p data-hist-capped className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">⚠ 조회 기간의 입고가 5,000건을 넘어 앞의 5,000건만 불러왔습니다 (최근 입고일 순). 합계 · 엑셀이 모자랄 수 있으니 기간을 좁혀 조회해 주세요.</p>}
          <div className="kpi-grid grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">총 입고 건수</p>
              <p className="text-xl font-bold text-slate-900">{histShown.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">총 입고 수량</p>
              <p className="text-xl font-bold text-emerald-700">{histTotal.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">품목 수</p>
              <p className="text-xl font-bold text-indigo-700">{new Set(histShown.map(r=>r.item_id)).size}</p>
            </div>
          </div>

          {histLoading ? (
            <div data-hist-loading className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 px-3 py-3 flex gap-6" data-skeleton>{[50, 70, 90, 60, 80, 40].map((w, i) => <SkelBar key={i} w={w} h={9} />)}</div>
              <table className="w-full text-xs"><tbody><SkeletonRows cols={14} rows={8} first={1} /></tbody></table>
            </div>) : (
            <div ref={histRef} className="rounded-xl border border-slate-200 overflow-hidden flex flex-col" style={histH ? { height: histH + 'px' } : undefined}>
              <div className={histH ? 'flex-1 min-h-0 overflow-auto' : 'overflow-x-auto'}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10"><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox"
                        checked={histShown.length>0 && selShown.length===histShown.length}
                        onChange={e=>setSelHist(e.target.checked ? new Set(histShown.map(r=>r.id)) : new Set())}/>
                    </th>
                    {['입고일','기준코드','품명','제조사','제조사품번','수량','단위','단가','금액','발주번호','구매처','고객사','비고'].map(h=>(
                      <th key={h} data-hist-sort={h} onClick={()=>sortBy(h)} title="눌러서 정렬 — 오름차순 → 내림차순 → 원래 순서"
                        className={`px-3 py-2.5 text-left font-bold text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600 ${hSort.key===h?'text-indigo-600':'text-slate-400'}`}>
                        {h}{hSort.key===h ? (hSort.dir==='asc' ? ' ▲' : ' ▼') : ''}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {histShown.length===0
                      ? <tr><td colSpan={14} className="text-center py-10 text-slate-400">입고 이력이 없습니다</td></tr>
                      : hVis.shown.map(r=>(
                        <tr key={r.id} data-hist-row={r.id}
                          onClick={()=>{ if (String(window.getSelection?.() || '')) return   // 글자 끌어 고를 때는 선택 안 바꿈
                            const n=new Set(selHist); n.has(r.id)?n.delete(r.id):n.add(r.id); setSelHist(n) }}
                          className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${selHist.has(r.id)?'bg-red-50/40':''}`}>
                          <td className="px-3 py-2 text-center" onClick={e=>e.stopPropagation()}>
                            <input type="checkbox" checked={selHist.has(r.id)}
                              onChange={e=>{ const n=new Set(selHist); e.target.checked?n.add(r.id):n.delete(r.id); setSelHist(n) }}/>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{r.movement_date}
                            {r.ecount_purchase_at && <span data-ecp-mark title={`이카운트 구매입력 엑셀 내려받음 ${String(r.ecount_purchase_at).slice(0,10)}${r.ecount_purchase_by ? ' · ' + r.ecount_purchase_by : ''}`}
                              className="ml-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 text-[10px] font-bold">이카운트 ✓</span>}</td>
                          <td className="px-3 py-2 font-mono text-xs text-indigo-600"><ItemLink code={r.items?.std_code} /></td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{r.items?.name}</td>
                          <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate" title={mfrOf(r)}>{mfrOf(r)||'-'}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-500 max-w-[150px] truncate" title={mpnOf(r)}>{mpnOf(r)||'-'}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">{r.qty}</td>
                          <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                          <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                            {r.unit_price ? Number(r.unit_price).toLocaleString('ko-KR') : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">
                            {r.unit_price ? (Number(r.qty) * Number(r.unit_price)).toLocaleString('ko-KR') : '-'}
                          </td>
                          <td className="px-3 py-2">{r.po_id ? <span className="font-mono text-slate-500">{r.purchase_orders?.po_number||'-'}</span> : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-bold">발주외</span>}</td>
                          <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.vendors?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.customers?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[220px] truncate" title={histMemo(r)}>{histMemo(r)||'-'}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
                <MoreRows {...hVis} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 이카운트 구매입력 변환 — 체크한 입고 줄 → 엑셀 (v4.112.0) */}
      {ecpOpen && (
        <EcountPurchaseModal rows={histShown.filter(r => selHist.has(r.id))} customers={customers} email={me?.email}
          onClose={()=>setEcpOpen(false)}
          onMarked={()=>qc.invalidateQueries({ queryKey:['inboundHistory'], exact:false })} />
      )}

      {/* 입고일 변경 — 날짜만 바꾼다 */}
      {dateForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={()=>setDateForm(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3"
            onClick={e=>e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">📅 입고일 변경</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {selShown.length}건. 수량·단가·재고는 그대로 두고 날짜만 바꿉니다.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">바꿀 입고일 *</label>
              <input type="date" value={dateForm.date}
                onChange={e=>setDateForm(v=>({ ...v, date:e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[['오늘',0],['이번 달 1일','m0'],['지난달 말일','mEnd']].map(([l,k])=>(
                  <button key={l}
                    onClick={()=>{
                      const d=new Date(); let x
                      if(k===0) x=d
                      else if(k==='m0') x=new Date(d.getFullYear(), d.getMonth(), 1)
                      else x=new Date(d.getFullYear(), d.getMonth(), 0)
                      const p=n=>String(n).padStart(2,'0')
                      setDateForm(v=>({ ...v,
                        date:`${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}` }))
                    }}
                    className="px-2 py-1 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">사유 (선택)</label>
              <input value={dateForm.memo}
                onChange={e=>setDateForm(v=>({ ...v, memo:e.target.value }))}
                placeholder="예: 9월로 이월"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              바꾼 내역은 기록에 남습니다. 입고가 아닌 줄이 섞여 있으면 처리되지 않습니다.
            </p>

            <div className="flex gap-2">
              <button onClick={()=>setDateForm(null)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
                취소
              </button>
              <button
                onClick={()=>{
                  if(!dateForm.date){ toastError('바꿀 날짜를 넣으세요'); return }
                  dateMut.mutate({ ids:[...selShown], date:dateForm.date, memo:dateForm.memo.trim() })
                }}
                disabled={dateMut.isPending}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {dateMut.isPending ? <span className="inline-flex items-center gap-1.5"><Spin />처리 중…</span> : `${selShown.length}건 변경`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 고객사 탭. 구매발주와 같은 모양으로 맞춘다.
//   드롭다운은 지금 뭘 보고 있는지 한눈에 안 들어온다.
const CS_COLOR = { ax: '#8b5cf6', ed: '#3b82f6', vm: '#10b981', csk: '#f59e0b' }

function CsTabs({ sel, onSel, customers, className = 'mb-3' }) {
  return (
    <div className={`flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit ${className}`}>
      <button onClick={() => onSel('')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
          !sel ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
        전체
      </button>
      {customers.map(c => (
        <button key={c.id} onClick={() => onSel(c.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            sel === c.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <span className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: CS_COLOR[String(c.code || '').toLowerCase()] || '#94a3b8' }} />
          {c.name}
        </button>
      ))}
    </div>
  )
}
