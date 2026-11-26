// 포털 데이터를 NAS 에 매일 백업한다 — 수주대장 · 생산관리 · 하네스 진도
//
//   직원들이 포털에 안 들어가도 NAS 에서 엑셀로 열어 볼 수 있게, 그리고 포털에 문제가 생겨도 회사 안에 자료가 남게.
//   NAS 의 사본은 그날 시점 자료다. 고쳐도 포털에는 반영되지 않는다 — 최신 · 수정은 포털에서.
//
//   저장 위치: \\jinsuntech-nas\1. 공용폴더\pm-backup\YYYY-MM-DD\
//     수주대장_YYYYMMDD.xlsx   PO · 품목 · 변경 이력
//     생산관리_YYYYMMDD.xlsx   호기(PD BOX 등) · 그룹 · 대상 품번
//     하네스진도_YYYYMMDD.xlsx  진행 중 하네스 PO 줄별 공정 진도 (HARN ASSY 탭과 같은 줄)
//                               검사까지 끝난 줄 = 「재고」
//
// 쓰는 법
//   node scripts/nas_backup.js           백업
//   node scripts/nas_backup.js --dry     읽기만 하고 파일은 안 만든다 (건수 확인)
//   (작업 스케줄러: scripts/nas_backup.bat 을 하루 한 번)
//
// 필요한 것: 환경변수 SUPABASE_KEY (service_role 키 — nas_upload.js 와 같은 것)
//   anon 키를 쓰면 RLS 에 막혀 빈 표가 나온다 → 표가 0건이면 경고를 남긴다

const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://zlmdxxginskguqqitsbp.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || ''
const NAS_DIR = process.env.PM_BACKUP_DIR || '\\\\jinsuntech-nas\\1. 공용폴더\\pm-backup'
const DRY = process.argv.includes('--dry')

const log = (...a) => console.log(new Date().toLocaleString('ko-KR'), '|', ...a)
const kst = () => new Date(Date.now() + 9 * 3600000)
const ymd = (d) => d.toISOString().slice(0, 10)
const hm = (t) => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600000).toISOString(); return `${d.slice(5, 10)} ${d.slice(11, 16)}` }
const P = (s) => String(s ?? '').trim().toUpperCase()
const N = (s) => String(s ?? '').trim().replace(/\.0$/, '')
const pnOf = (code) => String(code || '').replace(/^AX-/i, '')

// ─────────────────────────────────────────────
// 읽기 — 1000행 제한이 있어 나눠 읽는다
// ─────────────────────────────────────────────
async function readAll(build, label) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(`${label} 읽기 실패: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}
const readTable = (sb, name, order = ['id']) =>
  readAll(() => order.reduce((q, k) => q.order(k, { ascending: true }), sb.from(name).select('*')), name)

async function readIn(sb, table, sel, col, values, size = 150) {
  const out = [], list = [...new Set(values.filter(Boolean))]
  for (let i = 0; i < list.length; i += size) {
    out.push(...await readAll(() => sb.from(table).select(sel).in(col, list.slice(i, i + size)).order('id'), table))
  }
  return out
}

// ─────────────────────────────────────────────
// 엑셀 — 칸 하나는 32,767자까지라 긴 값(JSON 등)은 잘라 둔다
// ─────────────────────────────────────────────
const CELL_MAX = 32000
const cellOf = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') v = JSON.stringify(v)
  if (typeof v === 'string' && v.length > CELL_MAX) return v.slice(0, CELL_MAX) + ' …(잘림)'
  return v
}
function addSheet(wb, name, rows, cols) {
  const keys = cols || [...new Set(rows.flatMap(r => Object.keys(r)))]
  if (!keys.length) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['(자료 없음)']]), name.slice(0, 31)); return }
  const aoa = [keys, ...rows.map(r => keys.map(k => cellOf(r[k])))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = keys.map((k, i) => ({ wch: Math.min(40, Math.max(String(k).length * 2, ...aoa.slice(1, 200).map(r => String(r[i] ?? '').length)) + 2) }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: Math.max(0, keys.length - 1) } }) }
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
}
function warnEmpty(label, rows) { if (!rows.length) log(`  ⚠ ${label} 0건 — service_role 키인지 확인`) }

// ─────────────────────────────────────────────
// 1) 수주대장
// ─────────────────────────────────────────────
async function backupOrders(sb, dir, stamp) {
  const [ord, line, chg] = await Promise.all([
    readTable(sb, 'pm_order'), readTable(sb, 'pm_order_line'), readTable(sb, 'pm_order_change'),
  ])
  log(`수주대장 PO ${ord.length} · 품목 ${line.length} · 변경 ${chg.length}`)
  warnEmpty('수주대장 PO', ord)
  if (DRY) return
  const wb = XLSX.utils.book_new()
  addSheet(wb, '수주대장 PO', ord)
  addSheet(wb, '수주대장 품목', line)
  addSheet(wb, '변경 이력', chg)
  XLSX.writeFile(wb, path.join(dir, `수주대장_${stamp}.xlsx`))
}

// ─────────────────────────────────────────────
// 2) 생산관리
// ─────────────────────────────────────────────
async function backupProduction(sb, dir, stamp) {
  const [prod, grp, tgt] = await Promise.all([
    readTable(sb, 'production'), readTable(sb, 'pm_prod_group').catch(() => []), readTable(sb, 'pm_prod_target').catch(() => []),
  ])
  log(`생산관리 호기 ${prod.length} · 그룹 ${grp.length} · 대상 품번 ${tgt.length}`)
  warnEmpty('생산관리 호기', prod)
  if (DRY) return
  const wb = XLSX.utils.book_new()
  addSheet(wb, '호기', prod)
  if (grp.length) addSheet(wb, '그룹', grp)
  if (tgt.length) addSheet(wb, '대상 품번', tgt)
  XLSX.writeFile(wb, path.join(dir, `생산관리_${stamp}.xlsx`))
}

// ─────────────────────────────────────────────
// 3) 하네스 진도 — HARN ASSY 탭과 같은 줄 · 같은 기준
//    줄: AXCELIS 진행 중 수주대장 줄 중 하네스(16…) · 생산관리 호기 안 붙은 줄 · 완료/취소 아님
//    공정: 하네스 공정관리 QR 스캔(harness_logs) · 공정 순서상 가장 뒤까지 간 공정 = 지금 공정
//    상태: 검사(또는 그 뒤 공정)까지 끝 = 재고 · 그 전 = 진행중 · 스캔 없음 = 미착수
// ─────────────────────────────────────────────
const STEPS = ['재단', '납땜', '제작', '검사', '포장', '출하', '납품']
const rank = (p) => { const i = STEPS.indexOf(p); return i < 0 ? STEPS.length : i }
const INSP = STEPS.indexOf('검사')

async function axLines(sb) {
  const rows = await readAll(() => sb.rpc('pm_ax_order_lines', { p_po_nos: null }).order('id'), '수주대장 줄(pm_ax_order_lines)')
  const items = {}
  for (const it of await readIn(sb, 'items', 'id,std_code,name', 'id', rows.map(r => r.item_id))) items[it.id] = it
  const prod = await readIn(sb, 'production', 'id,order_line_id', 'order_line_id', rows.map(r => r.id)).catch(() => [])
  const byProd = new Set(prod.map(r => r.order_line_id))
  return rows.map(r => ({ ...r, items: items[r.item_id] || null, in_prod: !!r.in_prod || byProd.has(r.id) }))
}

async function backupHarness(sb, dir, stamp) {
  const lines = (await axLines(sb)).filter(p => !p.in_prod && pnOf(p.items?.std_code).startsWith('16') && p.status !== '완료' && p.status !== '취소')
  const logs = await readIn(sb, 'harness_logs', 'id,dwg_no,po,ord_ln,del_ln,process,started_at,ended_at,worker', 'po', [...new Set(lines.map(p => String(p.po_number || '').trim()))])
  log(`하네스 진행 줄 ${lines.length} · 공정 스캔 ${logs.length}`)
  warnEmpty('하네스 진행 줄', lines)

  const byLine = new Map(), byDwg = new Map()
  for (const l of logs) {
    const po = P(l.po); if (!po) continue
    const k = N(l.ord_ln) ? `${po}|${N(l.ord_ln)}|${N(l.del_ln) || '1'}` : `${po}|${P(l.dwg_no)}`
    const m = N(l.ord_ln) ? byLine : byDwg
    if (!m.has(k)) m.set(k, []); m.get(k).push(l)
  }

  const out = [], raw = []
  for (const p of lines) {
    const list = byLine.get(`${P(p.po_number)}|${N(p.order_line)}|${N(p.del_line) || '1'}`) || byDwg.get(`${P(p.po_number)}|${P(pnOf(p.items?.std_code))}`) || []
    const work = list.filter(l => String(l.process || '').trim() && String(l.process).trim() !== '출도')
    const done = {}   // 공정 → 끝난 가장 최근 시각
    for (const l of work) {
      const n = String(l.process).trim(), t = l.ended_at
      if (t && (!done[n] || t > done[n])) done[n] = t
    }
    // 지금 공정 = 공정 순서상 가장 뒤 (HARN ASSY 와 같게)
    let cur = null
    for (const l of work) {
      const n = String(l.process).trim(); if (rank(n) >= STEPS.length) continue
      const t = l.ended_at || l.started_at || ''
      if (!cur || rank(n) > rank(cur.n) || (rank(n) === rank(cur.n) && t >= cur.t)) cur = { n, t, open: !l.ended_at, who: l.worker || '' }
    }
    const top = Math.max(-1, ...Object.keys(done).map(rank).filter(r => r < STEPS.length))
    const state = top >= INSP ? '재고' : work.length ? '진행중' : '미착수'
    const recent = work.reduce((m, l) => { const t = l.ended_at || l.started_at || ''; return t > m ? t : m }, '')
    const row = {
      '상태': state,
      'PO': p.po_number, 'Line': N(p.order_line), 'Del': N(p.del_line) || '1',
      '품번': pnOf(p.items?.std_code), '품명': p.items?.name || '', 'Rev': p.item_rev || '',
      '수량': Number(p.qty_ordered) || 0, '잔량': Number(p.qty_remaining) || 0,
      'promise': p.promise_date ? String(p.promise_date).slice(0, 10) : '',
      '불출': p.material_issued ? 'Y' : '',
      '지금 공정': cur ? `${cur.n} ${cur.open ? '진행 중' : '끝'}` : '',
      '지금 공정 작업자': cur?.who || '',
      '최근 스캔': hm(recent),
    }
    for (const s of ['재단', '납땜', '제작', '검사', '포장', '납품']) row[s] = done[s] ? hm(done[s]) : ''
    out.push(row)
    for (const l of work) raw.push({ PO: p.po_number, Line: N(p.order_line), Del: N(p.del_line) || '1', '품번': pnOf(p.items?.std_code),
      '공정': String(l.process).trim(), '작업자': l.worker || '', '시작': hm(l.started_at), '끝': hm(l.ended_at) })
  }
  const order = { '재고': 0, '진행중': 1, '미착수': 2 }
  out.sort((a, b) => order[a['상태']] - order[b['상태']] || String(a.PO).localeCompare(String(b.PO)) || Number(a.Line) - Number(b.Line))
  const cnt = (s) => out.filter(r => r['상태'] === s).length
  log(`  재고 ${cnt('재고')} · 진행중 ${cnt('진행중')} · 미착수 ${cnt('미착수')}`)
  if (DRY) return

  const wb = XLSX.utils.book_new()
  const sum = [
    { '구분': '재고 (검사까지 끝)', '건수': cnt('재고') },
    { '구분': '진행중 (검사 전)', '건수': cnt('진행중') },
    { '구분': '미착수 (스캔 없음)', '건수': cnt('미착수') },
    { '구분': '합계', '건수': out.length },
    { '구분': '', '건수': '' },
    { '구분': `기준: ${ymd(kst())} 백업 시점 · 포털 HARN ASSY 탭과 같은 줄 · 하네스 공정관리 QR 스캔 기준`, '건수': '' },
    { '구분': '재고 = 검사(또는 그 뒤 공정)까지 「끝」으로 찍힌 줄 · 공정 칸 = 그 공정이 끝난 시각', '건수': '' },
    { '구분': 'NAS 파일은 사본 — 고쳐도 포털에는 반영되지 않음', '건수': '' },
  ]
  addSheet(wb, '요약', sum, ['구분', '건수'])
  addSheet(wb, '줄별 진도', out)
  addSheet(wb, '재고', out.filter(r => r['상태'] === '재고'))
  addSheet(wb, '스캔 기록', raw)
  XLSX.writeFile(wb, path.join(dir, `하네스진도_${stamp}.xlsx`))
}

// ─────────────────────────────────────────────
;(async () => {
  if (!SUPABASE_KEY) { console.error('SUPABASE_KEY 환경변수가 없습니다'); process.exit(1) }
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  const day = ymd(kst()), stamp = day.replace(/-/g, '')
  const dir = path.join(NAS_DIR, day)
  log(DRY ? '── 확인만 (파일 안 만듦) ──' : `── 백업 시작 → ${dir} ──`)
  if (!DRY) {
    if (!fs.existsSync(NAS_DIR)) { log(`  ✕ NAS 폴더에 접근할 수 없습니다: ${NAS_DIR} (네트워크 · 계정 확인)`); process.exit(1) }
    fs.mkdirSync(dir, { recursive: true })
  }
  let fail = 0
  for (const [name, fn] of [['수주대장', backupOrders], ['생산관리', backupProduction], ['하네스 진도', backupHarness]]) {
    try { await fn(sb, dir, stamp) } catch (e) { fail++; log(`  ✕ ${name} 실패: ${e.message}`) }
  }
  if (!DRY) {
    try { fs.appendFileSync(path.join(NAS_DIR, '백업기록.txt'), `${new Date().toLocaleString('ko-KR')} ${fail ? `실패 ${fail}` : '완료'}\r\n`) } catch {}
  }
  log(fail ? `── 끝 (실패 ${fail}) ──` : '── 끝 ──')
  process.exit(fail ? 1 : 0)
})()
