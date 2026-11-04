// 하네스 공정관리 「출도 기록」 붙여넣기 → 고객사 PO 줄 맞추기 (v4.144.0)
//   공정관리 기록 표(고객사 · PO No · Order Line · Del Line · 프로젝트 · 도면번호 · 호기 · 수량 · 공정 · 합불 · 작업자 · 시작시간 …)를
//   그대로 복사해 붙이면 PO · 오더라인 · 납품라인으로 고객사 PO 줄을 찾아 「불출」 표시할 목록을 만든다.
//   · 머리글이 있으면 머리글로 열을 잡고, 없으면 공정관리 기록 표 순서로 본다
//   · 같은 줄이 두 번 붙으면 한 번만 (마지막 기록)
//   · 라인이 없으면 PO + 도면번호(품번)로 — 같은 PO 에 그 품번 줄이 하나일 때만
const s = (v) => String(v ?? '').trim()
const N = (v) => s(v).replace(/\.0$/, '')
const P = (v) => s(v).toUpperCase()
const pnOf = (code) => s(code).replace(/^AX-/i, '').toUpperCase()

const COLS = {
  cust: ['고객사', 'customer'],
  po: ['po no', 'po', 'po번호', 'ordernumber', 'order number', 'po number'],
  ol: ['order line', 'orderline', 'orderlines', '오더라인', 'line'],
  dl: ['del line', 'delline', '납품라인', 'delivery line'],
  dwg: ['도면번호', '도번', 'item', '품번', 'dwg', 'drawing'],
  qty: ['수량', 'qty', 'quantity'],
  proc: ['공정', 'process'],
  by: ['작업자', 'worker'],
  at: ['완료시간', '시작시간', 'time'],
}
// 공정관리 기록 표 기본 순서 (머리글 없이 붙였을 때)
const DEFAULT_IDX = { cust: 0, po: 1, ol: 2, dl: 3, dwg: 5, qty: 7, proc: 8, by: 10, at: 12 }

export function parseHarnessPaste(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], skipped: 0 }
  const split = (l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}/))
  const head = split(lines[0]).map((h) => s(h).toLowerCase())
  let idx = null
  if (head.some((h) => COLS.po.includes(h))) {
    idx = {}
    for (const [k, names] of Object.entries(COLS)) {
      const i = names.map((n) => head.indexOf(n)).find((x) => x >= 0)
      if (i != null && i >= 0) idx[k] = i
    }
    lines.shift()
  } else idx = DEFAULT_IDX
  const by = new Map()
  let skipped = 0
  for (const l of lines) {
    const c = split(l)
    const g = (k) => (idx[k] == null ? '' : s(c[idx[k]]))
    const po = P(g('po'))
    if (!po || /^po/i.test(po) && !/\d/.test(po)) { skipped++; continue }
    const r = { po, ol: N(g('ol')), dl: N(g('dl')) || '1', dwg: pnOf(g('dwg')), qty: Number(String(g('qty')).replace(/,/g, '')) || null,
      proc: g('proc'), cust: g('cust'), by: g('by'), at: g('at') }
    const k = `${r.po}|${r.ol}|${r.dl}|${r.ol ? '' : r.dwg}`
    if (by.has(k)) skipped++
    by.set(k, r)
  }
  return { rows: [...by.values()], skipped }
}

// pos: 고객사 PO 줄 [{ id, po_number, order_line, del_line, status, material_issued, qty_*, items{std_code,name} }]
// 반환: [{ ...붙인 줄, p, state }] — state: ok(불출할 줄) · done(이미 불출) · closed(PO 완료 · 취소) · none(못 찾음) · many(PO+도번이 여러 줄)
export function matchHarnessPaste(rows, pos) {
  const byLine = new Map(), byDwg = new Map()
  for (const p of pos || []) {
    byLine.set(`${P(p.po_number)}|${N(p.order_line)}|${N(p.del_line) || '1'}`, p)
    const k = `${P(p.po_number)}|${pnOf(p.items?.std_code)}`
    byDwg.set(k, [...(byDwg.get(k) || []), p])
  }
  const used = new Set()
  return (rows || []).map((r) => {
    let p = r.ol ? byLine.get(`${r.po}|${r.ol}|${r.dl}`) : null
    let how = 'line'
    if (!p && r.dwg) {
      const cand = (byDwg.get(`${r.po}|${r.dwg}`) || []).filter((x) => !used.has(x.id))
      if (!r.ol && cand.length > 1) return { ...r, p: null, state: 'many', cand: cand.length }
      if (!r.ol && cand.length === 1) { p = cand[0]; how = 'dwg' }
    }
    if (!p) return { ...r, p: null, state: 'none' }
    if (used.has(p.id)) return { ...r, p, state: 'dup' }
    used.add(p.id)
    const dwgDiff = r.dwg && pnOf(p.items?.std_code) && r.dwg !== pnOf(p.items?.std_code)
    const state = ['완료', '취소'].includes(p.status) ? 'closed' : p.material_issued ? 'done' : 'ok'
    return { ...r, p, how, state, dwgDiff }
  })
}
