import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const pad = (v) => String(v).padStart(2, '0')

// 창고 배치도와 랙 구성표.
//
//   · 배치도  — 랙 위치를 한눈에. 사용률에 따라 색이 진해진다
//   · 구성표  — 랙 앞에 붙일 격자표 (칸 번호 + 랙 전체 QR)
export default function RackLayout() {
  const nav = useNavigate()
  const { code } = useParams()               // /rack/A1 로 들어오면 그 랙을 바로 보여준다
  const [tab, setTab] = useState(code ? 'sheet' : 'map')
  const [sel, setSel] = useState((code || '').toUpperCase())
  const [qr, setQr] = useState('')

  const { data: racks = [], isLoading } = useQuery({
    queryKey: ['rackUsage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_rack_usage')
      if (error) throw error
      return data || []
    },
    staleTime: 60 * 1000,
  })

  const { data: cells = [] } = useQuery({
    queryKey: ['rackMap', sel],
    enabled: !!sel,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_rack_map', { p_rack: sel })
      if (error) return []
      return data || []
    },
  })

  const rack = racks.find(r => r.code === sel)
  const cellMap = useMemo(() => {
    const m = {}
    cells.forEach(c => { m[`${c.row_no}-${c.level_no}`] = c })
    return m
  }, [cells])

  // 랙 전체 QR — 스캔하면 그 랙 현황이 열린다
  useEffect(() => {
    if (!sel) { setQr(''); return }
    QRCode.toDataURL(`${window.location.origin}/rack/${sel}`, { width: 240, margin: 0 })
      .then(setQr).catch(() => setQr(''))
  }, [sel])

  function doPrint() {
    document.body.classList.add('printing-sheet')
    const done = () => { document.body.classList.remove('printing-sheet'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  // 구역별로 묶어 배치도를 그린다
  const zones = useMemo(() => {
    const g = {}
    racks.forEach(r => { (g[r.zone] = g[r.zone] || []).push(r) })
    return Object.entries(g)
  }, [racks])

  const total = racks.reduce((a, r) => a + (Number(r.cells_total) || 0), 0)
  const used = racks.reduce((a, r) => a + (Number(r.cells_used) || 0), 0)

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body.printing-sheet > * { display: none !important; }
          body.printing-sheet .sheet-print { display: block !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
        .sheet-print { display: none; }
      `}</style>

      <div className="no-print">
        <h1 className="text-lg font-bold text-slate-900">🗺 창고 배치도</h1>
        <p className="text-xs text-slate-400">
          랙 {racks.length}면 · {n(total)}칸 중 {n(used)}칸 사용 ({total ? Math.round(used / total * 100) : 0}%)
          {' · '}랙을 누르면 구성표를 볼 수 있습니다
        </p>
      </div>

      <div className="no-print flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[['map', '🗺 배치도'], ['sheet', '📋 랙 구성표']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg ${tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* 배치도 */}
      {tab === 'map' && (
        <div className="no-print space-y-4">
          {isLoading && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}
          {zones.map(([zone, list]) => (
            <div key={zone} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold text-slate-500 mb-3">{zone} · {list.length}면</p>
              <div className="flex flex-wrap gap-2">
                {list.map(r => {
                  const t = Number(r.cells_total) || 1
                  const u = Number(r.cells_used) || 0
                  const pct = Math.round(u / t * 100)
                  const bg = pct === 0 ? 'bg-slate-50 border-slate-200'
                    : pct < 40 ? 'bg-emerald-50 border-emerald-200'
                    : pct < 75 ? 'bg-amber-50 border-amber-300'
                    : 'bg-rose-50 border-rose-300'
                  return (
                    <button key={r.code} onClick={() => { setSel(r.code); setTab('sheet') }}
                      title={`${r.code} · ${r.rows_cnt}칸 ${r.levels_cnt}층 · ${u}/${t} 사용${r.memo ? `\n${r.memo}` : ''}`}
                      className={`border-2 rounded-lg px-3 py-2 text-left transition-all hover:shadow-md ${bg}`}
                      style={{ minWidth: '92px' }}>
                      <p className="font-mono text-base font-bold text-slate-800">{r.code}</p>
                      <p className="text-[10px] text-slate-500">{r.rows_cnt}칸 {r.levels_cnt}층</p>
                      <div className="mt-1 h-1 bg-white/70 rounded-full overflow-hidden">
                        <div className={`h-full ${pct < 40 ? 'bg-emerald-400' : pct < 75 ? 'bg-amber-400' : 'bg-rose-400'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{u}/{t} · {pct}%</p>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded bg-slate-100 border border-slate-200 inline-block"/>빈 랙</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200 inline-block"/>여유</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block"/>보통</span>
            <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block"/>포화</span>
          </div>
        </div>
      )}

      {/* 랙 구성표 */}
      {tab === 'sheet' && (
        <>
          <div className="no-print bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">랙</label>
              <select value={sel} onChange={e => setSel(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-56">
                <option value="">선택하세요</option>
                {racks.map(r => (
                  <option key={r.code} value={r.code}>
                    {r.code} · {r.zone} {r.rows_cnt}칸 {r.levels_cnt}층
                  </option>
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

          {rack && (
            <>
              <div className="no-print bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
                <SheetBody rack={rack} cellMap={cellMap} qr={qr} />
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
function SheetBody({ rack, cellMap, qr, print }) {
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
                    height: print ? '20mm' : '64px',
                    verticalAlign: 'top', padding: '1mm',
                    background: c ? '#fef9c3' : '#fff',
                  }}>
                    <div style={{ fontSize: print ? '4mm' : '13px', fontWeight: 800, fontFamily: 'ui-monospace,monospace' }}>
                      {pad(r)}
                    </div>
                    {c && (
                      <div style={{ fontSize: print ? '2.2mm' : '9px', color: '#713f12', lineHeight: 1.25,
                        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: print ? 4 : 3, WebkitBoxOrient: 'vertical' }}>
                        {c.codes}
                      </div>
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
