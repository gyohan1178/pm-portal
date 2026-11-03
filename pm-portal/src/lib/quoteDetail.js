// 세부견적서 (v4.138.0) — 어셈블리 견적 단가를 하위 부품별 판매가로 풀어 쓴다
//   부품 단가 = 품목 매입가(실적가) ÷ (1 − 구간 마진)   ← 견적 단가 계산(QuoteSheet linePrice)과 같은 규칙
//   조립 · 배선 · 검사비 = 작업비 ÷ (1 − 작업비 마진)
//   줄에 마진율을 직접 넣었으면 부품 · 작업비 모두 그 마진율
//   ⚠ 세부 합계는 항상 견적서 단가와 같게 맞춘다
//     · 견적 단가를 손으로 고쳤거나(네고) 끝자리를 잘랐으면 → 부품 · 작업비를 같은 비율로 맞춘 뒤
//     · 부품 단가는 고른 단위로 절삭(1 · 10 · 100 · 1000원 / 0.01 · 0.1 · 1달러)
//     · 절삭으로 남은 끝자리는 조립비 줄(작업비가 없으면 「단수 조정」 줄)에 넣는다 — 절삭이라 음수가 안 나온다
//   빠지는 줄: 체크 해제 · 단가 제외(문서 · 소요량 0) · 구매 조립품의 하위 · 매입가 없음(→ missing 으로 센다)
import { tierMargin } from './costAnalysis'

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export const CUT_OPTS = { KRW: [1, 10, 100, 1000], USD: [0.01, 0.1, 1] }
export const cutLabel = (c, cur) => (cur === 'KRW' ? `${c.toLocaleString('ko-KR')}원 미만 절삭` : `$${c} 미만 절삭`)
export const defaultCut = (cur) => (cur === 'KRW' ? 10 : 0.01)

// 부동소수 오차를 피해 절삭 — 0.1+0.2 같은 끝자리 때문에 한 단위 덜 잘리는 일 막기
export function cutDown(v, unit) {
  const u = n(unit) > 0 ? n(unit) : 1
  if (u < 1) { const k = Math.round(1 / u); return Math.floor(n(v) * k + 1e-7) / k }   // 0.01 → 100 배로 바꿔 계산
  return Math.floor(n(v) / u + 1e-7) * u
}
const cents = (v, cur) => (cur === 'KRW' ? Math.round(n(v)) : Math.round(n(v) * 100) / 100)

// 세부에 넣을 부품인가
export const detailPart = (p) => p && !p.excluded && p.status !== 'skip' && !p.supplySkip && p.buyKrw != null && n(p.buyKrw) > 0 && n(p.qty) > 0
// 단가가 없어 빠지는 부품 (경고용)
export const missingPart = (p) => p && !p.excluded && p.status !== 'skip' && !p.supplySkip && !p.isParentNode && (p.buyKrw == null || p.status === 'unreg' || n(p.buyKrw) <= 0)

/**
 * 한 줄의 세부견적
 * line : QuoteSheet 줄 (kind · parts · laborKrw · marginPct · unitPrice)
 * opt  : { currency, sellRate, mcfg:{tiers, laborMarg}, cut }
 * 반환 : null(풀 수 없음) | { rows:[{no,std_code,name,maker,makerPn,qty,unit,price,amount}], partsSum, labor, laborKind:'labor'|'adjust'|null, total, missing }
 */
export function buildDetail(line, opt = {}) {
  const cur = opt.currency === 'KRW' ? 'KRW' : 'USD'
  if (!line || line.kind !== 'assy' || !Array.isArray(line.parts)) return null
  const target = n(line.unitPrice)
  if (target <= 0) return null
  const parts = line.parts.filter(detailPart)
  if (!parts.length) return null
  const rate = cur === 'KRW' ? 1 : (n(opt.sellRate) || 1)
  const fixed = line.marginPct != null ? n(line.marginPct) : null
  const tiers = opt.mcfg?.tiers
  const laborMarg = fixed != null ? fixed : n(opt.mcfg?.laborMarg)
  const rawUnit = parts.map((p) => n(p.buyKrw) / (1 - (fixed != null ? fixed : tierMargin(p.buyKrw, tiers))) / rate)
  const rawLabor = n(line.laborKrw) > 0 ? n(line.laborKrw) / (1 - laborMarg) / rate : 0
  const rawTotal = rawUnit.reduce((a, u, i) => a + u * n(parts[i].qty), 0) + rawLabor
  if (rawTotal <= 0) return null
  const f = target / rawTotal
  const cut = n(opt.cut) > 0 ? n(opt.cut) : defaultCut(cur)
  const rows = parts.map((p, i) => {
    const price = cutDown(rawUnit[i] * f, cut)
    // 소수 수량(전개 0.5 등)은 금액을 통화 끝자리에서 절삭
    const amount = cutDown(price * n(p.qty), cur === 'KRW' ? 1 : 0.01)
    return { no: i + 1, std_code: p.std_code || '', name: p.name || '', maker: p.manufacturer || '', makerPn: p.manufacturer_code || '', qty: n(p.qty), unit: p.unit || 'EA', price, amount }
  })
  const partsSum = cents(rows.reduce((a, r) => a + r.amount, 0), cur)
  const labor = cents(target - partsSum, cur)
  const laborKind = labor <= 0 ? null : rawLabor > 0 ? 'labor' : 'adjust'
  return { rows, partsSum, labor: Math.max(0, labor), laborKind, total: cents(partsSum + Math.max(0, labor), cur), missing: line.parts.filter(missingPart).length }
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
