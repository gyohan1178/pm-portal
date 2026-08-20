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
  // 여러 품목을 동시에 펼쳐 둘 수 있어야 비교하며 볼 수 있다
  const [openItems, setOpenItems] = useState({})
  const [addFor, setAddFor] = useState(null)       // 로트 등록 대상
  const [editLot, setEditLot] = useState(null)     // 수정할 로트
  const [shelfFor, setShelfFor] = useState(null)   // 보증기간 고칠 품목
  const [showDone, setShowDone] = useState(false)  // 소진분 포함

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
    queryKey: ['lotList', showDone],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_lot_list',
        { p_item_id: null, p_only_left: !showDone })
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

  function refresh() {
    qc.invalidateQueries({ queryKey: ['lotSummary'] })
    qc.invalidateQueries({ queryKey: ['lotList'], exact: false })
  }

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
          <button onClick={() => setOpenItems(
              Object.keys(openItems).some(k => openItems[k])
                ? {}
                : Object.fromEntries(sum.map(x => [x.item_id, true])))}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">
            {Object.keys(openItems).some(k => openItems[k]) ? '모두 접기' : '모두 펼치기'}
          </button>
          <label className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)}
              className="w-3.5 h-3.5 accent-indigo-600" />
            소진분 포함
          </label>
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
          const open = !!openItems[s.item_id]
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
                      {canEdit ? (
                        <button onClick={() => setShelfFor(s)}
                          title="보증기간 수정"
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            s.shelf_months ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                           : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                          {s.shelf_months ? `보증 ${s.shelf_months}개월` : '⚠ 보증기간 미설정'}
                        </button>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                          {s.shelf_months ? `보증 ${s.shelf_months}개월` : '보증 미설정'}
                        </span>
                      )}
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
                  <button onClick={() => setOpenItems(v => ({ ...v, [s.item_id]: !v[s.item_id] }))}
                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500">
                    {open ? '접기 ▲' : `로트 ${s.lot_cnt}개 보기 ▼`}
                    {Number(s.done_cnt) > 0 && (
                      <span className="ml-1 text-slate-400">· 소진 {s.done_cnt}</span>
                    )}
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
                      className={`px-4 py-2.5 text-xs ${
                        Number(l.qty_left) <= 0 ? 'bg-slate-100/70 text-slate-400'
                          : l.expired ? 'bg-rose-50/60' : ''}`}>
                      {/* 두 칸 배치라 한 줄에 다 넣으면 가로로 넘친다.
                          시리얼·수량을 위에, 날짜·구매처를 아래에 둔다. */}
                      <div className="flex items-center gap-2">
                        <span className="w-5 text-center text-[10px] font-bold text-slate-400 flex-shrink-0">
                          {l.fifo_rank}
                        </span>
                        <span className="text-sm font-bold text-slate-800 flex-shrink-0"
                          style={{ fontFamily: MONO }}>
                          {l.serial_no}
                        </span>
                        <span className="text-slate-400 whitespace-nowrap">
                          {l.made_ym || '제조 미상'}
                        </span>
                        <span className="ml-auto whitespace-nowrap">
                          <b className="text-slate-800">{n(l.qty_left)}</b>
                          <span className="text-slate-300"> / {n(l.qty_in)}</span>
                        </span>
                        {canEdit && (
                          <button onClick={() => setEditLot(l)}
                            title="수정 · 삭제"
                            className="text-slate-300 hover:text-indigo-600 px-1 flex-shrink-0">✎</button>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 mt-1 pl-7 text-[11px]">
                        <span className="text-slate-500 whitespace-nowrap">
                          입고 {l.in_date}
                        </span>
                        <span className={`whitespace-nowrap font-semibold ${
                          l.expired ? 'text-rose-600' : l.days_left <= 90 ? 'text-amber-600' : 'text-slate-500'}`}>
                          ~ {l.expire_date}
                        </span>
                        <span className="text-slate-400 whitespace-nowrap truncate">
                          입고처 {l.vendor_name || '—'}
                        </span>
                      </div>
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
          onDone={() => { refresh(); setAddFor(null) }} />
      )}
      {editLot && (
        <LotEdit lot={editLot} onClose={() => setEditLot(null)}
          onDone={() => { refresh(); setEditLot(null) }} />
      )}
      {shelfFor && (
        <ShelfEdit item={shelfFor} onClose={() => setShelfFor(null)}
          onDone={() => { refresh(); setShelfFor(null) }} />
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


// ───────────────────────── 로트 수정 ─────────────────────────
//   출고 연동 전까지는 잔량을 손으로 맞춰야 한다.
function LotEdit({ lot, onClose, onDone }) {
  const [qty, setQty] = useState(String(lot.qty_left ?? ''))
  const [serial, setSerial] = useState(lot.serial_no || '')
  const [madeYm, setMadeYm] = useState(lot.made_ym || '')
  const [inDate, setInDate] = useState(lot.in_date || '')
  const [vendor, setVendor] = useState(lot.vendor_name || '')
  const [memo, setMemo] = useState(lot.memo || '')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_lot_update', {
        p_id: lot.id,
        p_qty_left: qty === '' ? null : Number(qty),
        p_serial: serial.trim() || null,
        p_made_ym: madeYm,
        p_in_date: inDate || null,
        p_vendor: vendor,
        p_memo: memo,
      })
      if (error) throw error
      if (data !== 'ok') { toastError(data); return }
      toastSuccess('수정됨')
      onDone?.()
    } catch (e) { toastError('수정 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  async function del() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_lot_delete', { p_id: lot.id })
      if (error) throw error
      if (data !== 'ok') { toastError(data); return }
      toastSuccess('삭제됨')
      onDone?.()
    } catch (e) { toastError('삭제 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">로트 수정</h3>
            <p className="text-[11px] text-slate-400">{lot.std_code} · {lot.item_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl px-2">✕</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <p className="text-[11px] text-amber-800 leading-relaxed">
              출고와 아직 연결되지 않아 잔량이 자동으로 줄지 않습니다.
              실제로 나간 만큼 여기서 맞춰 주세요.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">잔량</label>
              <input type="number" min="0" value={qty}
                onChange={e => setQty(e.target.value)}
                className="w-full px-3 py-3 text-lg text-right font-bold border-2 border-indigo-200 rounded-lg" />
              <p className="text-[10px] text-slate-400 mt-0.5">입고 {n(lot.qty_in)}</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">시리얼</label>
              <input value={serial} onChange={e => setSerial(e.target.value.toUpperCase())}
                className="w-full px-3 py-3 text-sm font-bold border border-slate-200 rounded-lg"
                style={{ fontFamily: MONO }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">입고일</label>
              <input type="date" value={inDate} onChange={e => setInDate(e.target.value)}
                className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
              <p className="text-[10px] text-slate-400 mt-0.5">보증 시작 기준</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">제조</label>
              <input value={madeYm} onChange={e => setMadeYm(e.target.value)}
                placeholder="25년 51주"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">구매처</label>
              <input value={vendor} onChange={e => setVendor(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">비고</label>
              <input value={memo} onChange={e => setMemo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
          </div>

          <button onClick={save} disabled={busy}
            className="w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white disabled:opacity-40">
            {busy ? '저장 중…' : '저장'}
          </button>

          <div className="pt-2 border-t border-slate-100">
            {confirmDel ? (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
                <p className="text-xs font-bold text-rose-700 mb-2">
                  이 로트를 지웁니다. 되돌릴 수 없습니다.
                </p>
                <div className="flex gap-2">
                  <button onClick={del} disabled={busy}
                    className="flex-1 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white">
                    삭제
                  </button>
                  <button onClick={() => setConfirmDel(false)}
                    className="flex-1 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-600">
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)}
                className="w-full py-2 text-xs font-semibold text-rose-500 hover:bg-rose-50 rounded-lg">
                이 로트 삭제
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


// ───────────────────────── 보증기간 ─────────────────────────
function ShelfEdit({ item, onClose, onDone }) {
  const [months, setMonths] = useState(String(item.shelf_months ?? ''))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_lot_set_shelf', {
        p_item_id: item.item_id, p_months: months === '' ? 0 : Number(months),
      })
      if (error) throw error
      if (data !== 'ok') { toastError(data); return }
      toastSuccess('보증기간 저장')
      onDone?.()
    } catch (e) { toastError('저장 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800">보증기간</h3>
          <button onClick={onClose} className="text-slate-400 text-xl px-2">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-800" style={{ fontFamily: MONO }}>
              {item.maker_code || item.std_code}
            </p>
            <p className="text-xs text-slate-500">{item.item_name}</p>
            <p className="text-[11px] text-slate-400">{item.maker}</p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">개월</label>
            <div className="flex gap-1.5">
              {[12, 24, 36].map(m => (
                <button key={m} onClick={() => setMonths(String(m))}
                  className={`flex-1 py-2.5 text-sm font-bold rounded-lg border-2 ${
                    months === String(m) ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                         : 'border-slate-200 text-slate-500'}`}>
                  {m / 12}년
                </button>
              ))}
            </div>
            <input type="number" min="0" value={months}
              onChange={e => setMonths(e.target.value)}
              placeholder="직접 입력"
              className="w-full mt-2 px-3 py-2.5 text-sm text-right border border-slate-200 rounded-lg" />
            <p className="text-[11px] text-slate-400 mt-1">
              입고일(거래명세서 작성일)부터 셉니다. 비우면 기한을 따지지 않습니다.
            </p>
          </div>

          <button onClick={save} disabled={busy}
            className="w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white disabled:opacity-40">
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
