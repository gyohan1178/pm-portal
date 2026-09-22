import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { downloadQuoteExcel, SUPPLIER } from '../../lib/quoteExcel'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import { tierMargin, DEFAULT_TIERS, DEFAULT_CFG, explodeBOM, computeCost } from '../../lib/costAnalysis'
import { todayISO } from '../../lib/utils'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const money = (v, cur) =>
  cur === 'KRW'
    ? Math.round(num(v)).toLocaleString('ko-KR')
    : num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const won = (v) => Math.round(num(v)).toLocaleString('ko-KR')
const pct = (v) => (num(v) * 100).toFixed(1) + '%'

const AX = (s) => {
  const t = String(s ?? '').trim().replace(/^AX-/i, '')
  return t ? 'AX-' + t : ''
}

let seq = 0
const newLine = (p = {}) => ({
  key: `L${++seq}`,
  kind: 'item',
  std_code: '', description: '', rev: '', unit: 'EA', qty: 1,
  unitPrice: 0, alternative: '', remarks: '',
  materialKrw: 0, laborKrw: 0, vendor: '', origin: 'dom', marginPct: null,
  noPrice: 0, partCount: 0, laborSrc: null, parts: null,
  lt: null, moq: null, proto: false,
  ...p,
})

const FALLBACK_MCFG = { tiers: DEFAULT_TIERS, laborMarg: DEFAULT_CFG.laborMarg }

// 기본 납기(주). 초도품은 승인·검증이 붙어 더 길다.
const LEAD_BASE = { fa: 8, mp: 6 }
const LEAD_LABEL = { fa: '초도품(FA)', mp: '양산' }

// 어셈블리 자재비 — 십원 자리에서 반올림(=100원 단위).
//   부품 수량이 소수로 전개돼 17,867,162.57 처럼 나오던 것을 정리한다.
//   ⚠ 단품 매입가에는 쓰지 않는다. 55원짜리 단자가 100원이 되어 단가가 틀어진다.
const round100 = (v) => Math.round(num(v) / 100) * 100

// 달러 단가 — 센트(소수 둘째 자리)까지 올림. 19564.85692 → 19564.86
//   ⚠ 2.19 × 100 이 219.00000000000003 이 되어 2.20 으로 튀는 부동소수 오차를 막는다.
const ceilCent = (v) => Math.ceil(num(v) * 100 - 1e-7) / 100

const lineCost = (l) => num(l.materialKrw) + num(l.laborKrw)

// 세부 부품에서 자재비를 다시 합산 (제외 체크·단가 수정 반영)
const sumParts = (parts) =>
  (parts || []).reduce((a, p) => a + (p.excluded || p.buyKrw == null ? 0 : num(p.buyKrw) * num(p.qty)), 0)

// 줄 단가 산출. 원가분석 「권장단가」와 같은 규칙을 쓴다.
//   ① 줄에 마진율을 직접 적었으면 그 값으로 덩어리 계산 (직접 지정이 최우선)
//   ② ASSY 는 부품마다 구간마진을 먹이고, 작업비는 작업비마진을 따로 먹인다
//   ③ 단품은 그 품목 매입가로 구간을 고른다
//   ⚠ 자재비 칸을 손으로 고쳐 부품 합계와 어긋나면 부품별 계산을 쓰지 않는다.
//     그 줄은 더 이상 부품표가 대표하지 못하기 때문이다.
function linePrice(line, currency, sellRate, mcfg) {
  const mat = num(line.materialKrw)
  const labor = num(line.laborKrw)
  if (mat <= 0 && labor <= 0) return 0
  const tiers = mcfg?.tiers
  const laborMarg = num(mcfg?.laborMarg)
  let krw = 0

  if (line.marginPct != null) {
    krw = (mat + labor) / (1 - num(line.marginPct))
  } else {
    const parts = Array.isArray(line.parts)
      ? line.parts.filter((p) => !p.excluded && p.buyKrw != null)
      : []
    const partsSum = parts.reduce((a, p) => a + num(p.buyKrw) * num(p.qty), 0)
    // 자재비를 100원 단위로 반올림해 두므로 부품합과 최대 50원 차이가 난다. 그 안이면 같은 것으로 본다.
    const usable = line.kind === 'assy' && parts.length > 0 && Math.abs(partsSum - mat) <= 50.0001

    if (usable) {
      for (const pt of parts) {
        krw += (num(pt.buyKrw) / (1 - tierMargin(pt.buyKrw, tiers))) * num(pt.qty)
      }
    } else if (mat > 0) {
      krw = mat / (1 - tierMargin(mat, tiers))
    }
    if (labor > 0) krw += labor / (1 - laborMarg)
  }

  return currency === 'KRW' ? Math.round(krw) : ceilCent(krw / (num(sellRate) || 1))
}

export default function QuoteSheet({ customerId, customerName, initialLine, cfg = DEFAULT_CFG, onClose, fixedKind }) {
  // ★ 매출견적(고객사 제출) / 매입견적(업체 수령) — 섞이면 안 되는 구분
  // fixedKind 가 주어지면 탭 자체가 한 종류 전용이므로 전환 버튼을 숨긴다.
  const [quoteKind, setQuoteKind] = useState(fixedKind || 'sales')
  const isSales = quoteKind === 'sales'

  const [currency, setCurrency] = useState('USD')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [issuedTo, setIssuedTo] = useState(customerName || '')
  const [vendorId, setVendorId] = useState('')
  const [attn, setAttn] = useState('')
  const [projectName, setProjectName] = useState('')
  const [validityDays, setValidityDays] = useState(15)
  const [leadTime, setLeadTime] = useState('L/T 8W')
  // 손으로 고치기 전까지는 품목 납기를 따라간다. 한 번 고치면 그 값을 지킨다.
  const [leadTouched, setLeadTouched] = useState(false)
  // 초도품 / 양산 — 담긴 품목에 초도품이 하나라도 있으면 초도품. 직접 고르면 그걸 지킨다.
  const [leadKind, setLeadKind] = useState('fa')
  const [leadKindTouched, setLeadKindTouched] = useState(false)
  const [deliveryNote, setDeliveryNote] = useState('(To be discussed later)')
  const [memo, setMemo] = useState('')

  const [lines, setLines] = useState([])
  const [addCode, setAddCode] = useState('')
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState({})
  const [savedNo, setSavedNo] = useState('')
  const [openParts, setOpenParts] = useState({})

  // 견적 담당자 — 매번 다시 치지 않도록 마지막 값을 기억한다
  const LS = 'pm_quote_contact'
  const saved0 = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } })()
  const [contactName, setContactName] = useState(saved0.name || '')
  const [contactPhone, setContactPhone] = useState(saved0.phone || '')
  const [contactEmail, setContactEmail] = useState(saved0.email || 'sales@jinsuntech.co.kr')
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ name: contactName, phone: contactPhone, email: contactEmail })) } catch {}
  }, [contactName, contactPhone, contactEmail])
  const [err, setErr] = useState('')

  const sellRate = num(cfg.sellRate) || 1250
  const qc = useQueryClient()

  // 마진 구간 · 작업비 마진 — 공용 설정(pm_settings). 없으면 기본값으로 돈다.
  const { data: mcfg = FALLBACK_MCFG } = useQuery({
    queryKey: ['quoteMarginCfg'],
    queryFn: async () => {
      const { data } = await supabase.from('pm_settings')
        .select('value').eq('key', 'quote_margin').maybeSingle()
      const v = data?.value || {}
      return {
        tiers: Array.isArray(v.tiers) && v.tiers.length ? v.tiers : DEFAULT_TIERS,
        laborMarg: Number.isFinite(Number(v.laborMarg)) ? Number(v.laborMarg) : DEFAULT_CFG.laborMarg,
      }
    },
    staleTime: 10 * 60 * 1000,
  })

  // 설정이 늦게 오거나 구간을 고치면 담겨 있는 줄의 단가를 다시 뽑는다.
  //   ⚠ mcfg 객체가 아니라 「내용」으로 비교한다. 창을 다시 켜서 같은 값을 또 받아올 때
  //     손으로 고쳐 둔 단가가 도로 계산되면 안 된다.
  const mcfgKey = JSON.stringify(mcfg)
  useEffect(() => {
    if (!isSales) return
    setLines((ls) => (ls.length ? ls.map((l) => ({ ...l, unitPrice: linePrice(l, currency, sellRate, mcfg) })) : ls))
  }, [mcfgKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 임시저장 (보관함) ────────────────────────────────────────────
  //   채번을 하지 않아 견적번호를 쓰지 않는다. 확정 저장할 때 비로소 번호가 붙는다.
  const [draftId, setDraftId] = useState(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const { data: drafts = [] } = useQuery({
    queryKey: ['quoteDrafts'],
    queryFn: async () => {
      const { data } = await supabase.from('pm_quote_drafts')
        .select('id,title,quote_kind,created_by,updated_at')
        .order('updated_at', { ascending: false }).limit(100)
      return data || []
    },
    staleTime: 60 * 1000,
  })

  // ── 마진 구간 설정 ──────────────────────────────────────────────
  const [cfgOpen, setCfgOpen] = useState(false)
  const [tierDraft, setTierDraft] = useState(null)
  function openCfg() {
    setTierDraft({
      tiers: (mcfg.tiers || DEFAULT_TIERS).map((t) => ({ min: t.min, pct: t.pct })),
      laborMarg: mcfg.laborMarg,
    })
    setCfgOpen(true)
  }

  const { data: vendors = [] } = useQuery({
    queryKey: ['quoteVendors'],
    queryFn: async () => {
      const { data } = await supabase.from('vendors').select('id, name').order('name')
      return data || []
    },
    staleTime: 10 * 60 * 1000,
  })

  useEffect(() => {
    if (!initialLine) return
    setLines([newLine(initialLine)])
    if (initialLine.std_code) setProjectName('RFQ_' + initialLine.std_code.replace(/^AX-/, ''))
  }, [initialLine])

  // 견적 이력 — 매출/매입을 나눠서 조회. 섞으면 원가와 판매가가 뒤엉킨다.
  const codeKey = lines.map((l) => l.std_code).join(',')
  useEffect(() => {
    const codes = lines.map((l) => l.std_code).filter(Boolean)
    if (!codes.length) { setHistory({}); return }
    let alive = true
    supabase.rpc('pm_quote_history', { p_codes: codes, p_kind: quoteKind }).then(({ data }) => {
      if (!alive || !data) return
      const m = {}
      data.forEach((d) => { m[d.std_code] = d })
      setHistory(m)
    })
    return () => { alive = false }
  }, [codeKey, quoteKind])

  // ── 라인 추가: 어셈블리면 BOM 전개 원가 + 최신 작업비, 아니면 단품 매입가 ──
  async function addByCode() {
    const code = AX(addCode)
    if (!code) return
    setAdding(true); setErr('')
    try {
      // ⚠ 조회 오류를 반드시 드러낸다. 삼키면 「하위품목이 없는 것」처럼 보인다.
      //   (v4.8.3 배포 중에 lt_days 칸이 지워져 부품이 0건으로 보였던 사례)
      const { data: proj, error: pErr } = await supabase
        .from('projects').select('id, code, name, rev')
        .eq('customer_id', customerId).eq('code', code).maybeSingle()
      if (pErr) throw new Error('어셈블리 조회 — ' + pErr.message)

      if (proj) {
        const { data: rows, error: bErr } = await supabase
          .from('bom')
          .select('level, qty_per_unit, seq, created_at, quote_excluded, items!bom_item_id_fkey(std_code, name, unit, manufacturer, manufacturer_code, purchase_price, lt_weeks, moq, vendors(name))')
          .eq('customer_id', customerId).eq('project_id', proj.id)
          .eq('quote_excluded', false)   // 원가분석에서 제외 지정한 부품은 견적에서도 빠진다
          .order('seq').order('created_at')
        if (bErr) throw new Error('하위품목 조회 — ' + bErr.message)

        const mapped = (rows || []).map((b, i) => ({
          uid: i, level: b.level, qty_per_unit: b.qty_per_unit,
          std_code: b.items?.std_code || '', name: b.items?.name || '', unit: b.items?.unit || '',
          manufacturer: b.items?.manufacturer || '',
          manufacturer_code: b.items?.manufacturer_code || '',
          purchase_price: b.items?.purchase_price ?? null,
          lt_weeks: b.items?.lt_weeks ?? null, moq: b.items?.moq ?? null,
          vendor: b.items?.vendors?.name || '',
          registered: !!b.items,
        }))
        // 작업비는 라인에서 따로 잡으므로 여기선 0 (= 자재비만 계산)
        const c = computeCost(explodeBOM(mapped), cfg, {}, 0)
        const noPrice = c.items.filter((r) => !r.excluded && r.status !== 'ok').length

        // 초도품 여부 — 생산 전광판이 쓰는 items.is_prototype 과 같은 기준
        const { data: pit, error: tErr } = await supabase.from('items')
          .select('is_prototype').eq('std_code', proj.code).maybeSingle()
        if (tErr) throw new Error('초도품 여부 조회 — ' + tErr.message)

        // 최신 작업비 자동 조회
        let laborKrw = 0, laborSrc = null
        const { data: lb, error: lErr } = await supabase.rpc('pm_labor_latest', { p_codes: [proj.code] })
        // 작업비는 없어도 견적은 짤 수 있다. 막지 말고 알리기만 한다.
        if (lErr) toastError('작업비 이력을 못 불러왔습니다 — 작업비를 직접 넣어 주세요 (' + lErr.message + ')')
        if (lb && lb[0]) { laborKrw = num(lb[0].labor_krw); laborSrc = lb[0] }

        const parts = c.items.map((r) => ({
          uid: r.uid, level: r.level, std_code: r.std_code, name: r.name,
          manufacturer: r.manufacturer || '', manufacturer_code: r.manufacturer_code || '',
          buyKrw: r.buyKrw, qty: r.qty, origin: r.origin, unit: r.unit || '',
          vendor: r.vendor || '', status: r.status, excluded: r.excluded,
          lt: r.lt_weeks ?? null, moq: r.moq ?? null,
        }))
        // 어셈블리 납기는 가장 늦게 들어오는 부품이 정한다 → 최장 L/T
        const ltMax = parts.reduce(
          (a, x) => (x.excluded || x.lt == null ? a : Math.max(a, num(x.lt))), 0)

        const nl = newLine({
          kind: 'assy',
          std_code: proj.code, description: proj.name || '', rev: proj.rev || '',
          unit: 'EA', qty: 1,
          materialKrw: round100(c.totalBuyKrw), laborKrw, laborSrc,
          origin: c.impKrw > c.domKrw ? 'imp' : 'dom',
          noPrice, partCount: c.items.length,
          lt: ltMax || null,
          proto: !!pit?.is_prototype,
          // 세부견적용 부품 목록 — 화면에서 제외·단가 조정 가능
          parts,
        })
        nl.unitPrice = isSales ? linePrice(nl, currency, sellRate, mcfg) : 0
        setLines((ls) => [...ls, nl])
        setAddCode('')
        return
      }

      const { data, error: iErr } = await supabase
        .from('items').select('std_code, name, unit, purchase_price, lt_weeks, moq, is_prototype, vendors(name)')
        .eq('std_code', code).maybeSingle()
      // 조회가 실패한 것과 정말 없는 것을 구분한다. 전에는 둘 다 「어디에도 없습니다」였다.
      if (iErr) throw new Error('품목 조회 — ' + iErr.message)
      if (!data) { setErr(`${code} 는 어셈블리·품목 어디에도 없습니다.`); return }
      const mat = num(data.purchase_price)
      const nl = newLine({
        kind: 'item',
        std_code: data.std_code, description: data.name || '',
        unit: data.unit || 'EA', qty: 1,
        materialKrw: mat, vendor: data.vendors?.name || '',
        noPrice: mat > 0 ? 0 : 1, partCount: 1,
        lt: data.lt_weeks ?? null, moq: data.moq ?? null,
        proto: !!data.is_prototype,
      })
      nl.unitPrice = isSales ? linePrice(nl, currency, sellRate, mcfg) : 0
      setLines((ls) => [...ls, nl])
      setAddCode('')
    } catch (e) {
      setErr('조회 실패: ' + e.message)
    } finally { setAdding(false) }
  }

  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))

  // 자재비·작업비를 고치면 매출단가를 다시 산출.
  // 매입견적은 단가가 업체 제시가라 건드리지 않는다.
  const patchCost = (key, p) => setLines((ls) => ls.map((l) => {
    if (l.key !== key) return l
    const n = { ...l, ...p }
    return isSales ? { ...n, unitPrice: linePrice(n, currency, sellRate, mcfg) } : n
  }))

  // 세부 부품 수정 → 자재비 재합산 → 최장 L/T 재산출 → 매출단가 재산출
  const patchPart = (key, uid, p) => setLines((ls) => ls.map((l) => {
    if (l.key !== key || !l.parts) return l
    const parts = l.parts.map((x) => (x.uid === uid ? { ...x, ...p } : x))
    const materialKrw = round100(sumParts(parts))
    const noPrice = parts.filter((x) => !x.excluded && (x.buyKrw == null || x.status === 'unreg')).length
    // 부품 L/T 를 고치거나 체크를 풀면 어셈블리 납기도 따라 바뀌어야 한다.
    const ltMax = parts.reduce((a, x) => (x.excluded || x.lt == null ? a : Math.max(a, num(x.lt))), 0)
    const n = { ...l, parts, materialKrw, noPrice, lt: ltMax || null }
    return isSales ? { ...n, unitPrice: linePrice(n, currency, sellRate, mcfg) } : n
  }))

  const remove = (key) => setLines((ls) => ls.filter((l) => l.key !== key))

  function switchCurrency(next) {
    setCurrency(next)
    if (!isSales) return
    setLines((ls) => ls.map((l) => ({ ...l, unitPrice: linePrice(l, next, sellRate, mcfg) })))
  }

  function switchKind(next) {
    setQuoteKind(next)
    setSavedNo(''); setErr('')
    if (next === 'sales') {
      setLines((ls) => ls.map((l) => ({ ...l, unitPrice: linePrice(l, currency, sellRate, mcfg) })))
    }
  }

  // 어셈블리든 단품이든 가장 늦게 들어오는 것이 전체 납기를 정한다.
  // items.lt_weeks 는 주 단위라 바로 쓴다.
  const ltWeeks = lines.reduce((a, l) => Math.max(a, num(l.lt)), 0)

  const anyProto = lines.some((l) => l.proto)
  useEffect(() => {
    if (leadKindTouched || !lines.length) return
    setLeadKind(anyProto ? 'fa' : 'mp')
  }, [anyProto, lines.length, leadKindTouched])

  // 납기 = 기본값(초도품 8W · 양산 6W) 과 부품 최장 L/T 중 긴 쪽.
  //   가장 늦게 오는 부품보다 빨리 낼 수는 없다.
  //   ⚠ 사용자가 Lead Time 을 직접 고쳤으면 건드리지 않는다.
  const baseWeeks = LEAD_BASE[leadKind] || LEAD_BASE.fa
  const autoWeeks = Math.max(baseWeeks, ltWeeks)
  const autoLead = `L/T ${autoWeeks}W`
  useEffect(() => {
    if (leadTouched) return
    setLeadTime(autoLead)
  }, [autoLead, leadTouched])

  const totals = useMemo(() => {
    const amount = lines.reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0)
    const materialKrw = lines.reduce((a, l) => a + num(l.qty) * num(l.materialKrw), 0)
    const laborKrw = lines.reduce((a, l) => a + num(l.qty) * num(l.laborKrw), 0)
    const costKrw = materialKrw + laborKrw
    const revenueKrw = currency === 'KRW' ? amount : amount * sellRate
    const marginKrw = revenueKrw - costKrw
    const marginPct = revenueKrw > 0 ? marginKrw / revenueKrw : 0
    return { amount, materialKrw, laborKrw, costKrw, revenueKrw, marginKrw, marginPct }
  }, [lines, currency, sellRate])

  // L/T·MOQ 는 품목 마스터(items)에 바로 저장한다.
  //   ⚠ 매입가와 다르다. 매입가는 이 견적에만 적용되고 마스터를 바꾸지 않는다.
  async function saveItemField(stdCode, patchObj) {
    if (!stdCode) return
    const { error } = await supabase.from('items').update(patchObj).eq('std_code', stdCode)
    if (error) toastError('L/T·MOQ 저장 실패: ' + error.message)
  }

  const draftPayload = () => ({
    v: 1, quoteKind, currency, quoteDate, issuedTo, vendorId, attn, projectName,
    validityDays, leadTime, leadKind, deliveryNote, memo, lines, customerId, customerName,
  })

  const draftMut = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('품목이 없습니다.')
      const { data: { user } } = await supabase.auth.getUser()
      const row = {
        title: projectName || lines[0]?.std_code || '(제목 없음)',
        quote_kind: quoteKind, customer_id: customerId || null,
        payload: draftPayload(), updated_at: new Date().toISOString(),
      }
      if (draftId) {
        const { error } = await supabase.from('pm_quote_drafts').update(row).eq('id', draftId)
        if (error) throw error
        return draftId
      }
      row.created_by = user?.email || null
      const { data, error } = await supabase.from('pm_quote_drafts').insert(row).select('id').single()
      if (error) throw error
      return data.id
    },
    onSuccess: (id) => {
      setDraftId(id); setErr('')
      toastSuccess('보관함에 넣었습니다 — 다른 PC 에서도 이어서 할 수 있습니다')
      qc.invalidateQueries({ queryKey: ['quoteDrafts'] })
    },
    onError: (e) => setErr('임시저장 실패: ' + e.message),
  })

  const draftDelMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('pm_quote_drafts').delete().eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      if (id === draftId) setDraftId(null)
      qc.invalidateQueries({ queryKey: ['quoteDrafts'] })
      toastSuccess('보관함에서 지웠습니다')
    },
    onError: (e) => toastError('삭제 실패: ' + e.message),
  })

  async function loadDraft(id) {
    const { data, error } = await supabase.from('pm_quote_drafts')
      .select('*').eq('id', id).maybeSingle()
    if (error || !data) { setErr('불러오기 실패: ' + (error?.message || '없는 항목')); return }
    const d = data.payload || {}
    setQuoteKind(d.quoteKind || 'sales')
    setCurrency(d.currency || 'USD')
    setQuoteDate(d.quoteDate || todayISO())
    setIssuedTo(d.issuedTo || '')
    setVendorId(d.vendorId || '')
    setAttn(d.attn || '')
    setProjectName(d.projectName || '')
    setValidityDays(d.validityDays ?? 15)
    setLeadTime(d.leadTime || 'L/T 8W'); setLeadTouched(true)
    setLeadKind(d.leadKind || 'fa'); setLeadKindTouched(true)
    setDeliveryNote(d.deliveryNote || '(To be discussed later)')
    setMemo(d.memo || '')
    setLines(Array.isArray(d.lines) ? d.lines : [])
    setDraftId(id); setSavedNo(''); setErr(''); setDraftOpen(false)
    toastSuccess('보관해 둔 견적을 불러왔습니다')
  }

  const cfgMut = useMutation({
    mutationFn: async (v) => {
      const tiers = (v.tiers || [])
        .map((t) => ({ min: num(t.min), pct: num(t.pct) }))
        .filter((t) => t.pct > 0 && t.pct < 1)
        .sort((a, b) => b.min - a.min)
      if (!tiers.length) throw new Error('구간이 하나도 없습니다.')
      if (!tiers.some((t) => t.min === 0)) throw new Error('맨 아래 구간(0원 이상)이 있어야 합니다.')
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('pm_settings').upsert({
        key: 'quote_margin',
        value: { tiers, laborMarg: num(v.laborMarg) },
        updated_at: new Date().toISOString(), updated_by: user?.email || null,
      }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => {
      setCfgOpen(false)
      qc.invalidateQueries({ queryKey: ['quoteMarginCfg'] })
      toastSuccess('마진 구간을 저장했습니다 — 담겨 있는 줄의 단가가 다시 계산됩니다')
    },
    onError: (e) => toastError('마진 구간 저장 실패: ' + e.message),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('품목이 없습니다.')
      if (!isSales && !vendorId) throw new Error('매입견적은 업체를 선택해야 합니다.')

      const { data: no, error: nErr } = await supabase.rpc('pm_next_quote_no', {
        p_date: quoteDate, p_kind: quoteKind,
      })
      if (nErr) throw new Error('견적번호 채번 실패: ' + nErr.message)

      const { data: q, error: qErr } = await supabase.from('pm_quotes').insert({
        quote_no: no, quote_kind: quoteKind, quote_date: quoteDate,
        customer_id: isSales ? (customerId || null) : null,
        vendor_id: isSales ? null : (vendorId || null),
        quote_type: lines.some((l) => l.kind === 'assy') ? 'assy' : 'single',
        currency, project_name: projectName || null,
        issued_to: isSales ? (issuedTo || null) : (vendors.find((v) => v.id === vendorId)?.name || null),
        attn: attn || null, validity_days: num(validityDays) || null,
        lead_time: leadTime || null, delivery_note: deliveryNote || null,
        buy_rate: num(cfg.buyRate) || null, sell_rate: sellRate,
        labor_krw: totals.laborKrw,
        total_amount: totals.amount,
        total_cost_krw: isSales ? totals.costKrw : null,
        margin_pct: isSales ? totals.marginPct : null,
        memo: memo || null,
        issuer_name: contactName || null,
        issuer_phone: contactPhone || null,
        issuer_email: contactEmail || null,
      }).select('id, quote_no').single()
      if (qErr) throw new Error('견적 저장 실패: ' + qErr.message)

      const rows = lines.map((l, i) => ({
        quote_id: q.id, line_no: i + 1, line_kind: l.kind,
        std_code: l.std_code || null, description: l.description || null,
        rev: l.rev || null, unit: l.unit || 'EA', qty: num(l.qty),
        unit_price: num(l.unitPrice), alternative: l.alternative || null,
        remarks: l.remarks || null,
        material_krw: num(l.materialKrw) || null,
        labor_krw: num(l.laborKrw) || 0,
        cost_krw: lineCost(l) || null,
        vendor: l.vendor || null, origin: l.origin || null,
        margin_pct: l.marginPct != null ? num(l.marginPct) : null,
      }))
      const { error: iErr } = await supabase.from('pm_quote_items').insert(rows)
      if (iErr) throw new Error('견적 품목 저장 실패: ' + iErr.message)

      // 작업비 이력 축적 — 다음 견적에서 자동으로 불러온다
      const labor = lines
        .filter((l) => l.kind === 'assy' && l.std_code && num(l.laborKrw) > 0)
        .map((l) => ({
          std_code: l.std_code, labor_krw: num(l.laborKrw),
          effective_date: quoteDate, source: 'quote', quote_no: no,
        }))
      if (labor.length) {
        // 오류를 삼키면 저장이 안 돼도 모른 채 넘어간다.
        //   실제로 유니크 제약이 없어 작업비가 쌓이지 않은 적이 있다.
        const { error: lErr } = await supabase.from('pm_labor_costs')
          .upsert(labor, { onConflict: 'std_code,effective_date,source,quote_no' })
        if (lErr) toastError('작업비 이력 저장 실패: ' + lErr.message)
      }
      return no
    },
    onSuccess: (no) => {
      setSavedNo(no); setErr('')
      // 확정됐으니 보관함에 남겨 둘 이유가 없다.
      if (draftId) {
        supabase.from('pm_quote_drafts').delete().eq('id', draftId).then(() => {
          setDraftId(null); qc.invalidateQueries({ queryKey: ['quoteDrafts'] })
        })
      }
    },
    onError: (e) => setErr(e.message),
  })

  function doPrint() {
    document.body.classList.add('printing-quote')
    const done = () => {
      document.body.classList.remove('printing-quote')
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    setTimeout(() => window.print(), 60)
  }

  async function doExcel() {
    const cur = currency
    const kindLabel = isSales ? '매출견적' : '매입견적'

    const detailRows = lines.map((l, i) => ({
      NO: i + 1, 구분: l.kind === 'assy' ? 'ASSY' : '단품',
      품번: l.std_code, 품명: l.description, REV: l.rev, 수량: num(l.qty),
      '자재비(원)': num(l.materialKrw),
      '작업비(원)': num(l.laborKrw),
      '원가계(원)': lineCost(l),
      '원가합계(원)': num(l.qty) * lineCost(l),
      // 실제로 붙은 마진율. 구간으로 되짚지 않는다 —
      //   부품마다 구간이 달라 한 값으로 되짚을 수 없고, 단가를 손으로 고쳤을 수도 있다.
      마진율: (() => {
        if (!isSales) return ''
        const rev = currency === 'KRW' ? num(l.unitPrice) : num(l.unitPrice) * sellRate
        return rev > 0 ? (rev - lineCost(l)) / rev : ''
      })(),
      [`단가(${cur})`]: num(l.unitPrice),
      [`합계(${cur})`]: num(l.qty) * num(l.unitPrice),
      구매처: l.vendor,
      '수입/내수': l.origin === 'imp' ? '수입' : '내수',
      직전견적: history[l.std_code]
        ? `${history[l.std_code].unit_price} ${history[l.std_code].currency} (${history[l.std_code].quote_date})` : '',
    }))

    const bomRows = []
    lines.forEach((l, i) => {
      if (!l.parts) return
      l.parts.forEach((pt) => bomRows.push({
        라인: i + 1, 어셈블리: l.std_code,
        LV: pt.level, 품번: pt.std_code, 품명: pt.name,
        제조사: pt.manufacturer || '', 제조사품번: pt.manufacturer_code || '',
        '매입가(원)': pt.buyKrw == null ? '' : num(pt.buyKrw),
        전개수량: num(pt.qty),
        '소계(원)': pt.excluded || pt.buyKrw == null ? 0 : num(pt.buyKrw) * num(pt.qty),
        '수입/내수': pt.origin === 'imp' ? '수입' : '내수',
        구매처: pt.vendor || '',
        포함: pt.excluded ? '제외' : 'O',
      }))
    })

    const infoRows = [
      { 항목: '견적구분', 값: kindLabel },
      { 항목: '견적번호', 값: savedNo || '(미저장)' },
      { 항목: '견적일', 값: quoteDate },
      { 항목: isSales ? 'Issued to' : '업체', 값: isSales ? issuedTo : (vendors.find((v) => v.id === vendorId)?.name || '') },
      { 항목: '담당자', 값: contactName },
      { 항목: '통화', 값: cur },
      { 항목: '판매환율', 값: sellRate },
      { 항목: '자재비 합계(원)', 값: Math.round(totals.materialKrw) },
      { 항목: '작업비 합계(원)', 값: Math.round(totals.laborKrw) },
      { 항목: '원가 합계(원)', 값: Math.round(totals.costKrw) },
      ...(isSales ? [
        { 항목: '매출(원)', 값: Math.round(totals.revenueKrw) },
        { 항목: '마진(원)', 값: Math.round(totals.marginKrw) },
        { 항목: '마진율', 값: pct(totals.marginPct) },
      ] : []),
    ]

    try {
      await downloadQuoteExcel({
        head: {
          quoteNo: savedNo, quoteDate, currency: cur,
          issuedTo: isSales ? issuedTo : (vendors.find((v) => v.id === vendorId)?.name || ''),
          attn, projectName, validityDays, validUntil,
          leadTime, deliveryNote, memo,
          contactName, contactPhone, contactEmail,
        },
        lines, totals,
        extra: { detailRows, bomRows, infoRows },
        fileName: `${kindLabel}_${savedNo || projectName || todayISO()}.xlsx`,
      })
    } catch (e) {
      setErr('엑셀 생성 실패: ' + e.message)
    }
  }

  const sym = currency === 'KRW' ? '₩' : '$'
  const validUntil = (() => {
    const d = new Date(quoteDate); d.setDate(d.getDate() + (num(validityDays) || 0))
    return d.toISOString().slice(0, 10)
  })()

  return (
    <div className="quote-root space-y-3">
      <style>{`
        @media print {
          html, body { height:auto !important; overflow:visible !important; }
          body.printing-quote * { visibility: hidden !important; }
          body.printing-quote .quote-print-area,
          body.printing-quote .quote-print-area * { visibility: visible !important; }
          body.printing-quote .quote-print-area {
            position: absolute; left:0; top:0; width:100%; padding:12mm; background:#fff;
          }
          body.printing-quote .no-print { display: none !important; }
          /* 품목 열이 많아 세로로는 좁다. 가로로 낸다. */
          @page { size: A4 landscape; margin: 0; }
        }
        .qi{border:0;border-bottom:1px solid #e2e8f0;padding:2px 4px;font-size:12px;outline:none;background:transparent}
        .qi:focus{border-bottom-color:#6366f1}
        @media print{.qi{border:0}}
      `}</style>

      {/* 매출/매입 구분 — 색으로 확실히 갈라둔다 */}
      <div className={`no-print rounded-xl border-2 p-3 ${isSales ? 'border-indigo-300 bg-indigo-50/50' : 'border-amber-400 bg-amber-50/60'}`}>
        <div className="flex flex-wrap items-center gap-2">
          {fixedKind ? (
            <span className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white ${isSales ? 'bg-indigo-600' : 'bg-amber-500'}`}>
              {isSales ? '📤 매출견적' : '📥 매입견적'}
            </span>
          ) : (
            <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200">
              {[['sales', '📤 매출견적', '고객사에 제출'], ['purchase', '📥 매입견적', '업체에서 수령']].map(([k, l, t]) => (
                <button key={k} onClick={() => switchKind(k)} title={t}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md ${quoteKind === k
                    ? (k === 'sales' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-white')
                    : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
              ))}
            </div>
          )}

          {isSales ? (
            <span className="text-xs text-indigo-700 font-semibold">우리가 고객사에 주는 가격 · 마진 관리 대상</span>
          ) : (
            <>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                className="px-3 py-1.5 text-xs border border-amber-300 rounded-lg bg-white min-w-[180px]">
                <option value="">업체 선택…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <span className="text-xs text-amber-800 font-semibold">업체가 우리에게 준 가격 · 원가 근거로 보관</span>
            </>
          )}
        </div>
      </div>

      {/* 조작부 */}
      <div className="no-print flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['USD', 'KRW'].map((c) => (
            <button key={c} onClick={() => switchCurrency(c)}
              className={`px-3 py-1 text-xs font-bold rounded-md ${currency === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{c}</button>
          ))}
        </div>
        <input value={addCode} onChange={(e) => setAddCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addByCode()}
          placeholder="품번 입력 (ASSY·단품 자동 판별)"
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56" />
        <button onClick={addByCode} disabled={adding}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          {adding ? '조회 중…' : '+ 추가'}
        </button>
        <button onClick={() => setLines((ls) => [...ls, newLine()])}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">+ 빈 줄</button>
        <button onClick={openCfg} title="금액대별 마진율을 고칩니다"
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">⚙ 마진구간</button>
        <div className="flex-1" />
        <button onClick={() => draftMut.mutate()} disabled={draftMut.isPending || !lines.length}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">
          {draftMut.isPending ? '보관 중…' : draftId ? '📝 보관 갱신' : '📝 임시저장'}
        </button>
        <button onClick={() => setDraftOpen(true)}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
          📂 보관함{drafts.length ? ` ${drafts.length}` : ''}
        </button>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !lines.length}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white disabled:opacity-40 ${isSales ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
          {saveMut.isPending ? '저장 중…' : '💾 저장'}
        </button>
        <button onClick={doPrint} disabled={!lines.length}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">🖨 인쇄</button>
        <button onClick={doExcel} disabled={!lines.length}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">📑 엑셀</button>
        {onClose && <button onClick={onClose} className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600">✕ 닫기</button>}
      </div>

      {err && <div className="no-print rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}
      {savedNo && (
        <div className="no-print rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 font-semibold">
          ✅ 저장 완료 — {isSales ? '매출' : '매입'}견적 <b>{savedNo}</b>
          {isSales && totals.laborKrw > 0 && ' · 작업비가 이력에 기록되어 다음 견적에서 자동으로 불러옵니다.'}
        </div>
      )}

      {draftId && !savedNo && (
        <div className="no-print rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          📝 보관함에 들어 있는 견적입니다 — <b>아직 견적번호가 붙지 않았습니다.</b> 확정하려면 <b>💾 저장</b> 을 누르세요.
        </div>
      )}

      {isSales && (() => {
        const n = lines.reduce((a, l) => a + num(l.noPrice), 0)
        if (!n) return null
        return (
          <div className="no-print rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ 매입가가 등록되지 않은 부품 <b>{n}건</b>이 포함돼 있습니다.
            원가 합산에서 빠지므로 <b>실제 마진은 표시값보다 낮습니다.</b>
          </div>
        )
      })()}

      {/* 요약 (내부용) */}
      <div className="no-print grid grid-cols-2 md:grid-cols-5 gap-2">
        <Mini label={isSales ? '견적 합계' : '매입 합계'} value={sym + money(totals.amount, currency)} />
        <Mini label="자재비" value={won(totals.materialKrw) + '원'} />
        <Mini label="작업비" value={won(totals.laborKrw) + '원'} accent="sky" />
        {isSales ? (
          <>
            <Mini label="마진" value={won(totals.marginKrw) + '원'} accent={totals.marginKrw >= 0 ? 'emerald' : 'rose'} />
            <Mini label="마진율" value={pct(totals.marginPct)} accent={totals.marginPct >= 0.2 ? 'emerald' : 'amber'} />
          </>
        ) : (
          <>
            <Mini label="원가 계" value={won(totals.costKrw) + '원'} />
            <Mini label="구분" value="매입견적" accent="amber" />
          </>
        )}
      </div>

      {/* ── 인쇄 영역 ── */}
      <div className="quote-print-area bg-white border border-slate-200 rounded-xl p-6">
        <div className="text-center mb-4">
          <h2 className="text-3xl font-bold tracking-widest text-slate-900">
            {isSales ? 'QUOTE' : 'PURCHASE QUOTE (수령)'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">NO : {savedNo || '(저장 시 자동 부여)'} · {quoteDate}</p>
        </div>

        {/* Issued by / Supplier */}
        <div className="grid grid-cols-2 gap-6 mb-4 text-xs">
          <div>
            <div className="font-bold text-sm text-slate-800 border-b border-slate-300 pb-1 mb-2">Issued by</div>
            {isSales
              ? <input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)}
                  className="qi w-full font-bold text-sm" placeholder="AXCELIS Corp." />
              : <div className="font-bold text-sm">{vendors.find((v) => v.id === vendorId)?.name || '(업체 미선택)'}</div>}
            <div className="flex gap-1 mt-1.5">
              <span className="text-slate-400 w-10 shrink-0">Attn</span>
              <input value={attn} onChange={(e) => setAttn(e.target.value)} className="qi flex-1" placeholder="담당자명" />
            </div>
            <p className="mt-3 text-slate-600">We hereby provide the following quotation:</p>
            <p className="text-slate-500">Quotation Validity: {validityDays} days from the date of the quotation</p>
          </div>

          <div>
            <div className="font-bold text-sm text-slate-800 border-b border-slate-300 pb-1 mb-2">Supplier</div>
            <div className="text-slate-600 leading-relaxed">
              <div>Company : {SUPPLIER.company}</div>
              <div>Business registration number : {SUPPLIER.bizNo}</div>
              <div>CEO : {SUPPLIER.ceo}</div>
              <div>Adress : {SUPPLIER.address}</div>
              <div>Business Type : {SUPPLIER.bizType}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <span>Contact :</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                  className="qi w-28" placeholder="담당자명" />
                <span>(</span>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                  className="qi w-36" placeholder="82+10-0000-0000" />
                <span>)</span>
              </div>
              <div>Tel : {SUPPLIER.tel}   Fax : {SUPPLIER.fax}</div>
              <div className="flex items-center gap-1">
                <span>E-Mail :</span>
                <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className="qi flex-1" placeholder="sales@jinsuntech.co.kr" />
              </div>
              <div className="text-slate-400">{SUPPLIER.invoiceEmail} (Invoice)</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs mb-4">
          <Row label="Date"><input value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} type="date" className="qi" /></Row>
          <Row label="Currency"><span className="font-bold">{currency}</span></Row>
          <Row label="Project Name"><input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="qi" placeholder="RFQ_110228078" /></Row>
          <Row label="Validity">
            <input type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} className="qi w-16" />
            <span className="ml-1 text-slate-400">days ({validUntil})</span>
          </Row>
          <Row label="Delivery"><input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} className="qi flex-1" /></Row>
        </div>

        <table className="w-full text-xs border-t-2 border-slate-800">
          <thead>
            <tr className="border-b border-slate-300 text-slate-500">
              <th className="py-2 w-8 text-left">NO</th>
              <th className="py-2 text-left">Item no.</th>
              <th className="py-2 text-left">Description</th>
              <th className="py-2 w-12 text-center">REV</th>
              <th className="py-2 w-12 text-center">Unit</th>
              <th className="py-2 w-14 text-right">Q'ty</th>
              <th className="py-2 w-24 text-right">Unit Price</th>
              <th className="py-2 w-24 text-right">Amount</th>
              <th className="py-2 w-12 text-center">Alt.</th>
              <th className="py-2 w-20 text-left">Remarks</th>
              <th className="py-2 w-24 text-right no-print">자재비(원)</th>
              <th className="py-2 w-24 text-right no-print">작업비(원)</th>
              <th className="py-2 w-12 text-right no-print">마진</th>
              <th className="py-2 w-6 no-print"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const h = history[l.std_code]
              const cost = lineCost(l)
              const revKrw = currency === 'KRW' ? num(l.unitPrice) : num(l.unitPrice) * sellRate
              return (
                <>
                <tr key={l.key} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 text-slate-400">{i + 1}</td>
                  <td className="py-1.5">
                    <input value={l.std_code} onChange={(e) => patch(l.key, { std_code: e.target.value })} className="qi font-mono w-full" />
                    {l.kind === 'assy' && <span className="no-print text-[10px] font-bold text-sky-600">ASSY</span>}
                    {/* 어셈블리는 부품에서 뽑은 최장 납기를 보여주기만 하고,
                        단품은 여기가 유일한 입력 자리라 직접 적을 수 있게 둔다. */}
                    {l.kind === 'assy' ? (
                      (l.lt != null || l.moq != null) && (
                        <div className="no-print text-[10px] text-slate-400 mt-0.5 flex gap-1.5">
                          {l.lt != null && (
                            <span title="부품 중 가장 긴 납기">
                              L/T {l.lt}W<span className="text-slate-300"> 최장</span>
                            </span>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="no-print text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <span>L/T</span>
                        <input type="number" value={l.lt ?? ''} placeholder="-"
                          title="표준 납기(주) — 적으면 품목 마스터에 저장됩니다"
                          onChange={(e) => patch(l.key, {
                            lt: e.target.value === '' ? null : Number(e.target.value) })}
                          onBlur={(e) => saveItemField(l.std_code, {
                            lt_weeks: e.target.value === '' ? null : Number(e.target.value) })}
                          className="qi w-9 text-right" />
                        <span>W · MOQ</span>
                        <input type="number" value={l.moq ?? ''} placeholder="-"
                          title="최소 주문수량 — 적으면 품목 마스터에 저장됩니다"
                          onChange={(e) => patch(l.key, {
                            moq: e.target.value === '' ? null : Number(e.target.value) })}
                          onBlur={(e) => saveItemField(l.std_code, {
                            moq: e.target.value === '' ? null : Number(e.target.value) })}
                          className={`qi w-11 text-right ${
                            l.moq != null && num(l.qty) > 0 && num(l.qty) < num(l.moq)
                              ? 'text-amber-600 font-bold' : ''}`} />
                        {l.moq != null && num(l.qty) > 0 && num(l.qty) < num(l.moq) && (
                          <span className="text-amber-600 font-bold" title={`최소 ${l.moq} 이상`}>⚠ 미달</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5">
                    <input value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} className="qi w-full" />
                    {h && (
                      <div className="no-print text-[10px] text-indigo-500 mt-0.5">
                        직전 {money(h.unit_price, h.currency)} {h.currency} · {h.quote_date} ({h.quote_no})
                        {num(h.labor_krw) > 0 && ` · 작업비 ${won(h.labor_krw)}`}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5"><input value={l.rev} onChange={(e) => patch(l.key, { rev: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input type="number" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} className="qi w-full text-right" /></td>
                  <td className="py-1.5"><input type="number" step="0.01" value={l.unitPrice} onChange={(e) => patch(l.key, { unitPrice: e.target.value })} className="qi w-full text-right font-semibold" /></td>
                  <td className="py-1.5 text-right font-bold">{sym}{money(num(l.qty) * num(l.unitPrice), currency)}</td>
                  <td className="py-1.5"><input value={l.alternative} onChange={(e) => patch(l.key, { alternative: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input value={l.remarks} onChange={(e) => patch(l.key, { remarks: e.target.value })} className="qi w-full" /></td>

                  <td className="py-1.5 no-print text-right">
                    <input type="text" inputMode="numeric"
                      value={l.materialKrw ? Number(l.materialKrw).toLocaleString('ko-KR') : ''}
                      onChange={(e) => patchCost(l.key, {
                        materialKrw: Number(String(e.target.value).replace(/[^0-9.]/g, '')) || 0,
                      })}
                      placeholder="0"
                      className="qi w-full text-right" />
                    {l.kind === 'assy' && (
                      <button type="button"
                        onClick={() => setOpenParts((o) => ({ ...o, [l.key]: !o[l.key] }))}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 mt-0.5 underline">
                        {openParts[l.key] ? '▲ 접기' : `▼ 부품 ${l.partCount}`}
                        {l.noPrice > 0 && <span className="text-amber-600 font-bold"> · 단가없음 {l.noPrice}</span>}
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 no-print text-right">
                    {l.kind === 'assy' ? (
                      <>
                        {/* number 입력란은 쉼표를 못 받는다.
                            글자로 받고 숫자만 남겨 저장한다. */}
                        <input type="text" inputMode="numeric"
                          value={l.laborKrw ? Number(l.laborKrw).toLocaleString('ko-KR') : ''}
                          onChange={(e) => patchCost(l.key, {
                            laborKrw: Number(String(e.target.value).replace(/[^0-9.]/g, '')) || 0,
                          })}
                          placeholder="0"
                          className="qi w-full text-right" />
                        {l.laborSrc && (
                          <div className="text-[10px] text-sky-600 mt-0.5" title={`출처 ${l.laborSrc.source}`}>
                            이력 {won(l.laborSrc.labor_krw)} · {l.laborSrc.effective_date}
                          </div>
                        )}
                      </>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="py-1.5 no-print text-right text-slate-500">
                    {isSales && revKrw > 0 ? pct((revKrw - cost) / revKrw) : '-'}
                  </td>
                  <td className="py-1.5 no-print"><button onClick={() => remove(l.key)} className="text-slate-300 hover:text-rose-500">✕</button></td>
                </tr>
                {openParts[l.key] && l.parts && (
                  <tr key={l.key + '-p'} className="no-print bg-slate-50/80">
                    <td colSpan={14} className="px-3 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-bold text-slate-500">
                          세부견적 — {l.std_code} 부품 {l.parts.length}건
                          <span className="ml-2 font-normal text-slate-400">
                            체크 해제하면 원가에서 빠지고, 매입가를 고치면 견적단가가 다시 계산됩니다.
                          </span>
                        </p>
                        <span className="text-[11px] font-bold text-slate-700">자재비 {won(l.materialKrw)}원</span>
                      </div>
                      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead className="bg-slate-50 text-slate-400 sticky top-0">
                            <tr>
                              <th className="px-2 py-1.5 w-10 text-center">포함</th>
                              <th className="px-2 py-1.5 w-10 text-left">LV</th>
                              <th className="px-2 py-1.5 text-left">품번</th>
                              <th className="px-2 py-1.5 text-left">품명</th>
                              <th className="px-2 py-1.5 w-28 text-left">제조사</th>
                              <th className="px-2 py-1.5 w-32 text-left">제조사품번</th>
                              <th className="px-2 py-1.5 w-24 text-right">매입가(원)</th>
                              <th className="px-2 py-1.5 w-16 text-right">수량</th>
                              <th className="px-2 py-1.5 w-12 text-center">단위</th>
                              <th className="px-2 py-1.5 w-16 text-right" title="발주 후 입고까지 걸리는 주 수">L/T(주)</th>
                              <th className="px-2 py-1.5 w-16 text-right" title="최소 주문수량">MOQ</th>
                              <th className="px-2 py-1.5 w-24 text-right">소계(원)</th>
                              <th className="px-2 py-1.5 w-14 text-center">구분</th>
                              <th className="px-2 py-1.5 w-28 text-left">구매처</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.parts.map((pt) => (
                              <tr key={pt.uid}
                                className={`border-t border-slate-100 ${pt.excluded ? 'opacity-40' : ''} ${
                                  pt.status === 'unreg' ? 'bg-rose-50' : pt.buyKrw == null ? 'bg-amber-50' : ''}`}>
                                <td className="px-2 py-1 text-center">
                                  <input type="checkbox" checked={!pt.excluded}
                                    onChange={() => patchPart(l.key, pt.uid, { excluded: !pt.excluded })} />
                                </td>
                                <td className="px-2 py-1 text-slate-400">L{pt.level}</td>
                                <td className="px-2 py-1 font-mono text-slate-700"
                                  style={{ paddingLeft: `${8 + (Number(pt.level) || 0) * 10}px` }}>{pt.std_code || '—'}</td>
                                <td className="px-2 py-1 text-slate-600 max-w-[220px] truncate" title={pt.name}>{pt.name}</td>
                                <td className="px-2 py-1 text-slate-500 truncate" title={pt.manufacturer}>{pt.manufacturer || '-'}</td>
                                <td className="px-2 py-1 font-mono text-slate-500 truncate" title={pt.manufacturer_code}>{pt.manufacturer_code || '-'}</td>
                                <td className="px-2 py-1 text-right">
                                  <input type="number" value={pt.buyKrw ?? ''}
                                    onChange={(e) => patchPart(l.key, pt.uid, {
                                      buyKrw: e.target.value === '' ? null : Number(e.target.value),
                                      status: e.target.value === '' ? 'noprice' : 'ok',
                                    })}
                                    placeholder="미등록"
                                    className="qi w-full text-right" />
                                </td>
                                <td className="px-2 py-1 text-right text-slate-500">{pt.qty}</td>
                                <td className="px-2 py-1 text-center text-slate-400">{pt.unit || '-'}</td>
                                <td className="px-2 py-1 text-right">
                                  <input type="number" value={pt.lt ?? ''} placeholder="-"
                                    onChange={(e) => patchPart(l.key, pt.uid, {
                                      lt: e.target.value === '' ? null : Number(e.target.value) })}
                                    onBlur={(e) => saveItemField(pt.std_code, {
                                      lt_weeks: e.target.value === '' ? null : Number(e.target.value) })}
                                    className="qi w-full text-right" />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input type="number" value={pt.moq ?? ''} placeholder="-"
                                    onChange={(e) => patchPart(l.key, pt.uid, {
                                      moq: e.target.value === '' ? null : Number(e.target.value) })}
                                    onBlur={(e) => saveItemField(pt.std_code, {
                                      moq: e.target.value === '' ? null : Number(e.target.value) })}
                                    className={`qi w-full text-right ${
                                      pt.moq != null && num(pt.qty) * num(l.qty) < num(pt.moq)
                                        ? 'text-amber-600 font-bold' : ''}`} />
                                </td>
                                <td className="px-2 py-1 text-right font-semibold">
                                  {pt.excluded || pt.buyKrw == null ? '—' : won(num(pt.buyKrw) * num(pt.qty))}
                                </td>
                                <td className="px-2 py-1 text-center">
                                  {pt.origin === 'imp'
                                    ? <span className="text-blue-500">수입</span>
                                    : <span className="text-slate-400">내수</span>}
                                </td>
                                <td className="px-2 py-1 text-slate-400 truncate">{pt.vendor || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1.5">
                        · 하위 부품을 가진 중간 어셈블리는 자동으로 제외됩니다(상하위 중복 방지).
                        · <span className="text-amber-600">노랑=매입가 미등록</span>, <span className="text-rose-400">빨강=품목 미등록</span>.
                        여기서 고친 매입가는 이 견적에만 적용되고 품목 마스터는 바뀌지 않습니다.
                        · <b className="text-slate-500">L/T·MOQ 는 반대로 품목 마스터에 바로 저장됩니다</b> — 한 번 적어두면 다음 견적에서 그대로 떠오릅니다.
                        MOQ 는 이 줄 수량까지 곱한 소요량과 견줘 미달이면 주황색으로 표시합니다.
                      </p>
                    </td>
                  </tr>
                )}
                </>
              )
            })}
            {!lines.length && (
              <tr><td colSpan={14} className="py-8 text-center text-slate-400">품번을 추가하거나 원가분석에서 어셈블리를 가져오세요.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 font-bold">
              <td colSpan={7} className="py-2 text-right pr-3">TOTAL</td>
              <td className="py-2 text-right text-sm">{sym}{money(totals.amount, currency)}</td>
              <td colSpan={2}></td>
              <td className="py-2 text-right no-print">{won(totals.materialKrw)}</td>
              <td className="py-2 text-right no-print text-sky-700">{won(totals.laborKrw)}</td>
              <td className="py-2 text-right no-print">{isSales ? pct(totals.marginPct) : '-'}</td>
              <td className="no-print"></td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-4 text-xs text-slate-600 space-y-1">
          <div className="flex gap-2 items-center"><span className="w-24 text-slate-400">Lead Time</span>
            <input value={leadTime}
              onChange={(e) => { setLeadTouched(true); setLeadTime(e.target.value) }}
              className="qi flex-1" />
            <div className="no-print shrink-0 flex gap-0.5 bg-slate-100 rounded p-0.5"
              title="담긴 품목에 초도품이 있으면 자동으로 초도품이 됩니다">
              {['fa', 'mp'].map((k) => (
                <button key={k} type="button"
                  onClick={() => { setLeadKind(k); setLeadKindTouched(true); setLeadTouched(false) }}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded ${leadKind === k
                    ? (k === 'fa' ? 'bg-amber-400 text-white' : 'bg-sky-500 text-white')
                    : 'text-slate-400 hover:text-slate-600'}`}>
                  {LEAD_LABEL[k]} {LEAD_BASE[k]}W
                </button>
              ))}
            </div>
            {leadTouched && leadTime !== autoLead ? (
              <button type="button" onClick={() => { setLeadTouched(false); setLeadTime(autoLead) }}
                title="기본 납기와 부품 최장 L/T 로 되돌립니다"
                className="no-print shrink-0 px-2 py-0.5 text-[10px] font-bold rounded border border-sky-200 text-sky-600 bg-sky-50 hover:bg-sky-100">
                ↩ 자동 {autoLead}
              </button>
            ) : (
              <span className="no-print shrink-0 text-[10px] text-slate-400">
                자동{ltWeeks > baseWeeks
                  ? ` · 부품 최장 L/T ${ltWeeks}W 가 기본 ${baseWeeks}W 보다 김`
                  : ` · ${LEAD_LABEL[leadKind]} 기본`}
              </span>
            )}
          </div>
          <div className="flex gap-2"><span className="w-24 text-slate-400">Validity</span>
            <span>{validityDays} days from the date of quotation ({validUntil})</span></div>
          <div className="flex gap-2"><span className="w-24 text-slate-400">Remarks</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className="qi flex-1" placeholder="특이사항" /></div>
        </div>
      </div>

      {/* 보관함 — 채번 전 견적을 넣어 두는 곳 */}
      {draftOpen && (
        <div className="no-print fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setDraftOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-800">📂 보관함</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">견적번호를 따지 않고 넣어 둔 것들입니다. 확정 저장하면 여기서 사라집니다.</p>
              </div>
              <button onClick={() => setDraftOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="overflow-y-auto">
              {!drafts.length && <p className="py-12 text-center text-sm text-slate-400">보관해 둔 견적이 없습니다.</p>}
              {drafts.map((d) => (
                <div key={d.id} className={`flex items-center gap-3 px-5 py-2.5 border-b border-slate-100 ${d.id === draftId ? 'bg-indigo-50/60' : ''}`}>
                  <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded ${d.quote_kind === 'sales' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
                    {d.quote_kind === 'sales' ? '매출' : '매입'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{d.title || '(제목 없음)'}</p>
                    <p className="text-[10px] text-slate-400">
                      {String(d.updated_at || '').slice(0, 16).replace('T', ' ')}{d.created_by ? ` · ${d.created_by}` : ''}
                    </p>
                  </div>
                  <button onClick={() => loadDraft(d.id)}
                    className="shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">불러오기</button>
                  <button onClick={() => { if (confirm(`「${d.title || '제목 없음'}」 을 보관함에서 지울까요?`)) draftDelMut.mutate(d.id) }}
                    className="shrink-0 text-slate-300 hover:text-rose-500">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 마진 구간 설정 — 모든 PC 공통 */}
      {cfgOpen && tierDraft && (
        <div className="no-print fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setCfgOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-800">⚙ 마진 구간</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">부품 <b>한 개 매입가</b>가 어느 구간에 드는지로 마진율이 정해집니다.</p>
              </div>
              <button onClick={() => setCfgOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="px-5 py-4 space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
                <span className="flex-1 text-right pr-1">이 금액 이상 (원)</span>
                <span className="w-20 text-right">마진율 %</span><span className="w-6" />
              </div>
              {tierDraft.tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" inputMode="numeric"
                    value={Number(t.min || 0).toLocaleString('ko-KR')}
                    onChange={(e) => setTierDraft((s0) => ({ ...s0, tiers: s0.tiers.map((x, k) => k === i
                      ? { ...x, min: Number(String(e.target.value).replace(/[^0-9]/g, '')) || 0 } : x) }))}
                    className="flex-1 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                  <input type="number" step="0.5"
                    value={Math.round(Number(t.pct || 0) * 1000) / 10}
                    onChange={(e) => setTierDraft((s0) => ({ ...s0, tiers: s0.tiers.map((x, k) => k === i
                      ? { ...x, pct: (Number(e.target.value) || 0) / 100 } : x) }))}
                    className="w-20 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                  <button onClick={() => setTierDraft((s0) => ({ ...s0, tiers: s0.tiers.filter((_, k) => k !== i) }))}
                    className="w-6 text-slate-300 hover:text-rose-500">✕</button>
                </div>
              ))}
              <button onClick={() => setTierDraft((s0) => ({ ...s0, tiers: [...s0.tiers, { min: 0, pct: 0.45 }] }))}
                className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 text-slate-500 hover:bg-slate-50">＋ 구간 추가</button>

              <div className="pt-3 mt-2 border-t border-slate-100 flex items-center gap-2">
                <span className="flex-1 text-xs font-semibold text-slate-500 text-right pr-1">작업비 마진율 %</span>
                <input type="number" step="0.5"
                  value={Math.round(Number(tierDraft.laborMarg || 0) * 1000) / 10}
                  onChange={(e) => setTierDraft((s0) => ({ ...s0, laborMarg: (Number(e.target.value) || 0) / 100 }))}
                  className="w-20 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                <span className="w-6" />
              </div>

              <p className="text-[10px] text-slate-400 pt-1">· 맨 아래 구간은 <b>0</b> 으로 두세요. 어디에도 안 걸리는 금액이 없어야 합니다.</p>
              <p className="text-[10px] text-slate-400">· <b>모든 PC 에 공통</b>으로 적용됩니다. 저장하면 지금 담겨 있는 줄의 단가가 다시 계산됩니다.</p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setCfgOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
              <button onClick={() => cfgMut.mutate(tierDraft)} disabled={cfgMut.isPending}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {cfgMut.isPending ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <div className="flex-1 flex items-center">{children}</div>
    </div>
  )
}
function Mini({ label, value, accent }) {
  const ac = { emerald: 'text-emerald-600', rose: 'text-rose-600', amber: 'text-amber-600', sky: 'text-sky-600' }[accent] || 'text-slate-800'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-2.5">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className={`text-base font-bold ${ac}`}>{value}</div>
    </div>
  )
}
