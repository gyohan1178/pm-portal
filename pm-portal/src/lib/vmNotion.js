// VM 노션 「🎯 PROJECT」 → 생산관리 VM (v4.60.0)
//
//   노션에서 PROJECT 표를 내보낸 파일(HTML 또는 CSV)을 그대로 올리면, 생산관리 VM 에 없는 프로젝트만 새 줄로 넣는다.
//   (2026-10-07 에 21건을 SQL 로 옮긴 것과 같은 규칙)
//     구분 → 품번 칸 · 구성 → PD명 칸 · 프로젝트 → 호기 칸 · 납품일자 → 납품일 · 텍스트/비고 → 비고
//     ESC · AC · UT · ST · PM · ETC → 자재 칸(production.vm) · 노션 링크 → vm.notion
//     상태: 시작 전 → PO접수 · 수급 → 자재발주 · 제조 → 제작중 · 납품완료/현장 → 현장작업 · 종결/취소 → 넣지 않음
//   이미 있는 프로젝트(호기 칸이 같은 VM 줄)는 바꾸지 않는다. 납품일이 노션과 다르면 알려 주고, 고를 때만 맞춘다.
const s = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const key = (v) => s(v).replace(/\s+/g, '').toUpperCase()
const hk = (v) => s(v).replace(/\s+/g, '').toLowerCase()
const p2 = (n) => String(n).padStart(2, '0')
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
export function ymd(v) {
  const t = s(v)
  if (!t) return null
  let m = t.match(/(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/)
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`
  m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)   // CSV: October 26, 2026
  if (m && MON[m[1].toLowerCase()]) return `${m[3]}-${p2(MON[m[1].toLowerCase()])}-${p2(m[2])}`
  return null
}
export const VM_MAT_KEYS = ['esc', 'ac', 'ut', 'st', 'pm', 'etc']
const MAT_VALS = new Set(['완료', '대기', '부족', '홀딩'])
export function vmStatus(raw) {
  const t = s(raw).replace(/\s+/g, '')
  if (!t) return 'PO접수'
  if (/종결|취소|드랍|drop/i.test(t)) return null
  if (/현장|납품완료/.test(t)) return '현장작업'
  if (/제조|제작/.test(t)) return '제작중'
  if (/수급|자재/.test(t)) return '자재발주'
  if (/시작전|대기|접수/.test(t)) return 'PO접수'
  if (/완료/.test(t)) return '완료'
  return 'PO접수'
}

// 머리글 → 칸 (노션 속성 이름 · 띄어쓰기 무시)
const COLS = {
  cs: ['고객사'], pn: ['구분'], hogi: ['프로젝트', '이름', 'name'], name: ['구성'], status: ['상태'],
  req_date: ['납품일자', '납품일'], memo: ['텍스트', '비고'],
  esc: ['esc'], ac: ['ac'], ut: ['ut'], st: ['st'], pm: ['pm'], etc: ['etc'],
}
function mapHeads(heads) {
  const idx = {}
  heads.forEach((h, i) => {
    const k = hk(h)
    for (const [f, names] of Object.entries(COLS)) if (idx[f] == null && names.some(n => k === hk(n))) idx[f] = i
  })
  return idx
}
function toRow(get, idx, link) {
  const r = {
    cs: s(get(idx.cs)), pn: s(get(idx.pn)), hogi: s(get(idx.hogi)), name: s(get(idx.name)),
    statusRaw: s(get(idx.status)), req_date: ymd(get(idx.req_date)), memo: s(get(idx.memo)) || null, notion: link || null, mat: {},
  }
  for (const k of VM_MAT_KEYS) { const v = s(get(idx[k])); if (MAT_VALS.has(v)) r.mat[k] = v }
  r.status = vmStatus(r.statusRaw)
  return r
}

// 노션 HTML 내보내기 (표 하나) — 프로젝트 칸의 링크를 노션 주소로 남긴다
export function parseVmHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const table = [...doc.querySelectorAll('table')].find(t => /프로젝트/.test(t.querySelector('thead, tr')?.textContent || '')) || doc.querySelector('table')
  if (!table) return { rows: [], error: '표를 찾지 못했습니다 — 노션에서 「내보내기 → HTML」 한 파일인지 확인하세요' }
  const heads = [...(table.querySelector('thead tr') || table.querySelector('tr')).children].map(th => th.textContent)
  const idx = mapHeads(heads)
  const missing = ['hogi', 'pn'].filter(f => idx[f] == null)
  if (missing.length) return { rows: [], error: `머리글에 「프로젝트」 · 「구분」이 없습니다 (${heads.map(s).join(', ')})` }
  const body = [...table.querySelectorAll('tbody tr')].length ? [...table.querySelectorAll('tbody tr')] : [...table.querySelectorAll('tr')].slice(1)
  const rows = body.map(tr => {
    const cells = [...tr.children]
    const a = cells[idx.hogi]?.querySelector('a[href]')
    const href = a?.getAttribute('href') || ''
    const link = /notion\.(so|com)/.test(href) ? href.replace(/\?.*$/, '') : null
    return toRow((i) => (i == null ? '' : cells[i]?.textContent), idx, link)
  }).filter(r => r.hogi)
  return { rows, heads }
}
// 노션 CSV 내보내기 — XLSX 로 읽는다 (따옴표 · 줄바꿈 처리)
export function parseVmCsv(XLSX, text) {
  const wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true })
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
  if (!aoa.length) return { rows: [], error: '빈 파일입니다' }
  const idx = mapHeads(aoa[0])
  if (idx.hogi == null || idx.pn == null) return { rows: [], error: `머리글에 「프로젝트」 · 「구분」이 없습니다 (${aoa[0].map(s).join(', ')})` }
  const rows = aoa.slice(1).map(a => toRow((i) => (i == null ? '' : a[i]), idx, null)).filter(r => r.hogi)
  return { rows, heads: aoa[0] }
}

// existing: 생산관리 VM 줄 전부(완료 포함)
export function planVm(fileRows, existing) {
  const have = new Map()
  for (const r of existing || []) if (s(r.hogi)) have.set(key(r.hogi), r)
  const seen = new Set()
  const out = { ins: [], dateDiff: [], same: 0, skipped: [], otherCs: 0, dup: 0 }
  for (const r of fileRows) {
    if (r.cs && key(r.cs) !== 'VM') { out.otherCs++; continue }
    const k = key(r.hogi)
    if (seen.has(k)) { out.dup++; continue }
    seen.add(k)
    const ex = have.get(k)
    if (ex) {
      out.same++
      const cur = ex.req_date ? String(ex.req_date).slice(0, 10) : null
      if (r.req_date && cur !== r.req_date && ex.status !== '완료') out.dateDiff.push({ id: ex.id, hogi: s(ex.hogi), from: cur, to: r.req_date, changes: ex.changes })
      continue
    }
    if (!r.status) { out.skipped.push(`${r.hogi}(${r.statusRaw})`); continue }
    out.ins.push(r)
  }
  out.ins.sort((a, b) => String(a.req_date || '9999').localeCompare(String(b.req_date || '9999')) || a.hogi.localeCompare(b.hogi))
  return out
}
export function planVmText(p) {
  const L = []
  L.push(`새로 넣을 프로젝트 ${p.ins.length}건`)
  if (p.ins.length) L.push(...p.ins.slice(0, 15).map(r => `  · ${r.hogi}  ${r.pn} ${r.name}  납품 ${r.req_date || '미정'}  → ${r.status}`), ...(p.ins.length > 15 ? [`  … 외 ${p.ins.length - 15}건`] : []))
  L.push(`이미 있는 프로젝트 ${p.same}건 — 그대로 둡니다`)
  if (p.skipped.length) L.push(`종결 · 취소라 넣지 않음 ${p.skipped.length}건: ${p.skipped.slice(0, 5).join(', ')}`)
  if (p.otherCs) L.push(`VM 이 아닌 줄 ${p.otherCs}건은 건너뜀`)
  return L.join('\n')
}

const newId = () => 'pb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
// opt.dates: 납품일 다른 줄도 노션 날짜로 맞출지 · opt.vmReady: production.vm 칸이 있는지
export async function applyVm(supabase, plan, opt = {}) {
  const now = new Date().toISOString()
  const rows = plan.ins.map(r => ({
    id: newId(), customer_code: 'VM', pn: r.pn, name: r.name || null, hogi: r.hogi, status: r.status,
    po_received: r.status !== 'PO접수', req_date: r.req_date || null, memo: r.memo || null,
    missing_parts: [], changes: [{ type: '신규', msg: '노션 PROJECT 올리기', at: now }],
    created_at: now, updated_at: now,
    ...(opt.vmReady ? { vm: { ...r.mat, ...(r.notion ? { notion: r.notion } : {}) } } : {}),
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('production').insert(rows.slice(i, i + 200))
    if (error) throw error
  }
  let dated = 0
  if (opt.dates) {
    for (const d of plan.dateDiff) {
      const chg = [...(Array.isArray(d.changes) ? d.changes : []), { type: '납기변경', msg: `${d.from || '미정'} → ${d.to}`, from: d.from, to: d.to, src: '노션', at: now }]
      const { error } = await supabase.from('production').update({ req_date: d.to, changes: chg, updated_at: now }).eq('id', d.id)
      if (error) throw error
      dated++
    }
  }
  return { inserted: rows.length, dated }
}
