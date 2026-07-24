import { useState, useMemo, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { tierMargin, DEFAULT_CFG } from '../../lib/costAnalysis'

// ── 표시 헬퍼 ──
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
  std_code: '', description: '', rev: '', unit: 'EA', qty: 1,
  unitPrice: 0, alternative: '', remarks: '',
  costKrw: 0, vendor: '', origin: 'dom', marginPct: null,
  ...p,
})

// 매입원가(원) → 견적단가. 마진은 금액대별 자동(20/25/35/45%).
function priceFrom(costKrw, currency, sellRate, marginOverride) {
  const c = num(costKrw)
  if (c <= 0) return 0
  const m = marginOverride != null ? num(marginOverride) : tierMargin(c)
  const krw = c / (1 - m)
  return currency === 'KRW' ? Math.round(krw) : krw / (num(sellRate) || 1)
}

export default function QuoteSheet({ customerId, customerName, initialLine, cfg = DEFAULT_CFG, onClose }) {
  const [currency, setCurrency] = useState('USD')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [issuedTo, setIssuedTo] = useState(customerName || '')
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

  // 원가분석에서 넘어온 어셈블리 1줄로 시작
  useEffect(() => {
    if (!initialLine) return
    setLines([newLine(initialLine)])
    if (initialLine.std_code) setProjectName('RFQ_' + initialLine.std_code.replace(/^AX-/, ''))
  }, [initialLine])

  // 견적 이력 조회 (품번별 최근 견적단가)
  useEffect(() => {
    const codes = lines.map((l) => l.std_code).filter(Boolean)
    if (!codes.length) return
    let alive = true
    supabase.rpc('pm_quote_history', { p_codes: codes }).then(({ data }) => {
      if (!alive || !data) return
      const m = {}
      data.forEach((d) => { m[d.std_code] = d })
      setHistory(m)
    })
    return () => { alive = false }
  }, [lines.map((l) => l.std_code).join(',')])

  // ── 품번으로 라인 추가 (단품 견적) ──
  async function addByCode() {
    const code = AX(addCode)
    if (!code) return
    setAdding(true); setErr('')
    try {
      const { data } = await supabase
        .from('items')
        .select('std_code, name, unit, purchase_price, vendors(name)')
        .eq('std_code', code)
        .maybeSingle()
      if (!data) { setErr(`${code} 는 품목 마스터에 없습니다.`); return }
      const costKrw = num(data.purchase_price)
      setLines((ls) => [...ls, newLine({
        std_code: data.std_code,
        description: data.name || '',
        unit: data.unit || 'EA',
        qty: 1,
        costKrw,
        vendor: data.vendors?.name || '',
        unitPrice: priceFrom(costKrw, currency, sellRate),
      })])
      setAddCode('')
    } finally { setAdding(false) }
  }

  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const remove = (key) => setLines((ls) => ls.filter((l) => l.key !== key))

  // 통화 바꾸면 단가 재산출 (사용자가 직접 입력한 값도 다시 계산됨을 명시)
  function switchCurrency(next) {
    setCurrency(next)
    setLines((ls) => ls.map((l) => ({
      ...l, unitPrice: priceFrom(l.costKrw, next, sellRate, l.marginPct),
    })))
  }

  // ── 합계 ──
  const totals = useMemo(() => {
    const amount = lines.reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0)
    const costKrw = lines.reduce((a, l) => a + num(l.qty) * num(l.costKrw), 0)
    const revenueKrw = currency === 'KRW' ? amount : amount * sellRate
    const marginKrw = revenueKrw - costKrw
    const marginPct = revenueKrw > 0 ? marginKrw / revenueKrw : 0
    return { amount, costKrw, revenueKrw, marginKrw, marginPct }
  }, [lines, currency, sellRate])

  // ── 저장 ──
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('품목이 없습니다.')
      const { data: no, error: nErr } = await supabase.rpc('pm_next_quote_no', { p_date: quoteDate })
      if (nErr) throw new Error('견적번호 채번 실패: ' + nErr.message)

      const { data: q, error: qErr } = await supabase.from('pm_quotes').insert({
        quote_no: no, quote_date: quoteDate, customer_id: customerId || null,
        quote_type: lines.length === 1 && initialLine ? 'assy' : 'single',
        currency, project_name: projectName || null, issued_to: issuedTo || null,
        attn: attn || null, validity_days: num(validityDays) || null,
        lead_time: leadTime || null, delivery_note: deliveryNote || null,
        buy_rate: num(cfg.buyRate) || null, sell_rate: sellRate,
        total_amount: totals.amount, total_cost_krw: totals.costKrw,
        margin_pct: totals.marginPct, memo: memo || null,
      }).select('id, quote_no').single()
      if (qErr) throw new Error('견적 저장 실패: ' + qErr.message)

      const rows = lines.map((l, i) => ({
        quote_id: q.id, line_no: i + 1,
        std_code: l.std_code || null, description: l.description || null,
        rev: l.rev || null, unit: l.unit || 'EA', qty: num(l.qty),
        unit_price: num(l.unitPrice), alternative: l.alternative || null,
        remarks: l.remarks || null, cost_krw: num(l.costKrw) || null,
        vendor: l.vendor || null, origin: l.origin || null,
        margin_pct: l.marginPct != null ? num(l.marginPct) : null,
      }))
      const { error: iErr } = await supabase.from('pm_quote_items').insert(rows)
      if (iErr) throw new Error('견적 품목 저장 실패: ' + iErr.message)
      return q.quote_no
    },
    onSuccess: (no) => { setSavedNo(no); setErr('') },
    onError: (e) => setErr(e.message),
  })

  // ── 인쇄 ──
  function doPrint() {
    document.body.classList.add('printing-quote')
    const done = () => {
      document.body.classList.remove('printing-quote')
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    setTimeout(() => window.print(), 60)
  }

  // ── 엑셀 (견적서 + 세부견적 2시트) ──
  function doExcel() {
    const cur = currency
    const quoteRows = lines.map((l, i) => ({
      NO: i + 1,
      'Item no.': l.std_code,
      Description: l.description,
      REV: l.rev,
      Unit: l.unit,
      Quantity: num(l.qty),
      [`Unit Price (${cur})`]: num(l.unitPrice),
      [`Amount (${cur})`]: num(l.qty) * num(l.unitPrice),
      alternative: l.alternative,
      Remarks: l.remarks,
    }))
    quoteRows.push({
      NO: '', 'Item no.': '', Description: 'TOTAL', REV: '', Unit: '', Quantity: '',
      [`Unit Price (${cur})`]: '', [`Amount (${cur})`]: totals.amount, alternative: '', Remarks: '',
    })

    const detailRows = lines.map((l, i) => ({
      NO: i + 1,
      Itemno: l.std_code,
      Description: l.description,
      REV: l.rev,
      QTY: num(l.qty),
      '매입가(원)': num(l.costKrw),
      '매입가합계(원)': num(l.qty) * num(l.costKrw),
      '마진율': l.marginPct != null ? num(l.marginPct) : tierMargin(l.costKrw),
      [`견적단가(${cur})`]: num(l.unitPrice),
      [`견적합계(${cur})`]: num(l.qty) * num(l.unitPrice),
      '구매처': l.vendor,
      '구분': l.origin === 'imp' ? '수입' : '내수',
      '직전견적': history[l.std_code] ? `${history[l.std_code].unit_price} ${history[l.std_code].currency} (${history[l.std_code].quote_date})` : '',
    }))

    const info = [
      { 항목: '견적번호', 값: savedNo || '(미저장)' },
      { 항목: '견적일', 값: quoteDate },
      { 항목: 'Issued to', 값: issuedTo },
      { 항목: 'Attn', 값: attn },
      { 항목: 'Project Name', 값: projectName },
      { 항목: '통화', 값: cur },
      { 항목: '판매환율', 값: sellRate },
      { 항목: '유효기간(일)', 값: validityDays },
      { 항목: 'Lead Time', 값: leadTime },
      { 항목: '매입원가 합계(원)', 값: Math.round(totals.costKrw) },
      { 항목: '매출(원)', 값: Math.round(totals.revenueKrw) },
      { 항목: '마진(원)', 값: Math.round(totals.marginKrw) },
      { 항목: '마진율', 값: pct(totals.marginPct) },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quoteRows), '견적서')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), '세부견적')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(info), '견적정보')
    XLSX.writeFile(wb, `견적서_${savedNo || projectName || todayISO()}.xlsx`)
  }

  const sym = currency === 'KRW' ? '₩' : '$'
  const validUntil = (() => {
    const d = new Date(quoteDate)
    d.setDate(d.getDate() + (num(validityDays) || 0))
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
            position: absolute; left:0; top:0; width:100%;
            padding: 12mm; background:#fff;
          }
          body.printing-quote .no-print { display: none !important; }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      {/* 조작부 */}
      <div className="no-print flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-3">
        <span className="text-sm font-bold text-slate-800">📄 견적서</span>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['USD', 'KRW'].map((c) => (
            <button key={c} onClick={() => switchCurrency(c)}
              className={`px-3 py-1 text-xs font-bold rounded-md ${currency === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{c}</button>
          ))}
        </div>
        <input value={addCode} onChange={(e) => setAddCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addByCode()}
          placeholder="품번으로 라인 추가 (단품)"
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-52" />
        <button onClick={addByCode} disabled={adding}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          {adding ? '조회 중…' : '+ 추가'}
        </button>
        <button onClick={() => setLines((ls) => [...ls, newLine()])}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">+ 빈 줄</button>
        <div className="flex-1" />
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !lines.length}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
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
          ✅ 저장 완료 — 견적번호 <b>{savedNo}</b>. 이 품번들의 다음 견적부터 직전 단가가 자동으로 참조됩니다.
        </div>
      )}

      {/* 마진 요약 (내부용, 인쇄 제외) */}
      <div className="no-print grid grid-cols-2 md:grid-cols-4 gap-2">
        <Mini label="견적 합계" value={sym + money(totals.amount, currency)} />
        <Mini label="매입원가" value={won(totals.costKrw) + '원'} />
        <Mini label="마진" value={won(totals.marginKrw) + '원'} accent={totals.marginKrw >= 0 ? 'emerald' : 'rose'} />
        <Mini label="마진율" value={pct(totals.marginPct)} accent={totals.marginPct >= 0.2 ? 'emerald' : 'amber'} />
      </div>

      {/* ── 인쇄 영역 ── */}
      <div className="quote-print-area bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-wide text-slate-900">QUOTATION</h2>
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
          <Row label="Issued to"><input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} className="qi" placeholder="AXCELIS Corp." /></Row>
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
              <th className="py-2 w-16 text-right">Q'ty</th>
              <th className="py-2 w-24 text-right">Unit Price</th>
              <th className="py-2 w-24 text-right">Amount</th>
              <th className="py-2 w-14 text-center">Alt.</th>
              <th className="py-2 w-24 text-left">Remarks</th>
              <th className="py-2 w-6 no-print"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const h = history[l.std_code]
              return (
                <tr key={l.key} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 text-slate-400">{i + 1}</td>
                  <td className="py-1.5"><input value={l.std_code} onChange={(e) => patch(l.key, { std_code: e.target.value })} className="qi font-mono w-full" /></td>
                  <td className="py-1.5">
                    <input value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} className="qi w-full" />
                    {h && (
                      <div className="no-print text-[10px] text-indigo-500 mt-0.5">
                        직전 {h.unit_price} {h.currency} · {h.quote_date} ({h.quote_no})
                      </div>
                    )}
                  </td>
                  <td className="py-1.5"><input value={l.rev} onChange={(e) => patch(l.key, { rev: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} className="qi w-full text-center" /></td>
                  <td className="py-1.5"><input type="number" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} className="qi w-full text-right" /></td>
                  <td className="py-1.5"><input type="number" step="0.01" value={l.unitPrice} onChange={(e) => patch(l.key, { unitPrice: e.target.value })} className="qi w-full text-right font-semibold" /></td>
                  <td className="py-1.5 text-right font-bold">{sym}{money(num(l.qty) * num(l.unitPrice), currency)}</td>
                  <td className="py-1.5"><input value={l.alternative} onChange={(e) => patch(l.key, { alternative: e.target.value })} className="qi w-full text-center" placeholder="" /></td>
                  <td className="py-1.5"><input value={l.remarks} onChange={(e) => patch(l.key, { remarks: e.target.value })} className="qi w-full" /></td>
                  <td className="py-1.5 no-print"><button onClick={() => remove(l.key)} className="text-slate-300 hover:text-rose-500">✕</button></td>
                </tr>
              )
            })}
            {!lines.length && (
              <tr><td colSpan={11} className="py-8 text-center text-slate-400">품번을 추가하거나 원가분석에서 어셈블리를 가져오세요.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 font-bold">
              <td colSpan={7} className="py-2 text-right pr-3">TOTAL</td>
              <td className="py-2 text-right text-sm">{sym}{money(totals.amount, currency)}</td>
              <td colSpan={3}></td>
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

      <style>{`.qi{border:0;border-bottom:1px solid #e2e8f0;padding:2px 4px;font-size:12px;outline:none;background:transparent}
        .qi:focus{border-bottom-color:#6366f1}
        @media print{.qi{border:0}}`}</style>
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
  const ac = { emerald: 'text-emerald-600', rose: 'text-rose-600', amber: 'text-amber-600' }[accent] || 'text-slate-800'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-2.5">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className={`text-base font-bold ${ac}`}>{value}</div>
    </div>
  )
}
