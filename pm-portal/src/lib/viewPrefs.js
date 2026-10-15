// 화면 크기 · 메뉴 접기 — 이 컴퓨터(브라우저)에만 저장한다 (v4.63.0)
//   노트북은 화면이 낮아 표가 몇 줄밖에 안 보인다 → 글자 · 여백을 조금 줄여 한 화면에 더 많이 보이게.
//   Tailwind 크기는 거의 rem(기본 글자 크기 기준)이라 html 글자 크기만 바꾸면 화면 전체가 같은 비율로 줄어든다.
//   (확대 · 축소(zoom)와 달리 화면 높이 계산이 어긋나지 않는다)
const KEY_SCALE = 'pm.viewScale'
const KEY_SIDE = 'pm.sidebarCollapsed'
export const SCALE_OPTS = [
  ['auto', '자동', '노트북처럼 낮은 화면이면 조금 작게'],
  ['100', '크게 (100%)', '예전 그대로'],
  ['94', '보통 (94%)', '조금 작게 — 표가 한두 줄 더 보임'],
  ['88', '작게 (88%)', '많이 보기 — 글자가 작아짐'],
]
const read = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* 저장 안 되는 브라우저 */ } }

export const getScalePref = () => read(KEY_SCALE, 'auto')
// 자동: 높이 820 미만 또는 폭 1440 미만이면 94%
export function scalePct(pref = getScalePref(), w = window.innerWidth, h = window.innerHeight) {
  if (pref === '100' || pref === '94' || pref === '88') return Number(pref)
  return (h < 820 || w < 1440) ? 94 : 100
}
export function applyScale(pref = getScalePref()) {
  const pct = scalePct(pref)
  const el = document.documentElement
  el.style.fontSize = pct === 100 ? '' : `${(16 * pct) / 100}px`
  if (pct < 100) el.setAttribute('data-compact', String(pct)); else el.removeAttribute('data-compact')
  try { window.dispatchEvent(new Event('pm:viewscale')) } catch { /* 옛 브라우저 */ }
  return pct
}
export function setScalePref(v) { write(KEY_SCALE, v); return applyScale(v) }
// 창 크기가 바뀌면(자동일 때) 다시 맞춘다
let bound = false
export function initScale() {
  applyScale()
  if (bound) return
  bound = true
  window.addEventListener('resize', () => { if (getScalePref() === 'auto') applyScale('auto') })
}

export const getSidebarCollapsed = () => read(KEY_SIDE, '0') === '1'
export const setSidebarCollapsed = (v) => write(KEY_SIDE, v ? '1' : '0')
