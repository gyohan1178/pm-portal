// 초도품(FA) 진행관리 — 틀
//
//   큰 흐름은 「단계 게이트」 9개다. 단계마다 담당 부서 · 예정일 · 실적일을 둔다.
//     PO 접수 → 자재 입고 → 자재 불출 → 제작 착수 → 제작 완료 → 품질 인계 → 성적서 작성 → 고객사 제출 → 고객사 승인
//   실적일을 넣으면 그 단계는 끝난 것 — 카드가 다음 칸으로 넘어간다.
//
//   품질이 챙기는 세부 항목(도면 · JIG · 케이블 · 성적서 …)은 각 단계 안의 하위 항목이다.
//   「FA PD 5종 Project Stages」 엑셀에서 가져왔고, 전장 BOX 가 기준이다.
//   ASSY · 하네스 · 단품은 해당 없는 단계 · 항목이 빠진다. 더 뺄 것은 건마다 「해당없음」.
//
//   저장 (pm_fa.steps JSON 한 칸)
//     단계     g_xxx : { p: 예정일, d: 실적일, m: 메모, by, at }
//     하위항목  xxx   : { s: ''|'doing'|'done'|'na', p: 0~100(진척률 항목), d: 날짜, m: 메모, by, at }

export const FA_TYPES = [
  { key: 'PD', label: '전장 BOX' },
  { key: 'ASSY', label: 'ASSY' },
  { key: 'HARNESS', label: '하네스' },
  { key: 'PART', label: '단품' },
]
export const faTypeLabel = (t) => FA_TYPES.find((x) => x.key === t)?.label || t || '-'
// 구분 색 — 카드 · 목록 · 상세에서 한눈에 (문의 빨강 · 보류 회색과 겹치지 않게)
export const FA_TYPE_TONE = {
  PD: { badge: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
  ASSY: { badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  HARNESS: { badge: 'bg-amber-100 text-amber-900', dot: 'bg-amber-500' },
  PART: { badge: 'bg-fuchsia-100 text-fuchsia-800', dot: 'bg-fuchsia-500' },
}
export const faTypeTone = (t) => FA_TYPE_TONE[t] || { badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' }

const ALL = ['PD', 'ASSY', 'HARNESS', 'PART']
const MADE = ['PD', 'ASSY', 'HARNESS']

// 단계 게이트 — 담당은 기본값 (화면에서 바꿀 수 있게 하려면 여기만 고치면 된다)
export const FA_GATES = [
  { k: 'g_po', l: 'PO 접수', owner: '영업', t: ALL },
  { k: 'g_mat_in', l: '자재 입고', owner: '구매자재', t: ALL },
  { k: 'g_issue', l: '자재 불출', owner: '구매자재', t: MADE },
  { k: 'g_make_start', l: '제작 착수', owner: '생산', t: MADE },
  { k: 'g_make_done', l: '제작 완료', owner: '생산', t: MADE },
  { k: 'g_handover', l: '품질 인계', owner: '생산 → 품질', t: ALL },
  { k: 'g_report', l: '성적서 작성', owner: '품질', t: ALL },
  { k: 'g_submit', l: '고객사 제출', owner: '품질 · 영업', t: ALL },
  { k: 'g_approve', l: '고객사 승인', owner: '영업', t: ALL },
]
export const gatesOf = (type) => FA_GATES.filter((g) => g.t.includes(type || 'PD'))

// 하위 항목 — g: 어느 단계 안에 있나 · kind: 'check' | 'pct'
export const FA_STEPS = [
  // PO 접수 — 준비 서류
  { k: 'dwg', g: 'g_po', l: 'ASSY · 하네스 도면', lt: { ASSY: 'ASSY 도면', HARNESS: '하네스 도면' }, t: MADE },
  { k: 'circuit', g: 'g_po', l: '회로도', t: ['PD'] },
  { k: 'bom', g: 'g_po', l: 'BOM', t: MADE },
  { k: 'runsheet', g: 'g_po', l: 'RUN SHEET', t: ['PD'] },

  // 자재 입고 — 수급률
  { k: 'mat_cable', g: 'g_mat_in', l: '자재 수급 — CABLE', lt: { HARNESS: '자재 수급' }, kind: 'pct', t: ['PD', 'HARNESS'] },
  { k: 'mat_parts', g: 'g_mat_in', l: '자재 수급 — PARTS', lt: { ASSY: '자재 수급' }, kind: 'pct', t: ['PD', 'ASSY'] },

  // 제작 착수 — 기능검사 JIG
  { k: 'jig_dwg', g: 'g_make_start', l: '기능검사 JIG — 도면', t: ['PD'] },
  { k: 'jig_mat', g: 'g_make_start', l: '기능검사 JIG — 자재', t: ['PD'] },
  { k: 'jig_mch', g: 'g_make_start', l: '기능검사 JIG — 가공물 입고', t: ['PD'] },
  { k: 'jig_make', g: 'g_make_start', l: '기능검사 JIG — 제작', t: ['PD'] },
  { k: 'base_jig', g: 'g_make_start', l: 'BASE 판 JIG', t: ['PD'] },

  // 제작 완료 — 케이블 · 조립
  { k: 'cable_ac', g: 'g_make_done', l: 'Cable 제작 — AC', kind: 'pct', t: ['PD'] },
  { k: 'cable_dc', g: 'g_make_done', l: 'Cable 제작 — DC', kind: 'pct', t: ['PD'] },
  { k: 'cable_single', g: 'g_make_done', l: 'Cable 제작 — 단품', kind: 'pct', t: ['PD'] },
  { k: 'cable', g: 'g_make_done', l: '케이블 제작', kind: 'pct', t: ['HARNESS'] },
  { k: 'assy', g: 'g_make_done', l: 'PD 조립 / 자주검사', lt: { ASSY: 'ASSY 조립 / 자주검사' }, t: ['PD', 'ASSY'] },

  // 성적서 작성 — 제출 서류
  //   자재 매칭 = 초도품 자재 매칭(FAI Navigator)에서 Part Report 등록 제조사 vs 실제 구매 대조 → 결과를 여기로 반영
  { k: 'mat_match', g: 'g_report', l: '자재 매칭 (Part Report)', link: 'fai', t: ALL },
  { k: 'rpt_assy', g: 'g_report', l: 'ASSY 성적서', kind: 'pct', t: ['PD', 'ASSY'] },
  { k: 'rpt_ac', g: 'g_report', l: '하네스 성적서 — AC 케이블', t: ['PD'] },
  { k: 'rpt_dc', g: 'g_report', l: '하네스 성적서 — DC 케이블', t: ['PD'] },
  { k: 'rpt_single', g: 'g_report', l: '하네스 성적서 — 단품 케이블', t: ['PD'] },
  { k: 'rpt_harn', g: 'g_report', l: '하네스 성적서 (Mill Sheet)', t: ['HARNESS'] },
  { k: 'rpt_part', g: 'g_report', l: '성적서 · Mill Sheet', t: ['PART'] },
  { k: 'rpt_ship', g: 'g_report', l: '출하검사 성적서', t: ['PD', 'ASSY'] },
  { k: 'torque', g: 'g_report', l: '토크 기준서', t: ['PD'] },
  { k: 'rpt_mch', g: 'g_report', l: '가공물 성적서', t: ['PD', 'ASSY'] },
  { k: 'pinmap', g: 'g_report', l: '배치도 (PIN MAP)', t: ['PD'] },

  // 고객사 제출 — 검수
  { k: 'cust_check', g: 'g_submit', l: '고객사 검수', t: ['PD', 'ASSY'] },
]

export const stepLabel = (step, type) => step.lt?.[type] || step.l
export const stepsOf = (type, gate) => FA_STEPS.filter((s) => s.t.includes(type || 'PD') && (!gate || s.g === gate))

// 하위 항목 하나의 상태 — 진척률 항목은 % 로 정한다 (100 = 완료, 1~99 = 진행)
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

const dnum = (d) => (d ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000 : null)
export const dayDiff = (a, b) => (a && b ? dnum(b) - dnum(a) : null)   // b - a (일)

// 단계 하나 — done(실적 있음) · late(예정 지남) · cur(지금) · todo
export function gateInfo(fa, today) {
  const vals = fa.steps || {}
  const gates = gatesOf(fa.fa_type)
  const cur = gates.findIndex((g) => !vals[g.k]?.d)
  return gates.map((g, i) => {
    const v = vals[g.k] || {}
    const subs = stepsOf(fa.fa_type, g.k).filter((s) => stepState(s, vals[s.k]) !== 'na')
    const subDone = subs.filter((s) => stepState(s, vals[s.k]) === 'done').length
    const done = !!v.d
    const late = !done && v.p && today && v.p < today
    return {
      ...g, v, i, done, late: !!late, cur: i === cur,
      diff: done ? dayDiff(v.p, v.d) : (late ? dayDiff(v.p, today) : null),
      subs: subs.length, subDone,
    }
  })
}

// 지금 단계 — 실적이 안 찍힌 첫 단계
export function faStage(fa) {
  const gates = gatesOf(fa.fa_type)
  const vals = fa.steps || {}
  const i = gates.findIndex((g) => !vals[g.k]?.d)
  if (i < 0) return { k: 'done', l: '승인 완료', owner: '', idx: gates.length }
  return { ...gates[i], idx: i }
}
export const faApproved = (fa) => !!fa.steps?.g_approve?.d

// 진척도 — 끝난 단계 수 / 해당 단계 수
export function faProgress(fa) {
  const gates = gatesOf(fa.fa_type)
  const vals = fa.steps || {}
  return gates.length ? Math.round((gates.filter((g) => vals[g.k]?.d).length / gates.length) * 100) : 0
}

// 예정 대비 — 지금 단계가 예정을 넘겼으면 오늘까지, 아니면 마지막으로 끝난 단계의 차이 (+ 늦음)
export function faDelay(fa, today) {
  const info = gateInfo(fa, today)
  const cur = info.find((g) => g.cur)
  if (cur?.late) return cur.diff
  const last = [...info].reverse().find((g) => g.done && g.v.p)
  return last ? last.diff : null
}

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

// 하위 항목을 사람이 읽는 말로 — 엑셀에 쓴다
export function stepText(step, v) {
  const st = stepState(step, v)
  if (st === 'na') return '해당없음'
  const d = v?.d ? String(v.d).slice(5).replace('-', '/') : ''
  if (step.kind === 'pct' && st !== 'done') return v?.p ? `${v.p}%` : ''
  if (st === 'done') return d ? `완료 ${d}` : '완료'
  if (st === 'doing') return d ? `진행 (~${d})` : '진행'
  return ''
}

// ── 이슈 ──
//   건마다 이슈를 여러 개 — 분류 · 열림/해결 · 이어지는 답변(진행 · 답변 · 해결)
//   pm_fa_log: kind '이슈' = 이슈 한 건 (closed_at 이 비어 있으면 열림), parent_id 가 있는 줄 = 그 이슈의 답변
//   분류 「고객사 문의」가 열려 있으면 = 고객사 답을 기다리는 중 (고객사 제출용 Remarks 기본값)
export const FA_ISSUE_CATS = [
  { k: '고객사 문의', tone: 'bg-rose-100 text-rose-700' },
  { k: '자재', tone: 'bg-amber-100 text-amber-800' },
  { k: '제작', tone: 'bg-indigo-100 text-indigo-700' },
  { k: '품질', tone: 'bg-violet-100 text-violet-700' },
  { k: '기타', tone: 'bg-slate-200 text-slate-700' },
]
export const issueTone = (cat) => (FA_ISSUE_CATS.find((c) => c.k === cat) || FA_ISSUE_CATS[4]).tone
export const CUST_CAT = '고객사 문의'

// 한 건의 기록 → 이슈(답변 붙여서, 열린 것 먼저 · 최근 먼저) + 그 밖의 기록
export function splitFaLogs(logs) {
  const list = logs || []
  const at = (l) => String(l.created_at || '')
  const replies = new Map()
  for (const l of list) if (l.parent_id) {
    if (!replies.has(l.parent_id)) replies.set(l.parent_id, [])
    replies.get(l.parent_id).push(l)
  }
  const issues = list.filter((l) => l.kind === '이슈' && !l.parent_id)
    .map((l) => ({ ...l, open: !l.closed_at, replies: (replies.get(l.id) || []).slice().sort((a, b) => at(a).localeCompare(at(b)) || a.id - b.id) }))
    .sort((a, b) => (b.open - a.open) || at(b).localeCompare(at(a)) || b.id - a.id)
  const notes = list.filter((l) => l.kind !== '이슈' && !l.parent_id)
  return { issues, open: issues.filter((i) => i.open), notes }
}

// 자재 매칭 결과 → 한 줄 (FAI Navigator → 진행관리 세부 항목 메모)
export function matMatchText(r) {
  const parts = [`Rev ${r.rev || '-'}`, `대상 ${r.n}`, `적합 ${r.ok}`, `Generic ${r.gen}`, `확인필요 ${r.chk}`, `이력없음 ${r.none}`]
  return parts.join(' · ')
}
// Part Report Rev 와 SREV · BREV 비교
export function revCheck(rev, fa) {
  const R = String(rev || '').trim().toUpperCase()
  const s = String(fa?.srev || '').trim().toUpperCase()
  const b = String(fa?.brev || '').trim().toUpperCase()
  if (!R) return { ok: null, t: 'Part Report Rev 없음' }
  if (R === s && R === b) return { ok: true, t: `Rev ${R} — SREV · BREV 와 같음` }
  if (R === s) return { ok: true, t: `Rev ${R} — SREV 와 같음 (BREV ${b || '-'})` }
  if (R === b) return { ok: true, t: `Rev ${R} — BREV 와 같음 (SREV ${s || '-'})` }
  return { ok: false, t: `Rev ${R} — SREV ${s || '-'} · BREV ${b || '-'} 와 다름` }
}

// Rev 바뀐 것 — 전에도 값이 있었고 새 값도 있을 때만 (빈 칸은 안 바꾼 것으로 본다)
//   BREV = PO 발행 시점 Rev (제작은 최소 BREV 까지) · SREV = 지금 고객사 Rev (바뀔 수 있다)
export function revDiff(old, next) {
  const S = (x) => String(x || '').trim().toUpperCase()
  const out = []
  // 비어 있던 칸을 처음 채우는 것은 「변경」이 아니다
  if (S(old?.srev) && S(next?.srev) && S(next.srev) !== S(old.srev)) out.push(`SREV ${old.srev} → ${next.srev}`)
  if (S(old?.brev) && S(next?.brev) && S(next.brev) !== S(old.brev)) out.push(`BREV ${old.brev} → ${next.brev}`)
  return out
}
