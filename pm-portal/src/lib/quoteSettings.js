// 매출견적 공용 설정 (pm_settings 'quote_margin') — 마진 구간 · 작업비 마진 · 기준 환율 (v4.86.0)
//   모든 PC 공통. 매출견적 화면(환율 칸)과 견적서(⚙ 마진구간)가 같은 캐시(['quoteMarginCfg'])를 쓴다.
//   buyRate · sellRate 가 없으면(예전 설정) null — 화면이 기본값(DEFAULT_CFG)을 쓴다.
import { supabase } from './supabase'
import { DEFAULT_TIERS, DEFAULT_CFG } from './costAnalysis'

const rate = (v) => (Number(v) > 0 ? Number(v) : null)

export async function fetchQuoteMarginCfg() {
  const { data } = await supabase.from('pm_settings').select('value').eq('key', 'quote_margin').maybeSingle()
  const v = data?.value || {}
  return {
    tiers: Array.isArray(v.tiers) && v.tiers.length ? v.tiers : DEFAULT_TIERS,
    laborMarg: Number.isFinite(Number(v.laborMarg)) ? Number(v.laborMarg) : DEFAULT_CFG.laborMarg,
    buyRate: rate(v.buyRate),
    sellRate: rate(v.sellRate),
  }
}

export const QUOTE_CFG_KEY = ['quoteMarginCfg']
