// 세부견적서 (v4.138.0 · v4.139.0 절삭을 합계에서) — 어셈블리 견적 단가를 하위 부품별 판매가로 풀어 쓴다
//   부품 단가 = 품목 매입가(실적가) ÷ (1 − 구간 마진)   ← 견적 단가 계산(QuoteSheet linePrice)과 같은 규칙
//   조립 · 배선 · 검사비 = 작업비 ÷ (1 − 작업비 마진)  (작업비가 있을 때만 따로 한 줄)
//   줄에 마진율을 직접 넣었으면 부품 · 작업비 모두 그 마진율
//   부품 단가는 원 단위(달러는 센트)로 반올림만 하고, 끝자리 절삭은 「합계」에서 한 번 — 「단수 절삭 −87」 줄로 보인다
//   ⚠ 합계는 항상 견적서 단가와 같다
//     · 계산 그대로의 단가면(견적 단가 = 계산값을 100원 미만 절삭한 값) → 부품 · 조립비를 계산 그대로 두고 그 차이가 절삭 줄
//     · 단가를 손으로 고쳤으면(네고) → 부품 · 조립비를 같은 비율로 맞춤 (절삭 줄은 반올림 몇 원만 남거나 없음)
//   판매 실적가 (v4.162.0): 같은 고객사에 전에 낸 부품 판매가가 있으면 그 값 그대로 (네고로 맞출 때도 고정) — 나머지 부품 · 조립비가 맞춤
//   빠지는 줄: 체크 해제 · 단가 제외(문서 · 소요량 0) · 구매 조립품의 하위
//   매입가가 없는 부품(사급 · 사양 미확정 …)도 줄로 넣는다 — 단가 · 금액은 비우고 「특이사항」에 사유 (v4.182.0 · missing 으로도 센다)
//   특이사항 = 견적 접수에서 남긴 견적 불가 사유(pt.nq) + 구매자재 견적 특이사항(pt.qnote)
import { tierMargin } from './costAnalysis'
import { roundPrice } from './marginSim'
import { prevOf, partKey, prevEligible } from './salePrice'

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
// 통화 끝자리 반올림 — 원 · 센트
export const cents = (v, cur) => (cur === 'KRW' ? Math.round(n(v)) : Math.round(n(v) * 100 + 1e-9) / 100)

// 세부에 넣을 부품인가
export const detailPart = (p) => p && !p.excluded && p.status !== 'skip' && !p.supplySkip && p.buyKrw != null && n(p.buyKrw) > 0 && n(p.qty) > 0
// 부품 줄 특이사항 — 고객사와 공유하는 글
export const partNote = (p) => [p?.nq ? [p.nq.reason, p.nq.memo].filter(Boolean).join(' — ') : '', String(p?.qnote || '').trim()].filter(Boolean).join(' / ')
// 단가가 없어 빠지는 부품 (경고용)
export const missingPart = (p) => p && !p.excluded && p.status !== 'skip' && !p.supplySkip && !p.isParentNode && (p.buyKrw == null || p.status === 'unreg' || n(p.buyKrw) <= 0)

/**
 * 한 줄의 세부견적
 * line : QuoteSheet 줄 (kind · parts · laborKrw · marginPct · unitPrice)
 * opt  : { currency, sellRate, mcfg:{tiers, laborMarg} }
 * 반환 : null(풀 수 없음) | { rows:[{no,std_code,name,maker,makerPn,qty,unit,price,amount}], partsSum, labor, subtotal, adjust, total, missing, scaled }
 *        adjust < 0 = 단수 절삭 · adjust > 0 = 단수 조정(드묾) · total = 견적 단가
 */
export function buildDetail(line, opt = {}) {
  const cur = opt.currency === 'KRW' ? 'KRW' : 'USD'
  if (!line || line.kind !== 'assy' || !Array.isArray(line.parts)) return null
  const target = n(line.unitPrice)
  if (target <= 0) return null
  const parts = line.parts.filter((p) => detailPart(p) || (prevEligible(p) && prevOf(p, cur) != null))   // 매입가가 없어도 실적가가 있으면 넣는다
  if (!parts.length) return null
  const rate = cur === 'KRW' ? 1 : (n(opt.sellRate) || 1)
  const fixed = line.marginPct != null ? n(line.marginPct) : null
  const tiers = opt.mcfg?.tiers
  const laborMarg = fixed != null ? fixed : n(opt.mcfg?.laborMarg)
  const prev = parts.map((p) => prevOf(p, cur))
  const rawUnit = parts.map((p, i) => (prev[i] != null ? prev[i] : n(p.buyKrw) / (1 - (fixed != null ? fixed : tierMargin(p.buyKrw, tiers))) / rate))
  const rawLabor = n(line.laborKrw) > 0 ? n(line.laborKrw) / (1 - laborMarg) / rate : 0
  const rawTotal = rawUnit.reduce((a, u, i) => a + u * n(parts[i].qty), 0) + rawLabor
  if (rawTotal <= 0) return null
  // 계산 그대로의 단가인가 — 그러면 비율을 건드리지 않는다 (절삭 줄이 실제 잘라낸 금액)
  //   실적가 부품은 고정 — 네고 차이는 나머지 부품 · 조립비가 나눠 맡는다 (나머지가 없으면 조정 줄)
  const scaled = roundPrice(rawTotal, cur) !== target
  const fixedSum = rawUnit.reduce((a, u, i) => a + (prev[i] != null ? u * n(parts[i].qty) : 0), 0)
  const flex = rawTotal - fixedSum
  const f = scaled ? (flex > 0 ? Math.max(0, (target - fixedSum) / flex) : 1) : 1
  const priced = parts.map((p, i) => {
    const price = prev[i] != null ? cents(prev[i], cur) : cents(rawUnit[i] * f, cur)
    return { std_code: p.std_code || p.manufacturer_code || '',   // 부품표로 만든 줄(코드 없음)은 제조사품번 (v4.148.0)
       name: p.name || '', maker: p.manufacturer || '', makerPn: p.manufacturer_code || '', qty: n(p.qty), unit: p.unit || 'EA', price, amount: cents(price * n(p.qty), cur),
       key: partKey(p), buyKrw: p.buyKrw ?? null, prev: prev[i] != null,
       note: partNote(p) }   // 특이사항 열 (v4.182.0)
  })
  // BOM 순서대로 — 단가 있는 부품 + 단가 없는 부품(빈칸 · 특이사항)
  const pIdx = new Map(parts.map((p, i) => [p, i]))
  const rows = []
  for (const p of line.parts) {
    if (pIdx.has(p)) rows.push(priced[pIdx.get(p)])
    else if (missingPart(p) && n(p.qty) > 0) rows.push({ std_code: p.std_code || p.manufacturer_code || '', name: p.name || '', maker: p.manufacturer || '', makerPn: p.manufacturer_code || '',
      qty: n(p.qty), unit: p.unit || 'EA', price: null, amount: null, key: partKey(p), buyKrw: null, prev: false, nopr: true, note: partNote(p) })
  }
  rows.forEach((r, i) => { r.no = i + 1 })
  const partsSum = cents(rows.reduce((a, r) => a + n(r.amount), 0), cur)
  let labor = rawLabor > 0 ? cents(rawLabor * f, cur) : 0   // 조립비도 계산 그대로 (부품 반올림 몇 원은 절삭 줄에 같이)
  // 네고로 맞춘 단가는 「잘라낸 금액」이 없다 — 반올림 몇 원은 조립비가 맡아 절삭 줄을 안 만든다
  if (scaled && labor > 0) labor = Math.max(0, cents(target - partsSum, cur))
  const subtotal = cents(partsSum + labor, cur)
  const adjust = cents(target - subtotal, cur)
  return { rows, partsSum, labor, subtotal, adjust, total: target, missing: line.parts.filter((p) => missingPart(p) && prevOf(p, cur) == null).length, scaled }
}

// 견적 전체 — 세부를 낼 수 있는 줄만 [{ idx, line, detail }]
export function buildDetails(lines, opt) {
  const out = []
  ;(lines || []).forEach((l, idx) => {
    const d = buildDetail(l, opt)
    if (d) out.push({ idx, line: l, detail: d })
  })
  return out
}

// 부품 정보가 없어 세부를 못 내는 ASSY 줄 (리비전으로 불러온 줄 등)
export const noPartsAssy = (lines) => (lines || []).filter((l) => l.kind === 'assy' && !(Array.isArray(l.parts) && l.parts.some(detailPart)))

export const DETAIL_REMARK = { ko: '세부견적 참조', en: 'See detail' }
export const adjustLabel = (adj, ko) => (adj < 0 ? (ko ? '단수 절삭' : 'Rounding discount') : (ko ? '단수 조정' : 'Rounding adjustment'))
