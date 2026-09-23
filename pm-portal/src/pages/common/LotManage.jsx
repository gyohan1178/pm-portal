import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { downloadLotAudit } from '../../lib/lotAuditExcel'
import { toastError, toastSuccess } from '../../lib/toast'
import { useCanEdit } from '../../hooks/useProfile'
import { todayISO } from '../../lib/utils'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const today = () => todayISO()
const MONO = "ui-monospace, Menlo, Consolas, monospace"

// 제조사 색 — 이름 글자로 정하므로 제조사가 늘어도 알아서 배정된다.
//   ⚠ 상태(빨강·주황·초록)와 겹치지 않는 색만 쓴다. 상태는 왼쪽 막대, 제조사는 이름표다.
const MAKER_TONE = [
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-teal-100 text-teal-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-blue-100 text-blue-700',
  'bg-cyan-100 text-cyan-700',
  'bg-purple-100 text-purple-700',
  'bg-indigo-100 text-indigo-700',
]
const makerTone = (name) => {
  const k = String(name || '기타')
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 9973
  return MAKER_TONE[h % MAKER_TONE.length]
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
  const [q, setQ] = useState('')                   // 품번·형번·제조사·시리얼로 찾기
  const [only, setOnly] = useState('')             // '' | 초과 | 임박 | 차이 | 미설정

  // 로트관리 대상 품목 관리.
  //   ⚠ 지금까지 화면에 켜는 곳이 없어 SQL 로 직접 바꿔야 했다.
  const [mgrOpen, setMgrOpen] = useState(false)
  const [mq, setMq] = useState('')
  const [mHits, setMHits] = useState([])
  const mTimer = useRef(null)

  // 대상이 아닌 품목을 찾는다 — 켜려는 것이니 lot_managed 로 거르지 않는다
  const searchAll = useCallback((v) => {
    setMq(v)
    clearTimeout(mTimer.current)
    if (v.trim().length < 2) { setMHits([]); return }
    mTimer.current = setTimeout(async () => {
      const t = v.trim()
      const { data } = await supabase.from('items')
        .select('id,std_code,name,manufacturer,manufacturer_code,shelf_months,lot_managed')
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%`)
        .limit(20)
      setMHits(data || [])
    }, 250)
  }, [])

  const toggleMut = useMutation({
    mutationFn: async ({ id, on, std_code }) => {
      if (!on) {
        // 끄기 전에 남은 로트가 있는지 본다.
        //   화면에 이미 불러온 목록으로 센다 — 조회를 한 번 줄이고 권한도 안 탄다.
        const alive = (byItem[id] || []).filter(l => Number(l.qty_left) > 0)
        if (alive.length && !confirm(
          `${std_code} 에 잔량이 남은 로트가 ${alive.length}건 있습니다.\n\n`
          + '대상에서 빼도 로트 기록은 지워지지 않지만 화면에 보이지 않게 됩니다.\n계속할까요?')) {
          throw new Error('__CANCEL__')
        }
      }
      const { error } = await supabase.from('items').update({ lot_managed: on }).eq('id', id)
      if (error) throw error
      return { std_code, on }
    },
    onSuccess: (r) => {
      toastSuccess(`${r.std_code} · 로트관리 ${r.on ? '대상' : '제외'}`)
      setMHits(h => h.map(x => x.std_code === r.std_code ? { ...x, lot_managed: r.on } : x))
      qc.invalidateQueries({ queryKey: ['lotSummary'] })
      qc.invalidateQueries({ queryKey: ['lotList'] })
    },
    onError: (e) => { if (e.message !== '__CANCEL__') toastError('변경 실패: ' + e.message) },
  })

  // 실사표 — 장부 수치가 서로 맞지 않아 실물을 세야 할 때 쓴다
  const [auditBusy, setAuditBusy] = useState(false)
  async function downloadAudit() {
    setAuditBusy(true)
    try {
      const [a, b] = await Promise.all([
        supabase.rpc('pm_lot_audit_sheet'),
        supabase.rpc('pm_lot_recent_out', { p_since: null }),
      ])
      if (a.error) throw a.error
      if (!a.data?.length) { toastError('로트관리 품목이 없습니다'); return }
      const d = new Date()
      const p2 = x => String(x).padStart(2, '0')
      await downloadLotAudit({
        rows: a.data,
        outs: b.error ? [] : (b.data || []),
        fileName: `로트실사표_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.xlsx`,
      })
      if (b.error) toastError('출고 목록은 담지 못했습니다: ' + b.error.message)
    } catch (e) {
      toastError('실사표 만들기 실패: ' + e.message)
    } finally { setAuditBusy(false) }
  }

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
    gap: sum.filter((x) => Number(x.gap) !== 0).length,
    noShelf: sum.filter((x) => !x.shelf_months).length,
  }), [sum])

  // 급한 것이 위로 — 기한 초과 → 만료가 가까운 것 → 형번 순
  //   품목이 늘어도 맨 위만 보면 「오늘 뭘 먼저 써야 하나」가 나온다.
  const view = useMemo(() => {
    const k = q.trim().toUpperCase()
    const hit = (x) => {
      if (only === '초과' && !(Number(x.expired_cnt) > 0)) return false
      if (only === '임박' && !(x.next_days != null && x.next_days >= 0 && x.next_days <= 90)) return false
      if (only === '차이' && Number(x.gap) === 0) return false
      if (only === '미설정' && x.shelf_months) return false
      if (!k) return true
      // 시리얼로도 찾는다 — 클레임 날 때 「이 로트 어디 있나」를 먼저 보게 된다
      const serials = (byItem[x.item_id] || []).map((l) => l.serial_no).join(' ')
      return [x.maker_code, x.std_code, x.item_name, x.maker, serials]
        .some((v) => String(v || '').toUpperCase().includes(k))
    }
    const rank = (x) => (Number(x.expired_cnt) > 0 ? -1e9 : (x.next_days ?? 1e8))
    return sum.filter(hit).sort((a, b) => rank(a) - rank(b)
      || String(a.maker_code || a.std_code).localeCompare(String(b.maker_code || b.std_code)))
  }, [sum, q, only, byItem])

  async function exportXl() {
    if (!lots.length) { toastError('내보낼 로트가 없습니다'); return }

    // 사용이력 — 소진일과 「누가 언제 썼나」를 내려면 필요하다
    let uses = []
    try {
      const { data, error } = await supabase.rpc('pm_lot_use_list', { p_item_id: null })
      if (error) throw error
      uses = data || []
    } catch { /* 이력이 없어도 현황은 낸다 */ }

    // 로트마다 마지막으로 쓴 날 = 소진일
    const lastUse = {}
    uses.forEach(u => {
      const d = String(u.used_date || '')
      if (!d) return
      if (!lastUse[u.lot_id] || d > lastUse[u.lot_id]) lastUse[u.lot_id] = d
    })
    const useCnt = {}
    uses.forEach(u => { useCnt[u.lot_id] = (useCnt[u.lot_id] || 0) + 1 })

    const rows = lots.map(l => {
      const done = Number(l.qty_left) <= 0
      return {
        '기준코드': l.std_code || '', '품명': l.item_name || '',
        '제조사': l.maker || '', '형번': l.maker_code || '',
        '시리얼': l.serial_no || '', '제조': l.made_ym || '',
        '입고일': l.in_date || '', '구매처': l.vendor_name || '',
        '보증(개월)': l.shelf_months ?? '',
        '만료일': l.expire_date || '',
        '남은일수': l.days_left ?? '',
        '입고수량': Number(l.qty_in) || 0,
        '잔량': Number(l.qty_left) || 0,
        // 소진일은 마지막으로 쓴 날이다. 이력이 없으면 알 수 없다.
        '소진일': done ? (lastUse[l.id] || '(이력 없음)') : '',
        '사용횟수': useCnt[l.id] || 0,
        '상태': done ? '소진'
              : l.expired ? '기한 초과'
              : (l.days_left <= 90 ? '임박' : '사용 가능'),
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 13 }, { wch: 14 }, { wch: 13 },
                   { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 11 },
                   { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 11 }, { wch: 9 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '로트')

    if (uses.length) {
      const ur = uses.map(u => ({
        '기준코드': u.std_code || '', '품명': u.item_name || '',
        '시리얼': u.serial_no || '', '제조': u.made_ym || '',
        '입고일': u.in_date || '',
        '사용일': u.used_date || '', '수량': Number(u.qty) || 0,
        '품번': u.pn || '', '호기': u.hogi || '',
        '내용': u.memo || '',
        '로트 잔량': Number(u.qty_left) || 0,
        '소진': u.is_done ? '소진' : '',
      }))
      const us = XLSX.utils.json_to_sheet(ur)
      us['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 13 }, { wch: 10 }, { wch: 11 },
                     { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 40 },
                     { wch: 10 }, { wch: 8 }]
      XLSX.utils.book_append_sheet(wb, us, '사용이력')
    }

    XLSX.writeFile(wb, `로트현황_${today()}.xlsx`)
    toastSuccess(`${n(rows.length)}건 내보냄`
      + (uses.length ? ` · 사용이력 ${n(uses.length)}건` : ''))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🏷 로트 관리</h1>
          <p className="text-xs text-slate-400">
            보증기간이 있는 품목입니다. 오래 있은 것부터 내보내세요. 급한 것이 맨 위에 옵니다.
          </p>
        </div>
        {/* 매일 쓰는 건 「로트 등록」 하나다. 나머지는 눈에 덜 띄게 둔다. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={downloadAudit} disabled={auditBusy}
            title="실물을 세어 적어 넣는 표 — 로트관리 시작 이후 출고 목록도 함께"
            className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            {auditBusy ? '만드는 중…' : '📋 실사표'}
          </button>
          <button onClick={exportXl}
            className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">📥 엑셀</button>
          {canEdit && (
            <button onClick={() => { setMq(''); setMHits([]); setMgrOpen(true) }}
              title="로트관리할 품목을 고릅니다"
              className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">⚙ 대상 품목</button>
          )}
          <label className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)}
              className="w-3.5 h-3.5 accent-indigo-600" />
            소진분 포함
          </label>
          <button onClick={() => setOpenItems(
              Object.keys(openItems).some(k => openItems[k])
                ? {}
                : Object.fromEntries(view.map(x => [x.item_id, true])))}
            className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            {Object.keys(openItems).some(k => openItems[k]) ? '모두 접기' : '모두 펼치기'}
          </button>
          {canEdit && (
            <button onClick={() => setAddFor({})}
              className="ml-1 px-3.5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              ＋ 로트 등록
            </button>
          )}
        </div>
      </div>

      {/* 지표 — 0이어도 늘 보인다. 아무것도 없으면 「문제없음」인지 「자료가 없는지」 알 수 없다. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          ['기한 초과', stat.expired, '쓰면 안 됩니다', 'rose', '초과'],
          ['3개월 내 만료', stat.soon, '먼저 쓰세요', 'amber', '임박'],
          ['재고와 차이', stat.gap, '로트가 모자라거나 남습니다', 'indigo', '차이'],
          ['보증기간 미설정', stat.noShelf, '만료일을 못 셉니다', 'slate', '미설정'],
        ].map(([t, v, s, tone, key]) => (
          <button key={t} onClick={() => setOnly(only === key ? '' : key)}
            className={`text-left rounded-xl border-2 px-3.5 py-2.5 transition ${
              only === key ? 'ring-2 ring-offset-1 ring-indigo-300 ' : ''}${
              v > 0
                ? { rose: 'border-rose-300 bg-rose-50', amber: 'border-amber-300 bg-amber-50',
                    indigo: 'border-indigo-300 bg-indigo-50', slate: 'border-slate-300 bg-slate-50' }[tone]
                : 'border-slate-200 bg-white'}`}>
            <p className="text-[11px] font-bold text-slate-400">{t}</p>
            <p className={`text-xl font-extrabold tabular-nums ${v > 0
              ? { rose: 'text-rose-600', amber: 'text-amber-600', indigo: 'text-indigo-600', slate: 'text-slate-600' }[tone]
              : 'text-slate-300'}`}>{n(v)}<span className="text-xs font-bold">건</span></p>
            <p className="text-[10px] text-slate-400">{v > 0 ? s : '없음'}</p>
          </button>
        ))}
      </div>

      {/* 찾기 — 클레임 날 때 시리얼로 바로 찾는다 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="형번 · 기준코드 · 품명 · 제조사 · 시리얼"
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-80" />
        {only && (
          <button onClick={() => setOnly('')}
            className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700">
            {only} 만 보는 중 ✕
          </button>
        )}
        <span className="text-xs text-slate-400">{n(view.length)}종 / 전체 {n(sum.length)}종</span>
      </div>

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !sum.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500 font-semibold">등록된 로트가 없습니다</p>
          <p className="text-xs text-slate-400 mt-1">입고할 때 ＋ 로트 등록으로 시리얼을 기록하세요</p>
        </div>
      )}
      {!isLoading && sum.length > 0 && !view.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          찾는 품목이 없습니다.
        </div>
      )}

      {/* 한 줄에 한 품목 — 급한 것이 위로. 품목이 늘어도 위만 보면 된다. */}
      <div className="space-y-1.5">
        {view.map(s => {
          const open = !!openItems[s.item_id]
          const rows = byItem[s.item_id] || []
          const days = s.next_days
          const urgent = Number(s.expired_cnt) > 0
          const soon = !urgent && days != null && days <= 90
          return (
            <div key={s.item_id}
              className={`rounded-xl border bg-white overflow-hidden ${
                urgent ? 'border-rose-300' : soon ? 'border-amber-300' : 'border-slate-200'}`}>

              {/* ⚠ 칸마다 폭을 고정한다 — flex-1 로 두면 글자 길이에 따라 줄마다 어긋난다 */}
              <div className="flex items-center gap-3 px-3 min-h-[60px]">
                {/* 상태 — 색 막대 하나로 */}
                <span className={`w-1.5 h-10 rounded-full flex-shrink-0 ${
                  urgent ? 'bg-rose-500' : soon ? 'bg-amber-400' : 'bg-emerald-400'}`} />

                {/* 형번 · 품명 · 제조사 */}
                <div className="w-[300px] flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-800 truncate" style={{ fontFamily: MONO }}>
                      {s.maker_code || s.std_code}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap flex-shrink-0 ${makerTone(s.maker)}`}>
                      {s.maker || '기타'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">{s.item_name}</p>
                </div>

                {/* 먼저 쓸 로트 — 이 화면의 답 */}
                <div className="flex-1 min-w-[260px]">
                  {s.next_serial ? (
                    <div className={`rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap ${
                      urgent ? 'bg-rose-600' : soon ? 'bg-amber-500' : 'bg-slate-50 border border-slate-200'}`}>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                        urgent || soon ? 'bg-white/20 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}>
                        {urgent ? '기한 초과' : '먼저 사용'}
                      </span>
                      <span className={`text-sm font-bold ${urgent || soon ? 'text-white' : 'text-slate-700'}`}
                        style={{ fontFamily: MONO }}>{s.next_serial}</span>
                      <span className={`text-[11px] ${urgent || soon ? 'text-white/80' : 'text-slate-400'}`}>{n(s.next_qty)}개</span>
                      {s.next_expire && (
                        <span className={`ml-auto text-[11px] whitespace-nowrap ${urgent || soon ? 'text-white/90' : 'text-slate-400'}`}>
                          {s.next_expire}
                          {days != null && <b className="ml-1.5">{days < 0 ? `${-days}일 지남` : `${days}일`}</b>}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-300">남은 로트 없음</span>
                  )}
                </div>

                {/* 잔량 — 소진·재고차이까지 여기 모은다 (버튼 폭이 흔들리지 않게) */}
                <div className="text-right w-[104px] flex-shrink-0">
                  <p className="text-base font-bold text-slate-800 tabular-nums leading-tight">{n(s.total_left)}</p>
                  <p className="text-[10px] text-slate-400 whitespace-nowrap">
                    로트 {s.lot_cnt}
                    {Number(s.done_cnt) > 0 && <span className="text-slate-300"> · 소진 {s.done_cnt}</span>}
                  </p>
                  {Number(s.gap) !== 0 && (
                    <p className="text-[10px] font-bold text-rose-600 whitespace-nowrap" title={`재고 ${n(s.stock_qty)} · 로트 ${n(s.total_left)}`}>
                      ⚠ 재고와 {Number(s.gap) > 0 ? '+' : ''}{n(s.gap)}
                    </p>
                  )}
                </div>

                {/* 보증 */}
                <div className="w-[96px] flex-shrink-0 text-center">
                  {canEdit ? (
                    <button onClick={() => setShelfFor(s)} title="보증기간 수정"
                      className={`w-full px-1.5 py-1 rounded text-[10px] font-bold whitespace-nowrap ${
                        s.shelf_months ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                       : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                      {s.shelf_months ? `보증 ${s.shelf_months}개월` : '⚠ 보증 미설정'}
                    </button>
                  ) : (
                    <span className="block w-full px-1.5 py-1 rounded bg-slate-100 text-[10px] font-bold text-slate-500 whitespace-nowrap">
                      {s.shelf_months ? `보증 ${s.shelf_months}개월` : '보증 미설정'}
                    </span>
                  )}
                </div>

                {/* 버튼 — 폭을 박아 둔다 */}
                <div className="flex gap-1.5 flex-shrink-0 w-[112px] justify-end">
                  {canEdit && (
                    <button onClick={() => setAddFor({
                        item_id: s.item_id, std_code: s.std_code,
                        item_name: s.item_name, maker: s.maker, maker_code: s.maker_code })}
                      title="이 품목에 로트 추가"
                      className="w-8 py-1.5 text-[11px] font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50">＋</button>
                  )}
                  <button onClick={() => setOpenItems(v => ({ ...v, [s.item_id]: !v[s.item_id] }))}
                    className="w-[68px] py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 whitespace-nowrap">
                    {open ? '접기 ▲' : `로트 ${s.lot_cnt} ▼`}
                  </button>
                </div>
              </div>

              {/* 펼친 로트 — 한 줄에 다 들어간다 (2열이 아니라 가로가 넓다) */}
              {open && (
                <div className="border-t border-slate-100 divide-y divide-slate-50 bg-slate-50/50">
                  {rows.map(l => (
                    <div key={l.id}
                      className={`px-3 py-2 text-xs flex items-center gap-3 flex-wrap ${
                        Number(l.qty_left) <= 0 ? 'bg-slate-100/70 text-slate-400'
                          : l.expired ? 'bg-rose-50/60' : ''}`}>
                      <span className="w-5 text-center text-[10px] font-bold text-slate-400 flex-shrink-0">{l.fifo_rank}</span>
                      <span className="text-sm font-bold text-slate-800 min-w-[130px]" style={{ fontFamily: MONO }}>{l.serial_no}</span>
                      <span className="text-slate-400 whitespace-nowrap w-20">{l.made_ym || '제조 미상'}</span>
                      <span className="text-slate-500 whitespace-nowrap w-28">입고 {l.in_date}</span>
                      <span className={`whitespace-nowrap w-28 font-semibold ${
                        l.expired ? 'text-rose-600' : l.days_left <= 90 ? 'text-amber-600' : 'text-slate-500'}`}>
                        ~ {l.expire_date}
                      </span>
                      <span className="text-slate-400 truncate flex-1 min-w-[90px]">{l.vendor_name || '—'}</span>
                      <span className="whitespace-nowrap tabular-nums">
                        <b className="text-slate-800">{n(l.qty_left)}</b><span className="text-slate-300"> / {n(l.qty_in)}</span>
                      </span>
                      {canEdit && (
                        <button onClick={() => setEditLot(l)} title="수정 · 삭제"
                          className="text-slate-300 hover:text-indigo-600 px-1 flex-shrink-0">✎</button>
                      )}
                    </div>
                  ))}
                  {!rows.length && <p className="px-3 py-3 text-[11px] text-slate-400">남은 로트가 없습니다 — 「소진분 포함」을 켜면 지난 것도 보입니다.</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>

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

      {/* 로트관리 대상 품목 — 화면에서 켜고 끈다 */}
      {mgrOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setMgrOpen(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-2xl space-y-3 max-h-[86vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">⚙ 로트관리 대상 품목</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                시리얼·제조년월을 따로 관리할 품목을 고릅니다. 보증기간은 입고일부터 셉니다.
              </p>
            </div>

            {/* 지금 대상 */}
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1">
                지금 대상 <span className="text-slate-300">({sum.length}종)</span>
              </p>
              {sum.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-2 rounded-xl border border-slate-200">
                  아직 없습니다. 아래에서 찾아 추가하세요.
                </p>
              ) : (
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {sum.map(it => (
                    <div key={it.item_id} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-indigo-600 flex-shrink-0">{it.std_code}</span>
                      <span className="text-slate-600 flex-1 min-w-0 truncate">{it.item_name}</span>
                      <span className="text-slate-400 flex-shrink-0">{it.maker || ''}</span>
                      <span className="text-slate-500 flex-shrink-0">
                        로트 {n(it.lot_cnt ?? 0)}
                      </span>
                      <button
                        onClick={() => toggleMut.mutate({ id: it.item_id, on: false, std_code: it.std_code })}
                        disabled={toggleMut.isPending}
                        className="px-2 py-0.5 rounded-lg border border-rose-200 text-rose-600 font-bold flex-shrink-0 disabled:opacity-40">
                        제외
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 추가 */}
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1">품목 찾아 추가</p>
              <input value={mq} onChange={e => searchAll(e.target.value)}
                placeholder="품번 · 품명 · 제조사 · 제조사품번 (2자 이상)"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              {mHits.length > 0 && (
                <div className="mt-1.5 rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {mHits.map(h => (
                    <div key={h.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-indigo-600 flex-shrink-0">{h.std_code}</span>
                      <span className="text-slate-600 flex-1 min-w-0 truncate">{h.name}</span>
                      <span className="text-slate-400 flex-shrink-0 truncate max-w-28">
                        {h.manufacturer || ''} {h.manufacturer_code || ''}
                      </span>
                      {h.lot_managed ? (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold flex-shrink-0">
                          대상
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleMut.mutate({ id: h.id, on: true, std_code: h.std_code })}
                          disabled={toggleMut.isPending}
                          className="px-2 py-0.5 rounded-lg border border-indigo-300 text-indigo-700 font-bold flex-shrink-0 disabled:opacity-40">
                          + 추가
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {mq.trim().length >= 2 && mHits.length === 0 && (
                <p className="text-xs text-slate-400 mt-1.5">찾는 품목이 없습니다.</p>
              )}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              대상에서 빼도 이미 넣은 로트 기록은 지워지지 않습니다. 화면에 보이지 않을 뿐입니다.
            </p>

            <button onClick={() => setMgrOpen(false)}
              className="w-full py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-500">
              닫기
            </button>
          </div>
        </div>
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
