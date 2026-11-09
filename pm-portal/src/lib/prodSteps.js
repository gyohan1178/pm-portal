// 공정 4단계 · 스캔 (v4.165.0) — 공정 현황판 · 폰 스캔 · 작업지시서가 같이 쓴다
//   전 고객사 같은 4단계 — 불출(구매팀) → 제조(전장팀) → 검수(품질팀) → 납품대기(영업팀)
//   · 불출 = 생산관리 체크칸으로 안다 — 가공물 입고(machine_recv) + 파트 불출(part_issue)
//       고객사 화면에 가공물 입고 칸이 없는 것(CSK · AXCELIS sub 단품)은 파트 불출만 · VM 은 파트 불출 대신 박스별 자재 완료
//   · 제조 = QR 「제조 시작」 · 「제조 완료」 (완료하면 생산관리 전장/제작 완료 칸 elec_recv 도 켠다)
//   · 검수 = QR 「검수 완료」 (생산관리 품질 칸 quality_recv 를 켠다 · VM · CSK 는 검수 합격 기록도 인정)
//   · 납품대기 = 검수가 끝나면 영업팀 차례 — 끝은 지금처럼 수주대장 납품 처리(상태 완료)로 현황판에서 빠진다
//   · 생산관리에서 손으로 체크한 것도 같은 칸이라 그대로 인정한다
import { supabase } from './supabase'
import { truthy } from './prodFlow'
import { isMainRow } from '../pages/production/mainPns'
import { isTpRow } from './thirdParty'
import { stagesOf, applyAutoStatus, AUTO_CUST } from './prodAuto'

export const STAGES = [
  { k: 'mat', l: '불출', team: '구매팀' },
  { k: 'make', l: '제조', team: '전장팀' },
  { k: 'qc', l: '검수', team: '품질팀' },
  { k: 'wait', l: '납품대기', team: '영업팀' },
]
export const TEAM_OF = Object.fromEntries(STAGES.map((s) => [s.k, s.team]))

// QR 로 찍는 것 — 제조 시작 · 제조 완료 · 검수 완료
export const ACTIONS = {
  make_start: { step: 'make', kind: 'start', l: '제조 시작', team: '전장팀' },
  make: { step: 'make', kind: 'done', l: '제조 완료', team: '전장팀', field: 'elec_recv' },
  qc: { step: 'qc', kind: 'done', l: '검수 완료', team: '품질팀', field: 'quality_recv' },
}

// 작업지시서 「공정 기록」 칸
export const WO_STEPS = [
  { k: 'mat', l: '불출 (구매팀)', how: '생산관리 체크' },
  { k: 'make_start', l: '제조 시작 (전장팀)', how: 'QR 시작' },
  { k: 'make', l: '제조 완료 (전장팀)', how: 'QR 완료' },
  { k: 'qc', l: '검수 완료 (품질팀)', how: 'QR 완료' },
  { k: 'wait', l: '납품 (영업팀)', how: '수주대장 납품' },
]

const cc = (r) => String(r?.customer_code || '').toUpperCase()
const isAxSub = (r) => cc(r) === 'AX' && !(isMainRow(r.pn, 'AX') && !isTpRow(r))

// 불출에 들어가는 것 — [{ k, l, done }]
export function matPartsOf(r, qcLatest) {
  const c = cc(r)
  const out = []
  if (c !== 'CSK' && !isAxSub(r)) out.push({ k: 'mch', l: '가공물 입고', done: truthy(r.machine_recv) })
  if (c === 'VM') out.push({ k: 'part', l: '박스 자재', done: !!stagesOf(r, 'VM', qcLatest).mat })
  else out.push({ k: 'part', l: c === 'ED' ? '전장 불출' : '파트 불출', done: truthy(r.part_issue) })
  return out
}

// 스캔 기록 → 호기별 { list }  (rows: pm_prod_scan, at 순)
export function scanIndex(rows) {
  const m = new Map()
  for (const s of rows || []) {
    const k = String(s.production_id)
    if (!m.has(k)) m.set(k, { list: [] })
    m.get(k).list.push(s)
  }
  return m
}

// 4단계 진행
//   반환 { mat:{done, parts, n, of}, make:{done, started, at, startAt}, qc:{done, at}, cur, next, doneN }
//   cur = 지금 차례 단계 (지금 팀) · next = 폰에서 찍을 것 (ACTIONS 열쇠 · 없으면 null)
export function progressOf(r, scans, qcLatest) {
  const list = scans?.get(String(r.id))?.list || []
  const c = cc(r)
  const parts = matPartsOf(r, qcLatest)
  const last = (step, kind) => { let x = null; for (const e of list) if (e.step === step && e.kind === kind) x = e; return x }
  const mkStart = last('make', 'start'), mkDone = last('make', 'done'), qcDone = last('qc', 'done')
  const stg = AUTO_CUST.includes(c) && (c === 'VM' || c === 'CSK') ? stagesOf(r, c, qcLatest) : null
  const qc = { done: truthy(r.quality_recv) || !!stg?.qc || !!qcDone, at: qcDone }
  const make = { done: truthy(r.elec_recv) || !!mkDone || qc.done, at: mkDone, startAt: mkStart }
  make.started = !make.done && !!mkStart
  const mat = { done: parts.every((p) => p.done), parts, n: parts.filter((p) => p.done).length, of: parts.length }
  const cur = qc.done ? 'wait' : make.done ? 'qc' : make.started ? 'make' : mat.done ? 'make' : 'mat'
  const next = !make.done ? (make.started ? 'make' : 'make_start') : !qc.done ? 'qc' : null
  const doneN = [mat.done, make.done, qc.done].filter(Boolean).length
  return { mat, make, qc, cur, next, doneN, list }
}

// 스캔 저장 — 기록 남기고, 완료면 생산관리 칸을 켜고, 상태 자동(AX · VM · CSK)
//   반환 { scan, patch, msg }
export async function applyScan(r, action, by, { qcLatest, device } = {}) {
  const a = ACTIONS[action]
  if (!a) throw new Error('알 수 없는 공정입니다')
  const { data: scan, error } = await supabase.from('pm_prod_scan')
    .insert({ production_id: r.id, step: a.step, kind: a.kind, by_name: by || null, device: device || null }).select('id,production_id,step,kind,by_name,at').single()
  if (error) {
    if (/pm_prod_scan|schema cache|does not exist|PGRST205/i.test(error.message || '')) throw new Error('공정 스캔 기록 표가 아직 없습니다 — Supabase 에서 「공정스캔_반영_261109.sql」을 먼저 실행해 주세요')
    throw error
  }
  const patch = {}
  if (a.field && !truthy(r[a.field])) patch[a.field] = true
  let msg = null
  if (Object.keys(patch).length) {
    const { error: e2 } = await supabase.from('production').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (e2) { await supabase.from('pm_prod_scan').delete().eq('id', scan.id); throw e2 }
    if (AUTO_CUST.includes(cc(r))) {
      try { msg = await applyAutoStatus({ ...r, ...patch }, cc(r), qcLatest, by) } catch { /* 상태 자동은 실패해도 스캔은 남김 */ }
    }
  }
  return { scan, patch, msg }
}

// 방금 찍은 것 되돌리기 — 기록을 지우고, 이 스캔이 켠 칸만 끈다
export async function undoScan(r, scan, patch) {
  const { error } = await supabase.from('pm_prod_scan').delete().eq('id', scan.id)
  if (error) throw error
  const back = {}
  for (const k of Object.keys(patch || {})) back[k] = false
  if (Object.keys(back).length) {
    const { error: e2 } = await supabase.from('production').update({ ...back, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (e2) throw e2
    if (AUTO_CUST.includes(cc(r))) { try { await applyAutoStatus({ ...r, ...back }, cc(r), null, null) } catch { /* 무시 */ } }
  }
}

// 스캔 기록 불러오기 — 표가 없으면(SQL 전) { setup:false }
export async function fetchScans(ids) {
  if (!ids.length) return { setup: true, rows: [] }
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_prod_scan').select('id,production_id,step,kind,by_name,at')
      .in('production_id', ids.slice(i, i + 200)).order('at')
    if (error) {
      if (/pm_prod_scan|schema cache|does not exist|PGRST205/i.test(error.message || '')) return { setup: false, rows: [] }
      throw error
    }
    out.push(...(data || []))
  }
  return { setup: true, rows: out }
}

export const CUST_NAME = { AX: 'AXCELIS', VM: 'VM', CSK: 'CSK', ED: 'Edwards' }
