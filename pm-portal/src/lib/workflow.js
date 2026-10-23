// 🧭 업무 흐름 — 부서마다 일 순서 · 단계별 「지금 처리할 건수」 (v4.91.0)
//
//   ⚠ 누가 어느 부서 흐름을 보나
//     팀장급 이상(회원 관리 「팀장급」 체크) · 관리자 → 모든 부서
//     그 밖 → 내 부서 + 제조 (제조 흐름은 모두가 본다)
//     화면에서 고르는 것만 가린다 — 단계를 눌러 가는 메뉴는 원래 메뉴 권한을 그대로 따른다.
//
//   건수 출처
//     c  = pm_flow_counts() — 수주대장 · 자재요청 · 도면 배포 · 생산 상태 (가벼운 집계 한 번)
//          「새 PO 회신 대기」는 PDF · 직접 등록 PO 만 (이관 줄은 회신 이력이 없어 뺌 — v4.91.1)
//     ct = 관제탑 계산(부족 · 발주 필요 · 입고 지연) — 무거워서 구매자재 흐름을 볼 때만 받는다
//   건수를 못 받으면(SQL 전 · 권한 없음) 그 칸만 비운다. 흐름과 이동은 그대로 된다.

export const FLOW_DEPTS = ['영업', '구매자재', '제조', '생산기술', '품질']

export const DEPT_LABEL = {
  영업: '💼 영업', 구매자재: '🛒 구매자재', 제조: '🔧 제조 (전장 · 하네스)', 생산기술: '⚙ 생산기술', 품질: '🛡 품질',
}

// 팀장급 이상인가 — 관리자이거나 회원 관리에서 「팀장급」 체크
export const isLead = (p) => !!p && (p.role === 'admin' || p.is_lead === true)

// 볼 수 있는 부서 — 내 부서를 맨 앞에
export function visibleDepts(p) {
  if (!p) return []
  const mine = FLOW_DEPTS.includes(p.dept) ? p.dept : null
  const list = isLead(p) ? FLOW_DEPTS : [mine, '제조'].filter(Boolean)
  const uniq = [...new Set(list)]
  return mine ? [mine, ...uniq.filter((d) => d !== mine)] : uniq
}

// 단계 — path(pcs): 이동할 주소 · badges(c, ct): [[이름, 수, 색]] (수가 null 이면 그 배지는 안 그림)
//   tone: red 지금 막힘 · amber 처리 대기 · violet 새로 들어옴 · gray 참고
//   other: 다른 부서가 처리하는 단계(기다리는 단계) · soon: 아직 없는 화면
const F = {
  영업: {
    title: '영업 — 견적에서 수주 · 납품까지',
    desc: '견적 → 수주 등록 → 구매자재 회신 확인 → 납기 관리 순서입니다.',
    steps: [
      { icon: '📤', name: '견적 접수 · 작성', where: '영업 › 매출견적', path: () => '/sales-quote', soon: '견적 접수 탭 준비 중', badges: () => [] },
      { icon: '🧬', name: 'BOM 확인', where: '기초자료 › BOM', path: (pcs) => `/customer/${pcs}/bom`, badges: () => [] },
      { icon: '📨', name: '수주 등록', where: '영업 › 수주대장 › PDF 올리기', path: () => '/orders', badges: (c) => [['이번 달 접수', c?.ord_month, 'gray']] },
      { icon: '💬', name: '구매자재 회신', where: '구매자재가 처리 — 기다리는 단계', other: '구매자재', path: () => '/orders', badges: (c) => [['미확인', c?.ord_unconfirmed, 'red'], ['새 PO 회신 대기', c?.ord_waiting, 'gray']] },
      { icon: '✅', name: '회신 확인 · 납기 협의', where: '영업 › 수주대장', path: () => '/orders', badges: (c) => [['조건부 · 불가', c?.ord_risk, 'amber'], ['납기 지남', c?.ord_late, 'red']] },
    ],
    inbox: [{ from: '구매자재', text: '수주대장 회신 — 조건부 · 불가 (고객사 납기 협의)', n: (c) => c?.ord_risk, tone: 'amber', path: '/orders' }],
    outbox: [{ from: '→ 구매자재', text: '새 PO 확인 대기 (등록 1영업일 넘음)', n: (c) => c?.ord_unconfirmed, tone: 'red', path: '/orders' }],
  },
  구매자재: {
    title: '구매자재 — 수주 확인부터 불출 · 도면 배포까지',
    desc: '다른 부서가 넘긴 일(새 PO · 자재 요청)부터 처리합니다.',
    steps: [
      { icon: '📨', name: '수주 확인 · 회신', where: '영업 › 수주대장', path: () => '/orders', badges: (c) => [['미확인', c?.ord_unconfirmed, 'red'], ['새 PO 회신 대기', c?.ord_waiting, 'amber']] },
      { icon: '🙋', name: '자재 요청', where: '현장 › 자재 요청', path: () => '/material-request', badges: (c) => [['요청', c?.req_open, 'amber'], ['처리 중', c?.req_doing, 'gray']] },
      { icon: '🚨', name: '부족 확인', where: '구매 › 자재 상황판', path: (pcs) => `/customer/${pcs}/short`, badges: (c, ct) => [['재고 음수 예정', ct?.negSoon, 'amber']] },
      { icon: '🛒', name: '구매발주', where: '구매 › 구매발주', path: (pcs) => `/customer/${pcs}/purchase`, badges: (c, ct) => [['발주 필요', ct?.orderNeeded, 'amber']] },
      { icon: '📥', name: '입고', where: '구매 › 입고', path: () => '/inbound', badges: (c, ct) => [['입고 지연', ct?.inboundLate, 'red'], ['곧 입고', ct?.inboundSoon, 'gray']] },
      { icon: '📤', name: '불출 · 출도', where: '자재 › ASSY 출고 · 하네스 출도·불출', path: () => '/outbound', badges: (c, ct) => [['하네스 필요', ct?.harnessNeed, 'gray']] },
      { icon: '📐', name: '도면 배포', where: '품질 › 도면 배포이력', path: () => '/quality/drawing-dist', badges: (c) => [['승인 대기', c?.dist_wait, 'amber']] },
    ],
    inbox: [
      { from: '영업', text: '새로 올라온 PO 확인 (등록 1영업일 넘음)', n: (c) => c?.ord_unconfirmed, tone: 'red', path: '/orders' },
      { from: '제조 · 현장', text: '자재 요청', n: (c) => c?.req_open, tone: 'amber', path: '/material-request' },
    ],
    outbox: [{ from: '→ 영업', text: '조건부 · 불가 회신 — 영업이 고객사와 협의 중', n: (c) => c?.ord_risk, tone: 'amber', path: '/orders' }],
  },
  제조: {
    title: '제조 — 자재 받고 생산까지',
    desc: '필요한 자재는 자재 요청으로, 진행은 생산 관리에서 봅니다.',
    steps: [
      { icon: '🙋', name: '자재 요청', where: '현장 › 자재 요청', path: () => '/material-request', badges: (c) => [['처리 대기', c?.req_open, 'amber'], ['처리 중', c?.req_doing, 'gray']] },
      { icon: '🔧', name: '생산', where: '생산 › 생산 관리', path: () => '/production/AX', badges: (c) => [['제작 대기', c?.prod_wait, 'gray'], ['제작 중', c?.prod_making, 'violet']] },
      { icon: '🧵', name: '하네스 출도 · 불출', where: '생산 › 하네스 출도·불출', path: () => '/production/harness-release', badges: () => [] },
      { icon: '🛡', name: '품질 검수', where: '품질팀이 처리 — 기다리는 단계', other: '품질', path: () => '/production/AX', badges: (c) => [['검수 대기', c?.prod_quality, 'amber']] },
      { icon: '🖥', name: '생산 전광판', where: '생산 › 생산 전광판 (현장 TV)', path: () => '/board', badges: () => [] },
    ],
    inbox: [],
    outbox: [{ from: '→ 구매자재', text: '자재 요청 — 처리 대기', n: (c) => c?.req_open, tone: 'amber', path: '/material-request' }],
  },
  생산기술: {
    title: '생산기술 — 설계변경을 현장까지',
    desc: '설계변경(CN)을 확인하고 생산 일정 · 납품 일정에 반영합니다.',
    steps: [
      { icon: '🔁', name: '설계변경 확인', where: '품질 › 설계변경(CN) 이력', path: () => '/quality/cn', badges: () => [] },
      { icon: '📐', name: '사내 도면 배포', where: '품질 › 도면 배포이력', path: () => '/quality/drawing-dist', soon: '사내 배포 탭 준비 중', badges: () => [] },
      { icon: '🔧', name: '생산 일정', where: '생산 › 생산 관리', path: () => '/production/AX', badges: (c) => [['제작 대기', c?.prod_wait, 'gray']] },
      { icon: '📅', name: '납품 일정 변경', where: '분석 › 납품 일정 변경', path: () => '/schedule-changes', badges: () => [] },
      { icon: '🖥', name: '생산 전광판', where: '생산 › 생산 전광판', path: () => '/board', badges: () => [] },
    ],
    inbox: [],
    outbox: [],
  },
  품질: {
    title: '품질 — 초도품 · 검수 · 로트 · 배포 승인',
    desc: '초도품과 출하 전 검수, 도면 배포 승인을 봅니다.',
    steps: [
      { icon: '🚦', name: '초도품 진행', where: '품질 › 초도품 진행관리', path: () => '/quality/fa-progress', badges: () => [] },
      { icon: '🧾', name: '초도품 자재 매칭', where: '품질 › 초도품 자재 매칭', path: () => '/quality/fai', badges: () => [] },
      { icon: '🛡', name: '품질 검수', where: '생산 › 생산 관리', path: () => '/production/AX', badges: (c) => [['검수 대기', c?.prod_quality, 'amber'], ['납품 대기', c?.prod_ship, 'gray']] },
      { icon: '🏷', name: '로트 관리', where: '품질 › 로트 관리', path: () => '/quality/lot', badges: () => [] },
      { icon: '📐', name: '도면 배포 승인', where: '품질 › 도면 배포이력', path: () => '/quality/drawing-dist', badges: (c) => [['승인 대기', c?.dist_wait, 'amber']] },
    ],
    inbox: [{ from: '제조', text: '품질 검수 대기', n: (c) => c?.prod_quality, tone: 'amber', path: '/production/AX' }],
    outbox: [],
  },
}

// 화면에 그릴 모양으로 — 건수가 없는(null) 배지는 뺀다
export function flowOf(dept, { c = null, ct = null, pcs = 'ax' } = {}) {
  const f = F[dept]
  if (!f) return null
  const has = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v))
  const steps = f.steps.map((s, i) => {
    const badges = s.badges(c, ct).filter(([, n]) => has(n)).map(([t, n, tone]) => ({ t, n: Number(n), tone: Number(n) === 0 ? 'zero' : tone }))
    return { no: String(i + 1).padStart(2, '0'), icon: s.icon, name: s.name, where: s.where, other: s.other || '', soon: s.soon || '', path: s.path(pcs), badges, hot: badges.some((b) => b.tone === 'red') }
  })
  const box = (a) => a.map((h) => ({ ...h, n: has(h.n(c)) ? Number(h.n(c)) : null }))
  return { dept, title: f.title, desc: f.desc, steps, inbox: box(f.inbox), outbox: box(f.outbox) }
}

// 구매자재 흐름에 쓰는 관제탑 숫자 — 관제탑 「전체」 화면과 같은 방식(고객사마다 계산해 더함)
export function ctKpiOf(data, compute) {
  if (!data) return null
  if (data.byCustomer && Object.keys(data.byCustomer).length) {
    const k = {}
    Object.values(data.byCustomer).forEach((d) => {
      const r = compute({ shortage: d.shortage, pos: d.pos, prod: d.prod, buyPos: d.buyPos || [] })
      Object.entries(r.kpi).forEach(([key, v]) => { k[key] = (k[key] || 0) + v })
    })
    return k
  }
  return compute({ shortage: data.shortage, pos: data.pos, prod: data.prod, buyPos: data.buyPos || [] }).kpi
}
