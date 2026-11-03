// ⚠ 미불출 일괄 입력 · 해제 (v4.137.0)
//   생산관리 목록에서 호기를 여러 개 고른 뒤, 모자란 품목을 「품번 · 대당 수량」으로 한 번에 넣는다.
//   예전엔 호기마다 편집 창을 열어 품목을 하나씩 적었다 (4대 × 3품목 = 12번).
//   · 넣기: 붙여넣기 → 품명 · 제조사 자동 조회 → 고른 호기 전부에 저장 (이미 있으면 수량 바꾸기 / 더하기)
//   · 해제: 고른 호기에 걸린 미불출을 품목으로 모아 체크한 것만 지운다
//   · 저장 직전에 호기의 미불출을 다시 읽어 합친다 — 창을 연 사이 출고 작업이 넣은 결품이 지워지지 않게
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { codeCandidates, stripPrefix } from '../../lib/custPrefix'
import { parseMissingPaste, mergeMissing, clearMissing, collectMissing, missKey } from '../../lib/missingBulk'
import { useDebounced } from '../../hooks/useDebounced'
import { toastError, toastSuccess } from '../../lib/toast'
import Spin from '../../components/ux/Spin'

const today = () => new Date().toISOString().slice(0, 10)

export default function BulkMissingModal({ rows, csCode, by, onClose, onDone }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState('add')
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [mode, setMode] = useState('set')
  const [ov, setOv] = useState({})          // 품목별로 고친 수량 · 날짜 { KEY: { qty, date } }
  const [clearSel, setClearSel] = useState(() => new Set())

  const parsed = useMemo(() => parseMissingPaste(text), [text])
  const pq = useDebounced(parsed.map((p) => p.pn).join('|'), 300)

  // 품명 · 제조사 조회 — 고객사 접두를 붙인 것 · 그대로 둘 다 본다
  const { data: found = {}, isFetching } = useQuery({
    queryKey: ['missBulkItems', csCode, pq],
    enabled: !!pq,
    staleTime: 60_000,
    queryFn: async () => {
      const cands = [...new Set(pq.split('|').flatMap((pn) => codeCandidates(pn, csCode)))]
      const hit = {}
      for (let i = 0; i < cands.length; i += 200) {
        const { data, error } = await supabase.from('items')
          .select('id,std_code,name,manufacturer,manufacturer_code').in('std_code', cands.slice(i, i + 200))
        if (error) throw error
        ;(data || []).forEach((x) => { hit[x.std_code] = x })
      }
      const out = {}
      for (const pn of pq.split('|')) {
        const it = codeCandidates(pn, csCode).map((c) => hit[c]).find(Boolean)
        if (it) out[stripPrefix(pn).toUpperCase()] = it
      }
      return out
    },
  })

  const parts = useMemo(() => parsed.map((p) => {
    const k = stripPrefix(p.pn).toUpperCase()
    const it = found[k]
    const o = ov[k] || {}
    return {
      key: k, found: !!it,
      std_code: it?.std_code || '', item_id: it?.id || '',
      pn: it ? stripPrefix(it.std_code) : stripPrefix(p.pn),
      name: it?.name || '', maker: it?.manufacturer || '', makerPn: it?.manufacturer_code || '',
      qty: o.qty ?? p.qty, date: o.date ?? date,
    }
  }), [parsed, found, ov, date])

  const n = rows.length
  const okParts = parts.filter((p) => Number(p.qty) > 0)
  const missingLookup = !isFetching && parts.some((p) => !p.found)
  const hasOf = (p) => rows.filter((r) => (r.missing_parts || []).some((m) => missKey(m) === p.key))
  const bundle = useMemo(() => collectMissing(rows), [rows])

  const saveMut = useMutation({
    mutationFn: async ({ kind }) => {
      const ids = rows.map((r) => r.id)
      const { data, error } = await supabase.from('production').select('id,hogi,missing_parts,changes').in('id', ids)
      if (error) throw error
      const now = new Date().toISOString()
      let touched = 0, lines = 0
      for (const r of data || []) {
        let next, msg, cnt
        if (kind === 'add') {
          const res = mergeMissing(r.missing_parts, okParts, mode)
          next = res.next; cnt = res.added.length + res.updated.length
          msg = `미불출 일괄 입력 ${cnt}품목 — ` + okParts.map((p) => `${p.pn}×${p.qty}`).join(', ')
        } else {
          const res = clearMissing(r.missing_parts, clearSel)
          next = res.next; cnt = res.removed
          msg = `미불출 일괄 해제 ${cnt}품목 — ` + [...clearSel].join(', ')
        }
        if (!cnt) continue
        const changes = [...(Array.isArray(r.changes) ? r.changes : []), { type: kind === 'add' ? '미불출입력' : '미불출해제', msg, at: now, by: by || null }]
        const { error: e2 } = await supabase.from('production').update({ missing_parts: next, changes, updated_at: now }).eq('id', r.id)
        if (e2) throw e2
        touched++; lines += cnt
      }
      return { touched, lines, kind }
    },
    onSuccess: ({ touched, lines, kind }) => {
      toastSuccess(kind === 'add' ? `미불출 입력 — ${touched}대 · ${lines}줄` : `미불출 해제 — ${touched}대 · ${lines}줄`)
      qc.invalidateQueries({ queryKey: ['production'] })
      qc.invalidateQueries({ queryKey: ['missingParts'] })
      onDone?.()
    },
    onError: (e) => toastError('미불출 저장 오류: ' + e.message),
  })

  const setO = (k, patch) => setOv((s) => ({ ...s, [k]: { ...(s[k] || {}), ...patch } }))
  const hogiChips = rows.slice(0, 12)

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()} data-bulk-missing>
        <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800">⚠ 미불출 일괄 {tab === 'add' ? '입력' : '해제'}</h3>
            <p className="text-[11px] text-slate-400">고른 호기 {n}대에 같은 품목을 한 번에 {tab === 'add' ? '넣습니다' : '지웁니다'}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {hogiChips.map((r) => (
                <span key={r.id} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">{r.pn} {r.hogi || '-'}</span>
              ))}
              {n > hogiChips.length && <span className="text-[10px] text-slate-400 self-center">외 {n - hogiChips.length}대</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="px-5 pt-3 flex gap-1.5">
          {[['add', '넣기'], ['clear', `해제${bundle.length ? ` (${bundle.length})` : ''}`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} data-bulk-missing-tab={k}
              className={`px-3 py-1.5 text-xs font-bold rounded-full border ${tab === k ? 'bg-violet-50 text-violet-700 border-violet-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>

        {tab === 'add' ? (
          <div className="p-5 pt-3 overflow-y-auto space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700" htmlFor="bm-paste">품번 · 대당 수량</label>
                <textarea id="bm-paste" value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus data-bulk-missing-paste
                  placeholder={'5102060\t2\nCN-23-110\t4'}
                  className="mt-1 w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400" />
                <p className="text-[11px] text-slate-400 mt-0.5">엑셀에서 「품번 / 수량」 두 칸을 복사해 붙여 넣거나 한 줄씩 칩니다. 고객사 접두(AX- 등)는 안 붙여도 됩니다. 수량은 <b>호기 1대에 모자란 수</b>이고, 비우면 1입니다.</p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700" htmlFor="bm-date">입고 예정</label>
                <input id="bm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} min={today()}
                  className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <p className="text-[11px] text-slate-400 mt-0.5">비워도 됩니다. 품목마다 다르면 아래 표에서 고칩니다.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-bold text-slate-700">이미 적힌 품목이면</span>
              {[['set', '수량 바꾸기'], ['add', '더하기']].map(([k, l]) => (
                <label key={k} className={`flex items-center gap-1 px-2 py-1 rounded-lg border cursor-pointer ${mode === k ? 'border-violet-300 bg-violet-50 text-violet-700 font-bold' : 'border-slate-200 text-slate-500'}`}>
                  <input type="radio" name="bm-mode" checked={mode === k} onChange={() => setMode(k)} />{l}
                </label>
              ))}
            </div>

            {parts.length > 0 && (
              <div className="overflow-x-auto border border-slate-100 rounded-lg">
                <table className="w-full text-xs min-w-[640px]">
                  <thead><tr className="bg-slate-50 text-slate-400">
                    <th className="px-2 py-1.5 text-left">품번</th><th className="px-2 py-1.5 text-left">품명</th><th className="px-2 py-1.5 text-left">제조사</th>
                    <th className="px-2 py-1.5 text-right">대당</th><th className="px-2 py-1.5 text-right">× {n}대</th>
                    <th className="px-2 py-1.5 text-left">입고 예정</th><th className="px-2 py-1.5 text-left">호기</th>
                  </tr></thead>
                  <tbody>
                    {parts.map((p) => {
                      const has = hasOf(p)
                      return (
                        <tr key={p.key} className="border-t border-slate-100" data-bulk-missing-row={p.key}>
                          <td className="px-2 py-1.5 font-mono font-bold text-indigo-600">{p.pn}</td>
                          <td className="px-2 py-1.5 max-w-[180px] truncate">
                            {p.found ? <span className="text-slate-600">{p.name}</span>
                              : isFetching ? <span className="text-slate-300">찾는 중…</span>
                              : <span className="text-amber-600 font-semibold">품목 없음 — 품번만 저장</span>}
                          </td>
                          <td className="px-2 py-1.5 text-slate-500 max-w-[110px] truncate">{p.maker || '—'}</td>
                          <td className="px-2 py-1.5 text-right">
                            <input type="number" min="0" value={p.qty} onChange={(e) => setO(p.key, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                              className="w-14 px-1 py-0.5 text-right font-bold border border-slate-200 rounded" />
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-500 tabular-nums">{(Number(p.qty) || 0) * n}</td>
                          <td className="px-2 py-1.5">
                            <input type="date" value={p.date || ''} onChange={(e) => setO(p.key, { date: e.target.value })}
                              className="px-1 py-0.5 text-[11px] border border-slate-200 rounded" />
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {has.length === 0
                              ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">{n}대 새로</span>
                              : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700" title={has.map((r) => r.hogi).join(', ')}>
                                  {has.length}대 있음 → {mode === 'add' ? '더함' : '바꿈'}{has.length < n ? ` · ${n - has.length}대 새로` : ''}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {missingLookup && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">품목 마스터에 없는 품번은 품번만 저장됩니다. 오타가 아닌지 확인하세요.</p>}
            {!parts.length && <p className="text-xs text-slate-400 py-3 text-center">모자란 품목을 위 칸에 붙여 넣으세요</p>}
          </div>
        ) : (
          <div className="p-5 pt-3 overflow-y-auto space-y-2">
            {bundle.length === 0 ? <p className="text-xs text-slate-400 py-6 text-center">고른 호기에 걸린 미불출이 없습니다</p> : (
              <>
                <div className="flex items-center gap-2 text-[11px]">
                  <button onClick={() => setClearSel(new Set(bundle.map((b) => b.key)))} className="px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50">전체 선택</button>
                  <button onClick={() => setClearSel(new Set())} className="px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50">선택 해제</button>
                </div>
                <div className="overflow-x-auto border border-slate-100 rounded-lg">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead><tr className="bg-slate-50 text-slate-400">
                      <th className="px-2 py-1.5 w-8"></th><th className="px-2 py-1.5 text-left">품번</th><th className="px-2 py-1.5 text-left">품명</th>
                      <th className="px-2 py-1.5 text-left">걸린 호기</th><th className="px-2 py-1.5 text-right">합계</th>
                    </tr></thead>
                    <tbody>
                      {bundle.map((b) => (
                        <tr key={b.key} className={`border-t border-slate-100 ${clearSel.has(b.key) ? 'bg-rose-50/50' : ''}`} data-bulk-clear-row={b.key}>
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={clearSel.has(b.key)} onChange={() => setClearSel((s) => { const x = new Set(s); x.has(b.key) ? x.delete(b.key) : x.add(b.key); return x })} />
                          </td>
                          <td className="px-2 py-1.5 font-mono font-bold text-indigo-600">{b.pn}</td>
                          <td className="px-2 py-1.5 text-slate-600 max-w-[200px] truncate">{b.name || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-500">{b.hogis.join(' ')}{b.hogis.length < n && <span className="text-slate-300"> · {b.hogis.length}/{n}대</span>}</td>
                          <td className="px-2 py-1.5 text-right font-bold tabular-nums">{b.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">체크한 품목을 고른 호기에서 지웁니다. 다른 미불출은 그대로 둡니다.</p>
              </>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
          {tab === 'add' ? (
            <button disabled={saveMut.isPending || isFetching || !okParts.length} onClick={() => saveMut.mutate({ kind: 'add' })} data-bulk-missing-save
              className="px-4 py-2 text-sm font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
              {saveMut.isPending ? <span className="inline-flex items-center gap-1.5"><Spin />저장 중…</span> : `${n}대에 ${okParts.length}품목 저장`}
            </button>
          ) : (
            <button disabled={saveMut.isPending || !clearSel.size} onClick={() => saveMut.mutate({ kind: 'clear' })} data-bulk-clear-save
              className="px-4 py-2 text-sm font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
              {saveMut.isPending ? <span className="inline-flex items-center gap-1.5"><Spin />지우는 중…</span> : `${clearSel.size}품목 해제`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
