import { useState, useEffect, useMemo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomers } from '../../hooks/useCustomers'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCanEdit } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { buildLabelZpl } from '../../lib/labelZpl'
import { catOf } from '../../lib/utils'
import * as XLSX from 'xlsx'

function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]
}

async function fetchProjects(customerId) {
  const { data } = await supabase.from('projects').select('id,code,name,rev').eq('customer_id', customerId).order('code')
  return data || []
}
async function fetchActiveCPOs(customerId, projectId) {
  if (!customerId) return []
  let q = supabase.from('purchase_orders')
    .select('id,po_number,qty_ordered,qty_remaining,items!purchase_orders_item_id_fkey(std_code,name,unit),projects(code,name)')
    .eq('customer_id', customerId).eq('order_type','customer_po').neq('status','완료')
  if (projectId) q = q.eq('project_id', projectId)
  const { data } = await q.order('created_at', { ascending: false })
  return data || []
}
async function fetchBOMItems(customerId, projectId) {
  if (!customerId || !projectId) return []
  const { data } = await supabase.from('bom')
    .select('*, items!bom_item_id_fkey(id,std_code,name,unit,type,js_code,manufacturer,manufacturer_code,label_mode,pack_qty)')
    .eq('customer_id', customerId).eq('project_id', projectId)
  return data || []
}
async function fetchOutboundHistory({ from, to, customerId }) {
  let q = supabase.from('stock_movements')
    .select('*, items(std_code,name,unit), purchase_orders(po_number,customer_id,customers(name,code),projects(code,name))')
    .eq('movement_type','출고')
    .gte('movement_date', from)
    .lte('movement_date', to)
    .order('movement_date', { ascending: false })
  const { data, error } = await q.limit(200)
  if (error) throw error
  let rows = data || []
  if (customerId) rows = rows.filter(r=>r.purchase_orders?.customer_id===customerId)
  return rows
}

export default function Outbound() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('process')
  // 제작구분: item_id → { make_type:'normal'|'harness'|'exclude', note:'' }
  const [makeTypes, setMakeTypes] = useState({})

  // 라벨 출력 단위 — 건별 덮어쓰기. 바꾸면 품목 마스터(items)에 저장돼 다음에도 유지된다.
  //   sum=합산 / each=개별 / none=미출력
  const [labelOv, setLabelOv] = useState({})   // { item_id: 'sum'|'each'|'none' }
  const [packOv, setPackOv]   = useState({})   // { item_id: 원포장수량 }
  const [labelConfirm, setLabelConfirm] = useState(null)
  // 로컬 오버라이드 → 행 직속 값 → BOM join 값 → 기본(sum) 순
  const labelModeOf = (b) => labelOv[b.item_id] ?? b.label_mode ?? b.items?.label_mode ?? 'sum'
  const packQtyOf   = (b) => packOv[b.item_id] ?? b.pack_qty ?? b.items?.pack_qty ?? null

  async function saveLabelMode(itemId, mode, pack) {
    if (!itemId) return
    // 로컬 오버라이드는 항상 유지한다. (invalidate 후 refetch 가 입력값을 덮어쓰는 문제 방지)
    setLabelOv(v => ({ ...v, [itemId]: mode }))
    const packNum = (pack === '' || pack == null) ? null : Number(pack)
    if (pack !== undefined) setPackOv(v => ({ ...v, [itemId]: packNum }))

    const patch = { label_mode: mode }
    if (pack !== undefined) patch.pack_qty = packNum
    const { error } = await supabase.from('items').update(patch).eq('id', itemId)
    if (error) { toastError('라벨 설정 저장 실패: ' + error.message); return }
    const label = mode === 'sum' ? '합산' : mode === 'each' ? '개별' : '미출력'
    toastSuccess(`라벨 ${label}${pack !== undefined && packNum ? ` · 원포장 ${packNum}` : ''} 저장`)

    // refetch 로 입력값이 날아가지 않도록, 캐시를 직접 갱신한다 (조용히 병합)
    qc.setQueriesData({ queryKey: ['bomForOut'], exact: false }, (old) => {
      if (!Array.isArray(old)) return old
      return old.map(b => b.item_id === itemId
        ? { ...b, items: { ...b.items, label_mode: mode, ...(pack !== undefined ? { pack_qty: packNum } : {}) } }
        : b)   // outOrder 는 bomItems 에서 파생되므로 items 만 갱신하면 함께 반영됨
    })
  }
  const [showAll, setShowAll] = useState(false)         // 제외 품목도 표시
  const [selectedIds, setSelectedIds] = useState(new Set()) // 다중선택
  // 위치순이 기본. 창고를 돌며 꺼내는 순서와 같아 동선이 짧아진다.
  const [sortBy, setSortBy] = useState('location')      // maker | location | code
  const [harnessUnits, setHarnessUnits] = useState(10)  // 하네스 불출 대수
  // 출고 처리
  const [selCustomer, setSelCustomer] = useState('')
  const [selProject, setSelProject] = useState('')
  const [projSearch, setProjSearch] = useState('')
  const [outUnits, setOutUnits] = useState(1)
  const [selCPO, setSelCPO] = useState(null)
  const [outQtys, setOutQtys] = useState({})
  const [note, setNote] = useState('')
  const [result, setResult] = useState(null)
  const [stockWarning, setStockWarning] = useState(null)
  // 출고 현황
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(new Date().toISOString().split('T')[0])
  const [hCustomer, setHCustomer] = useState('')
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: new Date().toISOString().split('T')[0], customerId:'' })

  const { data: customers=[] } = useCustomers()
  const { data: projects=[] } = useQuery({
    queryKey:['projects',selCustomer], queryFn:()=>fetchProjects(selCustomer), enabled:!!selCustomer,
  })
  const { data: cpos=[] } = useQuery({
    queryKey:['activeCPOs',selCustomer,selProject], queryFn:()=>fetchActiveCPOs(selCustomer,selProject||null), enabled:!!selCustomer,
  })
  const { data: bomItems=[] } = useQuery({
    queryKey:['bomForOut',selCustomer,selProject], queryFn:()=>fetchBOMItems(selCustomer,selProject), enabled:!!selCustomer&&!!selProject,
  })
  const { data: history=[], isLoading: histLoading } = useQuery({
    queryKey:['outboundHistory', hQuery],
    queryFn:()=>fetchOutboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId }),
    enabled: tab==='history',
  })

  const iCanEdit = useCanEdit()
  const guardEdit = () => { if (!iCanEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false } return true }
  // ── 저장된 제작구분 로드 (프로젝트 선택 시) ──
  useEffect(() => {
    if (!selCustomer || !selProject) { setMakeTypes({}); return }
    ;(async () => {
      const { data } = await supabase.from('pm_bom_notes').select('item_id,make_type,note')
        .eq('customer_id', selCustomer).eq('project_id', selProject)
      const m = {}
      ;(data||[]).forEach(r => { m[r.item_id] = { make_type: r.make_type || 'normal', note: r.note || '' } })
      setMakeTypes(m)
    })()
  }, [selCustomer, selProject])

  const mtOf = (id) => makeTypes[id]?.make_type || 'normal'
  const noteOf = (id) => makeTypes[id]?.note || ''

  // 대체품 — 비고에 적으면 제조사·제조사품번을 그것으로 대체한다.
  //   "EATON FAZ-C10/1"  → 제조사 EATON / 품번 FAZ-C10/1
  //   "FAZ-C10/1사용"    → 제조사 없음 / 품번 FAZ-C10/1사용 (공백 없으면 품번만)
  function altOf(id) {
    const t = (makeTypes[id]?.note || '').trim()
    if (!t) return null
    const i = t.indexOf(' ')
    return i > 0
      ? { maker: t.slice(0, i).trim(), makerPn: t.slice(i + 1).trim(), raw: t }
      : { maker: '', makerPn: t, raw: t }
  }

  // 제작구분/비고 저장 (upsert) — 하나 또는 여러 개
  async function saveMakeType(itemIds, make_type, note) {
    if (!selCustomer || !selProject) return
    if (!guardEdit()) return
    const rows = itemIds.map(id => ({
      customer_id: selCustomer, project_id: selProject, item_id: id,
      make_type, note: note !== undefined ? note : (makeTypes[id]?.note || ''),
    }))
    const { error } = await supabase.from('pm_bom_notes').upsert(rows, { onConflict: 'customer_id,project_id,item_id' })
    if (error) { toastError('저장 오류: ' + error.message); return }
    setMakeTypes(prev => {
      const n = { ...prev }
      itemIds.forEach(id => { n[id] = { make_type, note: note !== undefined ? note : (n[id]?.note || '') } })
      return n
    })
    // 변경된 품목만 수량 조정 (전체 리셋 대신) — 전장이면 BOM기본값, 아니면 0
    setOutQtys(prev => {
      const q = { ...prev }
      itemIds.forEach(id => {
        if (make_type === 'normal') {
          const per = bomItems.filter(b=>b.item_id===id).reduce((a,b)=>a+(b.qty_per_unit||0),0)
          q[id] = per * (outUnits||1)
        } else {
          delete q[id]   // 하네스·현장재고·제외는 차감 대상 아님
        }
      })
      return q
    })
  }
  // 위치(inventory.location) 저장 — 품목 기준이라 모든 BOM·현장검색에 자동 반영
  async function saveLocation(item_id, location) {
    if (!guardEdit()) return
    const loc = (location || '').trim()
    // inventory 행이 있으면 UPDATE, 없으면 INSERT (item_id UNIQUE)
    const { error } = await supabase.from('inventory')
      .upsert({ item_id, location: loc || null }, { onConflict: 'item_id' })
    if (error) { toastError('위치 저장 오류: ' + error.message); return }
    qc.invalidateQueries(['outLocMeta'])
    qc.invalidateQueries(['inventory'])
    toastSuccess('위치 저장: ' + (loc || '(비움)'))
  }

  const MT_LABEL = { normal: '전장', field_stock: '전장(현장재고)', harness: '하네스자재', exclude: '불출 미대상' }
  const MT_COLOR = { normal: 'text-slate-600 font-semibold', field_stock: 'text-teal-600 font-semibold', harness: 'text-amber-600 font-bold', exclude: 'text-slate-400 line-through' }

  // ── ZM400 라벨 출력 (63.5×31.75mm, gap 3mm) — 불출 화면과 동일 ──
  // 라벨 ZPL 은 lib/labelZpl.js 에서 생성 (DPI 스케일 자동)

  // 출력 단위에 따라 라벨 목록으로 전개 (합산 1장 / 개별 ceil(수량/원포장) 장)
  const MAX_PER_ITEM = 50   // 실수로 수백 장이 나가는 것 방지
  function expandOutLabels(rows) {
    const out = []; const capped = []
    for (const r of rows) {
      const mode = labelModeOf(r)
      const qty = Number(r.qty) || 0
      const pack = Number(packQtyOf(r)) || 0
      if (mode !== 'each' || pack <= 0 || qty <= pack) {
        out.push({ ...r, labelQty: r.qty, part: '', total: 1 })
        continue
      }
      let n = Math.ceil(qty / pack)
      if (n > MAX_PER_ITEM) { capped.push({ code: r.std_code, want: n }); n = MAX_PER_ITEM }
      for (let i = 0; i < n; i++) {
        const q = i === n - 1 ? qty - pack * (n - 1) : pack
        out.push({ ...r, labelQty: q, part: `${i + 1}/${n}`, total: n })
      }
    }
    return { labels: out, capped }
  }

  function printOutLabels() {
    // 전장(normal)만 + 위치'라벨' 제외 + 미출력(none) 제외 + 수량 입력된 것만
    // ★ 라벨 NO 는 화면 목록(outItems)의 순번과 일치해야 현장에서 불출표와 대조된다.
    //   출력 대상만 다시 1,2,3... 매기면 하네스·미출력이 섞였을 때 번호가 어긋난다.
    const noMap = new Map(outItems.map((o, i) => [o.item_id, i + 1]))
    const rows = outItems
      .filter(r => mtOf(r.item_id) === 'normal'
        && String(r.location||'').trim() !== '라벨'
        && labelModeOf(r) !== 'none'
        && Number(outQtys[r.item_id]||0) > 0)
      .map(r => {
        // 대체품이 있으면 제조사·제조사품번을 그것으로 바꿔 라벨에 찍는다
        const alt = altOf(r.item_id)
        return {
          ...r,
          qty: Number(outQtys[r.item_id]||0),
          no: noMap.get(r.item_id),
          maker: alt ? alt.maker : r.maker,
          makerPn: alt ? alt.makerPn : r.makerPn,
          isAlt: !!alt,
        }
      })
    if (!rows.length) { toastError('라벨 출력 대상이 없습니다 (전장 자재에 출고수량 입력. 현장재고·하네스·라벨류·미출력 제외).'); return }

    const { labels, capped } = expandOutLabels(rows)
    if (capped.length) toastError(`원포장 수량이 작아 라벨 과다: ${capped.map(c=>`${c.code} ${c.want}장`).join(', ')} → ${MAX_PER_ITEM}장 제한`)

    // 바로 출력하지 않고 확인 모달 (개별 출력으로 장수가 불어날 수 있어 오출력 방지)
    const eachRows = rows.filter(r => {
      const pack = Number(packQtyOf(r)) || 0
      return labelModeOf(r) === 'each' && pack > 0 && Number(r.qty) > pack
    })
    setLabelConfirm({
      labels,
      itemCount: rows.length,
      labelCount: labels.length,
      eachCount: labels.filter(l => l.part).length,
      eachItems: eachRows.map(r => {
        const pack = Number(packQtyOf(r))
        return { code: r.std_code, qty: r.qty, pack, n: Math.min(MAX_PER_ITEM, Math.ceil(r.qty / pack)) }
      }),
      skipped: 0,
    })
  }

  function sendOutLabels(labels) {
    setLabelConfirm(null)
    const zpl = buildLabelZpl(labels)
    const BP = window.BrowserPrint
    if (!BP) { toastError('Zebra Browser Print가 설치/실행되어 있지 않습니다.'); return }
    BP.getDefaultDevice('printer', (device) => {
      if (!device) { toastError('기본 프린터를 찾을 수 없습니다. Browser Print에서 ZM400을 등록하세요.'); return }
      device.send(zpl, () => toastSuccess(`전장 라벨 ${labels.length}장 전송`), (err) => toastError('라벨 전송 실패: ' + err))
    }, (err) => toastError('프린터 연결 실패: ' + err))
  }

  const outMut = useMutation({
    mutationFn: async ({ mode }) => {
      if (!guardEdit()) throw new Error('__READONLY__')
      const lines = bomItems
        .map(b=>({ item_id:b.item_id, name:b.items?.name||'', qty:Number(outQtys[b.item_id]||0) }))
        .filter(l=>l.qty>0 && mtOf(l.item_id)==='normal')   // 정상만 재고 차감 (하네스·제외 제외)
      const { data, error } = await supabase.rpc('pm_process_outbound', {
        p_lines: lines, p_po_id: selCPO?.id||null, p_note: note||null, p_mode: mode,
      })
      if (error) throw error
      return data
    },
    onSuccess: (res) => {
      if (res?.aborted) { setStockWarning({ errors: res.warnings||[] }); return }
      const w = res?.warnings||[]
      setStockWarning(null)
      setResult(`출고 처리 완료 (${res?.processed||0}건)` + (w.length?` · 부족 ${w.length}건 제외`:''))
      setOutQtys({}); setNote('')
      qc.invalidateQueries(['inventory'])
      qc.invalidateQueries(['outboundHistory'])
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('오류: ' + e.message) },
  })

  function autoFillFromBOM(qty) {
    const perItem = {}
    bomItems.forEach(b=>{ if(b.item_id) perItem[b.item_id] = (perItem[b.item_id]||0) + (b.qty_per_unit||0) })
    const qtys = {}
    Object.entries(perItem).forEach(([id, per])=>{ if (mtOf(id)==='normal') qtys[id] = per * (qty||1) })
    setOutQtys(qtys)
  }

  // BOM 로드되거나 대수 바뀌면 출고수량 자동계산 (제작구분 변경 시엔 리셋 안 함 — 수동 수정 보존)
  useEffect(()=>{ if(bomItems.length) autoFillFromBOM(outUnits) }, [bomItems, outUnits])

  // 프로젝트 검색 필터
  const projFiltered = projects.filter(p=>{
    if(!projSearch) return true
    const s = projSearch.toLowerCase()
    return `${p.code} ${p.name||''}`.toLowerCase().includes(s)
  })

  // 위치(inventory.location)만 별도 조회 — 제조사·카테고리는 bomItems join에 포함됨
  const outItemIds = [...new Set(bomItems.map(b=>b.item_id).filter(Boolean))]
  const { data: locMeta = {} } = useQuery({
    queryKey: ['outLocMeta', outItemIds.join(',')],
    enabled: outItemIds.length>0,
    queryFn: async () => {
      const { data: inv } = await supabase.from('inventory').select('item_id,location').in('item_id', outItemIds)
      const m = {}
      ;(inv||[]).forEach(r => { if (r.location) m[r.item_id] = r.location })
      return m
    },
  })

  // 로트 관리 품목의 선입선출 안내.
  //   먼저 써야 할 로트(가장 오래된 것)와 기한 초과 여부를 보여준다.
  //   로트를 등록해도 출고 화면에 안 보이면 선입선출이 되지 않는다.
  const { data: lotMeta = {} } = useQuery({
    queryKey: ['outLotMeta', outItemIds.join(',')],
    enabled: outItemIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.rpc('pm_lot_list', { p_item_id: null, p_only_left: true })
      const m = {}
      ;(data || []).forEach(l => {
        if (!outItemIds.includes(l.item_id)) return
        // 품목별로 먼저 쓸 것(fifo_rank 1) 하나만 남기고, 기한 초과 건수를 센다
        if (!m[l.item_id]) m[l.item_id] = { first: null, expired: 0, count: 0 }
        m[l.item_id].count += 1
        if (l.expired) m[l.item_id].expired += 1
        if (l.fifo_rank === 1) m[l.item_id].first = l
      })
      return m
    },
  })

  // ── 정렬은 수량과 분리 (수량 입력해도 순서 안 바뀌게) ──
  // 정렬 순서만 먼저 확정 → 수량은 렌더 시 outQtys에서 직접 읽음
  const [makerFilter, setMakerFilter] = useState('')  // 제조사 필터
  const outOrder = useMemo(() => {
    // 같은 품목이 BOM에 여러 줄 있으면 합침 (수량 합산) → 중복 체크박스/키 문제 해결
    const merged = {}
    bomItems.forEach(b => {
      const id = b.item_id
      if (!id) return
      if (!merged[id]) merged[id] = {
        item_id: id, std_code: b.items?.std_code, name: b.items?.name,
        unit: b.items?.unit, bom_qty: 0,
        cat: catOf(b.items) || '',   // 세부구분 (js_code 기준: 케이블/와이어/커넥터...)
        maker: b.items?.manufacturer || '',
        makerPn: b.items?.manufacturer_code || '',
        // 비고에 대체품이 적혀 있으면 라벨·불출표에서 그것을 쓴다
        altNote: noteOf(id) || '',
        location: locMeta[id] || '',
        // 라벨 출력 단위 — 행에 직접 담아야 새로고침 후에도 값이 살아난다
        label_mode: b.items?.label_mode ?? null,
        pack_qty: b.items?.pack_qty ?? null,
      }
      merged[id].bom_qty += (b.qty_per_unit || 0)
    })
    const rows = Object.values(merged)
    const rank = { normal: 0, field_stock: 1, harness: 2, exclude: 3 }
    const cmp = {
      maker: (a,b)=> String(a.maker).localeCompare(String(b.maker),'ko') || String(a.makerPn).localeCompare(String(b.makerPn),'ko') || String(a.std_code).localeCompare(String(b.std_code)),
      // 위치 미지정은 맨 뒤로. 한글 '힣' 은 localeCompare 에서 알파벳보다 앞이라
      // 문자로 채우지 않고 그룹을 나눠 판단한다.
      location: (a,b)=> {
        const ax = a.location ? 0 : 1, bx = b.location ? 0 : 1
        if (ax !== bx) return ax - bx
        return String(a.location||'').localeCompare(String(b.location||''),'ko')
            || String(a.std_code).localeCompare(String(b.std_code))
      },
      code: (a,b)=> String(a.std_code).localeCompare(String(b.std_code)),
    }
    return rows.sort((a,b)=>
      (rank[mtOf(a.item_id)] - rank[mtOf(b.item_id)]) ||   // 하네스·제외는 하단
      cmp[sortBy](a,b)
    )
  }, [bomItems, locMeta, makeTypes, sortBy])

  // 제조사 목록 (필터 드롭다운용)
  const makerList = useMemo(() => [...new Set(outOrder.map(o=>o.maker).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko')), [outOrder])

  // 화면 표시용 = 정렬 순서 + 필터 적용 (수량은 렌더에서 outQtys로)
  const outItems = useMemo(() => {
    let rows = outOrder
    if (!showAll) rows = rows.filter(o => mtOf(o.item_id) !== 'exclude')  // 기본: 제외만 숨김(전장·현장재고·하네스는 표시)
    if (makerFilter === '__none__') rows = rows.filter(o => !o.maker)
    else if (makerFilter) rows = rows.filter(o => o.maker === makerFilter)
    return rows
  }, [outOrder, makerFilter, showAll, makeTypes])
  const noMakerCount = useMemo(() => outOrder.filter(o=>!o.maker).length, [outOrder])

  const round2 = (v) => { const n = Number(v); return isNaN(n) ? "" : Math.round(n * 100) / 100 }
  // 글자수 제한 (넘으면 잘라냄)
  const cut = (str, max) => { const t = String(str||''); return t.length > max ? t.slice(0, max) : t }
  // 불출표 HTML 빌더 (공용)
  function buildSheet(title, rows, qtyFn, extraMeta) {
    const csName = selCustomer ? (customers.find(c=>c.id===selCustomer)?.name || '') : ''
    const projName = selProject ? (projects.find(p=>p.id===selProject)?.code || '') : ''
    const today = new Date().toLocaleDateString('ko-KR')
    // 제작구분별 그룹핑 (소제목으로 구분) — 컬럼에서 제작구분 빼고 품명 넓힘
    let lastMt = null, no = 0
    const body = rows.map((r)=>{
      const mt = mtOf(r.item_id)
      let groupHdr = ''
      if (mt !== lastMt) {
        lastMt = mt
        // 열이 10개이므로 colspan 도 10 (9로 두면 그룹 줄마다 빈 칸이 생겨 표가 어긋남)
        groupHdr = `<tr class="grp"><td colspan="10">■ ${MT_LABEL[mt] || mt}</td></tr>`
      }
      no++
      const nw = (mt === 'field_stock' || mt === 'harness') ? ' nw' : ''   // 전장(현장재고)·하네스는 1줄 제한
      // 비고에 대체품이 적혀 있으면 해당 행 아래에 한 줄 더 넣는다
      const alt = (noteOf(r.item_id) || '').trim()
      return groupHdr + `<tr>
        <td class="c nw">${no}</td>
        <td class="loc">${r.location||'-'}</td>
        <td class="code">${r.std_code||''}</td>
        <td class="cat">${r.cat||'-'}</td>
        <td class="mk${nw}">${cut(r.maker,12)||'-'}</td>
        <td class="mono${nw}">${cut(r.makerPn,20)||'-'}</td>
        <td class="nm${nw}">${cut(r.name,30)}</td>
        <td class="c b">${round2(qtyFn(r))}</td>
        <td class="c">${r.unit||''}</td>
        <td class="chk"></td>
      </tr>` + (alt ? `<tr class="alt">
        <td></td>
        <td colspan="9">↳ <b>대체품</b> ${alt}</td>
      </tr>` : '') + (() => {
        // 로트 관리 품목은 먼저 쓸 시리얼을 적는다. 창고에서 이걸 보고 꺼낸다
        const lm = lotMeta[r.item_id]
        if (!lm?.first) return ''
        const f = lm.first
        return `<tr class="alt${f.expired ? ' exp' : ''}">
          <td></td>
          <td colspan="9">↳ <b>${f.expired ? '⚠ 기한초과' : '먼저 사용'}</b>
            <span class="mono">${f.serial_no}</span>
            ${f.made_ym ? `· ${f.made_ym}` : ''} · 잔량 ${f.qty_left}
            ${lm.count > 1 ? `<span class="dim">(외 ${lm.count - 1}로트)</span>` : ''}</td>
        </tr>`
      })()}).join('')
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>*{font-family:'Malgun Gothic',sans-serif;box-sizing:border-box}body{padding:24px;color:#111}
    .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:8px}
    tr.alt.exp td{color:#b00;font-weight:bold}
    tr.alt .dim{color:#888;font-weight:normal}
    h1{font-size:20px;margin:0}.meta{font-size:12px;color:#555;text-align:right;line-height:1.6}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px;table-layout:fixed}
    th,td{border:1px solid #999;padding:4px 5px;text-align:left;overflow:hidden;word-break:break-all;vertical-align:middle}
    th{background:#f0f0f0;font-size:10px}
    .grp td{background:#e8eef7;font-weight:bold;font-size:11px;color:#1e3a5f;border-color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .c{text-align:center}.b{font-weight:bold}.mono{font-family:consolas,monospace}
    .loc{font-weight:bold;font-family:consolas;white-space:nowrap}
    .code{font-family:consolas;white-space:nowrap;overflow:hidden;text-overflow:clip}
    .cat{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .alt td{background:#fff8e1;border-top:none;font-size:10.5px;color:#8a6100;padding:2px 4px}
    .nm{line-height:1.3;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    td{max-height:34px}
    .nw{white-space:nowrap;overflow:hidden;text-overflow:clip}
    tr{page-break-inside:avoid}.sign{margin-top:18px;font-size:12px;display:flex;gap:40px}
    .sign span{border-top:1px solid #999;padding-top:4px;min-width:120px;text-align:center}
    @media print{body{padding:0}}</style></head><body>
    <div class="head"><h1>${title}</h1>
    <div class="meta">고객사: <b>${csName}</b> · 프로젝트: ${projName} · ${extraMeta}<br>출력일: ${today} · 총 ${rows.length}품목</div></div>
    <table><colgroup>
      <col style="width:3%"><col style="width:5%"><col style="width:11%"><col style="width:7%">
      <col style="width:10%"><col style="width:14%"><col style="width:33%">
      <col style="width:6%"><col style="width:5%"><col style="width:6%">
    </colgroup><thead><tr>
      <th class="c">No</th><th>위치</th><th>기준코드</th><th>카테고리</th>
      <th>제조사</th><th>제조사품번</th><th>품명</th><th class="c">수량</th><th class="c">단위</th><th class="c">키팅<br>확인</th>
    </tr></thead><tbody>${body}</tbody></table>
    <div class="sign"><span>작성</span><span>불출</span><span>확인</span></div>
    </body></html>`
  }
  function openPrint(html) {
    const w = window.open('','_blank')
    if(!w){ toastError('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }
    w.document.write(html); w.document.close(); w.onload=()=>{ w.focus(); w.print() }
  }

  // 박스 불출표 — 정상 + 하네스(표시만). 제외는 안 나옴. 수량은 출고수량(하네스는 참고표시)
  function printIssueSheet() {
    const rows = outOrder.filter(r => mtOf(r.item_id) !== 'exclude')
    if (!rows.length) { toastError('출력할 품목이 없습니다'); return }
    openPrint(buildSheet('자재 불출표', rows, r => outQtys[r.item_id] || 0, `${outUnits}대`))
  }
  // 하네스 불출표 — 하네스만, 대수(harnessUnits) × BOM/대
  function printHarnessSheet() {
    const rows = outOrder.filter(r => mtOf(r.item_id) === 'harness')
    if (!rows.length) { toastError('하네스 제작구분으로 지정된 품목이 없습니다'); return }
    openPrint(buildSheet('하네스 불출표', rows, r => (r.bom_qty || 0) * (harnessUnits || 1), `${harnessUnits}대분 (하네스)`))
  }

  const histTotal = history.reduce((a,r)=>a+r.qty,0)

  function exportHistory() {
    const data = history.map(r=>({
      '출고일':r.movement_date, '기준코드':r.items?.std_code, '품명':r.items?.name,
      '단위':r.items?.unit, '수량':r.qty,
      '고객사PO':r.purchase_orders?.po_number||'',
      '고객사':r.purchase_orders?.customers?.name||'',
      '프로젝트':r.purchase_orders?.projects?.code||'', '비고':r.note||'',
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'출고현황')
    XLSX.writeFile(wb,`출고현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {labelConfirm && (
        <LabelConfirmModal data={labelConfirm} onCancel={() => setLabelConfirm(null)} onPrint={() => sendOutLabels(labelConfirm.labels)} />
      )}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[['process','📤 출고 처리'],['history','📋 출고 현황']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {tab==='process' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-700">출고 설정</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
                <select value={selCustomer} onChange={e=>{ setSelCustomer(e.target.value); setSelProject(''); setSelCPO(null); setOutQtys({}); setProjSearch('') }}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">선택</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">프로젝트 {projects.length>0&&<span className="text-slate-300 font-normal">({projFiltered.length}/{projects.length})</span>}</label>
                <input value={projSearch} onChange={e=>setProjSearch(e.target.value)} disabled={!selCustomer}
                  placeholder="프로젝트 검색"
                  className="w-full mb-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"/>
                <select value={selProject} onChange={e=>{ setSelProject(e.target.value); setSelCPO(null) }}
                  disabled={!selCustomer}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50">
                  <option value="">전체</option>
                  {projFiltered.map(p=><option key={p.id} value={p.id}>{p.code}{p.name?` - ${p.name}`:''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 PO <span className="text-slate-300 font-normal">(선택 시 대수 자동)</span></label>
                <select value={selCPO?.id||''} onChange={e=>{
                  const cpo=cpos.find(c=>c.id===e.target.value)
                  setSelCPO(cpo||null)
                  if(cpo) setOutUnits(cpo.qty_remaining||1)
                }} disabled={!selCustomer}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50">
                  <option value="">선택 안 함</option>
                  {cpos.map(c=><option key={c.id} value={c.id}>{c.po_number||c.id.slice(0,8)} — {c.items?.name||''} (잔량:{c.qty_remaining})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">출고 대수</label>
                <input type="number" min="1" value={outUnits}
                  onChange={e=>setOutUnits(Math.max(1, Number(e.target.value)||1))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-indigo-600"/>
              </div>
            </div>
          </div>

          {stockWarning && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-xs font-bold text-amber-700">⚠️ 재고 부족 품목</p>
              <ul className="space-y-1">{stockWarning.errors.map((e,i)=><li key={i} className="text-xs text-amber-600">• {e}</li>)}</ul>
              <div className="flex gap-2">
                <button onClick={()=>setStockWarning(null)} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
                <button onClick={()=>{ setStockWarning(null); outMut.mutate({mode:'skip'}) }} className="px-4 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100">부족 제외 출고</button>
                <button onClick={()=>{ setStockWarning(null); outMut.mutate({mode:'force'}) }} className="px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700">강제 출고</button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center">
              ✅ {result}
              <button onClick={()=>setResult(null)} className="ml-auto text-emerald-400">✕</button>
            </div>
          )}

          {selCustomer && (
            <div className="space-y-3">
              {bomItems.length>0&&(
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-600">BOM 연동 — {bomItems.length}개 품목
                    <span className="text-slate-400 font-normal ml-2">({outUnits}대 기준)</span>
                  </p>
                  <div className="flex gap-2 items-center flex-wrap">
                    <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      <option value="maker">제조사순</option>
                      <option value="location">위치순</option>
                      <option value="code">기준코드순</option>
                    </select>
                    {makerList.length > 0 && (
                      <select value={makerFilter} onChange={e=>setMakerFilter(e.target.value)}
                        className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        <option value="">전체 제조사</option>
                        {makerList.map(m=><option key={m} value={m}>{m}</option>)}
                        {noMakerCount>0 && <option value="__none__">⚠ 제조사 없음 ({noMakerCount})</option>}
                      </select>
                    )}
                    <label className="flex items-center gap-1 text-xs font-semibold text-slate-500 cursor-pointer">
                      <input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)} />
                      제외 품목도 표시
                    </label>
                    <button onClick={()=>autoFillFromBOM(outUnits)} className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">🔄 재계산</button>
                    <button onClick={printIssueSheet} title="박스 불출표 (정상+하네스표시, 제외 뺌)" className="text-xs font-bold text-white bg-indigo-600 px-2.5 py-1 rounded hover:bg-indigo-700">🖨 박스 불출표</button>
                    <button onClick={printOutLabels} title="전장 자재를 ZM400 라벨로 출력 (수량 입력된 것만, 라벨류·현장재고·하네스 제외)" className="text-xs font-bold text-white bg-teal-600 px-2.5 py-1 rounded hover:bg-teal-700">🏷 라벨 출력</button>
                    <span className="inline-flex items-center gap-1 text-xs">
                      <input type="number" min={1} value={harnessUnits} onChange={e=>setHarnessUnits(Number(e.target.value)||1)}
                        className="w-12 px-1 py-1 border border-slate-200 rounded text-right" title="하네스 불출 대수" />대
                      <button onClick={printHarnessSheet} title="하네스 제작구분 품목만, 입력 대수분" className="font-bold text-white bg-amber-600 px-2.5 py-1 rounded hover:bg-amber-700">🖨 하네스 불출표</button>
                    </span>
                  </div>
                </div>
              )}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-indigo-50 border border-indigo-200 text-xs">
                  <span className="font-bold text-indigo-700">{selectedIds.size}개 선택</span>
                  <span className="text-slate-500">→ 제작구분 일괄:</span>
                  <button onClick={()=>{ saveMakeType([...selectedIds],'normal'); setSelectedIds(new Set()) }} className="px-2 py-1 rounded bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50">전장</button>
                  <button onClick={()=>{ saveMakeType([...selectedIds],'field_stock'); setSelectedIds(new Set()) }} className="px-2 py-1 rounded bg-white border border-teal-200 text-teal-600 font-semibold hover:bg-teal-50">전장(현장재고)</button>
                  <button onClick={()=>{ saveMakeType([...selectedIds],'harness'); setSelectedIds(new Set()) }} className="px-2 py-1 rounded bg-white border border-amber-200 text-amber-600 font-semibold hover:bg-amber-50">하네스자재</button>
                  <button onClick={()=>{ saveMakeType([...selectedIds],'exclude'); setSelectedIds(new Set()) }} className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-500 font-semibold hover:bg-slate-50">불출 미대상</button>
                  <input placeholder="비고 일괄입력 후 Enter" onKeyDown={e=>{ if(e.key==='Enter'){ saveMakeType([...selectedIds], mtOf([...selectedIds][0]), e.target.value); e.target.value=''; } }}
                    className="ml-2 px-2 py-1 border border-slate-200 rounded flex-1 min-w-[120px]" />
                  <button onClick={()=>setSelectedIds(new Set())} className="text-slate-400 hover:text-slate-600">선택해제</button>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-2 py-2.5 w-8 text-center">
                      <input type="checkbox" title="전체 선택"
                        checked={outItems.length>0 && outItems.every(o=>selectedIds.has(o.item_id))}
                        onChange={e=>{ setSelectedIds(e.target.checked ? new Set(outItems.map(o=>o.item_id)) : new Set()) }} />
                    </th>
                    {[['No','w-8'],['위치','w-14'],['카테고리','w-16'],['제조사','w-20'],['제조사품번','w-24'],['기준코드','w-24'],['품명',''],['단위','w-10'],['BOM/대','w-14'],['출고수량','w-16'],['제작구분','w-24'],['라벨','w-32'],['비고','w-28']].map(([h,w])=>(
                      <th key={h} className={`px-2 py-2.5 text-left font-bold text-slate-400 text-xs ${w}`}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {outItems.length===0
                      ? <tr><td colSpan={13} className="text-center py-8 text-slate-400">{!selProject?'프로젝트를 선택하면 BOM이 자동으로 불러와집니다':'BOM 데이터가 없습니다'}</td></tr>
                      : outItems.map((item,idx)=>{
                        const mt = mtOf(item.item_id)
                        const dim = mt !== 'normal'
                        return (
                        <tr key={item.item_id} className={`border-b border-slate-100 ${dim?'bg-slate-50':''} ${selectedIds.has(item.item_id)?'bg-indigo-50/50':''}`}>
                          <td className="px-2 py-2 text-center">
                            <input type="checkbox" checked={selectedIds.has(item.item_id)}
                              onChange={()=>setSelectedIds(p=>{ const n=new Set(p); n.has(item.item_id)?n.delete(item.item_id):n.add(item.item_id); return n })} />
                          </td>
                          <td className="px-2 py-2 text-center text-slate-400">{idx+1}</td>
                          <td className="px-2 py-2">
                            <input defaultValue={item.location||''} placeholder="위치"
                              key={`loc-${item.item_id}-${item.location||''}`}
                              onBlur={e=>{ if(e.target.value.trim()!==(item.location||'')) saveLocation(item.item_id, e.target.value) }}
                              className="w-14 px-1 py-1 text-xs font-mono font-bold text-slate-700 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                          </td>
                          <td className="px-2 py-2 text-slate-500">{item.cat||'—'}</td>
                          <td className={`px-2 py-2 max-w-[80px] truncate ${dim?'text-slate-400':'text-slate-500'}`} title={item.maker}>{item.maker||'—'}</td>
                          <td className="px-2 py-2 font-mono text-xs text-violet-600 max-w-[100px] truncate" title={item.makerPn}>{item.makerPn||'—'}</td>
                          <td className="px-2 py-2 font-mono text-xs text-indigo-600">{item.std_code}</td>
                          <td className={`px-2 py-2 font-semibold max-w-[180px] ${dim?'text-slate-400':'text-slate-800'}`} title={item.name}>
                            <div className="truncate">{item.name}</div>
                            {(() => {
                              // 로트 관리 품목이면 먼저 쓸 시리얼을 알려준다
                              const lm = lotMeta[item.item_id]
                              if (!lm?.first) return null
                              const f = lm.first
                              return (
                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                  <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${
                                    f.expired ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white'}`}>
                                    {f.expired ? '기한초과' : '먼저사용'}
                                  </span>
                                  <span className="text-[11px] font-bold text-slate-600"
                                    style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>
                                    {f.serial_no}
                                  </span>
                                  {f.made_ym && (
                                    <span className="text-[10px] text-slate-400">{f.made_ym}</span>
                                  )}
                                  <span className="text-[10px] text-slate-400">잔 {f.qty_left}</span>
                                  {lm.count > 1 && (
                                    <span className="text-[10px] text-slate-400">외 {lm.count - 1}로트</span>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                          <td className="px-2 py-2 text-slate-500">{item.unit}</td>
                          <td className="px-2 py-2 text-right text-slate-600">{item.bom_qty}</td>
                          <td className="px-2 py-2">
                            <input type="number" min={0} step="0.01" disabled={mt!=='normal'}
                              value={mt==='normal' ? (outQtys[item.item_id]??'') : ''}
                              onChange={e=>setOutQtys(prev=>({...prev,[item.item_id]:e.target.value}))}
                              className="w-16 px-1.5 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"/>
                          </td>
                          <td className="px-2 py-2">
                            <select value={mt} onChange={e=>saveMakeType([item.item_id], e.target.value)}
                              className={`text-xs border border-slate-200 rounded px-1 py-1 ${MT_COLOR[mt]}`}>
                              <option value="normal">전장</option>
                              <option value="field_stock">전장(현장재고)</option>
                              <option value="harness">하네스자재</option>
                              <option value="exclude">불출 미대상</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            {mt === 'normal' && String(item.location||'').trim() !== '라벨' ? (() => {
                              const lm = labelModeOf(item)
                              const pq = packQtyOf(item)
                              const q = Number(outQtys[item.item_id]||0)
                              return (
                                <div className="flex items-center gap-1 whitespace-nowrap">
                                  <div className="inline-flex rounded border border-slate-200 overflow-hidden">
                                    {[['sum','합산','bg-teal-600'],['each','개별','bg-amber-500'],['none','미출력','bg-slate-400']].map(([m2,l2,bg])=>(
                                      <button key={m2} onClick={()=>saveLabelMode(item.item_id, m2)}
                                        className={`px-1.5 py-0.5 text-[10px] font-bold ${lm===m2 ? `${bg} text-white` : 'text-slate-400 hover:text-slate-600'}`}>{l2}</button>
                                    ))}
                                  </div>
                                  {lm==='each' && (
                                    <input type="number" value={pq ?? ''} placeholder="원포장"
                                      onChange={e=>setPackOv(v=>({...v,[item.item_id]: e.target.value === '' ? null : Number(e.target.value)}))}
                                      onBlur={e=>saveLabelMode(item.item_id, 'each', e.target.value)}
                                      title="원포장 수량 (100개입이면 100). 입력 후 칸 밖을 클릭하면 저장됩니다"
                                      className={`w-14 px-1 py-0.5 text-[10px] text-right border rounded ${Number(pq)>0?'border-slate-200':'border-amber-400 bg-amber-50'}`}/>
                                  )}
                                  {lm==='each' && Number(pq)>0 && q>0 && (
                                    <span className="text-[10px] text-amber-600 font-bold">{Math.min(50,Math.ceil(q/Number(pq)))}장</span>
                                  )}
                                </div>
                              )
                            })() : <span className="text-slate-300 text-[10px]">—</span>}
                          </td>
                          <td className="px-2 py-2">
                            <input defaultValue={noteOf(item.item_id)} placeholder="비고"
                              onBlur={e=>{ if(e.target.value!==noteOf(item.item_id)) saveMakeType([item.item_id], mt, e.target.value) }}
                              className="w-full px-1.5 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                          </td>
                        </tr>
                      )})
                    }
                  </tbody>
                </table>
              </div>
              {outItems.length>0&&(
                <div className="space-y-2">
                  <input value={note} onChange={e=>setNote(e.target.value)} placeholder="출고 비고 (선택)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  <button onClick={()=>outMut.mutate({mode:'strict'})}
                    disabled={outMut.isPending||Object.values(outQtys).every(q=>!q||Number(q)<=0)}
                    className="w-full py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
                    {outMut.isPending?'처리 중...':'📤 출고 처리'}
                  </button>
                </div>
              )}
            </div>
          )}
          {!selCustomer&&(
            <div className="text-center py-16 text-slate-400">
              <p className="text-2xl mb-2">📤</p>
              <p className="text-sm">고객사를 선택하세요</p>
            </div>
          )}
        </div>
      )}

      {tab==='history' && (
        <div className="space-y-4">
          <div className="flex items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">시작일</label>
              <input type="date" value={hFrom} onChange={e=>setHFrom(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">종료일</label>
              <input type="date" value={hTo} onChange={e=>setHTo(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
              <select value={hCustomer} onChange={e=>setHCustomer(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">전체</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer})}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
            {history.length>0&&(
              <button onClick={exportHistory}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
            )}
            <div className="ml-auto text-xs text-slate-400 self-center">총 {history.length}건</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">총 출고 건수</p><p className="text-xl font-bold text-slate-900">{history.length}</p></div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-xs font-bold text-rose-400 uppercase tracking-wide mb-1">총 출고 수량</p><p className="text-xl font-bold text-rose-700">{histTotal.toLocaleString()}</p></div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">품목 수</p><p className="text-xl font-bold text-indigo-700">{new Set(history.map(r=>r.item_id)).size}</p></div>
          </div>

          {histLoading ? <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div> : (
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['출고일','기준코드','품명','수량','단위','고객사 PO','고객사','프로젝트','비고'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {history.length===0
                      ? <tr><td colSpan={9} className="text-center py-10 text-slate-400">출고 이력이 없습니다</td></tr>
                      : history.map(r=>(
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-700">{r.movement_date}</td>
                          <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.items?.std_code}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{r.items?.name}</td>
                          <td className="px-3 py-2 text-right font-bold text-rose-700">{r.qty}</td>
                          <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">{r.purchase_orders?.po_number||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.customers?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.projects?.code||'-'}</td>
                          <td className="px-3 py-2 text-slate-400">{r.note||'-'}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// 라벨 출력 전 확인 모달 — 몇 장 나가는지 보고 나서 출력한다 (오출력 방지)
function LabelConfirmModal({ data, onCancel, onPrint }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-3">🏷 라벨 출력</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">품목</span><span className="font-bold">{data.itemCount}건</span></div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">출력 매수</span>
            <span className="text-xl font-bold text-teal-600">{data.labelCount}장</span>
          </div>
          {data.eachCount > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
              <p className="font-bold text-amber-700 mb-1">개별 출력 {data.eachCount}장 포함</p>
              {data.eachItems.map(it => (
                <div key={it.code} className="flex justify-between text-amber-700">
                  <span className="font-mono">{it.code}</span>
                  <span>{it.qty} / {it.pack}개입 → <b>{it.n}장</b></span>
                </div>
              ))}
            </div>
          )}
          {data.skipped > 0 && (
            <p className="text-xs text-slate-400">제외 {data.skipped}건</p>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
          <button onClick={onPrint} className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-700">출력</button>
        </div>
      </div>
    </div>
  )
}
