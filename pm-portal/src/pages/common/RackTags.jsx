import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'

// 용지 규격. 라벨지는 자르고 코팅하는 과정이 없어 훨씬 편하다.
const PAPERS = {
  label65: { name: '라벨지 65칸 (38.2×21.1mm)', cols: 5, rows: 13, w: 38.2, h: 21.1,
             mx: 5, my: 10.7, gapX: 0, gapY: 0, qr: 18, fs: 3.6, label: true },
  a4x3:    { name: 'A4 일반 3열 (63×40mm)',      cols: 3, rows: 6,  w: 63,   h: 40,
             mx: 8, my: 8,    gapX: 2, gapY: 2, qr: 30, fs: 6,   label: false },
}

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const pad = (v) => String(v).padStart(2, '0')

// 위치 태그를 A4 로 인쇄한다. 칸마다 QR + 위치코드를 붙여두면
// 실사할 때 폰으로 스캔해 바로 수량을 입력할 수 있다.
//
//   태그 크기: 세로 40mm · 2열 (A4 장당 12개)
//   QR 내용: 실사 화면 주소 (https://…/cell/A1-05-1)
export default function RackTags() {
  // 용지 규격 — 라벨지를 쓰면 자르고 코팅하는 과정이 없어진다
  const [paper, setPaper] = useState('label65')
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
        // 높은 층부터 한 줄씩. 현장에서 한 층을 쭉 붙이고 아래로 내려가는 것이
        // 칸마다 층을 오르내리는 것보다 훨씬 빠르다.
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

  const spec = PAPERS[paper]
  const perPage = spec.cols * spec.rows

  // 용지 단위로 쪼갠다
  const pages = useMemo(() => {
    const out = []
    for (let i = 0; i < cells.length; i += perPage) out.push(cells.slice(i, i + perPage))
    return out
  }, [cells, perPage])

  // QR 생성 — 스캔하면 그 칸의 실사 화면이 열린다
  async function buildQr() {
    if (!cells.length) return
    setBusy(true); setProgress({ done: 0, total: cells.length })
    try {
      const m = {}
      for (let i = 0; i < cells.length; i++) {
        // 위치 코드만 넣는다. URL 을 넣으면 QR 이 29모듈로 촘촘해져
        // 작은 라벨(18mm)에서 인식이 어렵다. 코드만이면 21모듈로 넉넉하다.
        m[cells[i].loc] = await QRCode.toDataURL(cells[i].loc, {
          width: 200, margin: 0, errorCorrectionLevel: 'M',
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

  // 라벨 프로그램(아이라벨2 등)에서 불러 쓸 엑셀.
  // QR 은 그 프로그램이 위치코드로 직접 만들므로 여기서 생성할 필요가 없다.
  // 그래서 1,528칸도 즉시 나온다.
  async function exportExcel() {
    if (!cells.length) { toastError('내보낼 위치가 없습니다'); return }
    setBusy(true)
    try {
      // 라벨에 쓸 것만 담는다. QR·문자 모두 위치코드 하나로 연결하면 되고,
      // 랙·칸·층은 정렬이나 부분 출력에 쓸 수 있게 남긴다.
      const rows = cells.map(c => ({
        '위치코드': c.loc,
        '랙': c.rack,
        '칸': c.row,
        '층': c.lv,
      }))

      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 14 }, { wch: 7 }, { wch: 5 }, { wch: 5 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '위치태그')
      const name = allMode ? '전체' : (rack?.code || '')
      XLSX.writeFile(wb, `위치태그_${name}_${cells.length}건_${new Date().toISOString().split('T')[0]}.xlsx`)
      toastSuccess(`${cells.length.toLocaleString()}건 내보냄 — 라벨 프로그램에서 불러 쓰세요`)
    } catch (e) {
      toastError('내보내기 실패: ' + (e?.message || e))
    } finally { setBusy(false) }
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
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">용지</label>
          <select value={paper} onChange={e => { setPaper(e.target.value); setQrMap({}) }}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg w-72">
            {Object.entries(PAPERS).map(([k, v]) => (
              <option key={k} value={k}>{v.name} · 장당 {v.cols * v.rows}개</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">
            {spec.label
              ? '라벨지는 떼어 붙이면 되어 자르고 코팅할 필요가 없습니다. 인쇄 시 \'실제 크기\'·여백 없음으로 설정하세요.'
              : '일반 용지는 잘라서 코팅한 뒤 붙입니다.'}
          </p>
        </div>

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
            전체 {cells.length.toLocaleString()}칸 · <b>{pages.length}장</b>.
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
              <button onClick={exportExcel} disabled={busy}
                title="아이라벨2 등 라벨 프로그램에서 불러 쓸 엑셀. QR 은 그 프로그램이 위치코드로 직접 만듭니다"
                className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                📊 엑셀 내보내기 ({cells.length.toLocaleString()})
              </button>
              <button onClick={buildQr} disabled={busy}
                className="px-4 py-2 text-sm font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">
                {busy ? 'QR 생성 중…' : `🔳 전체 QR 만들기 (${cells.length.toLocaleString()})`}
              </button>
              <button onClick={doPrint} disabled={!ready}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                🖨 인쇄 ({pages.length}장)
              </button>
            </>
          )}
          {!allMode && rack && (
            <>
              <button onClick={exportExcel} disabled={busy || !cells.length}
                title="라벨 프로그램(아이라벨2 등)에서 불러 쓸 엑셀"
                className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                📊 엑셀 ({cells.length})
              </button>
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
                🖨 인쇄 ({pages.length}장)
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
          <p className="text-xs font-bold text-slate-500 mb-3">
            미리보기 — 실제 크기 {spec.w}×{spec.h}mm (화면에서는 확대)
          </p>
          <div className="flex flex-wrap gap-2">
            {cells.slice(0, 3).map(c => (
              <TagCard key={c.loc} loc={c.loc} qr={qrMap[c.loc]} spec={spec} preview />
            ))}
          </div>
        </div>
      )}

      {/* 인쇄 영역 — 용지 규격대로 배치 */}
      <div className="tag-print">
        <style>{`
          @page { size: A4; margin: 0; }
          .tag-sheet {
            width: 210mm; height: 297mm;
            padding: ${spec.my}mm ${spec.mx}mm;
            box-sizing: border-box;
            display: grid;
            grid-template-columns: repeat(${spec.cols}, ${spec.w}mm);
            grid-auto-rows: ${spec.h}mm;
            column-gap: ${spec.gapX}mm;
            row-gap: ${spec.gapY}mm;
            page-break-after: always;
          }
        `}</style>
        {pages.map((pg, i) => (
          <div className="tag-sheet" key={i}>
            {pg.map(c => <TagCard key={c.loc} loc={c.loc} qr={qrMap[c.loc]} spec={spec} />)}
          </div>
        ))}
      </div>
    </div>
  )
}

// 태그 하나 — QR + 위치 코드만 한 줄로
function TagCard({ loc, qr, spec, preview }) {
  const sc = preview ? 2.4 : 1   // 미리보기는 크게
  return (
    <div className="tag" style={{
      width: `${spec.w * sc}mm`,
      height: `${spec.h * sc}mm`,
      border: spec.label ? 'none' : '0.3mm solid #1e293b',
      borderRadius: spec.label ? 0 : '1.2mm',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: `${1.5 * sc}mm`,
      boxSizing: 'border-box', background: '#fff', overflow: 'hidden',
    }}>
      {qr && <img src={qr} alt={loc}
        style={{ width: `${spec.qr * sc}mm`, height: `${spec.qr * sc}mm`, flexShrink: 0 }} />}
      <span style={{
        fontSize: `${spec.fs * sc}mm`, fontWeight: 800, lineHeight: 1,
        fontFamily: 'ui-monospace,Menlo,monospace', letterSpacing: '-0.1mm', whiteSpace: 'nowrap',
      }}>
        {loc}
      </span>
    </div>
  )
}
