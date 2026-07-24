import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { tierMargin, DEFAULT_CFG, explodeBOM, computeCost } from '../../lib/costAnalysis'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const money = (v, cur) =>
  cur === 'KRW'
    ? Math.round(num(v)).toLocaleString('ko-KR')
    : num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const won = (v) => Math.round(num(v)).toLocaleString('ko-KR')
const pct = (v) => (num(v) * 100).toFixed(1) + '%'
const todayISO = () => new Date().toISOString().slice(0, 10)

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
  noPrice: 0, partCount: 0, laborSrc: null,
  ...p,
})

const lineCost = (l) => num(l.materialKrw) + num(l.laborKrw)

// 매입원가(원) → 매출단가. 마진은 금액대별 자동(20/25/35/45%).
function priceFrom(costKrw, currency, sellRate, marginOverride) {
  const c = num(costKrw)
  if (c <= 0) return 0
  const m = marginOverride != null ? num(marginOverride) : tierMargin(c)
  const krw = c / (1 - m)
  return currency === 'KRW' ? Math.round(krw) : krw / (num(sellRate) || 1)
}

export default function QuoteSheet({ customerId, customerName, initialLine, cfg = DEFAULT_CFG, onClose }) {
  // ★ 매출견적(고객사 제출) / 매입견적(업체 수령) — 섞이면 안 되는 구분
  const [quoteKind, setQuoteKind] = useState('sales')
  const isSales = quoteKind === 'sales'

  const [currency, setCurrency] = useState('USD')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [issuedTo, setIssuedTo] = useState(customerName || '')
  const [vendorId, setVendorId] = useState('')
  const [attn, setAttn] = useState('')
  const [projectName, setProjectName] = useState('')
  const [validityDays, setValidityDays] = useState(15)
  const [leadTime, setLeadTime] = useState('L/T 8W')
  const [deliveryNote, setDeliveryNote] = useState('(To be discussed later)')
  const [memo, setMemo] = useState('')

  const [lines, setLines] = useState([])
  const [addCode, setAddCode] = useState('')
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState({})
  const [savedNo, setSavedNo] = useState('')
  const [err, setErr] = useState('')

  const sellRate = num(cfg.sellRate) || 1250

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
      const { data: proj } = await supabase
        .from('projects').select('id, code, name, rev')
        .eq('customer_id', customerId).eq('code', code).maybeSingle()

      if (proj) {
        const { data: rows } = await supabase
          .from('bom')
          .select('level, qty_per_unit, seq, created_at, items!bom_item_id_fkey(std_code, name, purchase_price, vendors(name))')
          .eq('customer_id', customerId).eq('project_id', proj.id)
          .order('seq').order('created_at')

        const mapped = (rows || []).map((b, i) => ({
          uid: i, level: b.level, qty_per_unit: b.qty_per_unit,
          purchase_price: b.items?.purchase_price ?? null,
          vendor: b.items?.vendors?.name || '',
          registered: !!b.items,
        }))
        // 작업비는 라인에서 따로 잡으므로 여기선 0 (= 자재비만 계산)
        const c = computeCost(explodeBOM(mapped), cfg, {}, 0)
        const noPrice = c.items.filter((r) => !r.excluded && r.status !== 'ok').length

        // 최신 작업비 자동 조회
        let laborKrw = 0, laborSrc = null
        const { data: lb } = await supabase.rpc('pm_labor_latest', { p_codes: [proj.code] })
        if (lb && lb[0]) { laborKrw = num(lb[0].labor_krw); laborSrc = lb[0] }

        setLines((ls) => [...ls, newLine({
          kind: 'assy',
          std_code: proj.code, description: proj.name || '', rev: proj.rev || '',
          unit: 'EA', qty: 1,
          materialKrw: c.totalBuyKrw, laborKrw, laborSrc,
          origin: c.impKrw > c.domKrw ? 'imp' : 'dom',
          noPrice, partCount: c.items.length,
          unitPrice: isSales ? priceFrom(c.totalBuyKrw + laborKrw, currency, sellRate) : 0,
        })])
        setAddCode('')
        return
      }

      const { data } = await supabase
        .from('items').select('std_code, name, unit, purchase_price, vendors(name)')
        .eq('std_code', code).maybeSingle()
      if (!data) { setErr(`${code} 는 어셈블리·품목 어디에도 없습니다.`); return }
      const mat = num(data.purchase_price)
      setLines((ls) => [...ls, newLine({
        kind: 'item',
        std_code: data.std_code, description: data.name || '',
        unit: data.unit || 'EA', qty: 1,
        materialKrw: mat, vendor: data.vendors?.name || '',
        noPrice: mat > 0 ? 0 : 1, partCount: 1,
        unitPrice: isSales ? priceFrom(mat, currency, sellRate) : 0,
      })])
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
    return isSales ? { ...n, unitPrice: priceFrom(lineCost(n), currency, sellRate, n.marginPct) } : n
  }))

  const remove = (key) => setLines((ls) => ls.filter((l) => l.key !== key))

  function switchCurrency(next) {
    setCurrency(next)
    if (!isSales) return
    setLines((ls) => ls.map((l) => ({ ...l, unitPrice: priceFrom(lineCost(l), next, sellRate, l.marginPct) })))
  }

  function switchKind(next) {
    setQuoteKind(next)
    setSavedNo(''); setErr('')
    if (next === 'sales') {
      setLines((ls) => ls.map((l) => ({ ...l, unitPrice: priceFrom(lineCost(l), currency, sellRate, l.marginPct) })))
    }
  }

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
        await supabase.from('pm_labor_costs')
          .upsert(labor, { onConflict: 'std_code,effective_date,source,quote_no' })
      }
      return no
    },
    onSuccess: (no) => { setSavedNo(no); setErr('') },
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

  function doExcel() {
    const cur = currency
    const kindLabel = isSales ? '매출견적' : '매입견적'
    const quoteRows = lines.map((l, i) => ({
      NO: i + 1, 'Item no.': l.std_code, Description: l.description, REV: l.rev,
      Unit: l.unit, Quantity: num(l.qty),
      [`Unit Price (${cur})`]: num(l.unitPrice),
      [`Amount (${cur})`]: num(l.qty) * num(l.unitPrice),
      alternative: l.alternative, Remarks: l.remarks,
    }))
    quoteRows.push({
      NO: '', 'Item no.': '', Description: 'TOTAL', REV: '', Unit: '', Quantity: '',
      [`Unit Price (${cur})`]: '', [`Amount (${cur})`]: totals.amount, alternative: '', Remarks: '',
    })

    const detailRows = lines.map((l, i) => ({
      NO: i + 1, 구분: l.kind === 'assy' ? 'ASSY' : '단품',
      Itemno: l.std_code, Description: l.description, REV: l.rev, QTY: num(l.qty),
      '자재비(원)': num(l.materialKrw),
      '작업비(원)': num(l.laborKrw),
      '원가계(원)': lineCost(l),
      '원가합계(원)': num(l.qty) * lineCost(l),
      '마진율': isSales ? (l.marginPct != null ? num(l.marginPct) : tierMargin(lineCost(l))) : '',
      [`단가(${cur})`]: num(l.unitPrice),
      [`합계(${cur})`]: num(l.qty) * num(l.unitPrice),
      '구매처': l.vendor,
      '수입/내수': l.origin === 'imp' ? '수입' : '내수',
      '직전견적': history[l.std_code]
        ? `${history[l.std_code].unit_price} ${history[l.std_code].currency} (${history[l.std_code].quote_date})` : '',
    }))

    const info = [
      { 항목: '견적구분', 값: kindLabel },
      { 항목: '견적번호', 값: savedNo || '(미저장)' },
      { 항목: '견적일', 값: quoteDate },
      { 항목: isSales ? 'Issued to' : '업체', 값: isSales ? issuedTo : (vendors.find((v) => v.id === vendorId)?.name || '') },
      { 항목: 'Attn', 값: attn },
      { 항목: 'Project Name', 값: projectName },
      { 항목: '통화', 값: cur },
      { 항목: '판매환율', 값: sellRate },
      { 항목: '유효기간(일)', 값: validityDays },
      { 항목: 'Lead Time', 값: leadTime },
      { 항목: '자재비 합계(원)', 값: Math.round(totals.materialKrw) },
      { 항목: '작업비 합계(원)', 값: Math.round(totals.laborKrw) },
      { 항목: '원가 합계(원)', 값: Math.round(totals.costKrw) },
      ...(isSales ? [
        { 항목: '매출(원)', 값: Math.round(totals.revenueKrw) },
        { 항목: '마진(원)', 값: Math.round(totals.marginKrw) },
        { 항목: '마진율', 값: pct(totals.marginPct) },
      ] : []),
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quoteRows), '견적서')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), '세부견적')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(info), '견적정보')
    XLSX.writeFile(wb, `${kindLabel}_${savedNo || projectName || todayISO()}.xlsx`)
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
          @page { size: A4; margin: 0; }
        }
        .qi{border:0;border-bottom:1px solid #e2e8f0;padding:2px 4px;font-size:12px;outline:none;background:transparent}
        .qi:focus{border-bottom-color:#6366f1}
        @media print{.qi{border:0}}
      `}</style>

      {/* 매출/매입 구분 — 색으로 확실히 갈라둔다 */}
      <div className={`no-print rounded-xl border-2 p-3 ${isSales ? 'border-indigo-300 bg-indigo-50/50' : 'border-amber-400 bg-amber-50/60'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200">
            {[['sales', '📤 매출견적', '고객사에 제출'], ['purchase', '📥 매입견적', '업체에서 수령']].map(([k, l, t]) => (
              <button key={k} onClick={() => switchKind(k)} title={t}
                className={`px-3 py-1.5 text-xs font-bold rounded-md ${quoteKind === k
                  ? (k === 'sales' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-white')
                  : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
            ))}
          </div>

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
        <div className="flex-1" />
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
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-wide text-slate-900">
              {isSales ? 'QUOTATION' : 'PURCHASE QUOTATION (수령)'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">NO : {savedNo || '(저장 시 자동 부여)'}</p>
          </div>
          <div className="text-right text-xs text-slate-600 leading-relaxed">
            <div className="font-bold text-sm text-slate-800">JINSUN TECH CO., LTD.</div>
            <div>구매자재팀</div>
            <div>gyohan@jinsuntech.co.kr</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs mb-4">
          <Row label="Date"><input value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} type="date" className="qi" /></Row>
          <Row label={isSales ? 'Issued to' : 'From (업체)'}>
            {isSales
              ? <input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} className="qi" placeholder="AXCELIS Corp." />
              : <span className="font-semibold">{vendors.find((v) => v.id === vendorId)?.name || '(업체 미선택)'}</span>}
          </Row>
          <Row label="Project Name"><input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="qi" placeholder="RFQ_110228078" /></Row>
          <Row label="Attn"><input value={attn} onChange={(e) => setAttn(e.target.value)} className="qi" placeholder="담당자명" /></Row>
          <Row label="Currency"><span className="font-bold">{currency}</span></Row>
          <Row label="Validity">
            <input type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} className="qi w-16" />
            <span className="ml-1 text-slate-400">days ({validUntil})</span>
          </Row>
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
                <tr key={l.key} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 text-slate-400">{i + 1}</td>
                  <td className="py-1.5">
                    <input value={l.std_code} onChange={(e) => patch(l.key, { std_code: e.target.value })} className="qi font-mono w-full" />
                    {l.kind === 'assy' && <span className="no-print text-[10px] font-bold text-sky-600">ASSY</span>}
                  </td>
                  <td className="py-1.5">
                    <input value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} className="qi w-full" />
                    {h && (
                      <div className="no-print text-[10px] text-indigo-500 mt-0.5">
                        직전 {h.unit_price} {h.currency} · {h.quote_date} ({h.quote_no})
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
                    <input type="number" value={l.materialKrw} onChange={(e) => patchCost(l.key, { materialKrw: Number(e.target.value) })} className="qi w-full text-right" />
                    {l.kind === 'assy' && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        부품 {l.partCount}
                        {l.noPrice > 0 && <span className="text-amber-600 font-bold"> · 단가없음 {l.noPrice}</span>}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 no-print text-right">
                    {l.kind === 'assy' ? (
                      <>
                        <input type="number" value={l.laborKrw} onChange={(e) => patchCost(l.key, { laborKrw: Number(e.target.value) })}
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
          <div className="flex gap-2"><span className="w-24 text-slate-400">Delivery</span>
            <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} className="qi flex-1" /></div>
          <div className="flex gap-2"><span className="w-24 text-slate-400">Lead Time</span>
            <input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} className="qi flex-1" /></div>
          <div className="flex gap-2"><span className="w-24 text-slate-400">Validity</span>
            <span>{validityDays} days from the date of quotation ({validUntil})</span></div>
          <div className="flex gap-2"><span className="w-24 text-slate-400">Remarks</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className="qi flex-1" placeholder="특이사항" /></div>
        </div>
      </div>
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
