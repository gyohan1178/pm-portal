import { fetchItemMeta, splitMfrs, realPn } from './itemMeta'

// 고객사 승인 대체품 (v4.236.0) — 출고 화면 · 불출표 · 라벨에 「대체 …」 한 줄
//   승인 제조사 목록(pm_item_mfr · BOM 리포트에서 옴) 가운데 우리 대표 제조사품번이 아닌 것
//   사용 금지 · 제조사 단종은 빼고 쓸 수 있는 것만 (우선 → 승인 순)
//   목록이 없는 품목(리포트를 안 올린 고객사 등)은 null → 화면 · 라벨이 예전 그대로
export async function fetchMfrLists(itemIds) {
  try { return (await fetchItemMeta(itemIds)).mfr || {} } catch { return {} }
}
export function altOf(makerPn, list, max = 2) {
  if (!list?.length) return null
  const L = splitMfrs({ manufacturer_code: makerPn }, list).alts.filter((m) => realPn(m.mfr_pn))
  if (!L.length) return null
  const more = L.length > max ? ` +${L.length - max}` : ''
  return {
    // 라벨 · 화면 한 줄 — 첫 것만 제조사를 붙인다 (자리가 좁다)
    text: L.slice(0, max).map((m, i) => (i === 0 && m.mfr ? `${m.mfr_pn} (${m.mfr})` : m.mfr_pn)).join(' · ') + more,
    short: L.slice(0, max).map((m) => m.mfr_pn).join(' · ') + more,
    title: '고객사 승인 대체품\n' + L.map((m) => `${m.mfr_pn} — ${m.mfr || '-'}${m.status ? ` (${m.status})` : ''}`).join('\n'),
    n: L.length,
  }
}
