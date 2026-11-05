// 인터넷 불안정 대비 (v4.154.0)
//   · isNetErr — 서버까지 못 간 실패(끊김 · 시간 초과)인가. 서버가 답한 오류(권한 · 칸 없음 등)는 아님
//   · 불러오기는 끊김이면 3번까지 (1 · 2 · 4초 뒤) 다시 · 저장은 자동으로 다시 하지 않는다 (입고 · 출고가 두 번 들어갈 수 있어서)
//   · 끊김을 알리면 화면 위 「⚠ 인터넷 불안정」 줄 (NetBanner) — 다시 연결되면 보던 화면을 새로 불러옴
const NET_RE = /failed to fetch|networkerror|network error|load failed|fetch failed|err_internet|err_network|err_connection|timed? ?out|aborterror|the network connection was lost|인터넷/i
export const isNetErr = (e) => !!e && (NET_RE.test(String(e?.message || e?.details || e || '')) || e?.name === 'TypeError' && /fetch/i.test(String(e?.message || '')))

const subs = new Set()
let lastFail = 0
export function reportNetFail() { lastFail = Date.now(); subs.forEach((f) => f()) }
export function reportNetOk() { if (lastFail) { lastFail = 0; subs.forEach((f) => f()) } }
export const netBad = () => (typeof navigator !== 'undefined' && navigator.onLine === false) || (lastFail && Date.now() - lastFail < 45 * 1000)
export function onNetChange(f) { subs.add(f); return () => subs.delete(f) }

// 불러오기 다시 시도 규칙 (React Query) — 끊김이면 3번, 서버 오류면 예전처럼 1번
export const queryRetry = (count, err) => (isNetErr(err) ? count < 3 : count < 1)
export const queryRetryDelay = (n) => Math.min(1000 * 2 ** n, 8000)

// 가벼운 저장(위치 · 메모처럼 같은 값을 다시 써도 되는 것) — 끊김이면 3번까지 다시
export async function withNetRetry(fn, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fn()
      if (r && r.error && isNetErr(r.error)) { last = r.error; reportNetFail() } else { if (!r?.error) reportNetOk(); return r }
    } catch (e) { if (!isNetErr(e)) throw e; last = e; reportNetFail() }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)))
  }
  return { data: null, error: last || new Error('인터넷 연결이 불안정합니다') }
}
