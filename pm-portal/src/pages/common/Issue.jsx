import { useState, useMemo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { buildLabelZpl } from '../../lib/labelZpl'
import { deptStyle, deptShort } from '../../lib/bomStyle'

const today = () => new Date().toISOString().split('T')[0]

// 호기별 키팅은 AXCELIS 만 하지만, 다품목 출고는 고객사마다 쓴다.
//   CSK 는 여러 프로젝트 자재를 한 번에 빼기 때문이다.
async function fetchCustomers() {
  const { data } = await supabase.from('customers')
    .select('id,code,name').order('code')
  return data || []
}
async function fetchCart(csId) {
  if (!csId) return []
  const { data } = await supabase.from('pm_picking').select('*').eq('customer_id', csId).order('created_at')
  return data || []
}

export default function Issue() {
  const qc = useQueryClient()
  const [csCode, setCsCode] = useState('ax')      // 고객사
  const [itemSearch, setItemSearch] = useState('')
  const [itemHits, setItemHits] = useState([])
  const [picked, setPicked] = useState([])   // 전개 전 담은 목록
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [cartView] = useState('item')   // 품목 합계로만 본다
  const [excluded, setExcluded] = useState(new Set()) // 불출표 제외 대상 (std_code)

  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const csId = customers.find(c => c.code === csCode)?.id
  const { data: cart = [] } = useQuery({ queryKey: ['picking', csId], queryFn: () => fetchCart(csId), enabled: !!csId })

  const addMut = useMutation({
    mutationFn: async (rows) => {
      const payload = rows.map(r => ({ ...r, customer_id: csId }))
      const { error } = await supabase.from('pm_picking').insert(payload); if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['picking', csId]),
    onError: e => toastError('담기 오류: ' + e.message),
  })
  const updMut = useMutation({
    mutationFn: async ({ id, patch }) => { const { error } = await supabase.from('pm_picking').update(patch).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries(['picking', csId]),
  })
  const delMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('pm_picking').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries(['picking', csId]),
  })
  const clearMut = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('pm_picking').delete().eq('customer_id', csId); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries(['picking', csId]) },
    onError: e => toastError('초기화 오류: ' + e.message),
  })

  // 호기 담기
  // 품목 검색. ASSY 는 고르면 하위가 전개되므로 미리 표시한다.
  async function searchItem(v) {
    setItemSearch(v)
    if (v.trim().length < 2 || !csId) { setItemHits([]); return }
    const { data } = await supabase.rpc('pm_issue_search',
      { p_customer_id: csId, q: v.trim() })
    setItemHits(data || [])
  }

  // 담을 목록 — 여기서 수량을 정한 뒤 한 번에 전개한다
  function pickItem(it) {
    setPicked(prev => {
      const i = prev.findIndex(x => x.std_code === it.std_code)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: (Number(next[i].qty) || 0) + 1 }
        return next
      }
      return [...prev, {
        std_code: it.std_code, name: it.name, unit: it.unit,
        maker: it.maker, maker_code: it.maker_code,
        is_assy: it.is_assy, child_cnt: it.child_cnt, qty: 1,
      }]
    })
    setItemSearch(''); setItemHits([])
  }

  // 전개 — ASSY 는 하위로, 단품은 그대로. 같은 품목은 합산된다.
  async function explodeAndAdd() {
    if (!picked.length) { toastError('담은 품목이 없습니다'); return }
    const bad = picked.filter(p => !(Number(p.qty) > 0))
    if (bad.length) { toastError('수량을 입력하세요'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_explode_assy', {
        p_customer_id: csId,
        p_items: picked.map(p => ({ code: p.std_code, qty: Number(p.qty) })),
      })
      if (error) throw error
      if (!data?.length) { toastError('전개 결과가 없습니다'); return }
      addMut.mutate(data.map(r => ({
        item_id: r.item_id, std_code: r.std_code, name: r.name,
        unit: r.unit, qty: r.qty, issue_qty: r.qty,
        source: 'direct', issued: true,
      })))
      toastSuccess(`${data.length}품목 담김`)
      setPicked([])
    } catch (e) { toastError('전개 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  // 일괄 출고 처리
  // ④ 결품 자동 연동 — 출고 성공 후 생산관리 missing_parts 동기화
  //    결품 발생 → 해당 호기에 자동 기록 / 결품이던 품목이 전량 불출되면 → 자동 해제
  async function syncMissingToProduction(snapshot) {
    const byBox = {}
    snapshot.filter(l => l.source === 'hogi' && l.pn && l.hogi).forEach(l => {
      const k = `${l.pn}|${l.hogi}`
      byBox[k] ??= { pn: l.pn, hogi: l.hogi, shorts: [], cleared: [] }
      const sq = Math.max(0, (Number(l.qty) || 0) - (Number(l.issue_qty ?? l.qty) || 0))
      if (sq > 0) byBox[k].shorts.push({ std_code: l.std_code, name: l.name, qty: sq })
      else if ((Number(l.issue_qty ?? l.qty) || 0) > 0) byBox[k].cleared.push(l.std_code)
    })
    const boxes = Object.values(byBox)
    if (!boxes.length) return
    for (const b of boxes) {
      try {
        const { data: prod } = await supabase.from('production')
          .select('id,missing_parts').eq('pn', b.pn).eq('hogi', b.hogi).neq('status', '완료').limit(1)
        const box = prod?.[0]; if (!box) continue
        let mp = Array.isArray(box.missing_parts) ? [...box.missing_parts] : []
        // 전량 불출된 품목은 결품에서 해제
        mp = mp.filter(m => !b.cleared.includes(m.std_code))
        // 이번 결품은 갱신/추가
        b.shorts.forEach(sh => {
          const i = mp.findIndex(m => m.std_code === sh.std_code)
          if (i >= 0) mp[i] = { ...mp[i], ...sh }; else mp.push(sh)
        })
        await supabase.from('production').update({ missing_parts: mp, updated_at: new Date().toISOString() }).eq('id', box.id)
      } catch (e) { console.warn('결품 연동 실패', b.pn, b.hogi, e) }
    }
  }

  const processMut = useMutation({
    mutationFn: async () => {
      if (!cart.length) return []
      const snapshot = cart.map(l => ({ ...l })) // 처리 후 비워지므로 스냅샷
      // 출고 처리 전체를 Postgres 함수에서 트랜잭션으로 — 전부 성공 아니면 전부 취소(부분 실패 없음)
      const { data, error } = await supabase.rpc('pm_process_issue', { p_customer_id: csId })
      if (error) throw error
      await syncMissingToProduction(snapshot) // 결품 ↔ 생산관리 동기화 (실패해도 출고는 유지)
      return (data && data.warnings) || []
    },
    onSuccess: (warnings) => {
      qc.invalidateQueries(['picking', csId])
      qc.invalidateQueries(['inventory']); qc.invalidateQueries(['shortage']); qc.invalidateQueries(['cpo'])
      qc.invalidateQueries(['production']); qc.invalidateQueries(['prodBoard'])
      setMsg(warnings.length ? `출고 완료 (재고부족 경고 ${warnings.length}건):\n` + warnings.join('\n') : '출고 처리 완료')
    },
    onError: e => toastError('출고 오류: ' + e.message),
  })

  const shortQ = (c) => Math.max(0, (Number(c.qty) || 0) - (Number(c.issue_qty ?? c.qty) || 0))
  // 제조사·제조사품번 메타 (장바구니 품목들)
  const metaIds = [...new Set(cart.map(c => c.item_id).filter(Boolean))]
  const { data: itemMeta = {} } = useQuery({
    queryKey: ['issueItemMeta', metaIds.join(',')],
    enabled: metaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('items')
        .select('id,name,manufacturer,manufacturer_code,label_mode,pack_qty,dept').in('id', metaIds)
      return Object.fromEntries((data || []).map(i => [i.id, i]))
    },
  })

  // 라벨 출력 단위 — 건별 덮어쓰기.
  // 화면에서 바꾸면 즉시 품목 마스터(items)에도 저장되어 다음 불출에서도 유지된다.
  // 위치(location)를 저장해 재사용하는 방식과 동일.
  const [labelOv, setLabelOv] = useState({})   // { std_code: 'sum'|'each' }
  const [labelConfirm, setLabelConfirm] = useState(null)  // 출력 전 확인 모달 데이터
  const [packOv, setPackOv]   = useState({})   // { std_code: 원포장수량 }

  async function saveLabelMode(row, mode, pack) {
    setLabelOv(v => ({ ...v, [row.std_code]: mode }))
    const packNum = (pack === '' || pack == null) ? null : Number(pack)
    if (pack !== undefined) setPackOv(v => ({ ...v, [row.std_code]: packNum }))
    if (!row.item_id) return
    const patch = { label_mode: mode }
    if (pack !== undefined) patch.pack_qty = packNum
    const { error } = await supabase.from('items').update(patch).eq('id', row.item_id)
    if (error) { toastError('라벨 설정 저장 실패: ' + error.message); return }
    const lb = mode === 'sum' ? '합산' : mode === 'each' ? '개별' : '미출력'
    toastSuccess(`라벨 ${lb}${pack !== undefined && packNum ? ` · 원포장 ${packNum}` : ''} 저장`)
    // itemMeta 캐시를 직접 갱신 (refetch 로 입력값이 날아가지 않게)
    qc.setQueriesData({ queryKey: ['issueItemMeta'], exact: false }, (old) => {
      if (!old || typeof old !== 'object') return old
      const cur = old[row.item_id]
      if (!cur) return old
      return { ...old, [row.item_id]: { ...cur, label_mode: mode, ...(pack !== undefined ? { pack_qty: packNum } : {}) } }
    })
  }

  // 위치(inventory.location) 메타 — 라벨/불출표에 표시
  const { data: locMeta = {} } = useQuery({
    queryKey: ['issueLocMeta', metaIds.join(',')],
    enabled: metaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('inventory').select('item_id,location').in('item_id', metaIds)
      const m = {}
      ;(data || []).forEach(r => { if (r.location) m[r.item_id] = r.location })
      return m
    },
  })

  // 랙 규격 — 불출표에 창고 동선 격자를 그리기 위해 필요하다
  const { data: racks = [] } = useQuery({
    queryKey: ['issueRacks'],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('pm_rack')
        .select('code,rows_cnt,levels_cnt,zone').order('sort_no')
      return data || []
    },
  })

  // 제작구분(make_type) 메타 — 라벨은 '전장(normal)'만 출력, 현장재고·하네스·미대상 제외
  const { data: mtMeta = {} } = useQuery({
    queryKey: ['issueMtMeta', metaIds.join(',')],
    enabled: metaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('pm_bom_notes').select('item_id,make_type').in('item_id', metaIds)
      const m = {}
      // 같은 품목이 여러 프로젝트에 있을 때: 하나라도 field_stock/harness/exclude면 그걸로 취급(라벨 제외)
      ;(data || []).forEach(r => {
        const cur = m[r.item_id]
        const rank = { normal: 0, field_stock: 1, harness: 2, exclude: 3 }
        if (cur === undefined || (rank[r.make_type] ?? 0) > (rank[cur] ?? 0)) m[r.item_id] = r.make_type || 'normal'
      })
      return m
    },
  })

  // 품목별 합계 (여러 호기 합산)
  const itemAgg = useMemo(() => {
    const g = {}
    cart.forEach(ln => {
      const k = ln.std_code || ln.item_id
      g[k] ??= { std_code: ln.std_code, name: ln.name, item_id: ln.item_id, qty: 0, issue: 0, short: 0, srcs: new Set() }
      g[k].qty += Number(ln.qty) || 0
      g[k].issue += Number(ln.issue_qty ?? ln.qty) || 0
      g[k].short += shortQ(ln)
      g[k].srcs.add(ln.source === 'hogi' ? `${ln.pn} ${ln.hogi}` : '직접')
    })
    return Object.values(g)
  }, [cart])

  // 제조사 → 제조사품번 순 정렬 (itemMeta 병합)
  const itemRows = useMemo(() => {
    const withMeta = itemAgg.map(a => ({
      ...a,
      maker: itemMeta[a.item_id]?.manufacturer || '',
      makerPn: itemMeta[a.item_id]?.manufacturer_code || '',
      dept: itemMeta[a.item_id]?.dept || '',
      // 장바구니 담을 당시 품명이 비어 있던 건은 품목 마스터에서 보충
      name: a.name || itemMeta[a.item_id]?.name || '',
      location: locMeta[a.item_id] || '',
      makeType: mtMeta[a.item_id] || 'normal',
      // 라벨 출력 단위 — 품목 마스터 기본값. 미설정이면 합산
      labelMode: labelOv[a.std_code] ?? itemMeta[a.item_id]?.label_mode ?? 'sum',
      packQty: packOv[a.std_code] ?? itemMeta[a.item_id]?.pack_qty ?? null,
    }))
    return withMeta.sort((a, b) =>
      String(a.maker).localeCompare(String(b.maker), 'ko') ||
      String(a.makerPn).localeCompare(String(b.makerPn), 'ko') ||
      String(a.std_code).localeCompare(String(b.std_code))
    )
  }, [itemAgg, itemMeta, locMeta, mtMeta, labelOv, packOv])

  // 자재 불출표 인쇄 (제외 대상 뺀 것, 제조사→제조사품번 순, 키팅 확인란 포함)
  function printIssueSheet() {
    const rows = itemRows.filter(r => !excluded.has(r.std_code))
    if (!rows.length) { toastError('출력할 품목이 없습니다'); return }
    const csName = customers.find(c => c.code === csCode)?.name || csCode.toUpperCase()
    const today = new Date().toLocaleDateString('ko-KR')
    const body = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${deptShort(r.dept) || '-'}</td>
      <td>${r.maker || '-'}</td>
      <td class="mono">${r.makerPn || '-'}</td>
      <td class="mono">${r.std_code || ''}</td>
      <td>${r.name || ''}</td>
      <td class="c b">${r.qty}</td>
      <td class="c">${r.unit || ''}</td>
      <td class="chk"></td>
    </tr>`).join('')

    // ── 창고 동선 격자 ──
    //   가져올 자재가 어느 칸에 있는지 랙별로 표시한다.
    //   칸 안의 번호는 위 목록의 No 와 같아 대조할 수 있다.
    const locMap = {}          // 'A1' → { '05-1': [3, 7] }
    const noLoc = []           // 위치가 지정되지 않은 자재
    rows.forEach((r, i) => {
      const loc = String(r.location || '').trim()
      const m = loc.match(/^([A-Z]+\d*)-(\d+)-(\d+)$/i)
      if (!m) { noLoc.push(i + 1); return }
      const [, rack, cell, lv] = m
      const key = `${parseInt(cell, 10)}-${parseInt(lv, 10)}`
      if (!locMap[rack]) locMap[rack] = {}
      if (!locMap[rack][key]) locMap[rack][key] = []
      locMap[rack][key].push(i + 1)
    })

    // 자재가 있는 랙만 그린다
    const usedRacks = racks.filter(rk => locMap[rk.code])
    const gridHtml = usedRacks.length === 0 ? '' : `
    <div class="grid-sec">
      <div class="grid-ttl">창고 동선 — 아래 칸에서 가져오세요</div>
      ${usedRacks.map(rk => {
        const cells = []
        for (let lv = rk.levels_cnt; lv >= 1; lv--) {
          const row = []
          for (let c = 1; c <= rk.rows_cnt; c++) {
            const hit = locMap[rk.code][`${c}-${lv}`]
            row.push(hit
              ? `<td class="hit">${hit.join(',')}</td>`
              : `<td></td>`)
          }
          cells.push(`<tr><th class="lv">${lv}층</th>${row.join('')}</tr>`)
        }
        const head = []
        for (let c = 1; c <= rk.rows_cnt; c++) head.push(`<th>${c}</th>`)
        return `<div class="rack">
          <div class="rack-name">${rk.code}<span class="rack-sub">${rk.rows_cnt}칸 ${rk.levels_cnt}층</span></div>
          <table class="grid"><tr><th class="lv"></th>${head.join('')}</tr>${cells.join('')}</table>
        </div>`
      }).join('')}
      ${noLoc.length ? `<div class="noloc">⚠ 위치 미지정 — 목록 번호 ${noLoc.join(', ')} 은 직접 찾아야 합니다</div>` : ''}
    </div>`

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>자재 불출표</title>
    <style>
      *{font-family:'Malgun Gothic',sans-serif;box-sizing:border-box}
      body{padding:24px;color:#111}
      .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:6px}
      h1{font-size:20px;margin:0}
      .meta{font-size:12px;color:#555;text-align:right;line-height:1.6}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
      th,td{border:1px solid #999;padding:5px 6px;text-align:left}
      th{background:#f0f0f0;font-size:11px}
      .c{text-align:center}.b{font-weight:bold}.mono{font-family:consolas,monospace;white-space:nowrap}
      .chk{width:44px;text-align:center}
      /* 창고 동선 격자 */
      .grid-sec{margin-top:14px;page-break-inside:avoid}
      .grid-ttl{font-size:13px;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4px;margin-bottom:8px}
      .rack{display:inline-block;vertical-align:top;margin:0 14px 12px 0}
      .rack-name{font-size:12px;font-weight:bold;margin-bottom:2px}
      .rack-sub{font-size:9px;color:#777;font-weight:normal;margin-left:5px}
      table.grid{border-collapse:collapse;margin:0}
      table.grid th,table.grid td{border:1px solid #bbb;width:19px;height:19px;
        text-align:center;font-size:8px;padding:0;color:#999}
      table.grid th{background:#f5f5f5;font-weight:normal}
      table.grid th.lv{width:26px;font-size:8px}
      table.grid td.hit{background:#333;color:#fff;font-weight:bold;font-size:9px}
      .noloc{font-size:11px;color:#b00;margin-top:6px}
      tr{page-break-inside:avoid}
      .sign{margin-top:18px;font-size:12px;display:flex;gap:40px}
      .sign span{border-top:1px solid #999;padding-top:4px;min-width:120px;text-align:center}
      @media print{body{padding:0}}
    </style></head><body>
    <div class="head">
      <h1>자재 불출표</h1>
      <div class="meta">고객사: <b>${csName}</b> · 출력일: ${today}<br>총 ${rows.length}품목</div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:4%">No</th><th class="c" style="width:5%">부서</th><th style="width:12%">제조사</th><th style="width:15%">제조사품번</th>
        <th style="width:19%">기준코드</th><th style="width:24%">품명</th><th class="c" style="width:6%">수량</th><th class="c" style="width:5%">단위</th><th class="chk" style="width:10%">키팅<br>확인</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${gridHtml}
    <div class="sign"><span>작성</span><span>불출</span><span>확인</span></div>
    </body></html>`
    const w = window.open('', '_blank')
    if (!w) { toastError('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }
    w.document.write(html); w.document.close()
    w.onload = () => { w.focus(); w.print() }
  }

  // 라벨 ZPL 은 lib/labelZpl.js 에서 생성 (DPI 스케일 자동)

  // 출력 단위에 따라 실제 발행할 라벨 목록으로 펼친다.
  //   합산(sum)  → 1장, 합친 수량
  //   개별(each) → ceil(수량 / 원포장수량) 장. 각 장에 그 포장의 수량과 n/N 표기
  // 원포장 수량이 없으면 장수를 알 수 없으므로 1장으로 처리한다(합산과 동일).
  const MAX_PER_ITEM = 50   // 실수로 수백 장이 나가는 것 방지
  function expandLabels(rows) {
    const out = []
    const capped = []
    for (const r of rows) {
      const qty = Number(r.qty) || 0
      const pack = Number(r.packQty) || 0
      if (r.labelMode !== 'each' || pack <= 0 || qty <= pack) {
        out.push({ ...r, labelQty: r.qty, part: '', total: 1 })
        continue
      }
      let n = Math.ceil(qty / pack)
      if (n > MAX_PER_ITEM) { capped.push({ code: r.std_code, want: n }); n = MAX_PER_ITEM }
      for (let i = 0; i < n; i++) {
        const q = i === n - 1 ? qty - pack * (n - 1) : pack
        out.push({ ...r, labelQty: q, part: `${i + 1}/${n}`, total: n })
      }
    }
    return { labels: out, capped }
  }

  function printLabels() {
    // 전장(normal)만 + 위치값이 '라벨'인 것 제외 (라벨/스티커류는 라벨 안 뽑음)
    const isLabelLoc = (r) => String(r.location || '').trim() === '라벨'

    // ★ 라벨 NO 는 불출표(printIssueSheet)의 행번호와 일치해야 현장에서 대조된다.
    //   출력 대상만 다시 1,2,3... 매기면 하네스·미출력이 빠진 만큼 번호가 어긋난다.
    const sheetRows = itemRows.filter(r => !excluded.has(r.std_code))
    const noMap = new Map(sheetRows.map((r, i) => [r.std_code, i + 1]))

    const rows = sheetRows
      .filter(r => r.makeType === 'normal' && !isLabelLoc(r) && r.labelMode !== 'none')
      .map(r => ({ ...r, no: noMap.get(r.std_code) }))
    const skipped = sheetRows.filter(r => r.makeType !== 'normal' || isLabelLoc(r) || r.labelMode === 'none')
    if (!rows.length) { toastError('출력할 전장 자재가 없습니다 (현장재고·하네스·라벨류·미출력 제외).'); return }

    const { labels, capped } = expandLabels(rows)
    if (capped.length) {
      toastError(`원포장 수량이 작아 라벨이 과다합니다: ${capped.map(c => `${c.code} ${c.want}장`).join(', ')} → ${MAX_PER_ITEM}장으로 제한`)
    }
    // 바로 출력하지 않고 확인 모달을 띄운다 (개별 출력으로 장수가 불어날 수 있어 오출력 방지)
    const eachRows = rows.filter(r => r.labelMode === 'each' && Number(r.packQty) > 0 && Number(r.qty) > Number(r.packQty))
    setLabelConfirm({
      labels,
      itemCount: rows.length,
      labelCount: labels.length,
      eachCount: labels.filter(l => l.part).length,
      eachItems: eachRows.map(r => ({ code: r.std_code, qty: r.qty, pack: r.packQty, n: Math.min(MAX_PER_ITEM, Math.ceil(r.qty / r.packQty)) })),
      skipped: skipped.length,
    })
  }

  // 확인 모달에서 '출력' 누르면 실제 전송
  function sendLabels(labels) {
    setLabelConfirm(null)
    const zpl = buildLabelZpl(labels)
    const BP = window.BrowserPrint
    if (!BP) { toastError('Zebra Browser Print가 설치/실행되어 있지 않습니다. (PC에 설치 후 재시도)'); return }
    BP.getDefaultDevice('printer', (device) => {
      if (!device) { toastError('기본 프린터를 찾을 수 없습니다. Browser Print에서 ZM400을 등록하세요.'); return }
      device.send(zpl, () => {
        const eachN = labels.filter(l => l.part).length
        toastSuccess(`전장 라벨 ${labels.length}장 전송${eachN ? ` · 개별출력 ${eachN}장 포함` : ''}`)
      }, (err) => toastError('라벨 전송 실패: ' + err))
    }, (err) => toastError('프린터 연결 실패: ' + err))
  }

  const issuedCnt = cart.filter(c => (Number(c.issue_qty ?? c.qty) || 0) > 0).length
  const shortCnt = cart.filter(c => shortQ(c) > 0).length

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      {labelConfirm && (
        <LabelConfirmModal data={labelConfirm} onCancel={() => setLabelConfirm(null)} onPrint={() => sendLabels(labelConfirm.labels)} />
      )}
      <h1 className="text-lg font-bold text-slate-800">🧺 다품목 출고 <span className="text-xs font-normal text-slate-400">· 여러 품목을 담아 한 번에 · ASSY 는 하위로 전개</span></h1>

      {/* 고객사 — 담은 것이 섞이지 않도록 고객사마다 따로 담긴다 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {customers.map(c => (
          <button key={c.code} onClick={() => { setCsCode(c.code); setPicked([]) }}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md ${
              csCode === c.code ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            {c.name}
          </button>
        ))}
      </div>

      {/* 담기 영역 */}
      <div className="grid gap-3">
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-slate-600">
            다품목 출고
            <span className="font-normal text-slate-400 ml-1.5">
              ASSY 를 고르면 하위가 전개됩니다
            </span>
          </p>
          <input value={itemSearch} onChange={e => searchItem(e.target.value)}
            placeholder="기준코드·품명·제조사품번 검색"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg" />
          {itemHits.length > 0 && (
            <div className="border border-slate-100 rounded-lg divide-y max-h-40 overflow-auto">
              {itemHits.map(it => (
                <button key={it.id} onClick={() => pickItem(it)}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-indigo-50">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-indigo-600">{it.std_code}</span>
                    {it.is_assy && (
                      <span className="px-1 py-0.5 rounded bg-violet-100 text-violet-700 text-[9px] font-bold">
                        ASSY {it.child_cnt}
                      </span>
                    )}
                    <span className="text-slate-500 truncate">{it.name}</span>
                  </div>
                  {(it.maker || it.maker_code || it.spec) && (
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {it.maker}
                      {it.maker && it.maker_code ? ' · ' : ''}
                      <span className="font-mono">{it.maker_code}</span>
                      {it.spec && <span className="ml-1.5">{it.spec}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 담은 목록 — 수량을 정한 뒤 한 번에 전개한다 */}
          {picked.length > 0 && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 divide-y divide-indigo-100">
              {picked.map((p, i) => (
                <div key={p.std_code} className="px-2 py-1.5 flex items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-indigo-700 flex-shrink-0">{p.std_code}</span>
                  {p.is_assy && (
                    <span className="px-1 py-0.5 rounded bg-violet-100 text-violet-700 text-[9px] font-bold flex-shrink-0">
                      ASSY
                    </span>
                  )}
                  <span className="text-slate-500 flex-1 truncate">{p.name}</span>
                  <input type="number" min="1" value={p.qty}
                    onChange={e => setPicked(prev => prev.map((x, j) =>
                      j === i ? { ...x, qty: e.target.value } : x))}
                    className="w-14 px-1.5 py-1 text-right border border-indigo-200 rounded" />
                  <span className="text-slate-400 w-6">{p.unit}</span>
                  <button onClick={() => setPicked(prev => prev.filter((_, j) => j !== i))}
                    className="text-slate-300 hover:text-rose-500 px-1">✕</button>
                </div>
              ))}
              <div className="px-2 py-2 flex items-center gap-2">
                <span className="text-[11px] text-slate-500 flex-1">
                  {picked.length}품목 · ASSY {picked.filter(p => p.is_assy).length}개
                </span>
                <button onClick={() => setPicked([])}
                  className="px-2 py-1 text-[11px] text-slate-400">비우기</button>
                <button onClick={explodeAndAdd} disabled={busy}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                  {busy ? '전개 중…' : '전개해서 담기'}
                </button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-400">고객사 PO에서 체크 → 담기로도 들어옵니다</p>
        </div>
      </div>

      {/* 장바구니 */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">장바구니 {cart.length}건 · 불출 {issuedCnt} / 결품 {shortCnt}</span>
          <div className="flex gap-2">
            <button onClick={() => { if (cart.length && window.confirm(`장바구니 ${cart.length}건을 전부 비울까요?\n(출고 처리는 안 되고 목록만 초기화)`)) clearMut.mutate() }}
              disabled={!cart.length || clearMut.isPending} className="px-3 py-1 text-xs font-semibold rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40">🗑 초기화</button>
            <button onClick={() => setTimeout(printIssueSheet, 100)} disabled={!cart.length} title="제외 체크한 품목 빼고, 제조사→제조사품번 순으로 불출표 인쇄" className="px-3 py-1 text-xs font-semibold rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40">🖨 불출표 출력</button>
            <button onClick={printLabels} disabled={!cart.length} title="위치값 있는 품목을 ZM400 라벨로 출력 (Zebra Browser Print 필요)" className="px-3 py-1 text-xs font-semibold rounded border border-teal-200 text-teal-600 hover:bg-teal-50 disabled:opacity-40">🏷 라벨 출력</button>
            <button onClick={() => { if (cart.length && window.confirm(`불출분 출고처리 / 결품 ${shortCnt}건 기록. 진행할까요?`)) processMut.mutate() }}
              disabled={!cart.length || processMut.isPending} className="px-3 py-1 text-xs font-bold rounded bg-teal-600 text-white disabled:opacity-40">
              ✅ 출고 처리
            </button>
          </div>
        </div>
        {cart.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate-400">담긴 품목이 없습니다</p>
        ) : cartView === 'item' ? (
          <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead><tr className="bg-slate-50 text-slate-400">
              <th className="px-2 py-1.5 text-center w-8">No</th>
              <th className="px-2 py-1.5 text-center w-12">부서</th>
              <th className="px-2 py-1.5 text-left">제조사</th><th className="px-2 py-1.5 text-left">제조사품번</th>
              <th className="px-2 py-1.5 text-left">기준코드</th><th className="px-2 py-1.5 text-left">품명</th>
              <th className="px-2 py-1.5 text-center w-12">단위</th>
              <th className="px-2 py-1.5 text-left">호기</th>
              <th className="px-2 py-1.5 text-right">총소요</th><th className="px-2 py-1.5 text-right">총불출</th><th className="px-2 py-1.5 text-right">총결품</th>
              <th className="px-2 py-1.5 text-center w-36" title="라벨 출력 단위 — 바꾸면 품목에 저장되어 다음에도 유지됩니다">라벨</th>
              <th className="px-2 py-1.5 text-center w-10" title="체크 = 불출표에서 제외">제외</th>
            </tr></thead>
            <tbody>
              {(() => {
                // 화면 NO 를 불출표·라벨과 같은 기준으로 매긴다 (제외 항목은 번호 없음)
                let n = 0
                return itemRows.map((a, i) => {
                const ex = excluded.has(a.std_code)
                const sheetNo = ex ? null : ++n
                return (
                <tr key={a.std_code} className={`border-t border-slate-100 ${ex ? 'opacity-40 bg-slate-50' : a.short > 0 ? 'bg-red-50/40' : ''}`}>
                  <td className="px-2 py-1.5 text-center text-slate-400">{sheetNo ?? '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {a.dept
                      ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${deptStyle(a.dept)}`}>{deptShort(a.dept)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500 max-w-[90px] truncate">{a.maker || '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-violet-600 max-w-[120px] truncate">{a.makerPn || '—'}</td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-indigo-600">{a.std_code}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[150px] truncate">
                    {/* 하네스는 창고에서 빼는 게 아니라 만드는 것이라 구분한다 */}
                    {a.makeType === 'harness' && (
                      <span className="px-1 py-0.5 mr-1 rounded bg-amber-100 text-amber-700 text-[9px] font-bold">하네스</span>
                    )}
                    {a.name}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-400">{a.unit || '-'}</td>
                  <td className="px-2 py-1.5 text-slate-400 max-w-[120px] truncate" title={[...a.srcs].join(', ')}>{[...a.srcs].join(', ')}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-slate-700">{a.qty}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-teal-600">{a.issue}</td>
                  <td className={`px-2 py-1.5 text-right font-bold ${a.short > 0 ? 'text-red-500' : 'text-slate-300'}`}>{a.short || '-'}</td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    {a.makeType === 'normal' && String(a.location || '').trim() !== '라벨' ? (
                      <div className="inline-flex items-center gap-1">
                        <div className="inline-flex rounded border border-slate-200 overflow-hidden">
                          {[['sum', '합산'], ['each', '개별']].map(([m2, l2]) => (
                            <button key={m2} onClick={() => saveLabelMode(a, m2)}
                              title={m2 === 'sum' ? '소분봉투 1개에 라벨 1장 (합친 수량)' : '포장 단위마다 라벨 1장'}
                              className={`px-1.5 py-0.5 text-[10px] font-bold ${a.labelMode === m2
                                ? (m2 === 'sum' ? 'bg-teal-600 text-white' : 'bg-amber-500 text-white')
                                : 'text-slate-400 hover:text-slate-600'}`}>{l2}</button>
                          ))}
                        </div>
                        {a.labelMode === 'each' && (
                          <input type="number" value={a.packQty ?? ''} placeholder="원포장"
                            onChange={(e) => setPackOv(v => ({ ...v, [a.std_code]: e.target.value === '' ? null : Number(e.target.value) }))}
                            onBlur={(e) => saveLabelMode(a, 'each', e.target.value)}
                            title="원포장 수량 (100개입이면 100). 비우면 1장만 출력됩니다"
                            className={`w-14 px-1 py-0.5 text-[10px] text-right border rounded ${
                              Number(a.packQty) > 0 ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}`} />
                        )}
                        {a.labelMode === 'each' && Number(a.packQty) > 0 && (
                          <span className="text-[10px] text-amber-600 font-bold">
                            {Math.min(50, Math.ceil((Number(a.qty) || 0) / Number(a.packQty)))}장
                          </span>
                        )}
                      </div>
                    ) : <span className="text-slate-300 text-[10px]">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={ex} onChange={() => setExcluded(p => { const n = new Set(p); n.has(a.std_code) ? n.delete(a.std_code) : n.add(a.std_code); return n })} title="불출표에서 제외" />
                  </td>
                </tr>
              )})
              })()}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead><tr className="bg-slate-50 text-slate-400">
              <th className="px-2 py-1.5 text-left">기준코드</th><th className="px-2 py-1.5 text-left">품명</th>
              <th className="px-2 py-1.5 text-left">호기</th><th className="px-2 py-1.5 text-right">소요</th>
              <th className="px-2 py-1.5 text-right">불출</th><th className="px-2 py-1.5 text-right">결품</th><th className="px-2 py-1.5"></th>
            </tr></thead>
            <tbody>
              {cart.map(ln => {
                const sh = shortQ(ln)
                return (
                <tr key={ln.id} className={`border-t border-slate-100 ${sh > 0 ? 'bg-red-50/40' : ''}`}>
                  <td className="px-2 py-1.5 font-mono font-semibold text-indigo-600">{ln.std_code}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[180px]">
                    <div className="truncate">{ln.name}</div>
                    {itemMeta[ln.item_id]?.manufacturer_code && (
                      <div className="truncate text-[10px] text-violet-500 font-mono">{itemMeta[ln.item_id]?.manufacturer} · {itemMeta[ln.item_id]?.manufacturer_code}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">{ln.source === 'hogi' ? `${ln.pn} ${ln.hogi}` : '직접'}</td>
                  <td className="px-2 py-1.5 text-right text-slate-500">{ln.qty}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input type="number" value={ln.issue_qty ?? ln.qty} onChange={e => updMut.mutate({ id: ln.id, patch: { issue_qty: Number(e.target.value) } })}
                      className="w-16 px-1 py-0.5 text-right border border-slate-200 rounded" />
                  </td>
                  <td className={`px-2 py-1.5 text-right font-bold ${sh > 0 ? 'text-red-500' : 'text-slate-300'}`}>{sh || '-'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => delMut.mutate(ln.id)} className="text-slate-300 hover:text-red-500">✕</button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {msg && <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap text-slate-600">{msg}</pre>}
    </div>
  )
}


// 라벨 출력 전 확인 모달 — 몇 장 나가는지 보고 나서 출력한다 (오출력 방지)
function LabelConfirmModal({ data, onCancel, onPrint }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-3">🏷 라벨 출력</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">품목</span><span className="font-bold">{data.itemCount}건</span></div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">출력 매수</span>
            <span className="text-xl font-bold text-teal-600">{data.labelCount}장</span>
          </div>
          {data.eachCount > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
              <p className="font-bold text-amber-700 mb-1">개별 출력 {data.eachCount}장 포함</p>
              {data.eachItems.map(it => (
                <div key={it.code} className="flex justify-between text-amber-700">
                  <span className="font-mono">{it.code}</span>
                  <span>{it.qty} / {it.pack}개입 → <b>{it.n}장</b></span>
                </div>
              ))}
            </div>
          )}
          {data.skipped > 0 && (
            <p className="text-xs text-slate-400">제외 {data.skipped}건 (하네스·현장재고·라벨류·미출력)</p>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
          <button onClick={onPrint} className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-teal-600 text-white hover:bg-teal-700">출력</button>
        </div>
      </div>
    </div>
  )
}
