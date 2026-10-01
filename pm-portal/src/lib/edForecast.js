// Edwards 포캐스트 → 생산관리 (호기별 자재 준비)
//
//   작업자가 따로 쓰던 「Forecast 자재 준비 현황」 HTML 을 생산관리 Edwards 화면으로 옮긴 것.
//   그 도구는 브라우저(localStorage)에만 저장해 다른 PC 에서 볼 수 없었다.
//
//   포캐스트 한 줄 = System Tag 하나 (예: 'Gen2 Plus_Hynix #30')
//   생산관리 한 줄 = 프로젝트 + 호기 + 구분 (EUV · H2D · MFM · BDM …)
//   → 프로젝트 이름(정리한 것) + 호기 번호로 잇는다.
//
//   ⚠ 포캐스트를 다시 올려도 사람이 넣은 값은 건드리지 않는다.
//     포캐스트는 fc_* 칸에만 쓴다. 확정 납기(due_fix) · 발주서 체크 · 불출 · 미불출 · 비고 · 담당자는 그대로.

import * as XLSX from 'xlsx'
import { projOf } from './edMonthly'

// ── 구분 ─────────────────────────────────────────────────────────────
//   작업자 도구의 세 갈래를 그대로 쓴다.
export const KINDS = ['EUV', 'H2D-LH', 'H2D-HPD']

// 생산관리 줄의 구분1·2·3 으로 어느 갈래인지 가른다.
//   구분1 이 MFM · BDM · 단품 이면 자재 준비 대상이 아니다 (작업자 도구에도 없었다).
//   구분2·3 이 뒤섞여 있다 — 'EUV / H2D HP / H2D HPD' 는 실제로 H2D-HPD 다.
export function kindOf(r) {
  const p1 = String(r?.part || '').trim().toUpperCase()
  if (!p1 || ['MFM', 'BDM', '단품'].includes(p1)) return null
  const all = [r.part, r.part2, r.part3].map(v => String(v || '').toUpperCase()).join(' ')
  if (all.includes('H2D')) return all.includes('HP') ? 'H2D-HPD' : 'H2D-LH'
  return 'EUV'
}

// ── 설정 (pm_settings 'ed_fc_rules') ────────────────────────────────
//   weeks: 정한 납기보다 몇 주 먼저 불출하나 (작업자 도구 기본값)
//   map  : 포캐스트 품번(Item number) → 이 장비에 들어가는 갈래
export const DEFAULT_RULES = {
  weeks: {
    'EUV':     { elec: 0, harn: 4 },
    'H2D-LH':  { elec: 3, harn: 4 },
    'H2D-HPD': { elec: 3, harn: 4 },
  },
  map: {
    'NKB973000': ['EUV', 'H2D-LH'],
    'NKB943000': ['EUV', 'H2D-LH'],
    'NKB983000': ['EUV'],
    'NKB953000': ['EUV'],
    'IECE04110204000': ['H2D-HPD'],
    'IEDE03110224200': ['H2D-HPD'],
    'IEDF03110224200': ['H2D-HPD'],
    'PSEUDO_46966':    ['H2D-HPD'],
    'IEC2I1772010':    ['H2D-HPD'],
    'IEDE031102C6300': ['H2D-HPD'],
    // 2026-09-30 작업자 도구 「Item Number별 BOM 구성」 기준으로 추가
    'IEB2I0872070':    ['H2D-HPD'],
    'IEDI03121224000': ['H2D-HPD'],
    'IEB2H1782010':    ['H2D-HPD'],
    'IECL03121740000': ['H2D-LH'],
    'IECL03111740000': ['H2D-LH'],
    'IECG03120745001': ['H2D-LH'],
    'IECJ03120745001': ['H2D-LH'],
    'NRYBVU000A': [],   // 미확인 (Halo) — 자재 준비 대상 아님
  },
}
export function mergeRules(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  const weeks = {}
  for (const k of KINDS) {
    const d = DEFAULT_RULES.weeks[k], v = (s.weeks || {})[k] || {}
    const num = (x, dflt) => (Number.isFinite(Number(x)) && x !== '' && x !== null ? Number(x) : dflt)
    weeks[k] = { elec: num(v.elec, d.elec), harn: num(v.harn, d.harn) }
  }
  const map = { ...DEFAULT_RULES.map, ...(s.map || {}) }
  // bom: '구분|NKB기종|harn·elec' → BOM 프로젝트 코드 (소요량 매칭 · lib/edNeed.js). 없으면 이름으로 짐작
  const bom = { ...(s.bom || {}) }
  return { weeks, map, bom }
}

// ── 날짜 ─────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
function okYmd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? `${y}-${pad(m)}-${pad(d)}` : null
}
// 포캐스트 칸은 대부분 글자('7/2/2026')다. 날짜 · 엑셀 숫자도 받는다.
//   '2027-02-30' 같은 없는 날 · '10/6 & 10/14' · '-' 는 빈 값으로 본다.
export function pD(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    if (isNaN(v)) return null
    const wall = v.getTime() - v.getTimezoneOffset() * 60000
    return new Date(Math.round(wall / 86400000) * 86400000).toISOString().slice(0, 10)
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  }
  const t = String(v).trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t)
  if (m) return okYmd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return okYmd(+m[1], +m[2], +m[3])
  return null
}
export function addDays(ymd, n) {
  if (!ymd) return null
  const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z')
  if (isNaN(d)) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── 파일 읽기 ─────────────────────────────────────────────────────────
//   작업자 도구(procFc)와 같은 규칙:
//     머리글 = 'Remark' 나 'System Tag' 가 있는 첫 줄, 값은 그 아래부터
//     to 정한 · Frame 입고 · H2D 자재 · Build start
//   ⚠ 아래쪽 몇 줄은 'Order date' 빈칸이 빠져 한 칸씩 왼쪽으로 밀려 있다 (2026-09-16 파일 18줄).
//     Order date 자리에 날짜가 있고 12칸 뒤가 날짜가 아니면 밀린 줄로 보고 한 칸 당겨 읽는다.
export function parseEdForecastDetail(input) {
  const wb = input?.SheetNames ? input : XLSX.read(input, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
  const hi = grid.findIndex(r => Array.isArray(r) && r.some(c => c === 'Remark' || c === 'System Tag'))
  if (hi < 0) return { rows: [], error: "머리글('Remark' · 'System Tag')을 찾을 수 없습니다" }
  const h = grid[hi].map(c => String(c ?? '').trim())
  const ci = (n) => h.findIndex(c => c.includes(n))
  const cR = ci('Remark'), cS = ci('System Tag'), cI = ci('Item number'), cSt = ci('Build status')
  const cO = ci('Order date'), cTo = ci('to 정한'), cFr = ci('Frame 입고'), cH = ci('H2D 자재'), cBS = ci('Build start')
  if (cS < 0 || cTo < 0) return { rows: [], error: "'System Tag' · 'to 정한' 열을 찾을 수 없습니다" }

  const upd = grid.find(r => Array.isArray(r) && String(r[0] ?? '').trim() === 'Updated')
  const updated = upd ? pD(upd[1]) : null

  const rows = [], bad = []
  let shifted = 0
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i]
    if (!Array.isArray(r)) continue
    const tag = String(r[cS] ?? '').trim()
    if (!tag) continue
    const m = /#\s*(\d+)\s*$/.exec(tag)
    if (!m) { bad.push(tag); continue }
    // 밀린 줄 — Order date 칸부터 뒤가 한 칸씩 당겨져 있다
    const sh = cO >= 0 && pD(r[cO]) && !pD(r[cO + 12]) ? 1 : 0
    if (sh) shifted++
    const at = (c) => (c < 0 ? null : r[c > cO && cO >= 0 ? c - sh : c])
    const to = pD(at(cTo)), frame = pD(at(cFr)), h2d = pD(at(cH)), build = pD(at(cBS))
    rows.push({
      remark: String(r[cR] ?? '').trim(),
      tag,
      proj: projOf(tag),
      hogiNo: +m[1],
      item: String(r[cI] ?? '').replace(/\.0$/, '').trim(),
      status: cSt >= 0 ? String(r[cSt] ?? '').trim() : '',
      to, frame, h2d, build,
    })
  }
  return { rows, updated, shifted, bad }
}

// ── 정한 납기 · 불출 예정 ───────────────────────────────────────────
//   작업자 도구와 같은 규칙
//     EUV   : to 정한 (없으면 Build start − 3주)
//     H2D   : H2D 자재 (없으면 Frame − 1주, Frame 은 확정값 먼저) · 둘 다 없으면 to 정한
//     확정 납기(due_fix)를 넣었으면 그것이 먼저
//   MFM · BDM · 단품 줄은 자재 준비 대상이 아니라 비워 둔다.
export function fcDueOf(r) {
  const k = kindOf(r)
  if (!k) return null
  if (k === 'EUV') return r.fc_to || (r.fc_build ? addDays(r.fc_build, -21) : null)
  const frame = r.arrival_date || r.fc_frame
  return r.fc_h2d || (frame ? addDays(String(frame).slice(0, 10), -7) : null) || r.fc_to || null
}
export function dueOf(r) {
  const fc = fcDueOf(r)
  if (r.due_fix) return { date: String(r.due_fix).slice(0, 10), fixed: true, fc }
  return fc ? { date: fc, fixed: false, fc } : null
}
// which: 'harn' 하네스 · 'elec' 전장
// 불출 예정일의 기준 날짜 — 정한 납기(확정 · 포캐스트), 없으면 화면에 대신 보이는 납품요청일
//   (2026-10-01) 불출 기준만 정해져 있으면 정한 납기 칸에 보이는 날짜로 늘 역산되게 한다.
export function issueBaseOf(r) {
  const d = dueOf(r)
  if (d) return { date: d.date, src: d.fixed ? '확정 납기' : '포캐스트 정한 납기' }
  return r.req_date ? { date: String(r.req_date).slice(0, 10), src: '납품요청일 (포캐스트 날짜 없음)' } : null
}
export function issueDueOf(r, rules, which) {
  const k = kindOf(r)
  const b = issueBaseOf(r)
  if (!k || !b) return null
  const w = Number(rules?.weeks?.[k]?.[which]) || 0
  return addDays(b.date, -7 * w)
}

// ── 생산관리 반영 계획 ───────────────────────────────────────────────
export const normProj = (s) => projOf(s).toLowerCase().replace(/\s+/g, '')
const hogiNo = (h) => { const m = /(\d+)/.exec(String(h || '')); return m ? +m[1] : null }

// 새로 만드는 줄의 구분1·2·3 — 월간 실적이 넣는 모양에 맞춘다
function partsFor(kind, item) {
  const nkb = /^NKB\d{3}/.test(item) ? item.slice(0, 6) : null
  if (kind === 'EUV') return { part: 'EUV', part2: null, part3: nkb }
  if (kind === 'H2D-LH') return { part: 'H2D', part2: 'H2D LH', part3: nkb }
  return { part: 'H2D', part2: 'H2D HP', part3: 'H2D HPD' }
}

const FC_KEYS = ['fc_tag', 'fc_item', 'fc_remark', 'fc_status', 'fc_to', 'fc_frame', 'fc_h2d', 'fc_build']
const fcFields = (f) => ({
  fc_tag: f.tag, fc_item: f.item || null, fc_remark: f.remark || null, fc_status: f.status || null,
  fc_to: f.to, fc_frame: f.frame, fc_h2d: f.h2d, fc_build: f.build,
})

/**
 * @param fcRows   parseEdForecastDetail().rows
 * @param prodRows 생산관리 Edwards 줄 (완료 포함)
 * @param rules    mergeRules() 결과
 * @returns { upd, ins, unknown, same, gone }
 *   upd     — 이미 있는 줄에 포캐스트 칸만 새로 쓸 것 [{id, fc_*}]
 *   ins     — 포캐스트에만 있는 호기 · 갈래를 새로 만들 것
 *   unknown — 품번 갈래를 몰라 새 줄을 못 만든 것 [{tag, item}]
 *   same    — 바뀐 것이 없어 건너뛴 줄 수
 *   gone    — 예전 포캐스트에 있었는데 이번에 빠진 진행 줄 수 (지우지 않는다)
 *   goneIds — 그런 줄의 id (「포캐스트 없음」 표시만 켠다)
 */
export function planFcApply(fcRows, prodRows, rules) {
  const byKey = new Map(), byProj = new Map()
  for (const p of prodRows || []) {
    const np = normProj(p.pn), hn = hogiNo(p.hogi)
    if (!np || hn == null) continue
    const k = `${np}|${hn}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(p)
    if (!byProj.has(np)) byProj.set(np, [])
    byProj.get(np).push(p)
  }
  const upd = [], ins = [], unknown = [], seen = new Set()
  let same = 0
  const done = new Set()   // 같은 System Tag 가 두 번 나오면 처음 것만
  for (const f of fcRows || []) {
    const np = normProj(f.proj)
    const k = `${np}|${f.hogiNo}`
    if (done.has(k)) continue
    done.add(k)
    const fields = fcFields(f)
    const mine = byKey.get(k) || []
    for (const p of mine) {
      seen.add(p.id)
      // 날짜는 DB 가 'YYYY-MM-DD' 로 돌려준다. 빈 값은 null · '' 모두 같다고 본다.
      const norm = (v) => (v == null ? '' : String(v))
      const changed = p.fc_gone || FC_KEYS.some(key => norm(p[key]) !== norm(fields[key]))
      if (changed) upd.push({ id: p.id, ...fields })
      else same++
    }
    // 이 장비에 들어가는 갈래 — 설정 먼저, 없으면 같은 프로젝트 다른 호기에서 본다
    let kinds = rules?.map?.[f.item]
    if (!Array.isArray(kinds)) {
      const sib = new Set((byProj.get(np) || []).map(kindOf).filter(Boolean))
      kinds = sib.size ? [...sib] : null
    }
    if (!kinds) { if (!mine.length) unknown.push({ tag: f.tag, item: f.item }); continue }
    const have = new Set(mine.map(kindOf).filter(Boolean))
    // 생산관리에 쓰던 프로젝트 이름이 있으면 그 글자를 그대로 쓴다 (월간 실적과 이어지게)
    const pn = (byProj.get(np) || [])[0]?.pn || f.proj
    for (const kd of kinds) {
      if (have.has(kd)) continue
      ins.push({ pn, name: pn, hogi: `#${f.hogiNo}`, ...partsFor(kd, f.item), ...fields })
    }
  }
  // 예전 포캐스트에 있었는데 이번 파일에 없는 줄 — 지우지 않고 표시만 한다
  const goneIds = (prodRows || []).filter(p => p.fc_tag && !p.fc_gone && !seen.has(p.id)).map(p => p.id)
  const gone = (prodRows || []).filter(p => p.fc_tag && !seen.has(p.id) && p.status !== '완료').length
  return { upd, ins, unknown, same, gone, goneIds }
}

// ── 한 번에: 설정 읽기 → 생산관리 읽기 → 계획 ─────────────────────────
export async function loadRules(supabase) {
  const { data } = await supabase.from('pm_settings').select('value').eq('key', 'ed_fc_rules').maybeSingle()
  return mergeRules(data?.value)
}
export async function fetchEdProduction(supabase) {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('production')
      .select('id,pn,hogi,part,part2,part3,status,arrival_date,fc_gone,' + FC_KEYS.join(','))
      .eq('customer_code', 'ED').order('id').range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}
export async function applyFcPlan(supabase, plan) {
  const { data, error } = await supabase.rpc('pm_ed_fc_apply', { p_upd: plan.upd, p_ins: plan.ins, p_gone: plan.goneIds || [] })
  if (error) {
    if (/pm_ed_fc_apply|function .* does not exist|schema cache/i.test(error.message || ''))
      throw new Error('SQL pm_ed_forecast_260930 을 먼저 실행하세요 (' + error.message + ')')
    throw error
  }
  return data || {}
}
export function planSummary(plan) {
  const lines = [
    `  이미 있는 줄 — 포캐스트 날짜 갱신 ${plan.upd.length}줄 · 그대로 ${plan.same}줄`,
    `  포캐스트에만 있는 호기 — 새 줄 ${plan.ins.length}줄`,
  ]
  if (plan.ins.length) {
    const g = {}
    plan.ins.forEach(r => { const k = r.pn; (g[k] ||= []).push(`${r.hogi} ${r.part === 'EUV' ? 'EUV' : r.part2 === 'H2D HP' ? 'H2D-HPD' : 'H2D-LH'}`) })
    Object.entries(g).slice(0, 8).forEach(([k, v]) => lines.push(`     · ${k}: ${v.slice(0, 6).join(', ')}${v.length > 6 ? ` 외 ${v.length - 6}` : ''}`))
    if (Object.keys(g).length > 8) lines.push(`     · … 외 ${Object.keys(g).length - 8}개 프로젝트`)
  }
  if (plan.unknown.length) {
    const items = [...new Set(plan.unknown.map(u => u.item || '?'))]
    lines.push(`  구분을 몰라 못 만든 호기 ${plan.unknown.length}대 — 품번 ${items.slice(0, 6).join(', ')}${items.length > 6 ? ' …' : ''}`)
    lines.push('     (「불출 기준」에서 품번별 구분을 정하면 다음 반영 때 만들어집니다)')
  }
  if (plan.gone) lines.push(`  이번 포캐스트에서 빠진 진행 줄 ${plan.gone}줄 — 지우지 않고 「포캐스트 없음」으로 표시`)
  return lines.join('\n')
}
