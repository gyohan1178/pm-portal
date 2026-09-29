import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { MAIN_PNS, isMainRow } from './mainPns'
import { bdMinus } from '../../lib/bizdays'
import { todayISO, ymdKST } from '../../lib/utils'
import { LANES, laneOf, revInfo, whyOf, missingOf, md } from '../../lib/prodFlow'

// 🖥 AXCELIS PD 생산 전광판 — 공정 흐름형 (v4.24.0, 시안 B2)
//
//   현장 TV 에 그냥 띄워 두는 화면. 마우스를 올려야 보이는 정보는 없다 — 전부 글자로.
//   · 칸 5개: 가공물 대기 → 자재 대기 → 전장 작업 → 품질 검수 → 출하 대기 (lib/prodFlow.js)
//   · 카드 = 호기. 첫 줄 품번·호기·D-day, 둘째 줄 Rev·날짜, 셋째 줄 = 지금 막힌 이유
//   · D-day: 앞 세 칸은 전장 완료예정일(납기 − 품질MD), 품질·출하 칸은 납기
//   · Rev: BREV(PO 발행) ≠ SREV(지금) 면 빨강 「Rev E→G」 — 도면 Rev 확인
//   · 가공물 입고일이 비어 있으면 빨강 「가공물 입고일 미입력」
//   · 1920 폭 기준으로 그리고 화면 폭에 맞춰 통째로 확대/축소 (v4.24.2 — 작은 TV · 윈도 배율에서 글자 잘림 방지)
//   · 5분마다 갱신, 15분 넘게 못 받으면 빨간 띠. 화면 잔상 막으려고 5분마다 몇 px 씩 움직인다.
const RANGE_DAYS = 30          // 앞 세 칸 표시 범위 — 전장 완료예정 오늘~+30일 + 지연 전부
const STALE_MIN = 15           // 이 시간 넘게 못 받으면 경고
const dayMs = 86400000
const FONT = "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
const NUM = FONT
const BASE_W = 1920            // 이 폭 기준으로 그린다

function dd(d) {
  if (!d) return null
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  if (isNaN(x)) return null
  return Math.round((x - new Date(new Date().toDateString())) / dayMs)
}
const ddText = (n) => (n == null ? '-' : n < 0 ? `D+${-n}` : n === 0 ? '오늘' : `D-${n}`)
// 역산 (ProductionPDBox 와 같은 규칙 · 품질MD · 영업일)
const calcElec = (r, qcMd) => r.elec_done || bdMinus(r.req_date, Math.max(1, Math.ceil(Number(qcMd) || 2)))

async function fetchBoard() {
  const today = todayISO()
  const mon = (() => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymdKST(d) })()
  const prod = await fetchAll(() => supabase.from('production')
    .select('id,pn,hogi,name,status,req_date,elec_done,arrival_date,machine_recv,harness_recv,part_issue,elec_recv,quality_recv,missing_parts,rev,brev,po_id,customer_code')
    .eq('customer_code', 'AX').neq('status', '완료').order('id'))
  const items = must(await supabase.from('items').select('std_code,md_days,qc_md_days,is_prototype').like('std_code', 'AX-11%'), '품목 조회') || []
  const shipped = must(await supabase.from('production').select('id,shipped_date').eq('customer_code', 'AX').gte('shipped_date', mon), '출하 조회') || []
  const meta = Object.fromEntries(items.map((i) => [String(i.std_code).replace('AX-', ''), { qc: i.qc_md_days, proto: i.is_prototype }]))
  return {
    rows: prod, meta,
    shippedToday: shipped.filter((s) => String(s.shipped_date).slice(0, 10) === today).length,
    shippedWeek: shipped.length,
  }
}

// 최근 7일 Rev 변경 — 고객사 PO 업로드가 남긴 변경 이력(changes)에서 SREV · BREV 만
async function fetchRevChanges(rows) {
  const since = ymdKST(new Date(Date.now() - 7 * dayMs))
  const byPo = new Map()
  rows.forEach((r) => { if (r.po_id) { if (!byPo.has(r.po_id)) byPo.set(r.po_id, []); byPo.get(r.po_id).push(r) } })
  const ids = [...byPo.keys()]
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const part = must(await supabase.from('purchase_orders').select('id,po_number,changes').in('id', ids.slice(i, i + 200)), 'Rev 변경 조회') || []
    part.forEach((p) => (Array.isArray(p.changes) ? p.changes : []).forEach((c) => {
      if ((c.field === 'item_rev' || c.field === 'item_brev') && String(c.at || '').slice(0, 10) >= since) {
        const r = byPo.get(p.id)[0]
        out.push({ pn: r.pn, hogi: r.hogi, po: p.po_number, kind: c.field === 'item_brev' ? 'BREV' : 'SREV', from: c.from, to: c.to, at: String(c.at).slice(0, 10) })
      }
    }))
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export default function ProductionBoard() {
  const navigate = useNavigate()
  const [now, setNow] = useState(new Date())
  const [win, setWin] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 }))
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const f = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', f); return () => window.removeEventListener('resize', f)
  }, [])
  const toggleFull = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  const { data, dataUpdatedAt, error } = useQuery({
    queryKey: ['prodBoard2'], queryFn: fetchBoard,
    refetchInterval: 5 * 60 * 1000, refetchIntervalInBackground: true,
  })
  const rows = data?.rows || []
  const meta = data?.meta || {}
  const { data: revChg = [], error: revErr } = useQuery({
    queryKey: ['boardRevChg', rows.map((r) => r.po_id).join(',')],
    queryFn: () => fetchRevChanges(rows), enabled: rows.length > 0,
    staleTime: 5 * 60 * 1000, refetchInterval: 5 * 60 * 1000,
  })
  // 납기 변경 — 전주 월요일 기준 납기가 바뀐 PD BOX 품번
  const { data: schChg = [], error: schErr } = useQuery({
    queryKey: ['boardChanges'],
    queryFn: async () => {
      const d = must(await supabase.rpc('pm_schedule_changes', { p_days: 30 }), '납기 변경 조회') || []
      return d.filter((c) => MAIN_PNS.has(String(c.std_code || '').replace(/^AX-/i, '').trim()))
    },
    staleTime: 5 * 60 * 1000, refetchInterval: 5 * 60 * 1000,
  })

  const view = useMemo(() => {
    const today = todayISO()
    const cards = rows.filter((r) => isMainRow(r.pn, r.customer_code) && r.req_date).map((r) => {
      const m = meta[r.pn] || {}
      const lane = laneOf(r)
      const byReq = lane === 'qc' || lane === 'ship'
      const date = byReq ? String(r.req_date).slice(0, 10) : calcElec(r, m.qc)
      const d = dd(date)
      return { ...r, _lane: lane, _date: date, _dateLabel: byReq ? '납기' : '전장', _d: d, _proto: !!m.proto,
        _rev: revInfo(r), _why: whyOf(r, lane, today), _miss: missingOf(r) }
    })
    const shown = cards.filter((c) => c._lane === 'qc' || c._lane === 'ship' || (c._d != null && c._d <= RANGE_DAYS))
    const hogiNo = (h) => parseInt(String(h).replace(/[^0-9]/g, ''), 10) || 0
    const lanes = LANES.map((L) => {
      const list = shown.filter((c) => c._lane === L.k)
        .sort((a, b) => (a._d ?? 9999) - (b._d ?? 9999) || String(a.pn).localeCompare(String(b.pn)) || hogiNo(a.hogi) - hogiNo(b.hogi))
      return { ...L, list }
    })
    const lateElec = shown.filter((c) => ['mch', 'mat', 'elec'].includes(c._lane) && c._d < 0)
    const missJobs = cards.filter((c) => c._miss.length)
    const next = {
      mch: `가공물 입고 예정 이번 주 ${shown.filter((c) => c._lane === 'mch' && c.arrival_date && dd(c.arrival_date) >= 0 && dd(c.arrival_date) <= 6).length}대`,
      mat: `결품 ${lanes[1].list.reduce((a, c) => a + c._miss.length, 0)}건 · 불출 대기 ${lanes[1].list.filter((c) => !c._miss.length).length}대`,
      elec: `오늘 · 내일 완료 ${lanes[2].list.filter((c) => c._d === 0 || c._d === 1).length}대`,
      qc: `납기 3일 안 ${lanes[3].list.filter((c) => c._d != null && c._d <= 3).length}대`,
      ship: `출하 대기 ${lanes[4].list.length}대`,
    }
    return { lanes, lateElec, missJobs, missCount: missJobs.reduce((a, c) => a + c._miss.length, 0), total: shown.length, next }
  }, [rows, meta])

  const pulled = schChg.filter((c) => c.to_date && c.from_date && c.to_date < c.from_date)

  // 아래 알림 한 줄 — 8초마다 돌아간다
  const msgs = useMemo(() => [
    ...revChg.map((c) => ({ tag: 'Rev 변경', red: true, t: `${c.pn} ${c.hogi || ''} ${c.kind} ${c.from} → ${c.to} (${md(c.at)}) — 작업은 최소 BREV, 도면 Rev 확인` })),
    ...pulled.map((c) => ({ tag: '납기 당겨짐', red: true, t: `${c.po_number} ${String(c.std_code || '').replace(/^AX-/, '')} ${c.from_date} → ${c.to_date} — 작업지시서 확인` })),
    ...schChg.filter((c) => !pulled.includes(c)).slice(0, 5).map((c) => ({ tag: '납기 밀림', t: `${c.po_number} ${String(c.std_code || '').replace(/^AX-/, '')} ${c.from_date} → ${c.to_date}` })),
    ...view.missJobs.slice(0, 8).map((c) => ({ tag: '미불출', red: true, t: `${c.pn} ${c.hogi || ''} — ${c._miss.map((m) => `${m.name || m.pn} ${m.qty || ''}개 ${m.date ? md(m.date) : '입고 미정'}`).join(' · ')}` })),
  ], [revChg, schChg, pulled, view.missJobs])
  const [mi, setMi] = useState(0)
  useEffect(() => { const t = setInterval(() => setMi((i) => i + 1), 8000); return () => clearInterval(t) }, [])
  const msg = msgs.length ? msgs[mi % msgs.length] : null

  const narrow = win.w < 900
  // 화면 크기 맞춤 — 1920 폭 기준으로 그린 뒤 화면 폭에 맞게 통째로 줄이거나 키운다.
  //   (TV 해상도가 1366 · 1600 이거나 윈도 배율이 125% · 150% 여도 글자 배치가 1920 과 똑같다 → 잘림 없음)
  const k = narrow ? 1 : win.w / BASE_W
  const stageH = narrow ? win.h : win.h / k
  // 칸에 들어갈 카드 수 — 화면 높이에 맞춘다 (넘치면 「+N대 더」)
  const maxCards = narrow ? 99 : Math.max(2, Math.floor((stageH - 420) / 146))   // 1080 높이 → 4장 + 「+N대 더」
  const ageMin = dataUpdatedAt ? Math.floor((now.getTime() - dataUpdatedAt) / 60000) : null
  const stale = !!error || (ageMin != null && ageMin >= STALE_MIN)
  const shift = [0, 2, 4, 2][Math.floor(now.getMinutes() / 5) % 4]   // 잔상 방지

  const chip = (bg) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderRadius: 14, background: bg })
  const big = { fontFamily: NUM, fontWeight: 800 }

  return (
    <div style={{ minHeight: '100vh', height: narrow ? 'auto' : '100vh', background: '#0B111C', color: '#EAF0F8', fontFamily: FONT, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', userSelect: 'none', overflow: narrow ? 'auto' : 'hidden' }}>
      <div data-stage style={{ width: narrow ? 'auto' : BASE_W, height: narrow ? 'auto' : stageH, boxSizing: 'border-box', padding: narrow ? 12 : '22px 32px', display: 'flex', flexDirection: 'column', gap: 14,
        transformOrigin: '0 0', transform: narrow ? `translate(${shift}px, ${shift / 2}px)` : `scale(${k}) translate(${shift}px, ${shift / 2}px)` }}>

        {stale && (
          <div role="alert" style={{ padding: '10px 18px', borderRadius: 12, background: '#7F1D1D', color: '#FFE4E1', fontSize: 22, fontWeight: 800 }}>
            ⚠ {error ? `불러오기 실패 — ${error.message}` : `${ageMin}분 넘게 갱신이 안 됐습니다`} · 화면이 최신이 아닐 수 있습니다 (네트워크 확인)
          </div>
        )}

        {/* 머리 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: narrow ? 24 : 38, fontWeight: 800, letterSpacing: -0.5 }}>PD 공정 흐름</div>
            <div style={{ fontSize: narrow ? 14 : 19, color: '#93A3BD' }}>진행 {view.total}대 · 카드 = 호기 · 셋째 줄 = 지금 막힌 이유</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: stale ? '#FF8A80' : '#4FD6A1' }}>
              <span style={{ width: 11, height: 11, borderRadius: 99, background: stale ? '#FF6B5E' : '#4FD6A1' }} />
              {ageMin == null ? '불러오는 중' : ageMin < 1 ? '방금 갱신' : `${ageMin}분 전 갱신`}
            </span>
            <span style={{ fontSize: narrow ? 16 : 26, color: '#93A3BD', fontWeight: 700 }}>{now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
            <span style={{ ...big, fontSize: narrow ? 28 : 60, lineHeight: 0.9 }}>{now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            <button onClick={() => navigate(-1)} title="뒤로가기" style={{ background: '#182338', border: '1px solid #36465F', borderRadius: 8, color: '#C3CEDF', fontSize: 16, padding: '6px 10px', cursor: 'pointer' }}>← 뒤로</button>
            <button onClick={toggleFull} title="전체화면 (ESC 로 해제)" style={{ background: '#182338', border: '1px solid #36465F', borderRadius: 8, color: '#C3CEDF', fontSize: 16, padding: '6px 10px', cursor: 'pointer' }}>⛶</button>
          </div>
        </div>

        {/* 알림 줄 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: narrow ? 16 : 22, fontWeight: 800 }}>
          <div style={chip(view.lateElec.length ? 'rgba(255,107,94,0.18)' : '#121B2B')}><span style={{ color: view.lateElec.length ? '#FF8A80' : '#93A3BD' }}>전장 지연 {view.lateElec.length}대</span></div>
          <div style={chip('#121B2B')}><span style={{ color: view.missJobs.length ? '#FF8A80' : '#93A3BD' }}>미불출 {view.missJobs.length}호기 · {view.missCount}건</span></div>
          <div style={chip('#121B2B')}><span style={{ color: pulled.length ? '#FFB547' : '#93A3BD' }}>납기 당겨짐 {pulled.length}</span></div>
          <div style={chip(revChg.length ? 'rgba(255,107,94,0.18)' : '#121B2B')}>
            <span style={{ color: revChg.length ? '#FF8A80' : '#93A3BD' }}>Rev 변경 {revChg.length}</span>
            <span style={{ fontSize: '0.8em', fontWeight: 600, color: '#93A3BD' }}>최근 7일</span>
          </div>
          <div style={{ ...chip('#12241E'), marginLeft: narrow ? 0 : 'auto', gap: 20 }}>
            <span style={{ color: '#9FE8C8', fontWeight: 700 }}>오늘 출하 <b style={{ ...big, fontSize: '1.4em', color: '#4FD6A1' }}>{data?.shippedToday ?? '-'}</b></span>
            <span style={{ color: '#9FE8C8', fontWeight: 700 }}>이번 주 <b style={{ ...big, fontSize: '1.4em', color: '#4FD6A1' }}>{data?.shippedWeek ?? '-'}</b></span>
          </div>
        </div>

        {/* 칸 5개 */}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
          {view.lanes.map((L) => (
            <div key={L.k} data-lane={L.k} style={{ borderRadius: 16, background: '#121B2B', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'hidden' }}>
              <div style={{ padding: '0 6px 10px', borderBottom: `3px solid ${L.line}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: narrow ? 20 : 28, fontWeight: 800 }}>{L.l}</span>
                  <span style={{ ...big, fontSize: narrow ? 40 : 66, lineHeight: 0.8, color: L.line }}>{L.list.length}</span>
                </div>
                <span style={{ fontSize: narrow ? 13 : 17, color: '#C3CEDF' }}>{view.next[L.k]}</span>
              </div>
              {L.list.length === 0 && <div style={{ textAlign: 'center', color: '#6F809B', fontSize: 18, padding: 20 }}>없음</div>}
              {L.list.slice(0, maxCards).map((c) => {
                const late = c._d != null && c._d < 0
                const near = c._d === 0 || c._d === 1
                return (
                  <div key={c.id} data-card={c.id} style={{ borderRadius: 12, padding: '9px 12px', background: late ? 'rgba(255,107,94,0.16)' : '#182338', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* 첫 줄이 넘치면 D-day 가 잘리지 않고 아랫줄로 내려간다 */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 7, rowGap: 3, minWidth: 0 }}>
                      <span style={{ ...big, fontWeight: 700, fontSize: narrow ? 21 : 27, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{c.pn}</span>
                      <span style={{ ...big, fontWeight: 700, fontSize: narrow ? 21 : 27, letterSpacing: '-0.02em', color: '#7CC4FF', whiteSpace: 'nowrap' }}>{c.hogi}</span>
                      <span style={{ marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap', padding: '1px 9px', borderRadius: 8, ...big, fontSize: narrow ? 19 : 24,
                        background: late ? '#FF6B5E' : near ? '#FFB547' : '#2A3B57', color: late ? '#1A0806' : near ? '#1C1204' : '#DCEBFF' }}>{ddText(c._d)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 3, fontSize: narrow ? 14 : 17 }}>
                      <span title={c._rev.diff ? `PO 발행 BREV ${c._rev.b} · 지금 SREV ${c._rev.s}` : ''}
                        style={{ padding: '0 9px', borderRadius: 6, ...big, fontWeight: 700, fontSize: narrow ? 16 : 21,
                          background: c._rev.diff ? 'transparent' : '#243149', color: c._rev.diff ? '#FF8A80' : '#C3CEDF',
                          border: c._rev.diff ? '2px solid #FF6B5E' : '2px solid transparent', whiteSpace: 'nowrap' }}>{c._rev.text}</span>
                      {c._proto && <span style={{ padding: '0 8px', borderRadius: 6, background: '#3A3016', color: '#FFD27A', fontWeight: 800, whiteSpace: 'nowrap' }}>초도</span>}
                      <span style={{ marginLeft: 'auto', color: '#93A3BD', whiteSpace: 'nowrap' }}>{c._dateLabel} {md(c._date)}</span>
                    </div>
                    <div style={{ fontSize: narrow ? 14 : 18, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      color: c._why.tone === 'red' ? '#FF8A80' : c._why.tone === 'green' ? '#4FD6A1' : '#C3CEDF' }}>{c._why.t}</div>
                  </div>
                )
              })}
              {L.list.length > maxCards && (
                <div style={{ textAlign: 'center', fontSize: 18, color: '#93A3BD', fontWeight: 700 }}>+{L.list.length - maxCards}대 더</div>
              )}
            </div>
          ))}
        </div>

        {/* 아래 — 돌아가는 알림 한 줄 + 범례 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 50, padding: '6px 16px', borderRadius: 14, background: '#121B2B', flexWrap: narrow ? 'wrap' : 'nowrap' }}>
          {msg ? (
            <>
              <span style={{ flexShrink: 0, padding: '3px 12px', borderRadius: 8, fontSize: 18, fontWeight: 800,
                background: msg.red ? 'rgba(255,107,94,0.18)' : 'rgba(124,196,255,0.16)', color: msg.red ? '#FF8A80' : '#8FD0FF' }}>{msg.tag}</span>
              <span style={{ fontSize: narrow ? 15 : 21, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{msg.t}</span>
              <span style={{ flexShrink: 0, fontSize: 16, color: '#6F809B' }}>{(mi % msgs.length) + 1} / {msgs.length}</span>
            </>
          ) : <span style={{ fontSize: 19, color: '#6F809B' }}>새 알림 없음 (Rev · 납기 변경 · 미불출)</span>}
          {(revErr || schErr) && <span style={{ fontSize: 15, color: '#FF8A80' }}>일부 알림을 못 불러왔습니다</span>}
          <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, fontSize: 15, color: '#93A3BD' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: '#FF6B5E', display: 'block' }} />지남</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: '#FFB547', display: 'block' }} />오늘·내일</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><i style={{ width: 14, height: 14, borderRadius: 4, border: '2px solid #FF6B5E', boxSizing: 'border-box', display: 'block' }} />Rev 다름</span>
            <span>5분마다 갱신</span>
          </div>
        </div>
      </div>
    </div>
  )
}
