import { useState } from 'react'
import { unitFromSample, qtyFromWeight, countBand, fmtW, MIN_SAMPLE_G } from '../lib/unitWeight'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// ⚖ 무게로 세기 (v4.80.0) — 칸 실사 품목 카드 안에 펼쳐진다 (휴대폰 · 큰 입력칸)
//   ① 개당 무게: 저장된 값이 있으면 그대로 · 없거나 「다시 재기」면 샘플 n개 무게로 구한다 (저장하면 다음부터 생략)
//   ② 전체 무게(− 통 · 봉투 무게) ÷ 개당 무게 = 개수 → 「실사 수량에 넣기」
//   props: unit(저장된 개당 g | null) · canEdit · onUse(qty) · onSaveUnit(g) → Promise · onClose
export default function WeightCount({ unit: unitProp, canEdit, onUse, onSaveUnit, onClose }) {
  const [savedU, setSavedU] = useState(null)       // 방금 저장한 값 (목록이 다시 읽히기 전에도 쓰게)
  const unit = savedU ?? unitProp
  const [measure, setMeasure] = useState(!unitProp)   // 샘플로 재는 중
  const [sn, setSn] = useState('')
  const [sw, setSw] = useState('')
  const [tw, setTw] = useState('')
  const [tare, setTare] = useState('')
  const [busy, setBusy] = useState(false)

  const sampleU = measure ? unitFromSample(sn, sw) : null
  const u = measure ? sampleU : unit
  const qty = u ? qtyFromWeight(tw, tare, u) : null
  const band = qty != null ? countBand(u, qty, measure ? Number(sw) : null) : 0
  const light = measure && Number(sw) > 0 && Number(sw) < MIN_SAMPLE_G
  const tareOver = Number(tare) > 0 && Number(tw) > 0 && Number(tare) > Number(tw)

  async function saveUnit() {
    if (!sampleU) return
    setBusy(true)
    try { await onSaveUnit(sampleU); setSavedU(sampleU); setMeasure(false) } catch { /* 안내는 부모가 띄운다 — 잰 값은 그대로 두고 계속 쓴다 */ } finally { setBusy(false) }
  }

  const box = 'w-full px-3 py-2.5 text-lg font-bold text-right border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500'
  return (
    <div data-weight-panel className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-3">
      <div className="flex items-center">
        <p className="text-xs font-bold text-indigo-700">⚖ 무게로 세기 <span className="font-normal text-slate-400">· 저울 1g 눈금</span></p>
        <button type="button" onClick={onClose} className="ml-auto text-slate-400 text-lg leading-none px-1">✕</button>
      </div>

      {/* ① 개당 무게 */}
      {!measure ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-slate-700">개당 <b data-weight-unit className="font-mono">{fmtW(unit)} g</b></p>
          <button type="button" data-weight-remeasure onClick={() => { setMeasure(true); setSn(''); setSw('') }}
            className="ml-auto text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-500">다시 재기</button>
        </div>
      ) : (
        <div>
          <p className="text-[11px] font-bold text-slate-500 mb-1">① 개당 무게 — 샘플을 세어 올려 놓고 무게를 넣으세요</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-[10px] text-slate-400 mb-0.5">샘플 개수</p>
              <input data-weight-sn type="number" inputMode="numeric" value={sn} onChange={(e) => setSn(e.target.value)} placeholder="예) 50" className={box} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-slate-400 mb-0.5">샘플 무게 (g)</p>
              <input data-weight-sw type="number" inputMode="decimal" value={sw} onChange={(e) => setSw(e.target.value)} placeholder="예) 25" className={box} />
            </div>
          </div>
          {sampleU != null && (
            <div className="flex items-center gap-2 mt-1.5">
              <p className="text-sm text-slate-700">개당 <b className="font-mono">{fmtW(sampleU)} g</b></p>
              {canEdit && (
                <button type="button" data-weight-save onClick={saveUnit} disabled={busy}
                  title="품목에 저장해 두면 다음 실사부터 샘플을 다시 안 재도 됩니다"
                  className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                  {busy ? '저장 중…' : '개당 무게 저장'}
                </button>
              )}
            </div>
          )}
          {light && <p data-weight-light className="text-[11px] text-amber-700 mt-1">샘플이 가벼우면 오차가 큽니다 — {MIN_SAMPLE_G}g 이상 되게 더 올리세요.</p>}
          {unit && <button type="button" onClick={() => setMeasure(false)} className="text-[11px] text-slate-400 mt-1">저장된 {fmtW(unit)} g 쓰기</button>}
        </div>
      )}

      {/* ② 전체 무게 */}
      <div>
        <p className="text-[11px] font-bold text-slate-500 mb-1">{measure ? '② ' : ''}이 칸 전체 무게</p>
        <div className="flex gap-2">
          <div className="flex-[2]">
            <p className="text-[10px] text-slate-400 mb-0.5">전체 무게 (g)</p>
            <input data-weight-tw type="number" inputMode="decimal" value={tw} onChange={(e) => setTw(e.target.value)} placeholder="저울 숫자" className={box} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-slate-400 mb-0.5">통 · 봉투 (g)</p>
            <input data-weight-tare type="number" inputMode="decimal" value={tare} onChange={(e) => setTare(e.target.value)} placeholder="0" className={box} />
          </div>
        </div>
        {tareOver && <p className="text-[11px] text-rose-600 mt-1">통 무게가 전체 무게보다 큽니다.</p>}
      </div>

      <div className="flex items-center gap-2">
        <p data-weight-qty className="text-sm text-slate-700">
          {qty != null ? <>≈ <b className="text-lg">{n(qty)}</b>개{band > 0 && <span className="text-[11px] text-slate-400"> (±{n(band)})</span>}</> : <span className="text-slate-400 text-xs">{u ? '전체 무게를 넣으면 개수가 나옵니다' : '개당 무게부터 구하세요'}</span>}
        </p>
        <button type="button" data-weight-use onClick={() => onUse(qty)} disabled={qty == null}
          className="ml-auto px-3 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-40">실사 수량에 넣기</button>
      </div>
      {band >= 3 && <p className="text-[11px] text-slate-400">오차가 커 보이면 장부와 차이 나는 만큼만 손으로 확인하세요.</p>}
    </div>
  )
}
