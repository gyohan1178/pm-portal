import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import { useCanEdit } from '../../hooks/useProfile'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const today = () => new Date().toISOString().slice(0, 10)
const MONO = "ui-monospace, Menlo, Consolas, monospace"

// 브랜드를 두 칸으로 나눈다.
//   BECKHOFF 는 형번이 넷이라 왼쪽을 통째로 쓰고,
//   나머지 셋은 오른쪽에 세로로 쌓아 한 화면에 담는다.
function splitByBrand(rows) {
  const by = new Map()
  rows.forEach(r => {
    const b = (r.maker || '기타').trim() || '기타'
    if (!by.has(b)) by.set(b, [])
    by.get(b).push(r)
  })
  const main = []      // 왼쪽 — 품목이 가장 많은 브랜드
  const rest = []      // 오른쪽 — 나머지
  const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length)
  sorted.forEach(([name, items], i) => {
    (i === 0 ? main : rest).push({ name, items })
  })
  return { main, rest }
}

// 로트 관리.
//
//   시리얼과 보증기간을 관리해야 하는 품목은 여덟 종뿐이다.
//   그래서 목록을 훑는 표가 아니라 품목마다 카드를 두어,
//   "무엇부터 써야 하는지" 를 맨 앞에 보여준다.
//
//   보증은 입고일(거래명세서 작성일) 기준이며 형번마다 기간이 다르다.
//     BECKHOFF·SCHISCHEK·KEYENCE  1년
//     ROOTECH ACCURA MD-GAS       2년
export default function LotManage() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [openItem, setOpenItem] = useState(null)   // 펼친 품목
  const [addFor, setAddFor] = useState(null)       // 로트 등록 대상

  const { data: sum = [], isLoading } = useQuery({
    queryKey: ['lotSummary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_lot_summary')
      if (error) throw error
      return data || []
    },
    staleTime: 60 * 1000,
  })

  const { data: lots = [] } = useQuery({
    queryKey: ['lotList'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_lot_list',
        { p_item_id: null, p_only_left: true })
      if (error) throw error
      return data || []
    },
    staleTime: 60 * 1000,
  })

  const byItem = useMemo(() => {
    const m = {}
    lots.forEach(l => { (m[l.item_id] ||= []).push(l) })
    return m
  }, [lots])

  const stat = useMemo(() => ({
    items: sum.length,
    expired: sum.reduce((s, x) => s + Number(x.expired_cnt || 0), 0),
    soon: sum.reduce((s, x) => s + Number(x.soon_cnt || 0), 0),
  }), [sum])

  function exportXl() {
    if (!lots.length) { toastError('내보낼 로트가 없습니다'); return }
    const rows = lots.map(l => ({
      '기준코드': l.std_code || '', '품명': l.item_name || '',
      '제조사': l.maker || '', '형번': l.maker_code || '',
      '시리얼': l.serial_no || '', '제조': l.made_ym || '',
      '입고일': l.in_date || '', '구매처': l.vendor_name || '',
      '보증(개월)': l.shelf_months ?? '',
      '만료일': l.expire_date || '',
      '남은일수': l.days_left ?? '',
      '입고수량': Number(l.qty_in) || 0,
      '잔량': Number(l.qty_left) || 0,
      '상태': l.expired ? '기한 초과' : (l.days_left <= 90 ? '임박' : '사용 가능'),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 13 }, { wch: 14 }, { wch: 13 },
                   { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 11 },
                   { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '로트')
    XLSX.writeFile(wb, `로트현황_${today()}.xlsx`)
    toastSuccess(`${n(rows.length)}건 내보냄`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🏷 로트 관리</h1>
          <p className="text-xs text-slate-400">
            보증기간이 있는 품목입니다. 오래 있은 것부터 내보내세요.
          </p>
        </div>
        <div className="flex gap-1.5">
          {canEdit && (
            <button onClick={() => setAddFor({})}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white">
              ＋ 로트 등록
            </button>
          )}
          <button onClick={exportXl}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">
            📥 엑셀
          </button>
        </div>
      </div>

      {(stat.expired > 0 || stat.soon > 0) && (
        <div className="flex gap-2 flex-wrap">
          {stat.expired > 0 && (
            <div className="flex-1 min-w-[160px] rounded-xl border-2 border-rose-300 bg-rose-50 px-3.5 py-2.5">
              <p className="text-xs font-bold text-rose-700">
                기한 초과 {stat.expired}건 — 사용하지 마세요
              </p>
            </div>
          )}
          {stat.soon > 0 && (
            <div className="flex-1 min-w-[160px] rounded-xl border-2 border-amber-300 bg-amber-50 px-3.5 py-2.5">
              <p className="text-xs font-bold text-amber-700">
                3개월 내 만료 {stat.soon}건 — 먼저 쓰세요
              </p>
            </div>
          )}
        </div>
      )}

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !sum.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500 font-semibold">등록된 로트가 없습니다</p>
          <p className="text-xs text-slate-400 mt-1">
            입고할 때 ＋ 로트 등록으로 시리얼을 기록하세요
          </p>
        </div>
      )}

      {/* 브랜드 두 칸 — 왼쪽에 형번이 많은 브랜드, 오른쪽에 나머지 */}
      {(() => {
        const { main, rest } = splitByBrand(sum)
        const card = (s) => {
          const open = openItem === s.item_id
          const rows = byItem[s.item_id] || []
          const days = s.next_days
          const urgent = Number(s.expired_cnt) > 0
          const soon = !urgent && days != null && days <= 90
          return (
            <div key={s.item_id}
              className={`rounded-xl border-2 overflow-hidden ${
                urgent ? 'border-rose-300' : soon ? 'border-amber-300' : 'border-slate-200'}`}>

              {/* 머리 — 먼저 쓸 것 */}
              <div className="bg-white px-4 py-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-800"
                        style={{ fontFamily: MONO }}>{s.maker_code || s.std_code}</span>
                      <span className="text-[11px] text-slate-400">{s.maker}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                        보증 {s.shelf_months}개월
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{s.item_name}</p>
                  </div>

                  <div className="text-right">
                    <p className="text-[11px] text-slate-400">잔량</p>
                    <p className="text-lg font-bold text-slate-800">{n(s.total_left)}</p>
                    <p className="text-[10px] text-slate-400">{s.lot_cnt}개 로트</p>
                  </div>
                </div>

                {/* 먼저 쓸 로트 — 가장 크게 */}
                {s.next_serial && (
                  <div className={`mt-2.5 rounded-lg px-3.5 py-2.5 flex items-center gap-3 flex-wrap ${
                    urgent ? 'bg-rose-600' : soon ? 'bg-amber-500' : 'bg-slate-800'}`}>
                    <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-bold text-white">
                      {urgent ? '기한 초과' : '먼저 사용'}
                    </span>
                    <span className="text-lg font-bold text-white" style={{ fontFamily: MONO }}>
                      {s.next_serial}
                    </span>
                    <span className="text-xs text-white/80">
                      {n(s.next_qty)}개
                    </span>
                    <span className="ml-auto text-xs text-white/90 whitespace-nowrap">
                      {s.next_expire && (
                        <>
                          {s.next_expire} 까지
                          {days != null && (
                            <b className="ml-1.5">
                              {days < 0 ? `${-days}일 지남` : `${days}일`}
                            </b>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                )}

                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => setOpenItem(open ? null : s.item_id)}
                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500">
                    {open ? '접기 ▲' : `로트 ${s.lot_cnt}개 보기 ▼`}
                  </button>
                  {canEdit && (
                    <button onClick={() => setAddFor({
                        item_id: s.item_id, std_code: s.std_code,
                        item_name: s.item_name, maker: s.maker, maker_code: s.maker_code })}
                      className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50">
                      ＋ 이 품목 로트 추가
                    </button>
                  )}
                </div>
              </div>

              {/* 상세 — 펼쳤을 때 */}
              {open && (
                <div className="border-t border-slate-100 divide-y divide-slate-50 bg-slate-50/50">
                  {rows.map(l => (
                    <div key={l.id}
                      className={`px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs ${
                        l.expired ? 'bg-rose-50/60' : ''}`}>
                      <span className="w-6 text-center text-[10px] font-bold text-slate-400">
                        {l.fifo_rank}
                      </span>
                      <span className="text-sm font-bold text-slate-800 w-28" style={{ fontFamily: MONO }}>
                        {l.serial_no}
                      </span>
                      <span className="text-slate-500 w-24">
                        입고 {l.in_date}
                      </span>
                      <span className={`w-32 font-semibold ${
                        l.expired ? 'text-rose-600' : l.days_left <= 90 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {l.expire_date} 까지
                      </span>
                      <span className="text-slate-400 w-20">
                        {l.made_ym || '제조 미상'}
                      </span>
                      <span className="ml-auto">
                        <b className="text-slate-800">{n(l.qty_left)}</b>
                        <span className="text-slate-300"> / {n(l.qty_in)}</span>
                      </span>
                      {l.vendor_name && (
                        <span className="text-[10px] text-slate-400 w-16 text-right">{l.vendor_name}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        }
        // 브랜드 머리 + 그 아래 품목 카드들
        const group = (g) => (
          <div key={g.name} className="space-y-2">
            <div className="flex items-baseline gap-2 px-0.5">
              <h3 className="text-sm font-bold text-slate-700">{g.name}</h3>
              <span className="text-[11px] text-slate-400">{g.items.length}종</span>
            </div>
            {g.items.map(card)}
          </div>
        )
        return (
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <div className="space-y-4">{main.map(group)}</div>
            <div className="space-y-4">{rest.map(group)}</div>
          </div>
        )
      })()}

      {addFor && (
        <LotAdd preset={addFor} onClose={() => setAddFor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['lotSummary'] })
            qc.invalidateQueries({ queryKey: ['lotList'] })
            setAddFor(null)
          }} />
      )}
    </div>
  )
}


// ───────────────────────── 등록 ─────────────────────────
//   입고하면서 바로 넣으므로, 품목을 고르면 시리얼·수량만 치면 되게 했다.
function LotAdd({ preset, onClose, onDone }) {
  const [item, setItem] = useState(preset?.item_id ? preset : null)
  const [serial, setSerial] = useState('')
  const [madeYm, setMadeYm] = useState('')
  const [qty, setQty] = useState('')
  const [inDate, setInDate] = useState(today())
  const [vendor, setVendor] = useState('')
  const [busy, setBusy] = useState(false)
  const [sq, setSq] = useState('')
  const [hits, setHits] = useState([])
  const timer = useRef(null)
  const serialRef = useRef(null)

  const search = useCallback((v) => {
    setSq(v)
    clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); return }
    timer.current = setTimeout(async () => {
      const t = v.trim()
      const { data } = await supabase.from('items')
        .select('id,std_code,name,manufacturer,manufacturer_code,shelf_months,lot_managed')
        .eq('lot_managed', true)
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%`)
        .limit(10)
      setHits(data || [])
    }, 250)
  }, [])

  // 시리얼에서 제조 시기를 자동으로 뽑는다
  async function autoMade(v) {
    if (!v?.trim() || madeYm) return
    try {
      const { data } = await supabase.rpc('pm_parse_made',
        { p_maker: item?.maker || item?.manufacturer || '', p_raw: v.trim() })
      const r = Array.isArray(data) ? data[0] : data
      if (r?.made_ym) setMadeYm(r.made_ym)
    } catch { /* 자동 변환 실패는 넘어간다 */ }
  }

  async function submit() {
    if (!item?.item_id && !item?.id) { toastError('품목을 고르세요'); return }
    if (!serial.trim()) { toastError('시리얼을 입력하세요'); return }
    if (!(Number(qty) > 0)) { toastError('수량을 입력하세요'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_lot_add', {
        p_rows: [{
          item_id: item.item_id || item.id,
          serial_no: serial.trim(),
          made_ym: madeYm.trim() || null,
          qty_in: Number(qty),
          in_date: inDate || null,
          vendor_name: vendor.trim() || null,
        }],
      })
      if (error) throw error
      toastSuccess(`${n(data)}건 등록`)
      // 같은 품목으로 이어서 넣는 경우가 많다
      setSerial(''); setMadeYm(''); setQty('')
      serialRef.current?.focus()
      onDone?.()
    } catch (e) { toastError('등록 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  const mk = item?.maker || item?.manufacturer
  const mkc = item?.maker_code || item?.manufacturer_code

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800">로트 등록</h3>
          <button onClick={onClose} className="text-slate-400 text-xl px-2">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {/* 품목 */}
          {item ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-indigo-800" style={{ fontFamily: MONO }}>
                    {mkc || item.std_code}
                  </p>
                  <p className="text-xs text-indigo-600 truncate">{item.item_name || item.name}</p>
                  <p className="text-[11px] text-indigo-500">
                    {mk}
                    {item.shelf_months ? ` · 보증 ${item.shelf_months}개월` : ''}
                  </p>
                </div>
                <button onClick={() => { setItem(null); setSq(''); setHits([]) }}
                  className="text-indigo-400 text-xs px-1">변경</button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">품목 *</label>
              <input value={sq} onChange={e => search(e.target.value)} autoFocus
                placeholder="형번 · 품명으로 검색 (2자 이상)"
                className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg" />
              <p className="text-[11px] text-slate-400 mt-1">로트 관리 대상 품목만 나옵니다</p>
              <div className="mt-1.5 space-y-1">
                {hits.map(it => (
                  <button key={it.id}
                    onClick={() => { setItem(it); setSq(''); setHits([]); setTimeout(()=>serialRef.current?.focus(),50) }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-indigo-50">
                    <p className="text-sm font-bold text-indigo-600" style={{ fontFamily: MONO }}>
                      {it.manufacturer_code || it.std_code}
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-500">
                        {it.shelf_months}개월
                      </span>
                    </p>
                    <p className="text-xs text-slate-600 truncate">{it.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {item && (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">시리얼 *</label>
                <input ref={serialRef} value={serial}
                  onChange={e => setSerial(e.target.value.toUpperCase())}
                  onBlur={e => autoMade(e.target.value)}
                  placeholder="5125B309"
                  className="w-full px-3 py-3 text-lg font-bold border-2 border-slate-200 rounded-lg"
                  style={{ fontFamily: MONO }} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">수량 *</label>
                  <input type="number" min="1" value={qty}
                    onChange={e => setQty(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    className="w-full px-3 py-3 text-lg text-right font-bold border-2 border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">입고일</label>
                  <input type="date" value={inDate} onChange={e => setInDate(e.target.value)}
                    className="w-full px-2 py-3 text-sm border-2 border-slate-200 rounded-lg" />
                  <p className="text-[10px] text-slate-400 mt-0.5">보증 시작 기준</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">제조 (자동)</label>
                  <input value={madeYm} onChange={e => setMadeYm(e.target.value)}
                    placeholder="25년 51주"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">구매처</label>
                  <input value={vendor} onChange={e => setVendor(e.target.value)}
                    placeholder="송원"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>

              <button onClick={submit} disabled={busy}
                className="w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white disabled:opacity-40">
                {busy ? '등록 중…' : '등록하고 이어서 입력'}
              </button>
              <p className="text-[11px] text-slate-400 text-center">
                등록 후 시리얼·수량만 지워져 같은 품목을 이어서 넣을 수 있습니다
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
