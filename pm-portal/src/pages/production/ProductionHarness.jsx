import { useMemo } from 'react'
import { isMainPn } from './mainPns'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const MAXBUNDLE = 10
const WORK_UNIT = 4  // 한 번에 작업하는 권장 단위 (인원 제약상 10개를 4씩 끊어서)
const dayMs = 86400000

function hogiNum(h) { const m = String(h || '').match(/(\d+)/); return m ? +m[1] : 9999 }
function dDays(dateStr, today) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10)); if (isNaN(d)) return null
  return Math.round((d.setHours(0, 0, 0, 0) - today) / dayMs)
}

function buildHarnessBundles(records, today) {
  // 1) 작업 대상: 미완료 + 하네스 미완료
  // 주요 관리 품번만 하네스 우선순위 대상 (sub assy 제외)
  const targets = records.filter(r => r.status !== '완료' && !r.harness_recv && isMainPn(r.pn))

  // 2) 묶음 키: 품번만 (하네스는 가공물과 독립 제작 → 가공물 입고일로 쪼개지 않음)
  //    같은 품번은 최대한 크게 묶어 선행생산 (10개씩 분할)
  const map = {}
  for (const r of targets) {
    const pn = (r.pn || '').trim(); if (!pn) continue
    if (!map[pn]) map[pn] = { pn, name: r.name || '', arrKey: 'NONE', issued: false, items: [] }
    map[pn].items.push(r)
  }

  // 3) 8개 분할 + 메타
  const bundles = []
  for (const g of Object.values(map)) {
    g.items.sort((a, b) => hogiNum(a.hogi) - hogiNum(b.hogi))
    for (let i = 0; i < g.items.length; i += MAXBUNDLE) {
      const chunk = g.items.slice(i, i + MAXBUNDLE)
      const minReq = Math.min(...chunk.map(r => dDays(r.req_date, today) ?? 99999))
      const hogis = chunk.map(r => r.hogi).sort((a, b) => hogiNum(a) - hogiNum(b))
      const hogiRange = hogis.length === 1 ? hogis[0] : `${hogis[0]}~${hogis[hogis.length - 1]}`
      // 작업 단위(4개씩) 소구간 — 인원 제약상 한 번에 다 못 하니 끊어서 작업
      const workGroups = []
      for (let j = 0; j < hogis.length; j += WORK_UNIT) {
        const sub = hogis.slice(j, j + WORK_UNIT)
        workGroups.push(sub.length === 1 ? sub[0] : `${sub[0]}~${sub[sub.length - 1]}`)
      }
      const elecN = chunk.filter(r => r.part_issue).length
      const machineN = chunk.filter(r => r.machine_recv).length
      const issuedN = chunk.filter(r => r.harness_issue).length
      bundles.push({ pn: g.pn, name: g.name, items: chunk, qty: chunk.length, hogiRange, workGroups, minReq, elecN, machineN, issuedN })
    }
  }

  // 4) 정렬: 납품일 임박순 (동률이면 품번순)
  bundles.sort((a, b) => {
    if (a.minReq !== b.minReq) return a.minReq - b.minReq
    return (a.pn || '').localeCompare(b.pn || '')
  })
  return bundles
}

function ddayBadge(d) {
  if (d == null || d === 99999) return <span className="text-slate-400">미정</span>
  if (d < 0) return <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">지남 {-d}일</span>
  if (d === 0) return <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">오늘</span>
  if (d <= 7) return <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold">D-{d}</span>
  if (d <= 14) return <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-semibold">D-{d}</span>
  return <span className="text-emerald-600 font-semibold">D-{d}</span>
}

// 표·카드 공통 배지
function harnessIssueBadge(b) {
  if (b.issuedN === b.qty) return <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold">불출됨</span>
  if (b.issuedN > 0) return <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 font-semibold">{b.issuedN}/{b.qty} 불출</span>
  return <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">🔲 미불출</span>
}
function elecStatus(b) {
  if (b.elecN === 0) return <span className="text-slate-500">미불출</span>
  if (b.elecN === b.qty) return <span className="text-emerald-600 font-semibold">전체 불출</span>
  return <span className="text-slate-500">{b.elecN}/{b.qty} 불출</span>
}
function arrivalStatus(b) {
  // 하네스는 가공물과 독립 — 참고용 표시 (묶음 중 가공물 입고된 수)
  if (b.machineN === b.qty) return <span className="text-emerald-600 font-semibold">✔ 전체 입고</span>
  if (b.machineN === 0) return <span className="text-slate-400">가공물 대기</span>
  return <span className="text-amber-600 font-semibold">{b.machineN}/{b.qty} 입고</span>
}

export default function ProductionHarness({ rows, csCode }) {
  const qc = useQueryClient()
  const today = useMemo(() => new Date().setHours(0, 0, 0, 0), [])
  const bundles = useMemo(() => buildHarnessBundles(rows, today), [rows, today])

  const summary = useMemo(() => ({
    overdue: bundles.filter(b => b.minReq < 0).length,        // 납품 지난 묶음
    soon: bundles.filter(b => b.minReq >= 0 && b.minReq <= 7).length, // 이번주 납품
    bundleN: bundles.length,
    hogiN: bundles.reduce((a, b) => a + b.qty, 0),
  }), [bundles])

  const doneMut = useMutation({
    mutationFn: async (items) => {
      const ids = items.map(r => r.id)
      const { error } = await supabase.from('production').update({ harness_recv: true, updated_at: new Date().toISOString() }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['production', csCode]),
    onError: (e) => toastError('완료 처리 오류: ' + e.message),
  })

  if (!bundles.length) return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-400">
      작업할 하네스가 없습니다 (모두 완료되었거나 대상 없음)
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-500 mb-1">납품 지남</p><p className="text-xl font-bold text-red-700">{summary.overdue}</p><p className="text-[10px] text-red-400">묶음 기준</p></div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3"><p className="text-xs font-bold text-orange-500 mb-1">이번주 납품</p><p className="text-xl font-bold text-orange-700">{summary.soon}</p><p className="text-[10px] text-orange-400">7일 내</p></div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 mb-1">전체 묶음</p><p className="text-xl font-bold text-slate-900">{summary.bundleN}</p></div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 mb-1">대상 호기</p><p className="text-xl font-bold text-indigo-700">{summary.hogiN}</p></div>
      </div>

      {/* 모바일: 카드 / PC: 표 */}
      <div className="sm:hidden space-y-2">
        {bundles.map((b, i) => {
          const ready = b.arrDays <= 0 && b.issued
          const cardCls = b.needIssueAlert ? 'border-orange-200 bg-orange-50/60' : ready ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'
          return (
            <div key={i} className={`rounded-xl border p-3 ${cardCls}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="font-mono text-indigo-600 text-sm">{b.pn}</div>
                    <div className="text-[11px] text-slate-400 truncate">{b.name}</div>
                    <div className="text-xs font-bold text-slate-700 mt-0.5">{b.hogiRange} <span className="font-normal text-slate-400">· {b.qty}대</span></div>
                    {b.workGroups && b.workGroups.length > 1 && (
                      <div className="text-[10px] text-indigo-400 mt-0.5">작업단위: {b.workGroups.join(' / ')}</div>
                    )}
                  </div>
                </div>
                <button onClick={() => { if (window.confirm(`${b.pn} ${b.hogiRange} (${b.qty}대) 하네스 완료 처리할까요?`)) doneMut.mutate(b.items) }}
                  disabled={doneMut.isPending}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-bold text-sm disabled:opacity-40">✓ 완료</button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5 text-xs">
                <div className="flex items-center justify-between gap-1"><span className="text-slate-400">하네스 불출</span>{harnessIssueBadge(b)}</div>
                <div className="flex items-center justify-between gap-1"><span className="text-slate-400">전장 불출</span>{elecStatus(b)}</div>
                <div className="flex items-center justify-between gap-1"><span className="text-slate-400">납품일</span>{ddayBadge(b.minReq)}</div>
                <div className="flex items-center justify-between gap-1"><span className="text-slate-400">가공물 입고</span>{arrivalStatus(b)}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 묶음 표 (PC) */}
      <div className="hidden sm:block rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-bold w-10">순위</th>
              <th className="px-3 py-2 text-left font-bold">품번 · PD명</th>
              <th className="px-3 py-2 text-left font-bold">호기</th>
              <th className="px-2 py-2 text-center font-bold">수량</th>
              <th className="px-3 py-2 text-center font-bold">하네스 불출</th>
              <th className="px-3 py-2 text-center font-bold">전장 불출</th>
              <th className="px-3 py-2 text-center font-bold">납품일</th>
              <th className="px-3 py-2 text-center font-bold">가공물 입고</th>
              <th className="px-2 py-2 text-center font-bold w-12">완료</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bundles.map((b, i) => {
              const ready = b.arrDays <= 0 && b.issued
              const rowCls = b.needIssueAlert ? 'bg-orange-50/60' : ready ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
              return (
                <tr key={i} className={rowCls}>
                  <td className="px-3 py-2 font-bold text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-indigo-600">{b.pn}</div>
                    <div className="text-[11px] text-slate-400">{b.name}</div>
                  </td>
                  <td className="px-3 py-2 font-bold text-slate-700">{b.hogiRange}
                    {b.workGroups && b.workGroups.length > 1 && <div className="text-[10px] font-normal text-indigo-400">↳ {b.workGroups.join(' / ')}</div>}
                  </td>
                  <td className="px-2 py-2 text-center font-bold">{b.qty}</td>
                  <td className="px-3 py-2 text-center">{harnessIssueBadge(b)}</td>
                  <td className="px-3 py-2 text-center">{elecStatus(b)}</td>
                  <td className="px-3 py-2 text-center">{ddayBadge(b.minReq)}</td>
                  <td className="px-3 py-2 text-center">{arrivalStatus(b)}</td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => { if (window.confirm(`${b.pn} ${b.hogiRange} (${b.qty}대) 하네스 완료 처리할까요?`)) doneMut.mutate(b.items) }}
                      disabled={doneMut.isPending}
                      className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-bold disabled:opacity-40">✓</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">정렬: 납품일 우선 → 가공물 입고일. 같은 품번도 입고일이 다르면 별도 묶음(입고분만 작업). 최대 8대/묶음.</p>
    </div>
  )
}
