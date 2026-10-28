// 업무 흐름 — 부서마다 일 순서 · 단계별 「지금 처리할 건수」 (v4.91.0)
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
  영업: '영업', 구매자재: '구매자재', 제조: '제조 (전장 · 하네스)', 생산기술: '생산기술', 품질: '품질',
}

// 메뉴 이름 — 사이드바 · 화면 제목과 같은 이름을 쓴다 (v4.93.2 명칭 통일)
//   업무 흐름의 이동 버튼은 이 이름으로만 나온다. 사이드바 이름을 바꾸면 여기도 같이 바꾼다 (테스트가 확인)
export const MENU = {
  '/orders': '수주대장',
  '/orders?tab=cleanup': '수주대장 · 코드 · BOM 정리',
  '/orders?tab=ecount': '수주대장 · 이카운트 대조',
  '/sales-quote': '매출견적',
  '/drawings': '도면 조회',
  '/inbound': '입고',
  '/quote': '품목 단가 등록',
  '/': '관제탑 (홈)',
  '/outbound': 'ASSY 출고',
  '/issue': '다품목 출고',
  '/material-request': '자재 요청',
  '/doc-request': '자료 요청',
  '/production/harness-release': '하네스 출도·불출',
  '/production/AX': '생산 관리',
  '/production/targets': '생산관리 대상',
  '/quality/drawing-dist': '도면 배포이력 · 외주 배포',
  '/quality/drawing-dist?tab=int': '도면 배포이력 · 사내 배포',
  '/quality/cn': '설계변경(CN) 이력',
  '/quality/fa-progress': '초도품 진행관리',
  '/quality/fai': '초도품 자재 매칭',
  '/quality/lot': '로트 관리',
  bom: 'BOM', cpo: '고객사 PO', forecast: '포캐스트', purchase: '구매발주', short: '부족자재',
}
const CS_PAGE = /^\/customer\/[^/]+\/([a-z]+)$/
export function menuName(path) {
  const p = String(path || '')
  if (MENU[p]) return MENU[p]
  const m = p.match(CS_PAGE)
  return (m && MENU[m[1]]) || p
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

// 주업무(steps) — 그 부서 일의 순서. 화살표로 잇는다
// 보조업무(subs) — 순서에 들지 않는 곁일. 흐름 아래 칸에 따로 둔다 (v4.91.2)
//   name: 업무 이름 · note: 한 줄 설명 · go(pcs): 이동할 메뉴 주소들 — 버튼 이름은 MENU(사이드바와 같은 이름)
//   badges(c, ct): [[이름, 수, 색]] (수가 null 이면 그 배지는 안 그림)
//   tone: red 지금 막힘 · amber 처리 대기 · violet 새로 들어옴 · gray 참고
//   other: 다른 부서가 처리하는 단계(기다리는 단계)
//   글자만 — 아이콘(이모지)은 쓰지 않는다 (v4.93.2)
const cs = (pcs, page) => `/customer/${pcs}/${page}`
const F = {
  영업: {
    title: '영업 — 견적에서 수주 · 납기까지',
    desc: '견적 → BOM 확인 → 수주 등록 → 도면 Rev 확인 → 구매자재 회신 → 납기 협의',
    steps: [
      { name: '견적 접수 · 작성', note: '견적 접수 현황 탭에서 접수 · 점검 후 견적 작성', go: () => ['/sales-quote'], badges: (c) => [['작성 가능', c?.rfq_ready, 'violet'], ['회신 D-3', c?.rfq_due, 'red']] },
      { name: 'BOM 확인', note: '견적 · 수주 품목에 BOM 이 없으면 고객사에 요청해 올림', go: (pcs) => [cs(pcs, 'bom'), '/orders?tab=cleanup'], badges: (c) => [['BOM 필요', c?.rfq_bom, 'red']] },
      { name: '수주 등록', note: 'PDF 올리기 · 직접 등록 (구두 발주 · 선진행 · 발주 예정)', go: () => ['/orders'], badges: (c) => [['이번 달 접수', c?.ord_month, 'gray'], ['정식 PO 대기 지남', c?.po_wait, 'red']] },
      { name: '도면 확인', note: 'PO Rev 와 도면 Rev 비교 — 다르면 받은 새 도면을 생산기술에 공유', go: () => ['/drawings', '/quality/drawing-dist?tab=int'], badges: () => [] },
      { name: '구매자재 회신', note: '구매자재가 처리 — 기다리는 단계', other: '구매자재', go: () => ['/orders'], badges: (c) => [['미확인', c?.ord_unconfirmed, 'red'], ['새 PO 회신 대기', c?.ord_waiting, 'gray']] },
      { name: '회신 확인 · 납기 협의', note: '조건부 · 불가는 사유를 보고 고객사와 협의', go: () => ['/orders'], badges: (c) => [['조건부 · 불가', c?.ord_risk, 'amber'], ['납기 지남', c?.ord_late, 'red']] },
      { name: '납품', note: '품질 검수가 끝난 호기를 고객사에 납품 (v4.98.0)', go: () => ['/production/AX'], badges: (c) => [['납품 대기', c?.prod_ship, 'gray']] },
    ],
    subs: [
      { name: '고객사 PO', go: (pcs) => [cs(pcs, 'cpo')], badges: () => [] },
      { name: '포캐스트', go: (pcs) => [cs(pcs, 'forecast')], badges: () => [] },
      { name: '받은 자료 요청', go: () => ['/doc-request'], badges: (c) => [['필요일 지남', c?.doc?.late, 'red'], ['처리 중', c?.doc?.open, 'amber']] },
    ],
    inbox: [
      { from: '구매자재', text: '수주대장 회신 — 조건부 · 불가 (고객사 납기 협의)', n: (c) => c?.ord_risk, tone: 'amber', path: '/orders' },
      { from: '각 부서', text: '자료 요청 — 고객사에 도면 · BOM 받아 올리기', n: (c) => c?.doc?.open ?? null, tone: 'amber', path: '/doc-request' },
      { from: '품질', text: '검수 끝 — 납품 대기', n: (c) => c?.prod_ship, tone: 'gray', path: '/production/AX' },
    ],
    outbox: [
      { from: '구매자재', text: '새 PO 확인 대기 (등록 1영업일 넘음)', n: (c) => c?.ord_unconfirmed, tone: 'red', path: '/orders' },
      { from: '고객사', text: '구두 발주 · 선진행 — 정식 PO 받을 날 지남', n: (c) => c?.po_wait, tone: 'red', path: '/orders' },
      { from: '구매자재', text: '견적 단가 요청 — 단가 없는 부품', n: (c) => c?.rfq_price, tone: 'amber', path: '/sales-quote' },
      { from: '생산기술', text: '새 Rev 도면 공유 — 사내 배포 대기', n: (c) => c?.dwg_shared, tone: 'violet', path: '/quality/drawing-dist?tab=int' },
    ],
  },
  구매자재: {
    title: '구매자재 — 수주 확인부터 불출까지',
    desc: '수주 확인 → 회신 → 구매발주 → 입고 → 불출',
    steps: [
      { name: '수주 확인', note: '새로 올라온 PO 확인', go: () => ['/orders'], badges: (c) => [['미확인', c?.ord_unconfirmed, 'red']] },
      { name: '회신', note: '품번마다 가능 · 조건부 · 불가 (조건부 · 불가는 사유 필수)', go: () => ['/orders'], badges: (c) => [['새 PO 회신 대기', c?.ord_waiting, 'amber']] },
      { name: '구매발주', note: '협력사 발주 · 독촉 = 받을 날 지남 (협력사 변경 납기가 있으면 그 날, 없으면 요청 납기)', go: (pcs) => [cs(pcs, 'purchase')], badges: (c, ct) => [['독촉 필요', ct?.chaseNeeded, 'red']] },
      { name: '입고', note: '발주 체크 후 입고', go: () => ['/inbound'], badges: (c, ct) => [['입고 지연', ct?.inboundLate, 'red'], ['곧 입고', ct?.inboundSoon, 'gray']] },
      { name: '불출', note: 'BOM 단위 출고 · 여러 품목 한꺼번에 출고', go: () => ['/outbound', '/issue'], badges: () => [] },
    ],
    subs: [
      { name: '자재 요청', go: () => ['/material-request'], badges: (c) => [['요청', c?.req_open, 'amber'], ['처리 중', c?.req_doing, 'gray']] },
      { name: '견적 단가 요청', go: () => ['/quote', '/sales-quote'], badges: (c) => [['요청', c?.rfq_price, 'amber']] },
      { name: '부족자재', go: (pcs) => [cs(pcs, 'short')], badges: () => [] },
      { name: '하네스 출도·불출', go: () => ['/production/harness-release'], badges: () => [] },
      { name: '도면 배포 (협력사)', go: () => ['/quality/drawing-dist'], badges: (c) => [['팀 내 승인 대기', c?.dist_wait, 'amber']] },
      { name: '자료 요청 (영업에)', go: () => ['/doc-request'], badges: (c) => [['받음 · 확인 대기', c?.doc?.byDept?.구매자재?.recv, 'violet'], ['기다림', c?.doc?.byDept?.구매자재?.wait, 'gray']] },
    ],
    inbox: [
      { from: '영업', text: '새로 올라온 PO 확인 (등록 1영업일 넘음)', n: (c) => c?.ord_unconfirmed, tone: 'red', path: '/orders' },
      { from: '제조 · 현장', text: '자재 요청', n: (c) => c?.req_open, tone: 'amber', path: '/material-request' },
      { from: '영업', text: '견적 단가 요청 — 단가 없는 부품 등록', n: (c) => c?.rfq_price, tone: 'amber', path: '/quote' },
    ],
    outbox: [{ from: '영업', text: '조건부 · 불가 회신 — 영업이 고객사와 협의 중', n: (c) => c?.ord_risk, tone: 'amber', path: '/orders' }],
  },
  제조: {
    title: '제조 — 자재 받고 생산까지',
    desc: '자재 요청 → 생산 → 품질 검수',
    steps: [
      { name: '자재 요청', note: '필요한 자재를 구매자재에 요청', go: () => ['/material-request'], badges: (c) => [['처리 대기', c?.req_open, 'amber'], ['처리 중', c?.req_doing, 'gray']] },
      { name: '생산', note: '호기별 제작 상태 입력', go: () => ['/production/AX'], badges: (c) => [['제작 대기', c?.prod_wait, 'gray'], ['제작 중', c?.prod_making, 'violet']] },
      { name: '품질 검수', note: '품질팀이 처리 — 기다리는 단계', other: '품질', go: () => ['/production/AX'], badges: (c) => [['검수 대기', c?.prod_quality, 'amber']] },
    ],
    subs: [
      { name: '도면 수령 확인', go: () => ['/quality/drawing-dist?tab=int'], badges: (c) => [['수령 대기', c?.dwg_unrcv, 'amber'], ['옛 Rev 반납', c?.dwg_unret, 'red']] },
      { name: '자료 요청 (영업에)', go: () => ['/doc-request'], badges: (c) => [['받음 · 확인 대기', c?.doc?.byDept?.제조?.recv, 'violet'], ['기다림', c?.doc?.byDept?.제조?.wait, 'gray']] },
    ],
    inbox: [{ from: '생산기술', text: '사내 배포 도면 — 수령 확인 · 옛 Rev 반납', n: (c) => c?.dwg_unrcv, tone: 'amber', path: '/quality/drawing-dist?tab=int' }],
    outbox: [{ from: '구매자재', text: '자재 요청 — 처리 대기', n: (c) => c?.req_open, tone: 'amber', path: '/material-request' }],
  },
  생산기술: {
    title: '생산기술 — 설계변경 · 새 도면을 현장까지',
    desc: '설계변경 · 영업이 받은 새 Rev 도면 확인 → 사내 배포 → 부서별 수령 확인 → 생산 일정',
    steps: [
      { name: '설계변경 · 새 도면 확인', note: '설계변경(CN) · 영업이 공유한 새 Rev 도면', go: () => ['/quality/cn', '/quality/drawing-dist?tab=int'], badges: (c) => [['영업 공유', c?.dwg_shared, 'violet']] },
      { name: '사내 도면 배포', note: '받을 부서 · 부수를 골라 배포 — 부서마다 수령 확인 · 옛 Rev 반납', go: () => ['/quality/drawing-dist?tab=int'], badges: (c) => [['배포 대기', c?.dwg_shared, 'amber'], ['수령 확인 대기', c?.dwg_unrcv, 'gray'], ['옛 Rev 반납 대기', c?.dwg_unret, 'red']] },
      { name: '생산 일정', note: '호기별 일정', go: () => ['/production/AX'], badges: (c) => [['제작 대기', c?.prod_wait, 'gray']] },
    ],
    subs: [
      { name: '자료 요청 (영업에)', go: () => ['/doc-request'], badges: (c) => [['받음 · 확인 대기', c?.doc?.byDept?.생산기술?.recv, 'violet'], ['기다림', c?.doc?.byDept?.생산기술?.wait, 'gray']] },
    ],
    inbox: [{ from: '영업', text: '새 Rev 도면 공유 — 사내 배포 대기', n: (c) => c?.dwg_shared, tone: 'violet', path: '/quality/drawing-dist?tab=int' }],
    outbox: [{ from: '제조 · 품질', text: '사내 배포 도면 수령 확인 대기', n: (c) => c?.dwg_unrcv, tone: 'amber', path: '/quality/drawing-dist?tab=int' }],
  },
  품질: {
    title: '품질 — 초도품 · 출하 전 검수',
    desc: '초도품 진행 → 초도품 자재 매칭 → 품질 검수',
    steps: [
      { name: '초도품 진행', note: '초도품 일정 · 상태', go: () => ['/quality/fa-progress'], badges: () => [] },
      { name: '초도품 자재 매칭', note: '등록 제조사와 실제 구매이력 대조', go: () => ['/quality/fai'], badges: () => [] },
      { name: '품질 검수', note: '출하 전 검수 — 끝나면 영업 납품으로', go: () => ['/production/AX'], badges: (c) => [['검수 대기', c?.prod_quality, 'amber']] },
    ],
    subs: [
      { name: '로트 관리', go: () => ['/quality/lot'], badges: () => [] },
      { name: '도면 수령 확인', go: () => ['/quality/drawing-dist?tab=int'], badges: (c) => [['수령 대기', c?.dwg_unrcv, 'amber']] },
      { name: '협력사 도면배포 대장 (열람)', go: () => ['/quality/drawing-dist'], badges: () => [] },
      { name: '자료 요청 (영업에)', go: () => ['/doc-request'], badges: (c) => [['받음 · 확인 대기', c?.doc?.byDept?.품질?.recv, 'violet'], ['기다림', c?.doc?.byDept?.품질?.wait, 'gray']] },
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
  const bad = (s) => s.badges(c, ct).filter(([, n]) => has(n)).map(([t, n, tone]) => ({ t, n: Number(n), tone: Number(n) === 0 ? 'zero' : tone }))
  const menus = (s) => s.go(pcs).map((path) => ({ label: menuName(path), path }))
  const steps = f.steps.map((s, i) => {
    const badges = bad(s)
    const links = menus(s)
    return { no: String(i + 1).padStart(2, '0'), name: s.name, note: s.note || '', other: s.other || '', path: links[0].path,
      links, badges, hot: badges.some((b) => b.tone === 'red') }
  })
  const subs = (f.subs || []).map((s) => { const links = menus(s); return { name: s.name, menu: links[0].label, path: links[0].path, badges: bad(s) } })
  const box = (a) => a.map((h) => ({ ...h, n: has(h.n(c)) ? Number(h.n(c)) : null }))
  return { dept, title: f.title, desc: f.desc, steps, subs, inbox: box(f.inbox), outbox: box(f.outbox) }
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
