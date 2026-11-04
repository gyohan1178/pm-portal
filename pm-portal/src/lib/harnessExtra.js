// 하네스 출도 대상 품번 (v4.146.0) — 16번대가 아니어도 하네스 출도 · 불출 목록에 넣을 품번
//   예: 120220971 ~ 120220974 (12번대 = 고객사 PO 구분 「구매품」이지만 하네스팀이 만들어 출도하는 것)
//   하네스 공정관리에 이미 등록된 줄은 원래도 보였다 — 이 목록은 「등록 전(출력 전)」에도 보이게 하려는 것
//   저장: pm_settings 'harness_release_extra' = { codes: ['120220971', …] } (AX- 없이) — 모든 PC 공통
import { supabase } from './supabase'

export const EXTRA_KEY = 'harness_release_extra'
export const DEFAULT_EXTRA = ['120220971', '120220972', '120220973', '120220974']   // 2026-11-04 요청

const clean = (v) => String(v ?? '').trim().replace(/^AX-/i, '').replace(/\.0$/, '').toUpperCase()

// 「120220971~4」 · 「120220971~120220974」 · 「120220971-120220974」 범위도 받는다 (숫자 품번만 · 한 번에 200개까지)
export function parseExtraCodes(text) {
  const out = []
  for (const tok of String(text || '').split(/[\s,;\n\t]+/).filter(Boolean)) {
    const m = tok.match(/^(?:AX-)?(\d+)\s*[~～]\s*(?:AX-)?(\d+)$/i) || tok.match(/^(?:AX-)?(\d{6,})-(\d{6,})$/i)
    if (m) {
      const a = m[1], bRaw = m[2]
      const b = bRaw.length < a.length ? a.slice(0, a.length - bRaw.length) + bRaw : bRaw
      const x = Number(a), y = Number(b)
      if (Number.isSafeInteger(x) && Number.isSafeInteger(y) && y >= x && y - x < 200) {
        for (let k = x; k <= y; k++) out.push(String(k).padStart(a.length, '0'))
        continue
      }
    }
    const c = clean(tok)
    if (c) out.push(c)
  }
  return [...new Set(out)]
}
// 보기 좋게 — 이어지는 번호는 「120220971~4」로 묶는다
export function formatExtraCodes(codes) {
  const nums = [...new Set(codes || [])].sort()
  const out = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (j + 1 < nums.length && /^\d+$/.test(nums[j + 1]) && /^\d+$/.test(nums[j]) && nums[j + 1].length === nums[j].length && Number(nums[j + 1]) === Number(nums[j]) + 1) j++
    if (j > i) {
      const a = nums[i], b = nums[j]
      let k = 0; while (k < a.length && a[k] === b[k]) k++
      out.push(`${a}~${b.slice(k) || b}`); i = j
    } else out.push(nums[i])
  }
  return out
}

export async function fetchExtraCodes() {
  const { data, error } = await supabase.from('pm_settings').select('value').eq('key', EXTRA_KEY).maybeSingle()
  if (error) throw error
  const c = data?.value?.codes
  return Array.isArray(c) ? c : DEFAULT_EXTRA
}
export async function saveExtraCodes(codes) {
  const v = [...new Set((codes || []).map(clean).filter(Boolean))].sort()
  const { error } = await supabase.from('pm_settings').upsert({ key: EXTRA_KEY, value: { codes: v }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
  return v
}
