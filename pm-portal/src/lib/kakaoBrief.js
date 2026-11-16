// 카톡 아침 알림 (v4.205.0) — 평일 08:50 「오늘 챙길 일」을 카카오톡 「나와의 채팅」으로
//   보내는 일은 서버 함수 kakao-brief 와 예약(pg_cron)이 한다. 화면은 연결 · 켜고 끄기 · 시험 보내기만.
//   SQL: 카톡아침알림_반영_261116.sql · 서버 함수: supabase/functions/kakao-brief
import { supabase } from './supabase'

export const KAKAO_SQL = '카톡아침알림_반영_261116.sql'
export const KAKAO_CB = '/kakao/callback'
export const kakaoRedirect = () => `${window.location.origin}${KAKAO_CB}`
const noFn = (e) => ['42883', 'PGRST202'].includes(e?.code) || /Could not find the function|does not exist/i.test(e?.message || '')

async function call(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke('kakao-brief', { body: { action, ...extra } })
  if (error) {
    // 서버 함수가 돌려준 글을 꺼낸다 (400 등)
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* 그대로 */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = '서버 함수 kakao-brief 가 아직 없습니다 — 안내대로 먼저 올려 주세요'
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// 내 연결 상태 — SQL 전이면 { noSql: true }
export async function kakaoStatus() {
  const { data, error } = await supabase.rpc('pm_kakao_my_status')
  if (error) { if (noFn(error)) return { noSql: true }; throw error }
  return data || { linked: false }
}
export async function kakaoPreview() {
  const { data, error } = await supabase.rpc('pm_morning_brief_me')
  if (error) return null
  return data
}
export async function kakaoSetEnabled(on) { const { error } = await supabase.rpc('pm_kakao_set_enabled', { p_on: !!on }); if (error) throw error }
export async function kakaoUnlink() { const { error } = await supabase.rpc('pm_kakao_unlink'); if (error) throw error }
export const kakaoTest = () => call('test')
export const kakaoConnect = (code) => call('connect', { code, redirect_uri: kakaoRedirect() })

// 카카오 로그인 창으로 — 돌아오면 /kakao/callback 이 code 를 서버 함수에 넘긴다
export async function kakaoStartLink() {
  const { rest_key } = await call('config')
  if (!rest_key) throw new Error('서버 함수에 KAKAO_REST_KEY 가 없습니다')
  const q = new URLSearchParams({ client_id: rest_key, redirect_uri: kakaoRedirect(), response_type: 'code', scope: 'talk_message', state: 'pm' })
  window.location.href = `https://kauth.kakao.com/oauth/authorize?${q}`
}
