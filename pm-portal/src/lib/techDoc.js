// 📚 기술 문서 (v4.216.0) — 품질
//   고객사 스펙 · 규격 · 교육 자료의 원문과 한글 번역을 나란히 보는 곳.
//   원본 파일은 NAS 에 그대로 두고 (경로만 적음), 여기에는 번역 · 표 · 그림 · 원문 쪽 이미지만 둔다.
//   문서는 「문서 꾸러미(.json)」 로 올린다 — 번역 양식(사내 표준)대로 정리한 것을 그대로 받는다.
//   · pm_tech_doc      문서 한 건 (UL 교육자료는 모듈 하나가 한 건 · series 로 묶음)
//   · pm_tech_doc_img  원문 쪽 이미지(page:n) · 본문 그림(fig:키) — 문서 열 때 그림만, 쪽 이미지는 누를 때 받는다
import { supabase } from './supabase'
import { fetchAll } from './paginate'

export const TECHDOC_SQL = '기술문서_반영_261119'
export const TECHDOC_SQL_HINT = `기술 문서 표가 아직 없습니다 — 「${TECHDOC_SQL}」 SQL 을 먼저 실행하세요`
const noTable = (e) => /pm_tech_doc/.test(e?.message || '') && /(does not exist|schema cache|Could not find)/i.test(e?.message || '')

export const KINDS = { spec: '고객사 스펙', std: '규격', edu: '교육 자료', sop: 'SOP (작업표준서)' }
export const KIND_SHORT = { spec: '스펙', std: '규격', edu: '교육', sop: 'SOP' }
export const KIND_ICON = { spec: '📄', std: '📐', edu: '🎓', sop: '📘' }
// 적용 공정 (v4.221.0) — 작업 기준을 공정으로 거르고, 나중에 생산관리 · 작업지시서에서 그 공정 기준으로 연결
export const PROCESSES = ['하네스', '전장 조립', '라벨 · 마킹', '검사 · 시험', '포장', '공통']
// 검토 · 승인 (v4.221.0) — 검토 완료는 품질 부서 · 팀장급 · 관리자 / 의견은 편집 권한자 누구나
export const TECHDOC_REVIEW_SQL = '기술문서_검토_작업기준_반영_261119'
export const canApprove = (p) => !!p && (p.role === 'admin' || p.is_lead === true || p.dept === '품질')
export const STATUSES = ['번역 중', '검토 전', '검토 완료', '원문 없음', '정리 중']
export const STATUS_TONE = {
  '번역 중': 'bg-violet-50 text-violet-700 border-violet-200', '정리 중': 'bg-violet-50 text-violet-700 border-violet-200',
  '검토 전': 'bg-amber-50 text-amber-700 border-amber-200', '검토 완료': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '원문 없음': 'bg-rose-50 text-rose-600 border-rose-200',
}
// 저작권 안내 — UL 교육자료는 UL 약관상 「사내 사용」만 허용 (외부 배포 · 게시 · 판매 금지)
export const isUlDoc = (r) => !!r && (r.source === 'UL' || /^UL\b/.test(r.series || ''))
export const UL_COPY_TITLE = '사내 교육 전용 · 외부 배포 금지'
export const UL_COPY_TEXT = '본 자료는 UL Knowledge Solutions 교육을 바탕으로 사내 교육 목적으로 요약한 것이며, 원저작권은 UL에 있습니다. 사외 반출 · 배포 · 게시 · 판매를 금지합니다 (고객사 · 협력사 전달 포함).'
export const ACCESS = { all: '전체 (품질 메뉴를 볼 수 있는 사람)', lead: '팀장급 · 관리자만' }
const LIST_COLS0 = 'id,doc_key,source,kind,series,part_no,sort_no,doc_no,title,title_ko,rev,tr_rev,status,access,uploaded_by,updated_at'
const LIST_COLS = LIST_COLS0 + ',process,reviewed_by,reviewed_at'
// 새 칸(process · reviewed_*)은 SQL 전엔 없다 — 그때는 예전 칸만 받아 화면은 그대로 열리게
const colMissing = (e) => /(process|reviewed_by|reviewed_at)/.test(e?.message || '') && /(does not exist|schema cache|Could not find)/i.test(e?.message || '')
async function listWith(cols0, cols1) {
  const q = (c) => fetchAll(() => supabase.from('pm_tech_doc').select(c).order('source').order('series', { nullsFirst: true }).order('sort_no').order('doc_no'))
  try { return await q(cols1) } catch (e) {
    if (noTable(e)) return null
    if (colMissing(e)) { const r = await q(cols0); r.noReviewCols = true; return r }
    throw e
  }
}

export async function fetchDocList() { return listWith(LIST_COLS0, LIST_COLS) }
export async function fetchDoc(key) {
  const { data, error } = await supabase.from('pm_tech_doc').select('*').eq('doc_key', key).maybeSingle()
  if (error) throw error
  return data
}
// 현장 › 작업 기준 — 문서마다 적용 요약만 (본문 · 그림은 안 받음)
const WS0 = 'doc_key,source,kind,series,part_no,sort_no,doc_no,title,title_ko,status,rev,tr_rev,access,updated_at,summary:body->summary,sumTitle:body->sumTitle,stepCount:body->steps'
export async function fetchWorkStd() { return listWith(WS0, WS0 + ',process,reviewed_by,reviewed_at') }
// 본문 그림 — 문서 열 때 한 번에
export async function fetchFigs(key) {
  const { data, error } = await supabase.from('pm_tech_doc_img').select('img_key,data').eq('doc_key', key).eq('kind', 'fig')
  if (error) throw error
  return Object.fromEntries((data || []).map((r) => [r.img_key.replace(/^fig:/, ''), r.data]))
}
// 원문 쪽 이미지 — 몇 쪽이 있는지만 먼저, 그림은 누를 때
export async function fetchPageList(key) {
  const { data, error } = await supabase.from('pm_tech_doc_img').select('img_key').eq('doc_key', key).eq('kind', 'page')
  if (error) throw error
  return (data || []).map((r) => Number(r.img_key.replace(/^page:/, ''))).filter(Boolean).sort((a, b) => a - b)
}
export async function fetchPage(key, n) {
  const { data, error } = await supabase.from('pm_tech_doc_img').select('data').eq('doc_key', key).eq('img_key', `page:${n}`).maybeSingle()
  if (error) throw error
  return data?.data || null
}
// 전체 문서에서 찾기 — 올릴 때 만든 search_text 에서 (본문 · 표 · 용어 · 요약)
export async function searchDocs(q) {
  const s = String(q || '').trim().replace(/[%,()]/g, ' ')
  if (s.length < 2) return null
  const { data, error } = await supabase.from('pm_tech_doc').select('doc_key').ilike('search_text', `%${s}%`).limit(200)
  if (error) throw error
  return new Set((data || []).map((r) => r.doc_key))
}

// ── 문서 꾸러미 (.json) ──
//   { format: 'js-techdoc', v: 1, doc: { key, source, kind, series, part_no, sort_no, doc_no, title, title_ko, rev, tr_rev, status, access, body },
//     images: { 'page:1': 'data:image/jpeg;base64,…', 'fig:p3a': '…' } }
export function readPackage(text, fileName = '') {
  let p
  try { p = JSON.parse(text) } catch { throw new Error(`${fileName} — 문서 꾸러미(.json) 형식이 아닙니다`) }
  if (p?.format !== 'js-techdoc' || !p.doc?.key || !p.doc?.body) throw new Error(`${fileName} — 기술 문서 꾸러미가 아닙니다 (format · doc.key · doc.body 확인)`)
  const d = p.doc
  if (!Array.isArray(d.body.sections)) throw new Error(`${fileName} — 본문(sections)이 없습니다`)
  const images = Object.entries(p.images || {}).filter(([k, v]) => /^(page|fig):/.test(k) && /^data:image\/(jpeg|png|webp);base64,/.test(String(v)))
  return {
    fileName, key: String(d.key).trim(), images,
    row: {
      doc_key: String(d.key).trim(), source: d.source || '', kind: d.kind || 'spec', series: d.series || null, part_no: d.part_no || null,
      sort_no: Number(d.sort_no) || 0, doc_no: d.doc_no || '', title: d.title || '', title_ko: d.title_ko || '', rev: d.rev || '', tr_rev: d.tr_rev || '',
      status: d.status || '검토 전', access: d.access === 'lead' ? 'lead' : 'all', body: d.body, search_text: searchText(d),
      ...(d.process ? { process: d.process } : {}),
    },
    bytes: text.length,
  }
}
const cellT = (c) => (c && typeof c === 'object' ? `${c.k || ''} ${c.e || ''}` : String(c ?? ''))
function searchText(d) {
  const b = d.body || {}, out = [d.doc_no, d.title, d.title_ko, d.series, d.part_no]
  for (const s of b.sections || []) {
    out.push(s.no, s.en, s.ko)
    for (const x of s.blocks || []) {
      if (x.t === 'table') out.push(cellT(x.cap), ...(x.head || []).flat().map(cellT), ...(x.rows || []).flat().map(cellT), ...(x.notes || []).map(cellT))
      else if (x.t === 'fig') out.push(cellT(x.cap))
      else out.push(x.n, x.en, x.ko)
    }
  }
  for (const g of b.glossary || []) out.push(...g)
  for (const s of b.summary || []) out.push(String(s[0] || '').replace(/<[^>]+>/g, ''), s[1])
  return out.filter(Boolean).join(' \n').slice(0, 900000)
}

export async function savePackage(pkg, by) {
  const row = { ...pkg.row, uploaded_by: by || null, updated_at: new Date().toISOString() }
  // 검토 (v4.221.0) — 같은 번역 Rev 를 다시 올리면 검토 완료 그대로, Rev 가 바뀌면 「검토 전」 으로 돌리고 이력에 남김
  let prev = null
  { const { data } = await supabase.from('pm_tech_doc').select('*').eq('doc_key', pkg.key).maybeSingle(); prev = data || null }
  const hasRev = prev && 'reviewed_at' in prev
  if (prev && hasRev) {
    if (!row.process && prev.process) row.process = prev.process
    if (prev.status === '검토 완료' && String(prev.tr_rev || '') === String(row.tr_rev || '') && row.status === '검토 전') {
      row.status = '검토 완료'; row.reviewed_by = prev.reviewed_by; row.reviewed_at = prev.reviewed_at
    } else if (prev.reviewed_at && String(prev.tr_rev || '') !== String(row.tr_rev || '')) {
      row.reviewed_by = null; row.reviewed_at = null
      await addReview(pkg.key, 'reset', `번역 Rev ${prev.tr_rev || '—'} → ${row.tr_rev || '—'} 로 다시 올림 — 검토 전으로`, by).catch(() => {})
    }
  }
  if (!hasRev) { delete row.process; delete row.reviewed_by; delete row.reviewed_at }
  const { error } = await supabase.from('pm_tech_doc').upsert(row, { onConflict: 'doc_key' })
  if (error) throw error
  // 그림은 통째로 바꾼다 — 예전 판 그림이 남지 않게
  const { error: e2 } = await supabase.from('pm_tech_doc_img').delete().eq('doc_key', pkg.key)
  if (e2) throw e2
  // 한 번에 1.5MB 정도씩 나눠 보낸다
  let batch = [], size = 0
  const flush = async () => {
    if (!batch.length) return
    const { error: e3 } = await supabase.from('pm_tech_doc_img').insert(batch)
    if (e3) throw e3
    batch = []; size = 0
  }
  for (const [k, v] of pkg.images) {
    batch.push({ doc_key: pkg.key, img_key: k, kind: k.split(':')[0], data: v })
    size += v.length
    if (size > 1_500_000) await flush()
  }
  await flush()
}
export async function deleteDoc(key) {
  const { error } = await supabase.from('pm_tech_doc').delete().eq('doc_key', key)
  if (error) throw error
}
export async function setAccess(key, access) {
  const { error } = await supabase.from('pm_tech_doc').update({ access }).eq('doc_key', key)
  if (error) throw error
}

// ── 화면 그리기 (HTML 문자열) ──
//   올린 내용은 전부 글자로 바꿔 넣고, 요약 · 안내의 굵게(<b>) 등 몇 가지만 다시 살린다
export const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
export const safeHtml = (t) => esc(t)
  .replace(/&lt;(\/?)(b|small|p|br)&gt;/g, '<$1$2>')
  .replace(/&lt;(span|b) class=&quot;mono&quot;&gt;/g, '<$1 class="mono">').replace(/&lt;\/span&gt;/g, '</span>')
const reQ = (q) => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
export function makeHi(q) {
  const re = q ? reQ(q) : null
  return (t) => { const e = esc(t); return re ? e.replace(re, (m) => `<mark>${m}</mark>`) : e }
}
const cText = (c) => `${c?.k || ''} ${c?.e || ''}`
export const blockText = (b) => b.t === 'table' ? [cText(b.cap), ...b.head.flat().map(cText), ...b.rows.flat().map(cText), ...(b.notes || []).map(cText)].join(' ')
  : b.t === 'fig' ? cText(b.cap) : `${b.n || ''} ${b.en || ''} ${b.ko || ''}`

function cellHtml(c, tag, hi) {
  const cls = [c.c ? 'c' : '', c.dot ? 'dot' : '', c.pre ? 'pre' : ''].filter(Boolean).join(' ')
  const attr = `${c.rs ? ` rowspan="${Number(c.rs)}"` : ''}${c.cs ? ` colspan="${Number(c.cs)}"` : ''}${cls ? ` class="${cls}"` : ''}`
  if (c.dot) return `<${tag}${attr}><span class="k">●</span><span class="e">X</span></${tag}>`
  const showE = c.e && c.e !== c.k
  return `<${tag}${attr}><span class="k">${hi(c.k)}</span>${showE ? `<span class="e">${hi(c.e)}</span>` : ''}</${tag}>`
}
function tableHtml(b, hi) {
  const tag = typeof b.no === 'number' ? `표 ${b.no}` : esc(b.no || '표')
  let h = `<div class="blk"><div class="cap"><span class="tag">${tag}</span><b>${hi(b.cap?.k)}</b>${b.cap?.e && b.cap.e !== b.cap.k ? `<span class="e">${hi(b.cap.e)}</span>` : ''}</div><div class="tbl-wrap"><table${b.wide ? ' style="min-width:880px"' : ''}><thead>`
  for (const r of b.head || []) h += `<tr>${r.map((c) => cellHtml(c, 'th', hi)).join('')}</tr>`
  h += '</thead><tbody>'
  ;(b.rows || []).forEach((r, i) => {
    const cl = (b.gone || []).includes(i) ? 'gone' : (b.hl || []).includes(i) ? 'hl' : ''
    h += `<tr${cl ? ` class="${cl}"` : ''}>${r.map((c) => cellHtml(c, 'td', hi)).join('')}</tr>`
  })
  h += '</tbody></table></div>'
  if (b.notes) h += `<div class="notes">${b.notes.map((n) => `<div>${hi(n.k)}${n.e && n.e !== n.k ? `<span class="e">${hi(n.e)}</span>` : ''}</div>`).join('')}</div>`
  return h + '</div>'
}
export function blockHtml(b, hi, figs) {
  if (b.t === 'table') return tableHtml(b, hi)
  if (b.t === 'h') return `<div class="hrow ${/^UNACC/i.test(b.en) ? 'ng' : /^ACC/i.test(b.en) ? 'ok' : ''}"><b>${hi(b.ko)}</b>${b.en ? `<span>${hi(b.en)}</span>` : ''}</div>`
  if (b.t === 'fig') {
    const src = figs?.[b.src]
    return `<figure class="fig${b.big ? ' big' : ''}">${src ? `<img src="${esc(src)}" alt="${esc(b.cap?.k)}" data-zoom="${esc(b.src)}" loading="lazy">` : '<div class="fig-wait">그림 불러오는 중…</div>'}<figcaption><span class="tag">그림</span>${hi(b.cap?.k)}${b.cap?.e ? `<span class="e">${hi(b.cap.e)}</span>` : ''}</figcaption></figure>`
  }
  const solo = !b.en
  return `<div class="row${b.l ? ' l' + Number(b.l) : ''}${solo ? ' solo' : ''}${b.note ? ' note' : ''}"><div class="en"><span class="num">${esc(b.n)}</span><span>${hi(b.en)}</span></div><div class="ko"><span class="num">${esc(b.n)}</span><span>${hi(b.ko)}</span></div></div>`
}
// 한 문서 본문 — 찾는 말이 있으면 그 말이 든 덩어리만
export function sectionsHtml(sections, q, figs, pages) {
  const hi = makeHi(q), ql = (q || '').toLowerCase()
  let shown = 0, html = ''
  for (const s of sections || []) {
    const headHit = ql && `${s.no} ${s.en} ${s.ko}`.toLowerCase().includes(ql)
    const blocks = !ql || headHit ? s.blocks : s.blocks.filter((b) => blockText(b).toLowerCase().includes(ql))
    if (ql && !blocks.length) continue
    shown++
    html += `<section class="sec" id="td-sec-${esc(s.id)}"><div class="sec-h">${s.no ? `<span class="no">${esc(s.no)}</span>` : ''}<h2>${hi(s.ko)}</h2>${s.en ? `<span class="en-t">${hi(s.en)}</span>` : ''}${s.page && pages?.includes(Number(s.page)) ? `<button type="button" class="pbtn" data-page="${Number(s.page)}">원문 ${Number(s.page)}쪽</button>` : ''}</div>`
    html += blocks.map((b) => blockHtml(b, hi, figs)).join('') + '</section>'
  }
  return { html, shown }
}

// 화면 모양 — [data-techdoc] 안에서만
export const TECHDOC_CSS = `
[data-techdoc]{--tx:#1f2430;--tx2:#4a5162;--tx3:#7f889a;--bd:#e8eaf0;--bdi:#f0f2f6;--bg:#f7f8fb;--pr:#6c5ce7;--prd:#eeebfd;--en:#fafbfd;--mark:#fff1a8;--mono:'JetBrains Mono',ui-monospace,Consolas,monospace}
[data-techdoc] .sec{background:#fff;border:1px solid var(--bd);border-radius:12px;overflow:hidden;scroll-margin-top:110px}
[data-techdoc] .sec-h{display:flex;gap:10px;align-items:center;padding:11px 18px;border-bottom:1px solid var(--bdi);flex-wrap:wrap}
[data-techdoc] .sec-h .no{font-family:var(--mono);font-size:12.5px;color:var(--pr);font-weight:700;min-width:22px}
[data-techdoc] .sec-h h2{margin:0;font-size:15px;font-weight:800;color:var(--tx)}
[data-techdoc] .sec-h .en-t{font-size:12px;color:var(--tx3);font-family:var(--mono)}
[data-techdoc] .pbtn{margin-left:auto;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--bd);background:#fff;font-size:12px;font-weight:700;color:var(--tx2)}
[data-techdoc] .pbtn:hover{background:var(--bg)}
[data-techdoc] .row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border-bottom:1px solid var(--bdi)}
[data-techdoc] .row>div{padding:8px 18px;min-width:0;display:flex;gap:8px;font-size:13px;line-height:1.6}
[data-techdoc] .row .en{background:var(--en);color:var(--tx2)}
[data-techdoc] .row .ko{color:var(--tx)}
[data-techdoc] .row .num{font-family:var(--mono);font-size:11.5px;color:var(--tx3);flex:none;min-width:34px;padding-top:2px}
[data-techdoc] .row.l2 .num{min-width:52px;padding-left:18px}
[data-techdoc] .row.l3 .num{min-width:70px;padding-left:36px}
[data-techdoc] .row.solo,[data-techdoc].mode-ko .row,[data-techdoc].mode-en .row{grid-template-columns:minmax(0,1fr)}
[data-techdoc] .row.solo .en,[data-techdoc].mode-ko .row .en,[data-techdoc].mode-en .row .ko{display:none}
[data-techdoc] .row.note .ko{color:var(--tx3);font-size:12.5px;font-style:italic}
[data-techdoc] .hrow{display:flex;gap:10px;align-items:baseline;padding:10px 18px 6px;border-bottom:1px solid var(--bdi)}
[data-techdoc] .hrow b{font-size:12.5px;padding:2px 10px;border-radius:20px;background:var(--bg);color:var(--tx2)}
[data-techdoc] .hrow.ok b{background:#eafaf1;color:#12a05f} [data-techdoc] .hrow.ng b{background:#fdeef0;color:#d14555}
[data-techdoc] .hrow span{font-size:11.5px;color:var(--tx3);font-family:var(--mono)}
[data-techdoc] .blk{padding:12px 18px 14px;border-bottom:1px solid var(--bdi)}
[data-techdoc] .cap{display:flex;gap:8px;align-items:baseline;margin-bottom:8px;flex-wrap:wrap}
[data-techdoc] .cap b{font-size:12.5px} [data-techdoc] .cap .e{font-size:11.5px;color:var(--tx3);font-family:var(--mono)}
[data-techdoc] .tag{font-size:11px;font-weight:700;padding:1px 8px;border-radius:20px;background:var(--prd);color:var(--pr)}
[data-techdoc] .tbl-wrap{overflow-x:auto}
[data-techdoc] table{border-collapse:collapse;width:100%;font-size:13px}
[data-techdoc] th{background:var(--bg);color:var(--tx2);font-size:12px;font-weight:700;text-align:left;padding:7px 9px;border:1px solid var(--bd);vertical-align:bottom}
[data-techdoc] td{padding:7px 9px;border:1px solid var(--bdi);vertical-align:top}
[data-techdoc] th.c,[data-techdoc] td.c{text-align:center}
[data-techdoc] td .e,[data-techdoc] th .e{display:block;font-size:11px;color:var(--tx3);font-family:var(--mono);font-weight:500;margin-top:1px}
[data-techdoc].mode-ko td .e,[data-techdoc].mode-ko th .e,[data-techdoc].mode-ko .hrow span,[data-techdoc].mode-ko .fig .e{display:none}
[data-techdoc].mode-en td .k,[data-techdoc].mode-en th .k{display:none}
[data-techdoc].mode-en td .e,[data-techdoc].mode-en th .e{font-size:12.5px;color:var(--tx)}
[data-techdoc] td.dot{text-align:center;color:var(--pr);font-weight:800} [data-techdoc] td.dot .e{display:none}
[data-techdoc] td.pre{white-space:pre-line;font-family:var(--mono);font-size:12px}
[data-techdoc] tr.hl td{background:var(--prd)} [data-techdoc] tr.gone td{color:#b5bcc8}
[data-techdoc] .notes{font-size:12px;color:var(--tx3);margin-top:8px;display:flex;flex-direction:column;gap:2px}
[data-techdoc] .notes .e{font-family:var(--mono);font-size:11px;margin-left:6px}
[data-techdoc] .fig{margin:0;padding:12px 18px;border-bottom:1px solid var(--bdi);display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
[data-techdoc] .fig img{max-width:min(100%,420px);max-height:260px;height:auto;border:1px solid var(--bd);border-radius:6px;background:#fff;cursor:zoom-in}
[data-techdoc] .fig.big{flex-direction:column} [data-techdoc] .fig.big img{max-width:min(100%,720px);max-height:none}
[data-techdoc] .fig figcaption{flex:1;min-width:180px;font-size:12.5px;color:var(--tx2)}
[data-techdoc] .fig figcaption .tag{margin-right:6px}
[data-techdoc] .fig figcaption .e{display:block;font-size:11px;color:var(--tx3);font-family:var(--mono);margin-top:3px}
[data-techdoc] .fig-wait{width:240px;height:120px;border:1px dashed var(--bd);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--tx3)}
[data-techdoc] .mono{font-family:var(--mono)}
[data-techdoc] mark{background:var(--mark);color:inherit;border-radius:3px;padding:0 1px}
[data-techdoc] .sum ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
[data-techdoc] .sum .ref{font-family:var(--mono);font-size:11.5px;color:#a87100;font-weight:700}
[data-techdoc] .rich p{margin:0} [data-techdoc] .rich small{display:block;color:var(--tx3);font-size:11.5px;font-family:var(--mono);margin-top:4px}
@media (max-width:680px){[data-techdoc] .row{grid-template-columns:minmax(0,1fr)} [data-techdoc] .row .en{border-bottom:1px dashed var(--bdi)}}
`

// ── 검토 · 승인 (v4.221.0) ──
//   pm_tech_doc_review: kind = comment(의견) · approve(검토 완료) · reset(다시 올려 검토 전) · unapprove(검토 취소)
export async function fetchReviews(key) {
  const { data, error } = await supabase.from('pm_tech_doc_review').select('*').eq('doc_key', key).order('created_at', { ascending: false })
  if (error) { if (/pm_tech_doc_review/.test(error.message || '')) return null; throw error }
  return data || []
}
export async function addReview(key, kind, text, by) {
  const { error } = await supabase.from('pm_tech_doc_review').insert({ doc_key: key, kind, body: text || null, by_name: by || null })
  if (error) throw error
}
export async function approveDoc(key, by, note) {
  const t = new Date().toISOString()
  const { error } = await supabase.from('pm_tech_doc').update({ status: '검토 완료', reviewed_by: by || null, reviewed_at: t }).eq('doc_key', key)
  if (error) throw error
  await addReview(key, 'approve', note || '검토 완료', by)
}
export async function unapproveDoc(key, by, why) {
  const { error } = await supabase.from('pm_tech_doc').update({ status: '검토 전', reviewed_by: null, reviewed_at: null }).eq('doc_key', key)
  if (error) throw error
  await addReview(key, 'unapprove', why || '검토 취소', by)
}
export async function setProcess(key, process) {
  const { error } = await supabase.from('pm_tech_doc').update({ process: process || null }).eq('doc_key', key)
  if (error) throw error
}

// ── SOP (작업표준서) — 사내 작성 (v4.221.0) ──
//   pm_tech_doc 한 줄 (kind='sop' · source='사내') + 사진은 pm_tech_doc_img (fig:sop-단계-번호)
//   body: { target, tools, author, steps: [{ title, text, warn, check, ref, photos: ['키'] }], sections: [] }
export async function nextSopNo() {
  const { data } = await supabase.from('pm_tech_doc').select('doc_no').eq('kind', 'sop').like('doc_no', 'JS-SOP-%').order('doc_no', { ascending: false }).limit(1)
  const n = Number(String(data?.[0]?.doc_no || '').replace(/\D/g, '')) || 0
  return `JS-SOP-${String(n + 1).padStart(3, '0')}`
}
export function sopSearchText(f) {
  return [f.doc_no, f.title_ko, f.process, f.target, f.tools, ...(f.steps || []).flatMap((s) => [s.title, s.text, s.warn, s.check, s.ref])].filter(Boolean).join(' \n')
}
// 사진 → 긴 쪽 1280px JPEG (현장 휴대폰 사진이 수 MB 라 줄여서 넣음)
export function photoToJpeg(file, max = 1280, q = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', q))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} — 사진을 읽지 못했습니다`)) }
    img.src = url
  })
}
// 저장 — 새로 쓰면 「검토 전」. 승인(검토 완료)된 SOP 를 고치면 Rev 를 올리고 다시 검토 전으로
export async function saveSop(f, photos, by, prev) {
  const key = prev?.doc_key || `SOP-${f.doc_no}`
  const changed = !!prev
  const rev = changed ? String((Number(prev.tr_rev) || 0) + (prev.status === '검토 완료' ? 1 : 0)) : '1'
  const body = { target: f.target || '', tools: f.tools || '', author: f.author || by || '', steps: f.steps, sections: [], summary: (f.steps || []).filter((s) => s.check || s.warn).slice(0, 8).map((s, i) => [`${s.title ? `<b>${String(s.title).replace(/[<>]/g, '')}</b> — ` : ''}${String(s.check || s.warn).replace(/[<>]/g, '')}`, `${i + 1}단계`]) }
  const row = {
    doc_key: key, source: '사내', kind: 'sop', series: null, part_no: null, sort_no: 0, doc_no: f.doc_no, title: f.title_ko, title_ko: f.title_ko,
    rev, tr_rev: rev, status: '검토 전', access: 'all', process: f.process || null, body, search_text: sopSearchText(f),
    uploaded_by: by || null, updated_at: new Date().toISOString(), reviewed_by: null, reviewed_at: null,
  }
  const { error } = await supabase.from('pm_tech_doc').upsert(row, { onConflict: 'doc_key' })
  if (error) throw error
  // 사진 — 남긴 것만 두고 새 것은 넣음
  const keep = new Set((f.steps || []).flatMap((s) => s.photos || []).map((k) => `fig:${k}`))
  const { data: old } = await supabase.from('pm_tech_doc_img').select('img_key').eq('doc_key', key)
  const drop = (old || []).map((r) => r.img_key).filter((k) => !keep.has(k))
  if (drop.length) { const { error: e2 } = await supabase.from('pm_tech_doc_img').delete().eq('doc_key', key).in('img_key', drop); if (e2) throw e2 }
  const add = Object.entries(photos || {}).filter(([k]) => keep.has(`fig:${k}`))
  for (const [k, v] of add) {
    const { error: e3 } = await supabase.from('pm_tech_doc_img').upsert({ doc_key: key, img_key: `fig:${k}`, kind: 'fig', data: v }, { onConflict: 'doc_key,img_key' })
    if (e3) throw e3
  }
  await addReview(key, 'reset', changed ? `SOP 고침 (Rev ${rev}) — 검토 전으로` : 'SOP 새로 등록 — 검토 기다림', by).catch(() => {})
  return key
}
