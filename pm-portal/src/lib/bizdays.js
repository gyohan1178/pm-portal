// 영업일 계산 — 주말 + 한국 공휴일(2026, 대체공휴일 포함) 제외
// 출처: 관공서 공휴일 규정 + 2026 대체공휴일 확정분. 매년 갱신 필요.
export const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', // 신정
  '2026-02-16', '2026-02-17', '2026-02-18', // 설날 연휴 (당일 2/17 화)
  '2026-03-01', '2026-03-02', // 삼일절(일) + 대체공휴일(월)
  '2026-05-01', // 근로자의날 (공장 휴무)
  '2026-05-05', // 어린이날 (화)
  '2026-05-24', '2026-05-25', // 부처님오신날(일) + 대체공휴일(월)
  '2026-06-06', // 현충일 (토, 대체 없음)
  '2026-07-17', // 제헌절 (금, 2026 복원)
  '2026-08-15', '2026-08-17', // 광복절(토) + 대체공휴일(월)
  '2026-09-24', '2026-09-25', '2026-09-26', // 추석 연휴 (당일 9/25 금)
  '2026-10-03', '2026-10-05', // 개천절(토) + 대체공휴일(월)
  '2026-10-09', // 한글날 (금)
  '2026-12-25', // 성탄절 (금)
  // 2027 (연초 대비 최소분)
  '2027-01-01',
])

export function isHoliday(dateStr) {
  return HOLIDAYS.has(String(dateStr).slice(0, 10))
}

// 영업일 빼기: 주말·공휴일 건너뛰고 n 영업일 이전 날짜
export function bdMinus(dateStr, n) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
  if (isNaN(d)) return null
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    d.setDate(d.getDate() - 1)
    const w = d.getDay()
    if (w === 0 || w === 6) continue
    if (isHoliday(d.toISOString().slice(0, 10))) continue
    left--
  }
  return d.toISOString().slice(0, 10)
}

// 영업일 더하기 (필요시)
export function bdPlus(dateStr, n) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
  if (isNaN(d)) return null
  let left = Math.max(0, Math.round(n))
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const w = d.getDay()
    if (w === 0 || w === 6) continue
    if (isHoliday(d.toISOString().slice(0, 10))) continue
    left--
  }
  return d.toISOString().slice(0, 10)
}


// 연말 공휴일 데이터 만료 경고 — 11월 이후, 다음해 공휴일이 5개 미만 등록이면 경고문 반환
export function holidayCoverageWarning() {
  const now = new Date()
  if (now.getMonth() < 10) return null   // 11월(10)부터 검사
  const nextYear = String(now.getFullYear() + 1)
  let cnt = 0
  for (const d of HOLIDAYS) if (d.startsWith(nextYear)) cnt++
  if (cnt < 5) return `${nextYear}년 공휴일이 등록되지 않았습니다 — 전장 역산 일정이 틀어지기 전에 bizdays.js 갱신이 필요해요`
  return null
}
