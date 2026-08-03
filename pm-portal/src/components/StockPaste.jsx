import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { logActivity } from '../lib/activityLog'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// 재고 실사 붙여넣기.
//
//   엑셀에서 품번과 수량 두 열만 복사해 붙이면 된다.
//   양식을 갖출 필요 없이, 실사한 것만 적어 오면 되게 했다.
//
//   넣은 값은 바로 반영하지 않고 장부와의 차이를 먼저 보여준다.
//   잘못 센 수량이 곧바로 재고를 바꾸면 되돌리기 어렵기 때문이다.
export default function StockPaste({ onClose }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)     // 대조 결과
  const [busy, setBusy] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(true)

  // 붙여넣은 내용을 품번·수량으로 나눈다.
  // 탭·쉼표·여러 칸 띄어쓰기를 모두 구분자로 본다.
  function parse(raw) {
    const out = []
    raw.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim()
      if (!t) return
      // 숫자 안의 천단위 쉼표(1,500)를 먼저 없앤 뒤 나눈다.
      // 그러지 않으면 1,500 이 1 과 500 으로 잘린다.
      const t2 = t.replace(/(\d),(?=\d{3}\b)/g, '$1')
      const cells = t2.split(/\t|,|\s{2,}| +/).map(x => x.trim()).filter(Boolean)
      if (cells.length < 2) { out.push({ line: i + 1, raw: t, err: '수량 없음' }); return }

      // 마지막 숫자를 수량으로, 그 앞을 품번으로 본다
      const qtyRaw = cells[cells.length - 1].replace(/,/g, '')
      const qty = Number(qtyRaw)
      if (!isFinite(qty)) { out.push({ line: i + 1, raw: t, err: `수량 아님: ${qtyRaw}` }); return }

      const code = cells[0].toUpperCase()
      if (!code) { out.push({ line: i + 1, raw: t, err: '품번 없음' }); return }
      out.push({ line: i + 1, code, qty })
    })
    return out
  }

  // 장부와 대조
  async function check() {
    const parsed = parse(text)
    if (!parsed.length) { toastError('내용이 없습니다'); return }
    setBusy(true)
    try {
      const codes = [...new Set(parsed.filter(p => !p.err).map(p => p.code))]
      // AX- 접두가 없어도 찾도록 양쪽을 조회한다
      const want = [...new Set(codes.flatMap(c =>
        c.startsWith('AX-') ? [c] : [`AX-${c}`, c]))]

      const found = {}
      for (let i = 0; i < want.length; i += 300) {
        const { data } = await supabase.from('items')
          .select('id,std_code,name,unit, inventory(qty,location)')
          .in('std_code', want.slice(i, i + 300))
        ;(data || []).forEach(it => {
          const bare = it.std_code.replace(/^AX-/, '')
          found[it.std_code] = it
          found[bare] = it
        })
      }

      setRows(parsed.map(p => {
        if (p.err) return { ...p, status: 'error' }
        const it = found[p.code]
        if (!it) return { ...p, status: 'notfound' }
        const book = Number(it.inventory?.[0]?.qty) || 0
        return {
          ...p, status: 'ok',
          item_id: it.id, std_code: it.std_code, name: it.name,
          unit: it.unit, location: it.inventory?.[0]?.location || '',
          book, diff: p.qty - book,
        }
      }))
    } catch (e) {
      toastError('조회 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  const stat = useMemo(() => {
    if (!rows) return null
    const ok = rows.filter(r => r.status === 'ok')
    return {
      total: rows.length,
      ok: ok.length,
      diff: ok.filter(r => r.diff !== 0).length,
      same: ok.filter(r => r.diff === 0).length,
      notfound: rows.filter(r => r.status === 'notfound').length,
      error: rows.filter(r => r.status === 'error').length,
    }
  }, [rows])

  // 차이가 있는 건만 반영
  async function apply() {
    const target = rows.filter(r => r.status === 'ok' && r.diff !== 0)
    if (!target.length) { toastError('반영할 차이가 없습니다'); return }
    if (!confirm(
      `${target.length}건의 재고를 실사 수량으로 바꿉니다.\n\n` +
      `증가 ${target.filter(r => r.diff > 0).length}건 · ` +
      `감소 ${target.filter(r => r.diff < 0).length}건\n\n` +
      `되돌릴 수 없습니다. 계속할까요?`
    )) return

    setBusy(true)
    try {
      for (let i = 0; i < target.length; i += 100) {
        const chunk = target.slice(i, i + 100)
        const { error } = await supabase.from('inventory')
          .upsert(chunk.map(r => ({ item_id: r.item_id, qty: r.qty })),
                  { onConflict: 'item_id' })
        if (error) throw error
      }
      logActivity('update', 'inventory', null,
        `실사 반영 ${target.length}건 (붙여넣기)`)
      toastSuccess(`${n(target.length)}건 반영 완료`)
      qc.invalidateQueries({ queryKey: ['inventory'] })
      setRows(null); setText('')
      onClose?.()
    } catch (e) {
      toastError('반영 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  const shown = rows
    ? (onlyDiff ? rows.filter(r => r.status !== 'ok' || r.diff !== 0) : rows)
    : []

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">📋 재고 실사 붙여넣기</h3>
            <p className="text-xs text-slate-400">엑셀에서 품번과 수량 두 열만 복사해 붙이세요</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl px-2">✕</button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {!rows ? (
            <>
              <textarea value={text} onChange={e => setText(e.target.value)}
                placeholder={'AX-5101788\t12\nAX-160021952\t4\n110132770\t8\n\n※ 품번  수량 순서 · 탭·쉼표·띄어쓰기 모두 인식\n※ AX- 를 빼고 숫자만 넣어도 됩니다'}
                rows={12}
                className="w-full px-3 py-2.5 text-sm font-mono border-2 border-slate-200 rounded-lg
                  focus:outline-none focus:border-indigo-500 resize-none" />
              <div className="mt-2 rounded-lg bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  <b className="text-slate-700">넣는 방법</b><br />
                  엑셀에서 품번 열과 수량 열을 함께 선택 → 복사 → 여기에 붙여넣기<br />
                  실사한 품목만 넣으면 됩니다. 나머지 재고는 그대로 유지됩니다.
                </p>
              </div>
              <button onClick={check} disabled={busy || !text.trim()}
                className="w-full mt-3 py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white
                  hover:bg-indigo-700 disabled:opacity-40">
                {busy ? '대조 중…' : '장부와 대조하기'}
              </button>
            </>
          ) : (
            <>
              {/* 요약 */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { l: '전체', v: stat.total, c: 'text-slate-700' },
                  { l: '차이 있음', v: stat.diff, c: 'text-amber-600' },
                  { l: '일치', v: stat.same, c: 'text-emerald-600' },
                  { l: '못 찾음', v: stat.notfound + stat.error, c: 'text-rose-600' },
                ].map(x => (
                  <div key={x.l} className="rounded-lg border border-slate-200 p-2.5 text-center">
                    <p className="text-[11px] font-bold text-slate-400">{x.l}</p>
                    <p className={`text-xl font-bold ${x.c}`}>{n(x.v)}</p>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
                <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)}
                  className="w-3.5 h-3.5 accent-indigo-600" />
                차이 있는 건만 보기
              </label>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-400">
                    <tr>
                      <th className="px-2 py-2 text-left font-bold">품번</th>
                      <th className="px-2 py-2 text-left font-bold">품명</th>
                      <th className="px-2 py-2 text-right font-bold">장부</th>
                      <th className="px-2 py-2 text-right font-bold">실사</th>
                      <th className="px-2 py-2 text-right font-bold">차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i} className={`border-t border-slate-100 ${
                        r.status !== 'ok' ? 'bg-rose-50' : r.diff !== 0 ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-2 py-1.5 font-mono text-indigo-600">
                          {r.std_code || r.code || `${r.line}행`}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600 max-w-[220px] truncate">
                          {r.status === 'ok' ? r.name
                            : r.status === 'notfound' ? <span className="text-rose-600">등록되지 않은 품번</span>
                            : <span className="text-rose-600">{r.err}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-500">
                          {r.status === 'ok' ? n(r.book) : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-slate-800">
                          {r.qty != null ? n(r.qty) : '-'}
                        </td>
                        <td className={`px-2 py-1.5 text-right font-bold ${
                          r.status !== 'ok' ? 'text-slate-300'
                            : r.diff === 0 ? 'text-slate-300'
                            : r.diff > 0 ? 'text-sky-600' : 'text-rose-600'}`}>
                          {r.status === 'ok' ? (r.diff === 0 ? '—' : `${r.diff > 0 ? '+' : ''}${n(r.diff)}`) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {stat.notfound + stat.error > 0 && (
                <p className="text-[11px] text-rose-600 mt-2">
                  ⚠ 찾지 못한 {n(stat.notfound + stat.error)}건은 반영되지 않습니다.
                  품번을 확인하거나 기준코드 DB 에 먼저 등록해 주세요.
                </p>
              )}
            </>
          )}
        </div>

        {rows && (
          <div className="px-5 py-3 border-t border-slate-200 flex gap-2">
            <button onClick={() => setRows(null)}
              className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
              다시 입력
            </button>
            <button onClick={apply} disabled={busy || !stat.diff}
              className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white
                hover:bg-indigo-700 disabled:opacity-40">
              {busy ? '반영 중…' : `차이 ${n(stat.diff)}건 재고에 반영`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
