// 카톡 아침 알림 — 서버 함수 (v4.206.2 한 통으로: 머리 날짜 · 표 · 아래 할 일 · 일정)
//   action
//     config  : 화면이 카카오 로그인 창을 열 때 쓰는 REST API 키 (공개되는 값) · 로그인 필요
//     connect : 카카오가 돌려준 code → 토큰으로 바꿔 pm_kakao_link 에 저장 + 확인 메시지 1통 · 로그인 필요
//     test    : 지금 내 카톡으로 한 번 보내기 · 로그인 필요
//     cron    : 평일 08:50 예약(pg_cron)이 부름 — x-cron-key 가 pm_kakao_conf 의 값과 같아야 함 · 공휴일은 건너뜀
//   시크릿 (Supabase → Edge Functions → Secrets): KAKAO_REST_KEY (필수) · KAKAO_CLIENT_SECRET (콘솔에서 켰을 때만)
//   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 준다
//   ⚠ 함수 설정에서 「Verify JWT」(Enforce JWT verification) 를 끈다 — 예약 호출에는 로그인 토큰이 없어서. 대신 아래에서 직접 확인한다
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const URL_ = Deno.env.get('SUPABASE_URL')!
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REST = Deno.env.get('KAKAO_REST_KEY') || ''
const SECRET = Deno.env.get('KAKAO_CLIENT_SECRET') || ''
const PORTAL = 'https://pm-portal-29q.pages.dev'
const db = createClient(URL_, SRK, { auth: { persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// 한국 공휴일 (포털 src/lib/bizdays.js 와 같은 목록 — 해마다 같이 갱신)
const HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-24', '2026-05-25',
  '2026-06-06', '2026-07-17', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-01', '2027-05-03', '2027-05-05', '2027-05-13',
  '2027-06-06', '2027-07-17', '2027-07-19', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04',
  '2027-10-09', '2027-10-11', '2027-12-25', '2027-12-27',
])
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

async function userOf(req: Request) {
  const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!tok) return null
  const { data, error } = await db.auth.getUser(tok)
  return error ? null : data.user
}

async function tokenCall(params: Record<string, string>) {
  const body = new URLSearchParams({ client_id: REST, ...params, ...(SECRET ? { client_secret: SECRET } : {}) })
  const r = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`카카오 토큰 실패: ${j.error_description || j.error || r.status}`)
  return j as { access_token: string, refresh_token?: string, refresh_token_expires_in?: number, scope?: string }
}

const LINK = { web_url: `${PORTAL}/todo`, mobile_web_url: `${PORTAL}/todo` }
async function sendMemo(access: string, text: string) {
  return sendTpl(access, { object_type: 'text', text, link: LINK, button_title: '포털 열기' })
}
async function sendTpl(access: string, tpl: unknown) {
  const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(tpl) }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.result_code !== 0) throw new Error(`카톡 보내기 실패: ${j.msg || j.result_code || r.status}${j.code === -402 ? ' (카카오 동의 항목 「카카오톡 메시지 전송」 동의 필요)' : ''}`)
}

// 표(피드) 모양 — 왼쪽 항목 · 오른쪽 고객사별 숫자 (0 인 고객사는 뺌) · 아래 「내 할 일」 합계
type Cs = { cs: string, late: number, today: number, week: number, unc: number | null }
const md = (d: string) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : '')
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
function feedOf(j: Record<string, any>, withImage: boolean) {
  const cs: Cs[] = j.cs || []
  const row = (k: keyof Cs) => cs.filter((c) => Number(c[k]) > 0).map((c) => `${c.cs} ${c[k]}`).join(' · ') || '없음'
  const items = [
    { item: '입고 지남', item_op: row('late') },
    { item: '오늘 입고', item_op: row('today') },
    { item: '주간 입고', item_op: row('week') },
    { item: '수주 미확인', item_op: row('unc') },
    { item: '요청', item_op: `자재 ${j.req ?? '-'} · 견적 ${j.rfq ?? '-'}` },
  ]
  const todo = Number(j.todo) || 0
  // 아래 칸 = 오늘 ~ 2영업일 뒤 할 일 · 일정 (카톡이 두 줄까지 보여 줘서 두 줄 · 넘치면 「외 N건」)
  const sc = (j.sched || []) as { d: string, k: string, t: string }[]
  const one = (x: { d: string, k: string, t: string }) => `${x.d < j.today ? '지남' : x.d === j.today ? '오늘' : md(x.d)} ${x.k === 'note' ? '[일정] ' : ''}${cut(x.t, 16)}`
  const lines = sc.slice(0, 2).map(one)
  if (sc.length > 2) lines[1] = `${lines[1]} 외 ${sc.length - 2}건`
  return {
    object_type: 'feed',
    content: { title: sc.length ? `할 일 · 일정 (~${md(j.end)})` : `~${md(j.end)} 할 일 · 일정 없음`, description: lines.join('\n'), link: LINK,
      ...(withImage ? { image_url: `${PORTAL}/kakao-brief.png`, image_width: 800, image_height: 400 } : {}) },
    item_content: { profile_text: `${j.date}(${j.dow}) 오늘 챙길 일`, items, sum: '오늘 할 일', sum_op: todo ? `${todo}건${j.todo_over ? ` (지남 ${j.todo_over})` : ''}` : '없음' },
    buttons: [{ title: '포털 열기', link: LINK }],
  }
}

// 표로 보내 보고, 카카오가 받지 않으면 그림 넣은 표 → 그래도 안 되면 글로
async function sendBrief(access: string, userId: string, text: string) {
  const { data: j } = await db.rpc('pm_morning_brief_data', { p_user: userId })
  if (j && typeof j === 'object') {
    for (const img of [false, true]) {
      try {
        await sendTpl(access, feedOf(j, img))   // 한 통으로 끝 (할 일 · 일정은 표 아래 칸)
        return 'feed'
      } catch { /* 다음 방법 */ }
    }
  }
  await sendMemo(access, cut(text, 198))
  return 'text'
}

// 한 사람에게 보내기 — 갱신 토큰으로 접근 토큰을 받고(새 갱신 토큰이 오면 저장) 글을 만들어 보낸다
async function sendTo(userId: string, refresh: string) {
  const now = new Date().toISOString()
  try {
    const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: refresh })
    const { data: text, error } = await db.rpc('pm_morning_brief', { p_user: userId })
    if (error) throw new Error('글 만들기 실패: ' + error.message)
    await sendBrief(t.access_token, userId, String(text || '오늘 챙길 일을 만들지 못했습니다'))
    const patch: Record<string, unknown> = { last_sent_at: now, last_error: null, last_text: text, updated_at: now }
    if (t.refresh_token) { patch.refresh_token = t.refresh_token; if (t.refresh_token_expires_in) patch.refresh_expires_at = new Date(Date.now() + t.refresh_token_expires_in * 1000).toISOString() }
    await db.from('pm_kakao_link').update(patch).eq('user_id', userId)
    return { ok: true, text }
  } catch (e) {
    const msg = String((e as Error).message || e)
    await db.from('pm_kakao_link').update({ last_error: msg, updated_at: now }).eq('user_id', userId)
    return { ok: false, error: msg }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* 빈 몸 */ }
  const action = body.action || ''
  if (!REST && action !== 'cron') return json({ error: '서버 함수 시크릿 KAKAO_REST_KEY 가 없습니다' }, 500)

  if (action === 'cron') {
    const key = req.headers.get('x-cron-key') || ''
    const { data: conf } = await db.from('pm_kakao_conf').select('v').eq('k', 'cron_key').maybeSingle()
    if (!conf?.v || key !== conf.v) return json({ error: 'forbidden' }, 403)
    const td = kstToday(), w = new Date(td + 'T00:00:00Z').getUTCDay()
    if (w === 0 || w === 6 || HOLIDAYS.has(td)) return json({ skipped: td })
    const { data: links } = await db.from('pm_kakao_link').select('user_id,refresh_token').eq('enabled', true)
    const out = []
    for (const l of links || []) out.push({ user: l.user_id, ...(await sendTo(l.user_id, l.refresh_token)) })
    return json({ sent: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length })
  }

  const user = await userOf(req)
  if (!user) return json({ error: '로그인이 필요합니다' }, 401)

  if (action === 'config') return json({ rest_key: REST })

  if (action === 'connect') {
    if (!body.code || !body.redirect_uri) return json({ error: 'code · redirect_uri 가 없습니다' }, 400)
    try {
      const t = await tokenCall({ grant_type: 'authorization_code', redirect_uri: body.redirect_uri, code: body.code })
      if (!t.refresh_token) throw new Error('갱신 토큰이 오지 않았습니다')
      if (t.scope && !/talk_message/.test(t.scope)) throw new Error('「카카오톡 메시지 전송」에 동의하지 않았습니다 — 다시 연결하면서 동의해 주세요')
      let nickname: string | null = null
      try {
        const me = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json())
        nickname = me?.properties?.nickname || me?.kakao_account?.profile?.nickname || null
      } catch { /* 이름은 없어도 됨 */ }
      const exp = t.refresh_token_expires_in ? new Date(Date.now() + t.refresh_token_expires_in * 1000).toISOString() : null
      const { error } = await db.from('pm_kakao_link').upsert({ user_id: user.id, nickname, refresh_token: t.refresh_token, refresh_expires_at: exp, enabled: true, last_error: null, updated_at: new Date().toISOString() })
      if (error) throw new Error('저장 실패: ' + error.message)
      await sendMemo(t.access_token, '✅ JS 포털 카톡 알림이 연결됐습니다.\n평일 아침 8시 50분에 「오늘 챙길 일」을 보내 드립니다.')
      return json({ ok: true, nickname })
    } catch (e) { return json({ error: String((e as Error).message || e) }, 400) }
  }

  if (action === 'test') {
    const { data: l } = await db.from('pm_kakao_link').select('refresh_token').eq('user_id', user.id).maybeSingle()
    if (!l) return json({ error: '카카오 연결이 없습니다 — 먼저 연결해 주세요' }, 400)
    const r = await sendTo(user.id, l.refresh_token)
    return json(r, r.ok ? 200 : 400)
  }
  return json({ error: 'unknown action' }, 400)
})
