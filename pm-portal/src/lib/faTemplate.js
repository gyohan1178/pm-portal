// 초도품(FA) 진행관리 — 체크리스트 틀
//
//   「FA PD 5종 Project Stages」 엑셀을 옮겼다. 전장 BOX(PD) 가 기준이고,
//   ASSY · 하네스 · 단품(구매품)은 해당 없는 항목을 뺀 것이다.
//   더 뺄 것이 있으면 건마다 「해당없음」으로 두면 된다 (진척도 계산에서 빠진다).
//
//   단계(큰 흐름)   준비 → 자재 → 제작 → 품질 → 고객사
//   항목 값        { s: ''|'doing'|'done'|'na', p: 0~100(진척률 항목), d: 날짜, m: 메모, by, at }

export const FA_TYPES = [
  { key: 'PD', label: '전장 BOX' },
  { key: 'ASSY', label: 'ASSY' },
  { key: 'HARNESS', label: '하네스' },
  { key: 'PART', label: '단품' },
]
export const faTypeLabel = (t) => FA_TYPES.find((x) => x.key === t)?.label || t || '-'

export const FA_STAGES = [
  { key: 'prep', label: '준비' },
  { key: 'mat', label: '자재' },
  { key: 'make', label: '제작' },
  { key: 'qc', label: '품질' },
  { key: 'cust', label: '고객사' },
]

const ALL = ['PD', 'ASSY', 'HARNESS', 'PART']
const MADE = ['PD', 'ASSY', 'HARNESS']

// kind: 'check' (완료/미완료) · 'pct' (진척률 %)
export const FA_STEPS = [
  // 준비 — 엑셀 「공통 · 준비」
  { k: 'dwg', st: 'prep', l: 'ASSY · 하네스 도면', lt: { ASSY: 'ASSY 도면', HARNESS: '하네스 도면' }, t: MADE },
  { k: 'circuit', st: 'prep', l: '회로도', t: ['PD'] },
  { k: 'bom', st: 'prep', l: 'BOM', t: MADE },
  { k: 'runsheet', st: 'prep', l: 'RUN SHEET', t: ['PD'] },

  // 자재 — 엑셀 「영업 · 자재 수급」 + 불출
  { k: 'mat_cable', st: 'mat', l: '자재 수급 — CABLE', lt: { HARNESS: '자재 수급' }, kind: 'pct', t: ['PD', 'HARNESS'] },
  { k: 'mat_parts', st: 'mat', l: '자재 수급 — PARTS', lt: { ASSY: '자재 수급' }, kind: 'pct', t: ['PD', 'ASSY'] },
  { k: 'mat_buy', st: 'mat', l: '발주 · 입고', t: ['PART'] },
  { k: 'issue', st: 'mat', l: '자재 불출', t: MADE },

  // 제작 — 엑셀 「전장 · 기능검사 JIG / PD 조립」 + 「하네스 · Cable 제작」
  { k: 'jig_dwg', st: 'make', l: '기능검사 JIG — 도면', t: ['PD'] },
  { k: 'jig_mat', st: 'make', l: '기능검사 JIG — 자재', t: ['PD'] },
  { k: 'jig_mch', st: 'make', l: '기능검사 JIG — 가공물 입고', t: ['PD'] },
  { k: 'jig_make', st: 'make', l: '기능검사 JIG — 제작', t: ['PD'] },
  { k: 'base_jig', st: 'make', l: 'BASE 판 JIG', t: ['PD'] },
  { k: 'make_start', st: 'make', l: '제작 착수', t: MADE },
  { k: 'cable_ac', st: 'make', l: 'Cable 제작 — AC', kind: 'pct', t: ['PD'] },
  { k: 'cable_dc', st: 'make', l: 'Cable 제작 — DC', kind: 'pct', t: ['PD'] },
  { k: 'cable_single', st: 'make', l: 'Cable 제작 — 단품', kind: 'pct', t: ['PD'] },
  { k: 'cable', st: 'make', l: '케이블 제작', kind: 'pct', t: ['HARNESS'] },
  { k: 'assy', st: 'make', l: 'PD 조립 / 자주검사', lt: { ASSY: 'ASSY 조립 / 자주검사' }, t: ['PD', 'ASSY'] },

  // 품질 — 엑셀 「품질 · Mill Sheet / 출하검사 / 토크 / 가공물 / 배치도」
  { k: 'handover', st: 'qc', l: '품질팀 인계', t: ALL },
  { k: 'rpt_assy', st: 'qc', l: 'ASSY 성적서', kind: 'pct', t: ['PD', 'ASSY'] },
  { k: 'rpt_ac', st: 'qc', l: '하네스 성적서 — AC 케이블', t: ['PD'] },
  { k: 'rpt_dc', st: 'qc', l: '하네스 성적서 — DC 케이블', t: ['PD'] },
  { k: 'rpt_single', st: 'qc', l: '하네스 성적서 — 단품 케이블', t: ['PD'] },
  { k: 'rpt_harn', st: 'qc', l: '하네스 성적서 (Mill Sheet)', t: ['HARNESS'] },
  { k: 'rpt_part', st: 'qc', l: '성적서 · Mill Sheet', t: ['PART'] },
  { k: 'rpt_ship', st: 'qc', l: '출하검사 성적서', t: ['PD', 'ASSY'] },
  { k: 'torque', st: 'qc', l: '토크 기준서', t: ['PD'] },
  { k: 'rpt_mch', st: 'qc', l: '가공물 성적서', t: ['PD', 'ASSY'] },
  { k: 'pinmap', st: 'qc', l: '배치도 (PIN MAP)', t: ['PD'] },

  // 고객사
  { k: 'submit', st: 'cust', l: '고객사 제출', t: ALL },
  { k: 'cust_check', st: 'cust', l: '고객사 검수', t: ['PD', 'ASSY'] },
  { k: 'approve', st: 'cust', l: '고객사 승인 (FINAL)', t: ALL },
]

export const stepLabel = (step, type) => step.lt?.[type] || step.l
export const stepsOf = (type) => FA_STEPS.filter((s) => s.t.includes(type || 'PD'))

// 항목 하나의 상태 — 진척률 항목은 % 로 정한다 (100 = 완료, 1~99 = 진행)
export function stepState(step, v) {
  if (!v) return ''
  if (v.s === 'na') return 'na'
  if (step.kind === 'pct') {
    const p = Number(v.p) || 0
    if (p >= 100 || v.s === 'done') return 'done'
    return p > 0 || v.s === 'doing' ? 'doing' : ''
  }
  return v.s || ''
}

// 진척도 — 해당없음은 빼고, 완료 1 · 진척률 항목은 % 만큼 · 진행중 0
export function faProgress(fa) {
  const steps = stepsOf(fa.fa_type)
  const vals = fa.steps || {}
  let total = 0, got = 0
  for (const s of steps) {
    const st = stepState(s, vals[s.k])
    if (st === 'na') continue
    total++
    if (st === 'done') got += 1
    else if (s.kind === 'pct') got += Math.min(Number(vals[s.k]?.p) || 0, 100) / 100
  }
  return total ? Math.round((got / total) * 100) : 0
}

// 지금 단계 — 안 끝난 항목이 남아 있는 첫 단계
export function faStage(fa) {
  const vals = fa.steps || {}
  const steps = stepsOf(fa.fa_type)
  if (stepState({}, vals.approve) === 'done') return { key: 'done', label: '승인 완료', idx: FA_STAGES.length }
  for (let i = 0; i < FA_STAGES.length; i++) {
    const open = steps.filter((s) => s.st === FA_STAGES[i].key && !['done', 'na'].includes(stepState(s, vals[s.k])))
    if (open.length) return { ...FA_STAGES[i], idx: i, open }
  }
  return { key: 'done', label: '승인 완료', idx: FA_STAGES.length }
}

// 단계마다 — 'done' 끝남 · 'cur' 지금 · 'todo' 남음 · 'skip' 해당 항목 없음
export function faStageMarks(fa) {
  const cur = faStage(fa).idx
  const steps = stepsOf(fa.fa_type)
  const vals = fa.steps || {}
  return FA_STAGES.map((g, i) => {
    const mine = steps.filter((s) => s.st === g.key && stepState(s, vals[s.k]) !== 'na')
    if (!mine.length) return { ...g, mark: 'skip' }
    return { ...g, mark: i < cur ? 'done' : i === cur ? 'cur' : 'todo' }
  })
}

export const faApproved = (fa) => faStage(fa).key === 'done'

// ── 목록 붙여넣기 ─────────────────────────────────────────
//   고객사 FA 목록을 엑셀에서 그대로 복사해 붙인다.
//   CCN · Product · Item · SRev · BRev · OrderNumber · Buy UM · Promise Date · Required Date · Item Desc · FA 가능일자 · 비고
//   머리줄이 있으면 이름으로 열을 찾고, 없으면 이 순서로 본다.
const HEAD = [
  ['ccn', /^ccn$/],
  ['product', /^product$|^구분$|^제품/],
  ['item_code', /^item$|^품번|^itemno|^partno/],
  ['srev', /^srev$/],
  ['brev', /^brev$/],
  ['po_number', /^ordernumber$|^order$|^po|^오더|^발주번호/],
  ['buy_um', /^buyum$|^um$|^단위/],
  ['promise_date', /^promisedate$|^promise|^납기/],
  ['required_date', /^requireddate$|^required|^요청/],
  ['item_desc', /^itemdesc|^desc|^품명/],
  ['fa_ready', /fa가능|가능일/],
  ['note', /^비고|^memo|^note|^remark/],
]
const ORDER = HEAD.map(([k]) => k)
const H = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase()

export function faDate(v) {
  const t = String(v ?? '').trim()
  if (!t) return null
  if (/^\d{5}$/.test(t)) {                       // 엑셀 날짜 일련번호 (46280 = 2026-09-15)
    const n = Number(t)
    if (n > 30000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400000))
      return d.toISOString().slice(0, 10)
    }
  }
  const m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

// Product 칸 → 체크리스트 종류. 비었거나 모르는 말이면 품번 앞자리로 짐작한다.
export function faTypeOf(product, code) {
  const p = String(product || '').trim().toUpperCase()
  if (p === 'PD') return 'PD'
  if (p === 'ASSY') return 'ASSY'
  if (p === 'HARNESS' || p === 'CABLE' || p === 'KIT') return 'HARNESS'
  if (p === 'PART') return 'PART'
  const c = String(code || '')
  if (/^11/.test(c)) return 'ASSY'
  if (/^1[06]/.test(c)) return 'HARNESS'
  return 'PART'
}

export function parseFaPaste(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], bad: [] }
  const cells = lines.map((l) => l.split('\t').map((x) => x.trim()))
  const first = cells[0].map(H)
  const hasHead = first.some((h) => h === 'item' || h === 'ordernumber' || h === 'ccn' || /fa가능/.test(h))
  let col
  if (hasHead) {
    col = {}
    first.forEach((h, i) => {
      const hit = HEAD.find(([k, re]) => col[k] === undefined && re.test(h))
      if (hit) col[hit[0]] = i
    })
  } else {
    col = Object.fromEntries(ORDER.map((k, i) => [k, i]))
  }
  const body = hasHead ? cells.slice(1) : cells
  const rows = [], bad = []
  const seen = new Set()
  body.forEach((c, i) => {
    const g = (k) => (col[k] === undefined ? '' : (c[col[k]] ?? '').trim())
    const line = i + 1 + (hasHead ? 1 : 0)
    const item_code = g('item_code').replace(/\.0$/, '').replace(/^AX-/i, '')
    const po_number = g('po_number')
    if (!item_code && !po_number) return
    if (!item_code || !po_number) { bad.push(`${line}줄 — 품번 또는 Order Number 가 비었습니다`); return }
    const key = `${po_number}|${item_code}`
    if (seen.has(key)) { bad.push(`${line}줄 ${item_code} — 같은 PO·품번이 위에 또 있어 뺐습니다`); return }
    seen.add(key)
    const ready = g('fa_ready')
    rows.push({
      line,
      ccn: g('ccn') || null,
      product: g('product') || null,
      fa_type: faTypeOf(g('product'), item_code),
      item_code,
      srev: g('srev') || null,
      brev: g('brev') || null,
      po_number,
      buy_um: g('buy_um') || null,
      promise_date: faDate(g('promise_date')),
      required_date: faDate(g('required_date')),
      item_desc: g('item_desc') || null,
      fa_ready_date: faDate(ready),
      fa_ready_text: ready && !faDate(ready) ? ready : null,   // 「제작 중 (내부 협의)」 같은 글
      note: g('note') || null,
    })
  })
  return { rows, bad }
}

// 칸 하나를 사람이 읽는 말로 — 진척표·엑셀에 쓴다
export function stepText(step, v) {
  const st = stepState(step, v)
  if (st === 'na') return '해당없음'
  const d = v?.d ? String(v.d).slice(5).replace('-', '/') : ''
  if (step.kind === 'pct' && st !== 'done') return v?.p ? `${v.p}%` : ''
  if (st === 'done') return d ? `완료 ${d}` : '완료'
  if (st === 'doing') return d ? `진행 (~${d})` : '진행'
  return ''
}
