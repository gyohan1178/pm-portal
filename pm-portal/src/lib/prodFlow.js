// PD 공정 흐름 — 생산 전광판 · QR 공정 데모가 같이 쓰는 기준
//
//   생산관리(production)의 체크칸으로 호기가 지금 어느 칸에 있는지 정한다.
//     가공물 대기  가공물 입고(machine_recv) 전
//     자재 대기    가공물은 왔는데 하네스(harness_recv) · 파트(part_issue) 불출이 덜 됨
//     전장 작업    불출 끝 · 전장 완료(elec_recv) 전
//     품질 검수    전장 완료 · 품질(quality_recv) 전
//     출하 대기    품질 끝
//   QR 스캔이 붙으면 스캔이 이 체크칸을 켜므로 기준은 그대로다.
//
//   Rev — BREV = PO 발행 시점 Rev (제작은 최소 BREV), SREV(production.rev) = 지금 고객사 Rev.
//     둘이 다르면 「도면 Rev 확인」 — 빨강으로 보인다.

export const truthy = (v) => v === true || (typeof v === 'string' && !!v.trim() && v !== 'false')
export const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')

export const LANES = [
  { k: 'mch', l: '가공물 대기', sub: '가공물 입고 전', line: '#8A99B3' },
  { k: 'mat', l: '자재 대기', sub: '하네스 · 파트 불출 전', line: '#C9A2FF' },
  { k: 'elec', l: '전장 작업', sub: '조립 · 배선', line: '#7CC4FF' },
  { k: 'qc', l: '품질 검수', sub: '전장 완료 · 검사', line: '#FFB547' },
  { k: 'ship', l: '출하 대기', sub: '검수 끝 · 포장 · 출하', line: '#4FD6A1' },
]

export function laneOf(r) {
  if (truthy(r.quality_recv)) return 'ship'
  if (truthy(r.elec_recv)) return 'qc'
  if (!truthy(r.machine_recv)) return 'mch'
  if (!truthy(r.harness_recv) || !truthy(r.part_issue)) return 'mat'
  return 'elec'
}

const U = (x) => String(x || '').trim().toUpperCase()
export function revInfo(r) {
  const b = U(r.brev), s = U(r.rev)
  const diff = !!(b && s && b !== s)
  return { b, s, diff, text: diff ? `Rev ${b}→${s}` : `Rev ${b || s || '-'}` }
}

// 결품 — 생산관리 호기 편집에서 적은 미불출 파트 [{ pn, name, qty, date(입고 예정) }]
export const missingOf = (r) => (Array.isArray(r.missing_parts) ? r.missing_parts.filter((m) => m && (m.pn || m.name)) : [])

// 카드 셋째 줄 — 지금 막힌 이유. tone: red | green | ''
export function whyOf(r, lane, today) {
  const ms = missingOf(r)
  const miss = () => {
    const first = ms[0]
    const eta = ms.map((m) => m.date).filter(Boolean).sort()
    const etaText = eta.length < ms.length ? '입고 미정' : `${md(eta[eta.length - 1])} 입고`
    return { t: `결품 ${ms.length} · ${first.name || first.pn}${ms.length > 1 ? ' 외' : ''} · ${etaText}`, tone: 'red' }
  }
  if (lane === 'mch') {
    const a = r.arrival_date ? String(r.arrival_date).slice(0, 10) : ''
    if (!a) return { t: '가공물 입고일 미입력', tone: 'red' }
    if (a < today) return { t: `가공물 입고 예정 ${md(a)} 지남`, tone: 'red' }
    return { t: `가공물 입고 예정 ${md(a)}`, tone: '' }
  }
  if (lane === 'mat') {
    if (ms.length) return miss()
    const h = truthy(r.harness_recv), p = truthy(r.part_issue)
    return { t: !h && !p ? '하네스 · 파트 불출 대기' : !h ? '하네스 불출 대기' : '파트 불출 대기', tone: '' }
  }
  if (lane === 'elec') {
    if (ms.length) return miss()
    const rv = revInfo(r)
    if (rv.diff) return { t: `도면 Rev 확인 — BREV ${rv.b} · SREV ${rv.s}`, tone: 'red' }
    return { t: '자재 불출 완료', tone: '' }
  }
  if (lane === 'qc') return { t: '검수 대기', tone: '' }
  return { t: '검수 완료 · 출하 대기', tone: 'green' }
}

// ── QR 공정 (데모) ──
//   셀 방식 — 한 사람이 한 호기를 맡는다. 폰으로 작업지시서 QR 을 찍으면 그 호기의 다음 공정이 뜬다.
//   전장만 시작 · 완료 둘 다, 나머지는 완료만. 포장 · 출하는 따로.
export const QR_STEPS = [
  { k: 'mch', l: '가공물 입고', field: 'machine_recv' },
  { k: 'harness', l: '하네스 불출', field: 'harness_recv' },
  { k: 'part', l: '파트 불출', field: 'part_issue' },
  { k: 'elec_start', l: '전장 시작' },
  { k: 'elec', l: '전장 완료', field: 'elec_recv' },
  { k: 'qc', l: '품질 검수', field: 'quality_recv' },
  { k: 'pack', l: '포장' },
  { k: 'ship', l: '출하' },
]

// 생산관리 체크칸으로 이미 끝난 공정 (전장 완료면 전장 시작도 끝난 것)
export function doneFromRow(r) {
  const s = new Set()
  QR_STEPS.forEach((x) => { if (x.field && truthy(r[x.field])) s.add(x.k) })
  if (s.has('elec')) s.add('elec_start')
  if (r.shipped_date) { s.add('pack'); s.add('ship') }
  return s
}

// 다음 공정 — 끝나지 않은 첫 공정. 하네스 · 파트 불출은 순서가 바뀌어도 된다.
export function nextStep(done) {
  return QR_STEPS.find((x) => !done.has(x.k)) || null
}

// QR 내용 — 짧게 (작은 라벨에서도 읽히게): PD|<생산관리 id>|<출력 당시 BREV>
export const qrText = (r) => `PD|${r.id}|${U(r.brev) || '-'}`
export function parseQr(text) {
  const m = String(text || '').trim().match(/^PD\|([^|]+)\|([^|]*)$/i)
  return m ? { id: m[1], rev: m[2] === '-' ? '' : U(m[2]) } : null
}

// 스캔했을 때 Rev 확인 — 작업지시서가 옛 Rev 로 나왔는지 · 도면 Rev 가 바뀌었는지
export function scanRevCheck(r, qrRev) {
  const rv = revInfo(r)
  const out = []
  if (qrRev && rv.b && qrRev !== rv.b) out.push({ tone: 'red', t: `작업지시서 재출력 — 출력 때 Rev ${qrRev}, 지금 PO BREV ${rv.b}` })
  if (rv.diff) out.push({ tone: 'red', t: `도면 Rev 확인 — BREV ${rv.b} 까지 맞추고, 지금 SREV ${rv.s} 변경점 확인` })
  return out
}
