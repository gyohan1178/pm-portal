import { useState, useEffect } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomer } from '../../hooks/useCustomers'
import { useCanEdit } from '../../hooks/useProfile'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { downloadCsvTemplate, TEMPLATES } from '../../lib/csvTemplate'
import { parseAxcelisReport } from '../../lib/axcelisBomReport'
import { fetchDrawingRevs, compareRev, REV_STATE } from '../../lib/revCompare'
import { supabase } from '../../lib/supabase'
import { levelCls, catStyle, indentOf, deptStyle, deptShort } from '../../lib/bomStyle'
import { logActivity } from '../../lib/activityLog'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'
import CustomerTabs from '../../components/CustomerTabs'

// BOM 수량 파싱 — 숫자는 그대로(0 포함), 빈칸/문자(A/R 등)는 0으로.
// 주의: `|| 1` 쓰면 안 됨 (0이 falsy라 1로 둔갑). 명시적으로 숫자만 취함.
function parseBomQty(v) {
  if (v === null || v === undefined) return 0
  const s = String(v).trim()
  if (s === '') return 0
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0   // A/R 등 문자 → 0
}

// 세부구분별 색상 (BOM 조회 뱃지)

// 등록된 어셈블리 목록 (projects + BOM 품목수, RPC 한 방)
async function fetchAssemblies(customerId) {
  const { data, error } = await supabase.rpc('get_bom_assemblies', { cs_id: customerId })
  if (error) throw error
  const list = (data || []).map(p => ({
    id: p.id, code: p.code, name: p.name, rev: p.rev,
    created_at: p.created_at, itemCount: Number(p.item_count) || 0,
  }))
  // 어셈블리명을 DB(items)에서 보충 — 코드(std_code) 기준 단일 소스
  const codes = list.map(p => p.code).filter(Boolean)
  const nameMap = {}
  for (let i = 0; i < codes.length; i += 300) {
    const { data: items } = await supabase.from('items').select('std_code,name').in('std_code', codes.slice(i, i + 300))
    ;(items || []).forEach(it => { if (it.name) nameMap[it.std_code] = it.name })
  }
  return list.map(p => ({ ...p, name: nameMap[p.code] || p.name || '' }))
}

// 특정 어셈블리의 BOM 세부항목
async function fetchBOMDetail(customerId, projectId) {
  if (!projectId) return []
  const data = await fetchAll(() => supabase
    .from('bom')
    .select('*, items!bom_item_id_fkey(std_code, name, type, category, unit, lt_weeks, manufacturer, manufacturer_code, dept)')
    .eq('customer_id', customerId)
    .eq('project_id', projectId)
    .order('seq')
    .order('created_at'))
  return data || []
}

// BOM 세부항목 CSV 추출
function exportDetailCSV(rows, assembly) {
  if (!rows?.length) return
  const data = rows.map(b => ({
    LV: b.level, 코드: b.items?.std_code || '', 품명: b.items?.name || '',
    구분: b.items?.category || b.items?.type || '', 단위: b.items?.unit || '',
    제조사: b.items?.manufacturer || '', 제조사코드: b.items?.manufacturer_code || '',
    소요량: b.qty_per_unit,
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'BOM')
  XLSX.writeFile(wb, `BOM_${assembly?.code || 'export'}.csv`)
}

// 어셈블리 전체 삭제 (BOM 전체 + project)
async function deleteAssembly(customerId, projectId) {
  const { error: bomErr } = await supabase
    .from('bom')
    .delete()
    .eq('customer_id', customerId)
    .eq('project_id', projectId)
  if (bomErr) throw bomErr

  const { error: projErr } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
  if (projErr) throw projErr
}

// 품번 앞에 고객사 접두를 붙인다.
//   AX- 로 고정돼 있어 Edwards BOM 을 올려도 AX- 가 붙었다.
const PREFIX = { ax: 'AX-', ed: 'ED-', csk: 'CS-', vm: 'VM-' }
const withPrefix = (pn, pre) => {
  const t = String(pn || '').replace(/\.0$/, '').trim()
  if (!t) return ''
  if (!pre) return t
  // 이미 어느 접두든 붙어 있으면 그대로 둔다
  return /^(AX|ED|CS|VM)-/i.test(t) ? t : pre + t
}
const truthyYN = (v) => /^(y|yes|true|1|o|예)$/i.test(String(v || '').trim())

// AXCELIS Part Report(HTM) → saveBOMMulti 가 받는 행 형식으로 변환.
// 저장 로직은 CSV 업로드와 100% 동일한 경로를 탄다(신규품목 자동등록·배치·중복방어 포함).
function htmToBomRows(parsed) {
  const bare = (c) => String(c || '').replace(/^AX-/, '')
  const rows = []
  let no = 0
  for (const g of parsed.groups) {
    const parentPn = bare(g.parentCode)
    // 어셈블리 자기행 — saveBOMMulti 가 여기서 프로젝트명·REV 를 읽는다
    rows.push({
      NO: String(++no), LEVEL: 0, '상위PN': parentPn, PN: parentPn,
      Description: g.parentName, REV: g.parentRev || 'A',
      QTY: 1, UNIT: 'EA', MFG: '', 'MFG PN': '', '상위품명': g.parentName,
    })
    // 하위 전체를 상대 레벨 그대로 넣는다 (서브어셈블리 안쪽까지 전개).
    // 중간 어셈블리 행은 원가 합산에서 자동 제외되므로 중복 계산되지 않는다.
    for (const c of g.descendants) {
      rows.push({
        NO: String(++no), LEVEL: c.relLevel, '상위PN': parentPn, PN: bare(c.code),
        Description: c.name, REV: c.rev || '', 개정: c.edition,
        QTY: c.qty, UNIT: c.unit || 'EA',
        MFG: c.mfr || '', 'MFG PN': c.mfrPn || '', '상위품명': g.parentName,
      })
    }
  }
  return rows
}

// 이미 등록된 품목의 "빈" 제조사 정보만 HTM 값으로 채운다.
// 값이 들어있는 품목은 절대 건드리지 않는다 — 손으로 정리해둔 데이터가
// 리포트를 올릴 때마다 덮어써지면 안 되기 때문. 빈칸 → 채움, 그것만 한다.
async function fillMissingMfr(parsed) {
  const src = {}
  for (const p of parsed.parts) {
    if (!p.code || src[p.code]) continue
    if (p.mfr || p.mfrPn) src[p.code] = { mfr: p.mfr, mfrPn: p.mfrPn }
  }
  const codes = Object.keys(src)
  if (!codes.length) return { filled: 0, checked: 0 }

  const existing = []
  for (let i = 0; i < codes.length; i += 200) {
    const { data } = await supabase
      .from('items')
      .select('id, std_code, manufacturer, manufacturer_code')
      .in('std_code', codes.slice(i, i + 200))
    existing.push(...(data || []))
  }

  const blank = (v) => !String(v ?? '').trim()
  let filled = 0
  for (const it of existing) {
    const s = src[it.std_code]
    if (!s) continue
    const patch = {}
    if (blank(it.manufacturer) && s.mfr) patch.manufacturer = s.mfr
    if (blank(it.manufacturer_code) && s.mfrPn) patch.manufacturer_code = s.mfrPn
    if (!Object.keys(patch).length) continue
    const { error } = await supabase.from('items').update(patch).eq('id', it.id)
    if (!error) filled++
  }
  return { filled, checked: existing.length }
}

// HTM 은 UTF-8 이 아닌 경우가 있어(Non-ISO extended-ASCII) 디코딩을 이중으로 시도
function decodeHtm(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  if (!utf8.includes('\uFFFD')) return utf8
  try { return new TextDecoder('windows-1252').decode(buf) } catch { return utf8 }
}

// 다중 어셈블리 BOM 저장 — 배치 처리로 대량(만 단위) 빠르게
async function saveBOMMulti({ rows, customerId, csCode, onProgress }) {
  const PRE = PREFIX[String(csCode || '').toLowerCase()] || ''
  const AX = (pn) => withPrefix(pn, PRE)
  // 1) 상위PN 그룹
  const groups = {}
  for (const r of rows) {
    const parent = AX(r['상위PN'] ?? r['상위품번'])
    if (!parent) continue
    ;(groups[parent] = groups[parent] || []).push(r)
  }
  const parentCodes = Object.keys(groups)
  let asmCount = 0, saved = 0, skipped = 0, newItems = 0

  onProgress?.('어셈블리 등록 중...')
  // 2) 프로젝트(어셈블리) 일괄 upsert
  const projRows = parentCodes.map(code => {
    const lines = groups[code]
    // 어셈블리명·REV = 자기행(PN==상위PN)의 Description·REV
    const selfRow = lines.find(r => AX(r['PN'] ?? r['하위품번']) === code)
    return {
      customer_id: customerId, code,
      name: String(selfRow?.['Description'] || selfRow?.['품명'] || lines[0]['상위품명'] || lines[0]['Parent Desc'] || '').trim(),
      rev: String((selfRow?.['REV'] ?? lines[0]['REV']) || 'A').trim(),
      status: '진행중', start_date: new Date().toISOString().split('T')[0],
    }
  })
  // upsert는 한 번에 (onConflict customer_id,code)
  const { error: pErr } = await supabase.from('projects').upsert(projRows, { onConflict: 'customer_id,code', ignoreDuplicates: false })
  if (pErr) throw new Error('어셈블리(프로젝트) 저장 실패: ' + pErr.message)
  // 프로젝트 id 맵 확보
  const projMap = {}
  for (let i = 0; i < parentCodes.length; i += 500) {
    const chunk = parentCodes.slice(i, i + 500)
    const { data } = await supabase.from('projects').select('id,code').eq('customer_id', customerId).in('code', chunk)
    ;(data || []).forEach(p => { projMap[p.code] = p.id })
  }
  asmCount = Object.keys(projMap).length

  onProgress?.('품목 확인 중...')
  // 3) 모든 PN 수집 → 기존 품목 한 번에 조회 (배치)
  const allPNs = new Set()
  const rowMeta = {}  // code → 첫 등장 메타(신규 생성용)
  for (const code of parentCodes) {
    for (const row of groups[code]) {
      const pn = AX(row['PN'] ?? row['하위품번'])
      if (!pn) continue
      allPNs.add(pn)
      if (!rowMeta[pn]) {
        const mfg = String(row['MFG'] ?? row['제조사'] ?? '').trim()
        const mfgpn = String(row['MFG PN'] ?? row['제조사품번'] ?? '').trim()
        rowMeta[pn] = {
          std_code: pn,
          name: String(row['Description'] ?? row['품명'] ?? '').trim(),
          type: '자재',
          category: String(row['Category'] ?? row['카테고리'] ?? row['구분'] ?? '').trim() || null,
          unit: String(row['UNIT'] ?? row['단위'] ?? 'EA').trim() || 'EA',
          manufacturer: mfg || null, manufacturer_code: mfgpn || null,
          spec: [mfg, mfgpn].filter(Boolean).join(' ') || null,
          stock_managed: row['관리대상'] != null ? truthyYN(row['관리대상']) : true,
          memo: String(row['Category'] ?? '').trim() ? `cat:${String(row['Category']).trim()}` : null,
        }
      }
    }
  }
  const pnArr = [...allPNs]
  const itemMap = {}  // std_code → id
  for (let i = 0; i < pnArr.length; i += 500) {
    const chunk = pnArr.slice(i, i + 500)
    const { data } = await supabase.from('items').select('id,std_code').in('std_code', chunk)
    ;(data || []).forEach(it => { itemMap[it.std_code] = it.id })
  }

  // 4) 없는 품목만 모아서 일괄 insert
  const toCreate = pnArr.filter(pn => !itemMap[pn]).map(pn => rowMeta[pn])
  onProgress?.(`신규 품목 ${toCreate.length}개 등록 중...`)
  for (let i = 0; i < toCreate.length; i += 500) {
    const chunk = toCreate.slice(i, i + 500)
    const { data, error: iErr } = await supabase.from('items').insert(chunk).select('id,std_code')
    if (iErr) throw new Error('신규 품목 등록 실패: ' + iErr.message)
    ;(data || []).forEach(it => { itemMap[it.std_code] = it.id; newItems++ })
  }

  onProgress?.('기존 BOM 정리 중...')
  // 5) 업로드 대상 어셈블리의 기존 BOM 일괄 삭제
  const projIds = Object.values(projMap)
  // 지우기 전에 기록을 남긴다. 예전에 1,626행을 잃은 적이 있다.
  let snapId = null, snapCnt = 0
  for (let i = 0; i < projIds.length; i += 200) {
    const { data: sd, error: dErr } = await supabase.rpc('pm_bom_delete_safe', {
      p_customer_id: customerId,
      p_project_ids: projIds.slice(i, i + 200),
    })
    if (dErr) throw new Error('기존 BOM 정리 실패: ' + dErr.message)
    const r = Array.isArray(sd) ? sd[0] : sd
    if (r?.snap_id) { snapId = r.snap_id; snapCnt += Number(r.cnt) || 0 }
  }
  if (snapId) onProgress?.(`기존 BOM ${snapCnt}건 정리 (복구 #${snapId})`)

  // 6) BOM 행 전부 구성 (dedup 포함) → 일괄 insert
  onProgress?.('BOM 저장 중...')
  const bomRows = []
  for (const code of parentCodes) {
    const projId = projMap[code]
    if (!projId) { skipped += groups[code].length; continue }
    let lines = groups[code]

    // 균일 N배 복제 방어 (모든 NO가 동일 횟수일 때만 1세트로)
    const noList = lines.map(r => String(r['NO'] ?? '').trim())
    if (noList.every(n => n !== '')) {
      const cnt = {}; noList.forEach(n => { cnt[n] = (cnt[n] || 0) + 1 })
      const counts = Object.values(cnt)
      if (counts.every(c => c === counts[0]) && counts[0] > 1) {
        const seen = new Set()
        lines = lines.filter(r => { const no = String(r['NO']).trim(); if (seen.has(no)) return false; seen.add(no); return true })
      }
    }

    let ord = 0
    for (const row of lines) {
      const pn = AX(row['PN'] ?? row['하위품번'])
      if (pn === code) continue   // 자기행(어셈블리 자신) 제외 — 부품 아님
      const itemId = itemMap[pn]
      if (!itemId) { skipped++; continue }
      bomRows.push({
        customer_id: customerId, project_id: projId, item_id: itemId,
        qty_per_unit: parseBomQty(row['실수량'] ?? row['QTY'] ?? row['수량']),
        level: parseInt(row['LEVEL'] ?? row['LV'] ?? 1) || 1,
        seq: ord++,   // 파일(트리) 순서 보존 → 상세에서 레벨 중첩 표시
        // 이 BOM 행이 요구하는 부품 REV — NAS 최신 도면과 대조하는 근거
        item_rev: (() => {
          const v = String(row['REV'] ?? '').trim().toUpperCase()
          return /^[A-Z]{1,2}$/.test(v) ? v : null
        })(),
        item_edition: (() => {
          const v = row['개정'] ?? row['EDITION']
          return v == null || v === '' || isNaN(Number(v)) ? null : Number(v)
        })(),
      })
    }
  }
  // 일괄 insert (500씩)
  for (let i = 0; i < bomRows.length; i += 500) {
    const chunk = bomRows.slice(i, i + 500)
    const { error } = await supabase.from('bom').insert(chunk)
    if (error) skipped += chunk.length; else saved += chunk.length
    onProgress?.(`BOM 저장 중... ${Math.min(i + 500, bomRows.length)}/${bomRows.length}`)
  }

  return { asmCount, saved, skipped, newItems }
}

// (구) 단일 어셈블리 BOM 저장
async function saveBOM({ rows, customerId, projectCode, projectName, rev }) {
  // 프로젝트 생성/업데이트
  const { data: proj, error: projErr } = await supabase
    .from('projects')
    .upsert({ customer_id: customerId, code: projectCode, name: projectName, rev: rev || 'A', status: '진행중', start_date: new Date().toISOString().split('T')[0] },
      { onConflict: 'customer_id,code', ignoreDuplicates: false })
    .select('id').single()
  if (projErr) throw projErr

  let saved = 0, skipped = 0
  for (const row of rows) {
    const customerCode = String(row['하위품번'] || '').trim()
    const name = String(row['품명'] || '').trim()
    const qty = parseBomQty(row['수량'])
    const level = parseInt(row['LV'] || 1) || 1
    const unit = String(row['단위'] || 'EA').trim()
    const manufacturer = String(row['제조사'] || '').trim()
    const mfrCode = String(row['제조사품번'] || '').trim()
    if (!customerCode || !name) { skipped++; continue }
    try {
      const { data: existing } = await supabase
        .from('customer_item_codes').select('item_id')
        .eq('customer_id', customerId).eq('customer_code', customerCode).single()
      let itemId = existing?.item_id
      if (!itemId) {
        const { data: newItem, error: ie } = await supabase.from('items')
          .upsert({ std_code: customerCode, name, type: '자재', unit,
            manufacturer: manufacturer || null, manufacturer_code: mfrCode || null },
            { onConflict: 'std_code' }).select('id').single()
        if (ie || !newItem) { skipped++; continue }
        itemId = newItem.id
        await supabase.from('customer_item_codes').upsert(
          { item_id: itemId, customer_id: customerId, customer_code: customerCode, customer_name: name },
          { onConflict: 'customer_id,customer_code', ignoreDuplicates: true })
      }
      await supabase.from('bom').insert({
        customer_id: customerId, project_id: proj.id,
        item_id: itemId, qty_per_unit: qty, level,
      })
      saved++
    } catch { skipped++ }
  }
  return { saved, skipped }
}


export default function BOM() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [tab, setTab] = useState('list')
  const [selAssembly, setSelAssembly] = useState(null)
  const [preview, setPreview] = useState(null)
  const [rawRows, setRawRows] = useState([])
  const [csvMeta, setCsvMeta] = useState({ code:'', name:'', rev:'A' })
  const [uploading, setUploading] = useState(false)
  const [asmSearch, setAsmSearch] = useState('')

  const [detailSearch, setDetailSearch] = useState('')
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState('')

  const { data: cs } = useCustomer(csCode)
  const { data: assemblies = [], isLoading: asmLoading } = useQuery({
    queryKey: ['assemblies', cs?.id],
    queryFn: () => fetchAssemblies(cs?.id),
    enabled: !!cs?.id,
  })
  // 역전개에서 ?assembly=코드 로 진입 시 해당 어셈블리 자동 선택
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const code = searchParams.get('assembly')
    if (code && assemblies.length) {
      const hit = assemblies.find(a => a.code === code)
      if (hit) { setSelAssembly(hit); setTab('detail'); setSearchParams({}, { replace: true }) }
    }
  }, [searchParams, assemblies])
  const { data: bomDetail = [], isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['bomDetail', cs?.id, selAssembly?.id],
    queryFn: () => fetchBOMDetail(cs?.id, selAssembly?.id),
    enabled: !!cs?.id && !!selAssembly?.id,
  })

  // 세부 항목 부품들의 NAS 최신 도면 (1쿼리). BOM이 요구하는 REV와 대조한다.
  const { data: dwMap = {} } = useQuery({
    queryKey: ['bomDrawings', selAssembly?.id, bomDetail.length],
    enabled: !!selAssembly?.id && bomDetail.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchDrawingRevs(bomDetail.map(b => b.items?.std_code)),
  })

  // ── 하위 어셈블리 BOM 생성 ──────────────────────
  // 리포트에는 다단 구조(LV1→LV2→LV3)가 들어오지만 하위 ASSY 는 자기 BOM 이 없다.
  // 상위 BOM 의 모자관계를 떼어내 하위 BOM 을 만들면 하위 ASSY 단독 원가를 볼 수 있다.
  const [subBomBusy, setSubBomBusy] = useState(false)
  const [subBomResult, setSubBomResult] = useState(null)

  // 이 어셈블리에 만들 대상 — 신규 / 이미 있는 것(덮어쓰기 대상)
  const [subOverwrite, setSubOverwrite] = useState(false)
  const { data: subStat = { new_count: 0, existing_count: 0 } } = useQuery({
    queryKey: ['subBomPending', selAssembly?.code, bomDetail.length],
    enabled: !!selAssembly?.code && bomDetail.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_sub_bom_pending', { p_source_code: selAssembly.code })
      if (error) return { new_count: 0, existing_count: 0 }
      return data?.[0] || { new_count: 0, existing_count: 0 }
    },
  })
  const subPending = (subStat.new_count || 0) + (subOverwrite ? (subStat.existing_count || 0) : 0)

  const [subProgress, setSubProgress] = useState(null)   // {done, total}

  // 하위 어셈블리를 하나씩 처리한다.
  // 한 번에 모두 만들면 큰 BOM 에서 타임아웃이 나므로 순서대로 나눠 호출한다.
  async function buildSubBom() {
    if (!selAssembly?.code) return
    const msg = subOverwrite
      ? `${selAssembly.code} 안의 하위 어셈블리 BOM 을 다시 만듭니다.\n\n· 신규 ${subStat.new_count}건\n· 기존 ${subStat.existing_count}건은 지우고 새로 생성\n\n⚠ 대체품 교체 등 직접 수정한 내용도 함께 사라집니다.\n되돌릴 수 없습니다. 계속할까요?`
      : `${selAssembly.code} 안의 하위 어셈블리 ${subStat.new_count}건에 BOM 을 생성합니다.\n\n· 상위 BOM 의 모자관계를 그대로 가져옵니다\n· 이미 BOM 이 있는 어셈블리는 건너뜁니다\n\n계속할까요?`
    if (!confirm(msg)) return

    setSubBomBusy(true); setSubBomResult(null); setSubProgress(null)
    try {
      // ① 처리할 목록을 먼저 받는다
      const { data: list, error: e1 } = await supabase.rpc('pm_sub_bom_list', { p_source_code: selAssembly.code })
      if (e1) throw e1

      const targets = (list || []).filter(x => subOverwrite || !x.has_bom)
      if (!targets.length) { toastError('처리할 하위 어셈블리가 없습니다'); return }

      // ② 하나씩 생성 (타임아웃 방지)
      const done = []
      for (let i = 0; i < targets.length; i++) {
        setSubProgress({ done: i, total: targets.length, now: targets[i].assy_code })
        const { data, error } = await supabase.rpc('pm_build_sub_bom_one', {
          p_source_code: selAssembly.code,
          p_assy_code: targets[i].assy_code,
          p_overwrite: subOverwrite,
        })
        if (error) throw new Error(`${targets[i].assy_code}: ${error.message}`)
        if (data?.[0]) done.push(data[0])
      }

      const total = done.reduce((a, r) => a + (r.rows_created || 0), 0)
      const repl = done.filter(r => r.replaced).length
      setSubBomResult({ count: done.length, total, list: done, replaced: repl })
      logActivity('create', 'bom', selAssembly.code,
        `하위 ASSY BOM ${done.length}건 생성 · 부품 ${total}행${repl ? ` (갱신 ${repl})` : ''}`, null, cs?.name)
      toastSuccess(`하위 어셈블리 ${done.length}건 · 부품 ${total}행${repl ? ` (갱신 ${repl}건)` : ''}`)
      qc.invalidateQueries({ queryKey: ['subBomPending'], exact: false })
      qc.invalidateQueries({ queryKey: ['assemblies'], exact: false })
    } catch (e) {
      toastError('생성 실패: ' + e.message)
    } finally { setSubBomBusy(false); setSubProgress(null) }
  }

  // ── BOM 행 편집 ─────────────────────────────────
  // 대체품 사용 등으로 등록 후 수정이 필요한 경우.
  // 재업로드하면 어셈블리 전체가 갈아끼워지므로, 여기서 고친 내용은
  // 같은 리포트를 다시 올리면 사라진다. (대체품은 보통 리포트에 없으므로 주의)
  const canEdit = useCanEdit()
  const [editRow, setEditRow] = useState(null)      // 편집 중인 bom 행
  const [addOpen, setAddOpen] = useState(false)
  const [pnHit, setPnHit] = useState(null)          // 품번 조회 결과

  // 품번으로 items 조회 (AX- 접두 자동 처리)
  async function lookupItem(code) {
    const raw = String(code || '').trim().toUpperCase()
    if (!raw) return null
    const pre = PREFIX[String(csCode || '').toLowerCase()] || ''
    const cand = /^(AX|ED|CS|VM)-/i.test(raw) ? [raw] : (pre ? [pre + raw, raw] : [raw])
    for (const c of cand) {
      const { data } = await supabase.from('items')
        .select('id, std_code, name, unit, manufacturer, manufacturer_code, category, type')
        .eq('std_code', c).maybeSingle()
      if (data) return data
    }
    return null
  }

  const rowMut = useMutation({
    mutationFn: async ({ action, row, patch }) => {
      if (action === 'update') {
        const { error } = await supabase.from('bom').update(patch).eq('id', row.id)
        if (error) throw error
      } else if (action === 'delete') {
        const { error } = await supabase.from('bom').delete().eq('id', row.id)
        if (error) throw error
      } else if (action === 'insert') {
        const { error } = await supabase.from('bom').insert(patch)
        if (error) throw error
      }
    },
    onSuccess: (_, v) => {
      logActivity(v.action === 'delete' ? 'delete' : v.action === 'insert' ? 'create' : 'update',
        'bom', selAssembly?.code,
        `${v.action === 'delete' ? '행 삭제' : v.action === 'insert' ? '행 추가' : '행 수정'} ${v.row?.items?.std_code || ''}`,
        null, cs?.name)
      qc.invalidateQueries({ queryKey: ['bomDetail'], exact: false })
      qc.invalidateQueries({ queryKey: ['ca-bom'], exact: false })
      setEditRow(null); setAddOpen(false); setPnHit(null)
      toastSuccess(v.action === 'delete' ? '행을 삭제했습니다' : v.action === 'insert' ? '행을 추가했습니다' : '수정했습니다')
    },
    onError: (e) => toastError('BOM 수정 실패: ' + e.message),
  })

  const deleteMut = useMutation({
    mutationFn: ({ customerId, projectId }) => deleteAssembly(customerId, projectId),
    onSuccess: () => {
      qc.invalidateQueries(['assemblies', cs?.id])
      if (selAssembly) setSelAssembly(null)
    },
    onError: (e) => toastError('삭제 오류: ' + e.message),
  })

  const saveMut = useMutation({
    mutationFn: async (rows) => {
      const res = await saveBOMMulti({ rows, customerId: cs?.id, csCode, onProgress: setProgress })
      // HTM 업로드 + 옵션 켜짐일 때만, 기존 품목의 빈 제조사 채우기
      if (htmInfo && fillMfr) {
        setProgress('제조사 빈칸 채우는 중...')
        try {
          const r = await fillMissingMfr(htmInfo)
          res.mfrFilled = r.filled
        } catch { /* 채우기 실패는 BOM 저장 결과에 영향 주지 않음 */ }
      }
      return res
    },
    onSuccess: (res) => {
      setResult(res); setPreview(null); setRawRows([]); setProgress(''); setHtmInfo(null)
      qc.invalidateQueries(['assemblies', cs?.id])
    },
    onError: (e) => { setProgress(''); toastError('저장 오류: ' + e.message) },
  })

  const [htmInfo, setHtmInfo] = useState(null)
  const [fillMfr, setFillMfr] = useState(true)

  // AXCELIS Part Report (HTM) 업로드
  async function handleHtmFile(e) {
    const file = e.target.files[0]; if (!file) return
    setUploading(true); setResult(null); setHtmInfo(null)
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseAxcelisReport(decodeHtm(buf))
      if (!parsed.parts.length) throw new Error('Part 행을 찾지 못했습니다. AXCELIS Part Report 형식이 맞는지 확인해주세요.')
      if (!parsed.groups.length) throw new Error('하위 품목이 없습니다. 단품 리포트는 BOM 등록 대상이 아닙니다.')

      const rows = htmToBomRows(parsed)
      setRawRows(rows)
      setHtmInfo(parsed)
      setPreview({
        total: rows.filter(r => r.LEVEL !== 0).length,
        groups: parsed.groups.map(g => ({
          code: g.parentCode, name: g.parentName,
          rev: g.parentRev || 'A', count: g.children.length,
        })),
        rows,
      })
    } catch (err) {
      toastError('HTM 파싱 실패: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0]; if (!file) return
    setUploading(true); setResult(null)
    try {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        setRawRows(rows)
        // 상위PN별 그룹 요약 (다중 어셈블리)
        const parentKey = (r) => String(r['상위PN'] ?? r['상위품번'] ?? '').replace(/\.0$/, '').trim()
        const childKey = (r) => String(r['PN'] ?? r['하위품번'] ?? '').replace(/\.0$/, '').trim()
        const valid = rows.filter(r => parentKey(r) && childKey(r))
        const groups = {}
        valid.forEach(r => {
          const p = parentKey(r)
          if (!groups[p]) groups[p] = { code: withPrefix(p, PREFIX[String(csCode || '').toLowerCase()] || ''), name: String(r['상위품명']||'').trim(), rev: String(r['REV']||'A').trim(), count: 0 }
          groups[p].count++
        })
        setPreview({ total: valid.length, groups: Object.values(groups), rows: valid })
        setUploading(false)
      }
      reader.readAsBinaryString(file)
    } catch (err) { toastError(err.message); setUploading(false) }
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <CustomerTabs />
      {/* 탭 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['list','등록 목록'],['detail','세부 항목']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all
                ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        {tab === 'detail' && selAssembly && (
          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
            {selAssembly.code} · REV {selAssembly.rev || 'A'}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={() => downloadCsvTemplate(TEMPLATES.bom.filename, TEMPLATES.bom.headers, TEMPLATES.bom.samples)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50">
          ⬇ 양식 다운로드
        </button>
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 cursor-pointer ${uploading?'opacity-50':''}`}>
          📤 {uploading ? '파싱 중...' : 'BOM CSV 업로드'}
          <input type="file" accept=".xlsx,.csv,.xls" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-sky-200 text-sky-600 bg-white hover:bg-sky-50 cursor-pointer ${uploading?'opacity-50':''}`}
          title="고객사에서 받은 Part Report(HTM)를 그대로 올리면 BOM과 제조사 정보가 자동으로 들어갑니다">
          📄 {uploading ? '파싱 중...' : 'AXCELIS 리포트(HTM)'}
          <input type="file" accept=".htm,.html" className="hidden" onChange={handleHtmFile} disabled={uploading} />
        </label>
      </div>

      {/* HTM 리포트 정보 */}
      {htmInfo && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
          <div className="font-bold text-sm mb-1">
            📄 {htmInfo.header.rootCode} · REV {htmInfo.header.rev}.{htmInfo.header.edition} ({htmInfo.header.state})
          </div>
          <div className="text-sky-700">{htmInfo.header.description}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sky-600">
            <span>품목 <b>{htmInfo.stats.total}</b></span>
            <span>어셈블리 <b>{htmInfo.stats.assemblies}</b></span>
            <span>최대 레벨 <b>{htmInfo.stats.maxLevel}</b></span>
            <span>제조사 확보 <b>{htmInfo.stats.withMfr}/{htmInfo.stats.total}</b></span>
            {htmInfo.stats.zeroQty > 0 && <span className="text-amber-600">수량 0 (as needed) <b>{htmInfo.stats.zeroQty}</b></span>}
            {htmInfo.stats.converted > 0 && <span className="text-emerald-700">Foot→M 환산 <b>{htmInfo.stats.converted}</b></span>}
            {htmInfo.header.createdBy && <span>작성 {htmInfo.header.createdBy}</span>}
          </div>
          {htmInfo.stats.converted > 0 && (
            <div className="mt-2 rounded-lg bg-white/70 border border-sky-200 px-2.5 py-2">
              <p className="text-[11px] font-bold text-emerald-700 mb-1">
                Foot → M 환산 (소수 둘째 자리 올림)
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                {htmInfo.parts.filter(p => p.converted).map(p => (
                  <span key={p.code} className="font-mono">
                    {p.code} <span className="text-slate-400">{p.qtyOrig} {p.unitOrig} →</span>{' '}
                    <b className="text-emerald-700">{p.qty} M</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="mt-2 flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={fillMfr} onChange={(e) => setFillMfr(e.target.checked)} className="mt-0.5" />
            <span className="text-[11px] text-sky-700">
              <b>이미 등록된 품목의 빈 제조사 정보도 채우기</b>
              <span className="block text-sky-500">
                값이 있는 품목은 덮어쓰지 않고, 비어 있는 칸만 리포트 값으로 채웁니다.
              </span>
            </span>
          </label>
          <p className="mt-1.5 text-[11px] text-sky-500">
            아래에서 내용을 확인한 뒤 저장하세요. 등록되지 않은 품번은 제조사·품명과 함께 자동으로 품목 등록됩니다.
          </p>
        </div>
      )}

      {/* 저장 결과 */}
      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center gap-3">
          ✅ 저장 완료 — 어셈블리 {result.asmCount}개 · 품목 {result.saved}개 등록{result.newItems>0 && ` (신규 ${result.newItems}개)`}{result.mfrFilled>0 && ` · 제조사 ${result.mfrFilled}건 보완`}{result.skipped>0 && ` · ${result.skipped}개 건너뜀`}
          <button onClick={() => setResult(null)} className="ml-auto text-emerald-400">✕</button>
        </div>
      )}

      {/* CSV 미리보기 (다중 어셈블리) */}
      {preview && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-indigo-700">미리보기 — 어셈블리 {preview.groups.length}개 · 품목 {preview.total}개</p>
            <div className="flex gap-2">
              <button onClick={() => { setPreview(null); setRawRows([]) }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">취소</button>
              <button onClick={() => saveMut.mutate(rawRows)} disabled={saveMut.isPending || !cs?.id || preview.groups.length===0}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {saveMut.isPending ? '저장 중...' : '⚡ DB에 저장'}
              </button>
              {saveMut.isPending && progress && (
                <span className="text-xs text-indigo-500 font-semibold self-center">{progress}</span>
              )}
            </div>
          </div>

          {/* 어셈블리 그룹 요약 */}
          <div className="flex flex-wrap gap-2">
            {preview.groups.map((g, i) => (
              <div key={i} className="px-3 py-1.5 rounded-lg bg-white border border-indigo-100 text-xs">
                <span className="font-mono font-bold text-indigo-600">{g.code}</span>
                {g.name && <span className="text-slate-500 ml-1.5">{g.name}</span>}
                <span className="ml-1.5 text-slate-400">REV {g.rev} · {g.count}품목</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden max-h-52 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-indigo-50 border-b border-indigo-100">
                  <th className="px-3 py-2 text-left font-bold text-indigo-400">상위</th>
                  <th className="px-3 py-2 text-left font-bold text-indigo-400">LV</th>
                  <th className="px-3 py-2 text-left font-bold text-indigo-400">PN</th>
                  <th className="px-3 py-2 text-left font-bold text-indigo-400">품명</th>
                  <th className="px-3 py-2 text-left font-bold text-indigo-400">제조사품번</th>
                  <th className="px-3 py-2 text-right font-bold text-indigo-400">수량</th>
                  <th className="px-3 py-2 text-center font-bold text-indigo-400">관리</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((r, i) => {
                  const parent = withPrefix(String(r['상위PN'] ?? r['상위품번'] ?? ''), PREFIX[String(csCode || '').toLowerCase()] || '')
                  const pn = String(r['PN'] ?? r['하위품번'] ?? '').replace(/\.0$/, '').trim()
                  const lv = r['LEVEL'] ?? r['LV'] ?? 1
                  return (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400">{parent}</td>
                      <td className="px-3 py-1.5"><span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-bold ${levelCls(lv)}`}>L{lv}</span></td>
                      <td className="px-3 py-1.5 font-mono text-xs text-indigo-600">AX-{pn}</td>
                      <td className="px-3 py-1.5 text-slate-700 max-w-[200px] truncate">{r['Description'] ?? r['품명'] ?? ''}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400">{r['MFG PN'] ?? r['제조사품번'] ?? ''}</td>
                      <td className="px-3 py-1.5 text-right font-semibold text-slate-700">{r['실수량'] ?? r['QTY'] ?? r['수량'] ?? ''}</td>
                      <td className="px-3 py-1.5 text-center text-slate-400">{r['관리대상'] ?? '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {preview.total > 200 && <p className="text-[11px] text-slate-400 text-center">미리보기는 200행까지 · 저장은 전체 {preview.total}행</p>}
        </div>
      )}

      {/* 등록 목록 탭 */}
      {tab === 'list' && (
        <>
        <div className="flex items-center gap-2">
          <input value={asmSearch} onChange={e=>setAsmSearch(e.target.value)}
            placeholder="상위품번·어셈블리명 검색"
            className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
          <span className="text-xs text-slate-400 font-semibold ml-auto">{assemblies.filter(a=>{
            const q=asmSearch.trim().toLowerCase(); if(!q) return true
            return (a.code||'').toLowerCase().includes(q)||(a.name||'').toLowerCase().includes(q)
          }).length} / {assemblies.length}개</span>
        </div>
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['상위품번','어셈블리명','REV','품목 수','등록일',''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {asmLoading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
              ) : assemblies.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">등록된 BOM이 없습니다. CSV를 업로드해주세요.</td></tr>
              ) : assemblies.filter(a=>{
                  const q=asmSearch.trim().toLowerCase(); if(!q) return true
                  return (a.code||'').toLowerCase().includes(q)||(a.name||'').toLowerCase().includes(q)
                }).map(a => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50 group cursor-pointer"
                  onClick={() => { setSelAssembly(a); setTab('detail') }}>
                  <td className="px-3 py-2.5 font-mono font-bold text-indigo-600">{a.code}</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">{a.name}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
                      REV {a.rev || 'A'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{a.itemCount}개</td>
                  <td className="px-3 py-2.5 text-slate-400">{a.created_at?.split('T')[0]}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (window.confirm(`${a.code} BOM 전체를 삭제할까요?\n(하위 ${a.itemCount}개 품목 모두 삭제)`))
                          deleteMut.mutate({ customerId: cs?.id, projectId: a.id })
                      }}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500 transition-opacity">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* 세부항목 탭 */}
      {tab === 'detail' && (
        <div className="space-y-3">
          {!selAssembly ? (
            <div className="text-center py-12 text-slate-400">
              <p>등록 목록에서 어셈블리를 선택하세요</p>
              <button onClick={() => setTab('list')} className="mt-2 text-xs text-indigo-500 hover:text-indigo-700">← 등록 목록으로</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <button onClick={() => setTab('list')} className="text-xs text-slate-400 hover:text-slate-600">← 목록</button>
                <span className="text-slate-300">/</span>
                <span className="text-xs font-semibold text-slate-700">{selAssembly.code}</span>
                <span className="text-xs text-slate-400">{selAssembly.name}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 ml-1">REV {selAssembly.rev || 'A'}</span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-slate-400">{bomDetail.length}개 품목</span>
                  {(() => {
                    const ask = bomDetail.filter(b => b.item_rev && compareRev(b.item_rev, dwMap[b.items?.std_code]) === 'ask').length
                    const none = bomDetail.filter(b => b.item_rev && compareRev(b.item_rev, dwMap[b.items?.std_code]) === 'none').length
                    if (!ask && !none) return null
                    return (
                      <span className="text-xs font-bold">
                        {ask > 0 && <span className="text-orange-600 mr-2">🟠 도면요청 {ask}</span>}
                        {none > 0 && <span className="text-rose-500">🔴 도면없음 {none}</span>}
                      </span>
                    )
                  })()}
                  <button onClick={()=>exportDetailCSV(bomDetail, selAssembly)} disabled={!bomDetail.length}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">📑 CSV 추출</button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={detailSearch} onChange={e=>setDetailSearch(e.target.value)}
                  placeholder="코드·품명·제조사·제조사코드 검색"
                  className="w-full sm:w-80 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                {canEdit && selAssembly && (
                  <button onClick={() => { setAddOpen(true); setPnHit(null) }}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
                    ＋ 행 추가
                  </button>
                )}
                {canEdit && selAssembly && (subStat.new_count > 0 || subStat.existing_count > 0) && (
                  <>
                    <button onClick={buildSubBom} disabled={subBomBusy || subPending === 0}
                      title="이 BOM 안의 하위 어셈블리에 BOM 을 만들어 단독 원가를 볼 수 있게 합니다"
                      className={`px-3 py-2 text-xs font-bold rounded-lg border disabled:opacity-40 ${subOverwrite
                        ? 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100'
                        : 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}>
                      {subBomBusy
                        ? (subProgress ? `생성 중… ${subProgress.done}/${subProgress.total}` : '준비 중…')
                        : `🧬 하위 ASSY BOM ${subOverwrite ? '다시 생성' : '생성'} (${subPending})`}
                    </button>
                    {subStat.existing_count > 0 && (
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer"
                        title="리포트를 새로 올렸다면 체크해서 기존 하위 BOM 도 갱신하세요">
                        <input type="checkbox" checked={subOverwrite}
                          onChange={e => setSubOverwrite(e.target.checked)} />
                        기존 {subStat.existing_count}건도 갱신
                      </label>
                    )}
                  </>
                )}
              </div>
              {subProgress && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold">{subProgress.done} / {subProgress.total} 처리 중</span>
                    <span className="font-mono text-[11px]">{subProgress.now}</span>
                  </div>
                  <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${Math.round(subProgress.done / subProgress.total * 100)}%` }} />
                  </div>
                </div>
              )}
              {subBomResult && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <p className="font-bold">
                    ✅ 하위 어셈블리 {subBomResult.count}건 · 부품 {subBomResult.total.toLocaleString()}행
                    {subBomResult.replaced > 0 && ` (갱신 ${subBomResult.replaced}건 포함)`}
                  </p>
                  {!!subBomResult.list.length && (
                    <p className="mt-1 text-[11px] text-emerald-700">
                      {subBomResult.list.slice(0, 8).map(r => `${r.assy}(${r.rows_created})`).join(' · ')}
                      {subBomResult.list.length > 8 && ` 외 ${subBomResult.list.length - 8}건`}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-emerald-600">
                    이제 원가분석에서 이 어셈블리들을 골라 단독 원가를 볼 수 있습니다.
                  </p>
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                대체품 사용 등으로 수정한 내용은 <b>같은 어셈블리의 리포트를 다시 업로드하면 사라집니다</b>
                (업로드 시 어셈블리 전체가 새로 등록되기 때문).
              </p>
              {detailError ? (
                <div className="text-center py-8 text-red-500 text-sm">오류: {detailError.message}</div>
              ) : (
                <div className="rounded-xl border border-slate-200 overflow-x-auto">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {['LV','기준코드','품명','REV 대조','구분','제조사','제조사품번','단위','소요량','수정'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detailLoading ? (
                          <tr><td colSpan={10} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
                        ) : bomDetail.length === 0 ? (
                          <tr><td colSpan={10} className="text-center py-10 text-slate-400">품목이 없습니다</td></tr>
                        ) : bomDetail.filter(b=>{
                          const q=detailSearch.trim().toLowerCase(); if(!q) return true
                          const it=b.items||{}
                          return [it.std_code,it.name,it.manufacturer,it.manufacturer_code].some(x=>(x||'').toLowerCase().includes(q))
                        }).map(b => (
                          <tr key={b.id} className={`border-b border-slate-100 hover:bg-indigo-50/40 ${(b.level||1)>=4?'bg-slate-200/50':(b.level||1)===3?'bg-slate-100/60':(b.level||1)===2?'bg-slate-50':''}`}>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${levelCls(b.level)}`}>L{b.level}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-indigo-600" style={{paddingLeft:`${indentOf(b.level)}px`}}>{(b.level||1)>1&&<span className="text-slate-300 select-none mr-0.5">└</span>}{b.items?.std_code}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{b.items?.name}</td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              {(() => {
                                const dw = dwMap[b.items?.std_code]
                                const st = b.item_rev ? compareRev(b.item_rev, dw) : null
                                if (!b.item_rev) return <span className="text-slate-300">-</span>
                                if (!st) return <span className="font-mono text-slate-500">{b.item_rev}</span>
                                const s2 = REV_STATE[st]
                                return (
                                  <span title={st === 'none' ? 'NAS에 도면이 없습니다' : `BOM 요구 ${b.item_rev} / NAS 최신 ${dw?.rev} · ${s2.label}`}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono font-bold ${s2.cls}`}>
                                    <span>{s2.dot}</span>
                                    <span>{b.item_rev}</span>
                                    {st !== 'match' && st !== 'none' && <span className="opacity-60">→{dw?.rev}</span>}
                                  </span>
                                )
                              })()}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${catStyle(b.items?.category || b.items?.type)}`}>{b.items?.category || b.items?.type}</span>
                              {b.items?.dept && (
                                <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${deptStyle(b.items.dept)}`}>
                                  {deptShort(b.items.dept)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-400">{b.items?.manufacturer||'-'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-400">{b.items?.manufacturer_code||'-'}</td>
                            <td className="px-3 py-2 text-slate-500">{b.items?.unit}</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">{b.qty_per_unit}</td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              {canEdit ? (
                                <button onClick={() => { setEditRow(b); setPnHit(null) }}
                                  title="대체품 교체·수량 수정"
                                  className="px-1.5 py-0.5 text-[11px] rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">
                                  수정
                                </button>
                              ) : <span className="text-slate-300">-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* BOM 행 편집 — 대체품 교체·수량 수정 */}
      {editRow && (
        <BomRowModal
          row={editRow} mode="edit"
          onClose={() => { setEditRow(null); setPnHit(null) }}
          onLookup={lookupItem} hit={pnHit} setHit={setPnHit}
          busy={rowMut.isPending}
          onSave={(patch) => rowMut.mutate({ action: 'update', row: editRow, patch })}
          onDelete={() => {
            if (!confirm(`${editRow.items?.std_code} 행을 BOM에서 삭제할까요?\n(원가·견적에서도 빠집니다)`)) return
            rowMut.mutate({ action: 'delete', row: editRow })
          }}
        />
      )}

      {/* BOM 행 추가 */}
      {addOpen && selAssembly && (
        <BomRowModal
          row={null} mode="add"
          onClose={() => { setAddOpen(false); setPnHit(null) }}
          onLookup={lookupItem} hit={pnHit} setHit={setPnHit}
          busy={rowMut.isPending}
          onSave={(patch) => rowMut.mutate({
            action: 'insert',
            patch: {
              customer_id: cs?.id, project_id: selAssembly.id,
              item_id: patch.item_id, qty_per_unit: patch.qty_per_unit,
              level: patch.level, item_rev: patch.item_rev || null,
              seq: (bomDetail.length + 1) * 10,
            },
          })}
        />
      )}
    </div>
  )
}

// BOM 행 편집·추가 모달
// 대체품을 쓰는 경우 품번을 바꾸면 품명·제조사가 자동으로 따라온다.
function BomRowModal({ row, mode, onClose, onSave, onDelete, onLookup, hit, setHit, busy }) {
  const isEdit = mode === 'edit'
  const [code, setCode] = useState(isEdit ? (row.items?.std_code || '') : '')
  const [qty, setQty] = useState(isEdit ? (row.qty_per_unit ?? 1) : 1)
  const [level, setLevel] = useState(isEdit ? (row.level ?? 1) : 1)
  const [rev, setRev] = useState(isEdit ? (row.item_rev || '') : '')
  const [checking, setChecking] = useState(false)

  const codeChanged = isEdit && code.trim().toUpperCase() !== String(row.items?.std_code || '').toUpperCase()

  async function check() {
    if (!code.trim()) return
    setChecking(true)
    const r = await onLookup(code)
    setHit(r || { notFound: true })
    setChecking(false)
  }

  const canSave = isEdit
    ? (!codeChanged || (hit && !hit.notFound)) && Number(qty) >= 0
    : (hit && !hit.notFound && Number(qty) > 0)

  function save() {
    if (mode === 'add') {
      onSave({ item_id: hit.id, qty_per_unit: Number(qty), level: Number(level), item_rev: rev.trim() })
      return
    }
    const patch = { qty_per_unit: Number(qty), level: Number(level), item_rev: rev.trim() || null }
    if (codeChanged && hit && !hit.notFound) patch.item_id = hit.id
    onSave(patch)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-1">
          {isEdit ? '🔧 BOM 행 수정' : '＋ BOM 행 추가'}
        </h3>
        <p className="text-[11px] text-slate-400 mb-3">
          {isEdit ? '대체품을 쓰는 경우 품번을 바꾸면 됩니다. 품명·제조사는 자동으로 따라옵니다.' : '추가할 품번을 입력하고 조회하세요.'}
        </p>

        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-semibold text-slate-500">품번</label>
            <div className="flex gap-1.5 mt-1">
              <input value={code} onChange={e => { setCode(e.target.value); setHit(null) }}
                onBlur={check} placeholder="160003770 또는 AX-160003770"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
              <button onClick={check} disabled={checking || !code.trim()}
                className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                {checking ? '조회중' : '조회'}
              </button>
            </div>
            {hit && !hit.notFound && (
              <div className="mt-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px]">
                <div className="font-bold text-emerald-800">{hit.std_code}</div>
                <div className="text-emerald-700">{hit.name}</div>
                <div className="text-emerald-600">{hit.manufacturer || '-'} · {hit.manufacturer_code || '-'} · {hit.unit || 'EA'}</div>
              </div>
            )}
            {hit?.notFound && (
              <p className="mt-1.5 text-[11px] text-rose-600">
                품목 마스터에 없는 품번입니다. 기준코드 DB에 먼저 등록해주세요.
              </p>
            )}
            {isEdit && codeChanged && !hit && (
              <p className="mt-1.5 text-[11px] text-amber-600">품번을 바꿨습니다 — 조회를 눌러 확인해주세요.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500">소요량</label>
              <input type="number" step="any" value={qty} onChange={e => setQty(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm text-right border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">레벨</label>
              <input type="number" value={level} onChange={e => setLevel(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm text-right border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">REV</label>
              <input value={rev} onChange={e => setRev(e.target.value)} placeholder="-"
                className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          {isEdit && (
            <button onClick={onDelete} disabled={busy}
              className="px-3 py-2.5 text-sm font-semibold rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40">
              삭제
            </button>
          )}
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            취소
          </button>
          <button onClick={save} disabled={busy || !canSave}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
