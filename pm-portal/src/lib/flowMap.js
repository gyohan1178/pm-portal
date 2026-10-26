// 업무 흐름 지도 (v4.98.0) — 부서마다 한 줄 · 왼쪽부터 일의 순서 · 부서를 건너가는 일은 화살표
//
//   ⚠ 숫자 공개 규칙 (부서 간 견제 · 정보 과잉을 막는다)
//     흐름(모든 부서 줄 · 단계 · 곁일)은 누구나 본다.
//     숫자는 ① 내 부서 칸 전부  ② 다른 부서 칸은 「나와 이어진 것」만 (REL)  ③ 팀장급 · 관리자는 전부.
//     화면에서 가리는 것이다 — 단계를 눌러 가는 메뉴는 원래 메뉴 권한을 그대로 따른다.
//
//   건수 출처는 업무 흐름(workflow.js)과 같다: c = pm_flow_counts() · ct = 관제탑 KPI · d = 자료 요청(docCounts)
import { isLead } from './workflow'

export const MAP_DEPTS = ['영업', '구매자재', '제조', '품질', '생산기술']
export const MAP_COLS = 8

const cs = (pcs, page) => `/customer/${pcs}/${page}`

// 단계 — col: 0 견적 · 1~2 수주 · 회신 · 3~5 자재 준비 · 6 생산 · 7 검수 → 납품
//   keys: 같은 흐름끼리 묶는 이름(누르면 같은 키의 칸 · 화살표만 진하게)
export const MAP_NODES = [
  { id: 's1', dept: '영업', col: 0, name: '견적 작성', keys: ['price'], go: () => ['/sales-quote'], badges: (c) => [['작성 가능', c?.rfq_ready, 'violet'], ['회신 D-3', c?.rfq_due, 'red']] },
  { id: 's3', dept: '영업', col: 1, name: '수주 등록', keys: ['po'], go: () => ['/orders'], badges: (c) => [['정식 PO 대기 지남', c?.po_wait, 'red'], ['이번 달 접수', c?.ord_month, 'gray']] },
  { id: 's4', dept: '영업', col: 2, name: '도면 확인', keys: ['dwg'], go: () => ['/drawings', '/quality/drawing-dist?tab=int'], badges: () => [] },
  { id: 's6', dept: '영업', col: 3, name: '납기 협의', keys: ['reply'], go: () => ['/orders'], badges: (c) => [['납기 지남', c?.ord_late, 'red'], ['조건부 · 불가', c?.ord_risk, 'amber']] },
  { id: 's10', dept: '영업', col: 7, name: '납품', keys: ['ship'], go: () => ['/production/AX'], badges: (c) => [['납품 대기', c?.prod_ship, 'gray']] },
  { id: 'p1', dept: '구매자재', col: 1, name: '수주 확인·회신', keys: ['po', 'reply'], go: () => ['/orders'], badges: (c) => [['미확인', c?.ord_unconfirmed, 'red'], ['회신 대기', c?.ord_waiting, 'amber']] },
  { id: 'p3', dept: '구매자재', col: 3, name: '구매발주', keys: ['buy'], go: (pcs) => [cs(pcs, 'purchase'), '/'], badges: (c, ct) => [['독촉 필요', ct?.chaseNeeded, 'red'], ['발주 필요', ct?.orderNeeded, 'amber']] },
  { id: 'p4', dept: '구매자재', col: 4, name: '입고', keys: ['buy'], go: () => ['/inbound', '/'], badges: (c, ct) => [['입고 지연', ct?.inboundLate, 'red'], ['곧 입고', ct?.inboundSoon, 'gray']] },
  { id: 'p5', dept: '구매자재', col: 5, name: '불출', keys: ['mreq'], go: () => ['/outbound', '/issue'], badges: () => [] },
  { id: 'm6', dept: '제조', col: 3, name: '도면 수령', keys: ['dwg'], go: () => ['/quality/drawing-dist?tab=int'], badges: (c) => [['옛 Rev 반납', c?.dwg_unret, 'red'], ['수령 대기', c?.dwg_unrcv, 'amber']] },
  { id: 'm1', dept: '제조', col: 5, name: '자재 요청', keys: ['mreq'], go: () => ['/material-request'], badges: (c) => [['처리 대기', c?.req_open, 'amber'], ['처리 중', c?.req_doing, 'gray']] },
  { id: 'm2', dept: '제조', col: 6, name: '생산', keys: ['mreq', 'make', 'qc'], go: () => ['/production/AX'], badges: (c) => [['제작 중', c?.prod_making, 'violet'], ['제작 대기', c?.prod_wait, 'gray']] },
  { id: 'q5', dept: '품질', col: 4, name: '도면 수령', keys: ['dwg'], go: () => ['/quality/drawing-dist?tab=int'], badges: (c) => [['수령 대기', c?.dwg_unrcv, 'amber']] },
  { id: 'q3', dept: '품질', col: 7, name: '품질 검수', keys: ['qc', 'ship'], go: () => ['/production/AX'], badges: (c) => [['검수 대기', c?.prod_quality, 'amber']] },
  { id: 't1', dept: '생산기술', col: 2, name: '새 도면 확인', keys: ['dwg'], go: () => ['/quality/cn', '/quality/drawing-dist?tab=int'], badges: (c) => [['영업 공유', c?.dwg_shared, 'violet']] },
  { id: 't2', dept: '생산기술', col: 3, name: '사내 도면 배포', keys: ['dwg'], go: () => ['/quality/drawing-dist?tab=int'], badges: (c) => [['배포 대기', c?.dwg_shared, 'amber'], ['수령 확인 대기', c?.dwg_unrcv, 'gray']] },
  { id: 't3', dept: '생산기술', col: 6, name: '생산 일정', keys: ['make'], go: () => ['/production/AX'], badges: (c) => [['제작 대기', c?.prod_wait, 'gray']] },
]

// 곁일 — 순서 없이 생기는 일. from: 다른 부서에서 넘어오는 일
export const MAP_SUBS = {
  영업: [
    { id: 's2', name: 'BOM 확인', keys: ['doc'], go: (pcs) => [cs(pcs, 'bom'), '/orders?tab=cleanup'], badges: (c) => [['BOM 필요', c?.rfq_bom, 'red']] },
    { id: 's7', name: '고객사 PO', keys: [], go: (pcs) => [cs(pcs, 'cpo')], badges: () => [] },
    { id: 's8', name: '포캐스트', keys: [], go: (pcs) => [cs(pcs, 'forecast')], badges: () => [] },
    { id: 's9', name: '📥 받은 자료 요청', keys: ['doc'], go: () => ['/doc-request'], badges: (c, ct, d) => [['필요일 지남', d?.late, 'red'], ['처리 중', d?.open, 'amber']] },
  ],
  구매자재: [
    { id: 'p6', name: '자재 요청', from: '제조', keys: ['mreq'], go: () => ['/material-request'], badges: (c) => [['요청', c?.req_open, 'amber']] },
    { id: 'p7', name: '견적 단가 요청', from: '영업', keys: ['price'], go: () => ['/quote', '/sales-quote'], badges: (c) => [['요청', c?.rfq_price, 'amber']] },
    { id: 'p8', name: '부족자재', keys: ['buy'], go: (pcs) => [cs(pcs, 'short')], badges: () => [] },
    { id: 'p9', name: '하네스 출도', keys: ['mreq'], go: () => ['/production/harness-release'], badges: () => [] },
    { id: 'p10', name: '협력사 도면배포', keys: ['dist'], go: () => ['/quality/drawing-dist'], badges: (c) => [['팀 내 승인 대기', c?.dist_wait, 'amber']] },
    { id: 'p11', name: '📎 요청한 자료', keys: ['doc'], go: () => ['/doc-request'], badges: (c, ct, d) => docMine(d, '구매자재') },
  ],
  제조: [
    { id: 'm5', name: '📎 요청한 자료', keys: ['doc'], go: () => ['/doc-request'], badges: (c, ct, d) => docMine(d, '제조') },
  ],
  품질: [
    { id: 'q1', name: '초도품 진행', keys: ['fa'], go: () => ['/quality/fa-progress'], badges: () => [] },
    { id: 'q2', name: '초도품 매칭', keys: ['fa'], go: () => ['/quality/fai'], badges: () => [] },
    { id: 'q4', name: '로트 관리', keys: [], go: () => ['/quality/lot'], badges: () => [] },
    { id: 'q6', name: '📖 도면배포 대장', keys: ['dist'], go: () => ['/quality/drawing-dist'], badges: () => [], note: '열람' },
    { id: 'q7', name: '📎 요청한 자료', keys: ['doc'], go: () => ['/doc-request'], badges: (c, ct, d) => docMine(d, '품질') },
  ],
  생산기술: [
    { id: 't4', name: '📎 요청한 자료', keys: ['doc'], go: () => ['/doc-request'], badges: (c, ct, d) => docMine(d, '생산기술') },
  ],
}

function docMine(d, dept) {
  const x = d?.byDept?.[dept]
  return [['받음 · 확인 대기', x?.recv, 'violet'], ['기다림', x?.wait, 'gray']]
}

// 다른 부서 칸에 보이는 「나와 관련」 숫자 — 보는 사람 부서 → { 칸 id: [설명, 숫자 함수] }
//   부서 사이를 건너가는 일(업무 흐름의 넘어온 일 · 넘긴 일)만 고른다
export const MAP_REL = {
  영업: {
    p1: ['내 PO 회신 대기', (c) => c?.ord_waiting],
    p7: ['내 단가 요청', (c) => c?.rfq_price],
    t1: ['내가 공유한 새 Rev 도면', (c) => c?.dwg_shared],
    p11: ['나에게 온 자료 요청', (c, ct, d) => d?.byDept?.구매자재?.wait],
    m5: ['나에게 온 자료 요청', (c, ct, d) => d?.byDept?.제조?.wait],
    q7: ['나에게 온 자료 요청', (c, ct, d) => d?.byDept?.품질?.wait],
    t4: ['나에게 온 자료 요청', (c, ct, d) => d?.byDept?.생산기술?.wait],
    q3: ['검수 끝나면 넘어올 것', (c) => c?.prod_quality],
  },
  구매자재: {
    s3: ['새 PO 미확인', (c) => c?.ord_unconfirmed],
    s6: ['내 회신으로 협의 중', (c) => c?.ord_risk],
    s1: ['내게 온 단가 요청', (c) => c?.rfq_price],
    m1: ['나에게 온 자재 요청', (c) => c?.req_open],
    s9: ['내 자료 요청', (c, ct, d) => d?.byDept?.구매자재?.wait],
  },
  제조: {
    p6: ['내 자재 요청', (c) => c?.req_open],
    t2: ['받을 도면 (수령 대기)', (c) => c?.dwg_unrcv],
    q3: ['넘긴 검수', (c) => c?.prod_quality],
    s9: ['내 자료 요청', (c, ct, d) => d?.byDept?.제조?.wait],
  },
  품질: {
    m2: ['검수 넘어올 예정 (제작 중)', (c) => c?.prod_making],
    t2: ['받을 도면 (수령 대기)', (c) => c?.dwg_unrcv],
    s10: ['넘긴 납품', (c) => c?.prod_ship],
    s9: ['내 자료 요청', (c, ct, d) => d?.byDept?.품질?.wait],
  },
  생산기술: {
    s4: ['영업이 공유한 새 Rev', (c) => c?.dwg_shared],
    m6: ['배포 도면 수령 대기', (c) => c?.dwg_unrcv],
    q5: ['배포 도면 수령 대기', (c) => c?.dwg_unrcv],
    s9: ['내 자료 요청', (c, ct, d) => d?.byDept?.생산기술?.wait],
  },
}

// 흐름 이름 — 칸을 누르면 아래 줄에 나온다
export const MAP_KEYS = {
  price: '견적 흐름 — 영업 견적 ↔ 구매자재 견적 단가',
  po: '수주 흐름 — 영업 수주 등록 → 구매자재 수주 확인',
  reply: '회신 흐름 — 구매자재 회신 → 영업 납기 협의',
  dwg: '도면 흐름 — 영업 도면 확인 → 생산기술 새 도면 · 사내 배포 → 제조 · 품질 수령',
  buy: '구매 흐름 — 구매발주 → 입고 (부족자재)',
  mreq: '자재 흐름 — 제조 자재 요청 → 구매자재 불출 → 제조 생산',
  make: '생산 일정 — 생산기술 일정 → 제조 생산',
  qc: '검수 흐름 — 제조 생산 → 품질 검수',
  ship: '납품 흐름 — 품질 검수 끝 → 영업 납품 → 고객사',
  doc: '자료 요청 — 각 부서 📎 요청 → 영업 받은 자료 요청 → 고객사 → 받으면 요청 부서로',
  dist: '협력사 도면 배포 — 구매자재가 배포 · 팀 안에서 승인 / 품질은 대장 열람',
  fa: '초도품 — 품질',
}

// 화살표 — 이름표는 굵은 흐름만. from/to: 칸 id · route: 그리는 모양 (geometry 에서 계산)
export const MAP_EDGES = [
  { id: 's1s3', key: 'price', from: 's1', to: 's3', route: 'h' },
  { id: 's3s4', key: 'dwg', from: 's3', to: 's4', route: 'h' },
  { id: 'a', key: 'po', from: 's3', to: 'p1', route: 'down1', label: '새 PO' },
  { id: 'b', key: 'reply', from: 'p1', to: 's6', route: 'upChannel', label: '회신' },
  { id: 'c', key: 'dwg', from: 's4', to: 't1', route: 'down', label: '새 Rev 도면' },
  { id: 'p1p3', key: 'buy', from: 'p1', to: 'p3', route: 'h' },
  { id: 'p3p4', key: 'buy', from: 'p3', to: 'p4', route: 'h' },
  { id: 'p4p5', key: 'buy', from: 'p4', to: 'p5', route: 'h' },
  { id: 'f', key: 'mreq', from: 'm1', to: 'p5', route: 'up1', label: '자재 요청' },
  { id: 'g', key: 'mreq', from: 'p5', to: 'm2', route: 'hDown', label: '불출' },
  { id: 'd1', key: 'dwg', from: 't2', to: 'm6', route: 'up', label: '사내 배포' },
  { id: 'd2', key: 'dwg', from: 't2', to: 'q5', route: 'hUp' },
  { id: 'h', key: 'make', from: 't3', to: 'm2', route: 'up', label: '일정' },
  { id: 'i', key: 'qc', from: 'm2', to: 'q3', route: 'hDown1', label: '검수 요청' },
  { id: 'j', key: 'ship', from: 'q3', to: 's10', route: 'up2', label: '검수 끝' },
]

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

// 보는 사람 → 무엇을 보여 줄지
//   all: 모든 숫자 (팀장급 · 관리자)
//   mine: 내 부서 (FLOW 부서가 아니면 null → 흐름만)
export function mapViewer(profile) {
  const all = isLead(profile)
  const mine = MAP_DEPTS.includes(profile?.dept) ? profile.dept : null
  return { all, mine }
}

// 한 칸의 숫자 — show: 숫자를 보여도 되는가 · rel: 다른 부서 칸의 나와 관련 숫자
export function cellOf(spec, dept, viewer, data) {
  const { c = null, ct = null, d = null } = data || {}
  const show = viewer.all || (viewer.mine && viewer.mine === dept)
  const badges = show
    ? spec.badges(c, ct, d).map(([t, n, tone]) => ({ t, n: num(n), tone })).filter((b) => b.n !== null)
    : []
  let rel = null
  if (!show && viewer.mine) {
    const r = MAP_REL[viewer.mine]?.[spec.id]
    if (r) { const n = num(r[1](c, ct, d)); rel = { t: r[0], n } }
  }
  // 칸 오른쪽 위 숫자 — 빨강 > 주황 > 보라 > 회색 중 0 보다 큰 첫 숫자
  const live = badges.filter((b) => b.n > 0)
  const lead = live.find((b) => b.tone === 'red') || live.find((b) => b.tone === 'amber') || live.find((b) => b.tone === 'violet') || live[0] || null
  return { show, badges, rel, lead }
}

// 자리 계산 — 폭에 맞춰 칸 너비 · 간격을 정한다 (테스트도 이 함수로 겹침을 본다)
export function mapGeometry(width) {
  const W = Math.max(980, Math.round(width || 0))
  const LABEL = 64, GAP = 18
  const SUB = Math.max(240, Math.min(330, Math.round(W * 0.235)))
  const main = W - LABEL - GAP - SUB
  const SP = main / MAP_COLS
  const NW = Math.floor(SP - 12)
  const NH = 34, LH = 82, TOP = 30
  const colX = (c) => Math.round(LABEL + c * SP)
  const laneTop = (r) => TOP + r * LH
  const nodeTop = (r) => laneTop(r) + Math.round((LH - NH) / 2)
  const H = laneTop(MAP_DEPTS.length) + 4
  const box = {}
  MAP_NODES.forEach((n) => {
    const r = MAP_DEPTS.indexOf(n.dept)
    box[n.id] = { x: colX(n.col), y: nodeTop(r), w: NW, h: NH, r }
  })
  const L = (id) => box[id].x, R = (id) => box[id].x + NW, T = (id) => box[id].y, B = (id) => box[id].y + NH
  const C = (id) => box[id].x + Math.round(NW / 2), M = (id) => box[id].y + NH / 2
  const third = (id, k) => box[id].x + Math.round((NW * k) / 3)
  const edges = MAP_EDGES.map((e) => {
    const f = e.from, t = e.to
    let pts
    switch (e.route) {
      case 'h': pts = [[R(f), M(f)], [L(t) - 2, M(t)]]; break
      case 'down1': pts = [[third(f, 1), B(f)], [third(f, 1), T(t) - 2]]; break
      case 'down': pts = [[C(f), B(f)], [C(f), T(t) - 2]]; break
      case 'up': pts = [[C(f), T(f)], [C(f), B(t) + 2]]; break
      case 'up1': pts = [[third(f, 1), T(f)], [third(f, 1), B(t) + 2]]; break
      case 'up2': pts = [[third(f, 2), T(f)], [third(f, 2), B(t) + 2]]; break
      case 'upChannel': { const y = laneTop(box[f].r); pts = [[third(f, 2), T(f)], [third(f, 2), y], [C(t) + 14, y], [C(t) + 14, B(t) + 2]]; break }
      case 'hDown': pts = [[R(f), M(f)], [C(t), M(f)], [C(t), T(t) - 2]]; break
      case 'hDown1': pts = [[R(f), M(f)], [third(t, 1), M(f)], [third(t, 1), T(t) - 2]]; break
      case 'hUp': pts = [[R(f), M(f)], [C(t), M(f)], [C(t), B(t) + 2]]; break
      default: pts = [[C(f), M(f)], [C(t), M(t)]]
    }
    // 이름표 자리 — 가장 긴 구간 위. 세로 줄이면 부서 줄 경계(칸이 없는 곳)에 선을 가운데로 얹는다
    let lab = null
    if (e.label) {
      let best = null
      for (let k = 0; k < pts.length - 1; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[k + 1]
        const len = Math.abs(y2 - y1) + Math.abs(x2 - x1)
        if (!best || len > best.len) best = { x1, y1, x2, y2, len, v: x1 === x2 }
      }
      if (best.v) {
        const lo = Math.min(best.y1, best.y2), hi = Math.max(best.y1, best.y2), mid = (lo + hi) / 2
        const bounds = MAP_DEPTS.map((_, r) => laneTop(r)).filter((y) => y > lo + 4 && y < hi - 4)
        const y = bounds.length ? bounds.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : Math.round(mid)
        lab = { x: best.x1, y: y - 7, center: true }
      } else lab = { x: Math.round((best.x1 + best.x2) / 2), y: best.y1 - 16, center: true }
    }
    return { ...e, pts, lab }
  })
  return { W, H, LABEL, SUB, SUBX: W - SUB, SP, NW, NH, LH, TOP, colX, laneTop, box, edges }
}

// 선이 다른 칸을 지나가는가 (출발 · 도착 칸 제외) — 테스트용
export function edgeCrossings(geo) {
  const bad = []
  geo.edges.forEach((e) => {
    for (let k = 0; k < e.pts.length - 1; k++) {
      const [x1, y1] = e.pts[k], [x2, y2] = e.pts[k + 1]
      Object.entries(geo.box).forEach(([id, b]) => {
        if (id === e.from || id === e.to) return
        const inX = (x) => x > b.x && x < b.x + b.w, inY = (y) => y > b.y && y < b.y + b.h
        if (y1 === y2 && inY(y1) && Math.max(Math.min(x1, x2), b.x) < Math.min(Math.max(x1, x2), b.x + b.w)) bad.push([e.id, id])
        if (x1 === x2 && inX(x1) && Math.max(Math.min(y1, y2), b.y) < Math.min(Math.max(y1, y2), b.y + b.h)) bad.push([e.id, id])
      })
    }
  })
  return bad
}
