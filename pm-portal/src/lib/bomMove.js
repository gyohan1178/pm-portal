// BOM 고객사 옮기기 (v4.252.0)
//   다른 고객사 탭에 잘못 올린 BOM 을 맞는 고객사로 옮긴다.
//   - 어셈블리(projects) · BOM 줄(bom) · 구버전 보관(pm_bom_version) 의 customer_id 를 바꾼다
//   - 하위 품번 접두도 바꿀 수 있다: AX-IE0501604 → ED-IE0501604
//       옮길 고객사 접두 품번이 이미 있으면 그 품목으로 이어 붙이고, 없으면 원래 품목을 복사해 새로 만든다
//       원래(잘못 만들어진) 품목은 지우지 않는다 — 재고 · 발주가 걸려 있을 수 있다
//   - 상위품번: AXCELIS 로 옮기면 AX- 를 붙이고, AXCELIS 에서 빼면 AX- 를 뗀다
//   - 옮길 고객사에 같은 상위품번이 이미 있으면 그 어셈블리는 옮기지 않고 알려 준다
//   dryRun 이면 아무것도 바꾸지 않고 숫자만 센다 (확인 창에 보여 줄 것)
import { supabase } from './supabase'

export const CS_PREFIX = { ax: 'AX-', ed: 'ED-', csk: 'CS-', vm: 'VM-', hc: 'HC-' }
const PRE_RE = /^(AX|ED|CS|VM|HC)-/i
// 접두 → 고객사 코드
export const PREFIX_CS = { AX: 'ax', ED: 'ed', CS: 'csk', VM: 'vm', HC: 'hc' }

const lc = (v) => String(v || '').toLowerCase()

// 상위품번을 옮길 고객사 규칙에 맞춘다
export function movedParentCode(code, fromCode, toCode) {
  const c = String(code || '').trim()
  if (lc(toCode) === 'ax') return PRE_RE.test(c) ? c : 'AX-' + c
  if (lc(fromCode) === 'ax' && /^AX-/i.test(c)) return c.slice(3)
  return c
}

// 하위 품번을 옮길 고객사 접두로 — 원래 고객사 접두가 붙은 것만 바꾼다
export function movedItemCode(std, fromCode, toCode) {
  const s = String(std || '').trim()
  const fp = CS_PREFIX[lc(fromCode)], tp = CS_PREFIX[lc(toCode)] || ''
  if (!fp || !s.toUpperCase().startsWith(fp)) return null
  const base = s.slice(fp.length)
  return base ? tp + base : null
}

// 파일 품번에서 가장 많이 쓰인 고객사 접두 — 지금 탭과 다르면 경고용
export function dominantPrefix(codes) {
  const cnt = {}; let n = 0
  for (const c of codes) {
    const m = String(c || '').trim().match(PRE_RE)
    if (!m) continue
    const k = m[1].toUpperCase(); cnt[k] = (cnt[k] || 0) + 1; n++
  }
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]
  return top ? { prefix: top[0], cs: PREFIX_CS[top[0]], count: top[1], total: n } : null
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

async function bomRowsOf(projIds) {
  const out = []
  for (const part of chunks(projIds, 100)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('bom').select('id,project_id,item_id,items(id,std_code)')
        .in('project_id', part).order('id').range(from, from + 999)
      if (error) throw new Error('BOM 읽기 실패: ' + error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
  }
  return out
}

// projects: [{ id, code }] · from/to: { id, code, name }
export async function moveBomCustomer({ projects, from, to, remapItems = true, dryRun = false, onProgress }) {
  if (!from?.id || !to?.id) throw new Error('고객사를 고르세요')
  if (from.id === to.id) throw new Error('같은 고객사입니다')
  const list = (projects || []).map(p => ({ ...p, newCode: movedParentCode(p.code, from.code, to.code) }))

  // 1) 옮길 고객사에 같은 상위품번이 있는지
  const conflicts = new Set()
  for (const part of chunks(list.map(p => p.newCode), 300)) {
    const { data, error } = await supabase.from('projects').select('code').eq('customer_id', to.id).in('code', part)
    if (error) throw new Error('상위품번 확인 실패: ' + error.message)
    ;(data || []).forEach(p => conflicts.add(p.code))
  }
  const movable = list.filter(p => !conflicts.has(p.newCode))
  const ids = movable.map(p => p.id)

  // 2) 하위 품번 접두 바꾸기 대상
  onProgress?.('BOM 확인 중...')
  const rows = ids.length ? await bomRowsOf(ids) : []
  const map = new Map()   // old item id → { from, to }
  if (remapItems) {
    for (const r of rows) {
      const nc = movedItemCode(r.items?.std_code, from.code, to.code)
      if (nc && !map.has(r.item_id)) map.set(r.item_id, { oldId: r.item_id, from: r.items.std_code, to: nc })
    }
  }
  const targets = [...new Set([...map.values()].map(m => m.to))]
  const have = {}
  for (const part of chunks(targets, 300)) {
    const { data, error } = await supabase.from('items').select('id,std_code').in('std_code', part)
    if (error) throw new Error('품목 확인 실패: ' + error.message)
    ;(data || []).forEach(it => { have[it.std_code] = it.id })
  }
  const toCreate = targets.filter(t => !have[t])
  const remapLines = rows.filter(r => map.has(r.item_id)).length
  const summary = {
    asm: movable.length, conflicts: [...conflicts], lines: rows.length, remapLines,
    remapItems: map.size, existItems: targets.length - toCreate.length, newItems: toCreate.length,
    renamed: movable.filter(p => p.newCode !== p.code).length,
  }
  if (dryRun || !movable.length) return summary

  // 3) 없는 품목은 원래 품목을 복사해서 만든다
  if (toCreate.length) {
    onProgress?.(`새 품번 ${toCreate.length}개 만드는 중...`)
    const srcIds = [...map.values()].filter(m => toCreate.includes(m.to)).map(m => m.oldId)
    const src = {}
    for (const part of chunks(srcIds, 200)) {
      const { data, error } = await supabase.from('items').select('*').in('id', part)
      if (error) throw new Error('원래 품목 읽기 실패: ' + error.message)
      ;(data || []).forEach(it => { src[it.id] = it })
    }
    const ins = []
    for (const m of map.values()) {
      if (!toCreate.includes(m.to) || ins.find(x => x.std_code === m.to)) continue
      const { id, created_at, updated_at, std_code, ...rest } = src[m.oldId] || {}
      ins.push({ ...rest, std_code: m.to })
    }
    for (const part of chunks(ins, 200)) {
      const { data, error } = await supabase.from('items').insert(part).select('id,std_code')
      if (error) throw new Error('새 품번 만들기 실패: ' + error.message)
      ;(data || []).forEach(it => { have[it.std_code] = it.id })
    }
  }

  // 4) BOM 줄을 새 품목으로 이어 붙인다 (품목 하나씩 · 이 어셈블리들 안에서만)
  let i = 0
  for (const m of map.values()) {
    const nid = have[m.to]; i++
    if (!nid) continue
    onProgress?.(`하위 품번 바꾸는 중... ${i}/${map.size}`)
    for (const part of chunks(ids, 200)) {
      const { error } = await supabase.from('bom').update({ item_id: nid }).in('project_id', part).eq('item_id', m.oldId)
      if (error) throw new Error(`${m.from} → ${m.to} 바꾸기 실패: ` + error.message)
    }
  }

  // 5) 고객사 바꾸기 — BOM 줄 → 구버전 보관 → 어셈블리
  onProgress?.('고객사 바꾸는 중...')
  for (const part of chunks(ids, 200)) {
    const { error } = await supabase.from('bom').update({ customer_id: to.id }).in('project_id', part)
    if (error) throw new Error('BOM 줄 옮기기 실패: ' + error.message)
    const { error: vErr } = await supabase.from('pm_bom_version').update({ customer_id: to.id }).in('project_id', part)
    if (vErr && !/pm_bom_version|PGRST205|42P01|does not exist|schema cache/i.test(vErr.message || '')) throw new Error('구버전 옮기기 실패: ' + vErr.message)
  }
  const same = movable.filter(p => p.newCode === p.code).map(p => p.id)
  for (const part of chunks(same, 200)) {
    const { error } = await supabase.from('projects').update({ customer_id: to.id }).in('id', part)
    if (error) throw new Error('어셈블리 옮기기 실패: ' + error.message)
  }
  for (const p of movable.filter(p => p.newCode !== p.code)) {
    const { error } = await supabase.from('projects').update({ customer_id: to.id, code: p.newCode }).eq('id', p.id)
    if (error) throw new Error(`${p.code} 옮기기 실패: ` + error.message)
  }
  return summary
}
