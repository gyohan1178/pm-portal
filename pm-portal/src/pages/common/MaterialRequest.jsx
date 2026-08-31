import { useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'
import { toastError, toastSuccess } from '../../lib/toast'
import { useCanEditStrict, useCanEdit, useCanRequest } from '../../hooks/useProfile'
import { ResizableTable } from '../../components/ResizableTable'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const today = () => new Date().toISOString().slice(0, 10)
const dday = (d) => d ? Math.ceil((new Date(d) - new Date(new Date().toDateString())) / 86400000) : null

const ST = {
  '요청':     { cls: 'border-amber-300 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  '코드대기': { cls: 'border-orange-400 bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  '확인':   { cls: 'border-sky-300 bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  '처리중': { cls: 'border-indigo-300 bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  '완료':   { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  '반려':   { cls: 'border-slate-200 bg-slate-50 text-slate-500', dot: 'bg-slate-400' },
}

// 이 달 1일 — 이력 탭의 기본 시작일
const monthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
// 'YYYY-MM' 로 자른다 (월별 묶음)
const ym = (d) => String(d || '').slice(0, 7)

// 이력 표
const HIST_COLS = [
  { key: 'req_date',   label: '요청일',   defaultWidth: 92 },
  { key: 'req_no',     label: '요청번호', defaultWidth: 112 },
  { key: 'status',     label: '상태',     defaultWidth: 68 },
  { key: 'check_dept', label: '확인부서', defaultWidth: 88 },
  { key: 'req_kind',   label: '종류',     defaultWidth: 84 },
  { key: 'customer_code', label: '고객사', defaultWidth: 66 },
  { key: 'requester',  label: '요청자',   defaultWidth: 78 },
  { key: 'purpose',    label: '사용목적', defaultWidth: 150 },
  { key: 'unit_no',    label: '호기',     defaultWidth: 62 },
  { key: 'std_code',   label: '기준코드', defaultWidth: 120 },
  { key: 'item_name',  label: '품명',     defaultWidth: 220 },
  { key: 'maker',      label: '제조사',   defaultWidth: 100 },
  { key: 'qty',        label: '요청',     defaultWidth: 62, align: 'right' },
  { key: 'issued_qty', label: '불출',     defaultWidth: 62, align: 'right' },
  { key: 'unit',       label: '단위',     defaultWidth: 52 },
  { key: 'need_date',  label: '필요일',   defaultWidth: 92 },
  { key: 'handler',    label: '처리자',   defaultWidth: 78 },
  { key: 'handle_type', label: '처리유형', defaultWidth: 80 },
  { key: 'handled_at', label: '처리일시', defaultWidth: 118 },
]

const emptyRow = () => ({
  key: Math.random().toString(36).slice(2),
  item_id: null, std_code: '', item_name: '', maker: '', maker_code: '',
  qty: '', unit: 'EA', reason: '',
})

// 자재 요청.
//
//   제조팀이 "무엇을 만들기 위해 무엇이 얼마나 언제까지 왜 필요한지" 를 등록하면
//   관제탑 알림으로 구매자재팀에 전달된다.
//   재고·발주 정보는 화면에 표시하지 않는다 (팀 내부 정보).
export default function MaterialRequest() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()        // 처리(불출·발주·반려)
  // 재고는 가려야 하는 정보라, 권한을 모를 때는 숨긴다
  const canSeeStock = useCanEditStrict()
  const canReq = useCanRequest()      // 요청 등록 — 조회 계정도 가능
  const [tab, setTab] = useState('list')      // list | new
  const [filter, setFilter] = useState(null)  // null=미완료
  const [mine, setMine] = useState(false)      // 내가 등록한 것만
  const [csFilter, setCsFilter] = useState(null)
  const [deptFilter, setDeptFilter] = useState(null)
  const [codeForm, setCodeForm] = useState(null)   // 코드 부여 중인 항목
  // 부서 재배정 — 잘못 온 요청을 다른 팀으로 넘긴다
  const [reassign, setReassign] = useState(null)   // { dept, kind, cuts: {id: mm} }
  // 이력 조회
  const [hFrom, setHFrom] = useState(monthStart())
  const [hTo, setHTo] = useState(today())
  const [hDept, setHDept] = useState(null)
  const [hCs, setHCs] = useState(null)
  const [hStatus, setHStatus] = useState(null)
  const [hQ, setHQ] = useState('')

  // 코드 부여 대기 — 같은 품명끼리 묶여 나온다
  const { data: pendingCodes = [] } = useQuery({
    queryKey: ['pendingCodes'],
    queryFn: async () => {
      const { data } = await supabase.rpc('pm_pending_codes')
      return data || []
    },
    enabled: canEdit,
    staleTime: 60 * 1000,
  })
  const [sel, setSel] = useState({})

  // 요청 입력
  const [head, setHead] = useState({
    urgency: '보통', purpose: '', product_code: '', product_name: '',
    unit_no: '', need_date: '',
    requester_name: '', check_dept: '', customer_code: '',
    req_kind: '',        // 하네스팀일 때만 — 제작 | 절단
  })
  const [rows, setRows] = useState([emptyRow()])
  // ASSY 로 요청 — 그 BOM 부품을 제작구분별로 한꺼번에 가져온다
  const [assyOpen, setAssyOpen] = useState(false)
  const [assyQ, setAssyQ] = useState('')
  const [assyHits, setAssyHits] = useState([])
  const [assy, setAssy] = useState(null)         // { code, name, part_count }
  const [assyQty, setAssyQty] = useState('1')
  const [mkType, setMkType] = useState('normal') // normal 전장 / harness 하네스
  const assyTimer = useRef(null)
  const [busy, setBusy] = useState(false)

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['materialRequests', filter, mine, csFilter, deptFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_request_list',
        { p_status: filter, p_days: 90, p_mine: mine, p_customer: csFilter, p_dept: deptFilter })
      if (error) throw error
      return data || []
    },
    staleTime: 20 * 1000,        // 여러 명이 동시에 처리하므로 짧게 둔다
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,   // 화면을 안 보고 있으면 쉰다
    refetchOnWindowFocus: true,
  })

  const checked = list.filter(r => sel[r.id])

  // ── 내가 낸 요청 중 아직 안 본 알림 ──
  //   반려하거나 부서를 넘겨도 요청자는 찾아보지 않으면 모른다.
  //   목록 조회(p_status null)는 반려를 빼고 오므로 따로 부른다.
  const { data: notices = [] } = useQuery({
    queryKey: ['requestNotice'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_request_list',
        { p_status: '전체', p_days: 180, p_mine: true, p_customer: null, p_dept: null })
      if (error) throw error
      return (data || []).filter(r => r.notice_at && !r.notice_seen_at)
    },
    staleTime: 60 * 1000,
  })

  async function seenNotice(ids) {
    try {
      const { error } = await supabase.rpc('pm_request_notice_seen',
        { p_ids: ids, p_clear: false })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['requestNotice'] })
      qc.invalidateQueries({ queryKey: ['menuAlerts'] })
    } catch (e) { toastError('확인 처리 실패: ' + e.message) }
  }

  // ── 이력 ──
  //   목록은 90일·미완료 위주라 지난 것을 찾을 수 없다.
  //   이력은 기간을 직접 잡아 조회한다. 탭을 열 때만 부른다.
  const { data: hist = [], isFetching: hBusy } = useQuery({
    queryKey: ['requestHistory', hFrom, hTo, hDept, hCs],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_request_history', {
        p_from: hFrom || null, p_to: hTo || null,
        p_dept: hDept, p_customer: hCs,
      })
      if (error) throw error
      return data || []
    },
    enabled: tab === 'hist',
    staleTime: 60 * 1000,
  })

  // 상태·검색어는 다시 조회하지 않고 화면에서 거른다
  const histRows = hist.filter(r => {
    if (hStatus && r.status !== hStatus) return false
    const k = hQ.trim().toLowerCase()
    if (!k) return true
    return [r.std_code, r.item_name, r.maker, r.maker_code,
            r.requester, r.purpose, r.req_no, r.product_code]
      .some(v => String(v || '').toLowerCase().includes(k))
  })

  // 월별 묶음 — 몇 건이 어떻게 끝났는지
  const histMonths = (() => {
    const m = new Map()
    for (const r of histRows) {
      const k = ym(r.req_date)
      if (!k) continue
      let b = m.get(k)
      if (!b) { b = { ym: k, cnt: 0, done: 0, rej: 0, open: 0 }; m.set(k, b) }
      b.cnt++
      if (r.status === '완료') b.done++
      else if (r.status === '반려') b.rej++
      else b.open++
    }
    return [...m.values()].sort((a, b) => (a.ym < b.ym ? 1 : -1))
  })()

  // ── 품목 검색 ──
  const [searchIdx, setSearchIdx] = useState(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const timer = useRef(null)

  const doSearch = useCallback((v) => {
    setQ(v)
    clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); return }
    timer.current = setTimeout(async () => {
      const t = v.trim()
      // 품번·품명·제조사품번 어느 쪽으로도 찾을 수 있게 한다
      const { data } = await supabase.from('items')
        .select('id,std_code,name,unit,manufacturer,manufacturer_code')
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%`)
        .limit(15)
      setHits(data || [])
    }, 300)
  }, [])

  function pickItem(it) {
    setRows(v => v.map((r, i) => i === searchIdx ? {
      ...r, item_id: it.id, std_code: it.std_code, item_name: it.name,
      maker: it.manufacturer || '', maker_code: it.manufacturer_code || '',
      unit: it.unit || 'EA',
    } : r))
    setSearchIdx(null); setQ(''); setHits([])
  }

  const searchAssy = useCallback((v) => {
    setAssyQ(v)
    clearTimeout(assyTimer.current)
    if (v.trim().length < 2) { setAssyHits([]); return }
    assyTimer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('pm_assy_search', { p_q: v.trim(), p_limit: 15 })
      setAssyHits(data || [])
    }, 300)
  }, [])

  // ASSY 자재 요청 — 부품을 낱개로 펼치지 않고 한 건으로 등록한다.
  //
  //   "어느 ASSY 의 전장(또는 하네스) 자재가 필요하다" 만 전달하면
  //   담당자가 BOM 을 보고 불출하므로, 요청자가 47줄을 확인할 필요가 없다.
  //   부품 종수와 부족 수만 참고로 보여준다.
  async function loadAssyParts(a, type, qty) {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_assy_parts', {
        p_code: a.code, p_make_type: type, p_qty: Number(qty) || 1,
      })
      if (error) throw error
      if (!data?.length) { toastError('해당 구분의 부품이 없습니다'); return }

      const label = type === 'harness' ? '하네스' : '전장'

      setRows([{
        key: Math.random().toString(36).slice(2),
        item_id: null,
        std_code: a.code,
        item_name: `${a.name || a.code} — ${label} 자재 일체`,
        maker: '', maker_code: '',
        qty: String(Number(qty) || 1), unit: '대분', reason: '',
        _assy: true, _parts: data.length,
      }])
      setHead(h => ({
        ...h,
        product_code: a.code,
        product_name: a.name || '',
        purpose: h.purpose || `${a.code} ${label} 자재 요청`,
      }))
      toastSuccess(`${a.code} ${label} 자재 — 부품 ${data.length}종`)
    } catch (e) {
      toastError('불러오기 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  async function submit() {
    const valid = rows.filter(r => (r.std_code || r.item_name) && Number(r.qty) > 0)
    if (!valid.length) { toastError('품목과 수량을 입력하세요'); return }
    if (!head.purpose.trim()) { toastError('사용 목적을 입력하세요'); return }
    if (!head.requester_name.trim()) { toastError('요청자를 입력하세요'); return }
    if (!head.check_dept) { toastError('확인부서를 선택하세요'); return }
    if (head.check_dept === '하네스팀' && !head.req_kind) {
      toastError('요청 종류를 고르세요 (제작·절단)'); return
    }
    if (head.check_dept === '하네스팀' && head.req_kind === '절단'
        && valid.some(r => !(Number(r.cut_mm) > 0))) {
      toastError('절단 길이를 적어 주세요'); return
    }
    setBusy(true)
    try {
      const payload = valid.map(r => ({
        urgency: head.urgency, purpose: head.purpose,
        requester_name: head.requester_name, check_dept: head.check_dept,
        customer_code: head.customer_code,
        req_kind: head.check_dept === '하네스팀' ? (head.req_kind || null) : null,
        cut_mm: head.check_dept === '하네스팀' && head.req_kind === '절단'
          ? (Number(r.cut_mm) || null) : null,
        product_code: head.product_code, product_name: head.product_name,
        unit_no: head.unit_no, need_date: head.need_date || null,
        item_id: r.item_id, std_code: r.std_code, item_name: r.item_name,
        maker: r.maker, maker_code: r.maker_code,
        qty: Number(r.qty), unit: r.unit, reason: r.reason,
      }))
      const { data, error } = await supabase.rpc('pm_request_create', { p_rows: payload })
      if (error) throw error
      toastSuccess(`${n(data)}건 요청 등록 — 구매자재팀에 전달됩니다`)
      setRows([emptyRow()])
      setHead({ urgency: '보통', purpose: '', product_code: '', product_name: '', unit_no: '', need_date: '', requester_name: '', check_dept: '', customer_code: '' })
      setTab('list')
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })
    } catch (e) {
      toastError('등록 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  // 처리 결과를 공통으로 안내한다
  function report(r, okWord) {
    const done = Number(r?.done ?? 0), failed = Number(r?.failed ?? 0)
    if (failed > 0) toastError(`${n(done)}건 ${okWord} · ${failed}건 실패 — ${r?.note || ''}`)
    else toastSuccess(`${n(done)}건 ${okWord}`)
    setSel({})
    qc.invalidateQueries({ queryKey: ['materialRequests'] })
    qc.invalidateQueries({ queryKey: ['todoList'] })
  }

  // 불출 — 재고에서 실제로 빼고 출고 이력을 남긴다.
  //   force 는 장부에 없어도 진행한다. 실물은 있는데 입고 처리가
  //   안 됐거나 실사가 안 맞는 경우가 있어 필요하다. 재고는 음수가 된다.
  async function doIssue(force = false) {
    if (!checked.length) return
    const msg = force
      ? `${checked.length}건을 강제 불출합니다.\n\n재고가 모자라도 진행하며, 재고가 음수가 됩니다.\n나중에 입고나 실사로 바로잡아야 합니다.\n\n계속할까요?`
      : `${checked.length}건을 불출 처리합니다.\n\n재고가 모자란 건은 처리되지 않고 사유가 표시됩니다.`
    if (!confirm(msg)) return
    try {
      const { data, error } = await supabase.rpc('pm_request_issue',
        { p_ids: checked.map(r => r.id), p_force: force })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      const forced = Number(r?.forced ?? 0)
      report(r, forced > 0 ? `불출 완료 (강제 ${forced}건)` : '불출 완료')
      qc.invalidateQueries({ queryKey: ['inventory'] })
    } catch (e) { toastError('불출 실패: ' + e.message) }
  }

  // 발주 — 해당 고객사 구매발주에 만든다
  async function doOrder() {
    if (!checked.length) return
    if (!confirm(`${checked.length}건을 구매발주로 생성합니다.\n\n업체·단가는 구매발주 화면에서 채워주세요.`)) return
    try {
      const { data, error } = await supabase.rpc('pm_request_to_po',
        { p_ids: checked.map(r => r.id) })
      if (error) throw error
      report(Array.isArray(data) ? data[0] : data, '발주 생성')
      qc.invalidateQueries({ queryKey: ['purchase'] })
    } catch (e) { toastError('발주 생성 실패: ' + e.message) }
  }

  // 부서 재배정 — 잘못 온 요청을 다른 팀으로 넘긴다.
  //   하네스팀 일인데 구매자재팀으로 오는 일이 잦다.
  //   이미 끝난 건(완료·반려)은 넘기지 않는다 — 이력이 꼬인다.
  function openReassign() {
    if (!checked.length) return
    const blocked = checked.filter(r => r.status === '완료' || r.status === '반려')
    if (blocked.length === checked.length) {
      toastError('이미 처리된 건은 부서를 바꿀 수 없습니다')
      return
    }
    // 넘길 수 있는 것만 남긴다
    const movable = checked.filter(r => r.status !== '완료' && r.status !== '반려')
    const to = movable[0].check_dept === '하네스팀' ? '구매자재팀' : '하네스팀'
    setReassign({
      dept: to, kind: to === '하네스팀' ? '제작' : '',
      cuts: Object.fromEntries(movable.map(r => [r.id, r.cut_mm ?? ''])),
      ids: movable.map(r => r.id),
      rows: movable,
      blocked: blocked.length,
    })
  }

  async function doReassign() {
    const rq = reassign
    if (!rq) return
    if (rq.dept === '하네스팀' && !rq.kind) { toastError('요청 종류를 선택하세요'); return }
    if (rq.dept === '하네스팀' && rq.kind === '절단'
        && rq.rows.some(r => !(Number(rq.cuts[r.id]) > 0))) {
      toastError('절단은 품목마다 길이(mm)를 입력하세요'); return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_request_reassign', {
        p_ids: rq.ids,
        p_dept: rq.dept,
        p_kind: rq.dept === '하네스팀' ? rq.kind : null,
        p_cuts: rq.dept === '하네스팀' && rq.kind === '절단'
          ? rq.rows.map(r => ({ id: r.id, mm: Number(rq.cuts[r.id]) || null }))
          : null,
      })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      const upd = Number(r?.updated ?? 0)
      const skip = Number(r?.skipped ?? 0)
      if (skip > 0) toastError(`${n(upd)}건 이동 · ${r?.note || `${skip}건 건너뜀`}`)
      else toastSuccess(`${n(upd)}건 → ${rq.dept}`)
      setReassign(null)
      setSel({})
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['requestHistory'], exact: false })
      qc.invalidateQueries({ queryKey: ['requestNotice'] })
      qc.invalidateQueries({ queryKey: ['menuAlerts'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })
    } catch (e) {
      toastError('부서 변경 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  // 이력 엑셀 — 화면에 보이는 그대로 뽑는다.
  //   예전에는 prompt 로 시작일만 묻고 바로 파일이 떨어져서
  //   무엇이 나올지 보고 뽑을 수가 없었다.
  const [xlBusy, setXlBusy] = useState(false)
  async function exportHistory() {
    if (!histRows.length) { toastError('내보낼 이력이 없습니다'); return }
    setXlBusy(true)
    try {
      const data = histRows

      const rows = data.map(r => ({
        '요청번호': r.req_no || '',
        '요청일': r.req_date || '',
        '상태': r.status || '',
        '긴급도': r.urgency || '',
        '확인부서': r.check_dept || '',
        '종류': r.req_kind || '',
        '길이(mm)': r.cut_mm ?? '',
        '고객사': r.customer_code || '',
        '요청자': r.requester || '',
        '사용목적': r.purpose || '',
        '대상제품': r.product_code || '',
        '호기': r.unit_no || '',
        '기준코드': r.std_code || '',
        '품명': r.item_name || '',
        '제조사': r.maker || '',
        '제조사품번': r.maker_code || '',
        '요청수량': Number(r.qty) || 0,
        '단위': r.unit || '',
        '필요일': r.need_date || '',
        '사유': r.reason || '',
        '처리자': r.handler || '',
        '처리유형': r.handle_type || '',
        '처리일시': r.handled_at ? String(r.handled_at).slice(0, 16).replace('T', ' ') : '',
        '불출수량': r.issued_qty ?? '',
        '처리메모': r.handle_memo || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      // 위 rows 의 열 순서와 개수가 정확히 같아야 한다 (25개)
      ws['!cols'] = [{ wch: 14 }, { wch: 11 }, { wch: 8 }, { wch: 7 }, { wch: 11 },
                     { wch: 7 }, { wch: 9 },
                     { wch: 9 }, { wch: 10 }, { wch: 30 }, { wch: 16 }, { wch: 10 },
                     { wch: 16 }, { wch: 32 }, { wch: 16 }, { wch: 18 },
                     { wch: 9 }, { wch: 6 }, { wch: 11 }, { wch: 20 },
                     { wch: 10 }, { wch: 9 }, { wch: 17 }, { wch: 9 }, { wch: 20 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '자재요청이력')
      XLSX.writeFile(wb, `자재요청이력_${new Date().toISOString().slice(0, 10)}.xlsx`)
      toastSuccess(`${n(rows.length)}건 내보냄`)
    } catch (e) {
      toastError('내보내기 실패: ' + e.message)
    } finally { setXlBusy(false) }
  }

  // 요청서 출력.
  //   선택한 요청을 종이로 뽑아 창고를 돌 때 쓴다.
  //   위치순으로 나오고 확인칸이 있어 꺼내면서 표시할 수 있다.
  async function printRequest() {
    if (!checked.length) { toastError('출력할 요청을 선택하세요'); return }
    try {
      const { data, error } = await supabase.rpc('pm_request_print',
        { p_ids: checked.map(r => r.id) })
      if (error) throw error
      if (!data?.length) { toastError('출력할 내용이 없습니다'); return }

      const h = data[0]
      const today = new Date().toLocaleDateString('ko-KR')
      const body = data.map((r, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="c mono b">${r.location || '<span class="no">미지정</span>'}</td>
        <td class="mono">${r.std_code || '-'}</td>
        <td>${r.item_name || ''}</td>
        <td>${r.maker || '-'}</td>
        <td class="mono">${r.maker_code || '-'}</td>
        <td class="c b">${Number(r.qty).toLocaleString('ko-KR')}</td>
        <td class="c">${r.unit || ''}</td>
        <td class="chk"></td>
      </tr>`).join('')

      // 요청 머리 — 여러 요청을 함께 뽑으면 요청번호를 모두 적는다
      const reqNos = [...new Set(data.map(r => r.req_no))].join(', ')
      const purposes = [...new Set(data.map(r => r.purpose).filter(Boolean))]
      const needs = [...new Set(data.map(r => r.need_date).filter(Boolean))].sort()

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>자재 요청서</title>
<style>
  *{font-family:'Malgun Gothic',sans-serif;box-sizing:border-box}
  body{padding:24px;color:#111}
  .head{display:flex;justify-content:space-between;align-items:flex-end;
        border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:6px}
  h1{font-size:20px;margin:0}
  .meta{font-size:12px;color:#555;text-align:right;line-height:1.6}
  .info{font-size:12px;margin:8px 0;line-height:1.7}
  .info b{display:inline-block;width:60px;color:#555}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
  th,td{border:1px solid #999;padding:5px 6px;text-align:left}
  th{background:#f0f0f0;font-size:11px}
  .c{text-align:center}.b{font-weight:bold}.mono{font-family:consolas,monospace}
  .chk{width:44px;text-align:center}
  .no{color:#b00;font-weight:normal;font-size:10px}
  .urgent{background:#c00;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px}
  .sign{display:flex;gap:40px;margin-top:24px;font-size:12px}
  .sign span{border-top:1px solid #999;padding-top:4px;width:120px;text-align:center}
  @page{size:A4;margin:12mm}
</style></head><body>
  <div class="head">
    <h1>자재 요청서${data.some(r => r.urgency === '긴급') ? ' <span class="urgent">긴급</span>' : ''}</h1>
    <div class="meta">
      요청번호 ${reqNos}<br>
      출력일 ${today}
    </div>
  </div>
  <div class="info">
    <b>요청자</b> ${h.requester || '-'}
    &nbsp;&nbsp;<b>확인부서</b> ${h.check_dept || '-'}
    ${h.customer_code ? `&nbsp;&nbsp;<b>고객사</b> ${h.customer_code}` : ''}<br>
    <b>필요일</b> ${needs.join(', ') || '-'}
    ${h.product_code ? `&nbsp;&nbsp;<b>대상</b> ${h.product_code} ${h.unit_no || ''}` : ''}<br>
    <b>목적</b> ${purposes.join(' / ') || '-'}
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:5%">No</th>
      <th class="c" style="width:11%">보관위치</th>
      <th style="width:15%">기준코드</th>
      <th style="width:27%">품명</th>
      <th style="width:13%">제조사</th>
      <th style="width:16%">제조사품번</th>
      <th class="c" style="width:6%">수량</th>
      <th class="c" style="width:5%">단위</th>
      <th class="chk">확인</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="sign"><span>요청</span><span>불출</span><span>확인</span></div>
</body></html>`

      const win = window.open('', '_blank')
      if (!win) { toastError('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }
      win.document.write(html); win.document.close()
      win.onload = () => { win.focus(); win.print() }
    } catch (e) {
      toastError('출력 실패: ' + e.message)
    }
  }

  // 코드 부여 — 품목을 만들고 요청에 연결한다
  async function assignCode() {
    const f = codeForm
    if (!f?.std_code?.trim()) { toastError('기준코드를 입력하세요'); return }
    try {
      const { data, error } = await supabase.rpc('pm_assign_code', {
        p_ids: f.ids, p_std_code: f.std_code.trim(),
        p_name: f.item_name, p_maker: f.maker, p_maker_code: f.maker_code,
        p_unit: f.unit || 'EA', p_dept: f.dept || null,
      })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      toastSuccess(r?.note || '코드 부여 완료')
      setCodeForm(null)
      qc.invalidateQueries({ queryKey: ['pendingCodes'] })
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })
    } catch (e) { toastError('실패: ' + e.message) }
  }

  // 코드 부여 요청.
  //   품명만 적힌 건은 기준코드가 없어 불출·발주가 되지 않는다.
  //   '등록 없이 완료' 를 허용하면 그쪽이 기본 경로가 되어 이력이 쌓이지 않으므로,
  //   코드를 부여받는 흐름으로만 처리한다.
  async function needCode() {
    if (!checked.length) return
    if (!confirm(`${checked.length}건에 기준코드 부여를 요청합니다.\n\n관제탑에 표시되며, 코드가 부여되면 다시 처리할 수 있습니다.`)) return
    try {
      const { data, error } = await supabase.rpc('pm_request_need_code',
        { p_ids: checked.map(r => r.id) })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      const done = Number(r?.done ?? 0), skip = Number(r?.skipped ?? 0)
      if (skip > 0) toastError(`${n(done)}건 요청 · ${r?.note || ''}`)
      else toastSuccess(`${n(done)}건 코드 부여 요청`)
      setSel({})
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })
      qc.invalidateQueries({ queryKey: ['pendingCodes'] })
    } catch (e) { toastError('실패: ' + e.message) }
  }

  // 반려 취소 — 잘못 반려한 건을 요청 상태로 되돌린다
  async function undoReject() {
    if (!checked.length) return
    if (!confirm(`${checked.length}건을 요청 상태로 되돌립니다.\n\n이미 불출·발주된 건은 되돌아가지 않습니다.`)) return
    try {
      const { data, error } = await supabase.rpc('pm_request_undo',
        { p_ids: checked.map(r => r.id) })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      const done = Number(r?.done ?? 0), skip = Number(r?.skipped ?? 0)
      if (skip > 0) toastError(`${n(done)}건 되돌림 · ${r?.note || ''}`)
      else toastSuccess(`${n(done)}건 요청 상태로 되돌림`)
      // 반려를 취소했으면 요청자에게 남긴 알림도 지운다.
      //   안 지우면 "반려됨" 이 계속 떠 있어 요청자가 헷갈린다.
      const { error: ne } = await supabase.rpc('pm_request_notice_seen',
        { p_ids: checked.map(r => r.id), p_clear: true })
      if (ne) toastError('알림 정리 실패: ' + ne.message)
      setSel({})
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['requestNotice'] })
      qc.invalidateQueries({ queryKey: ['menuAlerts'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })
    } catch (e) { toastError('되돌리기 실패: ' + e.message) }
  }

  // 요청자 본인 취소
  async function cancelMine(id) {
    if (!confirm('이 요청을 취소할까요?')) return
    try {
      const { data, error } = await supabase.rpc('pm_request_cancel', { p_id: id })
      if (error) throw error
      if (data === 'ok') {
        toastSuccess('요청이 취소되었습니다')
        qc.invalidateQueries({ queryKey: ['materialRequests'] })
        qc.invalidateQueries({ queryKey: ['todoList'] })
      } else toastError(data)
    } catch (e) { toastError('취소 실패: ' + e.message) }
  }

  async function changeStatus(status, type) {
    if (!checked.length) return
    const memo = (status === '반려' || type)
      ? prompt(status === '반려' ? '반려 사유' : `${type} 처리 메모 (선택)`) : null
    if (status === '반려' && memo === null) return
    try {
      const { data, error } = await supabase.rpc('pm_request_update', {
        p_ids: checked.map(r => r.id), p_status: status,
        p_type: type || null, p_memo: memo || null, p_force: false,
      })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      const upd = Number(r?.updated ?? r ?? 0)
      const skip = Number(r?.skipped ?? 0)
      if (skip > 0) {
        // 다른 담당자가 먼저 처리한 건이 있으면 알린다
        toastError(`${n(upd)}건 처리 · ${r?.skipped_note || `${skip}건은 이미 처리되어 건너뜀`}`)
      } else {
        toastSuccess(`${n(upd)}건 → ${status}`)
      }
      setSel({})
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['requestNotice'] })
      qc.invalidateQueries({ queryKey: ['menuAlerts'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })   // 관제탑 건수도 함께 갱신
    } catch (e) {
      toastError('실패: ' + e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🙋 자재 요청</h1>
          <p className="text-xs text-slate-400">
            {canEdit
              ? '요청을 확인하고 불출 또는 발주로 처리합니다. 행을 눌러 여러 건을 함께 처리할 수 있습니다.'
              : '필요한 자재를 요청하면 구매자재팀에 전달됩니다. 처리 상황은 이 목록에서 확인할 수 있습니다.'}
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[['list', '📋 요청 목록'],
            ...(canReq ? [['new', '＋ 새 요청']] : []),
            ['hist', '📊 이력'],
            ...(canEdit && pendingCodes.length ? [['code', `🏷 코드 부여 ${pendingCodes.length}`]] : []),
           ].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg ${tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ───────── 새 요청 ───────── */}
      {/* ───────── 내 요청 알림 ─────────
          반려하거나 부서를 넘겨도 요청자는 몰랐다.
          누가·언제·왜 까지 보여 주고, 확인하면 사라진다. */}
      {notices.length > 0 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-rose-800">
              ⊗ 내 요청 중 확인할 것이 {n(notices.length)}건 있습니다
            </p>
            {notices.length > 1 && (
              <button onClick={() => seenNotice(notices.map(r => r.id))}
                className="ml-auto px-2.5 py-1 text-xs font-bold rounded-lg border border-rose-300 text-rose-700 bg-white hover:bg-rose-100">
                모두 확인했습니다
              </button>
            )}
          </div>
          {notices.map(r => (
            <div key={r.id} className="rounded-lg bg-white border border-rose-200 px-3.5 py-2.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800">
                  <span className="font-mono text-slate-500">{r.req_no}</span>
                  {' · '}{r.item_name || r.std_code || '(품명 없음)'}
                </p>
                <p className="text-sm font-bold text-rose-700 mt-0.5 break-words">
                  {r.notice_msg || ''}
                  {r.req_kind === '절단' && r.cut_mm ? ` (${n(r.cut_mm)}mm)` : ''}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {r.notice_by || '처리자 미상'}
                  {r.notice_at ? ` · ${String(r.notice_at).slice(0, 16).replace('T', ' ')}` : ''}
                </p>
              </div>
              <button onClick={() => seenNotice([r.id])}
                className="shrink-0 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-rose-300 text-rose-700 bg-white hover:bg-rose-100">
                확인했습니다
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'new' && (
        <div className="space-y-3">
          {/* 사용법 — 처음 쓰는 사람이 무엇을 적어야 할지 바로 알게 한다 */}
          <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
            <p className="text-sm font-bold text-indigo-800 mb-2">📝 이렇게 적어주세요</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-white p-3">
                <p className="text-[11px] font-bold text-slate-400 mb-1">낱개 부품이 필요할 때</p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  <b className="text-slate-800">목적</b> LEB PD 조립 중 케이블 파손<br />
                  <b className="text-slate-800">품목</b> 🔍 로 찾기 · <b>AX-5101788</b> 2EA<br />
                  <b className="text-slate-800">사유</b> 기존품 단선
                </p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-[11px] font-bold text-slate-400 mb-1">ASSY 자재 일체가 필요할 때</p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  <b className="text-indigo-700">🧬 ASSY 로 불러오기</b> 를 누르고<br />
                  ASSY 번호 → <b>전장</b> 또는 <b>하네스</b> 선택<br />
                  부품을 하나씩 고를 필요 없습니다
                </p>
              </div>
            </div>
            <p className="text-[11px] text-indigo-600 mt-2">
              품목을 못 찾아도 괜찮습니다 — 품명만 적어 요청할 수 있습니다.
              등록하면 구매자재팀에 바로 전달됩니다.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-500">① 누가 · 어느 부서</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">요청자 *</label>
                <input value={head.requester_name}
                  onChange={e => setHead(h => ({ ...h, requester_name: e.target.value }))}
                  placeholder="이름"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">확인부서 *</label>
                <div className="flex gap-1">
                  {['하네스팀', '구매자재팀'].map(d => (
                    <button key={d} onClick={() => setHead(h => ({ ...h, check_dept: d }))}
                      className={`flex-1 px-2 py-2 text-xs font-bold rounded-lg border whitespace-nowrap ${
                        head.check_dept === d
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-white text-slate-500'}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              {/* 하네스팀은 만들어 달라는 것과 잘라 달라는 것이 다르다 */}
              {head.check_dept === '하네스팀' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">요청 종류 *</label>
                  <div className="flex gap-1">
                    {[['제작', '만들어 주세요'], ['절단', '잘라만 주세요']].map(([k, t]) => (
                      <button key={k} onClick={() => setHead(h => ({ ...h, req_kind: k }))}
                        title={t}
                        className={`flex-1 px-2 py-2 text-xs font-bold rounded-lg border whitespace-nowrap ${
                          head.req_kind === k
                            ? 'border-indigo-500 bg-indigo-600 text-white'
                            : 'border-slate-200 bg-white text-slate-500'}`}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">고객사</label>
                <select value={head.customer_code}
                  onChange={e => setHead(h => ({ ...h, customer_code: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                  <option value="">자동 판별</option>
                  <option value="AX">AXCELIS</option>
                  <option value="ED">Edwards</option>
                  <option value="VM">VM</option>
                  <option value="CSK">CSK</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-500">② 무엇을 만들기 위해</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">사용 목적 · 작업 내용 *</label>
                <input value={head.purpose} onChange={e => setHead(h => ({ ...h, purpose: e.target.value }))}
                  placeholder="예: LEB PD 조립 중 케이블 파손 교체"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">대상 제품 (선택)</label>
                <input value={head.product_code} onChange={e => setHead(h => ({ ...h, product_code: e.target.value }))}
                  placeholder="예: AX-110214084"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">호기 · 프로젝트 (선택)</label>
                <input value={head.unit_no} onChange={e => setHead(h => ({ ...h, unit_no: e.target.value }))}
                  placeholder="예: 45391KF 3호기"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">필요일</label>
                  <input type="date" value={head.need_date} min={today()}
                    onChange={e => setHead(h => ({ ...h, need_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">긴급도</label>
                  <div className="flex gap-1">
                    {['보통', '긴급'].map(u => (
                      <button key={u} onClick={() => setHead(h => ({ ...h, urgency: u }))}
                        className={`px-3 py-2 text-xs font-bold rounded-lg border ${head.urgency === u
                          ? (u === '긴급' ? 'border-rose-400 bg-rose-500 text-white' : 'border-slate-400 bg-slate-700 text-white')
                          : 'border-slate-200 bg-white text-slate-500'}`}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 품목 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-bold text-slate-500">③ 무엇이 얼마나</p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setAssyOpen(true)}
                  title="ASSY 번호로 그 BOM 부품을 한꺼번에 가져옵니다"
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
                  🧬 ASSY 로 불러오기
                </button>
                <button onClick={() => setRows(v => [...v, emptyRow()])}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  ＋ 품목 추가
                </button>
              </div>
            </div>

            {assy && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold text-indigo-700">{assy.code}</span>
                <span className="text-xs text-slate-600">{assy.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-white text-[11px] font-bold text-indigo-600">
                  {mkType === 'harness' ? '하네스' : '전장'} · {assyQty}대분
                </span>
                <button onClick={() => { setAssy(null); setRows([emptyRow()]) }}
                  className="ml-auto text-[11px] text-slate-400 hover:text-slate-600">해제</button>
              </div>
            )}

            {rows.map((r, i) => (
              <div key={r.key} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {r._assy ? (
                      <>
                        <p className="font-mono text-sm font-bold text-indigo-600">{r.std_code}</p>
                        <p className="text-xs font-bold text-slate-700">{r.item_name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          부품 {n(r._parts)}종

                        </p>

                      </>
                    ) : r.std_code ? (
                      <>
                        <p className="font-mono text-sm font-bold text-indigo-600">{r.std_code}</p>
                        <p className="text-xs text-slate-600">{r.item_name}</p>
                        <p className="text-[11px] text-slate-400">
                          {r.maker}{r.maker && r.maker_code ? ' · ' : ''}
                          <span className="font-mono">{r.maker_code}</span>

                        </p>
                      </>
                    ) : (
                      <button onClick={() => { setSearchIdx(i); setQ(''); setHits([]) }}
                        className="w-full px-3 py-2 text-sm text-left border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-indigo-400 hover:text-indigo-500">
                        🔍 품목 찾기 — 품번·품명·제조사품번
                      </button>
                    )}
                  </div>
                  {/* 절단은 길이를 함께 적어야 한다 */}
                  {head.check_dept === '하네스팀' && head.req_kind === '절단' && (
                    <div className="flex items-center gap-1">
                      <input type="number" inputMode="decimal" value={r.cut_mm || ''}
                        onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, cut_mm: e.target.value } : x))}
                        placeholder="길이"
                        className="w-20 px-2 py-2 text-sm text-right font-bold border border-amber-300 bg-amber-50 rounded-lg" />
                      <span className="text-[11px] text-slate-400">mm</span>
                    </div>
                  )}
                  <input type="number" inputMode="decimal" value={r.qty}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))}
                    placeholder="수량"
                    className="w-24 px-2 py-2 text-sm text-right font-bold border border-slate-200 rounded-lg" />
                  <span className="text-xs text-slate-400 pt-2.5 w-8">{r.unit}</span>
                  {rows.length > 1 && (
                    <button onClick={() => setRows(v => v.filter((_, k) => k !== i))}
                      className="text-slate-300 hover:text-rose-500 px-1 pt-2">✕</button>
                  )}
                </div>
                <input value={r.reason}
                  onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, reason: e.target.value } : x))}
                  placeholder="필요 사유 (선택) — 예: 기존품 단선"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />

                {r.std_code && (
                  <button onClick={() => { setRows(v => v.map((x, k) => k === i ? { ...emptyRow(), key: x.key } : x)); if (r._assy) setAssy(null) }}
                    className="text-[11px] text-slate-400 hover:text-slate-600">
                    {r._assy ? 'ASSY 해제' : '품목 다시 고르기'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <button onClick={submit} disabled={busy}
            className="w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '등록 중…' : '요청 등록'}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            등록하면 구매자재팀 관제탑에 알림으로 표시됩니다.
          </p>
        </div>
      )}

      {/* ───────── ASSY 선택 ───────── */}
      {assyOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setAssyOpen(false)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-slate-800">ASSY 로 불러오기</h3>
              <button onClick={() => setAssyOpen(false)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              ASSY 번호를 고르면 그 BOM 부품을 제작구분별로 한꺼번에 가져옵니다.
            </p>

            {!assy ? (
              <>
                <input value={assyQ} onChange={e => searchAssy(e.target.value)} autoFocus
                  placeholder="ASSY 번호 · 품명 (2자 이상)"
                  className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />
                <div className="mt-2 space-y-1">
                  {assyHits.map(a => (
                    <button key={a.code} onClick={() => setAssy(a)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50">
                      <p className="font-mono text-sm font-bold text-indigo-600">
                        {a.code}
                        {a.rev && <span className="ml-1.5 text-[11px] text-slate-400">Rev {a.rev}</span>}
                      </p>
                      <p className="text-xs text-slate-600">{a.name}</p>
                      <p className="text-[11px] text-slate-400">부품 {n(a.part_count)}종</p>
                    </button>
                  ))}
                  {assyQ.trim().length >= 2 && !assyHits.length && (
                    <p className="text-xs text-slate-400 text-center py-6">BOM 이 등록된 ASSY 가 없습니다.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <p className="font-mono text-sm font-bold text-indigo-700">{assy.code}</p>
                  <p className="text-xs text-slate-600">{assy.name}</p>
                  <p className="text-[11px] text-slate-400">부품 {n(assy.part_count)}종</p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">제작 구분</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[['normal', '⚡ 전장'], ['harness', '🔌 하네스']].map(([v, l]) => (
                      <button key={v} onClick={() => setMkType(v)}
                        className={`py-2.5 text-sm font-bold rounded-lg border-2 ${mkType === v
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    출고 화면에서 지정한 제작구분을 따릅니다. 불출 미대상은 제외됩니다.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">ASSY 수량</label>
                  <input type="number" min="1" value={assyQty}
                    onChange={e => setAssyQty(e.target.value)}
                    className="w-full px-3 py-2.5 text-lg font-bold text-right border-2 border-slate-200 rounded-lg" />
                  <p className="text-[11px] text-slate-400 mt-1">소요량 × 이 수량으로 계산됩니다</p>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setAssy(null); setAssyQ(''); setAssyHits([]) }}
                    className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
                    다시 찾기
                  </button>
                  <button onClick={async () => { await loadAssyParts(assy, mkType, assyQty); setAssyOpen(false) }}
                    disabled={busy}
                    className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                    {busy ? '불러오는 중…' : '부품 불러오기'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────── 품목 검색 ───────── */}
      {searchIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setSearchIdx(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-slate-800">품목 찾기</h3>
              <button onClick={() => setSearchIdx(null)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <input value={q} onChange={e => doSearch(e.target.value)} autoFocus
              placeholder="품번 · 품명 · 제조사 · 제조사품번 (2자 이상)"
              className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />
            <div className="mt-2 space-y-1">
              {hits.map(h => {
                return (
                  <button key={h.id} onClick={() => pickItem(h)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50">
                    <p className="font-mono text-sm font-bold text-indigo-600">{h.std_code}</p>
                    <p className="text-xs text-slate-600">{h.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {h.manufacturer}{h.manufacturer && h.manufacturer_code ? ' · ' : ''}
                      <span className="font-mono">{h.manufacturer_code}</span>

                    </p>
                  </button>
                )
              })}
              {q.trim().length >= 2 && !hits.length && (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-400 mb-2">찾는 품목이 없습니다.</p>
                  <button onClick={() => {
                      setRows(v => v.map((x, k) => k === searchIdx ? { ...x, item_name: q.trim(), std_code: '' } : x))
                      setSearchIdx(null); setQ(''); setHits([])
                    }}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50">
                    "{q.trim()}" 그대로 요청하기
                  </button>
                  <p className="text-[11px] text-slate-400 mt-1.5">등록되지 않은 품목도 요청할 수 있습니다</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ───────── 목록 ───────── */}
      {/* ───────── 코드 부여 ───────── */}
      {tab === 'code' && canEdit && (
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-orange-200 bg-orange-50 p-4">
            <p className="text-sm font-bold text-orange-800 mb-1">🏷 기준코드가 없는 요청</p>
            <p className="text-xs text-orange-700 leading-relaxed">
              품명만 적혀 온 요청입니다. 코드를 부여해야 불출·발주를 진행할 수 있습니다.<br />
              같은 품명끼리 묶여 있어 한 번 부여하면 관련 요청이 모두 연결됩니다.
            </p>
          </div>

          {pendingCodes.map((p2, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{p2.item_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {p2.maker}
                    {p2.maker && p2.maker_code ? ' · ' : ''}
                    <span className="font-mono">{p2.maker_code}</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    요청 {n(p2.req_count)}건 · 합계 {n(p2.total_qty)}{p2.unit || ''}
                    {' · '}{p2.req_nos}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    최초 {p2.first_req} · 요청자 {p2.requesters}
                  </p>
                </div>
                <button onClick={() => setCodeForm({
                    ids: p2.ids, item_name: p2.item_name, maker: p2.maker || '',
                    maker_code: p2.maker_code || '', unit: p2.unit || 'EA',
                    std_code: '', dept: '',
                  })}
                  className="px-3 py-2 text-xs font-bold rounded-lg bg-orange-600 text-white hover:bg-orange-700 whitespace-nowrap">
                  코드 부여
                </button>
              </div>
            </div>
          ))}

          {!pendingCodes.length && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <p className="text-2xl mb-1">✓</p>
              <p className="text-sm text-slate-400">코드 부여를 기다리는 요청이 없습니다.</p>
            </div>
          )}
        </div>
      )}

      {/* 코드 입력 */}
      {codeForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setCodeForm(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">기준코드 부여</h3>
              <button onClick={() => setCodeForm(null)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <p className="text-xs text-slate-500">
              요청 {n(codeForm.ids.length)}건에 연결됩니다. 이미 있는 코드를 넣으면 그 품목에 연결만 합니다.
            </p>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">기준코드 *</label>
              <input value={codeForm.std_code} autoFocus
                onChange={e => setCodeForm(f => ({ ...f, std_code: e.target.value.toUpperCase() }))}
                placeholder="예: AX-5101788"
                className="w-full px-3 py-2.5 text-sm font-mono border-2 border-slate-200 rounded-lg focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">품명</label>
              <input value={codeForm.item_name}
                onChange={e => setCodeForm(f => ({ ...f, item_name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">제조사</label>
                <input value={codeForm.maker}
                  onChange={e => setCodeForm(f => ({ ...f, maker: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">제조사품번</label>
                <input value={codeForm.maker_code}
                  onChange={e => setCodeForm(f => ({ ...f, maker_code: e.target.value }))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">단위</label>
                <input value={codeForm.unit}
                  onChange={e => setCodeForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">관리부서</label>
                <select value={codeForm.dept}
                  onChange={e => setCodeForm(f => ({ ...f, dept: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                  <option value="">미지정</option>
                  <option value="지원본부">지원본부</option>
                  <option value="하네스">하네스</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setCodeForm(null)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
                취소
              </button>
              <button onClick={assignCode}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-orange-600 text-white hover:bg-orange-700">
                부여하고 연결
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {[[null, '진행 중'], ['완료', '완료'], ['반려', '반려'], ['전체', '전체']].map(([f, l]) => (
                <button key={l} onClick={() => { setFilter(f); setSel({}) }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => { setMine(v => !v); setSel({}) }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${mine
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              🙋 내 요청만
            </button>

            {/* 확인부서 */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {[[null, '전부서'], ['하네스팀', '하네스'], ['구매자재팀', '구매자재']].map(([d, l]) => (
                <button key={l} onClick={() => { setDeptFilter(d); setSel({}) }}
                  className={`px-2.5 py-1.5 text-xs font-bold rounded-md whitespace-nowrap ${
                    deptFilter === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {l}
                </button>
              ))}
            </div>

            <button onClick={() => setTab('hist')}
              title="지난 요청을 기간·검색으로 찾고 엑셀로 내려받습니다"
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 whitespace-nowrap">
              📊 이력 보기
            </button>
            <span className="text-xs text-slate-400">{n(list.length)}건</span>

            {checked.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <span className="text-xs font-bold text-indigo-600">{checked.length}건 선택</span>
                {/* 출력은 요청자도 쓴다 — 자기 요청을 뽑아 창고에 가져가야 하기 때문 */}
                <button onClick={printRequest}
                  title="선택한 요청을 출력합니다 — 보관 위치순으로 나오고 확인칸이 있습니다"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white">
                  🖨 출력
                </button>
                {canEdit && (<>
                <button onClick={openReassign}
                  title="우리 팀 일이 아닌 요청을 다른 팀으로 넘깁니다"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-violet-300 text-violet-700 bg-violet-50">
                  🔀 부서 변경
                </button>
                <button onClick={() => changeStatus('확인')}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-sky-300 text-sky-700 bg-sky-50">확인</button>
                <button onClick={() => doIssue(false)}
                  title="재고에서 실제로 차감하고 출고 이력을 남깁니다"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">불출 처리</button>
                <button onClick={() => doIssue(true)}
                  title="장부에 재고가 없어도 진행합니다 — 실물은 있는데 입고 처리가 안 된 경우"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-rose-300 text-rose-700 bg-rose-50">강제 불출</button>
                <button onClick={doOrder}
                  title="해당 고객사 구매발주에 실제로 생성합니다"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50">발주 생성</button>
                {checked.some(r => !r.item_id) && (
                  <button onClick={needCode}
                    title="기준코드가 없어 처리할 수 없는 건입니다. 코드 부여를 요청합니다"
                    className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-orange-400 text-orange-700 bg-orange-50">
                    🏷 코드 부여 요청
                  </button>
                )}
                <button onClick={() => changeStatus('반려')}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">반려</button>
                {checked.some(r => r.status === '반려') && (
                  <button onClick={undoReject}
                    title="반려를 취소하고 요청 상태로 되돌립니다"
                    className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50">
                    ↩ 반려 취소
                  </button>
                )}
                </>)}
              </div>
            )}
          </div>

          {isLoading && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}
          {!isLoading && !list.length && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <p className="text-3xl mb-2">🙋</p>
              <p className="text-sm font-bold text-slate-600">요청이 없습니다</p>
              {canReq && (
                <>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    필요한 자재가 있으면 요청해 주세요.<br />
                    구매자재팀이 재고를 확인해 불출하거나 발주합니다.
                  </p>
                  <button onClick={() => setTab('new')}
                    className="mt-4 px-5 py-2.5 text-sm font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                    ＋ 자재 요청하기
                  </button>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            {(() => {
              // 같은 요청번호끼리 묶는다. 한 번에 여러 품목을 요청하면
              // 낱개로 흩어져 보여 어느 요청인지 알기 어렵기 때문이다.
              const groups = []
              list.forEach(r => {
                const key = r.req_no || `_${r.id}`
                let g = groups.find(x => x.key === key)
                if (!g) { g = { key, head: r, items: [] }; groups.push(g) }
                g.items.push(r)
              })

              return groups.map(g => {
                const h = g.head
                const st = ST[h.status] || ST['요청']
                const d = dday(h.need_date)
                const allOn = g.items.every(x => sel[x.id])
                const someOn = g.items.some(x => sel[x.id])

                return (
                  <div key={g.key}
                    className={`rounded-xl border transition-all ${
                      someOn ? 'border-indigo-400 bg-indigo-50/40 ring-1 ring-indigo-200'
                             : 'border-slate-200 bg-white hover:shadow-sm'}`}>

                    {/* 요청 머리 — 목적·필요일·요청자 */}
                    <div
                      onClick={() => setSel(s2 => {
                        const next = { ...s2 }
                        g.items.forEach(x => { next[x.id] = !allOn })
                        return next
                      })}
                      className={`p-3.5 cursor-pointer ${g.items.length > 1 ? 'border-b border-slate-100' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${st.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls}`}>{h.status}</span>
                            {h.urgency === '긴급' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white">긴급</span>
                            )}
                            <span className="font-mono text-[11px] text-slate-400">{h.req_no}</span>
                            {g.items.length > 1 && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-[10px] font-bold text-indigo-700">
                                {n(g.items.length)}품목
                              </span>
                            )}
                            {h.is_mine && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">내 요청</span>
                            )}
                            {h.customer_code && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">{h.customer_code}</span>
                            )}
                            {h.check_dept && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                h.check_dept.includes('하네스') ? 'bg-violet-100 text-violet-700' : 'bg-teal-100 text-teal-700'}`}>
                                {h.check_dept}
                              </span>
                            )}
                            {/* 만들어 달라는 건지 잘라만 달라는 건지 */}
                            {h.req_kind && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                h.req_kind === '절단' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                {h.req_kind}{h.req_kind === '절단' && h.cut_mm ? ` ${Number(h.cut_mm).toLocaleString('ko-KR')}mm` : ''}
                              </span>
                            )}
                            {d !== null && (
                              <span className={`text-[11px] font-bold ${d < 0 ? 'text-rose-600' : d <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                                필요일 {h.need_date} (D{d >= 0 ? '-' : '+'}{Math.abs(d)})
                              </span>
                            )}
                          </div>

                          <p className="text-sm font-bold text-slate-800 mt-1">{h.purpose}</p>
                          {(h.product_code || h.unit_no) && (
                            <p className="text-[11px] text-slate-400">
                              {h.product_code && <span className="font-mono">{h.product_code}</span>}
                              {h.product_code && h.unit_no ? ' · ' : ''}{h.unit_no}
                            </p>
                          )}

                          <div className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-500">요청 {h.requester}</span>
                            <span>{h.req_date}</span>
                            {h.handler && (
                              <>
                                <span className="text-slate-300">→</span>
                                <span className="font-semibold text-slate-500">처리 {h.handler}</span>
                                {h.handle_type && (
                                  <span className={`px-1.5 py-0.5 rounded font-bold ${
                                    h.handle_type === '불출' ? 'bg-emerald-100 text-emerald-700'
                                    : h.handle_type === '발주' ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-slate-100 text-slate-500'}`}>{h.handle_type}</span>
                                )}
                              </>
                            )}
                            {h.handle_memo && <span className="text-slate-400">· {h.handle_memo}</span>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <input type="checkbox" checked={allOn} readOnly
                            className="w-4 h-4 accent-indigo-600 mt-1 pointer-events-none" />
                          {h.is_mine && ['요청','확인'].includes(h.status) && (
                            <button onClick={e => { e.stopPropagation(); cancelMine(h.id) }}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-500 whitespace-nowrap">
                              취소
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 품목 — 한 줄씩 */}
                    <div className={g.items.length > 1 ? 'divide-y divide-slate-50' : ''}>
                      {g.items.map(r => (
                        <div key={r.id}
                          onClick={() => setSel(s2 => ({ ...s2, [r.id]: !s2[r.id] }))}
                          className={`px-3.5 py-2 flex items-center gap-2 text-xs cursor-pointer ${
                            sel[r.id] ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
                          <input type="checkbox" checked={!!sel[r.id]} readOnly
                            className="w-3.5 h-3.5 accent-indigo-600 pointer-events-none flex-shrink-0" />
                          <span className="font-mono font-bold text-indigo-600 w-32 flex-shrink-0 truncate">
                            {r.std_code || '-'}
                          </span>
                          <span className="text-slate-600 flex-1 min-w-0 truncate">{r.item_name}</span>
                          <span className="text-slate-400 w-24 flex-shrink-0 truncate text-right">{r.maker || ''}</span>
                          <span className="font-mono text-slate-400 w-28 flex-shrink-0 truncate text-right">{r.maker_code || ''}</span>
                          <span className="font-bold text-slate-700 w-16 flex-shrink-0 text-right">
                            {n(r.qty)}<span className="font-normal text-slate-400 ml-0.5">{r.unit}</span>
                          </span>
                          {/* 재고는 담당자만 본다. 불출할지 발주할지 판단하는 근거다. */}
                          {canSeeStock && r.item_id && (
                            <span className={`w-24 flex-shrink-0 text-right text-[11px] font-semibold ${
                              Number(r.stock_qty) >= Number(r.qty) ? 'text-emerald-600' : 'text-rose-500'}`}>
                              재고 {n(r.stock_qty)}
                              {Number(r.po_pending) > 0 && (
                                <span className="text-sky-600 ml-1">＋{n(r.po_pending)}</span>
                              )}
                            </span>
                          )}
                          {r.status !== h.status && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${(ST[r.status] || ST['요청']).cls}`}>
                              {r.status}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {g.items.some(r => !r.item_id && r.unit === '대분') && (
                      <p className="px-3.5 pb-2.5 text-[11px] text-indigo-500 font-semibold">
                        🧬 ASSY 자재 일체 — BOM 을 보고 불출해 주세요
                      </p>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        </>
      )}

      {/* ───────── 이력 ───────── */}
      {tab === 'hist' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <p className="text-xs font-bold text-slate-500">기간 · 조건</p>

            {/* 달을 바로 고를 수 있게 — 대부분 "지난달 얼마나 나갔나" 를 본다 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-slate-400">빠른 선택</span>
              {[['이번 달', 0], ['지난달', 1], ['2달 전', 2]].map(([l, back]) => (
                <button key={l}
                  onClick={() => {
                    const d = new Date()
                    const s = new Date(d.getFullYear(), d.getMonth() - back, 1)
                    const e = new Date(d.getFullYear(), d.getMonth() - back + 1, 0)
                    const p = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
                    setHFrom(p(s)); setHTo(p(e))
                  }}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                  {l}
                </button>
              ))}
              <button
                onClick={() => {
                  const d = new Date()
                  setHFrom(`${d.getFullYear()}-01-01`); setHTo(today())
                }}
                className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                올해 전체
              </button>
            </div>

            <div className="grid sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">시작일</label>
                <input type="date" value={hFrom} onChange={e => setHFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">종료일</label>
                <input type="date" value={hTo} onChange={e => setHTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">확인부서</label>
                <select value={hDept || ''} onChange={e => setHDept(e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                  <option value="">전체</option>
                  <option value="구매자재팀">구매자재팀</option>
                  <option value="하네스팀">하네스팀</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">상태</label>
                <select value={hStatus || ''} onChange={e => setHStatus(e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                  <option value="">전체</option>
                  {['요청', '확인', '처리중', '완료', '반려'].map(s =>
                    <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">검색</label>
              <input value={hQ} onChange={e => setHQ(e.target.value)}
                placeholder="품번 · 품명 · 제조사 · 요청자 · 사용목적 · 요청번호"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              <p className="text-[11px] text-slate-400 mt-1">
                기간·부서만 조회로 가져오고, 상태와 검색어는 화면에서 걸러 냅니다 — 타이핑할 때마다 조회하지 않습니다.
              </p>
            </div>
          </div>

          {/* 월별 요약 */}
          {!hBusy && histMonths.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {histMonths.map(m => (
                <div key={m.ym} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
                  <p className="text-xs font-bold text-slate-700">{m.ym}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    총 <b className="text-slate-800">{n(m.cnt)}</b>건
                    {' · '}<span className="text-emerald-600">완료 {n(m.done)}</span>
                    {m.open > 0 && <>{' · '}<span className="text-amber-600">진행 {n(m.open)}</span></>}
                    {m.rej > 0 && <>{' · '}<span className="text-slate-400">반려 {n(m.rej)}</span></>}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-bold">{n(histRows.length)}건</span>
            {hist.length !== histRows.length && (
              <span className="text-xs text-slate-400">(조회 {n(hist.length)}건 중)</span>
            )}
            <button onClick={exportHistory} disabled={xlBusy || !histRows.length}
              title="지금 화면에 보이는 그대로 내려받습니다"
              className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 whitespace-nowrap">
              {xlBusy ? '…' : '📥 엑셀'}
            </button>
          </div>

          {hBusy && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}
          {!hBusy && !histRows.length && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <p className="text-3xl mb-2">📊</p>
              <p className="text-sm font-bold text-slate-600">해당 조건에 요청이 없습니다</p>
              <p className="text-xs text-slate-400 mt-1">기간을 넓혀 보세요.</p>
            </div>
          )}
          {!hBusy && histRows.length > 0 && (
            <ResizableTable cols={HIST_COLS} storageKey="mreq_hist_cols">
              {() => (
                <tbody>
                  {histRows.map((r, i) => (
                    <tr key={`${r.req_no}-${r.std_code}-${i}`}
                      className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{r.req_date || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden font-mono text-slate-600">{r.req_no || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                        <span className={`px-1.5 py-0.5 rounded border text-[11px] font-bold ${ST[r.status]?.cls || 'border-slate-200 text-slate-500'}`}>
                          {r.status || ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                        {r.check_dept && (
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                            String(r.check_dept).includes('하네스') ? 'bg-violet-100 text-violet-700' : 'bg-teal-100 text-teal-700'}`}>
                            {r.check_dept}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-600">
                        {r.req_kind
                          ? (r.req_kind === '절단' && r.cut_mm ? `절단 ${n(r.cut_mm)}mm` : r.req_kind)
                          : ''}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden uppercase text-slate-500">{r.customer_code || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-600">{r.requester || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-600">{r.purpose || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{r.unit_no || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden font-mono text-slate-700">{r.std_code || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-700">{r.item_name || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{r.maker || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right font-bold text-slate-800">{n(r.qty)}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-emerald-700">{r.issued_qty == null ? '' : n(r.issued_qty)}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-400">{r.unit || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{r.need_date || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-600">{r.handler || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{r.handle_type || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-400">
                        {r.handled_at ? String(r.handled_at).slice(0, 16).replace('T', ' ') : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </ResizableTable>
          )}
        </div>
      )}

      {/* ───────── 부서 변경 ───────── */}
      {reassign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setReassign(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">🔀 부서 변경</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {n(reassign.ids.length)}건을 다른 팀으로 넘깁니다.
              </p>
              {reassign.blocked > 0 && (
                <p className="text-xs text-amber-600 mt-1 font-semibold">
                  ⚠️ 이미 처리된 {n(reassign.blocked)}건은 빠졌습니다 — 완료·반려는 넘길 수 없습니다.
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">어느 팀으로 *</label>
              <div className="flex gap-1">
                {['하네스팀', '구매자재팀'].map(d => (
                  <button key={d}
                    onClick={() => setReassign(v => ({
                      ...v, dept: d, kind: d === '하네스팀' ? (v.kind || '제작') : '',
                    }))}
                    className={`flex-1 px-2 py-2 text-xs font-bold rounded-lg border ${
                      reassign.dept === d
                        ? 'border-indigo-500 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-500'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {reassign.dept === '하네스팀' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">요청 종류 *</label>
                <div className="flex gap-1">
                  {[['제작', '만들어 주세요'], ['절단', '잘라만 주세요']].map(([k, t]) => (
                    <button key={k} title={t}
                      onClick={() => setReassign(v => ({ ...v, kind: k }))}
                      className={`flex-1 px-2 py-2 text-xs font-bold rounded-lg border ${
                        reassign.kind === k
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-white text-slate-500'}`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {reassign.dept === '구매자재팀' && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
                구매자재팀으로 넘기면 요청 종류(제작·절단)와 길이는 지워집니다.
              </p>
            )}

            {/* 절단은 품목마다 길이가 다르다 */}
            {reassign.dept === '하네스팀' && reassign.kind === '절단' && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-slate-500">품목별 길이(mm) *</p>
                {reassign.rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{r.item_name || r.std_code || '(품명 없음)'}</p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">{r.std_code || '-'} · {n(r.qty)}{r.unit || ''}</p>
                    </div>
                    <input type="number" min="1" value={reassign.cuts[r.id] ?? ''}
                      onChange={e => setReassign(v => ({ ...v, cuts: { ...v.cuts, [r.id]: e.target.value } }))}
                      placeholder="mm"
                      className="w-24 px-2 py-1.5 text-sm border border-slate-200 rounded-lg text-right" />
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setReassign(null)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
                취소
              </button>
              <button onClick={doReassign} disabled={busy}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {busy ? '처리 중…' : `${n(reassign.ids.length)}건 → ${reassign.dept}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
