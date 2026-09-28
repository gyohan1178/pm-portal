import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'

const MONO = "ui-monospace, Menlo, Consolas, monospace"
const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// 입고 → 로트 — 로트 관리 대상 품목을 입고하면 바로 시리얼·제조년월을 받는다.
//   예전엔 입고한 뒤 로트관리 화면에 가서 손으로 다시 넣어야 했다.
//   등록은 로트관리 화면과 같은 함수(pm_lot_add)를 쓴다 — 규칙이 둘로 갈리지 않게.
//
//   rows: [{ item_id, std_code, name, maker, maker_code, vendor, qty, po_id }]  (입고한 로트 대상 품목)
//   date: 입고일
export default function LotInboundModal({ rows, date, onClose, onDone }) {
  // 품목마다 로트 줄 — 한 번 입고에 로트가 여럿 섞여 오면 줄을 늘린다
  const [lines, setLines] = useState(() => Object.fromEntries(
    rows.map(r => [r.key, [{ serial: '', made: '', qty: String(r.qty) }]])))
  const [busy, setBusy] = useState(false)

  const set = (key, i, field, val) => setLines(L => ({
    ...L, [key]: L[key].map((x, j) => j === i ? { ...x, [field]: val } : x) }))
  const add = (key) => setLines(L => ({ ...L, [key]: [...L[key], { serial: '', made: '', qty: '' }] }))
  const del = (key, i) => setLines(L => ({ ...L, [key]: L[key].filter((_, j) => j !== i) }))

  // 시리얼에서 제조 시기를 자동으로 뽑는다 (로트관리 화면과 같은 방식)
  async function autoMade(r, i, raw) {
    const cur = lines[r.key]?.[i]
    if (!raw?.trim() || cur?.made) return
    try {
      const { data } = await supabase.rpc('pm_parse_made', { p_maker: r.maker || '', p_raw: raw.trim() })
      const x = Array.isArray(data) ? data[0] : data
      if (x?.made_ym) set(r.key, i, 'made', x.made_ym)
    } catch { /* 자동 변환 실패는 넘어간다 — 손으로 넣으면 된다 */ }
  }

  const sumOf = (key) => (lines[key] || []).reduce((a, x) => a + (Number(x.qty) || 0), 0)
  const filled = rows.flatMap(r => (lines[r.key] || [])
    .filter(x => x.serial.trim() && Number(x.qty) > 0)
    .map(x => ({ r, x })))

  async function save() {
    const bad = rows.flatMap(r => (lines[r.key] || []).filter(x => x.serial.trim() && !(Number(x.qty) > 0)))
    if (bad.length) { toastError('시리얼을 넣은 줄에 수량이 없습니다'); return }
    if (!filled.length) { toastError('시리얼을 한 줄 이상 넣으세요 — 지금 안 넣으려면 「나중에」'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_lot_add', {
        p_rows: filled.map(({ r, x }) => ({
          item_id: r.item_id,
          serial_no: x.serial.trim(),
          made_ym: x.made.trim() || null,
          qty_in: Number(x.qty),
          in_date: date || null,
          vendor_name: r.vendor || null,
        })),
      })
      if (error) throw error
      toastSuccess(`로트 ${n(data ?? filled.length)}건 등록`)
      onDone?.()
      onClose?.()
    } catch (e) { toastError('로트 등록 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl rounded-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">🏷 로트 입력 — 방금 입고한 로트 관리 품목 {rows.length}개</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            라벨의 시리얼(로트번호)을 넣으면 제조년월은 자동으로 찾습니다. 한 번에 로트가 여럿 왔으면 「+ 로트」로 나눠 넣으세요.
          </p>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {rows.map(r => {
            const sum = sumOf(r.key), diff = sum !== Number(r.qty)
            return (
              <div key={r.key} className="rounded-xl border border-slate-200">
                <div className="flex items-baseline justify-between gap-2 px-3 py-2 bg-slate-50 rounded-t-xl">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-indigo-700" style={{ fontFamily: MONO }}>{r.maker_code || r.std_code}</span>
                    <span className="ml-2 text-xs text-slate-500 truncate">{r.name}</span>
                  </div>
                  <span className={`text-xs whitespace-nowrap ${diff ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
                    입고 {n(r.qty)} · 로트 합계 {n(sum)}{diff ? ' (다름)' : ''}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {(lines[r.key] || []).map((x, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={x.serial} placeholder="시리얼 / 로트번호"
                        onChange={e => set(r.key, i, 'serial', e.target.value)}
                        onBlur={e => autoMade(r, i, e.target.value)}
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg" style={{ fontFamily: MONO }} />
                      <input value={x.made} placeholder="제조년월 2026-08"
                        onChange={e => set(r.key, i, 'made', e.target.value)}
                        className="w-32 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg" />
                      <input type="number" min="0" value={x.qty} placeholder="수량"
                        onChange={e => set(r.key, i, 'qty', e.target.value)}
                        className="w-20 px-2.5 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                      {(lines[r.key] || []).length > 1
                        ? <button onClick={() => del(r.key, i)} className="text-slate-300 hover:text-red-500 px-1">✕</button>
                        : <span className="w-5" />}
                    </div>
                  ))}
                  <button onClick={() => add(r.key)} className="text-xs font-semibold text-indigo-600 hover:underline">+ 로트</button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            나중에 (로트관리에서)
          </button>
          <button onClick={save} disabled={busy || !filled.length}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '등록 중…' : `로트 ${filled.length}건 등록`}
          </button>
        </div>
      </div>
    </div>
  )
}
