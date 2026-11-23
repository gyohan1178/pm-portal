import { useState } from 'react'
import { createPortal } from 'react-dom'
import { todayISO } from '../lib/utils'

// 📄 로트 추적 보고서 (v4.228.0) — 로트 관리 화면에서 고른 제조사 · 품목의 로트 이력을 A4 로.
//   고객사에 보여 주는 용도라 구매처 · 재고 차이 · 실사 같은 내부 정보는 넣지 않는다.
//   인쇄 규칙은 body.printing-lot 일 때만 먹게 좁혀 둔다 (전역 body>* 규칙 금지 — 다른 화면이 깨진다).

// 사용처 — 출고 메모를 사람이 읽기 좋게 (호기 칸은 아직 비어 있는 경우가 많아 메모가 사실상 사용처)
export function lotWhere(u) {
  if (u?.hogi) return `${u.pn ? `${u.pn} ` : ''}#${u.hogi}`
  let m = String(u?.memo || '').replace(/\s*·\s*로트 등록 후 차감/, '').trim()
  if (/^실사 조정/.test(m)) return '실사 조정'
  if (!m || m === '출고작업') return 'ASSY 출고'
  return m
}

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

function whereSummary(us) {
  const real = us.filter((u) => lotWhere(u) !== '실사 조정')
  const names = [...new Set(real.map(lotWhere))]
  if (!names.length) return '—'
  return names.length <= 2 ? names.join(' / ') : `${names.slice(0, 2).join(' / ')} 외 ${names.length - 2}`
}

export default function LotReport({ items, byItem, usesByLot, scope, onClose }) {
  const [detail, setDetail] = useState(false)    // 로트마다 사용 내역까지
  const [withDone, setWithDone] = useState(true) // 소진 로트 포함
  const today = todayISO()

  const lotsOf = (it) => (byItem[it.item_id] || []).filter((l) => withDone || Number(l.qty_left) > 0)
  const all = items.flatMap(lotsOf)
  const live = all.filter((l) => Number(l.qty_left) > 0)
  const expiredLive = live.filter((l) => l.expired).length
  // 보증 만료 뒤에 쓴 일 — 고객사가 가장 먼저 묻는 것
  const lateUse = all.reduce((a, l) => a + (usesByLot[l.id] || []).filter((u) => l.expire_date && u.used_date && u.used_date > l.expire_date && lotWhere(u) !== '실사 조정').length, 0)

  function print() {
    document.body.classList.add('printing-lot')
    const finish = () => { document.body.classList.remove('printing-lot'); window.removeEventListener('afterprint', finish) }
    window.addEventListener('afterprint', finish)
    setTimeout(() => window.print(), 60)
  }

  return createPortal(
    <div className="lot-print-area fixed inset-0 z-50 bg-slate-800/50 overflow-y-auto" data-lot-report>
      <style>{`
        @media print {
          body.printing-lot > *:not(.lot-print-area) { display: none !important; }
          body.printing-lot .lot-print-area { position: static !important; background: #fff !important; overflow: visible !important; }
          body.printing-lot .lot-no-print { display: none !important; }
          body.printing-lot .lot-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; padding: 0 !important; }
          body.printing-lot .lot-item { break-inside: avoid; }
          @page { size: A4 portrait; margin: 12mm; }
        }
      `}</style>
      <div className="lot-no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
        <b className="text-sm text-slate-800">📄 고객사 보고서</b>
        <span className="text-slate-400">{scope} · 품목 {items.length} · 로트 {all.length}</span>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.target.checked)} className="accent-violet-600" />소진 로트 포함</label>
        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer"><input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} className="accent-violet-600" />사용 내역까지</label>
        <span className="text-slate-400">구매처 · 재고 차이 같은 내부 정보는 빠집니다</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={print} data-lot-report-print className="px-3.5 py-1.5 rounded-lg font-bold bg-[#6c5ce7] text-white">🖨 인쇄 · PDF</button>
          <button type="button" onClick={onClose} data-lot-report-close className="px-3 py-1.5 rounded-lg font-bold border border-slate-200 text-slate-600">닫기 ✕</button>
        </div>
      </div>

      <div className="lot-sheet bg-white mx-auto my-6 shadow-lg text-[11px] text-slate-800" style={{ width: 794, padding: '40px 44px' }}>
        <div className="flex items-end justify-between border-b-2 border-slate-800 pb-2">
          <div>
            <div className="text-lg font-extrabold">로트 추적 현황 <span className="text-slate-400 font-bold text-sm">Lot Traceability Report</span></div>
            <div className="text-slate-500 mt-0.5">{scope} · {today} 기준</div>
          </div>
          <div className="text-right font-extrabold text-slate-700 tracking-wide">JINSUN TECH</div>
        </div>

        <div className="grid grid-cols-4 gap-2 my-3 text-center">
          {[['관리 품목', items.length, ''], ['사용 중 로트', live.length, ''], ['기한 지난 재고 로트', expiredLive, expiredLive ? 'text-rose-600' : 'text-emerald-600'], ['보증 만료 후 사용', `${lateUse}건`, lateUse ? 'text-rose-600' : 'text-emerald-600']].map(([t, v, c]) => (
            <div key={t} className="border border-slate-300 rounded p-2"><div className="text-slate-500">{t}</div><b className={`text-base ${c}`}>{typeof v === 'number' ? n(v) : v}</b></div>
          ))}
        </div>

        {items.map((it) => {
          const ls = lotsOf(it)
          if (!ls.length) return null
          return (
            <div key={it.item_id} className="lot-item mt-3">
              <div className="font-bold mb-1">
                <span style={{ fontFamily: MONO }}>{it.maker_code || it.std_code}</span> · {it.item_name}
                <span className="text-slate-500 font-semibold"> · {it.maker || '기타'}{it.shelf_months ? ` · 보증 ${it.shelf_months}개월 (입고일 기준)` : ''}</span>
              </div>
              <table className="w-full border-collapse text-[11px] [&_td]:text-[11px] [&_th]:text-[11px] [&_th]:whitespace-nowrap [&_td]:leading-snug">
                <thead className="bg-slate-100">
                  <tr>{['Serial / Lot', '제조', '입고일', '입고', '사용', '잔량', '보증 만료', '사용처', '상태'].map((h) => <th key={h} className="border border-slate-300 px-1.5 py-1 font-bold text-left">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {ls.map((l) => {
                    const us = usesByLot[l.id] || []
                    const done = Number(l.qty_left) <= 0
                    const last = us.map((u) => u.used_date).filter(Boolean).sort().pop()
                    return [
                      <tr key={l.id}>
                        <td className="border border-slate-300 px-1.5 py-1 font-bold" style={{ fontFamily: MONO }}>{l.serial_no}</td>
                        <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap">{l.made_ym || '—'}</td>
                        <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap">{l.in_date || '—'}</td>
                        <td className="border border-slate-300 px-1.5 py-1 text-right">{n(l.qty_in)}</td>
                        <td className="border border-slate-300 px-1.5 py-1 text-right">{n((Number(l.qty_in) || 0) - (Number(l.qty_left) || 0))}</td>
                        <td className="border border-slate-300 px-1.5 py-1 text-right">{n(l.qty_left)}</td>
                        <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap">{l.expire_date || '—'}</td>
                        <td className="border border-slate-300 px-1.5 py-1">{whereSummary(us)}</td>
                        <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap">{done ? `소진${last ? ` (${String(last).slice(5)})` : ''}` : l.expired ? '기한 초과' : '사용 중'}</td>
                      </tr>,
                      detail && us.some((u) => lotWhere(u) !== '실사 조정') && (
                        <tr key={`${l.id}-u`}>
                          <td colSpan={9} className="border border-slate-300 px-3 py-1 bg-slate-50">
                            {us.filter((u) => lotWhere(u) !== '실사 조정').sort((a, b) => String(a.used_date).localeCompare(String(b.used_date))).map((u) => (
                              <div key={u.use_id} className="flex gap-3"><span className="w-20 text-slate-500">{u.used_date}</span><b className="w-8 text-right">{n(u.qty)}</b><span>{lotWhere(u)}</span></div>
                            ))}
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
        <div className="text-slate-500 mt-3 border-t border-slate-200 pt-2">
          ※ 보증기간은 입고일부터 셉니다 · 오래된 로트부터 출고합니다(선입선출) · 사용처는 출고 기록 기준
        </div>
      </div>
    </div>,
    document.body,
  )
}
