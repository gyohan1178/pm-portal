import { useState, useEffect } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Stepper } from '../../components/ux/Stepper'
import Spin from '../../components/ux/Spin'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { downloadCsvTemplate, TEMPLATES } from '../../lib/csvTemplate'
import { planExcReady, planExcOf } from '../../lib/planExc'
import { todayISO } from '../../lib/utils'
import { parseThirdPartySheet, tpKey, thirdPartyReady, syncThirdPartyProduction } from '../../lib/thirdParty'
import { parseAxPoWorkbook } from '../../lib/axPoFile'
import { axSyncPreview, axSyncRun } from '../../lib/orderIntake'
import { useMyProfile } from '../../hooks/useProfile'

// 헤더 유연 매칭
const pick = (row, keys) => {
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (keys.some(t => kn.includes(t))) return row[k]
  }
  return undefined
}
// 헤더 이름이 정확히 같은 것을 먼저 찾는다.
//   부분 일치만 쓰면 'Item Desc' 가 'item' 으로 잡히고 'BRev' 가 'rev' 로 잡힌다.
const pickExact = (row, keys) => {
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (keys.some(t => kn === t)) return row[k]
  }
  return undefined
}
const s = v => (v == null ? '' : String(v).trim())
// Received 시트 「현황」 칸(AG) 판정 (2026-10-02)
//   납품 완료 · 발송 완료 → done / 발주 취소 → cancel / 빈칸 · 그 밖의 글자 → unknown
//   예전엔 이 칸을 안 읽고 「Received 에 있으면 납품」으로 봐서, 취소 · 협의 중인 줄까지 납품(완료) 처리됐다.
export const rcvStateOf = (v) => {
  const t = s(v).replace(/\s/g, '')
  if (/취소|cancel/i.test(t)) return 'cancel'
  if (/(납품|발송)완료/.test(t)) return 'done'
  return 'unknown'
}
const keyOf = (po, ol, dl) => `${po}|${ol}|${dl}`
const dnorm = v => {
  if (v == null || v === '') return null
  // Date 객체 (cellDates:true 결과)
  if (v instanceof Date && !isNaN(v)) {
    // 정오 보정: 엑셀 날짜가 시간대(한국 구식 오프셋 +8:27:52 포함) 때문에 전날 23:2x로 파싱되는 문제 차단
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  }
  // 엑셀 날짜 일련번호 (예: 46183)
  if (typeof v === 'number' || /^\d{4,6}$/.test(String(v).trim())) {
    const serial = Number(v)
    if (serial > 20000 && serial < 80000) {   // 1954~2119 범위만 날짜로 간주
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
      if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
    }
  }
  const t = s(v); const m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : (t || null)
}

// 한 번 올리면 둘 다 (v4.101.0) — 고객사 PO 표 · 생산관리 호기 · 3rd party 에 더해 수주대장도 같이 맞춘다.
//   수주대장 「AX PO 엑셀 반영」도 이 창을 연다 (initialFile 로 고른 파일을 바로 읽음). 어디서 올려도 결과는 같다
export default function CustomerPOUpload({ csId, csCode, onClose, initialFile, onApplied }) {
  const qc = useQueryClient()
  const { data: me } = useMyProfile()
  const [ordRows, setOrdRows] = useState(null)   // 수주대장용으로 읽은 줄 (parseAxPoWorkbook) — 못 읽으면 null
  const [ordReadErr, setOrdReadErr] = useState('')
  const [rows, setRows] = useState([])
  const [diff, setDiff] = useState(null)   // { news, changes, sames }
  const [receivedSet, setReceivedSet] = useState(new Set())
  const [disCheck, setDisCheck] = useState({})   // 사라진 PO 체크 (기본 적용)
  const [disPick, setDisPick] = useState({})     // 「확인 필요」 줄을 사람이 납품 / 취소로 고른 것
  const [result, setResult] = useState(null)
  const [warns, setWarns] = useState([])   // 적용 뒤 생산관리 쪽 실패 (PO 적용은 된 상태)
  const [sheetUsed, setSheetUsed] = useState('')
  // 「3rd party」 시트 (동신 · 동원파츠 …) — 고객사 PO 에 같이 넣는다 (2026-10-02)
  const [tp, setTp] = useState({ rows: [], skipped: [] })

  function parseFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
      // 수주대장용 — 같은 파일을 수주대장 규칙(Current Data + 올해 Received)으로 한 번 더 읽는다
      try { setOrdRows(parseAxPoWorkbook(XLSX, wb).rows); setOrdReadErr('') } catch (er) { setOrdRows(null); setOrdReadErr(er.message || String(er)) }
      // AXCELIS 양식이면 'Current Data' 시트 우선, 없으면 첫 시트
      const sheetName = wb.SheetNames.find(n => /current\s*data/i.test(n)) || wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const parsed = json.map(r => {
        const pn = s(pick(r, ['item', '품번', 'partno', '품목코드'])).replace(/\.0$/, '')
        return {
          po_number: s(pick(r, ['ordernumber', 'order number', 'po', '오더번호', '발주번호'])),
          order_line: s(pick(r, ['orderlines', 'order lines', '오더라인'])).replace(/\.0$/, ''),
          del_line: s(pick(r, ['delline', 'del line', '납품라인'])).replace(/\.0$/, ''),
          ccn: s(pick(r, ['ccn'])),
          plan_exc: s(pick(r, ['planexc'])).toUpperCase(),   // HOT · RSIN · RSOU · CAN
          pn,
          item_rev:  s(pickExact(r, ['srev']) ?? pick(r, ['srev', 'rev', '리비전'])),
          item_brev: s(pickExact(r, ['brev']) ?? ''),
          qty: parseFloat(s(pick(r, ['quantity', '수량', 'qty', '발주량'])).replace(/,/g, '')) || 0,
          unit_price: parseFloat(s(pick(r, ['unit price', 'unitprice', '단가'])).replace(/[^0-9.]/g, '')) || 0,
          promise_date: dnorm(pick(r, ['promisedate', 'promise date', '약속일', '납기'])),
          division: pn.startsWith('16') ? '하네스' : pn.startsWith('11') ? '전장' : '구매품',   // 16*=하네스, 11*=전장, 그외=구매품
        }
      }).filter(r => r.pn && r.po_number)

      // Received 시트 → 납품 완료 키→{수량,단가} 맵 (부분납품 수량 + 완료건 단가 반영용)
      const rcvSheet = wb.SheetNames.find(n => /received|receive/i.test(n))
      const receivedMap = {}
      if (rcvSheet) {
        const rjson = XLSX.utils.sheet_to_json(wb.Sheets[rcvSheet], { defval: '' })
        rjson.forEach(r => {
          const pn = s(pick(r, ['item', '품번'])).replace(/\.0$/, '')
          const po = s(pick(r, ['order number', 'ordernumber', 'po']))
          const ol = s(pick(r, ['order lines', 'orderlines'])).replace(/\.0$/, '')
          const dl = s(pick(r, ['del line', 'delline'])).replace(/\.0$/, '')
          const rqty = parseFloat(s(pick(r, ['quantity', '수량', 'qty', '발주량', 'received', 'rcv qty'])).replace(/,/g, '')) || 0
          const rprice = parseFloat(s(pick(r, ['unit price', 'unitprice', '단가'])).replace(/[^0-9.]/g, '')) || 0
          // 「현황」 칸이 없는 양식이면 예전처럼 Received 에 있는 것 = 납품
          const stRaw = pickExact(r, ['현황'])
          const st = stRaw === undefined ? 'done' : rcvStateOf(stRaw)
          if (pn && po) {
            const k = keyOf(po, ol, dl)
            if (!receivedMap[k]) receivedMap[k] = { qty: 0, price: 0, state: null, stText: '', note: '' }
            const m = receivedMap[k]
            if (st !== 'cancel') m.qty += rqty                // 여러 납품분 수량 합산 (취소 줄 수량은 뺀다)
            if (rprice > 0) m.price = rprice                  // 단가 (마지막 값)
            // 같은 PO 줄이 여러 번 나오면: 납품 > 확인 필요 > 취소 순으로 본다
            const rank = { done: 3, unknown: 2, cancel: 1 }
            if (!m.state || rank[st] > rank[m.state]) { m.state = st; m.stText = s(stRaw) }
            const nt = [s(pickExact(r, ['전달사항'])), s(pickExact(r, ['비고1']))].filter(Boolean).join(' · ')
            if (nt && !m.note.includes(nt)) m.note = m.note ? m.note + ' / ' + nt : nt
          }
        })
      }
      // 3rd party 시트 — 납품 완료 줄은 Received 와 같은 구실(사라진 PO 판정)을 한다
      const tpSheet = wb.SheetNames.find(n => /3rd\s*party/i.test(n))
      const tpParsed = tpSheet ? parseThirdPartySheet(XLSX, wb.Sheets[tpSheet], dnorm) : { rows: [], skipped: [] }
      tpParsed.rows.filter(r => r.state !== 'open').forEach(r => {
        receivedMap[r._k] = { qty: r.qty, price: r.unit_price, state: r.state === 'done' ? 'done' : 'cancel', stText: r.stText, note: '' }
      })
      setTp(tpParsed)
      setReceivedSet(receivedMap)
      setRows(parsed); setDiff(null); setResult(null); setSheetUsed(sheetName)
    }
    reader.readAsArrayBuffer(file)
  }
  // 수주대장에서 파일을 골라 열었으면 바로 읽는다
  useEffect(() => { if (initialFile) parseFile(initialFile) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 업로드 분석: 기존 PO와 (po+오더라인+DEL라인+품번) 키로 매칭 → 변경 감지
  const analyzeMut = useMutation({
    mutationFn: async () => {
      // 고객사가 아직 안 잡혔으면 조회를 내보내지 않는다.
      //   undefined 가 주소에 그대로 실려 customer_id=eq.undefined 로 나가면
      //   400 만 뜨고 왜 안 되는지 알 수가 없다.
      if (!csId) throw new Error('고객사 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.')

      // 3rd party 칸(purchase_orders.third_party)이 있어야 3rd party 시트를 반영한다
      const tpReady = await thirdPartyReady(supabase)
      // Plan Exc Type 칸(purchase_orders.plan_exc)이 있어야 HOT 등을 저장한다
      const planReady = await planExcReady(supabase)
      const planUpd = []   // Plan Exc(HOT 등) 맞추기 — v4.56.0 부터 그 줄 변경 이력에도 남긴다 (언제 HOT 이 붙었는지 보려고)
      const tpOpen = tpReady ? tp.rows.filter(r => r.state === 'open') : []
      const fileRows = [...rows, ...tpOpen]
      // DB 줄의 키 — 3rd party 는 업체 · 품번까지
      const kOf = (e) => (tpReady && e.third_party)
        ? tpKey({ third_party: e.third_party, po_number: e.po_number, order_line: e.order_line || '', del_line: e.del_line || '', pn: (e.items?.std_code || '').replace(/^AX-/, '') })
        : keyOf(e.po_number, e.order_line, e.del_line)

      // 기존 customer_po 적재 (키 비교용)
      const all = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('purchase_orders')
          .select(`id,po_number,order_line,del_line,item_rev,item_brev,qty_ordered,unit_price,promise_date,division,status,changes${tpReady ? ',third_party' : ''}${planReady ? ',plan_exc' : ''}, items!purchase_orders_item_id_fkey(std_code)`)
          .eq('customer_id', csId).eq('order_type', 'customer_po').order('id')
          .range(from, from + 999)
        if (error) throw error
        all.push(...(data || [])); if (!data || data.length < 1000) break
      }
      const existMap = {}
      all.forEach(e => {
        const k = kOf(e)
        // 같은 키에 완료/진행이 섞이면 진행중을 우선 (완료건이 신규/변경 판정을 방해하지 않게)
        const prev = existMap[k]
        if (!prev || (prev.status === '완료' || prev.status === '취소')) existMap[k] = e
      })

      const news = [], changes = [], sames = []
      const curKeys = new Set()
      for (const r of fileRows) {
        const code = 'AX-' + r.pn
        const rk = r._k || keyOf(r.po_number, r.order_line, r.del_line)
        curKeys.add(rk)
        const ex = existMap[rk]
        if (!ex) { news.push({ ...r, code }); continue }
        const planHist = (planReady && !r.third_party && (r.plan_exc || '') !== (ex.plan_exc || ''))
          ? { field: 'plan_exc', from: ex.plan_exc || '-', to: r.plan_exc || '-' } : null
        const chg = []
        if (code !== (ex.items?.std_code || '')) chg.push({ field: 'item', from: ex.items?.std_code || '-', to: code, _newCode: code })
        if (r.item_rev && r.item_rev !== (ex.item_rev || '')) chg.push({ field: 'item_rev', from: ex.item_rev || '-', to: r.item_rev })
        if (r.item_brev && r.item_brev !== (ex.item_brev || '')) chg.push({ field: 'item_brev', from: ex.item_brev || '-', to: r.item_brev })
        if (r.promise_date && r.promise_date !== (ex.promise_date || '')) chg.push({ field: 'promise_date', from: ex.promise_date || '-', to: r.promise_date })
        if (r.qty && r.qty !== ex.qty_ordered) chg.push({ field: 'qty_ordered', from: ex.qty_ordered, to: r.qty })
        if (r.unit_price && r.unit_price !== (Number(ex.unit_price) || 0)) chg.push({ field: 'unit_price', from: ex.unit_price || 0, to: r.unit_price })
        if (r.division && r.division !== (ex.division || '')) chg.push({ field: 'division', from: ex.division || '-', to: r.division })
        if (chg.length) changes.push({ ...r, code, id: ex.id, prevChanges: ex.changes || [], chg, planHist })
        else sames.push({ ...r, id: ex.id, hadChanges: (ex.changes || []).length > 0 })
        // 이력: 다른 변경과 같이 바뀌면 그 줄 이력에 함께 넣고(inChg), Plan Exc 만 바뀐 줄은 아래 적용 때 따로 넣는다
        if (planHist) planUpd.push({ id: ex.id, v: r.plan_exc || null, hist: planHist, prev: ex.changes || [], inChg: chg.length > 0 })
      }

      // 사라진 PO: 기존 진행중인데 이번 Current Data에 없는 것
      //   Received 현황 납품 완료 · 발송 완료 → 납품 / 발주 취소 → 취소 / 그 밖 → 확인 필요
      //   Received 에도 없음 → 확인 필요 (v4.85.0 — 예전엔 「취소」로 추정했는데, 출하 후 Received 반영 전 · 줄 번호 바뀜 등이 섞여 있었다)
      //   이번 파일에 같은 PO · 품번이 새 줄로 들어왔으면 알려 준다 (줄 번호가 바뀐 것일 수 있음)
      const newLinesOf = {}
      news.forEach(n => { const k2 = `${n.po_number}|${n.code}`; (newLinesOf[k2] = newLinesOf[k2] || []).push(`L${n.order_line || '-'}/${n.del_line || '-'}`) })
      const disappeared = []
      for (const e of all) {
        const k = kOf(e)
        if (curKeys.has(k)) continue              // 이번에도 있음 → 패스
        // 3rd party 칸이 아직 없으면(SQL 전) 3rd party 줄을 가려낼 수 없다 — 그런 줄은 애초에 없다
        if (e.status === '완료' || e.status === '취소') continue   // 이미 처리됨
        const rcv = receivedSet[k]                 // Received에 있으면 {qty,price,state…}, 없으면 undefined
        // 납품은 Received 「현황」이 납품 완료 · 발송 완료일 때만. 발주 취소 → 취소, 빈칸 등 → 확인 필요
        const delivered = rcv !== undefined && rcv.state === 'done'
        const kind = delivered ? '납품' : rcv !== undefined && rcv.state === 'cancel' ? '취소' : '확인'
        const rcvQty = delivered ? rcv.qty : 0
        const rcvPrice = delivered ? rcv.price : 0
        // 부분납품: DB수량 ≠ Received수량이면 수량 보정 필요 (예: 4개 중 3개만 납품)
        const qtyMismatch = delivered && rcvQty > 0 && rcvQty !== e.qty_ordered
        // 완료건 단가 채우기: DB 단가가 없는데 Received에 단가 있으면 반영
        const priceFill = delivered && rcvPrice > 0 && !(Number(e.unit_price) > 0)
        disappeared.push({
          id: e.id, code: e.items?.std_code, po_number: e.po_number,
          order_line: e.order_line, del_line: e.del_line, qty_ordered: e.qty_ordered,
          kind,
          // src: 왜 그렇게 봤는지 — rcv(Received 현황) / none(Received 에도 없음)
          src: rcv === undefined ? 'none' : 'rcv', stText: rcv?.stText || '', note: rcv?.note || '',
          promise_date: e.promise_date || '', movedTo: rcv === undefined ? (newLinesOf[`${e.po_number}|${e.items?.std_code}`] || []) : [],
          tp: (tpReady && e.third_party) || '',
          rcvQty: delivered ? rcvQty : null, qtyMismatch,
          rcvPrice, priceFill,
        })
      }

      // ── 이미 완료된 과거 PO 단가 채우기 ──
      // status='완료'인데 unit_price 없는 것 → Received에 단가 있으면 백필 대상
      const priceBackfill = []
      for (const e of all) {
        if (e.status !== '완료') continue
        if (Number(e.unit_price) > 0) continue          // 이미 단가 있음
        const k = kOf(e)
        const rcv = receivedSet[k]
        if (rcv && rcv.price > 0) {
          priceBackfill.push({ id: e.id, code: e.items?.std_code, po_number: e.po_number,
            order_line: e.order_line, del_line: e.del_line, price: rcv.price })
        }
      }

      // 미등록 품목 + BOM 등록여부 점검
      const allCodes = [...new Set(fileRows.map(r => 'AX-' + r.pn))]
      const regItems = {}, bomCodes = new Set()
      for (let i = 0; i < allCodes.length; i += 300) {
        const slice = allCodes.slice(i, i + 300)
        const { data: its } = await supabase.from('items').select('std_code').in('std_code', slice)
        ;(its || []).forEach(x => { regItems[x.std_code] = true })
      }
      // 16*/11* 의 BOM(projects) 등록 여부
      const asmCodes = allCodes.filter(c => /^AX-1[61]/.test(c))
      for (let i = 0; i < asmCodes.length; i += 300) {
        const slice = asmCodes.slice(i, i + 300)
        const { data: pjs } = await supabase.from('projects').select('code').in('code', slice)
        ;(pjs || []).forEach(x => bomCodes.add(x.code))
      }
      const unregistered = allCodes.filter(c => !regItems[c]).map(c => ({
        code: c, isAsm: /^AX-1[61]/.test(c), hasBom: bomCodes.has(c),
        name: fileRows.find(r => 'AX-' + r.pn === c)?.pn || '',
      }))
      const noBomAsm = asmCodes.filter(c => !bomCodes.has(c))   // ASSY인데 BOM 없는 것

      // 사라진 PO 과다 경고 (전체 진행중의 40% 넘으면 의심)
      //   분모는 진행중 PO — 완료 · 취소 이력까지 넣으면 엉뚱한 파일을 올려도 9% 쯤으로 나와 경고가 안 떴다 (2026-10-08)
      const liveCount = all.filter(e => e.status !== '완료' && e.status !== '취소').length
      const disappearWarn = liveCount > 0 && disappeared.length / liveCount > 0.4

      // 수주대장도 같이 — 무엇이 바뀌는지 미리 (실패해도 고객사 PO 쪽은 그대로 진행)
      let ordPv = null, ordErr = ordReadErr || ''
      if (ordRows?.length) {
        try { ordPv = await axSyncPreview(ordRows) } catch (er) { ordErr = er.message || String(er) }
      }

      return { news, changes, sames, unregistered, noBomAsm, disappeared, disappearWarn, priceBackfill, existCount: liveCount, ordPv, ordErr,
               tpReady, tpOpen: tpOpen.length, tpTotal: tp.rows.length,
               planReady, planUpd, planInFile: rows.filter(r => r.plan_exc).length,
               // 약속일이 이미 지난 줄 — 엑셀에서 새 날짜로 고쳐 다시 올려야 한다
               overdue: rows.filter(r => r.promise_date && r.promise_date < todayISO()) }
    },
    onSuccess: (d) => {
      setDiff(d)
      // 기본 체크: 납품(현황 납품 완료) · 취소(현황 발주 취소)만.
      //   Received 에도 없는 취소 추정 · 현황이 비어 있는 「확인 필요」는 체크 해제 (안전)
      const init = {}
      ;(d.disappeared || []).forEach(x => {
        if (x.kind === '확인' || (x.kind === '취소' && x.src !== 'rcv')) init[x.id] = false
      })
      setDisCheck(init); setDisPick({})
    },
    onError: e => toastError('분석 오류: ' + e.message),
  })

  // 적용: 변경분은 update + 이력 누적, 신규는 insert
  const applyMut = useMutation({
    mutationFn: async () => {
      // 여기서 뚫리면 고객사가 비어 있는 PO 가 만들어져 어디에도 안 보인다
      if (!csId) throw new Error('고객사 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.')
      const now = new Date().toISOString()
      // ⚠ 예전엔 줄마다 품목 조회 · 저장을 차례로 기다려 수백 줄이면 1~3분 걸렸다.
      //   품목은 한 번에 찾아 없는 것만 한 번에 만들고, 저장은 20줄씩 동시에 · 신규는 200줄씩 묶어 보낸다.
      const pool = async (arr, fn, n = 20) => {
        for (let i = 0; i < arr.length; i += n) {
          const res = await Promise.all(arr.slice(i, i + n).map(fn))
          const bad = res.find(r => r?.error)
          if (bad) throw bad.error
        }
      }
      // 필요한 품번 전부 → id
      const need = {}   // code → 새로 만들 때 이름
      diff.changes.forEach(c => c.chg.forEach(x => { if (x.field === 'item' && x._newCode) need[x._newCode] ??= '' }))
      diff.news.forEach(n => { if (n.code) need[n.code] = need[n.code] || (n.third_party ? (n.name || '') : '') })
      const itemByCode = {}
      const needCodes = Object.keys(need)
      for (let i = 0; i < needCodes.length; i += 300) {
        const { data, error } = await supabase.from('items').select('id,std_code,type').in('std_code', needCodes.slice(i, i + 300))
        if (error) throw new Error('품목 조회 실패: ' + error.message)
        ;(data || []).forEach(it => { itemByCode[it.std_code] = it })
      }
      const missing = needCodes.filter(c => !itemByCode[c])
      let created = 0
      for (let i = 0; i < missing.length; i += 200) {
        const { data, error } = await supabase.from('items')
          .insert(missing.slice(i, i + 200).map(c => ({ std_code: c, name: need[c] || '', type: '자재', unit: 'EA' })))
          .select('id,std_code,type')
        if (error) throw new Error('신규 품번 생성 실패: ' + error.message)
        ;(data || []).forEach(it => { itemByCode[it.std_code] = it; created++ })
      }

      // 변경 적용
      await pool(diff.changes, c => {
        const patch = {}
        for (const x of c.chg) {
          if (x.field === 'item') {
            // 품번 변경 → item_id 교체 (없던 품번은 위에서 만들었다)
            const it = itemByCode[x._newCode]
            if (it) patch.item_id = it.id
          } else {
            patch[x.field] = x.to
          }
        }
        // 이력은 누적해 남긴다. 한 건이 몇 번이나 밀렸는지가
        // 제조 일정 판단에 중요하기 때문이다.
        // 화면에서는 기본적으로 최근 변경만 보여주고,
        // 반복 변경은 별도 배지로 표시한다.
        patch.changes = [...(c.prevChanges || []),
                         ...c.chg.map(x => ({ field: x.field, from: x.from, to: x.to, at: now })),
                         ...(c.planHist ? [{ ...c.planHist, at: now }] : [])]
        return supabase.from('purchase_orders').update(patch).eq('id', c.id)
      })

      // 신규 insert (품목은 위에서 확보)
      let inserted = 0
      const newRows = diff.news.map(n => {
        const item = itemByCode[n.code]
        if (!item) throw new Error('품목을 찾지 못했습니다: ' + n.code)
        return {
          customer_id: csId, item_id: item.id, order_type: 'customer_po',
          po_number: n.po_number, ccn: n.ccn || null, order_line: n.order_line || null,
          del_line: n.del_line || null, item_rev: n.item_rev || null,
          item_brev: n.item_brev || null,
          qty_ordered: Math.round(n.qty), qty_received: 0,
          unit_price: n.unit_price || null,
          promise_date: n.promise_date, type: item.type || '자재',
          division: n.division || '전장',
          status: '진행중', changes: [],
          ...(n.third_party ? { third_party: n.third_party } : {}),
          ...(diff.planReady && n.plan_exc ? { plan_exc: n.plan_exc } : {}),
        }
      })
      for (let i = 0; i < newRows.length; i += 200) {
        const chunk = newRows.slice(i, i + 200)
        const { error } = await supabase.from('purchase_orders').insert(chunk)
        if (error) throw new Error(`신규 PO 등록 실패 (${inserted}건까지 등록됨): ${error.message}`)
        inserted += chunk.length
      }
      // Plan Exc Type(HOT 등) 맞추기
      //   ① 다른 변경과 같이 바뀐 줄 — 이력은 위 변경 적용 때 이미 넣었다 → 값만 묶어서
      //   ② Plan Exc 만 바뀐 줄 — 값 + 이력 한 줄을 그 줄마다 (이력이 줄마다 달라 묶을 수 없다)
      const byV = {}
      ;(diff.planUpd || []).filter(u => u.inChg).forEach(u => { (byV[u.v ?? ''] ||= []).push(u.id) })
      for (const [v, ids] of Object.entries(byV)) {
        for (let i = 0; i < ids.length; i += 150) {
          const { error } = await supabase.from('purchase_orders').update({ plan_exc: v || null }).in('id', ids.slice(i, i + 150))
          if (error) throw error
        }
      }
      await pool((diff.planUpd || []).filter(u => !u.inChg), u =>
        supabase.from('purchase_orders').update({ plan_exc: u.v || null, changes: [...(u.prev || []), { ...u.hist, at: now }] }).eq('id', u.id))
      // 사라진 PO 처리 (체크된 것만): 납품→완료, 취소→취소
      let done = 0, canceled = 0
      //   「확인 필요」 줄은 사람이 납품 / 취소를 고른 것만 처리한다 (안 고르면 그대로 둔다)
      const dis = (diff.disappeared || [])
        .map(d => d.kind === '확인' ? { ...d, kind: disPick[d.id] || null } : d)
        .filter(d => d.kind && disCheck[d.id] !== false)
      const disJobs = dis.map(d => {
        const newStatus = d.kind === '납품' ? '완료' : '취소'
        const patch = { status: newStatus, issued: d.kind === '납품', issued_at: d.kind === '납품' ? now : null }
        // 부분납품이면 실제 납품수량으로 보정 (예: 4개 등록인데 3개만 납품 → qty=3으로 완료)
        if (d.kind === '납품' && d.qtyMismatch && d.rcvQty > 0) patch.qty_ordered = d.rcvQty
        // 잔량 정리 — 납품·취소된 건은 남은 수량이 없다.
        //   qty_remaining 은 (qty_ordered - qty_received) 로 계산되는 컬럼이라
        //   직접 넣을 수 없다. 받은 수량을 채우면 자동으로 0 이 된다.
        //   취소 건은 주문 수량을 그대로 둔다. 원래 얼마였는지가 기록이고,
        //   부족자재 계산은 status 로 걸러내므로 잔량이 남아도 문제없다.
        if (d.kind === '납품') {
          patch.qty_received = d.qtyMismatch && d.rcvQty > 0 ? d.rcvQty : d.qty_ordered
        }
        // 완료건 단가 채우기: DB에 단가 없으면 Received 단가로 (매출 집계용)
        if (d.kind === '납품' && d.priceFill && d.rcvPrice > 0) patch.unit_price = d.rcvPrice
        return { d, patch }
      })
      await pool(disJobs, ({ d, patch }) => supabase.from('purchase_orders').update(patch).eq('id', d.id)
        .then(r => { if (!r.error) { if (d.kind === '납품') done++; else canceled++ } return r }))
      // 이미 완료된 과거 PO 단가 백필 (매출 집계용)
      let priceFilled = 0
      await pool(diff.priceBackfill || [], p => supabase.from('purchase_orders').update({ unit_price: p.price }).eq('id', p.id)
        .then(r => { if (!r.error) priceFilled++; return r }))
      // ① 납품이 끝난 PO 에 붙어 있던 호기를 먼저 완료로 바꾼다 (상태 무관).
      //   ⚠ 순서가 중요하다. 예전엔 연동(②)을 먼저 돌렸는데, 연동은 열린 PO 만 보고
      //     「완료 안 된 호기」를 납기순으로 다시 줄 세운다. 그래서 방금 납품된 호기가
      //     다음 PO 로 밀려 붙고(납기 +N일로 보임), 그 뒤 완료 처리는 찾을 게 없었다.
      //     (2026-09 110158840 #31~#35 — 9/1·9/15 납품분이 9/22·10/22 PO 로 밀림)
      //   부분납품이면 납품 수량만큼만 완료, 남는 호기는 연결만 풀어 ②에서 다시 매칭된다.
      //   되돌릴 수 있게 기록을 남긴다.
      //   ⚠ Supabase 는 실패를 던지지 않고 error 로 돌려준다. try/catch 만으로는 못 잡는다.
      //     예전엔 여기서 실패해도 아무 표시가 없었다 → 실패를 모아 결과 창에 보여 준다.
      const warns = []
      let hogiDone = null
      try {
        const { data: hd, error: he } = await supabase.rpc('pm_sync_done_hogi', { p_po_ids: null })
        if (he) throw he
        hogiDone = Array.isArray(hd) ? hd[0] : hd
      } catch (e) { warns.push('납품 완료 호기 처리 실패: ' + (e?.message || e)) }

      // ② PO 를 고쳤으면 생산관리 호기도 맞춰야 한다.
      //   따로 눌러야 하는 구조라 빠뜨리기 쉬워, 적용 직후 바로 돌린다.
      //   실패해도 PO 적용은 유효하므로 안내만 남긴다.
      //   ⚠ ① 이 실패했으면 ② 는 돌리지 않는다 — 돌리면 납품된 호기가 다음 PO 로 밀려 붙는다.
      let sync = null
      if (!warns.length) {
        try {
          const { data: sd, error: se } = await supabase.rpc('sync_production_from_po',
            { cs_code: 'AX', p_silent: false })
          if (se) throw se
          sync = sd?.[0] || null
        } catch (e) { warns.push('생산관리 연동 실패: ' + (e?.message || e)) }
      } else {
        warns.push('납품 완료 처리가 안 돼 생산관리 연동은 돌리지 않았습니다 — 생산관리 화면의 「PO 연동」을 눌러 주세요')
      }

      // ③ 3rd party PO → 생산관리 Sub Assy 한 줄 (11 · 12번대만)
      let tpSync = null
      if (diff.tpReady) {
        try { tpSync = await syncThirdPartyProduction(supabase, 'AX') }
        catch (e) { warns.push('3rd party 생산관리 반영 실패: ' + (e?.message || e)) }
      }

      // ④ 수주대장도 같이 (v4.101.0) — 실패해도 위 적용은 유효. 안내만 남긴다
      let ord = null
      const op = diff.ordPv
      if (op && (op.newPos.length || op.upd.length || op.add.length)) {
        try { ord = await axSyncRun(op, me?.name || null) }
        catch (e) { warns.push('수주대장 반영 실패: ' + (e?.message || e) + ' — 수주대장 「AX PO 엑셀 반영」으로 다시 올려 주세요') }
      } else if (diff.ordErr) warns.push('수주대장은 반영 못 함: ' + diff.ordErr)

      return { changed: diff.changes.length, inserted, created, done, canceled,
               priceFilled, sync, hogiDone, warns, tpSync, ord }
    },
    onSuccess: (r) => {
      const sy = r.sync
      const hd = r.hogiDone
      const syncMsg = sy
        ? ` · 생산관리 연동(매칭 ${sy.matched||0}, 신규 ${sy.created||0}, 갱신 ${sy.updated||0})`
        : ''
      setWarns(r.warns || [])
      if (r.warns?.length) toastError(r.warns[0])
      const doneMsg = hd?.done_cnt > 0
        ? ` · 납품 완료 호기 ${hd.done_cnt}건 반영${hd.snap_id ? ` (되돌리기 #${hd.snap_id})` : ''}`
        : ''
      const ts = r.tpSync
      const tpMsg = ts && (ts.created || ts.updated || ts.unlinked)
        ? ` · 3rd party 생산관리(신규 ${ts.created}, 갱신 ${ts.updated}${ts.unlinked ? `, 연결 해제 ${ts.unlinked}` : ''})` : ''
      const ordMsg = r.ord ? ` · 수주대장(새 PO ${r.ord.created} · 바뀐 품목 ${r.ord.changed}${r.ord.resets ? ` · 재회신 ${r.ord.resets}` : ''})` : ''
      setResult(`적용 완료 — 변경 ${r.changed}건, 신규 ${r.inserted}건${r.created ? `, 자동등록 ${r.created}건` : ''}${r.done ? `, 납품완료 ${r.done}건` : ''}${r.canceled ? `, 취소 ${r.canceled}건` : ''}${r.priceFilled ? `, 완료건 단가채움 ${r.priceFilled}건` : ''}${syncMsg}${doneMsg}${tpMsg}${ordMsg}`)
      setRows([]); setDiff(null); setDisCheck({}); setTp({ rows: [], skipped: [] })
      qc.invalidateQueries(['cpo']); qc.invalidateQueries(['shortage'])
      qc.invalidateQueries({ queryKey: ['production'], exact: false })
      qc.invalidateQueries({ queryKey: ['todoList'] })
      qc.invalidateQueries({ queryKey: ['orderIntake'], exact: false })
      qc.invalidateQueries({ queryKey: ['orderMoney'], exact: false })   // 수주대장 예상 매출 합계 (v4.103.0)
      onApplied?.(r)
    },
    onError: e => toastError('적용 오류: ' + e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">AXCELIS PO 엑셀 반영 — 수주대장 · 고객사 PO · 생산관리 한 번에</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* 지금 어디쯤인지 (v4.104.0) — 적용 뒤에는 rows · diff 가 비워지고 result 만 남는다 */}
          <Stepper steps={['엑셀 고르기', '변경 감지 분석', '확인', '적용']}
            cur={result && !rows.length ? 4 : !rows.length ? 0 : !diff ? 1 : applyMut.isPending ? 3 : 2} />
          {result && warns.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 font-semibold space-y-1">
              {warns.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold">✅ {result}</div>
          )}

          <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center">
            <input type="file" accept=".xlsx,.xlsm,.xls,.csv" id="cpo-file" className="hidden"
              onChange={e => e.target.files[0] && parseFile(e.target.files[0])} />
            <label htmlFor="cpo-file" className="cursor-pointer text-sm text-indigo-600 font-semibold">📁 PO 엑셀/CSV 선택</label>
            <p className="text-xs text-slate-400 mt-1">AXCELIS PO관리(.xlsm) Current Data 시트 자동 인식 · CCN·라인·SRev·약속일</p>
            <button onClick={()=>downloadCsvTemplate(TEMPLATES.customerPO.filename, TEMPLATES.customerPO.headers, TEMPLATES.customerPO.samples)}
              className="mt-2 text-xs text-indigo-500 font-semibold hover:underline">⬇ CSV 양식 다운로드</button>
            {rows.length > 0 && <p className="text-xs text-slate-600 mt-2 font-semibold">{rows.length}행 읽음 {sheetUsed && <span className="text-slate-400">· [{sheetUsed}] 시트</span>}</p>}
            {tp.rows.length > 0 && (
              <p data-tp-read className="text-xs text-fuchsia-700 mt-1 font-semibold">
                3rd party {tp.rows.length}줄 읽음
                <span className="text-fuchsia-400 font-normal"> · {Object.entries(tp.rows.reduce((a, r) => { a[r.third_party] = (a[r.third_party] || 0) + 1; return a }, {})).map(([k, v]) => `${k} ${v}`).join(' · ')} · 진행 {tp.rows.filter(r => r.state === 'open').length}</span>
              </p>
            )}
            {(tp.badLayout || tp.skipped?.length > 0) && (
              <p className="text-[11px] text-amber-600 mt-1">⚠ 3rd party 시트 {tp.badLayout ? '칸 배치가 달라 읽지 못했습니다' : `${tp.skipped.length}줄 건너뜀 — ${tp.skipped.slice(0, 3).join(' / ')}`}</p>
            )}
          </div>

          {rows.length > 0 && !diff && (
            <button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending}
              className="w-full py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {analyzeMut.isPending ? <><Spin />분석 중... (수주대장 · 생산관리까지 비교)</> : '변경 감지 분석'}
            </button>
          )}

          {diff && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <p className="text-xs font-bold text-emerald-500">신규</p><p className="text-xl font-bold text-emerald-700">{diff.news.length}</p></div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                  <p className="text-xs font-bold text-amber-500">변경</p><p className="text-xl font-bold text-amber-700">{diff.changes.length}</p></div>
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-xs font-bold text-slate-400">동일</p><p className="text-xl font-bold text-slate-600">{diff.sames.length}</p></div>
              </div>

              {/* 수주대장도 같이 (v4.101.0) */}
              {(() => {
                const op = diff.ordPv, sm = op?.summary
                const none = op && !sm.newPos && !sm.changedPos
                return (
                  <div data-cpo-ord className={`rounded-xl border px-4 py-3 text-xs ${op ? 'border-violet-200 bg-violet-50/60 text-slate-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <b className="text-violet-700">📨 수주대장도 같이 맞춥니다</b>
                    {!op ? <div className="mt-1" data-cpo-ord-err>⚠ 수주대장은 이번에 못 맞춥니다 — {diff.ordErr || '수주대장용으로 읽은 줄이 없습니다'} (고객사 PO · 생산관리는 그대로 적용)</div>
                      : none ? <div className="mt-1 text-slate-500">수주대장은 바뀔 것이 없습니다</div>
                      : <div className="mt-1 space-y-0.5">
                          {sm.newPos > 0 && <div>· 새 PO <b>{sm.newPos}</b>건 · {sm.newLines}품목</div>}
                          {sm.changedPos > 0 && <div>· 바뀐 PO <b>{sm.changedPos}</b>건 — 납기 {sm.due} · 수량 {sm.qty} · SREV {sm.rev}{sm.brev ? ` · BREV ${sm.brev}` : ''} · 단가 {sm.price} · 납품 {sm.delivered} · 취소 {sm.cancelled}{sm.added ? ` · 품목 추가 ${sm.added}` : ''}</div>}
                          {sm.resets > 0 && <div className="text-red-600">· 납기가 당겨지거나 수량이 늘어 <b>구매자재 재회신 필요</b> {sm.resets}건</div>}
                        </div>}
                    {op && sm.missing > 0 && <div className="mt-1 text-amber-700">· 엑셀 어디에도 없는 수주대장 진행 중 줄 {sm.missing} — 바꾸지 않음</div>}
                    {op && sm.skippedTp > 0 && <div className="mt-1 text-slate-500" data-skip-tp>· 3rd party PO {sm.skippedTp}건 — 수주대장 「기타」 업체로 따로 관리해 건너뜀</div>}
                  </div>
                )
              })()}

              {diff.overdue?.length > 0 && (
                <div data-overdue className="rounded-xl border border-red-200 bg-red-50 overflow-hidden">
                  <div className="px-3 py-2 text-xs font-bold text-red-700 border-b border-red-200">
                    ⏰ 약속일(Promise Date)이 이미 지난 줄 {diff.overdue.length}건
                    {diff.overdue.some(r => r.plan_exc === 'HOT') && <span> · HOT {diff.overdue.filter(r => r.plan_exc === 'HOT').length}</span>}
                    <span className="font-normal text-red-500"> — 엑셀에서 새 날짜로 고쳐 다시 올려야 합니다 (고객사 PO 「납기 갱신 필요」에서 다시 볼 수 있음)</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-red-100">
                    {[...diff.overdue].sort((a, b) => ((b.plan_exc === 'HOT') - (a.plan_exc === 'HOT')) || a.promise_date.localeCompare(b.promise_date)).map((r, i) => (
                      <div key={i} className="px-3 py-1 text-xs flex items-center gap-2">
                        {r.plan_exc && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${planExcOf(r.plan_exc).cls}`}>{r.plan_exc}</span>}
                        <span className="font-mono text-slate-500">{r.po_number}</span>
                        <span className="text-slate-400">L{r.order_line}/{r.del_line}</span>
                        <span className="font-mono text-indigo-600">AX-{r.pn}</span>
                        <span className="ml-auto font-mono text-red-600">{r.promise_date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diff.planInFile > 0 && !diff.planReady && (
                <p data-plan-note className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠ Plan Exc Type(HOT 등) {diff.planInFile}줄은 이번에 저장하지 않습니다 — SQL pm_plan_exc_261002 를 먼저 실행하세요.
                </p>
              )}
              {diff.planReady && diff.planUpd?.length > 0 && (
                <p data-plan-note className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  Plan Exc Type(HOT · RSIN · RSOU …) {diff.planUpd.length}줄을 파일 값으로 맞추고 그 줄 변경 이력에 남깁니다
                  {(() => { const on = diff.planUpd.filter(u => String(u.v || '').toUpperCase() === 'HOT').length, off = diff.planUpd.filter(u => String(u.hist?.from || '').toUpperCase() === 'HOT' && String(u.v || '').toUpperCase() !== 'HOT').length
                    return (on || off) ? <b className="ml-1 text-red-600">— HOT 새로 {on} · HOT 풀림 {off}</b> : null })()}
                </p>
              )}

              {diff.tpTotal > 0 && (diff.tpReady
                ? <p data-tp-note className="text-[11px] text-fuchsia-700 bg-fuchsia-50 border border-fuchsia-200 rounded-lg px-3 py-2">
                    🤝 3rd party 진행 {diff.tpOpen}줄을 고객사 PO 에 같이 반영합니다 (신규 · 변경에 포함). 11 · 12번대는 생산관리 Sub Assy 에 PO 한 줄씩 올라갑니다 — 16번대는 PO 에만.
                  </p>
                : <p data-tp-note className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠ 3rd party 시트 {diff.tpTotal}줄은 이번에 반영하지 않습니다 — SQL pm_third_party_261002 를 먼저 실행하세요.
                  </p>)}

              {diff.priceBackfill?.length > 0 && (
                <p className="text-[11px] text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  💰 이미 완료된 PO {diff.priceBackfill.length}건의 단가를 Received 시트에서 채웁니다 (매출 집계용) — 적용 시 반영됩니다.
                </p>
              )}

              {/* 미등록 품목 알림 */}
              {diff.unregistered?.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
                  <div className="px-3 py-2 text-xs font-bold text-blue-700 border-b border-blue-200">
                    🆕 미등록 품목 {diff.unregistered.length}건 — 적용 시 자동 등록됩니다
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-blue-100">
                    {diff.unregistered.map((u, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs flex items-center gap-2">
                        <span className="font-mono text-blue-600">{u.code}</span>
                        {u.isAsm && (u.hasBom
                          ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 text-[10px] font-bold">BOM 있음</span>
                          : <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-bold">⚠ BOM 없음</span>)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BOM 없는 ASSY 경고 (등록은 됐지만 BOM 미등록 = 부족자재 전개 불가) */}
              {diff.noBomAsm?.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                  ⚠️ <span className="font-bold">BOM 미등록 ASSY {diff.noBomAsm.length}건</span> — 부족자재 전개가 안 됩니다. BOM 등록 필요:
                  <div className="mt-1 font-mono text-[11px] text-red-500 max-h-20 overflow-y-auto">
                    {diff.noBomAsm.slice(0, 30).join(', ')}{diff.noBomAsm.length > 30 && ` 외 ${diff.noBomAsm.length - 30}건`}
                  </div>
                </div>
              )}

              {/* 사라진 PO — 납품/취소 검토 */}
              {diff.disappeared?.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 overflow-hidden">
                  <div className="px-3 py-2 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-violet-700">
                      📦 사라진 PO {diff.disappeared.length}건 — 납품 {diff.disappeared.filter(d=>d.kind==='납품').length} · 취소 {diff.disappeared.filter(d=>d.kind==='취소').length}
                      {diff.disappeared.some(d=>d.kind==='확인') && <span className="text-amber-600"> · 확인 필요 {diff.disappeared.filter(d=>d.kind==='확인').length}</span>}
                    </span>
                    <span className="text-[11px] text-violet-400">체크된 것만 처리 (납품→완료, 취소→취소) · Received 「현황」 칸 기준 · Received 에 없으면 「확인 필요」(기본 그대로 둠)</span>
                  </div>
                  {diff.disappearWarn && (
                    <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-[11px] text-red-600 font-semibold">
                      ⚠️ 사라진 PO가 전체의 40%를 넘습니다 ({diff.disappeared.length}/{diff.existCount}). 잘못된 파일이거나 품번이 대량 변경됐을 수 있어요. 취소 항목은 신중히 확인하세요.
                    </div>
                  )}
                  <div className="max-h-52 overflow-y-auto divide-y divide-violet-100">
                    {diff.disappeared.map((d, i) => (
                      <label key={i} data-dis-kind={d.kind} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-violet-50/50 ${d.kind==='확인'?'bg-amber-50/60':''}`}>
                        {d.kind === '확인' ? (
                          // 현황이 비어 있거나 처음 보는 글자 — 사람이 정한다. 기본은 그대로 둠
                          <select data-dis-pick value={disPick[d.id] || ''}
                            onChange={e => { const v = e.target.value; setDisPick(c => ({ ...c, [d.id]: v })); setDisCheck(c => ({ ...c, [d.id]: !!v })) }}
                            className="px-1 py-0.5 text-[11px] border border-amber-300 rounded bg-white text-amber-700 font-bold">
                            <option value="">그대로 둠</option>
                            <option value="납품">납품</option>
                            <option value="취소">취소</option>
                          </select>
                        ) : (
                          <input type="checkbox" checked={disCheck[d.id] !== false}
                            onChange={e => setDisCheck(c => ({ ...c, [d.id]: e.target.checked }))} />
                        )}
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${d.kind==='납품'?'bg-emerald-100 text-emerald-600':d.kind==='확인'?'bg-amber-100 text-amber-700':'bg-rose-100 text-rose-600'}`}>{d.kind==='확인'?'확인 필요':d.kind}</span>
                        {d.tp && <span className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold">{d.tp}</span>}
                        <span className="font-mono text-slate-500">{d.po_number}</span>
                        <span className="font-mono text-indigo-600">{d.code}</span>
                        {d.order_line && <span className="text-slate-400">L{d.order_line}/{d.del_line}</span>}
                        {/* 왜 그렇게 봤는지 — Received 현황 글자 · 전달사항 · 비고 */}
                        <span className="text-[10px] text-slate-400 truncate max-w-[280px]" title={[d.stText, d.note].filter(Boolean).join(' · ')}>
                          {d.src === 'none' ? `${d.tp ? '3rd party 시트에 없음' : 'Received 에 없음'}${d.promise_date ? ` · 납기 ${String(d.promise_date).slice(5).replace('-', '/')}` : ''}` : d.kind === '확인' ? `현황 ${d.stText ? '「' + d.stText + '」' : '빈칸'}${d.note ? ' · ' + d.note : ''}` : d.stText ? `현황 「${d.stText}」` : ''}
                        </span>
                        {d.movedTo?.length > 0 && (
                          <span data-dis-moved className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold" title="이번 파일에 같은 PO · 품번이 새 줄로 들어왔습니다 — 줄 번호가 바뀐 것일 수 있어요 (그대로 두고 새 줄을 보세요)">
                            새 줄 {d.movedTo.join(' · ')} 로 들어옴?
                          </span>
                        )}
                        <span className="text-slate-400 ml-auto">
                          {d.qtyMismatch
                            ? <span className="text-amber-600 font-semibold">{d.qty_ordered}→{d.rcvQty}개 (부분납품)</span>
                            : <span>{d.qty_ordered}개</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {diff.changes.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-amber-50 text-xs font-bold text-amber-700 border-b border-slate-200">변경 감지 항목</div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {diff.changes.map((c, i) => (
                      <div key={i} className="px-3 py-2 text-xs">
                        <div className="font-mono text-slate-500 mb-1">{c.third_party && <span className="mr-1 px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold font-sans">{c.third_party}</span>}{c.po_number} · {c.code} {c.order_line && `· L${c.order_line}`}</div>
                        {c.chg.map((x, j) => (
                          <div key={j} className="flex items-center gap-2 ml-2">
                            <span className="text-slate-400 w-16">{x.field === 'promise_date' ? '납기' : x.field === 'item_rev' ? 'SREV' : x.field === 'item_brev' ? 'BREV' : x.field === 'division' ? '구분' : x.field === 'plan_exc' ? 'Plan Exc' : x.field === 'unit_price' ? '단가' : x.field === 'item' ? '품번' : x.field === 'qty_ordered' ? '수량' : x.field}</span>
                            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 line-through">{x.from}</span>
                            <span className="text-slate-300">→</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-semibold">{x.to}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => applyMut.mutate()} disabled={applyMut.isPending || (diff.news.length === 0 && diff.changes.length === 0 && (diff.disappeared?.length || 0) === 0 && (diff.priceBackfill?.length || 0) === 0 && (diff.planUpd?.length || 0) === 0 && !(diff.ordPv && (diff.ordPv.newPos.length || diff.ordPv.upd.length || diff.ordPv.add.length)))}
                className="w-full py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 inline-flex items-center justify-center gap-2">
                {applyMut.isPending ? <><Spin />적용 중... 창을 닫지 마세요</> : `적용 (신규 ${diff.news.length} · 변경 ${diff.changes.length})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
