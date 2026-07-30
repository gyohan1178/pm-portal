import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const pad = (v) => String(v).padStart(2, '0')

// 위치 태그를 A4 로 인쇄한다. 칸마다 QR + 위치코드를 붙여두면
// 실사할 때 폰으로 스캔해 바로 수량을 입력할 수 있다.
//
//   태그 크기: 세로 40mm · 2열 (A4 장당 12개)
//   QR 내용: 실사 화면 주소 (https://…/cell/A1-05-1)
export default function RackTags() {
  const [allMode, setAllMode] = useState(false)   // 전체 랙 한 번에
  const [progress, setProgress] = useState(null)
  const [rackSel, setRackSel] = useState('')
  const [lvFrom, setLvFrom] = useState(1)
  const [lvTo, setLvTo] = useState(3)
  const [rowFrom, setRowFrom] = useState(1)
  const [rowTo, setRowTo] = useState(18)
  const [qrMap, setQrMap] = useState({})
  const [busy, setBusy] = useState(false)

  const { data: racks = [] } = useQuery({
    queryKey: ['rackList'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pm_rack').select('*').order('sort_no')
      if (error) throw error
      return data || []
    },
    staleTime: 10 * 60 * 1000,
  })

  const rack = racks.find(r => r.code === rackSel)

  // 랙을 고르면 칸·층 범위를 그 랙에 맞춘다
  useEffect(() => {
    if (!rack) return
    setRowFrom(1); setRowTo(rack.rows_cnt)
    setLvFrom(1); setLvTo(rack.levels_cnt)
  }, [rackSel])   // eslint-disable-line react-hooks/exhaustive-deps

  // 인쇄할 위치 목록 — 층 위→아래, 칸 좌→우 (현장에서 보는 순서)
  const cells = useMemo(() => {
    // 전체 모드 — 모든 랙의 모든 칸 (코팅해서 한 번에 붙일 때)
    if (allMode) {
      const out = []
      racks.forEach(rk => {
        for (let lv = rk.levels_cnt; lv >= 1; lv--) {
          for (let r = 1; r <= rk.rows_cnt; r++) {
            out.push({ loc: `${rk.code}-${pad(r)}-${lv}`, row: r, lv, rack: rk.code })
          }
        }
      })
      return out
    }
    if (!rack) return []
    const out = []
    for (let lv = Number(lvTo); lv >= Number(lvFrom); lv--) {
      for (let r = Number(rowFrom); r <= Number(rowTo); r++) {
        out.push({ loc: `${rack.code}-${pad(r)}-${lv}`, row: r, lv, rack: rack.code })
      }
    }
    return out
  }, [allMode, racks, rack, rowFrom, rowTo, lvFrom, lvTo])

  // 칸별 재고 — 태그에 현재 보관 품목을 함께 찍는다
  const { data: stockMap = {} } = useQuery({
    queryKey: ['rackStock', rackSel],
    enabled: !!rackSel && !allMode,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_rack_map', { p_rack: rackSel })
      if (error) return {}
      const m = {}
      ;(data || []).forEach(r => { m[`${pad(r.row_no)}-${r.level_no}`] = r })
      return m
    },
  })

  // QR 생성 — 스캔하면 그 칸의 실사 화면이 열린다
  async function buildQr() {
    if (!cells.length) return
    setBusy(true); setProgress({ done: 0, total: cells.length })
    try {
      const base = window.location.origin
      const m = {}
      for (let i = 0; i < cells.length; i++) {
        m[cells[i].loc] = await QRCode.toDataURL(`${base}/cell/${cells[i].loc}`, {
          width: 240, margin: 0, errorCorrectionLevel: 'M',
        })
        // 1,500개가 넘으면 시간이 걸리므로 진행률을 갱신하고 화면이 멈추지 않게 한다
        if (i % 40 === 0) {
          setProgress({ done: i, total: cells.length })
          await new Promise(r => setTimeout(r, 0))
        }
      }
      setQrMap(m)
      toastSuccess(`${cells.length}개 태그 준비 완료`)
    } catch (e) {
      toastError('QR 생성 실패: ' + e.message)
    } finally { setBusy(false); setProgress(null) }
  }

  function doPrint() {
    document.body.classList.add('printing-tags')
    const done = () => { document.body.classList.remove('printing-tags'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  const ready = cells.length > 0 && Object.keys(qrMap).length === cells.length

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body.printing-tags > * { display: none !important; }
          body.printing-tags .tag-print { display: block !important; }
          .tag-print { padding: 0 !important; }
          @page { size: A4; margin: 8mm; }
          .tag { break-inside: avoid; }
        }
        .tag-print { display: none; }
      `}</style>

      <div className="no-print">
        <h1 className="text-lg font-bold text-slate-900">🏷 랙 위치 태그</h1>
        <p className="text-xs text-slate-400">
          칸마다 붙일 QR 태그를 A4 로 인쇄합니다. 스캔하면 그 칸의 재고 실사 화면이 열립니다.
          (세로 40mm · A4 장당 12개)
        </p>
      </div>

      {/* 선택 */}
      <div className="no-print bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {[[false, '랙 선택'], [true, `전체 (${racks.reduce((a,r)=>a+r.rows_cnt*r.levels_cnt,0).toLocaleString()}칸)`]].map(([v, l]) => (
            <button key={String(v)} onClick={() => { setAllMode(v); setQrMap({}) }}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${allMode === v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>

        {allMode && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            전체 {cells.length.toLocaleString()}칸 · A4 <b>{Math.ceil(cells.length / 12)}장</b>.
            QR 생성에 20~30초 걸리고 인쇄 미리보기도 느립니다. 코팅해서 한 번에 붙일 때 쓰세요.
          </div>
        )}

        {progress && (
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>QR 생성 {progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span>
              <span>{Math.round(progress.done / progress.total * 100)}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress.done / progress.total * 100}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {!allMode && (
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">랙</label>
            <select value={rackSel} onChange={e => { setRackSel(e.target.value); setQrMap({}) }}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-48">
              <option value="">선택하세요</option>
              {racks.map(r => (
                <option key={r.code} value={r.code}>
                  {r.code} · {r.zone} {r.rows_cnt}칸 {r.levels_cnt}층{r.memo ? ` (${r.memo})` : ''}
                </option>
              ))}
            </select>
          </div>
          )}
          {allMode && (
            <>
              <button onClick={buildQr} disabled={busy}
                className="px-4 py-2 text-sm font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">
                {busy ? 'QR 생성 중…' : `🔳 전체 QR 만들기 (${cells.length.toLocaleString()})`}
              </button>
              <button onClick={doPrint} disabled={!ready}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                🖨 인쇄 ({Math.ceil(cells.length / 12)}장)
              </button>
            </>
          )}
          {!allMode && rack && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">칸 범위</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={rack.rows_cnt} value={rowFrom}
                    onChange={e => { setRowFrom(e.target.value); setQrMap({}) }}
                    className="w-16 px-2 py-2 text-sm text-right border border-slate-200 rounded-lg" />
                  <span className="text-slate-400 text-xs">~</span>
                  <input type="number" min={1} max={rack.rows_cnt} value={rowTo}
                    onChange={e => { setRowTo(e.target.value); setQrMap({}) }}
                    className="w-16 px-2 py-2 text-sm text-right border border-slate-200 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">층 범위</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={rack.levels_cnt} value={lvFrom}
                    onChange={e => { setLvFrom(e.target.value); setQrMap({}) }}
                    className="w-16 px-2 py-2 text-sm text-right border border-slate-200 rounded-lg" />
                  <span className="text-slate-400 text-xs">~</span>
                  <input type="number" min={1} max={rack.levels_cnt} value={lvTo}
                    onChange={e => { setLvTo(e.target.value); setQrMap({}) }}
                    className="w-16 px-2 py-2 text-sm text-right border border-slate-200 rounded-lg" />
                </div>
              </div>
              <button onClick={buildQr} disabled={busy || !cells.length}
                className="px-4 py-2 text-sm font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">
                {busy ? 'QR 생성 중…' : `🔳 QR 만들기 (${cells.length})`}
              </button>
              <button onClick={doPrint} disabled={!ready}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                🖨 인쇄 ({Math.ceil(cells.length / 12)}장)
              </button>
            </>
          )}
        </div>
        {rack && (
          <p className="text-[11px] text-slate-400">
            {rack.code} — {rack.side} · {rack.rows_cnt}칸 × {rack.levels_cnt}층 = {rack.rows_cnt * rack.levels_cnt}칸
            {' · '}선택 범위 {cells.length}개
          </p>
        )}
      </div>

      {/* 미리보기 */}
      {ready && (
        <div className="no-print bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-500 mb-3">미리보기 (처음 4개)</p>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            {cells.slice(0, 4).map(c => (
              <TagCard key={c.loc} loc={c.loc} qr={qrMap[c.loc]}
                stock={stockMap[`${pad(c.row)}-${c.lv}`]} preview />
            ))}
          </div>
        </div>
      )}

      {/* 인쇄 영역 */}
      <div className="tag-print">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2mm' }}>
          {cells.map(c => (
            <TagCard key={c.loc} loc={c.loc} qr={qrMap[c.loc]}
              stock={stockMap[`${pad(c.row)}-${c.lv}`]} />
          ))}
        </div>
      </div>
    </div>
  )
}

// 태그 하나 — 세로 40mm
function TagCard({ loc, qr, stock, preview }) {
  const [rack, row, lv] = loc.split('-')
  return (
    <div className="tag" style={{
      height: preview ? 'auto' : '40mm',
      border: '0.4mm solid #1e293b',
      borderRadius: '1.5mm',
      padding: '2mm',
      display: 'flex',
      gap: '2mm',
      alignItems: 'center',
      boxSizing: 'border-box',
      background: '#fff',
    }}>
      {qr && <img src={qr} alt={loc} style={{ width: '30mm', height: '30mm', flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '9mm', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.3mm', fontFamily: 'ui-monospace,Menlo,monospace' }}>
          {rack}
        </div>
        <div style={{ fontSize: '7mm', fontWeight: 700, lineHeight: 1.15, fontFamily: 'ui-monospace,Menlo,monospace' }}>
          {row}<span style={{ fontSize: '4mm', fontWeight: 400, color: '#64748b' }}>칸</span>
          {' '}
          {lv}<span style={{ fontSize: '4mm', fontWeight: 400, color: '#64748b' }}>층</span>
        </div>
        {stock ? (
          <div style={{ fontSize: '2.6mm', color: '#475569', marginTop: '1mm', lineHeight: 1.3,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {stock.item_count}품목 · {stock.codes}
          </div>
        ) : (
          <div style={{ fontSize: '2.8mm', color: '#cbd5e1', marginTop: '1mm' }}>빈 칸</div>
        )}
      </div>
    </div>
  )
}
