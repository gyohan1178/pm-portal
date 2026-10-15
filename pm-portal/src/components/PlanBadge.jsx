import { planExcOf, planSince, planSinceText, planSinceTitle } from '../lib/planExc'

// 고객사 PO 「Plan Exc」(HOT · RSIN · RSOU …) 배지 — 고객사 PO 화면과 같은 모양 (v4.59.0)
//   changes 를 주면 옆에 「10/21~」(그날 PO 업로드에서 붙음) / 「기록 전」을 붙인다.
export default function PlanBadge({ plan, changes, since = true, className = '' }) {
  const pe = planExcOf(plan)
  if (!pe) return null
  const p = { plan_exc: plan, changes }
  const ps = since && changes ? planSince(p) : null
  const tip = pe.title + (ps ? '\n' + planSinceTitle(p, ps) : '')
  return (
    <span data-plan-badge={pe.label} className={`inline-flex items-center gap-0.5 align-middle whitespace-nowrap ${className}`} title={tip}>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold font-sans ${pe.cls}`}>{pe.label}</span>
      {ps && <span data-plan-since className={`text-[10px] font-sans ${ps.known ? 'text-red-500 font-bold' : 'text-slate-400'}`}>{planSinceText(ps)}</span>}
    </span>
  )
}
