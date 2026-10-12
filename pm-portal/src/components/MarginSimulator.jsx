import { useState, useMemo, useEffect } from 'react'
import { simMargin, priceForMargin, marginGrid, marginTone, roundPrice } from '../lib/marginSim'

// 매출견적 마진 시뮬레이터 (2026-10-12)
//   제출 단가 · 판매 환율을 바꿔 가며 마진이 어떻게 바뀌는지 보고용 화면으로 보여 준다.
//   원가는 견적 작성 화면에서 계산된 값(자재비 + 작업비)을 그대로 쓴다.
//
//   props
//     title, subtitle   머리글 (품번 · 품명 / 견적 전체)
//     qty               수량 — 마진액 계산 (견적 전체면 1, 금액은 합계 기준)
//     unitCost          한 개 원가(원)
//     basePrice         지금 견적 단가 (견적 통화)
//     rulePrice         견적 규칙(마진 구간)대로 뽑은 단가 — 목표 마진 기본값
//     lastPrice         지난 제출가 (같은 통화일 때만), lastLabel
//     currency, baseRate
//     onApply(price)    이 단가로 견적에 반영
const TONE = {
  loss: { bg: 'bg-red-50', text: 'text-red-600', bar: 'bg-red-200' },
  low:  { bg: 'bg-amber-50', text: 'text-amber-700', bar: 'bg-amber-200' },
  ok:   { bg: 'bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-200' },
  none: { bg: 'bg-slate-50', text: 'text-slate-400', bar: 'bg-slate-200' },
}
const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const fmt = (v, cur) => (cur === 'KRW' ? '₩' + won(v)
  : '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const pctTxt = (p) => (p == null ? '-' : (p * 100).toFixed(1) + '%')
const manwon = (v) => (v < 0 ? '-' : '') + won(Math.abs(v) / 10000) + '만원'

export default function MarginSimulator({ title, subtitle, qty = 1, unitCost, basePrice, rulePrice, lastPrice, lastLabel,
  currency = 'USD', baseRate = 1350, onApply, onClose }) {
  const isKrw = currency === 'KRW'
  const cost = Number(unitCost) || 0
  // 목표 마진 기본값 = 견적 규칙(마진 구간)으로 뽑은 단가의 마진. 못 구하면 15%.
  const defTarget = useMemo(() => {
    const m = simMargin({ price: rulePrice, rate: baseRate, cost, currency }).pct
    return m != null && m > 0 && m < 0.9 ? Math.round(m * 1000) / 10 : 15
  }, [rulePrice, baseRate, cost, currency])

  const [price, setPrice] = useState(Number(basePrice) || 0)
  const [rate, setRate] = useState(Number(baseRate) || 0)
  const [target, setTarget] = useState(defTarget)
  useEffect(() => { setTarget(defTarget) }, [defTarget])

  const t = target / 100
  const cur = simMargin({ price, rate, cost, currency })
  const be = priceForMargin({ cost, rate, currency, pct: 0 })
  const tg = priceForMargin({ cost, rate, currency, pct: t })
  const tone = marginTone(cur.pct, t)
  const grid = marginGrid({ price, rate, cost, currency })

  // 막대 범위 — 손익분기보다 조금 아래부터 지금 단가보다 위까지
  const base = Number(basePrice) || 0
  const lo = Math.max(0, Math.min((be || base) * 0.9, base * 0.7))
  const hi = Math.max(base * 1.2, (tg || base) * 1.05, Number(lastPrice) || 0)
  const step = isKrw ? (hi >= 1e6 ? 1000 : hi >= 1e4 ? 10 : 1) : (hi >= 1000 ? 1 : hi >= 10 ? 0.1 : 0.01)
  const pos = (v) => (hi > lo ? Math.min(100, Math.max(0, ((Number(v) || 0) - lo) / (hi - lo) * 100)) : 0)

  function print() {
    document.body.classList.add('printing-msim')
    const done = () => { document.body.classList.remove('printing-msim'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    setTimeout(() => window.print(), 60)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <style>{`
        @media print {
          html, body { height:auto !important; overflow:visible !important; }
          body.printing-msim * { visibility: hidden !important; }
          body.printing-msim .msim-print, body.printing-msim .msim-print * { visibility: visible !important; }
          body.printing-msim .msim-print { position: absolute; left:0; top:0; width:100%; padding:10mm; }
          body.printing-msim .msim-noprint { display: none !important; }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>
      <div data-msim className="msim-print bg-white w-full max-w-4xl rounded-2xl my-6 p-5 space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-slate-900">📊 마진 시뮬레이션 — {title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {subtitle ? subtitle + ' · ' : ''}{qty > 1 ? `수량 ${qty} · ` : ''}원가 {won(cost)}원{qty > 1 ? ' / 개' : ''}
              {' · '}지금 견적 {fmt(base, currency)}{!isKrw && ` (판매환율 ${won(baseRate)})`}
            </p>
          </div>
          <button onClick={onClose} className="msim-noprint ml-auto text-slate-400 text-xl px-2">✕</button>
        </div>

        {/* 조절 */}
        <div className="space-y-2.5 rounded-xl border border-slate-200 p-3">
          <Slider label="제출 단가" min={lo} max={hi} step={step} value={price} onChange={setPrice}
            out={<input data-msim-price type="number" step={step} value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              className="w-28 px-2 py-1 text-sm text-right font-bold border border-slate-200 rounded" />} />
          {!isKrw && (
            <Slider label="판매 환율" min={Math.max(0, baseRate - 250)} max={baseRate + 250} step={10} value={rate} onChange={setRate}
              out={<input data-msim-rate type="number" step={10} value={rate}
                onChange={(e) => setRate(Number(e.target.value) || 0)}
                className="w-28 px-2 py-1 text-sm text-right font-bold border border-slate-200 rounded" />} />
          )}
          <Slider label="목표 마진" min={0} max={40} step={0.5} value={target} onChange={setTarget}
            out={<span className="w-28 text-right text-sm font-bold">{target}%</span>} />
          <p className="text-[11px] text-slate-400">목표 마진 처음 값 = 견적 「마진 구간」 규칙대로 뽑은 단가의 마진 ({defTarget}%)</p>
        </div>

        {/* 결과 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card label="마진율" value={pctTxt(cur.pct)} cls={TONE[tone].text} data="pct" />
          <Card label={qty > 1 ? `마진액 (${qty}개)` : '마진액'} value={manwon(cur.margin * qty)} cls={cur.margin < 0 ? 'text-red-600' : 'text-slate-900'} data="amt" />
          <Card label="손익분기 단가" value={be != null ? fmt(be, currency) : '-'} hint="이 밑은 적자" data="be" />
          <Card label={`목표 ${target}% 하한 단가`} value={tg != null ? fmt(tg, currency) : '-'} hint="네고 하한선" data="tg" />
        </div>

        {/* 위치 막대 */}
        <div>
          <div className="relative h-12 mt-2">
            <div className="absolute left-0 right-0 top-4 h-2 rounded bg-slate-100" />
            <div className={`absolute top-4 h-2 ${TONE.loss.bar}`} style={{ left: 0, width: pos(be) + '%' }} />
            <div className={`absolute top-4 h-2 ${TONE.low.bar}`} style={{ left: pos(be) + '%', width: Math.max(0, pos(tg) - pos(be)) + '%' }} />
            <div className={`absolute top-4 h-2 ${TONE.ok.bar}`} style={{ left: pos(tg) + '%', width: Math.max(0, 100 - pos(tg)) + '%' }} />
            <Marker at={pos(base)} cls="bg-slate-400" label={`견적 ${fmt(base, currency)}`} top />
            {lastPrice != null && <Marker at={pos(lastPrice)} cls="bg-indigo-500" label={`지난 ${fmt(lastPrice, currency)}`} />}
            <Marker at={pos(price)} cls="bg-slate-900" label="" />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            🟥 적자 · 🟨 목표 미달 · 🟩 목표 이상 · 검은 선 = 지금 보는 단가 · 회색 = 지금 견적
            {lastPrice != null && ` · 파랑 = 지난 제출가${lastLabel ? ` (${lastLabel})` : ''}`}
          </p>
        </div>

        {/* 단가 × 환율 */}
        <div>
          <table data-msim-grid className="w-full text-xs border-collapse table-fixed">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 py-1.5 text-slate-500">단가 \ {isKrw ? '' : '판매환율'}</th>
                {grid[0].cells.map(c => (
                  <th key={c.rate} className="border border-slate-200 bg-slate-50 py-1.5 text-slate-500">{isKrw ? '마진율' : won(c.rate)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map(row => (
                <tr key={row.step}>
                  <th className={`border border-slate-200 py-1.5 text-right pr-2 ${row.step === 0 ? 'bg-slate-100 text-slate-800' : 'bg-slate-50 text-slate-600'}`}>
                    {fmt(row.price, currency)} <span className="font-normal text-slate-400">{row.step === 0 ? '(지금)' : `${row.step > 0 ? '+' : ''}${Math.round(row.step * 100)}%`}</span>
                  </th>
                  {row.cells.map(c => {
                    const tn = TONE[marginTone(c.pct, t)]
                    return (
                      <td key={c.rate} data-msim-cell={`${row.price}|${c.rate}`}
                        onClick={() => { setPrice(row.price); setRate(c.rate) }}
                        className={`border border-slate-200 py-1.5 text-center font-bold cursor-pointer hover:ring-2 hover:ring-indigo-300 ${tn.bg} ${tn.text}`}>
                        {pctTxt(c.pct)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-400 mt-1">칸을 누르면 그 단가 · 환율로 맞춰집니다{!isKrw && ' · 환율은 가정값이고 견적의 판매환율은 바뀌지 않습니다'}</p>
        </div>

        <div className="msim-noprint flex gap-2 pt-1">
          {onApply && (
            <button data-msim-apply onClick={() => onApply(roundPrice(price, currency))}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white">
              이 단가({fmt(roundPrice(price, currency), currency)})로 견적에 반영
            </button>
          )}
          <button onClick={print} className="px-4 py-2 text-sm font-bold rounded-lg border border-slate-200 text-slate-600">🖨 보고용 인쇄</button>
          <button onClick={() => { setPrice(base); setRate(baseRate); setTarget(defTarget) }}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">처음 값으로</button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">닫기</button>
        </div>
      </div>
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange, out }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-xs font-bold text-slate-500 flex-shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-indigo-600" />
      {out}
    </div>
  )
}
function Card({ label, value, hint, cls = 'text-slate-900', data }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p data-msim-card={data} className={`text-xl font-bold mt-0.5 ${cls}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  )
}
function Marker({ at, cls, label, top }) {
  return (
    <>
      <div className={`absolute w-0.5 h-6 ${cls}`} style={{ left: `calc(${at}% - 1px)`, top: 6 }} />
      {label && (
        <span className="absolute text-[10px] text-slate-500 whitespace-nowrap"
          style={{ left: `calc(${at}% - 24px)`, top: top ? -8 : 30 }}>{label}</span>
      )}
    </>
  )
}
