import { useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import { useCanEdit } from '../../hooks/useProfile'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const today = () => new Date().toISOString().slice(0, 10)
const dday = (d) => d ? Math.ceil((new Date(d) - new Date(new Date().toDateString())) / 86400000) : null

const ST = {
  '요청':   { cls: 'border-amber-300 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  '확인':   { cls: 'border-sky-300 bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  '처리중': { cls: 'border-indigo-300 bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  '완료':   { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  '반려':   { cls: 'border-slate-200 bg-slate-50 text-slate-500', dot: 'bg-slate-400' },
}

const emptyRow = () => ({
  key: Math.random().toString(36).slice(2),
  item_id: null, std_code: '', item_name: '', maker: '', maker_code: '',
  qty: '', unit: 'EA', reason: '',
})

// 자재 요청.
//
//   제조팀이 "무엇을 만들기 위해 무엇이 얼마나 언제까지 왜 필요한지" 를 등록하면
//   관제탑 알림으로 구매자재팀에 전달된다.
//   담당자는 재고를 보고 불출할지 발주할지 판단한다.
export default function MaterialRequest() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [tab, setTab] = useState('list')      // list | new
  const [filter, setFilter] = useState(null)  // null=미완료
  const [mine, setMine] = useState(false)      // 내가 등록한 것만
  const [csFilter, setCsFilter] = useState(null)
  const [sel, setSel] = useState({})

  // 요청 입력
  const [head, setHead] = useState({
    urgency: '보통', purpose: '', product_code: '', product_name: '',
    unit_no: '', need_date: '',
  })
  const [rows, setRows] = useState([emptyRow()])
  // ASSY 로 요청 — 그 BOM 부품을 제작구분별로 한꺼번에 가져온다
  const [assyOpen, setAssyOpen] = useState(false)
  const [assyQ, setAssyQ] = useState('')
  const [assyHits, setAssyHits] = useState([])
  const [assy, setAssy] = useState(null)         // { code, name, part_count }
  const [assyQty, setAssyQty] = useState('1')
  const [mkType, setMkType] = useState('normal') // normal 전장 / harness 하네스
  const assyTimer = useRef(null)
  const [busy, setBusy] = useState(false)

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['materialRequests', filter, mine, csFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_request_list',
        { p_status: filter, p_days: 90, p_mine: mine, p_customer: csFilter })
      if (error) throw error
      return data || []
    },
    staleTime: 20 * 1000,        // 여러 명이 동시에 처리하므로 짧게 둔다
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  })

  const checked = list.filter(r => sel[r.id])

  // ── 품목 검색 ──
  const [searchIdx, setSearchIdx] = useState(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const timer = useRef(null)

  const doSearch = useCallback((v) => {
    setQ(v)
    clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); return }
    timer.current = setTimeout(async () => {
      const t = v.trim()
      // 품번·품명·제조사품번 어느 쪽으로도 찾을 수 있게 한다
      const { data } = await supabase.from('items')
        .select('id,std_code,name,unit,manufacturer,manufacturer_code, inventory(qty,location)')
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%`)
        .limit(15)
      setHits(data || [])
    }, 300)
  }, [])

  function pickItem(it) {
    setRows(v => v.map((r, i) => i === searchIdx ? {
      ...r, item_id: it.id, std_code: it.std_code, item_name: it.name,
      maker: it.manufacturer || '', maker_code: it.manufacturer_code || '',
      unit: it.unit || 'EA',
      _stock: it.inventory?.[0]?.qty ?? 0, _loc: it.inventory?.[0]?.location || '',
    } : r))
    setSearchIdx(null); setQ(''); setHits([])
  }

  const searchAssy = useCallback((v) => {
    setAssyQ(v)
    clearTimeout(assyTimer.current)
    if (v.trim().length < 2) { setAssyHits([]); return }
    assyTimer.current = setTimeout(async () => {
      const { data } = await supabase.rpc('pm_assy_search', { p_q: v.trim(), p_limit: 15 })
      setAssyHits(data || [])
    }, 300)
  }, [])

  // ASSY 부품을 제작구분별로 가져와 요청 목록에 채운다
  async function loadAssyParts(a, type, qty) {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_assy_parts', {
        p_code: a.code, p_make_type: type, p_qty: Number(qty) || 1,
      })
      if (error) throw error
      if (!data?.length) { toastError('해당 구분의 부품이 없습니다'); return }
      setRows(data.map(d => ({
        key: Math.random().toString(36).slice(2),
        item_id: d.item_id, std_code: d.std_code, item_name: d.item_name,
        maker: d.maker || '', maker_code: d.maker_code || '',
        qty: String(d.qty_need), unit: d.unit || 'EA', reason: '',
        _stock: Number(d.stock_qty) || 0, _loc: d.stock_loc || '',
      })))
      setHead(h => ({
        ...h,
        product_code: a.code,
        product_name: a.name || '',
        purpose: h.purpose || `${a.code} ${type === 'harness' ? '하네스' : '전장'} 자재 요청`,
      }))
      toastSuccess(`${data.length}건 불러옴 — 수량을 확인하고 등록하세요`)
    } catch (e) {
      toastError('불러오기 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  async function submit() {
    const valid = rows.filter(r => (r.std_code || r.item_name) && Number(r.qty) > 0)
    if (!valid.length) { toastError('품목과 수량을 입력하세요'); return }
    if (!head.purpose.trim()) { toastError('사용 목적을 입력하세요'); return }
    setBusy(true)
    try {
      const payload = valid.map(r => ({
        urgency: head.urgency, purpose: head.purpose,
        product_code: head.product_code, product_name: head.product_name,
        unit_no: head.unit_no, need_date: head.need_date || null,
        item_id: r.item_id, std_code: r.std_code, item_name: r.item_name,
        maker: r.maker, maker_code: r.maker_code,
        qty: Number(r.qty), unit: r.unit, reason: r.reason,
      }))
      const { data, error } = await supabase.rpc('pm_request_create', { p_rows: payload })
      if (error) throw error
      toastSuccess(`${n(data)}건 요청 등록 — 구매자재팀에 전달됩니다`)
      setRows([emptyRow()])
      setHead({ urgency: '보통', purpose: '', product_code: '', product_name: '', unit_no: '', need_date: '' })
      setTab('list')
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })
    } catch (e) {
      toastError('등록 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  // 처리 결과를 공통으로 안내한다
  function report(r, okWord) {
    const done = Number(r?.done ?? 0), failed = Number(r?.failed ?? 0)
    if (failed > 0) toastError(`${n(done)}건 ${okWord} · ${failed}건 실패 — ${r?.note || ''}`)
    else toastSuccess(`${n(done)}건 ${okWord}`)
    setSel({})
    qc.invalidateQueries({ queryKey: ['materialRequests'] })
    qc.invalidateQueries({ queryKey: ['todoList'] })
  }

  // 불출 — 재고에서 실제로 빼고 출고 이력을 남긴다
  async function doIssue() {
    if (!checked.length) return
    const short = checked.filter(r => Number(r.stock_qty) < Number(r.qty))
    const msg = short.length
      ? `재고가 부족한 건이 ${short.length}건 있습니다.\n부족한 건은 처리되지 않습니다.\n\n계속할까요?`
      : `${checked.length}건을 불출 처리합니다.\n재고에서 차감되고 출고 이력이 남습니다.`
    if (!confirm(msg)) return
    try {
      const { data, error } = await supabase.rpc('pm_request_issue',
        { p_ids: checked.map(r => r.id) })
      if (error) throw error
      report(Array.isArray(data) ? data[0] : data, '불출 완료')
      qc.invalidateQueries({ queryKey: ['inventory'] })
    } catch (e) { toastError('불출 실패: ' + e.message) }
  }

  // 발주 — 해당 고객사 구매발주에 만든다
  async function doOrder() {
    if (!checked.length) return
    if (!confirm(`${checked.length}건을 구매발주로 생성합니다.\n\n업체·단가는 구매발주 화면에서 채워주세요.`)) return
    try {
      const { data, error } = await supabase.rpc('pm_request_to_po',
        { p_ids: checked.map(r => r.id) })
      if (error) throw error
      report(Array.isArray(data) ? data[0] : data, '발주 생성')
      qc.invalidateQueries({ queryKey: ['purchase'] })
    } catch (e) { toastError('발주 생성 실패: ' + e.message) }
  }

  // 요청자 본인 취소
  async function cancelMine(id) {
    if (!confirm('이 요청을 취소할까요?')) return
    try {
      const { data, error } = await supabase.rpc('pm_request_cancel', { p_id: id })
      if (error) throw error
      if (data === 'ok') {
        toastSuccess('요청이 취소되었습니다')
        qc.invalidateQueries({ queryKey: ['materialRequests'] })
        qc.invalidateQueries({ queryKey: ['todoList'] })
      } else toastError(data)
    } catch (e) { toastError('취소 실패: ' + e.message) }
  }

  async function changeStatus(status, type) {
    if (!checked.length) return
    const memo = (status === '반려' || type)
      ? prompt(status === '반려' ? '반려 사유' : `${type} 처리 메모 (선택)`) : null
    if (status === '반려' && memo === null) return
    try {
      const { data, error } = await supabase.rpc('pm_request_update', {
        p_ids: checked.map(r => r.id), p_status: status,
        p_type: type || null, p_memo: memo || null, p_force: false,
      })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      const upd = Number(r?.updated ?? r ?? 0)
      const skip = Number(r?.skipped ?? 0)
      if (skip > 0) {
        // 다른 담당자가 먼저 처리한 건이 있으면 알린다
        toastError(`${n(upd)}건 처리 · ${r?.skipped_note || `${skip}건은 이미 처리되어 건너뜀`}`)
      } else {
        toastSuccess(`${n(upd)}건 → ${status}`)
      }
      setSel({})
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      qc.invalidateQueries({ queryKey: ['todoList'] })   // 관제탑 건수도 함께 갱신
    } catch (e) {
      toastError('실패: ' + e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🙋 자재 요청</h1>
          <p className="text-xs text-slate-400">
            필요한 자재를 요청하면 구매자재팀에 전달됩니다. 담당자가 재고를 확인해 불출하거나 발주합니다.
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[['list', '📋 요청 목록'], ['new', '＋ 새 요청']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg ${tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ───────── 새 요청 ───────── */}
      {tab === 'new' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-500">무엇을 만들기 위해</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">사용 목적 · 작업 내용 *</label>
                <input value={head.purpose} onChange={e => setHead(h => ({ ...h, purpose: e.target.value }))}
                  placeholder="예: LEB PD 조립 중 케이블 파손 교체"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">대상 제품 (선택)</label>
                <input value={head.product_code} onChange={e => setHead(h => ({ ...h, product_code: e.target.value }))}
                  placeholder="예: AX-110214084"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">호기 · 프로젝트 (선택)</label>
                <input value={head.unit_no} onChange={e => setHead(h => ({ ...h, unit_no: e.target.value }))}
                  placeholder="예: 45391KF 3호기"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">필요일</label>
                  <input type="date" value={head.need_date} min={today()}
                    onChange={e => setHead(h => ({ ...h, need_date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">긴급도</label>
                  <div className="flex gap-1">
                    {['보통', '긴급'].map(u => (
                      <button key={u} onClick={() => setHead(h => ({ ...h, urgency: u }))}
                        className={`px-3 py-2 text-xs font-bold rounded-lg border ${head.urgency === u
                          ? (u === '긴급' ? 'border-rose-400 bg-rose-500 text-white' : 'border-slate-400 bg-slate-700 text-white')
                          : 'border-slate-200 bg-white text-slate-500'}`}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 품목 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-bold text-slate-500">무엇이 얼마나</p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setAssyOpen(true)}
                  title="ASSY 번호로 그 BOM 부품을 한꺼번에 가져옵니다"
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
                  🧬 ASSY 로 불러오기
                </button>
                <button onClick={() => setRows(v => [...v, emptyRow()])}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  ＋ 품목 추가
                </button>
              </div>
            </div>

            {assy && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold text-indigo-700">{assy.code}</span>
                <span className="text-xs text-slate-600">{assy.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-white text-[11px] font-bold text-indigo-600">
                  {mkType === 'harness' ? '하네스' : '전장'} · {assyQty}대분
                </span>
                <button onClick={() => { setAssy(null); setRows([emptyRow()]) }}
                  className="ml-auto text-[11px] text-slate-400 hover:text-slate-600">해제</button>
              </div>
            )}

            {rows.map((r, i) => (
              <div key={r.key} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {r.std_code ? (
                      <>
                        <p className="font-mono text-sm font-bold text-indigo-600">{r.std_code}</p>
                        <p className="text-xs text-slate-600">{r.item_name}</p>
                        <p className="text-[11px] text-slate-400">
                          {r.maker}{r.maker && r.maker_code ? ' · ' : ''}
                          <span className="font-mono">{r.maker_code}</span>
                          {r._stock !== undefined && (
                            <span className={`ml-2 font-semibold ${r._stock > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                              재고 {n(r._stock)}{r._loc ? ` @ ${r._loc}` : ''}
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <button onClick={() => { setSearchIdx(i); setQ(''); setHits([]) }}
                        className="w-full px-3 py-2 text-sm text-left border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-indigo-400 hover:text-indigo-500">
                        🔍 품목 찾기 — 품번·품명·제조사품번
                      </button>
                    )}
                  </div>
                  <input type="number" inputMode="decimal" value={r.qty}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))}
                    placeholder="수량"
                    className="w-24 px-2 py-2 text-sm text-right font-bold border border-slate-200 rounded-lg" />
                  <span className="text-xs text-slate-400 pt-2.5 w-8">{r.unit}</span>
                  {rows.length > 1 && (
                    <button onClick={() => setRows(v => v.filter((_, k) => k !== i))}
                      className="text-slate-300 hover:text-rose-500 px-1 pt-2">✕</button>
                  )}
                </div>
                <input value={r.reason}
                  onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, reason: e.target.value } : x))}
                  placeholder="필요 사유 (선택) — 예: 기존품 단선"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />

                {r.std_code && (
                  <button onClick={() => setRows(v => v.map((x, k) => k === i ? { ...emptyRow(), key: x.key, qty: x.qty, reason: x.reason } : x))}
                    className="text-[11px] text-slate-400 hover:text-slate-600">품목 다시 고르기</button>
                )}
              </div>
            ))}
          </div>

          <button onClick={submit} disabled={busy}
            className="w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '등록 중…' : '요청 등록'}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            등록하면 구매자재팀 관제탑에 알림으로 표시됩니다.
          </p>
        </div>
      )}

      {/* ───────── ASSY 선택 ───────── */}
      {assyOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setAssyOpen(false)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-slate-800">ASSY 로 불러오기</h3>
              <button onClick={() => setAssyOpen(false)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              ASSY 번호를 고르면 그 BOM 부품을 제작구분별로 한꺼번에 가져옵니다.
            </p>

            {!assy ? (
              <>
                <input value={assyQ} onChange={e => searchAssy(e.target.value)} autoFocus
                  placeholder="ASSY 번호 · 품명 (2자 이상)"
                  className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />
                <div className="mt-2 space-y-1">
                  {assyHits.map(a => (
                    <button key={a.code} onClick={() => setAssy(a)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50">
                      <p className="font-mono text-sm font-bold text-indigo-600">
                        {a.code}
                        {a.rev && <span className="ml-1.5 text-[11px] text-slate-400">Rev {a.rev}</span>}
                      </p>
                      <p className="text-xs text-slate-600">{a.name}</p>
                      <p className="text-[11px] text-slate-400">부품 {n(a.part_count)}종</p>
                    </button>
                  ))}
                  {assyQ.trim().length >= 2 && !assyHits.length && (
                    <p className="text-xs text-slate-400 text-center py-6">BOM 이 등록된 ASSY 가 없습니다.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <p className="font-mono text-sm font-bold text-indigo-700">{assy.code}</p>
                  <p className="text-xs text-slate-600">{assy.name}</p>
                  <p className="text-[11px] text-slate-400">부품 {n(assy.part_count)}종</p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">제작 구분</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[['normal', '⚡ 전장'], ['harness', '🔌 하네스']].map(([v, l]) => (
                      <button key={v} onClick={() => setMkType(v)}
                        className={`py-2.5 text-sm font-bold rounded-lg border-2 ${mkType === v
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    출고 화면에서 지정한 제작구분을 따릅니다. 불출 미대상은 제외됩니다.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">ASSY 수량</label>
                  <input type="number" min="1" value={assyQty}
                    onChange={e => setAssyQty(e.target.value)}
                    className="w-full px-3 py-2.5 text-lg font-bold text-right border-2 border-slate-200 rounded-lg" />
                  <p className="text-[11px] text-slate-400 mt-1">소요량 × 이 수량으로 계산됩니다</p>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setAssy(null); setAssyQ(''); setAssyHits([]) }}
                    className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
                    다시 찾기
                  </button>
                  <button onClick={async () => { await loadAssyParts(assy, mkType, assyQty); setAssyOpen(false) }}
                    disabled={busy}
                    className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">
                    {busy ? '불러오는 중…' : '부품 불러오기'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────── 품목 검색 ───────── */}
      {searchIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setSearchIdx(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-slate-800">품목 찾기</h3>
              <button onClick={() => setSearchIdx(null)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <input value={q} onChange={e => doSearch(e.target.value)} autoFocus
              placeholder="품번 · 품명 · 제조사 · 제조사품번 (2자 이상)"
              className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />
            <div className="mt-2 space-y-1">
              {hits.map(h => {
                const inv = h.inventory?.[0]
                return (
                  <button key={h.id} onClick={() => pickItem(h)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50">
                    <p className="font-mono text-sm font-bold text-indigo-600">{h.std_code}</p>
                    <p className="text-xs text-slate-600">{h.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {h.manufacturer}{h.manufacturer && h.manufacturer_code ? ' · ' : ''}
                      <span className="font-mono">{h.manufacturer_code}</span>
                      {inv && (
                        <span className={`ml-2 font-semibold ${inv.qty > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          재고 {n(inv.qty)}{inv.location ? ` @ ${inv.location}` : ''}
                        </span>
                      )}
                    </p>
                  </button>
                )
              })}
              {q.trim().length >= 2 && !hits.length && (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-400 mb-2">찾는 품목이 없습니다.</p>
                  <button onClick={() => {
                      setRows(v => v.map((x, k) => k === searchIdx ? { ...x, item_name: q.trim(), std_code: '' } : x))
                      setSearchIdx(null); setQ(''); setHits([])
                    }}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50">
                    "{q.trim()}" 그대로 요청하기
                  </button>
                  <p className="text-[11px] text-slate-400 mt-1.5">등록되지 않은 품목도 요청할 수 있습니다</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ───────── 목록 ───────── */}
      {tab === 'list' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {[[null, '진행 중'], ['완료', '완료'], ['반려', '반려'], ['전체', '전체']].map(([f, l]) => (
                <button key={l} onClick={() => { setFilter(f); setSel({}) }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => { setMine(v => !v); setSel({}) }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${mine
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              🙋 내 요청만
            </button>
            <span className="text-xs text-slate-400">{n(list.length)}건</span>

            {canEdit && checked.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <span className="text-xs font-bold text-indigo-600">{checked.length}건 선택</span>
                <button onClick={() => changeStatus('확인')}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-sky-300 text-sky-700 bg-sky-50">확인</button>
                <button onClick={doIssue}
                  title="재고에서 실제로 차감하고 출고 이력을 남깁니다"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">불출 처리</button>
                <button onClick={doOrder}
                  title="해당 고객사 구매발주에 실제로 생성합니다"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50">발주 생성</button>
                <button onClick={() => changeStatus('반려')}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">반려</button>
              </div>
            )}
          </div>

          {isLoading && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}
          {!isLoading && !list.length && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <p className="text-sm text-slate-400">요청이 없습니다.</p>
            </div>
          )}

          <div className="space-y-2">
            {list.map(r => {
              const st = ST[r.status] || ST['요청']
              const d = dday(r.need_date)
              const enough = Number(r.stock_qty) >= Number(r.qty)
              return (
                <div key={r.id}
                  onClick={() => canEdit && setSel(s => ({ ...s, [r.id]: !s[r.id] }))}
                  className={`rounded-xl border p-3.5 transition-all ${canEdit ? 'cursor-pointer' : ''} ${
                    sel[r.id] ? 'border-indigo-400 bg-indigo-50/50 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:shadow-sm'}`}>
                  <div className="flex items-start gap-3">
                    <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${st.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${st.cls}`}>{r.status}</span>
                        {r.urgency === '긴급' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white">긴급</span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">{r.req_no}</span>
                        {r.is_mine && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">내 요청</span>
                        )}
                        {r.customer_code && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">{r.customer_code}</span>
                        )}
                        {d !== null && (
                          <span className={`text-[11px] font-bold ${d < 0 ? 'text-rose-600' : d <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                            필요일 {r.need_date} (D{d >= 0 ? '-' : '+'}{Math.abs(d)})
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-bold text-slate-800 mt-1">
                        {r.std_code && <span className="font-mono text-indigo-600 mr-1.5">{r.std_code}</span>}
                        {r.item_name}
                        <span className="ml-1.5 text-slate-500">{n(r.qty)}{r.unit}</span>
                      </p>

                      <p className="text-xs text-slate-500 mt-0.5">{r.purpose}</p>
                      {(r.product_code || r.unit_no) && (
                        <p className="text-[11px] text-slate-400">
                          {r.product_code && <span className="font-mono">{r.product_code}</span>}
                          {r.product_code && r.unit_no ? ' · ' : ''}{r.unit_no}
                        </p>
                      )}
                      {r.reason && <p className="text-[11px] text-slate-400 mt-0.5">사유 · {r.reason}</p>}

                      {/* 담당자 판단 근거 */}
                      {r.item_id && (
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${enough
                            ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            재고 {n(r.stock_qty)}{r.stock_loc ? ` @ ${r.stock_loc}` : ''}
                            {enough ? ' · 불출 가능' : ' · 부족'}
                          </span>
                          {Number(r.po_pending) > 0 && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-700">
                              발주 잔량 {n(r.po_pending)}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-500">요청 {r.requester}</span>
                        <span>{r.req_date}</span>
                        {r.handler && (
                          <>
                            <span className="text-slate-300">→</span>
                            <span className="font-semibold text-slate-500">처리 {r.handler}</span>
                            {r.handle_type && (
                              <span className={`px-1.5 py-0.5 rounded font-bold ${
                                r.handle_type === '불출' ? 'bg-emerald-100 text-emerald-700'
                                : r.handle_type === '발주' ? 'bg-indigo-100 text-indigo-700'
                                : 'bg-slate-100 text-slate-500'}`}>{r.handle_type}</span>
                            )}
                          </>
                        )}
                        {r.handle_memo && <span className="text-slate-400">· {r.handle_memo}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      {canEdit && (
                        <input type="checkbox" checked={!!sel[r.id]} readOnly
                          className="w-4 h-4 accent-indigo-600 mt-1 pointer-events-none" />
                      )}
                      {r.is_mine && ['요청','확인'].includes(r.status) && (
                        <button onClick={e => { e.stopPropagation(); cancelMine(r.id) }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-500 whitespace-nowrap">
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
