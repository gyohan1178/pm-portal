import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import { useCanEdit } from '../../hooks/useProfile'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const today = () => new Date().toISOString().slice(0, 10)
const MONO = "ui-monospace, Menlo, Consolas, monospace"

// 브랜드 → 품목 → 로트 3단계로 묶는다.
// 로트가 쭉 나열되면 같은 품목 것이 흩어져 무엇을 먼저 쓸지 알기 어렵다.
function groupLots(lots) {
  const byBrand = new Map()
  lots.forEach(l => {
    const b = (l.maker || '기타').trim() || '기타'
    if (!byBrand.has(b)) byBrand.set(b, new Map())
    const items = byBrand.get(b)
    const code = l.std_code || '(미상)'
    if (!items.has(code)) {
      items.set(code, { code, name: l.item_name || '', makerCode: l.maker_code || '', rows: [] })
    }
    items.get(code).rows.push(l)
  })

  return [...byBrand.entries()]
    .map(([name, itemMap]) => {
      const items = [...itemMap.values()].map(it => ({
        ...it,
        // 오래된 것부터 — 먼저 써야 할 순서
        rows: it.rows.slice().sort((a, b) => (a.fifo_rank || 0) - (b.fifo_rank || 0)),
        left: it.rows.reduce((s2, r) => s2 + (Number(r.qty_left) || 0), 0),
      })).sort((a, b) => a.code.localeCompare(b.code))

      return {
        name, items,
        lots: items.reduce((s2, it) => s2 + it.rows.length, 0),
        qty: items.reduce((s2, it) => s2 + it.left, 0),
        expired: items.reduce((s2, it) => s2 + it.rows.filter(r => r.expired).length, 0),
      }
    })
    // 기한 초과가 있는 브랜드를 위로
    .sort((a, b) => (b.expired > 0) - (a.expired > 0) || a.name.localeCompare(b.name))
}

// 로트 관리.
//
//   시리얼·제조년월을 관리해야 하는 품목(BECKHOFF·ROOTECH·Allen-Bradley 등)의
//   입고 묶음을 기록하고, 선입선출과 사용 기한을 관리한다.
//
//   개별 개체가 아니라 로트 단위다. 한 시리얼에 30~100개씩 들어오므로
//   개체마다 추적하면 입력 부담만 크고 실익이 적다.
//   한 품목에 시리얼이 여러 개 있을 수 있어 품목당 여러 로트를 갖는다.
//
//   호기별 사용 이력은 현장에서 별도로 관리하므로 여기서는 다루지 않는다.
//   창고에 무엇이 언제 들어왔고 무엇을 먼저 써야 하는지에 집중한다.
export default function LotManage() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [tab, setTab] = useState('list')      // list | add
  const [onlyLeft, setOnlyLeft] = useState(true)
  const [q, setQ] = useState('')

  // ── 로트 목록 ──
  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['lotList', onlyLeft],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_lot_list',
        { p_item_id: null, p_only_left: onlyLeft })
      if (error) throw error
      return data || []
    },
    staleTime: 60 * 1000,
  })

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return lots
    return lots.filter(l =>
      `${l.std_code || ''} ${l.item_name || ''} ${l.serial_no || ''} ${l.maker || ''} ${l.maker_code || ''}`
        .toLowerCase().includes(t))
  }, [lots, q])

  const stat = useMemo(() => ({
    total: lots.length,
    expired: lots.filter(l => l.expired).length,
    soon: lots.filter(l => !l.expired && l.shelf_months && l.age_months != null
      && l.age_months >= l.shelf_months - 3).length,
  }), [lots])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🏷 로트 관리</h1>
          <p className="text-xs text-slate-400">
            시리얼·제조년월 관리 품목의 입고 묶음입니다. 오래된 것부터 내보내세요.
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[['list', '📋 로트 목록'],
            ...(canEdit ? [['add', '＋ 로트 등록']] : [])].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg ${
                tab === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {tab === 'list' && (
        <LotList lots={shown} all={lots} stat={stat} isLoading={isLoading}
          q={q} setQ={setQ} onlyLeft={onlyLeft} setOnlyLeft={setOnlyLeft} />
      )}
      {tab === 'add' && canEdit && <LotAdd onDone={() => {
        qc.invalidateQueries({ queryKey: ['lotList'] }); setTab('list')
      }} />}
    </div>
  )
}


// ───────────────────────── 목록 ─────────────────────────
function LotList({ lots, all, stat, isLoading, q, setQ, onlyLeft, setOnlyLeft }) {
  function exportXl() {
    if (!lots.length) { toastError('내보낼 로트가 없습니다'); return }
    const rows = lots.map(l => ({
      '기준코드': l.std_code || '', '품명': l.item_name || '',
      '제조사': l.maker || '', '제조사품번': l.maker_code || '',
      '시리얼': l.serial_no || '', '제조': l.made_ym || '',
      '입고일': l.in_date || '', '구매처': l.vendor_name || '',
      '입고수량': Number(l.qty_in) || 0,
      '사용': Number(l.qty_used) || 0,
      '잔량': Number(l.qty_left) || 0,
      '경과(개월)': l.age_months ?? '',
      '사용기한(개월)': l.shelf_months ?? '',
      '상태': l.expired ? '기한 초과' : '사용 가능',
      '비고': l.memo || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
                   { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 9 }, { wch: 8 },
                   { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 18 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '로트')
    XLSX.writeFile(wb, `로트목록_${today()}.xlsx`)
    toastSuccess(`${n(rows.length)}건 내보냄`)
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-bold text-slate-400">전체 로트</p>
          <p className="text-2xl font-bold text-slate-800">{n(stat.total)}</p>
        </div>
        <div className={`rounded-xl border p-3 ${stat.soon ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <p className={`text-[11px] font-bold ${stat.soon ? 'text-amber-600' : 'text-slate-400'}`}>기한 임박</p>
          <p className={`text-2xl font-bold ${stat.soon ? 'text-amber-700' : 'text-slate-300'}`}>{n(stat.soon)}</p>
          <p className="text-[10px] text-slate-400">3개월 이내</p>
        </div>
        <div className={`rounded-xl border p-3 ${stat.expired ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'}`}>
          <p className={`text-[11px] font-bold ${stat.expired ? 'text-rose-600' : 'text-slate-400'}`}>기한 초과</p>
          <p className={`text-2xl font-bold ${stat.expired ? 'text-rose-700' : 'text-slate-300'}`}>{n(stat.expired)}</p>
          <p className="text-[10px] text-slate-400">사용 금지</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="기준코드·품명·시리얼·제조사 검색"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-200 rounded-lg" />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={onlyLeft} onChange={e => setOnlyLeft(e.target.checked)}
            className="w-3.5 h-3.5 accent-indigo-600" />
          잔량 있는 것만
        </label>
        <span className="text-xs text-slate-400">{n(lots.length)}건</span>
        <button onClick={exportXl}
          className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">
          📥 엑셀
        </button>
      </div>

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !lots.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-400">등록된 로트가 없습니다.</p>
        </div>
      )}

      {/* 브랜드 → 품목 → 로트 3단계.
          같은 품목의 로트가 흩어져 보이면 무엇을 먼저 쓸지 알기 어렵다. */}
      <div className="space-y-4">
        {groupLots(lots).map(brand => (
          <div key={brand.name}>
            <div className="flex items-baseline gap-2 mb-1.5 px-0.5">
              <h3 className="text-sm font-bold text-slate-700">{brand.name}</h3>
              <span className="text-[11px] text-slate-400">
                {n(brand.items.length)}품목 · {n(brand.lots)}로트 · {n(brand.qty)}개
              </span>
              {brand.expired > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-[10px] font-bold text-rose-700">
                  기한초과 {brand.expired}
                </span>
              )}
            </div>

            <div className="space-y-2">
              {brand.items.map(it => (
                <div key={it.code} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-100">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-indigo-600">{it.code}</span>
                      <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">{it.name}</span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        {it.rows.length}로트 · 잔 {n(it.left)}
                      </span>
                    </div>
                    {it.makerCode && (
                      <p className="text-[11px] text-slate-400" style={{ fontFamily: MONO }}>{it.makerCode}</p>
                    )}
                  </div>

                  <div className="divide-y divide-slate-50">
                    {it.rows.map(l => (
                      <div key={l.id}
                        className={`px-3.5 py-2.5 flex items-center gap-3 flex-wrap ${
                          l.expired ? 'bg-rose-50/60' : ''}`}>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {l.fifo_rank === 1 && Number(l.qty_left) > 0 && !l.expired && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">
                              먼저
                            </span>
                          )}
                          {l.expired && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                              기한
                            </span>
                          )}
                          <span className="text-base font-bold text-slate-800" style={{ fontFamily: MONO }}>
                            {l.serial_no}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                          {l.made_ym || '제조 미상'}
                          {l.age_months != null && (
                            <span className="text-slate-400 font-normal"> · {l.age_months}개월</span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap">
                          입고 {l.in_date}{l.vendor_name ? ` · ${l.vendor_name}` : ''}
                        </span>
                        <span className="ml-auto text-xs whitespace-nowrap">
                          <b className={Number(l.qty_left) > 0 ? 'text-slate-800' : 'text-slate-300'}>
                            {n(l.qty_left)}
                          </b>
                          <span className="text-slate-300"> / {n(l.qty_in)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

    </>
  )
}


// ───────────────────────── 등록 ─────────────────────────
function LotAdd({ onDone }) {
  const [rows, setRows] = useState([blank()])
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState(null)
  const [sq, setSq] = useState('')
  const [hits, setHits] = useState([])
  const timer = useRef(null)

  function blank() {
    return { key: Math.random().toString(36).slice(2), item_id: null, std_code: '', item_name: '',
             maker: '', serial_no: '', made_ym: '', qty_in: '', in_date: today(), vendor_name: '', memo: '' }
  }

  const searchItem = useCallback((v) => {
    setSq(v)
    clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); return }
    timer.current = setTimeout(async () => {
      const t = v.trim()
      const { data } = await supabase.from('items')
        .select('id,std_code,name,manufacturer,manufacturer_code,lot_managed,shelf_months')
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%,spec.ilike.%${t}%`)
        .limit(15)
      setHits(data || [])
    }, 300)
  }, [])

  // 시리얼을 넣으면 제조 표기를 자동으로 채운다
  async function autoMade(i, serial, maker) {
    if (!serial?.trim()) return
    const { data } = await supabase.rpc('pm_parse_made',
      { p_maker: maker || '', p_raw: serial.trim() })
    const r = Array.isArray(data) ? data[0] : data
    if (r?.made_ym) {
      setRows(v => v.map((x, k) => k === i && !x.made_ym ? { ...x, made_ym: r.made_ym } : x))
    }
  }

  async function submit() {
    const valid = rows.filter(r => r.item_id && r.serial_no.trim() && Number(r.qty_in) > 0)
    if (!valid.length) { toastError('품목·시리얼·수량을 입력하세요'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_lot_add', {
        p_rows: valid.map(r => ({
          item_id: r.item_id, serial_no: r.serial_no.trim(),
          made_ym: r.made_ym.trim() || null,
          qty_in: Number(r.qty_in), in_date: r.in_date || null,
          vendor_name: r.vendor_name.trim() || null, memo: r.memo.trim() || null,
        })),
      })
      if (error) throw error
      toastSuccess(`${n(data)}건 등록`)
      setRows([blank()])
      onDone?.()
    } catch (e) { toastError('등록 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
        <p className="text-sm font-bold text-indigo-800 mb-1.5">제조 표기는 자동으로 채워집니다</p>
        <div className="grid sm:grid-cols-3 gap-2 text-xs text-indigo-700">
          <p><b>BECKHOFF</b><br />5125B309 → 25년 51주</p>
          <p><b>Allen-Bradley</b><br />WEEK48.2024 → 24년 48주</p>
          <p><b>ROOTECH</b><br />2026/07 → 26년 07월</p>
        </div>
        <p className="text-[11px] text-indigo-600 mt-2">
          자동으로 안 채워지면 직접 넣으세요. ROOTECH 는 제품 본체 라벨을 확인해야 합니다.
        </p>
      </div>

      {rows.map((r, i) => (
        <div key={r.key} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
          <div className="flex items-start gap-2">
            {r.item_id ? (
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-bold text-indigo-600">{r.std_code}</p>
                <p className="text-xs text-slate-600">{r.item_name}</p>
                <p className="text-[11px] text-slate-400">{r.maker}</p>
              </div>
            ) : (
              <button onClick={() => { setPick(i); setSq(''); setHits([]) }}
                className="flex-1 px-3 py-2.5 text-sm text-left border-2 border-dashed border-slate-300
                  rounded-lg text-slate-400 hover:border-indigo-400">
                🔍 품목 찾기
              </button>
            )}
            {rows.length > 1 && (
              <button onClick={() => setRows(v => v.filter((_, k) => k !== i))}
                className="text-slate-300 hover:text-rose-500 px-1 pt-2">✕</button>
            )}
          </div>

          {r.item_id && (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">시리얼 *</label>
                  <input value={r.serial_no}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, serial_no: e.target.value.toUpperCase() } : x))}
                    onBlur={e => autoMade(i, e.target.value, r.maker)}
                    placeholder="5125B309"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    style={{ fontFamily: MONO }} />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">제조 (자동)</label>
                  <input value={r.made_ym}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, made_ym: e.target.value } : x))}
                    placeholder="25년 51주"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">수량 *</label>
                  <input type="number" value={r.qty_in}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, qty_in: e.target.value } : x))}
                    className="w-full px-3 py-2 text-sm text-right font-bold border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">입고일</label>
                  <input type="date" value={r.in_date}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, in_date: e.target.value } : x))}
                    className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">구매처</label>
                  <input value={r.vendor_name}
                    onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, vendor_name: e.target.value } : x))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
              <input value={r.memo}
                onChange={e => setRows(v => v.map((x, k) => k === i ? { ...x, memo: e.target.value } : x))}
                placeholder="비고 (선택)"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg" />
            </>
          )}
        </div>
      ))}

      <button onClick={() => setRows(v => [...v, blank()])}
        className="w-full py-2.5 text-sm font-bold rounded-xl border-2 border-dashed border-slate-300 text-slate-500">
        ＋ 로트 추가
      </button>
      <button onClick={submit} disabled={busy}
        className="w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white disabled:opacity-40">
        {busy ? '등록 중…' : '로트 등록'}
      </button>

      {pick !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setPick(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-slate-800">품목 찾기</h3>
              <button onClick={() => setPick(null)} className="text-slate-400 text-xl px-2">✕</button>
            </div>
            <input value={sq} onChange={e => searchItem(e.target.value)} autoFocus
              placeholder="기준코드 · 품명 · 제조사품번 (2자 이상)"
              className="w-full px-3 py-2.5 text-sm border-2 border-slate-200 rounded-lg" />
            <div className="mt-2 space-y-1">
              {hits.map(it => (
                <button key={it.id}
                  onClick={() => {
                    setRows(v => v.map((x, k) => k === pick ? {
                      ...x, item_id: it.id, std_code: it.std_code,
                      item_name: it.name, maker: it.manufacturer || '',
                    } : x))
                    setPick(null); setSq(''); setHits([])
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-indigo-50">
                  <p className="font-mono text-sm font-bold text-indigo-600">
                    {it.std_code}
                    {it.lot_managed && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-100 text-[10px]">로트관리</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-600">{it.name}</p>
                  <p className="text-[11px] text-slate-400">{it.manufacturer}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
