// 품질팀 FA 진행 엑셀 → 초도품 진행관리 (v4.202.0)
//   「Axcelis FA 진행 대시보드 v2.0」 시트를 그대로 올리면 품목 · 단계 상태 · 마감 · 하위 구성품을 읽는다.
//   머리줄이 두 줄(묶음 제목 + 칸 이름)이라 두 줄을 합쳐 칸 이름을 찾는다.
//   하위 구성품 = No. 가 비고 품명이 「↳」로 시작하는 줄 → 바로 위 번호 줄이 상위
//   가져올 때 포털에 이미 있는 값은 덮지 않는다(빈 칸만) — 화면(FaProgress QualityImport)에서 처리
import { faTypeOf } from './faTemplate'

const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase()
const txt = (v) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v)) : String(v).trim())
const unknown = (v) => !v || /^확인\s*필요$/.test(v) ? null : v

// 단계 칸 이름 → 포털 키 (sub: 세부 항목)
export const QI_STAGES = [
  ['po접수', 'g_po'], ['dr회의', 'g_dr'], ['자재입고', 'g_mat_in'], ['자재불출', 'g_issue'],
  ['제작착수', 'g_make_start'], ['제작완료', 'g_make_done'], ['품질인계', 'g_handover'], ['실물검수', 'g_inspect'],
  ['fa성적서', 'g_report'], ['시험절차서', 'test_proc', 'sub'], ['jig준비', 'jig_ready', 'sub'],
  ['고객사입회', 'g_submit'], ['고객사승인', 'g_approve'],
]
// 상태 글 → 포털 상태
export function qiStatus(v) {
  const t = norm(v)
  if (!t || t === '대기' || t === '-') return ''
  if (t === '완료' || t === 'done' || t === 'pass') return 'done'
  if (/진행/.test(t)) return 'doing'
  if (t === '보류') return 'hold'
  if (/확인필요/.test(t)) return 'check'
  if (/해당없음|n\/a|^na$/.test(t)) return 'na'
  return ''   // 취소 등 — 건 마감으로 따로 본다
}
const TYPE = { '하네스': 'HARNESS', 'harness': 'HARNESS', 'assy': 'ASSY', 'pd': 'PD', '전장': 'PD', '전장box': 'PD', '단품': 'PART' }

// aoa: 시트를 배열의 배열로 (XLSX sheet_to_json header:1)
export function parseQualitySheet(aoa) {
  const rows = aoa || []
  const h = rows.findIndex((r) => (r || []).some((c) => norm(c) === 'partnumber'))
  if (h < 0) return { rows: [], bad: ['「Part Number」 칸이 있는 머리줄을 찾지 못했습니다 — FA 진행 대시보드 시트가 맞는지 보세요'] }
  const top = rows[h - 1] || [], head = rows[h] || []
  const width = Math.max(top.length, head.length)
  const names = Array.from({ length: width }, (_, i) => `${norm(head[i])}|${norm(top[i])}`)
  const find = (re) => names.findIndex((n) => re.test(n))
  const col = {
    no: find(/^no\.?\|/), ccn: find(/^ccn\|/), pn: find(/^partnumber\|/), srev: find(/^srev\|/), brev: find(/^brev\|/),
    po: find(/^fapo\|/), desc: find(/^description\|/), type: find(/^구분\|/), prep: find(/입회준비현황/), mfg: find(/제조현황/),
    sched: find(/입회요청일정/), issue: find(/주요이슈|비고/), ext: find(/대외상태|fa승인\/취소/),
  }
  const stage = QI_STAGES.map(([k, key, sub]) => ({ key, sub: !!sub, i: names.findIndex((n) => n.startsWith(k + '|')) })).filter((x) => x.i >= 0)
  if (col.pn < 0 || col.po < 0) return { rows: [], bad: ['Part Number · FA PO 칸을 찾지 못했습니다'] }
  const out = [], bad = []
  let parent = null
  for (let r = h + 1; r < rows.length; r++) {
    const c = rows[r] || []
    const g = (i) => (i >= 0 ? txt(c[i]) : '')
    const pn = g(col.pn).replace(/^AX-/i, '')
    const po = g(col.po)
    if (!pn) continue
    if (!po) { bad.push(`${r + 1}줄 ${pn} — FA PO 가 비어 뺐습니다`); continue }
    const rawDesc = g(col.desc)
    const child = !g(col.no) && /^↳/.test(rawDesc)
    if (!child) parent = pn
    const typeRaw = norm(g(col.type))
    const fa_type = TYPE[typeRaw] || faTypeOf(null, pn)
    const steps = {}
    for (const st of stage) {
      const s = qiStatus(c[st.i])
      if (!s) continue
      if (st.sub) {
        if (st.key === 'jig_ready' && fa_type === 'PD') continue   // 전장 BOX 는 JIG 세부 항목이 따로 있다
        if (['done', 'doing', 'na'].includes(s)) steps[st.key] = { s }
      } else steps[st.key] = { s }
    }
    const prep = g(col.prep), ext = g(col.ext), issue = g(col.issue), sched = g(col.sched)
    // 입회 준비현황 「입회요청」 = 고객사 입회 단계가 진행 중 (엑셀 단계 칸은 「대기」로 남아 있음)
    if (/입회\s*요청/.test(prep) && !steps.g_submit) steps.g_submit = { s: 'doing' }
    const all = `${prep} ${ext}`.replace(/\s+/g, '')
    const close_reason = /발주취소|^취소|취소$/.test(all) || prep === '취소' ? 'cancel' : /기존.*승인/.test(all) ? 'prev_ok' : null
    out.push({
      line: r + 1,
      item_code: pn, po_number: po,
      ccn: unknown(g(col.ccn)), srev: unknown(g(col.srev)), brev: unknown(g(col.brev)),
      item_desc: rawDesc.replace(/^↳\s*/, '') || null,
      fa_type, steps,
      hold: !close_reason && prep === '보류',
      close_reason, close_note: close_reason ? (issue || null) : null,
      fa_ready_text: sched && !/일정\s*미확정|^보류$|^취소$|해당\s*없음/.test(sched) ? sched : null,
      note: close_reason ? null : (issue || null),
      parent: child ? parent : null,
    })
  }
  // 같은 PO · 품번이 두 번 — 뒤 줄은 뺀다
  const seen = new Set(), rowsOut = []
  for (const x of out) { const k = `${x.po_number}|${x.item_code}`; if (seen.has(k)) { bad.push(`${x.line}줄 ${x.item_code} — 같은 FA PO · 품번이 위에 또 있어 뺐습니다`); continue } seen.add(k); rowsOut.push(x) }
  return { rows: rowsOut, bad }
}

// 기존 건과 합치기 — 포털 값이 있으면 그대로(빈 칸만 채움) · 반환 patch 가 비면 바꿀 것 없음
export function qiMerge(old, x) {
  const p = {}
  const fill = (k) => { if ((old[k] == null || old[k] === '') && x[k] != null && x[k] !== '') p[k] = x[k] }
  ;['ccn', 'srev', 'brev', 'item_desc', 'note'].forEach(fill)
  if (!old.fa_ready_date && !old.fa_ready_text && x.fa_ready_text) p.fa_ready_text = x.fa_ready_text
  if (!old.close_reason && x.close_reason) { p.close_reason = x.close_reason; if (!old.close_note && x.close_note) p.close_note = x.close_note }
  const os = old.steps || {}
  const add = {}
  for (const [k, v] of Object.entries(x.steps || {})) {
    const cur = os[k]
    if (!cur || (!cur.d && !cur.s)) add[k] = { ...(cur || {}), ...v }
  }
  if (Object.keys(add).length) p.steps = { ...os, ...add }
  return { patch: p, stepsAdded: Object.keys(add).length }
}
