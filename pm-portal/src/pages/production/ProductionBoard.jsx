import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { isMainPn } from './mainPns'
import { bdMinus } from '../../lib/bizdays'

// 🖥 AXCELIS PD 생산 전광판 — 밀도형
//  · 전장 완료예정일 기준 D-day (납품일 − 품질MD)
//  · 표시범위: 전장완료 오늘~+RANGE_DAYS + 지연 전부
//  · 양산 먼저 / 초도 뒤로 · 5분 자동갱신 · 조회 전용
const RANGE_DAYS = 30            // 표시 범위 (여기 숫자만 바꾸면 조정)
const dayMs = 86400000

const truthy = (v) => v === true || (typeof v === 'string' && v.trim() && v !== 'false')
const md = (d) => d ? String(d).slice(5, 10).replace('-', '/') : ''
function dd(d) { if (!d) return null; const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); if (isNaN(x)) return null; return Math.round((x - new Date(new Date().toDateString())) / dayMs) }

// 역산 (ProductionPDBox와 동일 규칙 · 품질MD·조립MD + 영업일)
const calcElec = (r, qcMd) => r.elec_done || bdMinus(r.req_date, Math.max(1, Math.ceil(Number(qcMd) || 2)))
const calcStart = (r, qcMd, asmMd) => { const e = calcElec(r, qcMd); return e ? bdMinus(e, Math.max(1, Math.ceil(Number(asmMd) || 1))) : null }

// 진행바 4칸 (가공 → 하네스 → 전장 → 품질)
function steps(r) {
  return [truthy(r.machine_recv), truthy(r.harness_recv), truthy(r.part_issue), truthy(r.elec_recv) || truthy(r.quality_recv)]
}
function stepLabel(r) {
  if (truthy(r.quality_recv)) return { t: '출하대기', c: '#6ee7b7' }
  if (truthy(r.elec_recv)) return { t: '품질', c: '#fda4af' }
  if (truthy(r.harness_recv) || truthy(r.part_issue)) return { t: '전장', c: '#c4b5fd' }
  if (truthy(r.machine_recv)) return { t: '가공', c: '#fbbf24' }
  return { t: '미불출', c: '#64748b' }
}

async function fetchBoard() {
  const today = new Date().toISOString().slice(0, 10)
  const [{ data: prod }, { data: items }, { count: shippedToday }] = await Promise.all([
    supabase.from('production')
      .select('id,pn,hogi,name,status,req_date,elec_done,arrival_date,machine_recv,harness_recv,part_issue,elec_recv,quality_recv,missing_parts')
      .eq('customer_code', 'AX').neq('status', '완료'),
    supabase.from('items').select('std_code,md_days,qc_md_days,is_prototype').like('std_code', 'AX-11%'),
    supabase.from('production').select('id', { count: 'exact', head: true }).eq('customer_code', 'AX').eq('shipped_date', today),
  ])
  const meta = Object.fromEntries((items || []).map(i => [String(i.std_code).replace('AX-', ''), { md: i.md_days, qc: i.qc_md_days, proto: i.is_prototype }]))
  const rows = prod || []
  rows._meta = meta
  rows._shippedToday = shippedToday || 0
  return rows
}

export default function ProductionBoard() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  const { data: rows = [], dataUpdatedAt } = useQuery({
    queryKey: ['prodBoard'], queryFn: fetchBoard,
    refetchInterval: 5 * 60 * 1000, refetchIntervalInBackground: true,
  })
  const meta = rows._meta || {}

  const view = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const main = rows.filter(r => isMainPn(r.pn) && r.req_date)
    const enriched = main.map(r => {
      const m = meta[r.pn] || {}
      const elec = calcElec(r, m.qc)
      const start = calcStart(r, m.qc, m.md)
      const arr = r.arrival_date ? String(r.arrival_date).slice(0, 10) : null
      const beforeParts = arr && !truthy(r.machine_recv) && start && start < arr
      const overdueStart = start && start < today && !truthy(r.part_issue)
      const mchLate = arr && !truthy(r.machine_recv) && arr < today
      return { ...r, _elec: elec, _d: dd(elec), _proto: !!m.proto, beforeParts, overdueStart, mchLate }
    })
    const shown = enriched.filter(r => r._d != null && (r._d < 0 || r._d <= RANGE_DAYS))
    const groups = {}
    shown.forEach(r => { (groups[r.pn] ??= { pn: r.pn, name: r.name, proto: r._proto, rows: [] }).rows.push(r) })
    const arr = Object.values(groups)
    const hogiNo = (h) => parseInt(String(h).replace(/[^0-9]/g, ''), 10) || 0
    arr.forEach(g => g.rows.sort((a, b) => String(a._elec).localeCompare(String(b._elec)) || (hogiNo(a.hogi) - hogiNo(b.hogi))))
    arr.sort((a, b) => (a.proto - b.proto) || String(a.pn).localeCompare(String(b.pn)))

    const late = enriched.filter(r => r._d < 0)
    const bp = enriched.filter(r => r.beforeParts)
    const os = enriched.filter(r => r.overdueStart)
    const mch = enriched.filter(r => r.mchLate)
    const wkLoad = enriched.filter(r => r._d >= 0 && r._d <= 7).length
    const byStatus = {}
    rows.filter(r => r.pn).forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1 })
    return { groups: arr, late, bp, os, mch, wkLoad, byStatus, total: rows.filter(r => r.pn).length }
  }, [rows, meta])

  const ddCls = (n) => n == null ? '#64748b' : n < 0 ? '#f87171' : n <= 2 ? '#fb923c' : n <= 7 ? '#fde047' : '#64748b'
  const ddText = (n) => n == null ? '-' : n < 0 ? `D+${-n}` : n === 0 ? '오늘' : `D-${n}`

  const massGroups = view.groups.filter(g => !g.proto)
  const protoGroups = view.groups.filter(g => g.proto)

  const Card = ({ g }) => (
    <div style={{ borderRadius: 10, border: `1px solid ${g.rows.some(r => r._d < 0) ? 'rgba(239,68,68,.4)' : '#334155'}`, background: g.rows.some(r => r._d < 0) ? 'rgba(239,68,68,.06)' : '#0f172a', padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1e293b', paddingBottom: 5, marginBottom: 5 }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{g.pn}</div>
          <div style={{ fontSize: 9, color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
        </div>
        <div style={{ fontSize: 9, color: '#64748b', textAlign: 'right' }}>
          {g.rows.length}대{g.rows.some(r => r._d < 0) && <div style={{ color: '#f87171', fontWeight: 800 }}>지연 {g.rows.filter(r => r._d < 0).length}</div>}
        </div>
      </div>
      {g.rows.slice(0, 6).map((r, i) => {
        const sl = stepLabel(r); const st = steps(r)
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', borderRadius: 4, background: i === 0 ? '#1e293b' : 'transparent', fontSize: 11 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#a5b4fc', width: 28 }}>{r.hogi}</span>
            <span style={{ fontWeight: 700, width: 44, fontSize: 10, color: sl.c }}>{sl.t}</span>
            <div style={{ flex: 1, display: 'flex', gap: 2, minWidth: 0 }}>
              {st.map((on, j) => <i key={j} style={{ height: 5, flex: 1, borderRadius: 2, background: on ? (j === 3 ? '#34d399' : '#a78bfa') : '#334155', display: 'block' }} />)}
            </div>
            {(r.beforeParts || r.overdueStart) && <span title={r.beforeParts ? '부품 도착 전 착수 필요' : '착수일 지남·미불출'} style={{ fontSize: 9, fontWeight: 800, color: '#fda4af' }}>🔩</span>}
            {Array.isArray(r.missing_parts) && r.missing_parts.length > 0 && <span style={{ fontSize: 8, fontWeight: 800, color: '#fb7185' }}>결품{r.missing_parts.length}</span>}
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#94a3b8', width: 34, textAlign: 'right' }}>{md(r._elec)}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 11, width: 38, textAlign: 'right', color: ddCls(r._d) }}>{ddText(r._d)}</span>
          </div>
        )
      })}
      {g.rows.length > 6 && <div style={{ fontSize: 9, color: '#475569', paddingTop: 2 }}>외 {g.rows.length - 6}대…</div>}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#cbd5e1', padding: 16, userSelect: 'none', fontFamily: "'Malgun Gothic',sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #334155', paddingBottom: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: .5 }}>🏭 AXCELIS PD PRODUCTION STATUS</h1>
          <span style={{ fontSize: 11, color: '#64748b' }}>진행 {view.total}대 · 오늘출하 <b style={{ color: '#6ee7b7' }}>{rows._shippedToday || 0}</b> · {new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신</span>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 19, fontWeight: 800, color: '#fff' }}>
          {now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} {now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, fontWeight: 800, alignItems: 'center' }}>
        {view.late.length > 0 && <span title={view.late.map(r => `${r.pn} ${r.hogi} (전장완료 ${md(r._elec)}, ${ddText(r._d)})`).join('\n')} style={{ padding: '5px 12px', borderRadius: 9, background: 'rgba(239,68,68,.14)', border: '1px solid rgba(239,68,68,.45)', color: '#fca5a5', cursor: 'help' }}>🚨 전장 지연 {view.late.length}대</span>}
        {view.os.length > 0 && <span title={view.os.map(r => `${r.pn} ${r.hogi} (전장완료 ${md(r._elec)})`).join('\n')} style={{ padding: '5px 12px', borderRadius: 9, background: 'rgba(249,115,22,.14)', border: '1px solid rgba(249,115,22,.4)', color: '#fdba74', cursor: 'help' }}>⏱ 착수일 지남·미불출 {view.os.length}대</span>}
        {view.bp.length > 0 && <span title={view.bp.map(r => `${r.pn} ${r.hogi} (가공물 입고예정 ${md(r.arrival_date)})`).join('\n')} style={{ padding: '5px 12px', borderRadius: 9, background: 'rgba(244,63,94,.14)', border: '1px solid rgba(244,63,94,.4)', color: '#fda4af', cursor: 'help' }}>🔩 부품 도착 전 착수 {view.bp.length}대</span>}
        {view.mch.length > 0 && <span title={view.mch.map(r => `${r.pn} ${r.hogi} (입고예정 ${md(r.arrival_date)})`).join('\n')} style={{ padding: '5px 12px', borderRadius: 9, background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.4)', color: '#fcd34d', cursor: 'help' }}>⚙ 가공물 지연 {view.mch.length}건</span>}
        <span title={view.groups.flatMap(g => g.rows).filter(r => r._d >= 0 && r._d <= 7).map(r => `${r.pn} ${r.hogi} (전장완료 ${md(r._elec)}, ${ddText(r._d)})`).join('\n')} style={{ padding: '5px 12px', borderRadius: 9, background: 'rgba(139,92,246,.12)', border: '1px solid rgba(139,92,246,.3)', color: '#c4b5fd', cursor: 'help' }}>⚡ 이번주 전장 {view.wkLoad}대</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b' }}>전장 완료예정일 기준 · 🟥지남 🟧임박 🟨이번주 · 진행바: 가공·하네스·전장·품질</span>
      </div>

      {massGroups.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#7dd3fc', margin: '4px 0 6px' }}>🔵 양산품</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {massGroups.map(g => <Card key={g.pn} g={g} />)}
          </div>
        </>
      )}
      {protoGroups.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', margin: '12px 0 6px' }}>🟡 초도품 · 신규</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {protoGroups.map(g => <Card key={g.pn} g={g} />)}
          </div>
        </>
      )}
      {view.groups.length === 0 && <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>표시할 호기가 없습니다 (전장완료 예정 {RANGE_DAYS}일 이내)</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {['PO접수', '자재발주', '제작중', '품질검수', '납품대기'].map(st => (
          <div key={st} style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 7, textAlign: 'center' }}>
            <b style={{ display: 'block', fontSize: 20, fontWeight: 900, color: '#fff' }}>{view.byStatus[st] || 0}</b>
            <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700 }}>{st === 'PO접수' ? '미불출(PO접수)' : st}</span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 10, color: '#334155', marginTop: 8 }}>F11 전체화면 · 조회 전용 · 5분 자동갱신</div>
    </div>
  )
}
