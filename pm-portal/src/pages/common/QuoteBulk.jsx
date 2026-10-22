import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import VendorPicker from '../../components/VendorPicker'
import ItemPicker from '../../components/ItemPicker'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'
import { parsePaste, matchItems, saveQuotes, bigJump, ltWeeksOf } from '../../lib/quoteBulk'

const n = (v) => (v == null || v === '' ? '' : Math.round(Number(v)).toLocaleString('ko-KR'))
const plus30 = (d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 30); return t.toISOString().slice(0, 10) }

// 📋 여러 품목 — 견적서 표 붙여넣기 (v4.86.0)
//   ① 공통 정보(협력사 · 견적일 · 유효기간 · 견적번호 · 기본 납기) → ② 붙여넣기 → 줄마다 품목 찾기 → 저장
//   지금 매입가보다 3배 이상 오르거나 5분의 1 아래면 「매입가 갱신」을 기본으로 끈다 (견적 이력은 남음)
export default function QuoteBulk() {
  const qc = useQueryClient()
  const [vendorId, setVendorId] = useState('')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [validUntil, setValidUntil] = useState('')
  const [memo, setMemo] = useState('')
  const [defLead, setDefLead] = useState('')
  const [applyLt, setApplyLt] = useState(false)
  const [text, setText] = useState('')
  const [rows, setRows] = useState([])        // [{ line, raw, key, price, lead, moq, cands:[], item, on, upd }]
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  async function analyze(t = text) {
    const parsed = parsePaste(t)
    if (!parsed.length) { setRows([]); return }
    setBusy(true); setDone(null)
    try {
      const { map } = await matchItems(parsed)
      setRows(parsed.map((r) => {
        const cands = map.get(r.key) || []
        const item = cands.length === 1 ? cands[0] : null
        return { ...r, cands, item, on: !!item && r.price > 0, upd: !!item && !bigJump(item.purchase_price, r.price) && Number(item.purchase_price) !== r.price }
      }))
    } catch (e) { toastError('품목 찾기 실패: ' + e.message) } finally { setBusy(false) }
  }

  const setRow = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const pickItem = (i, it) => {
    const r = rows[i]
    setRow(i, { item: it, on: r.price > 0, upd: !bigJump(it.purchase_price, r.price) && Number(it.purchase_price) !== r.price })
  }

  const found = rows.filter((r) => r.item).length
  const multi = rows.filter((r) => !r.item && r.cands.length > 1).length
  const miss = rows.filter((r) => !r.item && r.cands.length === 0).length
  const sel = rows.filter((r) => r.on && r.item && r.price > 0)
  const updN = sel.filter((r) => r.upd).length
  const leadOf = (r) => r.lead || defLead

  async function save() {
    if (!vendorId) { toastError('협력사를 고르세요'); return }
    if (!sel.length) { toastError('저장할 줄이 없습니다 — 품목을 찾은 줄을 체크하세요'); return }
    const ids = sel.map((r) => r.item.id)
    if (new Set(ids).size !== ids.length && !window.confirm('같은 품목이 두 줄 이상 있습니다. 매입가는 아래 줄 값으로 남습니다. 계속할까요?')) return
    setBusy(true)
    try {
      const r = await saveQuotes(sel.map((x) => ({
        item_id: x.item.id, unit_price: x.price, lead_time: leadOf(x) || null, moq: x.moq,
        updatePrice: x.upd, ltWeeks: applyLt ? ltWeeksOf(leadOf(x)) : null,
      })), { vendorId, quoteDate, validUntil, memo })
      setDone(r)
      toastSuccess(`견적 ${r.saved}건 저장 · 매입가 ${r.priced}건 갱신${r.lt ? ` · LT ${r.lt}건` : ''}`)
      if (r.fallback) toast('납기 · MOQ 는 메모에 적었습니다 — DB 설정(품목단가등록_261023.sql) 뒤에는 따로 저장됩니다')
      qc.invalidateQueries({ queryKey: ['items'], exact: false })
      qc.invalidateQueries({ queryKey: ['quoteHistory'], exact: false })
      setRows([]); setText('')
    } catch (e) { toastError('저장 실패: ' + e.message) } finally { setBusy(false) }
  }

  const box = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500'
  return (
    <div className="space-y-3" data-quote-bulk>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold text-slate-700 mb-2.5">① 견적 공통 정보</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div><label className="block text-xs font-bold text-slate-500 mb-1">협력사 <span className="text-rose-500">*</span></label><VendorPicker value={vendorId} onChange={setVendorId} /></div>
          <div><label className="block text-xs font-bold text-slate-500 mb-1">견적일</label><input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className={box} /></div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">유효기간</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={box} />
            <button type="button" onClick={() => setValidUntil(plus30(quoteDate))} className="text-[10px] text-indigo-500 mt-0.5">견적일 + 30일</button>
          </div>
          <div><label className="block text-xs font-bold text-slate-500 mb-1">견적번호 · 메모</label><input data-bulk-memo value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예) 202610220009" className={box} /></div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">기본 납기</label>
            <input data-bulk-deflead value={defLead} onChange={(e) => setDefLead(e.target.value)} placeholder="예) 2~3주" className={box} />
            <p className="text-[10px] text-slate-400 mt-0.5">줄에 납기가 없으면 이 값</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-xs font-bold text-slate-700">② 견적서 표 붙여넣기 <span className="font-normal text-slate-400">— 엑셀에서 「품번 또는 제조사품번 · 단가 · 납기 · MOQ」 순으로 복사 (납기 · MOQ 는 없어도 됨)</span></p>
        <textarea data-bulk-paste value={text} rows={5}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { const t = e.clipboardData?.getData('text') || ''; if (t) { e.preventDefault(); const next = text ? `${text}\n${t}` : t; setText(next); analyze(next) } }}
          placeholder={'QO1155237\t27300\t2~3주\nAX-5001238\t85\t2~3주\t500'}
          className="w-full px-3 py-2 text-xs font-mono border-2 border-dashed border-indigo-200 bg-indigo-50/30 rounded-lg focus:outline-none focus:border-indigo-400" />
        <div className="flex items-center gap-2">
          <button data-bulk-analyze type="button" onClick={() => analyze()} disabled={busy || !text.trim()}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 disabled:opacity-40">{busy ? '찾는 중…' : '🔍 품목 찾기'}</button>
          {!!rows.length && <button type="button" onClick={() => { setRows([]); setText('') }} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500">지우기</button>}
          {done && <span className="text-xs font-semibold text-emerald-600">✅ 견적 {done.saved}건 저장 · 매입가 {done.priced}건 갱신{done.lt ? ` · LT ${done.lt}건` : ''}</span>}
        </div>

        {!!rows.length && (<>
          <div className="grid grid-cols-5 gap-2" data-bulk-kpi>
            {[['붙여넣은 줄', rows.length, 'bg-slate-50 text-slate-800'], ['품목 찾음', found, 'bg-emerald-50 text-emerald-600'], ['여러 개 · 골라야 함', multi, 'bg-amber-50 text-amber-600'], ['못 찾음', miss, 'bg-rose-50 text-rose-600'], ['매입가 바꿀 품목', updN, 'bg-indigo-50 text-indigo-600']].map(([l, v, c]) => (
              <div key={l} className={`rounded-lg px-3 py-2 ${c.split(' ')[0]}`}>
                <p className="text-[11px] text-slate-400">{l}</p>
                <p className={`text-xl font-extrabold ${c.split(' ')[1]}`}>{n(v) || 0}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 border-b-2 border-slate-200 text-slate-500">
                <th className="px-2 py-2 w-8"><input type="checkbox" checked={rows.some((r) => r.item) && rows.filter((r) => r.item).every((r) => r.on)}
                  onChange={(e) => setRows((rs) => rs.map((r) => (r.item && r.price > 0 ? { ...r, on: e.target.checked } : r)))} /></th>
                <th className="px-2 py-2 text-left">붙여넣은 값</th><th className="px-2 py-2 text-left">찾은 품목</th>
                <th className="px-2 py-2 text-right">지금 매입가</th><th className="px-2 py-2 text-right">견적 단가</th><th className="px-2 py-2 text-right">차이</th>
                <th className="px-2 py-2 text-left">납기</th><th className="px-2 py-2 text-right">MOQ</th><th className="px-2 py-2 text-left">매입가 갱신</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const it = r.item
                  const now = Number(it?.purchase_price) || 0
                  const d = it && now > 0 && r.price > 0 ? (r.price - now) / now : null
                  const jump = it && bigJump(now, r.price)
                  const same = it && now === r.price
                  return (
                    <tr key={i} data-bulk-row={r.raw} className={`border-b border-slate-100 ${!it && !r.cands.length ? 'bg-rose-50/60' : jump ? 'bg-rose-50/30' : ''}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" data-bulk-on checked={r.on} disabled={!it || !(r.price > 0)} onChange={(e) => setRow(i, { on: e.target.checked })} /></td>
                      <td className="px-2 py-1.5 font-mono text-slate-600">{r.raw}</td>
                      <td className="px-2 py-1.5">
                        {it ? (<>
                          <span className="font-mono font-bold text-indigo-600">{it.std_code}</span>
                          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${it.how === '품번' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}>{it.how || '직접'}</span>
                          {r.cands.length > 1 && <button type="button" onClick={() => setRow(i, { item: null, on: false, upd: false })} className="ml-1 text-[10px] text-slate-400 underline">다시 고르기</button>}
                          <div className="text-[10px] text-slate-400 truncate max-w-[320px]">{it.name}{it.manufacturer ? ` · ${it.manufacturer}` : ''} {it.manufacturer_code || ''}</div>
                        </>) : r.cands.length > 1 ? (
                          <select data-bulk-pick value="" onChange={(e) => { const c = r.cands.find((x) => x.id === e.target.value); if (c) pickItem(i, c) }}
                            className="px-1.5 py-1 text-[11px] border border-amber-300 rounded bg-amber-50 text-amber-700 font-bold max-w-[320px]">
                            <option value="">여러 개 — 하나를 고르세요 ({r.cands.length})</option>
                            {r.cands.map((c) => <option key={c.id} value={c.id}>{c.std_code} · {c.name} · {n(c.purchase_price)}원</option>)}
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-600">못 찾음</span>
                            <div className="w-56"><ItemPicker value={r.q || ''} onChange={(v) => setRow(i, { q: v })} onSelect={(x) => pickItem(i, { ...x, how: '직접' })} placeholder="🔍 직접 찾기" /></div>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{it ? (now ? n(now) : '미등록') : ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">{r.price > 0 ? n(r.price) : <span className="text-rose-500">단가 없음</span>}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${d == null || d === 0 ? 'text-slate-300' : d > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {d == null || d === 0 ? '—' : `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%`}{jump ? ' ⚠' : ''}
                      </td>
                      <td className="px-2 py-1.5"><input value={r.lead} placeholder={defLead || '—'} onChange={(e) => setRow(i, { lead: e.target.value })} className="w-20 px-1.5 py-0.5 border border-slate-200 rounded text-xs" /></td>
                      <td className="px-2 py-1.5 text-right"><input type="number" value={r.moq ?? ''} onChange={(e) => setRow(i, { moq: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 px-1.5 py-0.5 border border-slate-200 rounded text-xs text-right" /></td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {!it ? '' : same ? <span className="text-[10px] text-slate-400">같음</span> : (
                          <label className="inline-flex items-center gap-1"><input type="checkbox" data-bulk-upd checked={r.upd} onChange={(e) => setRow(i, { upd: e.target.checked })} /> 갱신
                            {jump && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-600">{r.price > now ? '3배↑' : '1/5↓'} 확인</span>}
                          </label>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">· 제조사품번은 띄어쓰기 · 하이픈을 무시하고 맞춥니다 (QO1155237 = QO115-5237). 품번은 AX- 를 빼고 넣어도 됩니다. 같은 제조사품번이 여러 품목이면 하나를 고르세요.<br />· 지금 매입가보다 3배 이상 오르거나 5분의 1 아래로 내려가면 「매입가 갱신」을 기본으로 끕니다 (견적 이력은 남음).</p>
          <div className="flex items-center justify-end gap-3 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" data-bulk-lt checked={applyLt} onChange={(e) => setApplyLt(e.target.checked)} /> 품목 LT(주)도 납기로 반영 <span className="font-normal text-slate-400">(2~3주 → 3주)</span></label>
            <button data-bulk-save type="button" onClick={save} disabled={busy || !sel.length || !vendorId}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {busy ? '저장 중…' : `💾 견적 ${sel.length}건 저장 · 매입가 ${updN}건 갱신`}
            </button>
          </div>
          {!vendorId && <p className="text-right text-[11px] text-rose-500">협력사를 먼저 고르세요</p>}
        </>)}
      </div>
    </div>
  )
}
