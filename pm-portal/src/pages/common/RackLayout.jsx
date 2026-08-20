import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import QrScanner from '../../components/QrScanner'
import { useCanEdit } from '../../hooks/useProfile'

const GW = 80, GH = 62       // 격자 전체 크기 (랙 1칸 = 격자 1.5칸)
// 배치도 확대 단계. 13px 이 기본(18px 대비 약 70%)이며,
// 좁은 화면에서는 더 작은 단계에서 시작한다.
const ZOOMS = [9, 11, 13, 16, 18, 22]
const pad = (v) => String(v).padStart(2, '0')
const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

const OBJ_STYLE = {
  '기둥': { bg: '#1e293b', fg: '#fff' },
  '출입구': { bg: '#22c55e', fg: '#fff' },
  '벽': { bg: '#475569', fg: '#fff' },
  '통로': { bg: '#fef3c7', fg: '#92400e' },
  '설비': { bg: '#fed7aa', fg: '#9a3412' },
  '문서': { bg: '#e7e5e4', fg: '#57534e' },
  '기타': { bg: '#f1f5f9', fg: '#64748b' },
}

// 창고 배치도. 기둥 때문에 랙 간격이 일정하지 않아
// 격자 위에서 직접 끌어 옮기고 좌표를 저장하는 방식으로 만들었다.
export default function RackLayout() {
  const nav = useNavigate()
  const { code } = useParams()
  const qc = useQueryClient()
  const canEdit = useCanEdit()

  const [tab, setTab] = useState(code ? 'sheet' : 'map')
  const [sel, setSel] = useState((code || '').toUpperCase())
  const [qr, setQr] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [zoom, setZoom] = useState(() => {
    // 폰은 가장 작게, 태블릿은 한 단계 위, 그 외는 13px(70%)
    if (typeof window === 'undefined') return 2
    if (window.innerWidth < 640) return 0
    if (window.innerWidth < 1024) return 1
    return 2
  })
  const [printMode, setPrintMode] = useState(false)   // 인쇄용 — 코드를 크게, 색은 최소로
  const CELL = ZOOMS[zoom]

  // 배치도 인쇄.
  //
  //   화면 요소를 숨기는 방식은 Layout 의 overflow 구조에 걸려
  //   빈 종이가 나온다. 배치도 부분만 새 창에 복사해 인쇄한다.
  function printMap() {
    if (!boardRef.current) { toastError('배치도를 찾을 수 없습니다'); return }
    // 인쇄 모양(코드 크게·색 없음)이 반영된 뒤 복사해야 한다
    setPrintMode(true)
    setTimeout(() => { doPrintMap(); setPrintMode(false) }, 150)
  }

  // 랙 안내판 인쇄.
  //
  //   랙 앞면에 붙여 칸 번호를 세지 않고도 위치를 찾게 한다.
  //   품목은 적지 않는다 — 한 랙에 여러 브랜드·품목이 섞여 있어
  //   적어두면 금방 낡고 오히려 헷갈리기 때문이다.
  function printRackBoard(only) {
    const target = only ? racks.filter(r => r.code === only) : racks
    if (!target.length) { toastError('출력할 랙이 없습니다'); return }

    const win = window.open('', '_blank', 'width=900,height=1000')
    if (!win) { toastError('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }

    const pages = target.map(r => {
      const cells = []
      for (let lv = r.levels_cnt; lv >= 1; lv--) {
        const tds = []
        for (let c = 1; c <= r.rows_cnt; c++) tds.push(`<td>${String(c).padStart(2, '0')}</td>`)
        cells.push(`<tr><th>${lv}층</th>${tds.join('')}</tr>`)
      }
      return `<div class="page">
        <div class="hd">
          <div class="code">${r.code}</div>
          <div class="spec">${r.rows_cnt}칸 × ${r.levels_cnt}층<br><span>${r.zone || ''}</span></div>
        </div>
        <table class="grid">${cells.join('')}</table>
        <div class="ft">
          <div class="fmt">
            <div class="fmt-t">위치 표기</div>
            <div class="fmt-v">${r.code}-05-1</div>
            <div class="fmt-l"><span>랙</span><span>칸</span><span>층</span></div>
          </div>
          <div class="note">자재 위치는 창고 입구 태블릿에서 검색하세요</div>
        </div>
      </div>`
    }).join('')

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>랙 안내판</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,'Malgun Gothic',sans-serif;color:#111}
  .page{width:277mm;height:190mm;padding:10mm;page-break-after:always;
        display:flex;flex-direction:column}
  .hd{display:flex;align-items:flex-end;justify-content:space-between;
      border-bottom:4px solid #111;padding-bottom:6mm;margin-bottom:8mm}
  .code{font-size:110px;font-weight:900;line-height:0.9;letter-spacing:-4px;
        font-family:ui-monospace,Menlo,monospace}
  .spec{font-size:20px;font-weight:700;text-align:right;line-height:1.4}
  .spec span{font-size:14px;font-weight:400;color:#666}
  table.grid{width:100%;border-collapse:collapse;flex:1}
  table.grid th,table.grid td{border:2px solid #111;text-align:center;
    font-family:ui-monospace,Menlo,monospace;font-weight:700}
  table.grid th{background:#111;color:#fff;width:60px;font-size:22px}
  table.grid td{font-size:26px}
  .ft{display:flex;align-items:center;justify-content:space-between;margin-top:8mm}
  .fmt{border:3px solid #111;padding:4mm 8mm;text-align:center}
  .fmt-t{font-size:13px;color:#666;font-weight:700}
  .fmt-v{font-size:38px;font-weight:900;font-family:ui-monospace,Menlo,monospace;
         letter-spacing:2px;line-height:1.2}
  .fmt-l{display:flex;justify-content:space-around;font-size:12px;color:#666;font-weight:700}
  .note{font-size:15px;color:#444;font-weight:600}
  @page{size:A4 landscape;margin:0}
  @media print{.page{page-break-after:always}}
</style></head><body>${pages}</body></html>`)
    win.document.close()
    win.onload = () => { win.focus(); win.print() }
  }

  function doPrintMap() {
    const el = boardRef.current
    if (!el) return
    const w = GW * CELL, h = GH * CELL
    // A4 가로 인쇄 영역(여백 6mm) 에서 제목 줄을 뺀 크기
    const scale = Math.min(1096 / w, 700 / h, 1)

    const win = window.open('', '_blank', 'width=1200,height=800')
    if (!win) { toastError('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>창고 배치도</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:8px;font-family:-apple-system,'Malgun Gothic',sans-serif;background:#fff}
  .ttl{font-size:14px;font-weight:800;color:#0f172a}
  .sub{font-size:9px;color:#64748b;margin-bottom:6px}
  /* scale 은 원본 크기만큼 자리를 차지해 종이를 넘긴다.
     겉을 축소된 크기로 감싸 실제 차지하는 공간을 맞춘다. */
  .box{width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px;overflow:hidden}
  .canvas{position:relative;transform:scale(${scale});transform-origin:top left;
          width:${w}px;height:${h}px}
  @page{size:A4 landscape;margin:6mm}
  @media print{body{padding:0}}
</style></head><body>
  <div class="ttl">진선테크 창고 배치도</div>
  <div class="sub">랙 ${racks.length}면 · ${n(total)}칸 · 출력 ${new Date().toLocaleDateString('ko-KR')}</div>
  <div class="box"><div class="canvas">${el.innerHTML}</div></div>
</body></html>`)
    win.document.close()
    win.onload = () => { win.focus(); win.print() }
  }

  // 편집 상태 — 저장 전까지 화면에만 반영된다
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [drag, setDrag] = useState(null)
  const [pick, setPick] = useState(null)   // 편집 중 선택한 대상
  const boardRef = useRef(null)

  const { data: racks = [], isLoading } = useQuery({
    queryKey: ['rackUsage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_rack_usage')
      if (error) throw error
      return data || []
    },
    staleTime: 60 * 1000,
  })

  const { data: objs = [] } = useQuery({
    queryKey: ['floorObjects'],
    queryFn: async () => {
      const { data } = await supabase.from('pm_floor_object').select('*').order('id')
      return data || []
    },
    staleTime: 60 * 1000,
  })

  const { data: cells = [] } = useQuery({
    queryKey: ['rackMap', sel],
    enabled: !!sel,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.rpc('pm_rack_map', { p_rack: sel })
      return data || []
    },
  })

  const rack = racks.find(r => r.code === sel)
  const cellMap = useMemo(() => {
    const m = {}
    cells.forEach(c => { m[`${c.row_no}-${c.level_no}`] = c })
    return m
  }, [cells])

  useEffect(() => {
    if (!sel) { setQr(''); return }
    QRCode.toDataURL(`${window.location.origin}/rack/${sel}`, { width: 240, margin: 0 })
      .then(setQr).catch(() => setQr(''))
  }, [sel])

  // 실사하며 자리를 옮길 때 기존 위치를 지운다.
  //   위치만 비우고 재고 수량은 그대로 둔다.
  const [clearAsk, setClearAsk] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [snapOpen, setSnapOpen] = useState(false)

  // 비운 기록 — 되돌릴 수 있게 남겨둔다
  const { data: snaps = [] } = useQuery({
    queryKey: ['rackSnaps'],
    enabled: snapOpen,
    queryFn: async () => {
      const { data } = await supabase.rpc('pm_rack_snapshots', { p_days: 30 })
      return data || []
    },
  })

  async function restore(id) {
    try {
      const { data, error } = await supabase.rpc('pm_rack_restore', { p_snap_id: id })
      if (error) throw error
      toastSuccess(data || '복구됨')
      qc.invalidateQueries({ queryKey: ['rackMap'], exact: false })
      qc.invalidateQueries({ queryKey: ['rackUsage'], exact: false })
      qc.invalidateQueries({ queryKey: ['rackSnaps'] })
    } catch (e) { toastError('복구 실패: ' + e.message) }
  }

  async function doClearCell(row, lv, cell) {
    setClearAsk({
      kind: 'cell', row, lv,
      msg: `${sel}-${String(row).padStart(2,'0')}-${lv} 칸의 위치를 지웁니다`,
      detail: (cell.items || []).map(x => x.std_code).join(', ') || cell.codes,
      cnt: Number(cell.item_count) || 0,
    })
  }

  async function runClear() {
    if (!clearAsk) return
    try {
      const { data, error } = clearAsk.kind === 'cell'
        ? await supabase.rpc('pm_rack_clear_cell',
            { p_rack: sel, p_row: clearAsk.row, p_level: clearAsk.lv })
        : await supabase.rpc('pm_rack_clear', { p_rack: sel })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      if (r?.snap_id) {
        toastSuccess(`${r.cnt}건 비움 — 되돌리려면 복구 기록에서 #${r.snap_id}`)
      } else {
        toastSuccess('비울 항목이 없습니다')
      }
      setConfirmText('')
      qc.invalidateQueries({ queryKey: ['rackMap'], exact: false })
      qc.invalidateQueries({ queryKey: ['rackUsage'], exact: false })
      qc.invalidateQueries({ queryKey: ['inventory'], exact: false })
      setClearAsk(null)
    } catch (e) { toastError('실패: ' + e.message) }
  }

  function startEdit() {
    // 저장하지 못하고 나간 작업이 있으면 이어서 할지 묻는다
    try {
      const saved = sessionStorage.getItem('rackDraft')
      if (saved && confirm('저장하지 않은 편집 내용이 있습니다.\n이어서 하시겠습니까?\n\n(취소하면 현재 저장된 배치부터 시작합니다)')) {
        setDraft(JSON.parse(saved)); setEditing(true); return
      }
      sessionStorage.removeItem('rackDraft')
    } catch { /* 파싱 실패 시 아래로 */ }

    const m = {}
    racks.forEach(r => {
      m[r.code] = { x: r.grid_x ?? 0, y: r.grid_y ?? 0, w: r.grid_w ?? 2, h: r.grid_h ?? 8 }
    })
    setDraft({ racks: m, objs: objs.map(o => ({ ...o })) })
    setEditing(true)
  }

  // 편집 내용을 브라우저에 임시 보관한다.
  // 저장이 실패하거나 실수로 새로고침해도 작업이 날아가지 않게.
  useEffect(() => {
    if (!editing || !draft) return
    try { sessionStorage.setItem('rackDraft', JSON.stringify(draft)) } catch { /* 용량 초과 등은 무시 */ }
  }, [editing, draft])

  async function saveLayout() {
    if (!draft) return
    try {
      const rackRows = Object.entries(draft.racks).map(([c, v]) => ({ code: c, x: v.x, y: v.y, w: v.w, h: v.h }))
      const objRows = draft.objs.map(o => ({
        kind: o.kind, label: o.label, x: o.grid_x, y: o.grid_y, w: o.grid_w, h: o.grid_h, color: o.color,
      }))
      const { error } = await supabase.rpc('pm_save_layout', { p_racks: rackRows, p_objects: objRows })
      if (error) throw error   // error 객체에 details·hint 가 담겨 있다
      try { sessionStorage.removeItem('rackDraft') } catch { /* 무시 */ }
      toastSuccess('배치 저장 완료')
      qc.invalidateQueries({ queryKey: ['rackUsage'] })
      qc.invalidateQueries({ queryKey: ['floorObjects'] })
      setEditing(false); setDraft(null); setPick(null)
    } catch (e) {
      // PostgREST 는 오류를 details·hint 에 나눠 담는 경우가 있다
      const msg = [e?.message, e?.details, e?.hint].filter(Boolean).join(' · ')
      toastError('저장 실패: ' + (msg || '알 수 없는 오류'))
      console.error('pm_save_layout 오류', e)
    }
  }

  const onMove = useCallback((e) => {
    if (!drag || !boardRef.current) return
    const b = boardRef.current.getBoundingClientRect()
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - b.left
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - b.top

    // 크기 조정 — 우하단 손잡이를 끌면 폭·높이가 바뀐다
    if (drag.mode === 'resize') {
      let w = Math.max(1, Math.round(cx / CELL) - drag.x)
      let h = Math.max(1, Math.round(cy / CELL) - drag.y)
      w = Math.min(w, GW - drag.x); h = Math.min(h, GH - drag.y)
      setDraft(d => {
        if (!d) return d
        if (drag.type === 'rack') {
          return { ...d, racks: { ...d.racks, [drag.id]: { ...d.racks[drag.id], w, h } } }
        }
        return { ...d, objs: d.objs.map((o, i) => i === drag.id ? { ...o, grid_w: w, grid_h: h } : o) }
      })
      return
    }

    // 위치 이동
    let gx = Math.round(cx / CELL) - drag.ox
    let gy = Math.round(cy / CELL) - drag.oy
    gx = Math.max(0, Math.min(GW - drag.w, gx))
    gy = Math.max(0, Math.min(GH - drag.h, gy))
    setDraft(d => {
      if (!d) return d
      if (drag.type === 'rack') {
        return { ...d, racks: { ...d.racks, [drag.id]: { ...d.racks[drag.id], x: gx, y: gy } } }
      }
      return { ...d, objs: d.objs.map((o, i) => i === drag.id ? { ...o, grid_x: gx, grid_y: gy } : o) }
    })
  }, [drag, CELL])

  useEffect(() => {
    if (!drag) return
    const up = () => setDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchend', up)
    }
  }, [drag, onMove])

  function grab(e, type, id, x, y, w, h, mode = 'move') {
    if (!editing) return
    e.preventDefault(); e.stopPropagation()
    const b = boardRef.current.getBoundingClientRect()
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - b.left
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - b.top
    setDrag({ type, id, w, h, x, y, mode,
      ox: Math.round(cx / CELL) - x, oy: Math.round(cy / CELL) - y })
  }

  const rotate = (c) => setDraft(d => {
    const r = d.racks[c]
    return { ...d, racks: { ...d.racks, [c]: { ...r, w: r.h, h: r.w } } }
  })
  const addObj = (kind) => setDraft(d => {
    const size = kind === '기둥' ? [2, 2]
      : kind === '출입구' ? [4, 2]
      : kind === '벽' ? [10, 1]
      : [8, 3]
    // 설비·기타는 이름을 직접 넣어 쓰므로 기본값을 비워둔다
    const label = (kind === '설비' || kind === '기타') ? '' : kind
    return { ...d, objs: [...d.objs, { kind, label, grid_x: 2, grid_y: 2, grid_w: size[0], grid_h: size[1] }] }
  })
  const delObj = (i) => setDraft(d => ({ ...d, objs: d.objs.filter((_, k) => k !== i) }))

  const view = editing && draft
    ? racks.map(r => ({ ...r, grid_x: draft.racks[r.code]?.x, grid_y: draft.racks[r.code]?.y,
                        grid_w: draft.racks[r.code]?.w, grid_h: draft.racks[r.code]?.h }))
    : racks
  const viewObjs = editing && draft ? draft.objs : objs

  const total = racks.reduce((a, r) => a + (Number(r.cells_total) || 0), 0)
  const used = racks.reduce((a, r) => a + (Number(r.cells_used) || 0), 0)

  // 배치도를 엑셀로 — 랙 목록·사용률·좌표. 보고나 공유용.
  function exportLayout() {
    try {
      const rows = racks.map(r => {
        const t = Number(r.cells_total) || 0
        const u = Number(r.cells_used) || 0
        return {
          '랙코드': r.code,
          '구역': r.zone,
          '면': r.side,
          '칸수': r.rows_cnt,
          '층수': r.levels_cnt,
          '총칸': t,
          '사용칸': u,
          '사용률(%)': t ? Math.round(u / t * 100) : 0,
          '보관품목수': Number(r.item_count) || 0,
          '비고': r.memo || '',
          '배치X': r.grid_x ?? '',
          '배치Y': r.grid_y ?? '',
        }
      })
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 6 }, { wch: 6 }, { wch: 6 },
                     { wch: 7 }, { wch: 8 }, { wch: 10 }, { wch: 11 }, { wch: 18 }, { wch: 7 }, { wch: 7 }]

      // 기둥·설비도 별도 시트로
      const objRows = objs.map(o => ({
        '종류': o.kind, '이름': o.label || '',
        '위치X': o.grid_x, '위치Y': o.grid_y, '폭': o.grid_w, '높이': o.grid_h,
      }))

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '랙 현황')
      if (objRows.length) {
        const ws2 = XLSX.utils.json_to_sheet(objRows)
        ws2['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 7 }, { wch: 7 }, { wch: 6 }, { wch: 6 }]
        XLSX.utils.book_append_sheet(wb, ws2, '기둥·설비')
      }
      XLSX.writeFile(wb, `창고배치도_${new Date().toISOString().split('T')[0]}.xlsx`)
      toastSuccess(`랙 ${rows.length}면 내보냄`)
    } catch (e) {
      toastError('내보내기 실패: ' + (e?.message || e))
    }
  }

  function doPrint() {
    document.body.classList.add('printing-sheet')
    const done = () => { document.body.classList.remove('printing-sheet'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  return (
    <div className="space-y-3">
      <style>{`
        @media print {
          body.printing-sheet > * { display: none !important; }
          body.printing-sheet .sheet-print { display: block !important; }

          @page { size: A4 landscape; margin: 8mm; }
        }
        .sheet-print { display: none; }
        .print-title { display: none; }
      `}</style>

      <div className="no-print flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900">🗺 창고 배치도</h1>
          <p className="text-[11px] sm:text-xs text-slate-400">
            랙 {racks.length}면 · {n(total)}칸 중 {n(used)}칸 ({total ? Math.round(used / total * 100) : 0}%)
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setScanOpen(true)}
            className="px-2.5 sm:px-3 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap">
            📷<span className="hidden sm:inline"> QR 스캔</span>
          </button>
          {tab === 'map' && (
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => setZoom(z => Math.max(0, z - 1))} disabled={zoom === 0}
                title="축소" className="px-2.5 py-2 text-xs font-bold text-slate-500 bg-white hover:bg-slate-50 disabled:opacity-30">−</button>
              <span className="px-2 py-2 text-[11px] text-slate-400 border-x border-slate-200 bg-white">{Math.round(CELL / 18 * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1}
                title="확대" className="px-2.5 py-2 text-xs font-bold text-slate-500 bg-white hover:bg-slate-50 disabled:opacity-30">＋</button>
            </div>
          )}
          {tab === 'map' && (
            <button onClick={exportLayout}
              title="랙 목록과 배치 좌표를 엑셀로"
              className="no-print px-2.5 sm:px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 whitespace-nowrap">
              📊<span className="hidden sm:inline"> 엑셀</span>
            </button>
          )}
          {tab === 'map' && !editing && (
            <button onClick={() => printRackBoard(null)}
              title="랙마다 A4 한 장씩 — 랙 앞면에 붙이는 좌표 안내판입니다"
              className="no-print px-2.5 sm:px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 whitespace-nowrap">
              📋<span className="hidden sm:inline"> 랙 안내판</span>
            </button>
          )}
          {tab === 'map' && !editing && (
            <button onClick={printMap}
              title="배치도를 인쇄합니다 — 랙 코드를 크게 표시하고 사용률 색은 뺍니다"
              className="no-print px-2.5 sm:px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 whitespace-nowrap">
              🖨<span className="hidden sm:inline"> 배치도 인쇄</span>
            </button>
          )}
          {tab === 'map' && canEdit && (editing ? (
            <>
              <button onClick={() => { setEditing(false); setDraft(null); setPick(null) }}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600">취소</button>
              <button onClick={saveLayout}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">배치 저장</button>
            </>
          ) : (
            <button onClick={startEdit}
              className="px-2.5 sm:px-3 py-2 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 whitespace-nowrap">
              ✏️<span className="hidden sm:inline"> 배치 편집</span>
            </button>
          ))}
        </div>
      </div>

      {snapOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setSnapOpen(false)}>
          <div className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-800">비운 기록</h3>
                <p className="text-[11px] text-slate-400">최근 30일 · 비어 있는 품목만 되돌립니다</p>
              </div>
              <button onClick={() => setSnapOpen(false)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {!snaps.length && (
                <p className="text-center py-10 text-sm text-slate-400">기록이 없습니다</p>
              )}
              {snaps.map(sp => (
                <div key={sp.id}
                  className={`rounded-lg border p-3 ${sp.restored ? 'border-slate-100 bg-slate-50' : 'border-slate-200'}`}>
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-800">
                          {sp.rack_code}
                          {sp.scope === 'cell' && `-${String(sp.row_no).padStart(2,'0')}-${sp.level_no}`}
                        </span>
                        <span className="text-xs text-slate-500">{sp.cnt}건</span>
                        {sp.restored && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-bold text-slate-500">
                            복구됨
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sp.preview} …</p>
                      <p className="text-[10px] text-slate-400">
                        {String(sp.created_at).slice(0,16).replace('T',' ')} · {sp.who || ''}
                      </p>
                    </div>
                    {!sp.restored && (
                      <button onClick={() => restore(sp.id)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">
                        되돌리기
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {clearAsk && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setClearAsk(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 bg-rose-50 border-b border-rose-100">
              <h3 className="text-base font-bold text-rose-800">위치 비우기</h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-800">{clearAsk.msg}</p>
              {clearAsk.detail && (
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <p className="text-[11px] text-slate-500 break-all">{clearAsk.detail}</p>
                </div>
              )}
              <p className="text-xs text-slate-500">
                {clearAsk.cnt > 0 && <b>{clearAsk.cnt}개 품목 · </b>}
                위치만 지워지고 재고 수량은 그대로 남습니다. 되돌릴 수 없습니다.
              </p>
              {/* 랙 전체는 손실이 커서 코드를 직접 치게 한다.
                  버튼 한 번으로 47건이 사라진 적이 있다. */}
              {clearAsk.kind === 'rack' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    확인을 위해 <b className="text-rose-600">{sel}</b> 를 입력하세요
                  </label>
                  <input value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())}
                    autoFocus placeholder={sel}
                    className="w-full px-3 py-2.5 text-sm font-bold text-center border-2 border-slate-200 rounded-lg"
                    style={{ fontFamily: 'ui-monospace,Menlo,monospace' }} />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={runClear}
                  disabled={clearAsk.kind === 'rack' && confirmText !== sel}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-rose-600 text-white disabled:opacity-30">
                  비우기
                </button>
                <button onClick={() => { setClearAsk(null); setConfirmText('') }}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg border border-slate-300 text-slate-600">
                  취소
                </button>
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                비우기 전 목록이 저장되어 되돌릴 수 있습니다
              </p>
            </div>
          </div>
        </div>
      )}

      {scanOpen && (
        <QrScanner onClose={() => setScanOpen(false)}
          onScan={(loc) => { setScanOpen(false); nav(`/cell/${loc}`) }} />
      )}

      <div className="no-print flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[['map', '🗺 배치도'], ['sheet', '📋 랙 구성표']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg ${tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'map' && (
        <div className="no-print space-y-2">
          {editing && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
              <p className="text-xs font-bold text-indigo-800">
                편집 중 — <b>끌어서 이동</b> · <b>우하단 모서리</b>로 크기 조정 ·
                <b>클릭해서 선택</b>하면 방향 바꾸기·삭제를 할 수 있습니다
              </p>
              {/* 선택한 대상에 대한 작업 */}
              {pick && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white border border-indigo-300 px-2.5 py-1.5">
                  {pick.type === 'rack' ? (
                    <span className="text-xs font-bold text-indigo-700">{pick.id}</span>
                  ) : (
                    <>
                      <span className="text-[11px] font-bold text-slate-500">{draft?.objs[pick.id]?.kind}</span>
                      <input
                        value={draft?.objs[pick.id]?.label ?? ''}
                        onChange={e => setDraft(d => ({ ...d, objs: d.objs.map((o, i) =>
                          i === pick.id ? { ...o, label: e.target.value } : o) }))}
                        placeholder="이름 (예: 파렛트 적재구역)"
                        className="px-2 py-1 text-xs border border-slate-200 rounded w-44 focus:outline-none focus:border-indigo-400" />
                    </>
                  )}
                  <button onClick={() => {
                      if (pick.type === 'rack') rotate(pick.id)
                      else setDraft(d => ({ ...d, objs: d.objs.map((o, i) =>
                        i === pick.id ? { ...o, grid_w: o.grid_h, grid_h: o.grid_w } : o) }))
                    }}
                    className="px-2 py-1 text-[11px] font-bold rounded border border-slate-300 bg-white hover:bg-slate-50">
                    ⟳ 방향 바꾸기
                  </button>
                  {pick.type === 'obj' && (
                    <button onClick={() => { delObj(pick.id); setPick(null) }}
                      className="px-2 py-1 text-[11px] font-bold rounded border border-rose-300 text-rose-600 bg-rose-50 hover:bg-rose-100">
                      🗑 삭제
                    </button>
                  )}
                  <button onClick={() => setPick(null)}
                    className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-600">선택 해제</button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">추가</span>
                {['기둥', '벽', '출입구', '통로', '설비', '문서', '기타'].map(k => (
                  <button key={k} onClick={() => addObj(k)}
                    className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-300 bg-white hover:bg-slate-50">
                    + {k}
                  </button>
                ))}
                
              </div>
            </div>
          )}

          {isLoading && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}

          <p className="no-print sm:hidden text-[11px] text-slate-400 mb-1.5">
            좌우로 밀어 보세요 · 랙을 누르면 칸별 현황이 열립니다
          </p>
          <div className="map-wrap bg-white rounded-xl border-2 border-slate-300 p-1.5 sm:p-3 overflow-auto"
            style={{ WebkitOverflowScrolling: 'touch' }}>
            {/* 인쇄물 제목 — 종이에만 나온다 */}
            <div className="print-title" style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>진선테크 창고 배치도</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>
                랙 {racks.length}면 · {n(total)}칸 · 출력 {new Date().toLocaleDateString('ko-KR')}
              </div>
            </div>
            <div ref={boardRef} className="map-canvas relative"
              style={{
                width: GW * CELL, height: GH * CELL,
                backgroundImage: 'linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)',
                backgroundSize: `${CELL}px ${CELL}px`,
                cursor: drag ? 'grabbing' : 'default',
              }}>
              {viewObjs.map((o, i) => {
                const st = OBJ_STYLE[o.kind] || OBJ_STYLE['기타']
                return (
                  <div key={i}
                    onMouseDown={e => grab(e, 'obj', i, o.grid_x, o.grid_y, o.grid_w, o.grid_h)}
                    onTouchStart={e => grab(e, 'obj', i, o.grid_x, o.grid_y, o.grid_w, o.grid_h)}
                    onClick={() => editing && setPick({ type: 'obj', id: i })}
                    title={o.label || o.kind}
                    style={{
                      position: 'absolute', left: o.grid_x * CELL, top: o.grid_y * CELL,
                      width: o.grid_w * CELL, height: o.grid_h * CELL,
                      // 인쇄는 흑백이라 옅은 색이 사라진다. 테두리를 넣어 형태를 남긴다.
                      background: printMode
                        ? (o.kind === '기둥' || o.kind === '벽' ? '#333' : '#fff')
                        : (o.color || st.bg),
                      color: printMode
                        ? (o.kind === '기둥' || o.kind === '벽' ? '#fff' : '#111')
                        : st.fg,
                      border: printMode ? '1px solid #333' : 'none',
                      fontSize: Math.max(8, Math.round(CELL * 0.62)),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 2, cursor: editing ? 'grab' : 'default',
                      outline: pick?.type === 'obj' && pick.id === i ? '3px solid #4f46e5' : 'none',
                      overflow: 'hidden', whiteSpace: 'nowrap',
                      padding: '0 2px', textOverflow: 'ellipsis',
                      fontWeight: o.kind === '기둥' || o.kind === '벽' ? 400 : 700,
                    }}>
                    {o.grid_w >= 3 && (printMode || (o.kind !== '기둥' && o.kind !== '벽')) ? (o.label || o.kind) : ''}
                    {editing && (
                      <span
                        onMouseDown={e => grab(e, 'obj', i, o.grid_x, o.grid_y, o.grid_w, o.grid_h, 'resize')}
                        onTouchStart={e => grab(e, 'obj', i, o.grid_x, o.grid_y, o.grid_w, o.grid_h, 'resize')}
                        title="크기 조정"
                        style={{
                          position: 'absolute', right: -1, bottom: -1, width: 11, height: 11,
                          background: '#fff', border: '2px solid #4f46e5', borderRadius: 2,
                          cursor: 'nwse-resize',
                        }} />
                    )}
                  </div>
                )
              })}

              {view.map(r => {
                const t = Number(r.cells_total) || 1
                const u = Number(r.cells_used) || 0
                const pct = Math.round(u / t * 100)
                // 인쇄용은 사용률 색을 빼고 코드가 잘 보이게 한다.
                // 종이에 랙 위치를 적어 쓰는 용도이기 때문이다.
                const col = printMode
                  ? { b: '#1e293b', g: '#ffffff', f: '#0f172a' }
                  : pct === 0 ? { b: '#94a3b8', g: '#f1f5f9', f: '#475569' }
                  : pct < 40 ? { b: '#10b981', g: '#d1fae5', f: '#065f46' }
                  : pct < 75 ? { b: '#f59e0b', g: '#fef3c7', f: '#92400e' }
                  : { b: '#f43f5e', g: '#ffe4e6', f: '#9f1239' }
                const gw = r.grid_w ?? 2, gh = r.grid_h ?? 8
                const w = gw * CELL, h = gh * CELL
                const vertical = h > w
                return (
                  <div key={r.code}
                    onMouseDown={e => grab(e, 'rack', r.code, r.grid_x ?? 0, r.grid_y ?? 0, gw, gh)}
                    onTouchStart={e => grab(e, 'rack', r.code, r.grid_x ?? 0, r.grid_y ?? 0, gw, gh)}
                    onClick={() => { if (editing) setPick({ type: 'rack', id: r.code }); else { setSel(r.code); setTab('sheet') } }}
                    title={`${r.code} · ${r.side} ${r.rows_cnt}칸 ${r.levels_cnt}층 · ${u}/${t} (${pct}%)${r.memo ? '\n' + r.memo : ''}`}
                    style={{
                      position: 'absolute', left: (r.grid_x ?? 0) * CELL, top: (r.grid_y ?? 0) * CELL,
                      width: w, height: h,
                      border: pick?.type === 'rack' && pick.id === r.code ? '3px solid #4f46e5' : `2px solid ${col.b}`,
                      background: col.g, color: col.f,
                      borderRadius: 4, boxShadow: pick?.type === 'rack' && pick.id === r.code ? '0 0 0 3px rgba(79,70,229,.2)' : '0 1px 2px rgba(15,23,42,.08)', cursor: editing ? 'grab' : 'pointer',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: vertical ? 'flex-start' : 'center',
                      paddingTop: vertical ? 3 : 0, gap: 1,
                      fontSize: 10, fontWeight: 700, overflow: 'hidden',
                    }}>
                    <span style={{
                      fontFamily: 'ui-monospace,Menlo,monospace',
                      fontSize: Math.max(printMode ? 13 : 10, Math.round(CELL * (printMode ? 1.05 : 0.85))),
                      fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px',
                    }}>{r.code}</span>
                    {/* 긴 랙은 반대쪽 끝에도 코드를 적는다.
                        창고에서 어느 방향으로 다가와도 랙을 알아볼 수 있어야 한다. */}
                    {(vertical ? h : w) > CELL * 12 && (
                      <span style={{
                        position: 'absolute',
                        ...(vertical ? { bottom: 3, left: 0, right: 0 } : { right: 4, top: 0, bottom: 0 }),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        fontSize: Math.max(printMode ? 11 : 9, Math.round(CELL * (printMode ? 0.9 : 0.7))),
                        fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px',
                        writingMode: 'horizontal-tb',
                      }}>{r.code}</span>
                    )}
                    {(vertical ? h : w) > CELL * 5 && (
                      printMode ? (
                        // 인쇄물에는 사용률 대신 규격을 적는다. 위치를 손으로 쓸 때 참고가 된다
                        <span style={{
                          fontSize: Math.max(8, Math.round(CELL * 0.5)), fontWeight: 600,
                          color: '#64748b', lineHeight: 1.4,
                        }}>{r.rows_cnt}×{r.levels_cnt}</span>
                      ) : (
                        <span style={{
                          fontSize: Math.max(8, Math.round(CELL * 0.58)), fontWeight: 700,
                          color: '#fff', background: col.b,
                          padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                          writingMode: 'horizontal-tb',
                        }}>{pct}%</span>
                      )
                    )}
                    {editing && (
                      <span
                        onMouseDown={e => grab(e, 'rack', r.code, r.grid_x ?? 0, r.grid_y ?? 0, gw, gh, 'resize')}
                        onTouchStart={e => grab(e, 'rack', r.code, r.grid_x ?? 0, r.grid_y ?? 0, gw, gh, 'resize')}
                        title="크기 조정"
                        style={{
                          position: 'absolute', right: -1, bottom: -1, width: 11, height: 11,
                          background: '#fff', border: `2px solid ${col.b}`, borderRadius: 2,
                          cursor: 'nwse-resize',
                        }} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded border-2 border-slate-300 bg-slate-50 inline-block"/>빈 랙</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded border-2 border-emerald-400 bg-emerald-50 inline-block"/>여유</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded border-2 border-amber-400 bg-amber-50 inline-block"/>보통</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded border-2 border-rose-400 bg-rose-50 inline-block"/>포화</span>
            <span className="ml-1">격자 1칸 ≈ 0.5m · 랙을 누르면 구성표로 이동</span>
          </div>
        </div>
      )}

      {tab === 'sheet' && (
        <>
          <div className="no-print bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">랙</label>
              <select value={sel} onChange={e => setSel(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-56">
                <option value="">선택하세요</option>
                {racks.map(r => (
                  <option key={r.code} value={r.code}>{r.code} · {r.zone} {r.rows_cnt}칸 {r.levels_cnt}층</option>
                ))}
              </select>
            </div>
            <button onClick={doPrint} disabled={!rack}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              🖨 A4 가로 인쇄
            </button>
            <button onClick={() => nav('/rack-tags')}
              className="px-4 py-2 text-sm font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              🏷 위치 태그 만들기
            </button>
          </div>

          {rack && canEdit && (
            <div className="no-print flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400 flex-1">
                칸의 ✕ 는 그 칸만, 오른쪽 버튼은 랙 전체 · 재고 수량은 남습니다
              </span>
              <button onClick={() => setSnapOpen(true)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">
                ↩ 비운 기록
              </button>
              <button onClick={() => setClearAsk({
                  kind: 'rack',
                  msg: `${sel} 랙 전체의 위치를 지웁니다`,
                  detail: '이 랙에 지정된 모든 품목의 보관 위치가 비워집니다',
                  cnt: Object.keys(cellMap).length,
                })}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-200 text-rose-600 bg-rose-50">
                🗑 랙 전체 비우기
              </button>
            </div>
          )}

          {rack && (
            <>
              <div className="no-print bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
                <SheetBody rack={rack} cellMap={cellMap} qr={qr}
                  onClearCell={canEdit ? doClearCell : null} />
              </div>
              <div className="sheet-print">
                <SheetBody rack={rack} cellMap={cellMap} qr={qr} print />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// 랙 구성표 — 격자 + 랙 QR. 랙 앞에 붙여 위치를 찾는 데 쓴다.
function SheetBody({ rack, cellMap, qr, print, onClearCell }) {
  const levels = Array.from({ length: rack.levels_cnt }, (_, i) => rack.levels_cnt - i)  // 위→아래
  const rows = Array.from({ length: rack.rows_cnt }, (_, i) => i + 1)

  return (
    <div style={{ background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6mm', marginBottom: '4mm' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: print ? '18mm' : '40px', fontWeight: 800, lineHeight: 1,
            fontFamily: 'ui-monospace,Menlo,monospace', letterSpacing: '-1mm' }}>
            {rack.code}
          </div>
          <div style={{ fontSize: print ? '4mm' : '13px', color: '#475569', marginTop: '1.5mm' }}>
            {rack.zone} · {rack.side} · {rack.rows_cnt}칸 × {rack.levels_cnt}층 = {rack.rows_cnt * rack.levels_cnt}칸
            {rack.memo ? ` · ${rack.memo}` : ''}
          </div>
        </div>
        {qr && (
          <div style={{ textAlign: 'center' }}>
            <img src={qr} alt={rack.code} style={{ width: print ? '24mm' : '80px', height: print ? '24mm' : '80px' }} />
            <div style={{ fontSize: print ? '2.6mm' : '10px', color: '#64748b', marginTop: '0.5mm' }}>랙 전체 현황</div>
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          {levels.map(lv => (
            <tr key={lv}>
              <td style={{
                width: print ? '14mm' : '48px', border: '0.3mm solid #1e293b', background: '#f1f5f9',
                textAlign: 'center', fontWeight: 800, fontSize: print ? '5mm' : '16px', padding: '1mm',
              }}>
                {lv}층
              </td>
              {rows.map(r => {
                const c = cellMap[`${r}-${lv}`]
                return (
                  <td key={r} style={{
                    border: '0.3mm solid #64748b',
                    height: print ? '22mm' : '72px',
                    verticalAlign: 'top', padding: '1mm',
                    background: c ? '#fef9c3' : '#fff',
                    position: 'relative',
                  }}>
                    <div style={{ fontSize: print ? '4mm' : '13px', fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>
                      {pad(r)}
                    </div>
                    {c && (
                      <div style={{ fontSize: print ? '2.2mm' : '9px', color: '#713f12', lineHeight: 1.3,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: print ? 6 : 5, WebkitBoxOrient: 'vertical' }}>
                        {/* 창고에서는 제조사품번으로 찾는 일이 많아 함께 적는다 */}
                        {(c.items || []).length
                          ? c.items.map((it, k) => (
                            <div key={k} style={{ marginBottom: '0.4mm' }}>
                              <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700 }}>
                                {it.std_code}
                              </span>
                              {it.maker && (
                                <span style={{ color: '#92642a' }}> · {it.maker}</span>
                              )}
                              {it.maker_code && (
                                <span style={{ color: '#92642a',
                                  fontFamily: 'ui-monospace,monospace' }}> · {it.maker_code}</span>
                              )}
                            </div>
                          ))
                          : c.codes}
                      </div>
                    )}
                    {!print && c && onClearCell && (
                      <button onClick={() => onClearCell(r, lv, c)}
                        title="이 칸 위치 비우기"
                        style={{ position: 'absolute', top: '2px', right: '2px',
                          fontSize: '10px', color: '#cbd5e1', background: 'none',
                          border: 0, cursor: 'pointer', lineHeight: 1, padding: '2px' }}>
                        ✕
                      </button>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: print ? '2.6mm' : '11px', color: '#94a3b8', marginTop: '2mm' }}>
        노란 칸 = 재고 있음 · 칸마다 붙인 QR 을 스캔하면 실사 화면이 열립니다 · 위치 표기 {rack.code}-칸-층
      </p>
    </div>
  )
}

// 배치도의 랙 하나. 사용률에 따라 색이 진해진다.
function RackBox({ r, onPick, wide, tall }) {
  const t = Number(r.cells_total) || 1
  const u = Number(r.cells_used) || 0
  const pct = Math.round(u / t * 100)
  const cls = pct === 0 ? 'bg-slate-50 border-slate-300 text-slate-400'
    : pct < 40 ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
    : pct < 75 ? 'bg-amber-50 border-amber-400 text-amber-800'
    : 'bg-rose-50 border-rose-400 text-rose-800'
  const size = wide ? { minWidth: 78, height: 40 } : tall ? { width: 38, height: 116 } : { minWidth: 60, height: 48 }

  return (
    <button onClick={() => onPick(r.code)}
      title={`${r.code} · ${r.side} ${r.rows_cnt}칸 ${r.levels_cnt}층 · ${u}/${t} 사용 (${pct}%)${r.memo ? `\n${r.memo}` : ''}`}
      className={`border-2 rounded transition-all hover:shadow-md hover:scale-[1.03] flex flex-col items-center justify-center ${cls}`}
      style={size}>
      <span className="font-mono text-xs font-bold leading-none">{r.code}</span>
      <span className="text-[9px] opacity-70 leading-tight mt-0.5">{r.rows_cnt}×{r.levels_cnt}</span>
      {pct > 0 && <span className="text-[9px] font-bold leading-none mt-0.5">{pct}%</span>}
    </button>
  )
}
