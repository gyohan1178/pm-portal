// 초도품 자재 매칭 — Part Report 없이 포털 BOM 에서 불러오기 (v4.174.0)
//   BOM(projects · bom) 으로 트리를 세우고, 품목마다
//     · 고객사 승인 제조사 = pm_item_mfr (NAS Part Report 를 매일 읽어 쌓은 것 — 상태 Approved · Preferred · Do Not Use … 포함)
//     · Class(Sole · Limited · Generic) = pm_item_cps (NAS CPS 문서에서 읽은 것)
//     · Rev = BOM 줄에 적힌 품목 REV.개정
//   을 붙여 parseReport 와 같은 모양({ top, parts, root, firstFull })을 돌려준다 → 판정 · 엑셀 · PPT 는 그대로 쓴다.
//   리포트에만 있는 것(Acceptance Criteria · RoHS · 인증 · 도면 문서 목록)은 비어 있다.
import { supabase } from '../supabase'
import { fetchAll } from '../paginate'
import { normAx } from './partReport'

const one = async (q) => { const { data, error } = await q; if (error) throw error; return data }

// 최상위 어셈블리 BOM 찾기 — 'AX-110153030' · '110153030' 둘 다
export async function findAxBom(code) {
  const pn = normAx(code)
  if (!pn) return null
  const rows = await one(supabase.from('projects').select('id,customer_id,code,name,rev').in('code', ['AX-' + pn, pn]).limit(5))
  return (rows || []).find((p) => normAx(p.code) === pn) || null
}

// Class 를 DB 에서 채우기 — 리포트에 Class 칸이 없을 때(짧은 리포트)도 쓴다
//   이미 리포트에 적힌 Class 는 그대로 둔다. 바꾼 개수를 돌려준다.
export async function fillClsFromDb(rep) {
  if (!rep?.parts?.size) return 0
  const codes = [...rep.parts.keys()].map((pn) => 'AX-' + normAx(pn))
  const byCode = new Map()
  for (let i = 0; i < codes.length; i += 200) {
    const { data: its, error: e1 } = await supabase.from('items').select('id,std_code').in('std_code', codes.slice(i, i + 200))
    if (e1 || !its?.length) continue
    const code = new Map(its.map((x) => [x.id, x.std_code]))
    const { data, error } = await supabase.from('pm_item_cps').select('item_id,kind').in('item_id', [...code.keys()]).not('kind', 'is', null)
    if (error) return 0          // 표가 없으면(SQL 전) 그냥 둔다
    for (const r of data || []) byCode.set(normAx(code.get(r.item_id)), r.kind)
  }
  let n = 0
  for (const P of rep.parts.values()) {
    if (P.cls) continue
    const k = byCode.get(normAx(P.pn))
    if (k) { P.cls = k + ' Manufacturer'; P.clsSrc = 'db'; n++ }
  }
  return n
}

export async function repFromBom(code) {
  const proj = await findAxBom(code)
  if (!proj) throw new Error(`「${code}」 BOM 이 포털에 없습니다 — 기초자료 BOM 에 먼저 올려 주세요`)
  const lines = await fetchAll(() => supabase.from('bom')
    .select('seq,level,item_rev,item_edition,qty_per_unit, items!bom_item_id_fkey(id,std_code,name,unit)')
    .eq('customer_id', proj.customer_id).eq('project_id', proj.id)
    .order('seq').order('created_at').order('id', { ascending: true }))
  if (!lines.length) throw new Error(`「${proj.code}」 BOM 에 품목이 없습니다`)

  // 승인 제조사 (지금 목록에 있는 것만)
  const ids = [...new Set(lines.map((l) => l.items?.id).filter(Boolean))]
  const mfrBy = new Map()
  let noTable = false
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_item_mfr').select('item_id,mfr,mfr_pn,status,src_ver').in('item_id', ids.slice(i, i + 200)).eq('active', true)
    if (error) { noTable = true; break }
    for (const r of data || []) { if (!mfrBy.has(r.item_id)) mfrBy.set(r.item_id, []); mfrBy.get(r.item_id).push(r) }
  }

  const topPn = normAx(proj.code)
  const parts = new Map()
  const root = { pn: topPn, lv: 0, qty: 1, unit: 'Each', kids: [], ref: false }
  parts.set(topPn, { pn: topPn, name: proj.name || '', rev: proj.rev || '', accept: '', cls: '', related: '', mfrs: [], hasKids: true, full: true, lvTxt: '0', qty0: '', unit0: '', state: '' })
  root.P = parts.get(topPn)
  const stack = [root]
  for (const l of lines) {
    const it = l.items
    if (!it?.std_code) continue
    const pn = normAx(it.std_code)
    if (pn === topPn) continue
    const lv = Math.max(1, Number(l.level) || 1)
    const qty = Number(l.qty_per_unit) || 0
    const unit = qty === 0 ? 'as needed' : (/^ea$/i.test(it.unit || '') ? 'Each' : (it.unit || 'Each'))
    const node = { pn, lv, qty, unit, kids: [], ref: false }
    while (stack.length > 1 && stack[stack.length - 1].lv >= lv) stack.pop()
    stack[stack.length - 1].kids.push(node)
    stack.push(node)
    if (!parts.has(pn)) {
      const rev = l.item_rev ? `${l.item_rev}${l.item_edition != null ? '.' + l.item_edition : ''}` : ''
      const lvTxt = '.'.repeat(lv) + lv
      parts.set(pn, {
        pn, name: it.name || '', rev, accept: '', cls: '', related: '', hasKids: false, full: true,
        lvTxt, qty0: String(qty), unit0: unit, state: 'REL',
        mfrs: (mfrBy.get(it.id) || []).map((m) => ({
          mpn: m.mfr_pn, mfr: m.mfr, status: m.status || '', rohs: '', cert: '',
          raw: `${m.mfr_pn}${m.status ? ` (${m.status})` : ''}`, lv: '.'.repeat(lv + 1) + (lv + 1), ver: m.src_ver || '', state: 'REL',
        })),
      })
    }
    node.P = parts.get(pn)
  }
  const firstFull = new Map()
  ;(function walk(n) { if (n.kids.length && !firstFull.has(n.pn)) firstFull.set(n.pn, n); n.kids.forEach(walk) })(root)
  for (const [pn] of firstFull) parts.get(pn).hasKids = true
  const rep = {
    top: { pn: topPn, name: proj.name || '', rev: proj.rev || '', created: '' },
    parts, root, firstFull,
    fromBom: true, noMfrTable: noTable,
    fileName: `포털 BOM ${proj.code} REV ${proj.rev || '-'} · 승인 제조사 DB`,
  }
  await fillClsFromDb(rep)
  return rep
}
