// 📋 부품표로 ASSY (v4.148.0) — 코드 부여 전 · BOM 등록 전 어셈블리를 부품표 붙여넣기로 견적
//   붙이면 바로 포털 품목을 찾아(제조사품번 · 기준코드) 실적가를 채운다 → 「견적에 추가」 = ASSY 한 줄 (부품표 · 구간마진 · 작업비 · 세부견적 그대로)
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { prefixOf } from '../../lib/custPrefix'
import { parsePartsPaste, matchPartsPaste } from '../../lib/quotePartsPaste'
import { toastError } from '../../lib/toast'
import Spin from '../../components/ux/Spin'

const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')

export default function QuotePartsModal({ customerId, onClose, onAdd }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const [labor, setLabor] = useState('')
  const [text, setText] = useState('')
  const [res, setRes] = useState(null)       // { rows: matched, header }
  const [busy, setBusy] = useState(false)
  const [nameErr, setNameErr] = useState(false)

  async function check(t = text) {
    const p = parsePartsPaste(t)
    if (!p.rows.length) { setRes({ rows: [], header: p.header }); return }
    setBusy(true)
    try {
      let prefix = ''
      if (customerId) { const { data } = await supabase.from('customers').select('code').eq('id', customerId).maybeSingle(); prefix = prefixOf(data?.code) }
      setRes({ rows: await matchPartsPaste(p.rows, prefix), header: p.header })
    } catch (e) { toastError('품목 찾기 실패: ' + e.message) } finally { setBusy(false) }
  }
  const rows = res?.rows || []
  const n = { found: rows.filter((r) => r.item).length, real: rows.filter((r) => r.priceSrc === '실적가').length, pasted: rows.filter((r) => r.priceSrc === '붙인 단가').length, none: rows.filter((r) => r.buyKrw == null).length }
  const mat = rows.reduce((a, r) => a + (r.buyKrw == null ? 0 : r.buyKrw * (Number(r.qty) || 0)), 0)

  function add() {
    if (!name.trim()) { setNameErr(true); return }
    onAdd({ code: code.trim(), name: name.trim(), qty: Number(qty) || 1, labor: Number(String(labor).replace(/[^0-9.]/g, '')) || 0, matched: rows })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 no-print" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()} data-qp-modal>
        <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">📋 부품표로 ASSY 견적</h3>
            <p className="text-[11px] text-slate-400">코드 부여 전 · BOM 등록 전 어셈블리 — 고객사 부품표를 붙이면 제조사품번으로 포털 품목을 찾아 실적가를 채웁니다. BOM · 품목은 등록하지 않고 이 견적 안에서만 씁니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-[1fr_2fr_90px_130px] gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700" htmlFor="qp-code">품번 (임시 · 선택)</label>
              <input id="qp-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: 고객사 도면번호" data-qp-code
                className="mt-1 w-full px-2.5 py-1.5 text-sm font-mono border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700" htmlFor="qp-name">품명 <span className="text-rose-500">*</span></label>
              <input id="qp-name" value={name} onChange={(e) => { setName(e.target.value); if (e.target.value) setNameErr(false) }} placeholder="예: GAS BOX ASSY (신규)" data-qp-name
                className={`mt-1 w-full px-2.5 py-1.5 text-sm border rounded-lg ${nameErr ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200'}`} />
              {nameErr && <p className="mt-0.5 text-[11px] font-bold text-rose-600">품명을 적어 주세요</p>}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700" htmlFor="qp-qty">수량</label>
              <input id="qp-qty" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700" htmlFor="qp-labor">작업비(원)</label>
              <input id="qp-labor" inputMode="numeric" value={labor} onChange={(e) => setLabor(e.target.value)} placeholder="나중에 적어도 됨" data-qp-labor
                className="mt-1 w-full px-2.5 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700" htmlFor="qp-text">부품표 붙여넣기</label>
            <textarea id="qp-text" value={text} data-qp-text
              onChange={(e) => { setText(e.target.value); setRes(null) }}
              onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); setText(t); check(t) } }}
              placeholder={'제조사\t제조사품번\t품명\t수량\t단가(선택)\nOMRON\tG2R-2-SND DC24\tRELAY\t2\nMOLEX\t19099-0010\tTERMINAL\t20\t55'}
              className="mt-1 w-full h-28 px-3 py-2 text-[11px] font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400" />
            <p className="text-[11px] text-slate-400 mt-0.5">엑셀에서 머리글째 복사하면 칸을 알아서 잡습니다 (제조사 · 제조사품번 · 품명 · 수량 · 단가 · 기준코드 · 단위). 머리글이 없으면 「제조사 · 제조사품번 · 품명 · 수량 · 단가」 순서로 봅니다. 단가를 붙이면 그 값, 없으면 포털 실적가.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => check()} disabled={!text.trim() || busy} data-qp-check className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white disabled:opacity-40">{busy ? <span className="inline-flex items-center gap-1.5"><Spin />찾는 중…</span> : '🔍 포털 품목 찾기'}</button>
            {res && rows.length > 0 && <span className="text-[11px] text-slate-500" data-qp-sum>
              부품 {rows.length} · 포털 품목 {n.found} · 실적가 {n.real} · 붙인 단가 {n.pasted}{n.none ? <b className="text-amber-600"> · 단가 없음 {n.none}</b> : ''} — 자재비 <b className="text-slate-700">₩{won(mat)}</b> (1대)
            </span>}
          </div>
          {rows.length > 0 && (
            <div className="overflow-x-auto border border-slate-100 rounded-lg max-h-[42vh]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>
                  <th className="px-2 py-1.5 text-left">제조사</th><th className="px-2 py-1.5 text-left">제조사품번</th><th className="px-2 py-1.5 text-left">품명</th>
                  <th className="px-2 py-1.5 text-right">수량</th><th className="px-2 py-1.5 text-left">포털 품목</th><th className="px-2 py-1.5 text-right">단가(원)</th><th className="px-2 py-1.5 text-left">단가 출처</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 ${r.buyKrw == null ? 'bg-amber-50/50' : ''}`} data-qp-row={r.priceSrc || 'none'}>
                      <td className="px-2 py-1.5">{r.maker || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">{r.mpn || '—'}</td>
                      <td className="px-2 py-1.5 max-w-[240px] truncate" title={r.name}>{r.name || r.item?.name || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{r.qty}</td>
                      <td className="px-2 py-1.5 font-mono text-indigo-600">{r.item ? r.item.std_code : <span className="text-slate-300 font-sans">없음</span>}{r.how === 'code' && <span className="ml-1 text-[10px] text-slate-400 font-sans">기준코드</span>}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{r.buyKrw == null ? '—' : won(r.buyKrw)}</td>
                      <td className="px-2 py-1.5">{r.priceSrc ? <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${r.priceSrc === '실적가' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>{r.priceSrc}</span> : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">단가 없음</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res && !rows.length && <p className="text-xs text-rose-600">부품 줄을 못 읽었습니다 — 제조사품번이나 품명이 있는 칸을 머리글째 붙여 주세요.</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11px] text-slate-400">단가 없는 부품은 견적 화면 「▼ 부품」에서 매입가를 적으면 견적 단가가 다시 계산됩니다</span>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
          <button onClick={add} disabled={!rows.length || busy} data-qp-add className="px-4 py-2 text-sm font-bold rounded-lg bg-violet-600 text-white disabled:opacity-40">견적에 ASSY 로 추가</button>
        </div>
      </div>
    </div>
  )
}
