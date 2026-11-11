import { EmptyRow } from '../../components/ui/EmptyState'
import { codeCandidates } from '../../lib/custPrefix'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { downloadQuoteExcel, SUPPLIER, SUPPLIER_KO } from '../../lib/quoteExcel'
import { quoteFileBase } from '../../lib/quoteFileName'
import QuotePrintSplit, { SPLIT_CSS, SPLIT_AUTO_FROM, wantSplit } from './QuotePrintSplit'
import QuoteDetailPrint, { DETAIL_CSS } from './QuoteDetailPrint'
import QuotePartsModal from './QuotePartsModal'
import { partsFromPaste, toPasteParts, pasteToMatched } from '../../lib/quotePartsPaste'
import { fetchQuoteNotes, remarksFromNotes } from '../../lib/quoteNote'
import { saveRfq, patchRfq, checkRfq } from './rfq'
import { buildDetails, noPartsAssy, DETAIL_REMARK } from '../../lib/quoteDetail'
import { prevOf, prevEligible, prevWarn, prevMargin, saleKeys, fetchSalePrev, attachSalePrev, saleRows, recordSalePrices, etcKey, isMissingSaleFn } from '../../lib/salePrice'
import { useMyProfile } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { spliceSubBoms } from '../../lib/bomSubExpand'
import { toastError, toastSuccess } from '../../lib/toast'
import { tierMargin, DEFAULT_TIERS, DEFAULT_CFG, explodeBOM, computeCost, needsPrice, applySupply, supplyHints } from '../../lib/costAnalysis'
import { fetchSupply } from '../../lib/bomSupply'
import { roundPrice } from '../../lib/marginSim'
import { fetchRefSetup, refCustomers, findAssyFor, itemCandidatesFor } from '../../lib/etcCustomerRef'
import { refreshProcurement } from '../../lib/refresh'
import { fetchQuoteMarginCfg, QUOTE_CFG_KEY } from '../../lib/quoteSettings'
import { todayISO, kstDT } from '../../lib/utils'
import MarginSimulator from '../../components/MarginSimulator'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { useUndoSnack } from '../../components/ux/UndoSnack'
import Spin from '../../components/ux/Spin'

// 견적 라인의 하위품목 — 1,000행 기본 제한에 잘리지 않게 끝까지 받는다 (fetchAll)
//   원가분석에서 제외 지정한 부품(quote_excluded)은 견적에서도 빠진다.
export async function fetchQuoteBOM(customerId, projectId) {
  return fetchAll(() => supabase
    .from('bom')
    .select('id, item_id, level, qty_per_unit, seq, created_at, quote_excluded, items!bom_item_id_fkey(std_code, name, unit, category, js_code, manufacturer, manufacturer_code, purchase_price, lt_weeks, moq, vendors(name))')
    .eq('customer_id', customerId).eq('project_id', projectId)
    .eq('quote_excluded', false)
    .order('seq').order('created_at').order('id'))
}

// 상위품목 구매/자작 (v4.126.0) — 중간 어셈블리(하위가 붙은 줄)만 본다. 표가 없으면(SQL 전) 지정 없음으로
export async function supplyForRows(rows) {
  try { return (await fetchSupply((rows || []).map((r) => r.item_id))).map || {} } catch { return {} }
}

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

// 견적 단가 끝자리 — 원화 100원 미만 절삭 · 달러 소수 둘째 자리부터 버림 (v4.129.0 · lib/marginSim roundPrice)
//   예전: 원화 원 단위 반올림 · 달러 센트 올림

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
  // 판매 실적가 (v4.162.0) — 단품은 같은 고객사에 전에 낸 단가 그대로 (「지금 계산가로」 누르기 전까지)
  if (line.kind !== 'assy') { const pv = prevOf(line, currency); if (pv != null) return pv }
  const mat = num(line.materialKrw)
  const labor = num(line.laborKrw)
  const rate = currency === 'KRW' ? 1 : (num(sellRate) || 1)
  const tiers = mcfg?.tiers
  const laborMarg = num(mcfg?.laborMarg)
  const fixed = line.marginPct != null ? num(line.marginPct) : null
  const all = Array.isArray(line.parts) ? line.parts : []
  const parts = all.filter((p) => !p.excluded && p.buyKrw != null)
  const partsSum = parts.reduce((a, p) => a + num(p.buyKrw) * num(p.qty), 0)
  // 자재비를 100원 단위로 반올림해 두므로 부품합과 최대 50원 차이가 난다. 그 안이면 같은 것으로 본다.
  const usable = line.kind === 'assy' && parts.length > 0 && Math.abs(partsSum - mat) <= 50.0001
  // ASSY 판매 실적가 부품 — 매입가가 없어도 실적가가 있으면 센다 (ASSY = 하위 합계 + 작업비)
  const prevParts = line.kind === 'assy' && (usable || mat <= 0) ? all.filter((p) => prevEligible(p) && prevOf(p, currency) != null) : []
  if (mat <= 0 && labor <= 0 && !prevParts.length) return 0
  let krw = 0

  if (prevParts.length) {
    const pset = new Set(prevParts)
    for (const pt of prevParts) krw += prevOf(pt, currency) * rate * num(pt.qty)
    for (const pt of parts) {
      if (pset.has(pt)) continue
      krw += (num(pt.buyKrw) / (1 - (fixed != null ? fixed : tierMargin(pt.buyKrw, tiers)))) * num(pt.qty)
    }
    if (labor > 0) krw += labor / (1 - (fixed != null ? fixed : laborMarg))
  } else if (fixed != null) {
    krw = (mat + labor) / (1 - fixed)
  } else {
    if (usable) {
      for (const pt of parts) {
        krw += (num(pt.buyKrw) / (1 - tierMargin(pt.buyKrw, tiers))) * num(pt.qty)
      }
    } else if (mat > 0) {
      krw = mat / (1 - tierMargin(mat, tiers))
    }
    if (labor > 0) krw += labor / (1 - laborMarg)
  }

  return roundPrice(currency === 'KRW' ? krw : krw / rate, currency)
}

// 지난 견적 리비전 번호 — S261001-001 → S261001-001-R1 → -R2 … (2026-10-12)
//   원본은 그대로 두고 새 줄로 저장한다. pm_next_quote_no 는 split_part(번호,'-',2) 만 읽어
//   뒤에 -R 이 붙어도 다음 채번에 영향이 없다 (함수 본문 확인함).
export const baseQuoteNo = (no) => String(no || '').replace(/-R\d+$/i, '')
export function nextRevNo(base, existing) {
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-R(\\d+)$', 'i')
  const max = (existing || []).reduce((a, no) => {
    const m = re.exec(String(no || '')); return m ? Math.max(a, Number(m[1])) : a
  }, 0)
  return `${base}-R${max + 1}`
}

export default function QuoteSheet({ customerId, customerName, initialLine, cfg = DEFAULT_CFG, onClose, fixedKind, reviseReq, onReviseLoaded, prefill, onPrefillDone }) {
  // ★ 매출견적(고객사 제출) / 매입견적(업체 수령) — 섞이면 안 되는 구분
  // fixedKind 가 주어지면 탭 자체가 한 종류 전용이므로 전환 버튼을 숨긴다.
  const [quoteKind, setQuoteKind] = useState(fixedKind || 'sales')
  const isSales = quoteKind === 'sales'

  // 통화 기본 — 매출견적은 국문(기본)이라 원화 · 매입견적(업체 수령)은 달러 그대로 (v4.100.1)
  const [currency, setCurrency] = useState(fixedKind === 'purchase' ? 'USD' : 'KRW')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [issuedTo, setIssuedTo] = useState(customerName || '')
  // 견적 접수의 「기타 · 직접 입력」 고객사로 쓰는 견적 (v4.99.0) — 고객사 BOM 을 안 찾고, 고객사 없이 저장. 위 고객사를 바꾸면 풀림
  const [etcCust, setEtcCust] = useState(null)
  const etcRef = useRef(null)   // 품목을 차례로 넣는 동안(같은 렌더) 바로 읽어야 해서 ref 도 같이
  useEffect(() => { setEtcCust(null); etcRef.current = null }, [customerId])
  const custIdForSave = etcCust ? null : customerId
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
  const [deliveryNote, setDeliveryNote] = useState(fixedKind === 'purchase' ? '(To be discussed later)' : '추후 협의')
  const [memo, setMemo] = useState('')
  // 인쇄 방식 (v4.124.0) — auto: 줄이 많으면 갑지·을지 / single: 지금처럼 한 장 / split: 항상 갑지·을지
  const [printMode, setPrintMode] = useState('auto')
  // 세부견적서 (v4.138.0) — 켜면 인쇄 · 엑셀에 어셈블리마다 부품별 판매가 장이 붙는다. 기본은 꺼짐 (부품 판매가가 고객에게 보이므로)
  //   제조사 표기(기본 숨김 — 필요할 때만 켬)는 이 PC 에 기억 (견적마다 다시 고르지 않게) · 끝자리 절삭은 합계에서 한 번(lib/quoteDetail)
  const [detailOn, setDetailOn] = useState(false)
  const [detailPref, setDetailPref] = useState(() => {
    try { return { maker: false, ...JSON.parse(localStorage.getItem('quote_detail_pref') || '{}') } } catch { return { maker: false } }
  })
  const setPref = (p) => setDetailPref((o) => { const n = { ...o, ...p }; try { localStorage.setItem('quote_detail_pref', JSON.stringify(n)) } catch { /* 저장 못 해도 이번 화면에선 동작 */ } return n })

  const [lines, setLines] = useState([])
  const [addCode, setAddCode] = useState('')
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState({})
  const [savedNo, setSavedNo] = useState('')
  const [openParts, setOpenParts] = useState({})
  const [partsOpen, setPartsOpen] = useState(false)   // 📋 부품표로 ASSY — 코드 부여 전 견적 (v4.148.0)
  // 마진 시뮬레이션 — 줄 key 또는 'all'(견적 전체)
  const [simFor, setSimFor] = useState(null)
  // 지난 견적 수정 중 — { id, quote_no, base, customer_id } (저장하면 base-Rn 으로 새로 저장)
  const [revOf, setRevOf] = useState(null)
  const [revLoading, setRevLoading] = useState(false)

  // 견적서 언어 (v4.100.0) — 기본 국문 · 영문 선택. 매입견적(업체 수령)은 영문 그대로
  const [lang, setLang] = useState('ko')
  const ko = isSales && lang === 'ko'
  // 견적 담당자 — 계정마다 · 국문/영문 따로 기억 (이 브라우저). 국문 담당 이름은 처음엔 로그인한 사람 이름,
  //   영문 Contact · 연락처는 처음엔 비워 두고 한 번 적으면 다음부터 불러온다
  const { data: me } = useMyProfile()
  const LS = `pm_quote_contact.${me?.id || 'me'}`
  const [contacts, setContacts] = useState({ ko: { name: '', phone: '', email: 'sales@jinsuntech.co.kr' }, en: { name: '', phone: '', email: 'sales@jinsuntech.co.kr' } })
  const contactReady = useRef(false)
  useEffect(() => {
    if (!me?.id) return
    let v = null
    try { v = JSON.parse(localStorage.getItem(LS) || 'null') } catch { v = null }
    if (!v) {   // 처음 — 예전(계정 구분 없던) 기억값은 영문 칸으로 옮겨 온다
      let old = {}
      try { old = JSON.parse(localStorage.getItem('pm_quote_contact') || '{}') } catch { old = {} }
      v = { ko: { name: me.name || '', phone: '', email: old.email || 'sales@jinsuntech.co.kr' }, en: { name: old.name || '', phone: old.phone || '', email: old.email || 'sales@jinsuntech.co.kr' } }
    }
    if (!v.ko?.name && me.name) v = { ...v, ko: { ...(v.ko || {}), name: me.name } }
    setContacts(v); contactReady.current = true
  }, [me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!contactReady.current || !me?.id) return
    try { localStorage.setItem(LS, JSON.stringify(contacts)) } catch {}
  }, [contacts]) // eslint-disable-line react-hooks/exhaustive-deps
  const cLang = ko ? 'ko' : 'en'
  const contactName = contacts[cLang]?.name || ''
  const contactPhone = contacts[cLang]?.phone || ''
  const contactEmail = contacts[cLang]?.email || ''
  const setContact = (k, v) => setContacts((c) => ({ ...c, [cLang]: { ...(c[cLang] || {}), [k]: v } }))
  const setContactName = (v) => setContact('name', v)
  const setContactPhone = (v) => setContact('phone', v)
  const setContactEmail = (v) => setContact('email', v)
  // 납품 일정 기본 문구도 언어를 따라간다 (손으로 고친 문구는 그대로)
  const DELIV = { ko: '추후 협의', en: '(To be discussed later)' }
  // 통화도 언어를 따라간다 (국문 원화 · 영문 달러). 손으로 바꿔 둔 통화와 지난 견적 수정 중(제출 단가 보호)은 그대로
  const LANG_CUR = { ko: 'KRW', en: 'USD' }
  function switchLang(next) {
    if (next === lang) return
    setLang(next)
    setDeliveryNote((d) => (d === DELIV.ko || d === DELIV.en || !d ? DELIV[next] : d))
    if (!revOf && currency === LANG_CUR[lang]) switchCurrency(LANG_CUR[next])
  }
  const [err, setErr] = useState('')
  const [ask, confirmEl] = useConfirm()
  const snack = useUndoSnack(6000)

  const sellRate = num(cfg.sellRate) || 1250
  const qc = useQueryClient()

  // 마진 구간 · 작업비 마진 · 기준 환율 — 공용 설정(pm_settings). 없으면 기본값으로 돈다. (매출견적 화면과 같은 캐시)
  const { data: mcfg = FALLBACK_MCFG } = useQuery({
    queryKey: QUOTE_CFG_KEY,
    queryFn: fetchQuoteMarginCfg,
    staleTime: 10 * 60 * 1000,
  })

  // 설정이 늦게 오거나 구간을 고치면 담겨 있는 줄의 단가를 다시 뽑는다.
  //   ⚠ mcfg 객체가 아니라 「내용」으로 비교한다. 창을 다시 켜서 같은 값을 또 받아올 때
  //     손으로 고쳐 둔 단가가 도로 계산되면 안 된다.
  //   기준 환율만 바뀐 것은 여기서 다시 뽑지 않는다 (환율은 매출견적 화면 칸으로 넘어온다)
  const mcfgKey = JSON.stringify({ tiers: mcfg.tiers, laborMarg: mcfg.laborMarg })
  useEffect(() => {
    if (!isSales) return
    // 지난 견적에서 불러온 줄(fromQuote)은 제출했던 단가를 지킨다
    setLines((ls) => (ls.length ? ls.map((l) => (l.fromQuote ? l : { ...l, unitPrice: linePrice(l, currency, sellRate, mcfg) })) : ls))
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
      buyRate: mcfg.buyRate || DEFAULT_CFG.buyRate,
      sellRate: mcfg.sellRate || DEFAULT_CFG.sellRate,
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

  // 판매 실적가 (v4.162.0 · lib/salePrice) — 같은 고객사 · 같은 통화로 전에 낸 단가를 줄 · 부품에 붙인다
  //   붙인 값이 바뀐 줄만 단가를 다시 뽑는다 (손으로 고친 다른 줄 단가는 그대로) · 지난 견적에서 불러온 줄은 제출 단가 그대로
  const saleCustKey = !isSales ? null : revOf ? (revOf.customer_id || etcKey(issuedTo)) : (custIdForSave || etcKey(etcCust || issuedTo))
  const saleKeyStr = isSales ? saleKeys(lines).join('|') : ''
  const saleLineStr = isSales ? lines.map((l) => l.key).join(',') : ''   // 이미 부품으로 받은 코드를 단품 줄로 넣어도 붙게
  const [saleMissing, setSaleMissing] = useState(false)
  useEffect(() => {
    let alive = true
    const keys = saleKeyStr ? saleKeyStr.split('|') : []
    ;(saleCustKey && keys.length ? fetchSalePrev(saleCustKey, currency, keys) : Promise.resolve({ map: {}, missing: false }))
      .then(({ map, missing }) => {
        if (!alive) return
        setSaleMissing(missing)
        setLines((ls) => attachSalePrev(ls, map).map((l) => {
          if (!l._prevChanged) return l
          const { _prevChanged, ...r } = l
          return r.fromQuote || !isSales ? r : { ...r, unitPrice: linePrice(r, currency, sellRate, mcfg) }
        }))
      })
      .catch((e) => { if (alive) toastError('판매 실적가를 못 불러왔습니다 — ' + (e?.message || e)) })
    return () => { alive = false }
  }, [saleCustKey, currency, saleKeyStr, saleLineStr, isSales])   // eslint-disable-line react-hooks/exhaustive-deps

  // 구매자재 견적 특이사항 → 줄 비고 (v4.176.0 · lib/quoteNote). 못 불러와도 줄 추가는 막지 않고 알린다
  async function noteRemarks(kind, parts) {
    try { return remarksFromNotes(kind, parts, await fetchQuoteNotes((parts || []).map((p) => p.item_id))) }
    catch (e) { toastError('구매자재 견적 특이사항을 못 불러왔습니다 — 비고는 직접 확인해 주세요 (' + (e?.message || e) + ')'); return '' }
  }

  // ── 라인 추가: 어셈블리면 BOM 전개 원가 + 최신 작업비, 아니면 단품 매입가 ──
  // codeArg · qtyArg — 견적 접수에서 「견적 작성 →」으로 품목을 한꺼번에 넣을 때 (v4.92.0). 없으면 입력칸 값
  async function addByCode(codeArg, qtyArg) {
    const raw = String(codeArg ?? addCode ?? '').trim()
    const q0 = Number(qtyArg) > 0 ? Number(qtyArg) : 1
    if (!raw) return
    setAdding(true); setErr('')
    try {
      // 고객사 접두로 찾는다 — 예전엔 AX- 로 고정돼 Edwards 품번(ASML 9B)이 AX-ASML 9B 가 되어 못 찾았다 (v4.57.0)
      //   후보 = [고객사 접두+품번, 품번 그대로]. 고객사를 모르면 AXCELIS 로 본다 (예전 동작)
      const etc = !!etcRef.current
      let csCode = etc ? '' : 'ax'
      if (customerId && !etc) {
        const { data: cs0 } = await supabase.from('customers').select('code').eq('id', customerId).maybeSingle()
        if (cs0?.code) csCode = cs0.code
      }
      let cands = codeCandidates(raw, csCode)
      const pickFirst = (list, key) => cands.map(c => (list || []).find(x => x[key] === c)).find(Boolean) || null
      const code = cands[0]
      // 기타 고객사(제스코 · 남일 …) — BOM 기준 고객사의 등록 BOM 으로 (v4.130.0 · lib/etcCustomerRef)
      let bomCs = customerId, etcHit = null
      if (etc) {
        const refs = refCustomers(etcRef.current, await fetchRefSetup())
        etcHit = await findAssyFor(raw, refs)
        if (etcHit) bomCs = etcHit.cs.id
        cands = itemCandidatesFor(raw, refs)
      }
      // ⚠ 조회 오류를 반드시 드러낸다. 삼키면 「하위품목이 없는 것」처럼 보인다.
      //   (v4.8.3 배포 중에 lt_days 칸이 지워져 부품이 0건으로 보였던 사례)
      const { data: projs, error: pErr } = etc ? { data: etcHit ? [etcHit.proj] : [], error: null } : await supabase
        .from('projects').select('id, code, name, rev')
        .eq('customer_id', customerId).in('code', cands)
      if (pErr) throw new Error('어셈블리 조회 — ' + pErr.message)
      const proj = etc ? (etcHit?.proj || null) : pickFirst(projs, 'code')

      if (proj) {
        let rows
        // 전개가 빠진 조립품은 별도 BOM 을 끼워 넣어 부품 원가까지 센다 (2026-09-30)
        try { rows = (await spliceSubBoms(bomCs, await fetchQuoteBOM(bomCs, proj.id), fetchQuoteBOM, proj.id)).rows }
        catch (bErr) { throw new Error('하위품목 조회 — ' + (bErr?.message || bErr)) }

        const mapped = (rows || []).map((b, i) => ({
          uid: i, level: b.level, qty_per_unit: b.qty_per_unit, item_id: b.item_id || null,
          std_code: b.items?.std_code || '', name: b.items?.name || '', unit: b.items?.unit || '',
          manufacturer: b.items?.manufacturer || '',
          manufacturer_code: b.items?.manufacturer_code || '',
          purchase_price: b.items?.purchase_price ?? null,
          category: b.items?.category || '', js_code: b.items?.js_code || '',
          lt_weeks: b.items?.lt_weeks ?? null, moq: b.items?.moq ?? null,
          vendor: b.items?.vendors?.name || '',
          registered: !!b.items,
        }))
        // 작업비는 라인에서 따로 잡으므로 여기선 0 (= 자재비만 계산)
        //   🛒 구매로 지정된 조립품은 상위 단가 하나로 (하위는 빠짐) — BOM 화면 구매/자작 표시 (v4.126.0)
        const ex = explodeBOM(mapped)
        const supMap = await supplyForRows(ex.filter((r) => r.isParentNode))
        const c = computeCost(applySupply(ex, supMap), cfg, {}, 0)
        const noPrice = c.items.filter(needsPrice).length   // 소요량 0 · 스펙 · 문서는 「단가 제외」 (v4.99.0)

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
          vendor: r.vendor || '', status: r.status, skip: r.skip || null, excluded: r.excluded,
          lt: r.lt_weeks ?? null, moq: r.moq ?? null,
          item_id: r.item_id, isParentNode: !!r.isParentNode, baseExcluded: r.baseExcluded,
          supply: r.supply, supplyBuy: r.supplyBuy, supplySkip: r.supplySkip,
        }))
        // 어셈블리 납기는 가장 늦게 들어오는 부품이 정한다 → 최장 L/T
        const ltMax = parts.reduce(
          (a, x) => (x.excluded || x.lt == null ? a : Math.max(a, num(x.lt))), 0)

        const nl = newLine({
          kind: 'assy',
          std_code: proj.code, description: proj.name || '', rev: proj.rev || '',
          unit: 'EA', qty: q0,
          materialKrw: round100(c.totalBuyKrw), laborKrw, laborSrc,
          origin: c.impKrw > c.domKrw ? 'imp' : 'dom',
          noPrice, partCount: c.items.length,
          lt: ltMax || null,
          proto: !!pit?.is_prototype,
          // 세부견적용 부품 목록 — 화면에서 제외·단가 조정 가능
          parts,
          remarks: await noteRemarks('assy', parts),
        })
        nl.unitPrice = isSales ? linePrice(nl, currency, sellRate, mcfg) : 0
        setLines((ls) => [...ls, nl])
        setAddCode('')
        return
      }

      const { data: its, error: iErr } = await supabase
        .from('items').select('id, std_code, name, unit, purchase_price, lt_weeks, moq, is_prototype, vendors(name)')
        .in('std_code', cands)
      // 조회가 실패한 것과 정말 없는 것을 구분한다. 전에는 둘 다 「어디에도 없습니다」였다.
      if (iErr) throw new Error('품목 조회 — ' + iErr.message)
      const data = pickFirst(its, 'std_code')
      if (!data) { setErr(`${cands.join(' / ')} 는 어셈블리·품목 어디에도 없습니다.`); return }
      const mat = num(data.purchase_price)
      const nl = newLine({
        kind: 'item',
        std_code: data.std_code, description: data.name || '',
        unit: data.unit || 'EA', qty: q0,
        materialKrw: mat, vendor: data.vendors?.name || '',
        noPrice: mat > 0 ? 0 : 1, partCount: 1,
        lt: data.lt_weeks ?? null, moq: data.moq ?? null,
        proto: !!data.is_prototype,
        remarks: await noteRemarks('item', [{ item_id: data.id }]),
      })
      nl.unitPrice = isSales ? linePrice(nl, currency, sellRate, mcfg) : 0
      setLines((ls) => [...ls, nl])
      setAddCode('')
    } catch (e) {
      setErr('조회 실패: ' + e.message)
    } finally { setAdding(false) }
  }

  // 부품표 붙여넣기로 만든 ASSY 줄 (v4.148.0) — BOM 없이 이 견적 안에서만 (부품 단가 · 제외는 「▼ 부품」에서)
  async function addPastedAssy({ code, name, qty, labor, matched }) {
    const parts = partsFromPaste(matched)
    const noPrice = parts.filter((x) => x.buyKrw == null).length
    const ltMax = parts.reduce((a, x) => (x.lt == null ? a : Math.max(a, num(x.lt))), 0)
    const nl = newLine({
      kind: 'assy', std_code: code, description: name, unit: 'EA', qty,
      materialKrw: round100(sumParts(parts)), laborKrw: labor, origin: 'dom',
      noPrice, partCount: parts.length, lt: ltMax || null, parts, tempBom: true,
      remarks: await noteRemarks('assy', parts),
    })
    nl.unitPrice = isSales ? linePrice(nl, currency, sellRate, mcfg) : 0
    setLines((ls) => [...ls, nl])
    setOpenParts((o) => ({ ...o, [nl.key]: noPrice > 0 }))   // 단가 없는 부품이 있으면 부품표를 펼쳐 둔다
    setPartsOpen(false)
    toastSuccess(`「${name}」 부품 ${parts.length}개로 추가${noPrice ? ` — 단가 없음 ${noPrice}개는 부품표에서 적어 주세요` : ''}`)
  }

  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))

  // 💲 부품표 줄 단가 요청 (v4.149.0) — 견적 접수 건을 만들고 구매자재에 단가 요청까지 한 번에
  //   부품표를 그 품목에 같이 저장 → 구매자재 「영업 견적 단가 요청」에 단가 없는 부품이 뜬다
  //   (포털 품목이면 지금처럼 품목 매입가 · 포털에 없는 부품은 그 표에서 바로 단가를 적음 — 품목 등록 없음)
  //   다 차면 견적 접수 현황 「견적 작성」 → 채워진 단가로 이 줄이 다시 만들어진다
  const [reqBusy, setReqBusy] = useState(null)
  async function requestPastePrice(l) {
    const nm = String(l.description || '').trim() || String(l.std_code || '').trim()
    const pn = String(l.std_code || '').trim() || nm
    if (!pn) { toastError('품번이나 품명을 먼저 적어 주세요'); return }
    const miss = num(l.noPrice)
    const r0 = await ask({
      title: '💲 구매자재에 단가 요청',
      desc: `「${nm}」 부품 ${l.partCount}개 중 단가 없는 ${miss}개를 구매자재에 요청합니다. 견적 접수 현황에 건이 하나 생기고, 구매자재가 단가를 채우면 「단가 요청 끝」이 저절로 찍힙니다. 그때 견적 접수 현황 「✏ 견적 작성」으로 이어서 쓰세요.`,
      input: { label: '견적 건명 (견적 접수 현황 · 이력에서 이 이름으로 찾습니다)', value: projectName || nm, required: true },
      okText: '단가 요청',
    })
    if (!r0?.value?.trim()) return
    setReqBusy(l.key)
    try {
      let code = etcCust ? etcCust : null
      if (!code && customerId) {
        const { data, error } = await supabase.from('customers').select('code').eq('id', customerId).maybeSingle()
        if (error) throw error
        code = String(data?.code || '').toLowerCase()
      }
      if (!code) throw new Error('고객사를 먼저 고르세요')
      const meName = (me?.name || '').trim() || me?.email || ''
      const r = await saveRfq({
        head: { customer_code: code, customer_id: etcCust ? null : (customerId || null), title: r0.value.trim(), owner_name: meName, memo: '견적 작성 「📋 부품표로 ASSY」에서 단가 요청' },
        lines: [{ pn, name: nm, qty: Number(l.qty) || 1, paste_parts: toPasteParts(l.parts, l.laborKrw) }], meName,
      })
      await patchRfq(r.id, { price_req_at: new Date().toISOString(), price_req_by: meName })
      const { data: fresh, error: e2 } = await supabase.from('pm_rfq_line').select('*').eq('rfq_id', r.id)
      if (e2) throw e2
      await checkRfq({ ...r, price_req_at: new Date().toISOString(), lines: fresh || [] })
      patch(l.key, { priceReq: { title: r0.value.trim(), at: todayISO() } })
      qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['quotePriceReqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] })
      toastSuccess(`「${r0.value.trim()}」 — 구매자재에 단가 요청했습니다 (견적 접수 현황에서 진행을 볼 수 있습니다)`)
    } catch (e) { toastError('단가 요청 실패 — ' + (e?.message || e)) } finally { setReqBusy(null) }
  }

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
    return withParts(l, l.parts.map((x) => (x.uid === uid ? { ...x, ...p } : x)))
  }))
  // 부품 줄이 바뀐 어셈블리 줄 — 자재비 · 단가없음 · 납기 · 매출단가 다시
  const withParts = (l, parts) => {
    const materialKrw = round100(sumParts(parts))
    const noPrice = parts.filter((x) => !x.excluded && x.status !== 'skip' && (x.buyKrw == null || x.status === 'unreg')).length
    // 부품 L/T 를 고치거나 체크를 풀면 어셈블리 납기도 따라 바뀌어야 한다.
    const ltMax = parts.reduce((a, x) => (x.excluded || x.lt == null ? a : Math.max(a, num(x.lt))), 0)
    const n = { ...l, parts, materialKrw, noPrice, lt: ltMax || null }
    return isSales ? { ...n, unitPrice: linePrice(n, currency, sellRate, mcfg) } : n
  }

  // 조립품 구매/자작 지정 (v4.126.0) — 견적에서 바로 정한다. BOM 화면의 구매/자작 표시와 같은 곳에 저장
  //   → 담긴 줄 중 이 품목이 있는 어셈블리를 모두 다시 계산 (부족자재 · 소요량도 이 표시를 따른다)
  const [supBusy, setSupBusy] = useState(null)
  async function designate(itemId, mode, code) {
    if (!itemId) return
    setSupBusy(itemId)
    try {
      const { error } = await supabase.from('pm_item_supply')
        .upsert({ item_id: itemId, mode, updated_at: new Date().toISOString() }, { onConflict: 'item_id' })
      if (error) throw error
      setLines((ls) => ls.map((l) => {
        if (!l.parts?.some((x) => x.item_id === itemId)) return l
        const modeOf = {}
        l.parts.forEach((x) => { if (x.item_id && x.supply) modeOf[x.item_id] = x.supply })
        modeOf[itemId] = mode
        return withParts(l, applySupply(l.parts, modeOf))
      }))
      qc.invalidateQueries({ queryKey: ['itemSupply'], exact: false })
      refreshProcurement(qc)
      toastSuccess(mode === 'buy'
        ? `${code} 🛒 구매로 지정 — 상위 단가로 계산 · BOM · 부족자재에도 반영`
        : `${code} 🔧 자작으로 지정 — 하위 단가를 받습니다 · BOM · 부족자재에도 반영`)
    } catch (e) {
      toastError('구매/자작 저장 실패 — ' + (e?.message || e))
    } finally { setSupBusy(null) }
  }

  // 줄 빼기 — 묻지 않고 바로, 6초 동안 같은 자리로 되돌리기 (v4.104.0)
  const remove = (key) => {
    const i = lines.findIndex((l) => l.key === key)
    if (i < 0) return
    const gone = lines[i]
    setLines((ls) => ls.filter((l) => l.key !== key))
    snack.show(`${gone.std_code || gone.description || '빈 줄'} 줄을 뺐습니다`, () => {
      setLines((ls) => (ls.some((l) => l.key === key) ? ls : [...ls.slice(0, i), gone, ...ls.slice(i)]))
      return `${gone.std_code || '줄'} 다시 넣었습니다`
    })
  }

  function switchCurrency(next) {
    snack.hide()   // 뺀 줄을 옛 통화 단가로 되살리지 않게 (v4.104.0)
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

  // 세부견적 — 견적 단가를 부품별 판매가로 푼 것 (lib/quoteDetail)
  const details = useMemo(() => (isSales && detailOn ? buildDetails(lines, { currency, sellRate, mcfg }) : []),
    [isSales, detailOn, lines, currency, sellRate, mcfg])
  const detailMissing = details.reduce((a, d) => a + d.detail.missing, 0)
  const detailNoParts = isSales && detailOn ? noPartsAssy(lines) : []
  // 켜면 세부가 붙는 줄 비고에 「세부견적 참조」(비어 있을 때만) · 끄면 그 글자만 지운다
  function toggleDetail(on) {
    setDetailOn(on)
    const txt = ko ? DETAIL_REMARK.ko : DETAIL_REMARK.en
    if (on) {
      const keys = new Set(buildDetails(lines, { currency, sellRate, mcfg }).map((d) => d.line.key))
      setLines((ls) => ls.map((l) => (keys.has(l.key) && !String(l.remarks || '').trim() ? { ...l, remarks: txt } : l)))
    } else {
      setLines((ls) => ls.map((l) => (l.remarks === DETAIL_REMARK.ko || l.remarks === DETAIL_REMARK.en ? { ...l, remarks: '' } : l)))
    }
  }

  const draftPayload = () => ({
    v: 1, quoteKind, lang, currency, quoteDate, issuedTo, vendorId, attn, projectName,
    validityDays, leadTime, leadKind, deliveryNote, memo, lines, customerId, customerName, revOf, detailOn,
  })

  const draftMut = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('품목이 없습니다.')
      const { data: { user } } = await supabase.auth.getUser()
      const row = {
        title: projectName || lines[0]?.std_code || '(제목 없음)',
        quote_kind: quoteKind, customer_id: custIdForSave || null,
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
    snack.hide()   // 다른 견적을 불러오면 지난 「줄 되돌리기」는 닫는다
    const { data, error } = await supabase.from('pm_quote_drafts')
      .select('*').eq('id', id).maybeSingle()
    if (error || !data) { setErr('불러오기 실패: ' + (error?.message || '없는 항목')); return }
    const d = data.payload || {}
    setQuoteKind(d.quoteKind || 'sales')
    setLang(d.lang || 'en')
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
    setDetailOn(!!d.detailOn)
    setRevOf(d.revOf || null)
    setDraftId(id); setSavedNo(''); setErr(''); setDraftOpen(false)
    toastSuccess('보관해 둔 견적을 불러왔습니다')
  }

  // ── 지난 견적 불러와서 수정 (리비전) ─────────────────────────────
  //   제출했던 단가 · 표기를 그대로 가져온다. 단가는 다시 계산하지 않는다.
  async function loadRevision(quoteId) {
    snack.hide()
    setRevLoading(true); setErr('')
    try {
      const { data: q, error: qErr } = await supabase.from('pm_quotes').select('*').eq('id', quoteId).maybeSingle()
      if (qErr) throw new Error('견적 조회 — ' + qErr.message)
      if (!q) throw new Error('견적을 찾을 수 없습니다 (삭제됐을 수 있음)')
      const { data: its, error: iErr } = await supabase.from('pm_quote_items')
        .select('*').eq('quote_id', quoteId).order('line_no')
      if (iErr) throw new Error('견적 품목 조회 — ' + iErr.message)
      const base = baseQuoteNo(q.quote_no)
      const { data: sib, error: sErr } = await supabase.from('pm_quotes')
        .select('quote_no').like('quote_no', base + '-R%')
      if (sErr) throw new Error('리비전 번호 조회 — ' + sErr.message)

      setQuoteKind(q.quote_kind || fixedKind || 'sales')
      setLang(q.lang || 'en')   // 예전 견적(언어 기록 없음)은 영문
      setCurrency(q.currency || 'USD')
      setQuoteDate(q.quote_date || todayISO())
      setIssuedTo(q.issued_to || '')
      setVendorId(q.vendor_id || '')
      setAttn(q.attn || '')
      setProjectName(q.project_name || '')
      setValidityDays(q.validity_days ?? 15)
      setLeadTime(q.lead_time || 'L/T 8W'); setLeadTouched(true); setLeadKindTouched(true)
      setDeliveryNote(q.delivery_note ?? '')
      setMemo(q.memo || '')
      { const tl = (q.quote_kind || fixedKind || 'sales') === 'sales' && q.lang === 'ko' ? 'ko' : 'en'   // 그 견적의 언어 칸에 담당자를 넣는다
        if (q.issuer_name || q.issuer_phone || q.issuer_email) setContacts((c) => ({ ...c, [tl]: { ...(c[tl] || {}), ...(q.issuer_name ? { name: q.issuer_name } : {}), ...(q.issuer_phone ? { phone: q.issuer_phone } : {}), ...(q.issuer_email ? { email: q.issuer_email } : {}) } })) }
      setLines((its || []).map((r) => newLine({
        kind: r.line_kind === 'assy' ? 'assy' : 'item',
        std_code: r.std_code || '', description: r.description || '', rev: r.rev || '',
        unit: r.unit || 'EA', qty: num(r.qty), unitPrice: num(r.unit_price),
        alternative: r.alternative || '', remarks: r.remarks || '',
        materialKrw: num(r.material_krw), laborKrw: num(r.labor_krw),
        vendor: r.vendor || '', origin: r.origin || 'dom',
        marginPct: r.margin_pct == null ? null : num(r.margin_pct),
        fromQuote: true,
      })))
      setRevOf({ id: q.id, quote_no: q.quote_no, base, customer_id: q.customer_id || null,
        nextNo: nextRevNo(base, (sib || []).map((x) => x.quote_no)) })
      setDraftId(null); setSavedNo(''); setOpenParts({})
      onReviseLoaded?.(q)
      toastSuccess(`${q.quote_no} 을(를) 불러왔습니다 — 고친 뒤 💾 저장하면 리비전 번호로 저장됩니다`)
    } catch (e) {
      setErr('지난 견적 불러오기 실패: ' + e.message)
    } finally { setRevLoading(false) }
  }
  // 견적 접수 → 「견적 작성 →」: 그 접수의 품목을 차례로 넣는다 (고객사가 바뀌어 customerId 가 맞을 때 한 번만)
  const prefillDone = useRef('')
  const prefillKey = prefill ? String(prefill.n) : ''
  useEffect(() => {
    if (!prefill || !customerId || prefillDone.current === prefillKey) return
    if (prefill.customerId && prefill.customerId !== customerId) return
    prefillDone.current = prefillKey
    ;(async () => {
      snack.hide(); setLines([]); setRevOf(null); setSavedNo('')
      if (prefill.title) setProjectName(prefill.title)
      setEtcCust(prefill.etcName || null); etcRef.current = prefill.etcName || null
      if (prefill.etcName) setIssuedTo(prefill.etcName)
      for (const l of prefill.lines || []) {
        // 부품표 품목(코드 부여 전 · v4.149.0) — 구매자재가 채운 단가 그대로 부품표 ASSY 로
        if (l.paste?.parts?.length) await addPastedAssy({ code: l.pn, name: l.name || l.pn, qty: Number(l.qty) || 1, labor: Number(l.paste.labor) || 0, matched: pasteToMatched(l.paste) })
        else await addByCode(l.pn, l.qty)
      }
      onPrefillDone?.()
    })()
  }, [prefillKey, customerId])   // eslint-disable-line react-hooks/exhaustive-deps

  const reviseKey = reviseReq ? `${reviseReq.id}:${reviseReq.n}` : ''
  useEffect(() => {
    if (reviseReq?.id) loadRevision(reviseReq.id)
  }, [reviseKey])   // eslint-disable-line react-hooks/exhaustive-deps

  async function cancelRevision() {
    if (!(await ask({ title: '수정을 그만두고 화면을 비울까요?', desc: `원본 견적(${revOf?.quote_no || ''})은 그대로이고, 지금 고친 내용만 사라집니다.`, okText: '그만두기', cancelText: '계속 수정' }))) return
    snack.hide(); setRevOf(null); setLines([]); setSavedNo(''); setErr('')
  }

  const cfgMut = useMutation({
    mutationFn: async (v) => {
      const tiers = (v.tiers || [])
        .map((t) => ({ min: num(t.min), pct: num(t.pct) }))
        .filter((t) => t.pct > 0 && t.pct < 1)
        .sort((a, b) => b.min - a.min)
      if (!tiers.length) throw new Error('구간이 하나도 없습니다.')
      if (!tiers.some((t) => t.min === 0)) throw new Error('맨 아래 구간(0원 이상)이 있어야 합니다.')
      if (!(num(v.buyRate) > 0) || !(num(v.sellRate) > 0)) throw new Error('기준 환율(매입 · 판매)을 넣어 주세요.')
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('pm_settings').upsert({
        key: 'quote_margin',
        value: { tiers, laborMarg: num(v.laborMarg), buyRate: num(v.buyRate), sellRate: num(v.sellRate) },
        updated_at: new Date().toISOString(), updated_by: user?.email || null,
      }, { onConflict: 'key' })
      if (error) throw error
    },
    onSuccess: () => {
      setCfgOpen(false)
      qc.invalidateQueries({ queryKey: QUOTE_CFG_KEY })
      toastSuccess('마진 구간 · 기준 환율을 저장했습니다 — 모든 PC 에 같은 값으로 열립니다')
    },
    onError: (e) => toastError('마진 구간 저장 실패: ' + e.message),
  })

  // 이미 저장한 화면에서 💾 를 또 누르면 새 번호로 한 건 더 생긴다 — 확인을 받는다 (v4.166.0)
  async function saveClick() {
    if (savedNo) {
      const ok = await ask({
        title: '이미 저장한 견적입니다',
        desc: revOf
          ? `${savedNo} 로 저장됐습니다. 한 번 더 저장하면 ${revOf.nextNo} 로 리비전이 하나 더 생깁니다.`
          : `${savedNo} 로 저장됐습니다. 한 번 더 저장하면 새 견적번호로 한 건이 더 생깁니다. 고친 내용을 원본에 반영하려면 견적이력에서 불러와 수정하세요.`,
        okText: '새로 한 건 더 저장', cancelText: '그만두기',
      })
      if (!ok) return
    }
    saveMut.mutate()
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('품목이 없습니다.')
      if (!isSales && !vendorId) throw new Error('매입견적은 업체를 선택해야 합니다.')

      let no
      if (revOf) {
        // 리비전 — 저장 직전에 다시 세어 겹치지 않게 (그사이 누가 R 을 만들었을 수 있다)
        const { data: sib, error: sErr } = await supabase.from('pm_quotes')
          .select('quote_no').like('quote_no', revOf.base + '-R%')
        if (sErr) throw new Error('리비전 번호 조회 실패: ' + sErr.message)
        no = nextRevNo(revOf.base, (sib || []).map((x) => x.quote_no))
      } else {
        const { data, error: nErr } = await supabase.rpc('pm_next_quote_no', {
          p_date: quoteDate, p_kind: quoteKind,
        })
        if (nErr) throw new Error('견적번호 채번 실패: ' + nErr.message)
        no = data
      }

      const qRow = {
        quote_no: no, quote_kind: quoteKind, quote_date: quoteDate, lang: isSales ? lang : 'en',
        customer_id: isSales ? ((revOf ? revOf.customer_id : custIdForSave) || null) : null,
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
      }
      let { data: q, error: qErr } = await supabase.from('pm_quotes').insert(qRow).select('id, quote_no').single()
      // 언어 칸(lang)은 SQL(견적불가_반영_261026.sql) 뒤에 생긴다 — 그 전엔 빼고 저장
      if (qErr && /lang/.test(qErr.message || '')) {
        const { lang: _l, ...rest } = qRow
        ;({ data: q, error: qErr } = await supabase.from('pm_quotes').insert(rest).select('id, quote_no').single())
      }
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

      // 판매 실적가 기록 (v4.162.0) — 단품 · ASSY 단가 + ASSY 세부 부품 판매가 (세부견적을 안 켰어도 계산값으로 · 켰으면 「세부견적 제출」 표시)
      //   실패해도 견적은 이미 저장됐으니 막지 않고 알리기만
      if (isSales && saleCustKey) {
        try {
          const rowsS = saleRows(lines, buildDetails(lines, { currency, sellRate, mcfg }), {
            custKey: saleCustKey, customerId: qRow.customer_id, customerName: qRow.issued_to, currency,
            quote: { id: q.id, quote_no: no, quote_date: quoteDate }, detailOn, by: (me?.name || '').trim() || me?.email || null,
          })
          await recordSalePrices(rowsS)
        } catch (e) {
          toastError(isMissingSaleFn(e)
            ? '판매 실적가 표가 아직 없습니다 — Supabase 에서 「판매실적가_반영_261109.sql」을 먼저 실행해 주세요 (견적은 저장됨)'
            : '판매 실적가 기록 실패 (견적은 저장됨) — ' + (e?.message || e))
        }
      }
      return no
    },
    onSuccess: (no) => {
      setSavedNo(no); setErr('')
      // 한 번 더 저장하면 다음 리비전(R2…)으로
      if (revOf) setRevOf((r) => (r ? { ...r, nextNo: nextRevNo(r.base, [no, r.nextNo]) } : r))
      qc.invalidateQueries({ queryKey: ['quoteHistory'], exact: false })
      qc.invalidateQueries({ queryKey: ['quoteHistoryItems'], exact: false })
      qc.invalidateQueries({ queryKey: ['recentSalesQuotes'] })
      // 확정됐으니 보관함에 남겨 둘 이유가 없다.
      if (draftId) {
        supabase.from('pm_quote_drafts').delete().eq('id', draftId).then(() => {
          setDraftId(null); qc.invalidateQueries({ queryKey: ['quoteDrafts'] })
        })
      }
    },
    onError: (e) => setErr(e.message),
  })

  // 파일 이름 — YYMMDD_업체_건명 (lib/quoteFileName.js, v4.113.0)
  const fileBase = () => quoteFileBase({
    date: quoteDate, party: isSales ? issuedTo : (vendors.find((v) => v.id === vendorId)?.name || ''),
    title: projectName, firstCode: lines.find((l) => l.std_code)?.std_code, purchase: !isSales, en: isSales && !ko,
  })

  async function doPrint() {
    if (detailOn && details.length && (detailMissing > 0 || detailNoParts.length > 0)) {
      const ok = await ask({ title: '세부견적에 빠지는 것이 있습니다 — 그대로 인쇄할까요?',
        items: [
          ...(detailMissing > 0 ? [`단가 없는 부품 ${detailMissing}개 — 견적 단가에도 안 들어가 있어 세부에서도 빠집니다`] : []),
          ...detailNoParts.map((l) => `${l.std_code || '-'} — 부품 정보가 없어 세부견적을 못 만듭니다 (지난 견적을 불러온 줄이면 원가분석에서 다시 가져오세요)`),
        ],
        okText: '그대로 인쇄' })
      if (!ok) return
    }
    document.body.classList.add('printing-quote')
    if (wantSplit(printMode, lines.length)) document.body.classList.add('qs-split')
    if (detailOn && details.length) document.body.classList.add('qs-detail')
    // PDF 로 저장할 때 크롬이 문서 제목을 파일 이름으로 쓴다 → 인쇄하는 동안만 바꿨다가 되돌림
    const prevTitle = document.title
    document.title = fileBase()
    const done = () => {
      document.body.classList.remove('printing-quote', 'qs-split', 'qs-detail')
      document.title = prevTitle
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
        비고: pt.status === 'skip' ? `단가 제외 · ${pt.skip || ''}` : '',
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
          quoteNo: savedNo, quoteDate, currency: cur, lang: ko ? 'ko' : 'en',
          issuedTo: isSales ? issuedTo : (vendors.find((v) => v.id === vendorId)?.name || ''),
          attn, projectName, validityDays, validUntil,
          leadTime, deliveryNote, memo,
          contactName, contactPhone, contactEmail,
        },
        lines, totals,
        extra: { detailRows, bomRows, infoRows, customerDetail: detailOn && details.length ? { details, showMaker: !!detailPref.maker } : null },
        fileName: `${fileBase()}.xlsx`,
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
      {snack.el}{confirmEl}
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
        ${SPLIT_CSS}
        ${DETAIL_CSS}
      `}</style>

      {/* 주의 알림 (v4.100.1) — 재접수 · 반복 견적은 지난 이력과 맞춰 본다 */}
      {isSales && (() => {
        const hist = lines.filter((l) => l.std_code && history[l.std_code])
        return (
          <div className="no-print flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5" data-quote-notice>
            <span className="text-base leading-5">⚠</span>
            <div className="text-xs leading-5 text-amber-900">
              <b>신규 접수 건이 아니면 이전 이력을 확인하여 검토 바랍니다.</b>
              <span className="text-amber-800"> 같은 품목의 지난 견적 단가 · 통화 · 조건과 다르게 나가지 않는지 확인하세요.</span>
              {hist.length > 0 && (
                <div className="mt-0.5 font-semibold text-amber-900" data-quote-notice-hist={hist.length}>
                  이 견적에 지난 견적 이력이 있는 품목 {hist.length}개 — 표의 「직전」 단가를 확인하세요
                  <span className="font-normal text-amber-800"> ({hist.slice(0, 3).map((l) => l.std_code).join(', ')}{hist.length > 3 ? ` 외 ${hist.length - 3}` : ''})</span>
                </div>
              )}
            </div>
          </div>
        )
      })()}

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

      {partsOpen && <QuotePartsModal customerId={customerId} onClose={() => setPartsOpen(false)} onAdd={addPastedAssy} />}
      {/* 조작부 — 두 줄로 나눠 버튼 자리를 고정 (v4.140.0)
          예전엔 한 줄에 다 넣어서 세부견적 체크 · 글자 길이(임시저장/보관 갱신 · 인쇄/인쇄(갑지·을지))에 따라 버튼이 옮겨 다녔다
          ① 작성 — 언어 · 통화 · 품번 추가 · 마진구간 · 마진 시뮬레이션
          ② 저장 · 내보내기 — 임시저장 · 보관함 · 저장 | 인쇄 · 세부견적 · 엑셀 (켜고 꺼도 칸이 그대로) | 경고는 맨 오른쪽 */}
      <div className="no-print bg-white border border-slate-200 rounded-xl divide-y divide-slate-100" data-quote-toolbar>
        <div className="flex flex-wrap items-center gap-2 p-3" data-quote-toolbar-row="edit">
          <span className="w-12 shrink-0 text-[11px] font-bold text-slate-400">작성</span>
          {isSales && (
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1" data-quote-lang title="견적서 언어 — 인쇄 · 엑셀이 이 언어로 나옵니다">
              {[['ko', '국문'], ['en', '영문']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => switchLang(k)} data-quote-lang-btn={k}
                  className={`px-3 py-1 text-xs font-bold rounded-md ${lang === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
              ))}
            </div>
          )}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {['USD', 'KRW'].map((c) => (
              <button key={c} onClick={() => switchCurrency(c)} data-quote-cur-btn={c} data-on={currency === c ? '1' : undefined}
                className={`px-3 py-1 text-xs font-bold rounded-md ${currency === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{c}</button>
            ))}
          </div>
          <input value={addCode} onChange={(e) => setAddCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addByCode()}
            placeholder="품번 입력 (ASSY·단품 자동 판별)"
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56" />
          <button onClick={() => addByCode()} disabled={adding}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            {adding ? <span className="inline-flex items-center gap-1.5"><Spin />조회 중…</span> : '+ 추가'}
          </button>
          <button onClick={() => setLines((ls) => [...ls, newLine()])}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">+ 빈 줄</button>
            <button onClick={() => setPartsOpen(true)} data-quote-parts-paste title="코드 부여 전 · BOM 등록 전 어셈블리 — 고객사 부품표를 붙여 실적가로 견적"
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100">📋 부품표로 ASSY</button>
          <button onClick={openCfg} title="금액대별 마진율 · 기준 환율(모든 PC 공통)을 고칩니다"
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">⚙ 마진구간</button>
          <div className="flex-1" />
          {isSales && (
            <button data-sim-all onClick={() => setSimFor('all')} disabled={!lines.length || totals.costKrw <= 0}
              title="제출 단가 · 환율에 따라 마진이 어떻게 바뀌는지 봅니다 (네고 보고용)"
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">📊 마진 시뮬레이션</button>
          )}
          {onClose && <button onClick={onClose} className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600">✕ 닫기</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3" data-quote-toolbar-row="out">
          <span className="w-12 shrink-0 text-[11px] font-bold text-slate-400">내보내기</span>
          <button onClick={() => draftMut.mutate()} disabled={draftMut.isPending || !lines.length}
            style={{ minWidth: '6.5rem' }} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">
            {draftMut.isPending ? <span className="inline-flex items-center gap-1.5"><Spin />보관 중…</span> : draftId ? '📝 보관 갱신' : '📝 임시저장'}
          </button>
          <button onClick={() => setDraftOpen(true)} style={{ minWidth: '6rem' }}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            📂 보관함{drafts.length ? ` ${drafts.length}` : ''}
          </button>
          <button onClick={saveClick} disabled={saveMut.isPending || !lines.length}
            style={{ minWidth: '5.5rem' }} className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white disabled:opacity-40 ${isSales ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
            {saveMut.isPending ? <span className="inline-flex items-center gap-1.5"><Spin />저장 중…</span> : '💾 저장'}
          </button>
          <span className="mx-1 h-6 border-l border-slate-200" />
          <div className="flex items-stretch">
            <button onClick={doPrint} disabled={!lines.length} data-quote-print
              title={wantSplit(printMode, lines.length) ? '갑지(금액·납기·유효기간) + 을지(세부 품목)로 나눠 인쇄합니다' : '한 장짜리 견적서로 인쇄합니다'}
              style={{ width: '10.5rem' }} className="whitespace-nowrap text-left px-3 py-1.5 text-xs font-bold rounded-l-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              🖨 인쇄{lines.length > 0 && wantSplit(printMode, lines.length) ? ' (갑지·을지)' : ''}
            </button>
            <select value={printMode} onChange={(e) => setPrintMode(e.target.value)} data-quote-print-mode
              title={`인쇄 방식 — 자동은 품목 ${SPLIT_AUTO_FROM}줄부터 갑지·을지로 나눕니다`}
              className="no-print -ml-px px-1.5 text-[11px] font-semibold rounded-r-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">
              <option value="auto">자동</option>
              <option value="single">한 장</option>
              <option value="split">갑지·을지</option>
            </select>
          </div>
          {isSales && (
            <div className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${detailOn ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`} data-quote-detail-ctl>
              <label className={`flex items-center gap-1 text-xs font-bold cursor-pointer ${detailOn ? 'text-violet-700' : 'text-slate-500'}`}
                title="인쇄 · 엑셀에 어셈블리마다 부품별 판매가(매입 실적가 + 마진) 장을 붙입니다. 부품 판매가가 고객에게 보이니 필요한 건에만 켜세요">
                <input type="checkbox" checked={detailOn} onChange={(e) => toggleDetail(e.target.checked)} data-quote-detail />세부견적 같이
              </label>
              {/* 세부견적을 꺼도 칸은 남겨 둔다 (흐리게) — 켜고 끌 때 옆 버튼이 안 움직이게 */}
              <label className={`flex items-center gap-1 pl-1.5 border-l text-[11px] font-semibold ${detailOn ? 'border-violet-200 text-violet-700 cursor-pointer' : 'border-slate-200 text-slate-300'}`}
                title="세부견적서에 제조사 · 제조사 품번 칸을 넣습니다 (기본은 품번 · 품명만)">
                <input type="checkbox" checked={!!detailPref.maker} disabled={!detailOn} onChange={(e) => setPref({ maker: e.target.checked })} data-quote-detail-maker />제조사 표기
              </label>
            </div>
          )}
          <button onClick={doExcel} disabled={!lines.length}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">📥 엑셀</button>
          <div className="flex-1" />
          {detailOn && (detailMissing > 0 || detailNoParts.length > 0) && (
            <span className="text-[11px] font-bold text-amber-600" data-quote-detail-count
              title="단가 없는 부품은 견적 단가에도, 세부견적에도 빠집니다 · 부품 정보가 없는 ASSY 는 세부견적을 못 만듭니다">
              ⚠ 세부견적 {[detailMissing > 0 && `단가없음 ${detailMissing}`, detailNoParts.length > 0 && `부품정보 없음 ${detailNoParts.length}`].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {revLoading && <div className="no-print rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">지난 견적 불러오는 중…</div>}
      {revOf && (
        <div data-rev-banner className="no-print rounded-lg border-2 border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-800 flex flex-wrap items-center gap-2">
          <span>✏ <b className="font-mono">{revOf.quote_no}</b> 수정 중 — 💾 저장하면 원본은 그대로 두고 <b className="font-mono" data-rev-next>{revOf.nextNo}</b> 로 새로 저장됩니다.</span>
          <span className="text-violet-500">단가는 제출했던 값 그대로입니다 (자재비·작업비를 고치면 그 줄만 다시 계산)</span>
          <button onClick={cancelRevision} className="ml-auto px-2 py-0.5 rounded border border-violet-300 bg-white text-violet-600 hover:bg-violet-100">✕ 수정 그만두기</button>
        </div>
      )}
      {err && <div className="no-print rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}
      {isSales && saleMissing && lines.length > 0 && (
        <div className="no-print rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-sale-missing>
          판매 실적가 표가 아직 없습니다 — Supabase 에서 「판매실적가_반영_261109.sql」을 실행하면 같은 고객사에 전에 낸 부품 · 품목 단가를 불러오고, 저장할 때 기록합니다.
        </div>
      )}
      {simFor && (() => {
        if (simFor === 'all') {
          const ruleAmt = lines.reduce((a2, l) => a2 + num(l.qty) * linePrice(l, currency, sellRate, mcfg), 0)
          return (
            <MarginSimulator title="견적 전체" subtitle={`${lines.length}줄 · 합계 기준`} qty={1}
              unitCost={totals.costKrw} basePrice={totals.amount} rulePrice={ruleAmt}
              currency={currency} baseRate={sellRate} onClose={() => setSimFor(null)}
              onApply={(p) => {
                const f = totals.amount > 0 ? p / totals.amount : 1
                setLines((ls) => ls.map((l) => ({ ...l,
                  unitPrice: roundPrice(num(l.unitPrice) * f, currency) })))
                toastSuccess(`모든 줄 단가를 ${((f - 1) * 100).toFixed(1)}% 조정했습니다 (줄마다 끝자리를 버려 합계가 조금 다를 수 있습니다)`)
                setSimFor(null)
              }} />
          )
        }
        const l = lines.find((x) => x.key === simFor)
        if (!l) return null
        const h = history[l.std_code]
        return (
          <MarginSimulator title={l.std_code || '(품번 없음)'} subtitle={l.description}
            qty={num(l.qty) || 1} unitCost={lineCost(l)} basePrice={num(l.unitPrice)}
            rulePrice={linePrice(l, currency, sellRate, mcfg)}
            lastPrice={h && h.currency === currency ? num(h.unit_price) : null}
            lastLabel={h ? `${h.quote_date} ${h.quote_no || ''}`.trim() : ''}
            currency={currency} baseRate={sellRate} onClose={() => setSimFor(null)}
            onApply={(p) => { patch(l.key, { unitPrice: p }); toastSuccess(`${l.std_code} 단가를 반영했습니다`); setSimFor(null) }} />
        )
      })()}
      {savedNo && (
        <div className="no-print rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 font-semibold">
          ✅ 저장 완료 — {isSales ? '매출' : '매입'}견적 <b>{savedNo}</b>
          {isSales && totals.laborKrw > 0 && ' · 작업비가 이력에 기록되어 다음 견적에서 자동으로 불러옵니다.'}
          <button data-quote-new onClick={() => { snack.hide(); setLines([]); setRevOf(null); setSavedNo(''); setErr('') }}
            className="ml-2 px-2 py-0.5 rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100">🆕 새 견적 시작</button>
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
        <QuotePrintSplit
          ko={ko} isSales={isSales} savedNo={savedNo} quoteDate={quoteDate}
          party={isSales ? issuedTo : (vendors.find((v) => v.id === vendorId)?.name || '')}
          attn={attn} projectName={projectName} currency={currency} sym={sym} money={money} num={num}
          validityDays={validityDays} validUntil={validUntil} deliveryNote={deliveryNote}
          leadTime={leadTime} memo={memo} lines={lines} total={totals.amount}
          contactName={contactName} contactPhone={contactPhone} contactEmail={contactEmail}
          supplier={SUPPLIER} supplierKo={SUPPLIER_KO} />
        <div className="qs-edit">
        <div className="text-center mb-4">
          <h2 className="text-3xl font-bold tracking-widest text-slate-900" data-quote-title>
            {ko ? '견 적 서' : isSales ? 'QUOTE' : 'PURCHASE QUOTE (수령)'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{ko ? '견적번호' : 'NO'} : {savedNo || '(저장 시 자동 부여)'} · {quoteDate}</p>
        </div>

        {/* Issued by / Supplier */}
        <div className="grid grid-cols-2 gap-6 mb-4 text-xs">
          <div>
            <div className="font-bold text-sm text-slate-800 border-b border-slate-300 pb-1 mb-2">{ko ? '수신' : 'Issued by'}
              {etcCust && <span className="no-print ml-2 px-1.5 py-[1px] rounded-full bg-slate-100 text-slate-500 text-[10.5px] font-bold" data-etc-cust title="견적 접수에서 「기타 · 직접 입력」한 고객사 — BOM 기준 고객사(제스코 → AXCELIS 등)의 등록 BOM 으로 찾고, 고객사 없이 저장합니다. 위에서 고객사를 바꾸면 풀립니다">기타 고객사 · {etcCust}</span>}</div>
            {isSales
              ? <div className="flex items-center gap-1"><input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} data-quote-issued
                  className="qi w-full font-bold text-sm" placeholder={ko ? '고객사 이름' : 'AXCELIS Corp.'} />{ko && <span className="font-bold text-sm shrink-0">귀중</span>}</div>
              : <div className="font-bold text-sm">{vendors.find((v) => v.id === vendorId)?.name || '(업체 미선택)'}</div>}
            <div className="flex gap-1 mt-1.5">
              <span className="text-slate-400 w-10 shrink-0">{ko ? '참조' : 'Attn'}</span>
              <input value={attn} onChange={(e) => setAttn(e.target.value)} className="qi flex-1" placeholder="담당자명" />
            </div>
            <p className="mt-3 text-slate-600">{ko ? '아래와 같이 견적합니다.' : 'We hereby provide the following quotation:'}</p>
            <p className="text-slate-500">{ko ? `견적 유효기간 : 견적일로부터 ${validityDays}일` : `Quotation Validity: ${validityDays} days from the date of the quotation`}</p>
          </div>

          <div>
            <div className="font-bold text-sm text-slate-800 border-b border-slate-300 pb-1 mb-2">{ko ? '공급자' : 'Supplier'}</div>
            {ko ? (
            <div className="text-slate-600 leading-relaxed" data-quote-supplier="ko">
              <div>상호 : <b className="text-slate-800">{SUPPLIER_KO.company}</b> · 등록번호 : {SUPPLIER_KO.bizNo}</div>
              <div>대표 : {SUPPLIER_KO.ceo}</div>
              <div>주소 : {SUPPLIER_KO.address}</div>
              <div>업태 : {SUPPLIER_KO.bizType}</div>
              <div>종목 : {SUPPLIER_KO.bizItem}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <span>담당 :</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} data-quote-contact-name
                  className="qi w-28" placeholder="담당자 이름" />
                <span>(</span>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} data-quote-contact-phone
                  className="qi w-36" placeholder="010-0000-0000" />
                <span>)</span>
              </div>
              <div>전화 : {SUPPLIER_KO.tel}   팩스 : {SUPPLIER_KO.fax}</div>
              <div className="flex items-center gap-1">
                <span>이메일 :</span>
                <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className="qi flex-1" placeholder="sales@jinsuntech.co.kr" />
              </div>
              <div className="text-slate-400">{SUPPLIER_KO.invoiceEmail} (계산서)</div>
            </div>
            ) : (
            <div className="text-slate-600 leading-relaxed" data-quote-supplier="en">
              <div>Company : {SUPPLIER.company}</div>
              <div>Business registration number : {SUPPLIER.bizNo}</div>
              <div>CEO : {SUPPLIER.ceo}</div>
              <div>Adress : {SUPPLIER.address}</div>
              <div>Business Type : {SUPPLIER.bizType}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <span>Contact :</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} data-quote-contact-name
                  className="qi w-28" placeholder="Name" />
                <span>(</span>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} data-quote-contact-phone
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
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs mb-4">
          <Row label={ko ? '견적일' : 'Date'}><input value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} type="date" className="qi" /></Row>
          <Row label={ko ? '통화' : 'Currency'}><span className="font-bold">{currency}</span></Row>
          <Row label={ko ? '건명' : 'Project Name'}><input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="qi" placeholder="RFQ_110228078" /></Row>
          <Row label={ko ? '유효기간' : 'Validity'}>
            <input type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} className="qi w-16" />
            <span className="ml-1 text-slate-400">{ko ? `일 (${validUntil}까지)` : `days (${validUntil})`}</span>
          </Row>
          <Row label={ko ? '납품 일정' : 'Delivery'}><input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} className="qi flex-1" /></Row>
        </div>

        <table className="w-full text-xs border-t-2 border-slate-800">
          <thead>
            <tr className="border-b border-slate-300 text-slate-500">
              <th className="py-2 w-8 text-left">{ko ? '번호' : 'NO'}</th>
              <th className="py-2 text-left">{ko ? '품번' : 'Item no.'}</th>
              <th className="py-2 text-left">{ko ? '품명' : 'Description'}</th>
              <th className="py-2 w-12 text-center">REV</th>
              <th className="py-2 w-12 text-center">{ko ? '단위' : 'Unit'}</th>
              <th className="py-2 w-14 text-right">{ko ? '수량' : "Q'ty"}</th>
              <th className="py-2 w-24 text-right">{ko ? '단가' : 'Unit Price'}</th>
              <th className="py-2 w-24 text-right">{ko ? '금액' : 'Amount'}</th>
              <th className="py-2 w-12 text-center">{ko ? '대체' : 'Alt.'}</th>
              <th className="py-2 w-20 text-left">{ko ? '비고' : 'Remarks'}</th>
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
                    {l.tempBom && <span className="no-print ml-1 text-[10px] font-bold text-violet-600" title="부품표 붙여넣기로 만든 줄 — BOM · 품목 등록 없음" data-temp-bom>부품표</span>}
                    {l.tempBom && isSales && (l.priceReq
                      ? <div className="no-print text-[10px] font-bold text-amber-700 mt-0.5" data-paste-req-done title="견적 접수 현황에서 진행을 보세요">💲 단가 요청함 · {l.priceReq.title}</div>
                      : l.noPrice > 0 && <button type="button" onClick={() => requestPastePrice(l)} disabled={reqBusy === l.key} data-paste-req
                          title="단가 없는 부품을 구매자재에 요청합니다 — 견적 접수 현황에 건이 생깁니다"
                          className="no-print block mt-0.5 px-1.5 py-[1px] rounded border border-amber-300 bg-amber-50 text-amber-700 text-[10px] font-bold hover:bg-amber-100 disabled:opacity-40">{reqBusy === l.key ? '요청 중…' : '💲 단가 요청'}</button>)}
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
                    {isSales && l.kind !== 'assy' && l.salePrev && <SalePrevTag x={l} buyKrw={l.materialKrw} currency={currency} sellRate={sellRate} tiers={mcfg.tiers}
                      onToggle={() => patchCost(l.key, { usePrev: l.usePrev === false })} />}
                    {isSales && l.kind === 'assy' && (() => {
                      const ps = (l.parts || []).filter((x) => prevEligible(x) && x.salePrev)
                      if (!ps.length) return null
                      const used = ps.filter((x) => prevOf(x, currency) != null)
                      const warn = used.filter((x) => prevWarn(x.buyKrw, prevOf(x, currency), currency, sellRate, mcfg.tiers)).length
                      return (
                        <button type="button" onClick={() => setOpenParts((o) => ({ ...o, [l.key]: true }))} data-sale-assy={l.key}
                          title="같은 고객사에 전에 낸 부품 판매가를 그대로 씁니다 — ▼ 부품에서 부품마다 「지금 계산가로」 바꿀 수 있습니다"
                          className="no-print block text-left text-[10px] text-emerald-700 mt-0.5 hover:underline">
                          🏷 판매 실적가 부품 {used.length}/{ps.length}
                          {warn > 0 && <span className="ml-1 font-bold text-rose-600">⚠ 마진 낮음 {warn}</span>}
                        </button>
                      )
                    })()}
                  </td>
                  <td className="py-1.5"><input value={l.rev} onChange={(e) => patch(l.key, { rev: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input type="number" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} className="qi w-full text-right" /></td>
                  <td className="py-1.5"><input type="number" step="0.01" value={l.unitPrice} onChange={(e) => patch(l.key, { unitPrice: e.target.value })} className="qi w-full text-right font-semibold" /></td>
                  <td className="py-1.5 text-right font-bold">{sym}{money(num(l.qty) * num(l.unitPrice), currency)}</td>
                  <td className="py-1.5"><input value={l.alternative} onChange={(e) => patch(l.key, { alternative: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input value={l.remarks} onChange={(e) => patch(l.key, { remarks: e.target.value })} title={l.remarks || ''} className="qi w-full" /></td>

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
                        {(() => { const k = (l.parts || []).filter((x) => x.status === 'skip' && !x.excluded).length
                          return k > 0 ? <span className="text-slate-400 font-semibold" data-skip-count title="소요량 0 · 스펙 · 문서 — 단가가 필요 없는 줄"> · 단가 제외 {k}</span> : null })()}
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
                    {isSales && cost > 0 && num(l.unitPrice) > 0 && (
                      <button data-sim-line={l.key} onClick={() => setSimFor(l.key)} title="이 줄 마진 시뮬레이션"
                        className="block ml-auto text-[10px] text-indigo-500 hover:text-indigo-700 underline">📊 시뮬</button>
                    )}
                  </td>
                  <td className="py-1.5 no-print"><button onClick={() => remove(l.key)} className="text-slate-300 hover:text-rose-500">✕</button></td>
                </tr>
                {/* 미정 조립품 — 하위 단가가 비었는데 상위 단가는 있음 → 구매 / 자작 정하기 (v4.126.0) */}
                {supplyHints(l.parts).map((h) => (
                  <tr key={l.key + '-h' + h.uid} className="no-print" data-supply-hint={h.std_code}>
                    <td colSpan={14} className="px-2 pb-2">
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
                        <span>⚠ <b className="font-mono">{h.std_code}</b> {h.name} — 하위 {h.missing}줄 단가없음 · <b>상위 단가 ₩{won(h.buyKrw)} 있음</b> <span className="text-amber-700">(구매/자작 미정)</span></span>
                        <span className="ml-auto flex gap-1.5">
                          <button type="button" disabled={supBusy === h.item_id} onClick={() => designate(h.item_id, 'buy', h.std_code)} data-supply-buy
                            className="px-2.5 py-1 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100 disabled:opacity-50">🛒 구매로 지정 → 상위 단가로 계산</button>
                          <button type="button" disabled={supBusy === h.item_id} onClick={() => designate(h.item_id, 'make', h.std_code)} data-supply-make
                            className="px-2.5 py-1 rounded-lg border border-cyan-300 bg-cyan-50 text-cyan-700 font-bold hover:bg-cyan-100 disabled:opacity-50">🔧 자작 — 하위 단가 받기</button>
                        </span>
                        <span className="w-full text-[10.5px] text-amber-700">어느 쪽이든 BOM 화면의 구매/자작 표시에 같이 저장됩니다 — 🛒 구매면 부족자재 · 소요량도 상위 1줄만 셉니다 (통째로 사 오는 품목일 때만)</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {openParts[l.key] && l.parts && (
                  <tr key={l.key + '-p'} className="no-print bg-slate-50/80">
                    <td colSpan={14} className="px-3 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-bold text-slate-500">
                          세부견적 — {l.std_code} 부품 {l.parts.length}건
                          {(() => { const b = l.parts.filter((x) => x.supplyBuy).length, k = l.parts.filter((x) => x.supplySkip).length
                            return b > 0 ? <span className="ml-2 font-normal text-indigo-500" data-supply-sum>· 🛒 구매 조립품 {b} — 하위 {k}줄은 상위 단가에 포함</span> : null })()}
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
                              <th className="px-2 py-1.5 w-24 text-left" title="BOM 화면의 상위품목 구매/자작 표시 — 🛒 구매면 상위 단가 하나로 계산">구매/자작</th>
                              <th className="px-2 py-1.5 w-28 text-left">제조사</th>
                              <th className="px-2 py-1.5 w-32 text-left">제조사품번</th>
                              <th className="px-2 py-1.5 w-24 text-right">매입가(원)</th>
                              <th className="px-2 py-1.5 w-16 text-right">수량</th>
                              <th className="px-2 py-1.5 w-12 text-center">단위</th>
                              <th className="px-2 py-1.5 w-16 text-right" title="발주 후 입고까지 걸리는 주 수">L/T(주)</th>
                              <th className="px-2 py-1.5 w-16 text-right" title="최소 주문수량">MOQ</th>
                              <th className="px-2 py-1.5 w-24 text-right">소계(원)</th>
                              {isSales && <th className="px-2 py-1.5 w-36 text-right" title="같은 고객사 · 같은 통화로 전에 낸 이 부품 판매가 — 있으면 그 값을 씁니다">판매 실적가</th>}
                              <th className="px-2 py-1.5 w-14 text-center">구분</th>
                              <th className="px-2 py-1.5 w-28 text-left">구매처</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.parts.map((pt) => (
                              <tr key={pt.uid}
                                className={`border-t border-slate-100 ${pt.excluded ? 'opacity-40' : ''} ${
                                  pt.status === 'skip' ? 'bg-slate-50/70' : pt.status === 'unreg' ? 'bg-rose-50' : pt.buyKrw == null ? 'bg-amber-50' : ''}`}>
                                <td className="px-2 py-1 text-center">
                                  <input type="checkbox" checked={!pt.excluded}
                                    onChange={() => patchPart(l.key, pt.uid, { excluded: !pt.excluded })} />
                                </td>
                                <td className="px-2 py-1 text-slate-400">L{pt.level}</td>
                                <td className="px-2 py-1 font-mono text-slate-700"
                                  style={{ paddingLeft: `${8 + (Number(pt.level) || 0) * 10}px` }}>{pt.std_code || '—'}</td>
                                <td className="px-2 py-1 text-slate-600 max-w-[220px] truncate" title={pt.name}>{pt.name}</td>
                                <td className="px-2 py-1 whitespace-nowrap" data-part-supply={pt.supplyBuy ? 'buy' : pt.supplySkip ? 'skip' : pt.supply || ''}>
                                  {pt.supplyBuy ? <span className="px-1.5 py-[1px] rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 text-[10px] font-bold">🛒 구매 · 상위 단가</span>
                                    : pt.supplySkip ? <span className="px-1.5 py-[1px] rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold" title="상위가 🛒 구매 — 상위 단가에 포함돼 단가가 필요 없습니다">구매품 하위</span>
                                    : pt.isParentNode && pt.supply === 'make' ? <span className="px-1.5 py-[1px] rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 text-[10px] font-bold">🔧 자작</span>
                                    : pt.isParentNode ? <span className="text-[10px] text-slate-400">미정</span> : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-2 py-1 text-slate-500 truncate" title={pt.manufacturer}>{pt.manufacturer || '-'}</td>
                                <td className="px-2 py-1 font-mono text-slate-500 truncate" title={pt.manufacturer_code}>{pt.manufacturer_code || '-'}</td>
                                <td className="px-2 py-1 text-right">
                                  <input type="number" value={pt.buyKrw ?? ''}
                                    onChange={(e) => patchPart(l.key, pt.uid, {
                                      buyKrw: e.target.value === '' ? null : Number(e.target.value),
                                      status: e.target.value === '' ? (pt.skip ? 'skip' : 'noprice') : 'ok',
                                    })}
                                    placeholder={pt.supplySkip ? '단가 불필요' : pt.status === 'skip' ? '단가 제외' : pt.isParentNode && pt.excluded ? '중간 어셈블리' : '미등록'}
                                    title={pt.status === 'skip' ? `단가 제외 — ${pt.skip}. 값을 넣으면 원가에 들어갑니다` : undefined}
                                    data-skip={pt.status === 'skip' ? pt.skip : undefined}
                                    className={`qi w-full text-right ${pt.status === 'skip' ? 'placeholder:text-slate-400' : ''}`} />
                                  {pt.status === 'skip' && <div className="text-[9.5px] text-slate-400 whitespace-nowrap">{pt.skip}</div>}
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
                                {isSales && (
                                  <td className="px-2 py-1 text-right" data-sale-part={pt.std_code || pt.manufacturer_code || ''}>
                                    {pt.salePrev && prevEligible(pt)
                                      ? <SalePrevTag x={pt} buyKrw={pt.buyKrw} currency={currency} sellRate={sellRate} tiers={mcfg.tiers} compact parent={l.std_code}
                                          onToggle={() => patchPart(l.key, pt.uid, { usePrev: pt.usePrev === false })} />
                                      : <span className="text-slate-300">—</span>}
                                  </td>
                                )}
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
                        · 하위 부품을 가진 중간 어셈블리는 자동으로 제외됩니다(상하위 중복 방지) — 단, BOM 에서 <span className="text-indigo-500">🛒 구매</span>로 지정한 조립품은 상위 단가 하나로 세고 하위는 「구매품 하위」로 뺍니다.
                        · <span className="text-amber-600">노랑=매입가 미등록</span>, <span className="text-rose-400">빨강=품목 미등록</span>, <span className="text-slate-500">회색 「단가 제외」=소요량 0 · 스펙 · 문서 (단가 필요 없음)</span>.
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
              <EmptyRow cols={14} title="품번을 추가하거나 원가분석에서 어셈블리를 가져오세요" />
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 font-bold">
              <td colSpan={7} className="py-2 text-right pr-3">{ko ? '합계 (부가세 별도)' : 'TOTAL'}</td>
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
          <div className="flex gap-2 items-center"><span className="w-24 text-slate-400">{ko ? '납기' : 'Lead Time'}</span>
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
          <div className="flex gap-2"><span className="w-24 text-slate-400">{ko ? '유효기간' : 'Validity'}</span>
            <span>{ko ? `견적일로부터 ${validityDays}일 (${validUntil}까지)` : `${validityDays} days from the date of quotation (${validUntil})`}</span></div>
          <div className="flex gap-2"><span className="w-24 text-slate-400">{ko ? '비고' : 'Remarks'}</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className="qi flex-1" placeholder="특이사항" /></div>
        </div>
        </div>{/* .qs-edit */}
        {detailOn && (
          <QuoteDetailPrint ko={ko} savedNo={savedNo} quoteDate={quoteDate} party={issuedTo} projectName={projectName}
            currency={currency} sym={sym} money={money} details={details} showMaker={!!detailPref.maker} />
        )}
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
                      {kstDT(d.updated_at)}{d.created_by ? ` · ${d.created_by}` : ''}
                    </p>
                  </div>
                  <button onClick={() => loadDraft(d.id)}
                    className="shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">불러오기</button>
                  <button onClick={async () => { if (await ask({ title: `「${d.title || '제목 없음'}」 을 보관함에서 지울까요?`, desc: '임시저장해 둔 내용이 사라지고 되돌릴 수 없습니다. 저장(💾)한 견적은 견적 이력에 그대로 남습니다.', okText: '삭제', danger: true })) draftDelMut.mutate(d.id) }} data-draft-del
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
                <h3 className="text-sm font-bold text-slate-800">⚙ 마진 구간 · 기준 환율</h3>
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

              <div className="pt-3 mt-2 border-t border-slate-100 space-y-1.5" data-cfg-rates>
                <p className="text-xs font-bold text-slate-600">기준 환율 <span className="font-normal text-slate-400">— 매출견적을 열 때 이 값으로 시작합니다 (화면에서 고친 값은 그 견적에만)</span></p>
                {[['buyRate', '매입환율 (원/$)'], ['sellRate', '판매환율 (원/$)']].map(([k, l]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="flex-1 text-xs font-semibold text-slate-500 text-right pr-1">{l}</span>
                    <input type="number" data-cfg-rate={k} value={tierDraft[k] ?? ''}
                      onChange={(e) => setTierDraft((s0) => ({ ...s0, [k]: e.target.value }))}
                      className="w-24 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                    <span className="w-2" />
                  </div>
                ))}
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

// 판매 실적가 표시 (v4.162.0) — 값 · 견적번호 · 날짜 · 지금 매입가 기준 마진 경고 · 「지금 계산가로 / 실적가로」
function SalePrevTag({ x, buyKrw, currency, sellRate, tiers, compact, parent, onToggle }) {
  const sp = x.salePrev
  if (!sp) return null
  const same = sp.currency === currency
  const on = same && x.usePrev !== false
  const warn = same ? prevWarn(buyKrw, sp.price, currency, sellRate, tiers) : null
  const m = same ? prevMargin(buyKrw, sp.price, currency, sellRate) : null
  const otherAssy = sp.parent_code && parent && String(sp.parent_code).toUpperCase() !== String(parent).toUpperCase()
  const tip = `${sp.quote_no || ''} · ${sp.quote_date || ''}${sp.parent_code ? ` · ${sp.parent_code} 세부` : ''}${sp.detail_sent ? ' · 세부견적 제출' : ''}${m != null ? ` · 지금 매입가 기준 마진 ${(m * 100).toFixed(1)}%` : ''}`
  return (
    <div className={`no-print text-[10px] mt-0.5 ${compact ? 'text-right' : ''}`} data-sale-prev={on ? 'on' : 'off'} title={tip}>
      <span className={on ? 'font-bold text-emerald-700' : 'text-slate-400 line-through'}>
        🏷 {money(sp.price, sp.currency)} {sp.currency !== 'KRW' ? sp.currency : '원'}
      </span>
      {!compact && <span className="text-slate-400"> · {sp.quote_date} ({sp.quote_no})</span>}
      {compact && <div className="text-slate-400 whitespace-nowrap">{sp.quote_date}{otherAssy ? ` · ${String(sp.parent_code).replace(/^AX-/i, '')}` : ''}</div>}
      {on && warn && <span className={`ml-1 font-bold ${warn === 'loss' ? 'text-rose-600' : 'text-amber-600'}`} data-sale-warn={warn}>
        ⚠ {warn === 'loss' ? '적자' : '마진 낮음'}{m != null ? ` ${(m * 100).toFixed(0)}%` : ''}</span>}
      {same && <button type="button" onClick={onToggle} data-sale-toggle
        className="ml-1 underline text-indigo-500 hover:text-indigo-700">{on ? '지금 계산가로' : '실적가로'}</button>}
      {!same && <span className="ml-1 text-slate-400">(다른 통화 — 안 씀)</span>}
    </div>
  )
}
