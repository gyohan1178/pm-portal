// 고객사 PO 줄 확인 · 코멘트 (v4.250.0) — pm_po_notes
//   kind 'ack'     : 영업 · 제조가 「확인」을 누른 기록 (dept = '영업' | '제조')
//   kind 'comment' : 제조 · 구매자재 · 영업 코멘트 (dept = 로그인한 사람 부서)
//   지우지 않고 쌓기만 한다 — 이력 창에서 PO 변경(changes)과 시간순으로 합쳐 보여 준다
//   표가 없으면(SQL pm_po_notes_261125 전) 읽기는 빈 값, 쓰기는 안내
import { chunkAll } from './axLines'

// 이 날 이전 변경은 확인된 것으로 본다 — 기능을 켤 때 예전 변경이 전부 노랗게 뜨지 않게
export const ACK_START = '2026-11-25'
// 음영을 켜는 변경 — 신규 HOT · need date · promise · 수량 (+ 새 PO 줄)
export const WATCH = ['plan_exc', 'need_date', 'promise_date', 'qty_ordered']
export const FIELD_LABEL = { plan_exc: 'Plan Exc', need_date: 'need date', promise_date: 'promise', qty_ordered: '수량', item_rev: 'SRev', item_brev: 'BRev', unit_price: '단가', status: '상태', division: '구분', item: '품번', new: '새 PO 줄' }

export const notesMissing = (e) => /pm_po_notes|PGRST205|42P01|does not exist|schema cache/i.test(String(e?.message || e?.code || e || ''))

export async function fetchNotes(supabase, poIds) {
  const list = [...new Set((poIds || []).filter(Boolean).map(String))]
  const out = {}
  if (!list.length) return { ready: true, byPo: out }
  try {
    const parts = await chunkAll(list, 150, async (part) => {
      const { data, error } = await supabase.from('pm_po_notes').select('id,po_id,kind,dept,body,by_name,created_at').in('po_id', part).order('created_at')
      if (error) throw error
      return data || []
    })
    for (const n of parts.flat()) (out[n.po_id] ||= []).push(n)
    return { ready: true, byPo: out }
  } catch (e) {
    if (notesMissing(e)) return { ready: false, byPo: {} }
    throw e
  }
}

// PO 줄 변경 이력 · 접수일
export async function fetchPoChanges(supabase, poIds) {
  const list = [...new Set((poIds || []).filter(Boolean))]
  const out = {}
  const parts = await chunkAll(list, 150, async (part) => {
    const { data, error } = await supabase.from('purchase_orders').select('id,changes,created_at,ccn').in('id', part)
    if (error) throw error
    return data || []
  })
  for (const p of parts.flat()) out[p.id] = { changes: Array.isArray(p.changes) ? p.changes : [], created: p.created_at || null, ccn: p.ccn || null }
  return out
}

// 줄 하나의 확인 상태
//   events  : 음영 대상 변경 (ACK_START 이후)
//   ackS/ackM : 영업 · 제조 마지막 확인 시각
//   open    : 두 부서 중 하나라도 마지막 변경 뒤에 확인 안 함
//   cells   : 아직 둘 다 확인 안 한 변경 — 칸별 { at, text }
export function ackState(chg, notes) {
  const evts = []
  for (const c of chg?.changes || []) {
    if (!c || !WATCH.includes(c.field) || !c.at || String(c.at).slice(0, 10) < ACK_START) continue
    evts.push(c)
  }
  if (chg?.created && String(chg.created).slice(0, 10) >= ACK_START) evts.push({ field: 'new', at: chg.created, to: '' })
  const acks = (notes || []).filter(n => n.kind === 'ack')
  const last = (d) => acks.filter(a => a.dept === d).map(a => a.created_at).sort().pop() || ''
  const ackS = last('영업'), ackM = last('제조')
  const both = [ackS, ackM].sort()[0] || ''   // 둘 다 확인한 시각 = 더 이른 쪽
  const pend = evts.filter(e => !both || String(e.at) > both)
  const cells = {}
  for (const e of pend) if (!cells[e.field] || String(e.at) > cells[e.field].at) cells[e.field] = { at: String(e.at), e }
  const lastEvt = evts.map(e => String(e.at)).sort().pop() || ''
  return {
    events: evts, ackS, ackM, open: pend.length > 0, cells, lastEvt,
    sOk: !!ackS && (!lastEvt || ackS >= lastEvt), mOk: !!ackM && (!lastEvt || ackM >= lastEvt),
    comments: (notes || []).filter(n => n.kind === 'comment'),
  }
}

const md = (d) => (d ? `${String(d).slice(5, 7)}/${String(d).slice(8, 10)}` : '')
const kst = (t) => (t ? new Date(Date.parse(t) + 9 * 3600000).toISOString() : '')
export const atText = (t) => { const d = kst(t); return d ? `${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)}` : '' }
// 변경 한 줄 글로
export function changeText(c) {
  if (c.field === 'new') return '새 PO 줄'
  if (c.field === 'plan_exc') return String(c.to || '').toUpperCase() === 'HOT' ? (String(c.from || '').toUpperCase() === 'HOT' ? 'HOT' : '신규 HOT') : `Plan Exc ${c.from || '-'} → ${c.to || '-'}`
  const isDate = /date/.test(c.field)
  const f = (v) => (isDate && /^\d{4}-/.test(String(v || '')) ? md(v) : (v ?? '-'))
  return `${FIELD_LABEL[c.field] || c.field} ${f(c.from)} → ${f(c.to)}`
}
// 칸 안 작은 글씨 — 「11/24 신규 HOT」
export const cellTag = (x) => (x ? `${md(kst(x.at))} ${changeText(x.e)}` : '')

export async function addNote(supabase, { poId, kind, dept, body, me }) {
  const { error } = await supabase.from('pm_po_notes').insert({ po_id: String(poId), kind, dept: dept || null, body: body || null, by_name: me?.name || me?.email || null })
  if (error) throw notesMissing(error) ? new Error('확인 · 코멘트 표가 아직 없습니다 — SQL pm_po_notes_261125 를 먼저 실행하세요') : error
}

// promise date 바꾸기 — 사유 필수 · 이력(changes)에 누가 · 언제 · 전→후 · 사유
export async function setPromise(supabase, { poId, to, reason, me }) {
  if (!to) throw new Error('새 promise date 를 넣으세요')
  if (!String(reason || '').trim()) throw new Error('사유를 넣어야 바꿀 수 있습니다')
  const { data: cur, error: e1 } = await supabase.from('purchase_orders').select('id,promise_date,changes').eq('id', poId).single()
  if (e1) throw e1
  const from = cur.promise_date ? String(cur.promise_date).slice(0, 10) : '-'
  if (from === to) throw new Error('지금 promise date 와 같습니다')
  const hist = { field: 'promise_date', from, to, at: new Date().toISOString(), by: me?.name || me?.email || '', reason: String(reason).trim(), src: 'portal' }
  const { error } = await supabase.from('purchase_orders').update({ promise_date: to, changes: [...(Array.isArray(cur.changes) ? cur.changes : []), hist] }).eq('id', poId)
  if (error) throw error
  return hist
}
