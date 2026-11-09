import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { useCustomer } from '../../hooks/useCustomers'
import { useDebounced } from '../../hooks/useDebounced'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { toastError, toastSuccess } from '../../lib/toast'
import { logActivity } from '../../lib/activityLog'
import { fetchQuoteMarginCfg, QUOTE_CFG_KEY } from '../../lib/quoteSettings'
import { prevWarn, prevMargin, isMissingSaleFn } from '../../lib/salePrice'
import { todayISO, ymdKST } from '../../lib/utils'

// 판매 실적가 (v4.163.0) — 고객사에 낸 판매단가를 품목별로 본다 · 고친다
//   실적가 = 그 품목의 가장 최근 견적 단가 (단품 줄 단가 · 세부견적으로 나간 부품 단가)
//   · 견적 화면이 쓰는 값과 같은 규칙 (lib/salePrice · pm_last_sale_price) — 통화별 따로
//   · 세부견적을 안 낸 견적의 부품 계산값 · ASSY 줄 단가는 이력에만 (견적 화면에서 안 씀 — ASSY 는 하위 합계로)
//   · 자료: pm_sale_price_hist (매출견적 저장 때 자동 · 단가표 · 엑셀 견적은 가져오기)
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const money = (v, cur) => (cur === 'KRW' ? Math.round(n(v)).toLocaleString('ko-KR') : n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const usable = (r) => r.kind === 'item' || (r.kind === 'part' && r.detail_sent)
const newer = (a, b) => (String(a.quote_date || '') !== String(b.quote_date || '') ? String(a.quote_date || '') > String(b.quote_date || '')
  : String(a.created_at || '') !== String(b.created_at || '') ? String(a.created_at || '') > String(b.created_at || '') : n(a.id) > n(b.id))
const srcLabel = (r) => (r.source === 'quote' ? '포털 견적' : /단가표/.test(r.quote_no || '') ? '단가표' : '엑셀 견적')
const showCode = (k) => (String(k || '').startsWith('MPN:') ? String(k).slice(4) : k)

export default function SalePriceBoard({ custList = [], defaultCode }) {
  const qc = useQueryClient()
  const [ask, confirmEl] = useConfirm()
  const [code, setCode] = useState(defaultCode || custList[0]?.id || '')
  const { data: cs } = useCustomer(code)
  const [cur, setCur] = useState('KRW')
  const [kind, setKind] = useState('use')      // use = 견적에 쓰는 값 · assy = ASSY 견적가(참고)
  const [warnOnly, setWarnOnly] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const [open, setOpen] = useState(null)

  const custKey = cs?.id || null
  const { data, isLoading, error } = useQuery({
    queryKey: ['salePriceHist', custKey],
    enabled: !!custKey,
    queryFn: () => fetchAll(() => supabase.from('pm_sale_price_hist').select('*').eq('cust_key', custKey).order('id')),
    staleTime: 60 * 1000,
  })
  const rows = data || []
  const missing = error && isMissingSaleFn(error)

  const { data: mcfg } = useQuery({ queryKey: QUOTE_CFG_KEY, queryFn: fetchQuoteMarginCfg, staleTime: 10 * 60 * 1000 })
  const sellRate = n(mcfg?.sellRate) || 1400

  // 지금 매입가 — 포털 품목과 맞은 줄만
  const codes = useMemo(() => [...new Set(rows.map((r) => r.std_code).filter(Boolean))].sort(), [rows])
  const { data: buyMap = {} } = useQuery({
    queryKey: ['salePriceBuy', codes.join(',')],
    enabled: codes.length > 0,
    queryFn: async () => {
      const m = {}
      for (let i = 0; i < codes.length; i += 150) {
        const { data: its, error: e } = await supabase.from('items').select('std_code,purchase_price').in('std_code', codes.slice(i, i + 150))
        if (e) throw e
        ;(its || []).forEach((x) => { m[x.std_code] = x.purchase_price == null ? null : n(x.purchase_price) })
      }
      return m
    },
    staleTime: 5 * 60 * 1000,
  })

  const curs = useMemo(() => [...new Set(rows.map((r) => r.currency))].sort(), [rows])
  // 품목별 — 지금 실적가(견적 화면이 쓰는 값) + 이력 전체
  const groups = useMemo(() => {
    const g = new Map()
    for (const r of rows) {
      if (r.currency !== cur) continue
      const isAssy = r.kind === 'assy'
      if ((kind === 'assy') !== isAssy) continue
      const k = r.code_key
      if (!g.has(k)) g.set(k, { key: k, hist: [], cur: null })
      const x = g.get(k)
      x.hist.push(r)
      if ((isAssy || usable(r)) && (!x.cur || newer(r, x.cur))) x.cur = r
    }
    const out = []
    for (const x of g.values()) {
      x.hist.sort((a, b) => (newer(a, b) ? -1 : 1))
      const c = x.cur || x.hist[0]
      const buy = c.std_code ? buyMap[c.std_code] : null
      out.push({ ...x, show: c, used: !!x.cur, name: c.item_name || x.hist.find((h) => h.item_name)?.item_name || '',
        buy, warn: x.cur && kind === 'use' ? prevWarn(buy, c.unit_price, cur, sellRate, mcfg?.tiers) : null,
        margin: kind === 'use' && x.cur ? prevMargin(buy, c.unit_price, cur, sellRate) : null })
    }
    return out.sort((a, b) => (newer(a.show, b.show) ? -1 : 1))
  }, [rows, cur, kind, buyMap, sellRate, mcfg?.tiers])

  const filtered = useMemo(() => {
    const t = dq.trim().toUpperCase()
    return groups.filter((g) => (!warnOnly || g.warn) && (!t || [g.key, g.name, g.show.quote_no, g.show.mpn, g.show.parent_code].some((v) => String(v || '').toUpperCase().includes(t))))
  }, [groups, dq, warnOnly])
  const vis = useVisibleRows(filtered, 200, [dq, cur, kind, warnOnly, custKey])

  const d30 = ymdKST(new Date(Date.now() - 30 * 86400000))
  const kpi = {
    items: groups.filter((g) => g.used).length,
    recent: groups.filter((g) => g.used && String(g.show.quote_date || '') >= d30).length,
    imported: groups.filter((g) => g.used && g.show.source !== 'quote').length,
    warn: groups.filter((g) => g.warn).length,
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['salePriceHist'], exact: false })
  async function editRow(r) {
    const res = await ask({
      title: `✎ 실적가 고치기 — ${showCode(r.code_key)}`,
      desc: `${r.quote_no || ''} · ${r.quote_date || ''} 에 낸 단가를 고칩니다. 다음 견적부터 고친 값을 씁니다 (이미 저장된 견적서는 그대로).`,
      input: { type: 'number', label: `단가 (${r.currency})`, value: String(r.unit_price), validate: (v) => (n(v) > 0 ? '' : '0보다 큰 값을 적어 주세요') },
      okText: '고치기',
    })
    if (!res?.value) return
    const v = n(res.value)
    if (v === n(r.unit_price)) return
    const { error: e } = await supabase.from('pm_sale_price_hist').update({ unit_price: v }).eq('id', r.id)
    if (e) { toastError('고치지 못했습니다 — ' + e.message); return }
    logActivity('update', 'pm_sale_price_hist', r.code_key, `판매 실적가 수정 ${cs?.name || ''} ${showCode(r.code_key)} ${money(r.unit_price, r.currency)} → ${money(v, r.currency)} ${r.currency} (${r.quote_no || ''})`)
    toastSuccess(`${showCode(r.code_key)} 실적가 ${money(v, r.currency)} 로 고쳤습니다`)
    refresh()
  }
  async function delRow(r) {
    if (!(await ask({
      title: `🗑 이 실적가 줄을 지울까요? — ${showCode(r.code_key)}`,
      desc: `${r.quote_no || ''} · ${r.quote_date || ''} · ${money(r.unit_price, r.currency)} ${r.currency}. 지우면 그 전 견적 값이 실적가가 됩니다 (없으면 견적 화면에서 지금처럼 계산). 견적서 자체는 지워지지 않습니다.`,
      okText: '지우기', danger: true,
    }))) return
    const { error: e } = await supabase.from('pm_sale_price_hist').delete().eq('id', r.id)
    if (e) { toastError('지우지 못했습니다 — ' + e.message); return }
    logActivity('delete', 'pm_sale_price_hist', r.code_key, `판매 실적가 줄 삭제 ${cs?.name || ''} ${showCode(r.code_key)} ${money(r.unit_price, r.currency)} ${r.currency} (${r.quote_no || ''})`)
    toastSuccess('지웠습니다')
    refresh()
  }

  function exportXlsx() {
    const out = filtered.map((g) => ({
      품번: showCode(g.key), 품명: g.name, [`실적가(${cur})`]: n(g.show.unit_price), 견적번호: g.show.quote_no || '', 견적일: g.show.quote_date || '',
      출처: srcLabel(g.show), 구분: g.show.kind === 'item' ? '단품' : g.show.kind === 'part' ? '부품' : 'ASSY', 상위ASSY: g.show.parent_code || '',
      지금매입가: g.buy ?? '', 지금마진: g.margin == null ? '' : Math.round(g.margin * 1000) / 10 + '%', 경고: g.warn === 'loss' ? '적자' : g.warn === 'low' ? '마진 낮음' : '', 이력: g.hist.length,
    }))
    const ws = XLSX.utils.json_to_sheet(out)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '판매 실적가')
    XLSX.writeFile(wb, `판매실적가_${cs?.name || code}_${cur}_${todayISO()}.xlsx`)
  }

  const kindLabel = (r) => (r.kind === 'item' ? '단품' : r.kind === 'part' ? '부품' : 'ASSY')
  return (
    <div className="space-y-3" data-sale-board>
      {confirmEl}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] text-slate-400">매출견적</p>
          <h2 className="text-base font-extrabold text-slate-800">🏷 판매 실적가</h2>
          <p className="text-xs text-slate-400">고객사에 낸 판매단가 — <b>품목마다 가장 최근 견적 단가가 실적가</b>입니다. 견적서를 쓸 때 이 값이 그대로 들어갑니다 (단품 줄 · 세부견적 하위 부품). 매출견적을 💾 저장하면 저절로 쌓입니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={code} onChange={(e) => { setCode(e.target.value); setOpen(null) }} data-sale-cust
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white">
            {custList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {curs.length > 1 && <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {curs.map((c) => <button key={c} onClick={() => setCur(c)} data-sale-cur={c}
              className={`px-2.5 py-1 text-xs font-bold rounded-md ${cur === c ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>{c === 'KRW' ? '원화' : c}</button>)}
          </div>}
          <button onClick={exportXlsx} disabled={!filtered.length} data-sale-xlsx
            className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">📑 엑셀</button>
        </div>
      </div>

      {missing && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">판매 실적가 표가 아직 없습니다 — Supabase 에서 「판매실적가_반영_261109.sql」을 먼저 실행해 주세요.</div>}
      {error && !missing && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">실적가를 못 불러왔습니다 — {error.message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-sale-kpi>
        <Kpi label="실적가 품목" value={kpi.items} note="견적서에 바로 쓰이는 품목" />
        <Kpi label="최근 30일 갱신" value={kpi.recent} note="30일 안에 낸 견적으로 바뀐 품목" tone="blue" />
        <Kpi label="가져온 값" value={kpi.imported} note="단가표 · 엑셀 견적에서 넣은 품목" tone="slate" />
        <Kpi label="⚠ 마진 낮음 · 적자" value={kpi.warn} note="지금 매입가로 보면 구간 마진 −5%p 아래" tone={kpi.warn ? 'red' : 'green'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['use', '단품 · 부품'], ['assy', 'ASSY 견적가 (참고)']].map(([k, l]) => (
            <button key={k} onClick={() => { setKind(k); setOpen(null) }} data-sale-kind={k}
              className={`px-2.5 py-1 text-xs font-bold rounded-md ${kind === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
        {kind === 'use' && <button onClick={() => setWarnOnly((v) => !v)} data-sale-warnonly
          className={`px-3 py-1.5 text-xs font-bold rounded-full border ${warnOnly ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-500'}`}>⚠ 마진 낮음 · 적자만</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 품명 · 제조사품번 · 견적번호 · 상위 ASSY 검색" data-sale-q
          className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-[10px] border border-slate-200" />
        <span className="text-xs text-slate-400">{filtered.length.toLocaleString()}개</span>
      </div>
      {kind === 'assy' && <p className="text-[11px] text-slate-400">ASSY 견적가는 참고용입니다 — 견적서에서 ASSY 단가는 하위 부품 합계(실적가 부품은 그 값) + 작업비로 다시 계산합니다.</p>}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left">품번 · 품명</th>
              <th className="px-3 py-2 text-right">실적가 ({cur === 'KRW' ? '원' : cur})</th>
              <th className="px-3 py-2 text-left">견적</th>
              <th className="px-3 py-2 text-left">출처</th>
              {kind === 'use' && <th className="px-3 py-2 text-right" title="포털 품목 매입가 — 그때 견적 원가가 아니라 지금 값">지금 매입가</th>}
              {kind === 'use' && <th className="px-3 py-2 text-right">지금 마진</th>}
              <th className="px-3 py-2 text-right">이력</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="py-8 text-center text-slate-400">불러오는 중…</td></tr>}
            {!isLoading && !filtered.length && <tr><td colSpan={7} className="py-8 text-center text-slate-400">{rows.length ? '조건에 맞는 실적가가 없습니다' : '이 고객사의 실적가가 아직 없습니다 — 매출견적을 저장하면 쌓입니다'}</td></tr>}
            {vis.shown.map((g) => {
              const s = g.show
              const isOpen = open === g.key
              return (
                <FragmentRow key={g.key}>
                  <tr className={`border-b border-slate-100 align-top hover:bg-slate-50/60 ${g.used || kind === 'assy' ? '' : 'opacity-60'}`} data-sale-row={showCode(g.key)}>
                    <td className="px-3 py-2">
                      <div className="font-mono font-semibold text-indigo-600">{showCode(g.key)}{String(g.key).startsWith('MPN:') && <span className="ml-1 text-[10px] text-slate-400">(제조사품번)</span>}</div>
                      <div className="text-[11.5px] text-slate-400 truncate max-w-[320px]" title={g.name}>{g.name || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                      {money(s.unit_price, cur)}
                      {!g.used && kind === 'use' && <div className="text-[10px] font-normal text-slate-400" title="세부견적을 안 낸 견적의 부품 계산값 — 고객이 본 값이 아니라 견적 화면에서 안 씀">기록만 (안 씀)</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-slate-600">{s.quote_no || '—'}</div>
                      <div className="text-[11px] text-slate-400">{s.quote_date || ''}{s.kind === 'part' && s.parent_code ? ` · ${String(s.parent_code).replace(/^(AX|VM|CS|ED)-/, '')} 세부` : ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-[1px] rounded-full text-[10.5px] font-bold ${s.source === 'quote' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>{srcLabel(s)}</span>
                      <span className="ml-1 text-[10.5px] text-slate-400">{kindLabel(s)}</span>
                    </td>
                    {kind === 'use' && <td className="px-3 py-2 text-right font-mono text-slate-500">{g.buy == null ? <span className="text-slate-300">—</span> : Math.round(g.buy).toLocaleString('ko-KR')}</td>}
                    {kind === 'use' && <td className="px-3 py-2 text-right" data-sale-margin={g.warn || ''}>
                      {g.margin == null ? <span className="text-slate-300">—</span>
                        : <span className={`font-bold ${g.warn === 'loss' ? 'text-rose-600' : g.warn === 'low' ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {g.warn ? '⚠ ' : ''}{(g.margin * 100).toFixed(1)}%</span>}
                    </td>}
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setOpen(isOpen ? null : g.key)} data-sale-hist={showCode(g.key)}
                        className="text-[11px] font-bold text-indigo-500 hover:text-indigo-700 underline">{isOpen ? '▲ 접기' : `▼ ${g.hist.length}건`}</button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={7} className="px-4 py-2">
                        <table className="w-full text-[11px]" data-sale-histtable>
                          <thead className="text-slate-400"><tr>
                            <th className="py-1 text-left">견적일</th><th className="py-1 text-left">견적번호</th><th className="py-1 text-left">구분</th><th className="py-1 text-left">상위 ASSY</th>
                            <th className="py-1 text-right">단가</th><th className="py-1 text-right">수량</th><th className="py-1 text-right">그때 원가</th><th className="py-1 text-left pl-3">출처</th><th className="py-1"></th>
                          </tr></thead>
                          <tbody>
                            {g.hist.map((h) => {
                              const cur0 = h.id === g.cur?.id
                              const skip = h.kind === 'part' && !h.detail_sent
                              return (
                                <tr key={h.id} className={`border-t border-slate-100 ${cur0 ? 'font-bold text-emerald-700' : skip ? 'text-slate-400' : 'text-slate-600'}`} data-sale-histrow={h.id}>
                                  <td className="py-1">{h.quote_date || '—'}</td>
                                  <td className="py-1 font-mono">{h.quote_no || '—'}{cur0 && <span className="ml-1 px-1.5 rounded-full bg-emerald-50 text-[10px]">실적가</span>}</td>
                                  <td className="py-1">{kindLabel(h)}{skip && <span className="ml-1 text-[10px]" title="세부견적을 안 낸 견적 — 고객이 본 값이 아니라 안 씀">(세부견적 안 냄)</span>}</td>
                                  <td className="py-1 font-mono">{h.parent_code || ''}</td>
                                  <td className="py-1 text-right font-mono">{money(h.unit_price, h.currency)}</td>
                                  <td className="py-1 text-right">{h.qty ?? ''}</td>
                                  <td className="py-1 text-right font-mono">{h.cost_krw == null ? '' : Math.round(n(h.cost_krw)).toLocaleString('ko-KR')}</td>
                                  <td className="py-1 pl-3">{srcLabel(h)}{h.created_by ? ` · ${h.created_by}` : ''}</td>
                                  <td className="py-1 text-right whitespace-nowrap">
                                    <button onClick={() => editRow(h)} data-sale-edit={h.id} className="text-indigo-500 hover:text-indigo-700 underline">✎ 고치기</button>
                                    <button onClick={() => delRow(h)} data-sale-del={h.id} className="ml-2 text-slate-400 hover:text-rose-600">🗑</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              )
            })}
          </tbody>
        </table>
        <MoreRows {...vis} />
      </div>
    </div>
  )
}

function FragmentRow({ children }) { return <>{children}</> }

function Kpi({ label, value, note, tone }) {
  const t = { red: 'bg-rose-50 border-rose-200 text-rose-600', green: 'bg-emerald-50 border-emerald-200 text-emerald-600', blue: 'bg-sky-50 border-sky-200 text-sky-600', slate: 'bg-white border-slate-200 text-slate-700' }[tone] || 'bg-violet-50 border-violet-200 text-violet-700'
  return (
    <div className={`rounded-xl border px-4 py-3 ${t}`}>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold">{Number(value || 0).toLocaleString()}</div>
      <div className="text-[11px] text-slate-400">{note}</div>
    </div>
  )
}
