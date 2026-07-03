// 소수점 2째 자리 반올림
export function round2(v) {
  return Math.round((v||0) * 100) / 100
}

// 숫자 표시 (소수점 있으면 2자리, 없으면 정수)
export function fmtNum(v) {
  const r = round2(v)
  return r % 1 === 0 ? r.toLocaleString() : r.toFixed(2)
}

// 만원 단위 표시
export function fmtWon(v) {
  const man = Math.round((v||0) / 10000)
  return man >= 10000 ? `${(man/10000).toFixed(1)}억` : `${man.toLocaleString()}만`
}

// ── 품목 카테고리 (JS-XX-0000 형식) ──
// 코드 정리 후 기준코드가 JS-[카테고리2자]-[일련번호] 형식이 되면 자동 분류된다.
export const ITEM_CATEGORIES = [
  { code: 'CA', name: '케이블/전선류',   desc: 'Cable, Wire, 전선' },
  { code: 'CN', name: '커넥터/단자류',   desc: 'Lug, Ferrule, Connector, Terminal' },
  { code: 'BK', name: '차단기/보호소자', desc: 'CB, MC' },
  { code: 'EL', name: '전장부품류',      desc: 'Relay, Switch, SMPS, Sensor 등' },
  { code: 'SM', name: '판금물',          desc: 'Sheet Metal' },
  { code: 'AS', name: '어셈블리',        desc: 'PD/Harness Assembly, KIT' },
  { code: 'HS', name: '하네스',          desc: 'Harness Assy' },
  { code: 'HW', name: '하드웨어류',      desc: 'Screw, Bolt, Nut, Washer' },
  { code: 'ET', name: '기타/소모품',     desc: '라벨, 슬리브, 덕트 등' },
  { code: 'DC', name: '[문서] 회로도',   desc: 'Circuit Drawing' },
  { code: 'WI', name: '[문서] 작업표준', desc: 'Work Instruction' },
]
const CATEGORY_MAP = Object.fromEntries(ITEM_CATEGORIES.map(c => [c.code, c.name]))

// 기준코드에서 카테고리 코드 추출: 'JS-CA-0001' → 'CA' (없으면 null)
export function getCategoryCode(stdCode) {
  if (!stdCode) return null
  // 실제 js_code 형식: 'JS-SM0294'(대시 없음) 및 'JS-SM-0294'(대시 있음) 모두 허용
  const m = String(stdCode).toUpperCase().match(/^JS-?([A-Z]{2})/)
  return m ? m[1] : null
}
// 카테고리 코드 → 이름: 'CA' → '케이블/전선류' (매핑 없으면 코드 그대로)
export function getCategoryName(code) {
  if (!code) return '미분류'
  return CATEGORY_MAP[code] || code
}
// 기준코드 → 카테고리 이름 한 번에
export function categoryOf(stdCode) {
  return getCategoryName(getCategoryCode(stdCode))
}

// ── 공유 헬퍼 (구 중복 정의 통합: Items/Inventory/PurchasePage/Forecast/ShortageForecast) ──
export const JS_CAT = { CA: '케이블', WI: '와이어', CN: '커넥터', BK: '차단기', EL: '전장', SM: '판금', AS: '어셈블리', HS: '하네스', HW: '하드웨어', ET: '기타' }
export const PROC_CATS = new Set(['어셈블리', '하네스', '판금'])  // 가공류

// 품목의 세부구분 한글명 (js_code 기준, getCategoryCode와 동일 규칙)
export const catOf = item => {
  const code = getCategoryCode(item?.js_code)
  return (code && JS_CAT[code]) || item?.type || '-'
}

// 'YYYY-MM' → 'YYYY-Qn'
export const quarterOf = m => { const [y, mm] = String(m).split('-'); return `${y}-Q${Math.floor(((+mm || 1) - 1) / 3) + 1}` }

// 오늘 날짜 YYYY-MM-DD
export const todayISO = () => new Date().toISOString().split('T')[0]

// 소수 1자리 (정수는 정수로)
export const fmt1 = n => { const v = Math.round(Number(n) * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1) }
