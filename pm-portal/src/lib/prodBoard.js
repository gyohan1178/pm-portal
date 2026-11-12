// 공정 현황판 데이터 (v4.165.0) — 공정 현황판 · 폰 스캔이 같이 쓴다
//   현장 TV 는 /board?c=AX 처럼 고객사를 붙여 켜 두면 그 고객사만 보인다
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { must } from './db'
import { todayISO } from './utils'
import { bdMinus } from './bizdays'
import { fetchProdQc } from './prodAuto'
import { fetchScans } from './prodSteps'
import { fetchMainOverrides, isMainRow } from '../pages/production/mainPns'
import { isTpRow } from './thirdParty'

export const COLS = 'id,customer_code,company,pn,name,hogi,part,status,req_date,due_fix,elec_done,arrival_date,machine_recv,harness_recv,part_issue,elec_recv,quality_recv,shipped_date,missing_parts,memo,manager,rev,brev,ccn,po_id,order_line_id,vm,csk'
export const hogiNo = (h) => { const m = String(h || '').match(/\d+/); return m ? Number(m[0]) : 9999 }
export const dueOf = (r) => String(r.due_fix || r.req_date || '').slice(0, 10)
export const isPhone = () => typeof window !== 'undefined' && window.innerWidth < 768

export function dday(d) {
  if (!d) return null
  const t = new Date(todayISO() + 'T00:00:00'), x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(x) ? null : Math.round((x - t) / 86400000)
}
export const ddTone = (n) => (n == null ? 'text-slate-400' : n < 0 ? 'text-red-600' : n <= 3 ? 'text-orange-600' : n <= 7 ? 'text-amber-600' : 'text-emerald-700')
export const ddText = (n) => (n == null ? '' : n === 0 ? 'D-day' : n < 0 ? `D+${-n}` : `D-${n}`)

// 납품 끝난 것으로 보는 상태 — 완료 · VM 「현장작업」(이미 납품하고 현장 설치 중 · v4.178.0)
export const BOARD_DONE = ['완료', '현장작업']
// 진행 중 호기 + PO 번호 + 스캔 기록 + VM · CSK 검수 기록
export async function fetchBoard() {
  await fetchMainOverrides().catch(() => null)
  const rows = (await fetchAll(() => supabase.from('production').select(COLS).neq('status', '완료').order('id')))
    .filter((r) => !BOARD_DONE.includes(r.status))
  const lineIds = [...new Set(rows.map((r) => r.order_line_id).filter(Boolean))]
  const poIds = [...new Set(rows.filter((r) => !r.order_line_id && r.po_id).map((r) => r.po_id))]
  const lnPo = {}, cpo = {}
  for (let i = 0; i < lineIds.length; i += 150) {
    const part = must(await supabase.from('pm_order_line').select('id,pm_order(po_no)').in('id', lineIds.slice(i, i + 150)), '수주대장 읽기') || []
    part.forEach((l) => { lnPo[l.id] = l.pm_order?.po_no || '' })
  }
  for (let i = 0; i < poIds.length; i += 150) {
    const part = must(await supabase.from('purchase_orders').select('id,po_number').in('id', poIds.slice(i, i + 150)), 'PO 읽기') || []
    part.forEach((p) => { cpo[p.id] = p.po_number })
  }
  const items = must(await supabase.from('items').select('std_code,qc_md_days').like('std_code', 'AX-11%'), '품목 읽기') || []
  const qcd = Object.fromEntries(items.map((i) => [String(i.std_code).replace('AX-', ''), i.qc_md_days]))
  const ids = rows.map((r) => r.id)
  const [sc, qq] = await Promise.all([fetchScans(ids), fetchProdQc(ids.filter((_, i) => ['VM', 'CSK'].includes(String(rows[i].customer_code).toUpperCase())))])
  const list = rows.map((r) => ({
    ...r,
    customer_code: String(r.customer_code || '').toUpperCase(),
    _po: lnPo[r.order_line_id] || cpo[r.po_id] || '',
    _elec: !(String(r.customer_code || '').toUpperCase() === 'AX' && isMainRow(r.pn, 'AX') && !isTpRow(r)) ? '' : r.elec_done || (r.req_date ? bdMinus(r.req_date, Math.max(1, Math.ceil(Number(qcd[String(r.pn || '').replace(/^AX-/, '')]) || 2))) : ''),   // 전장 완료예정 — AX PD 만
    _due: dueOf(r),
  }))
  return { rows: list, scans: sc.rows, scanSetup: sc.setup, qc: qq.rows }
}
export const useBoardData = (tv) => useQuery({ queryKey: ['processBoard'], queryFn: fetchBoard, staleTime: 20 * 1000, refetchInterval: tv ? 30 * 1000 : 60 * 1000 })

