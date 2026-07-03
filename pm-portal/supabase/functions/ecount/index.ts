// ─────────────────────────────────────────────────────────────
// 이카운트 OAPI 프록시 — Supabase Edge Function (Deno)
// Zone → Login → SESSION_ID 처리 + 차단정책 가드(실패 누적 즉시중단·세션 캐싱)
//
// 시크릿(Supabase Dashboard > Edge Functions > Secrets 에 등록, 코드/프론트에 절대 X):
//   ECOUNT_COM_CODE   회사코드
//   ECOUNT_USER_ID    API 인증키 발급받은 이카운트 ID
//   ECOUNT_CERT_KEY   테스트/실서버 인증키 (API_CERT_KEY)
//   ECOUNT_ENV        'test' | 'prod'  (기본 test → sboapi)
// ─────────────────────────────────────────────────────────────

const COM_CODE = Deno.env.get('ECOUNT_COM_CODE') ?? ''
const USER_ID  = Deno.env.get('ECOUNT_USER_ID') ?? ''
const CERT_KEY = Deno.env.get('ECOUNT_CERT_KEY') ?? ''
const ENV      = (Deno.env.get('ECOUNT_ENV') ?? 'test').toLowerCase()
const IS_TEST  = ENV !== 'prod'
const ZONE_BASE = IS_TEST ? 'https://sboapi.ecount.com' : 'https://oapi.ecount.com'
const apiBase = (zone: string) =>
  IS_TEST ? `https://sboapi${zone}.ecount.com` : `https://oapi${zone}.ecount.com`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── 차단정책 가드 (모듈 메모리: 워밍된 인스턴스 동안 유지) ──
const MAX_AUTH_FAILS = 5          // 연속 실패 한도 (명세 기준 10 미만으로 보수적)
const COOLDOWN_MS = 10 * 60_000   // 한도 도달 시 자동 중단 시간
let authFails = 0
let blockedUntil = 0

// ── SESSION 캐시 (매 호출 로그인 금지) ──
let session: { id: string; zone: string; at: number } | null = null
const SESSION_TTL = 25 * 60_000   // 25분 (만료 전 재사용)

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 412 || res.status === 302) {
    throw { kind: 'rate', msg: '전송 횟수 초과(412/302). 잠시 후 재시도.' }
  }
  let json: any = null
  try { json = await res.json() } catch { /* noop */ }
  return { httpStatus: res.status, json }
}

async function getZone() {
  if (!COM_CODE) throw { kind: 'config', msg: 'ECOUNT_COM_CODE 시크릿 미설정' }
  const { json } = await postJson(`${ZONE_BASE}/OAPI/V2/Zone`, { COM_CODE })
  const zone = json?.Data?.ZONE
  if (!zone) throw { kind: 'zone', msg: json?.Error?.Message || 'Zone 조회 실패' }
  return zone as string
}

async function login(): Promise<{ id: string; zone: string }> {
  // 1) 사전 검증 — 빈 인증정보로 호출해서 실패 누적시키지 않음
  if (!COM_CODE || !USER_ID || !CERT_KEY) {
    throw { kind: 'config', msg: '이카운트 시크릿(COM_CODE/USER_ID/CERT_KEY) 미설정' }
  }
  const zone = await getZone()
  const { json } = await postJson(`${apiBase(zone)}/OAPI/V2/OAPILogin`, {
    COM_CODE, USER_ID, API_CERT_KEY: CERT_KEY, LAN_TYPE: 'ko-KR', ZONE: zone,
  })
  const sid = json?.Data?.Datas?.SESSION_ID
  if (!sid) {
    const code = json?.Error?.Code
    const msg = json?.Error?.Message || '로그인 실패'
    // 205=IP 미허용, 201=키 무효, 204=키 환경 불일치 → 재시도 의미 없음, 즉시 보고
    throw { kind: 'login', code, msg }
  }
  return { id: sid as string, zone }
}

async function ensureSession() {
  const now = Date.now()
  if (now < blockedUntil) {
    throw { kind: 'blocked', msg: `로그인 실패 누적으로 자동 중단 중. ${new Date(blockedUntil).toLocaleTimeString()} 이후 재시도.` }
  }
  if (session && now - session.at < SESSION_TTL) return session
  try {
    const s = await login()
    session = { ...s, at: now }
    authFails = 0
    return session
  } catch (e: any) {
    // rate/config 는 카운트 제외, 인증 실패만 누적
    if (e.kind === 'login' || e.kind === 'zone') {
      authFails++
      if (authFails >= MAX_AUTH_FAILS) {
        blockedUntil = now + COOLDOWN_MS
        console.error('[ecount] 로그인 실패 누적 → 자동 중단', { authFails, until: blockedUntil })
      }
    }
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // ── 사용자 화이트리스트 가드 ──
  // 시크릿 ECOUNT_ALLOWED_USERS = 허용 이메일 콤마구분 (예: a@x.com,b@x.com)
  // 미설정 시 모든 호출 차단(안전 기본값). Supabase가 JWT 검증 후 호출하므로 페이로드 클레임 신뢰 가능.
  try {
    const allowed = (Deno.env.get('ECOUNT_ALLOWED_USERS') ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const auth = req.headers.get('authorization') ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    let email = ''
    try { email = (JSON.parse(atob(token.split('.')[1] || '')).email || '').toLowerCase() } catch { /* noop */ }
    if (allowed.length === 0 || !email || !allowed.includes(email)) {
      return json({ ok: false, error: '이카운트 연동 권한이 없는 사용자입니다.', kind: 'forbidden' }, 403)
    }
  } catch {
    return json({ ok: false, error: '권한 확인 실패', kind: 'forbidden' }, 403)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action ?? 'ping'

    // 연결 점검용 — 세션만 확보(실제 API 호출 X)
    if (action === 'ping') {
      const s = await ensureSession()
      return json({ ok: true, zone: s.zone, env: IS_TEST ? 'test' : 'prod', sessionCached: true })
    }

    // 범용 호출: { action:'call', path:'/OAPI/V2/...', payload:{...} }
    if (action === 'call') {
      const s = await ensureSession()
      const path = String(body.path || '')
      if (!path.startsWith('/OAPI/')) return json({ ok: false, error: 'path는 /OAPI/ 로 시작해야 함' }, 400)
      const url = `${apiBase(s.zone)}${path}?SESSION_ID=${encodeURIComponent(s.id)}`
      const { httpStatus, json: data } = await postJson(url, body.payload ?? {})
      // 세션 만료(인증 오류)면 1회 재로그인 후 재시도
      if (data?.Status === '401' || data?.Error?.Code === '301') {
        session = null
        const s2 = await ensureSession()
        const retry = await postJson(`${apiBase(s2.zone)}${path}?SESSION_ID=${encodeURIComponent(s2.id)}`, body.payload ?? {})
        return json({ ok: true, data: retry.json })
      }
      return json({ ok: httpStatus === 200, data })
    }

    return json({ ok: false, error: 'unknown action' }, 400)
  } catch (e: any) {
    const status = e.kind === 'blocked' ? 429 : (e.kind === 'config' ? 500 : 502)
    console.error('[ecount] error', e)
    return json({ ok: false, error: e.msg || String(e), code: e.code ?? null, kind: e.kind ?? null }, status)
  }
})
