// 개당 무게 (v4.80.0) — 계수저울로 벌크 품목 세기
//
//   items.unit_weight = 개당 무게(g). 한 번 재 두면 다음 실사부터는 전체 무게만 올리면 된다.
//   저울(CAS 5CS)은 1g 눈금 → 읽은 무게에 ±0.5g 오차가 있다.
//     · 개당 무게를 잴 때: 샘플을 넉넉히(20g 이상) 올려야 개당 무게가 정확하다
//     · 전체를 셀 때: ±0.5g ÷ 개당 무게 만큼 개수가 흔들린다 (0.3g 핀이면 ±2개)
//   칸이 없으면(DB 설정 전) 읽기는 빈 값 · 저장은 안내 오류.
import { supabase } from './supabase'

export const MIN_SAMPLE_G = 20   // 샘플 무게가 이보다 가벼우면 더 올리라고 안내

const missing = (e) => e && (e.code === '42703' || e.code === 'PGRST204' || /unit_weight/.test(e.message || ''))

// 품목들의 개당 무게 — Map(item_id → g). ok:false = 칸 없음 (DB 설정 전)
export async function fetchUnitWeights(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  const map = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('items').select('id,unit_weight').in('id', ids.slice(i, i + 200))
    if (error) { if (missing(error)) return { ok: false, map }; throw error }
    ;(data || []).forEach((r) => { const g = Number(r.unit_weight); if (g > 0) map.set(r.id, g) })
  }
  return { ok: true, map }
}

// 개당 무게 저장 (g) — null 이면 지움
export async function saveUnitWeight(itemId, g) {
  const v = g == null || g === '' ? null : roundW(Number(g))
  if (v != null && !(v > 0)) throw new Error('개당 무게는 0보다 큰 숫자여야 합니다')
  const { error } = await supabase.from('items').update({ unit_weight: v }).eq('id', itemId)
  if (error) throw new Error(missing(error) ? '개당 무게 DB 설정(개당무게_261020.sql)을 먼저 실행해야 합니다' : error.message)
  return v
}

// 소수 넷째 자리까지 (0.0001g)
export const roundW = (g) => Math.round(Number(g) * 10000) / 10000

// 샘플 n개 · w g → 개당 무게. 못 구하면 null
export function unitFromSample(n, w) {
  const cnt = Number(n), g = Number(w)
  if (!(cnt > 0) || !(g > 0)) return null
  return roundW(g / cnt)
}

// 전체 무게 − 용기 무게 → 개수 (반올림). 못 구하면 null
export function qtyFromWeight(total, tare, unit) {
  const t = Number(total), c = Number(tare) || 0, u = Number(unit)
  if (!(t > 0) || !(u > 0) || t - c < 0) return null
  return Math.round((t - c) / u)
}

// 1g 눈금 오차로 흔들리는 개수 (±) — 읽기 ±0.5g, 샘플을 쟀으면 그 오차도 더한다
export function countBand(unit, qty = 0, sampleG = null) {
  const u = Number(unit)
  if (!(u > 0)) return 0
  let band = 0.5 / u
  if (sampleG > 0 && qty > 0) band += qty * (0.5 / sampleG)
  return Math.ceil(band)
}

// 화면 글 — 0.35 → '0.35', 12 → '12'
export const fmtW = (g) => (g == null ? '' : String(roundW(g)))
