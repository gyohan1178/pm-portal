// 이카운트 OAPI 호출 헬퍼 — Edge Function('ecount') 경유
// 인증키/회사코드는 서버(Edge Function 시크릿)에만 있고, 프론트는 이 함수만 호출한다.
import { supabase } from './supabase'

async function callEcount(payload) {
  const { data, error } = await supabase.functions.invoke('ecount', { body: payload })
  if (error) throw new Error(error.message || 'ecount function 호출 실패')
  if (!data?.ok) throw new Error(data?.error || '이카운트 API 오류')
  return data
}

// 연결 점검 (Zone→Login 세션만 확보)
export function ecountPing() {
  return callEcount({ action: 'ping' })
}

// 범용 호출: path는 '/OAPI/V2/...', payload는 해당 API 파라미터
export function ecountCall(path, payload = {}) {
  return callEcount({ action: 'call', path, payload })
}
