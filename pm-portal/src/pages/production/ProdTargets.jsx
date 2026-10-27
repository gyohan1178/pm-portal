// 🎯 생산관리 대상 (v4.102.0)
//   ① 수주대장 ↔ 생산관리 연결 — 고객사마다 정한 규칙으로 늘 지금 데이터 기준 (pm_prod_order_v)
//   ② 대상 품번 · 그룹 — 생산관리에서 운영할 품번을 그룹(주요품목 · Sub 품목 · 추가)으로 나눈다
//      AXCELIS 는 이 목록이 고객사 PO 연동(호기 만들기)을 정한다 · CSK · VM 은 지금은 목록만 (생산관리는 기존 방식)
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { toastError, toastSuccess } from '../../lib/toast'
import {
  PT_CUSTS, ptCust, GROUP_TONES, GROUP_COLORS, PT_SQL_HINT, fetchPtGroups, fetchPtTargets, fetchPtProd, fetchPtLinks, fetchAxOpenPo,
  linkSummary, addPtGroup, updatePtGroup, deletePtGroup, addPtTarget, updatePtTarget,
} from '../../lib/prodTargets'
import { SkelBar, SkeletonRows } from '../../components/ux/Skeleton'

const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '—')
const DONE = (st) => st === '완료'
const isReal = (gid) => gid !== 'all' && gid !== 'none'   // 진짜 그룹 (전체 · 미분류가 아닌 것)

function Kpi({ tone = '', label, value, sub, data, loading }) {
  const T = { green: 'bg-emerald-50 border-emerald-200 text-emerald-600', amber: 'bg-amber-50 border-amber-200 text-amber-600', red: 'bg-red-50 border-red-200 text-red-500', '': 'bg-white border-slate-200 text-slate-800' }[tone]
  return (
    <div className={`rounded-xl border px-4 py-3 ${T}`} data-pt-kpi={data}>
      <div className="text-[12px] text-slate-500">{label}</div>
      {loading ? <div className="py-1.5 space-y-2" data-skeleton><SkelBar w={56} h={24} /><SkelBar w="70%" h={9} /></div> : <>
        <div className="text-[26px] font-extrabold leading-tight tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </>}
    </div>
  )
}

export default function ProdTargets() {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = canEdit(profile)
  const [sp, setSp] = useSearchParams()
  const cust = PT_CUSTS.some((c) => c.code === sp.get('c')) ? sp.get('c') : 'AX'
  const C = ptCust(cust)
  const hold = C.mode === 'hold'
  const setCust = (c) => { const n = new URLSearchParams(sp); n.set('c', c); setSp(n, { replace: true }); setGroupSel('all') }

  const groupsQ = useQuery({ queryKey: ['ptGroups', cust], queryFn: () => fetchPtGroups(cust), enabled: !hold, retry: false })
  const targetsQ = useQuery({ queryKey: ['ptTargets', cust], queryFn: () => fetchPtTargets(cust), enabled: !hold, retry: false })
  const prodQ = useQuery({ queryKey: ['ptProd', cust], queryFn: () => fetchPtProd(cust), enabled: !hold })
  const linksQ = useQuery({ queryKey: ['ptLinks', cust], queryFn: () => fetchPtLinks(cust), enabled: !hold, retry: false })
  const axPoQ = useQuery({ queryKey: ['ptAxPo'], queryFn: fetchAxOpenPo, enabled: cust === 'AX', staleTime: 5 * 60 * 1000 })
  const sqlMissing = [groupsQ, targetsQ, linksQ].some((q) => q.error?.missing)
  const linkLoading = prodQ.isLoading || linksQ.isLoading
  const refresh = () => ['ptGroups', 'ptTargets', 'ptLinks', 'ptProd', 'lineProdMap'].forEach((k) => qc.invalidateQueries({ queryKey: [k], exact: false }))

  const prod = prodQ.data || []
  const links = linksQ.data || []
  const sum = useMemo(() => linkSummary(prod, links, cust), [prod, links, cust])
  const groups = groupsQ.data || []
  const targets = targetsQ.data || []

  // 품번별 — 진행 수주(AX: 고객사 PO 진행 중) · 생산관리 진행 호기
  const key = (code) => String(code || '').toUpperCase().replace(/^AX-/, '')
  const poBy = useMemo(() => {
    const m = new Map()
    for (const p of axPoQ.data || []) { if (p.third_party) continue; const k = key(p.items?.std_code); const x = m.get(k) || { n: 0, q: 0, name: p.items?.name, code: p.items?.std_code }; x.n++; x.q += +p.qty_ordered || 0; m.set(k, x) }
    return m
  }, [axPoQ.data])
  const prodBy = useMemo(() => {
    const m = new Map()
    for (const p of prod) { if (DONE(p.status)) continue; const k = key(p.pn); const x = m.get(k) || { open: 0, linked: 0 }; x.open++; if (sum.byProd.has(p.id)) x.linked++; m.set(k, x) }
    return m
  }, [prod, sum])
  // AX: 목록에 없지만 진행 중 PO 가 있는 AX-11 품번 — 예전 규칙으로 자동 대상
  const autoOnly = useMemo(() => {
    if (cust !== 'AX') return []
    const listed = new Set(targets.map((t) => key(t.pn)))
    return [...poBy.entries()].filter(([k, v]) => !listed.has(k) && /^AX-11/.test(v.code || '')).map(([k, v]) => ({ k, ...v }))
  }, [cust, targets, poBy])

  const [groupSel, setGroupSel] = useState('all')   // all · none(미분류) · 그룹 id
  const [addCode, setAddCode] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [editG, setEditG] = useState(null)          // { id, name, color }
  const countIn = (gid) => targets.filter((t) => (gid === 'none' ? !t.group_id || !groups.some((g) => g.id === t.group_id) : t.group_id === gid)).length
  const shown = targets.filter((t) => groupSel === 'all' || (groupSel === 'none' ? !t.group_id || !groups.some((g) => g.id === t.group_id) : t.group_id === groupSel))
    .sort((a, b) => (b.active - a.active) || ((prodBy.get(key(b.pn))?.open || 0) - (prodBy.get(key(a.pn))?.open || 0)) || a.pn.localeCompare(b.pn))

  const mut = useMutation({
    mutationFn: async ({ fn }) => fn(),
    onSuccess: (_, v) => { refresh(); if (v.ok) toastSuccess(v.ok) },
    onError: (e) => toastError(e.message || String(e)),
  })
  const run = (fn, ok) => mut.mutate({ fn, ok })
  const addTarget = (code, gid) => run(() => addPtTarget(cust, code, gid !== undefined ? gid : (isReal(groupSel) ? groupSel : null), profile?.name), '생산관리 대상에 넣었습니다')

  return (
    <div className="space-y-4" data-prod-targets data-cust={cust}>
      <PageHead crumb="현장 · 생산" title="생산관리 대상"
        desc="고객사마다 생산관리에서 운영할 품번을 그룹으로 정하고, 수주대장 PO 와 생산관리 호기가 제대로 이어졌는지 봅니다. 연결은 저장하지 않고 늘 지금 데이터로 계산합니다." />

      <div className="flex flex-wrap items-center gap-2">
        {PT_CUSTS.map((c) => (
          <button key={c.code} type="button" onClick={() => setCust(c.code)} data-pt-cust={c.code}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold border ${cust === c.code ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: c.dot }} />{c.name}
            {c.mode === 'hold' && <span className="ml-1 text-[10px] opacity-70">보류</span>}
          </button>
        ))}
      </div>

      {hold ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-800" data-pt-hold>
          <b>{C.name} 는 보류</b> — {C.how}
        </div>
      ) : sqlMissing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800" data-pt-sql>{PT_SQL_HINT}</div>
      ) : <>
        {/* ① 연결 */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-pt-link>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-extrabold text-slate-800">🔗 수주대장 ↔ 생산관리 연결</h2>
            <span className="text-[12px] text-slate-400">연결 기준: {C.rule}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="생산관리 진행 중" value={fmt(sum.open)} sub={`완료 포함 전체 ${fmt(sum.total)}줄`} data="open" loading={linkLoading} />
            <Kpi tone="green" label="수주와 연결됨" value={fmt(sum.linkedOpen)} sub={`진행 중 기준 · 완료 포함 ${fmt(sum.linkedAll)}줄`} data="linked" loading={linkLoading} />
            <Kpi tone={linkLoading ? '' : sum.unlinked.length ? 'amber' : 'green'} label="연결 안 됨" value={fmt(sum.unlinked.length)} sub={sum.unlinked.length ? '아래 목록 — 왜 안 됐는지 같이' : '진행 중 전부 연결'} data="unlinked" loading={linkLoading} />
            <Kpi label="연결된 수주 PO" value={fmt(sum.pos)} sub={sum.guess ? `그중 「추정」 연결 호기 ${fmt(sum.guess)} — 이름 앞부분만 같음` : '수주대장 진행 중 줄에 「🏭 호기」로 보임'} data="lines" loading={linkLoading} />
          </div>
          {linkLoading && (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-[12px]"><tbody><SkeletonRows cols={6} rows={4} /></tbody></table>
            </div>
          )}
          {sum.unlinked.length > 0 && (
            <div className="rounded-lg border border-amber-200 overflow-hidden" data-pt-unlinked>
              <div className="px-3 py-2 bg-amber-50 text-[12px] font-bold text-amber-800">연결 안 된 진행 중 생산관리 줄 {fmt(sum.unlinked.length)}</div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="bg-slate-50 text-[11px] text-slate-500 text-left">{['호기', '품번 · 모델', '이름', '상태', '납기', '왜 안 됐나'].map((h) => <th key={h} className="px-3 py-1.5 font-bold">{h}</th>)}</tr></thead>
                  <tbody>{sum.unlinked.slice(0, 300).map((p) => (
                    <tr key={p.id} className="border-t border-slate-100" data-pt-unlinked-row={p.hogi}>
                      <td className="px-3 py-1.5 font-mono font-bold">{p.hogi || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-600">{p.pn}</td>
                      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[220px]">{p.name}</td>
                      <td className="px-3 py-1.5">{p.status}</td>
                      <td className="px-3 py-1.5 font-mono">{md(p.req_date)}</td>
                      <td className="px-3 py-1.5 text-amber-700">{p.why}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          {sum.linkedOpen > 0 && (
            <details className="rounded-lg border border-slate-200" data-pt-linked>
              <summary className="px-3 py-2 text-[12px] font-bold text-slate-600 cursor-pointer">연결된 진행 중 줄 보기 ({fmt(sum.linkedOpen)}){sum.guess ? <span className="ml-1 text-amber-700"> · 추정 {fmt(sum.guess)} 먼저</span> : ''}</summary>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="bg-slate-50 text-[11px] text-slate-500 text-left">{['호기', '품번 · 프로젝트', '상태', '납기', '수주대장 PO', '수주 줄'].map((h) => <th key={h} className="px-3 py-1.5 font-bold">{h}</th>)}</tr></thead>
                  <tbody>{prod.filter((p) => !DONE(p.status) && sum.byProd.has(p.id)).sort((a, b) => !!sum.byProd.get(b.id).guess - !!sum.byProd.get(a.id).guess).slice(0, 400).map((p) => {
                    const k = sum.byProd.get(p.id)
                    const pos = String(k.pos || '').split(', ').filter(Boolean)
                    return (
                      <tr key={p.id} className="border-t border-slate-100" data-pt-linked-row={p.hogi}>
                        <td className="px-3 py-1.5 font-mono font-bold">{p.hogi}{k.guess && <span className="ml-1 px-1.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold font-sans" title="프로젝트 이름 앞부분만 같아서 이은 것 — 맞는지 확인하세요" data-pt-guess>추정</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{p.pn}</td>
                        <td className="px-3 py-1.5">{p.status}</td>
                        <td className="px-3 py-1.5 font-mono">{md(p.req_date)}</td>
                        <td className="px-3 py-1.5 font-mono text-[#5b6ee8]">{pos.slice(0, 3).join(' · ')}{pos.length > 3 ? ` 외 ${pos.length - 3}건` : ''}</td>
                        <td className="px-3 py-1.5 font-mono tabular-nums">{fmt(k.n_lines)}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </details>
          )}
        </section>

        {/* ② 대상 품번 · 그룹 */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-pt-targets>
          <div>
            <h2 className="text-[15px] font-extrabold text-slate-800">🎯 생산관리 대상 품번 · 그룹</h2>
            <p className={`text-[12px] mt-0.5 ${C.mode === 'auto' ? 'text-violet-700' : 'text-slate-400'}`} data-pt-how>{C.how}</p>
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            {/* 그룹 */}
            <div className="md:w-[230px] shrink-0 space-y-1.5" data-pt-groups>
              {[{ id: 'all', name: '전체', color: 'slate' }, ...groups, { id: 'none', name: '미분류', color: 'slate' }].map((g) => {
                const n = g.id === 'all' ? targets.length : countIn(g.id)
                if (g.id === 'none' && !n) return null
                const on = groupSel === g.id
                const real = isReal(g.id)
                if (editG?.id === g.id) return (
                  <div key={g.id} className="rounded-lg border border-violet-300 p-2 space-y-1.5" data-pt-group-edit>
                    <input value={editG.name} onChange={(e) => setEditG({ ...editG, name: e.target.value })} className="w-full px-2 py-1 text-xs border border-slate-200 rounded" data-pt-group-name />
                    <div className="flex flex-wrap gap-1">{GROUP_COLORS.map((c) => <button key={c} type="button" onClick={() => setEditG({ ...editG, color: c })} className={`w-5 h-5 rounded-full border ${GROUP_TONES[c]} ${editG.color === c ? 'ring-2 ring-violet-400' : ''}`} title={c} />)}</div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => { run(() => updatePtGroup(g.id, { name: editG.name, color: editG.color }), '그룹을 고쳤습니다'); setEditG(null) }} className="px-2 py-1 text-[11px] font-bold rounded bg-violet-600 text-white" data-pt-group-save>저장</button>
                      <button type="button" onClick={() => setEditG(null)} className="px-2 py-1 text-[11px] font-bold rounded bg-slate-100 text-slate-500">닫기</button>
                      <button type="button" onClick={() => { run(() => deletePtGroup(g.id, n), '그룹을 지웠습니다'); setEditG(null); setGroupSel('all') }} className="ml-auto px-2 py-1 text-[11px] font-bold rounded text-slate-400 hover:text-red-500" data-pt-group-del>지우기</button>
                    </div>
                  </div>
                )
                return (
                  <div key={g.id} role="button" tabIndex={0} onClick={() => setGroupSel(g.id)} data-pt-group={g.name}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer ${on ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      {real && <span className={`inline-block w-2.5 h-2.5 rounded-full border ${GROUP_TONES[g.color] || GROUP_TONES.slate}`} />}
                      <span className="text-[12.5px] font-bold text-slate-700 truncate">{g.name}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-[11px] font-bold text-slate-400 tabular-nums">{n}</span>
                      {real && editable && on && <button type="button" onClick={(e) => { e.stopPropagation(); setEditG({ id: g.id, name: g.name, color: g.color || 'slate' }) }} className="text-[11px] text-slate-400 hover:text-violet-600" title="이름 · 색 바꾸기 · 지우기" data-pt-group-edit-btn>✎</button>}
                    </span>
                  </div>
                )
              })}
              {editable && (
                <div className="flex gap-1 pt-1">
                  <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="새 그룹 이름" className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-dashed border-slate-300 rounded-lg" data-pt-new-group
                    onKeyDown={(e) => { if (e.key === 'Enter' && newGroup.trim()) { run(() => addPtGroup(cust, newGroup), '그룹을 더했습니다'); setNewGroup('') } }} />
                  <button type="button" disabled={!newGroup.trim()} onClick={() => { run(() => addPtGroup(cust, newGroup), '그룹을 더했습니다'); setNewGroup('') }} className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-violet-200 text-violet-700 disabled:opacity-40" data-pt-add-group>＋ 그룹</button>
                </div>
              )}
            </div>

            {/* 품번 */}
            <div className="flex-1 min-w-0 space-y-2">
              {editable && (
                <div className="flex flex-wrap gap-2 items-center">
                  <input value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder={cust === 'AX' ? '품번 더하기 — 예: 110158840 (AX- 자동)' : '품번 더하기 — 품목 마스터 품번'}
                    onKeyDown={(e) => { if (e.key === 'Enter' && addCode.trim()) { addTarget(addCode); setAddCode('') } }}
                    className="flex-1 min-w-[220px] px-3 py-2 text-xs border border-slate-200 rounded-lg" data-pt-add-code />
                  <button type="button" disabled={!addCode.trim() || mut.isPending} onClick={() => { addTarget(addCode); setAddCode('') }} className="px-3 py-2 text-xs font-bold rounded-lg bg-violet-600 text-white disabled:opacity-40" data-pt-add>＋ 대상에 넣기{isReal(groupSel) ? ` (${groups.find((g) => g.id === groupSel)?.name || ''})` : ''}</button>
                </div>
              )}
              <div className="rounded-lg border border-slate-200 overflow-x-auto">
                <table className="w-full text-[12px] min-w-[640px]">
                  <thead><tr className="bg-slate-50 text-[11px] text-slate-500 text-left">
                    <th className="px-3 py-2 font-bold">품번 · 품명</th>
                    {cust === 'AX' && <th className="px-3 py-2 font-bold text-right">진행 PO</th>}
                    <th className="px-3 py-2 font-bold text-right">생산관리 진행</th>
                    <th className="px-3 py-2 font-bold">그룹</th>
                    <th className="px-3 py-2 font-bold">상태</th>
                  </tr></thead>
                  <tbody>
                    {targetsQ.isLoading && <SkeletonRows cols={cust === 'AX' ? 5 : 4} rows={6} two={[0]} />}
                    {!targetsQ.isLoading && !shown.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">{C.mode === 'auto' ? '이 그룹에 품번이 없습니다' : '아직 지정한 품번이 없습니다 — 위에서 품번을 넣으세요'}</td></tr>}
                    {shown.map((t) => {
                      const k = key(t.pn), po = poBy.get(k), pr = prodBy.get(k)
                      return (
                        <tr key={t.id} className={`border-t border-slate-100 ${t.active ? '' : 'opacity-50'}`} data-pt-row={t.pn}>
                          <td className="px-3 py-2"><div className="font-mono font-bold text-[#5b6ee8]">{t.pn}</div><div className="text-[11px] text-slate-400 truncate max-w-[300px]">{t.items?.name || po?.name || '—'}</div></td>
                          {cust === 'AX' && <td className="px-3 py-2 text-right font-mono tabular-nums">{po ? <>{fmt(po.q)}<span className="text-[10.5px] text-slate-400"> · {po.n}줄</span></> : <span className="text-slate-300">—</span>}</td>}
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{pr ? <>{fmt(pr.open)}{pr.linked < pr.open && <span className="text-[10.5px] text-amber-600" title="수주와 연결 안 된 호기"> · 미연결 {pr.open - pr.linked}</span>}</> : <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2">
                            <select value={t.group_id || ''} disabled={!editable} onChange={(e) => { const g = groups.find((x) => String(x.id) === e.target.value); run(() => updatePtTarget(t.id, { group_id: g ? g.id : null }), '그룹을 옮겼습니다') }}
                              className="px-2 py-1 text-[11.5px] border border-slate-200 rounded bg-white" data-pt-row-group>
                              <option value="">미분류</option>
                              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" disabled={!editable} onClick={() => run(() => updatePtTarget(t.id, { active: !t.active }), t.active ? `${t.pn} — 생산관리에서 뺐습니다 (이미 있는 호기는 그대로)` : `${t.pn} — 다시 생산관리 대상`)}
                              title={t.active ? (C.mode === 'auto' ? '누르면 「제외」 — 고객사 PO 연동이 이 품번 호기를 새로 만들지 않음 (이미 있는 호기는 그대로)' : '누르면 「제외」') : '누르면 다시 대상'}
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${t.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`} data-pt-toggle>{t.active ? '대상' : '제외'}</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {autoOnly.length > 0 && (groupSel === 'all' || groupSel === 'none') && (
                <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/40 px-3 py-2 text-[12px] text-slate-600" data-pt-auto>
                  <b className="text-violet-700">목록에 없지만 자동 대상 {autoOnly.length}</b> — 진행 중 PO 가 있는 AX-11 품번은 목록에 없어도 예전처럼 호기가 만들어집니다. 그룹을 나누려면 넣으세요.
                  <div className="mt-1 flex flex-wrap gap-1">{autoOnly.slice(0, 30).map((a) => (
                    <button key={a.k} type="button" disabled={!editable} onClick={() => addTarget(a.code, isReal(groupSel) ? groupSel : null)} className="px-2 py-0.5 rounded border border-violet-200 bg-white font-mono text-[11px] text-violet-700 hover:bg-violet-50" data-pt-auto-add={a.code} title={a.name}>＋ {a.code}</button>
                  ))}</div>
                </div>
              )}
            </div>
          </div>
        </section>
        <p className="text-[11px] text-slate-400 px-1">수주대장에서 연결된 줄은 「🏭 호기」로 보입니다 · 생산관리 화면: <Link to={`/production/${cust}`} className="text-violet-600 font-bold">🔧 생산 관리 ({C.name}) →</Link></p>
      </>}
    </div>
  )
}
