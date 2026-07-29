import { supabase } from './supabase'

/**
 * 주요 작업을 기록한다.
 *
 * 조회·검색·화면 이동은 기록하지 않는다 — 용량만 먹고 추적에 쓸모가 없다.
 * 기록 대상은 "나중에 누가 왜 이렇게 했는지 물어볼 일이 생길 작업"이다.
 *
 *   logActivity('update', 'purchase_orders', 'JS-260729-01', '단가 1,200 → 1,350')
 *   logActivity('upload', 'bom', 'AX-110132770', '911행 등록', null, 'AXCELIS')
 *
 * 기록에 실패해도 본 작업은 그대로 진행된다 (조용히 넘어감).
 *
 * @param action   create | update | delete | upload | merge
 * @param target   대상 테이블·화면
 * @param targetId 품번·발주번호 등 식별자
 * @param summary  한 줄 요약
 * @param detail   꼭 필요한 경우만 (단가·수량 변경 전후 등)
 * @param customer 고객사
 */
export async function logActivity(action, target, targetId = null, summary = null, detail = null, customer = null) {
  try {
    await supabase.rpc('pm_log', {
      p_action: action,
      p_target: target,
      p_target_id: targetId ? String(targetId).slice(0, 100) : null,
      p_summary: summary ? String(summary).slice(0, 300) : null,
      p_detail: detail || null,
      p_customer: customer || null,
    })
  } catch {
    // 기록 실패가 업무를 막지 않도록 무시한다
  }
}

/** 값이 바뀐 항목만 골라 "A → B" 형태로 요약 */
export function diffSummary(before, after, labels = {}) {
  const parts = []
  for (const k of Object.keys(after || {})) {
    const b = before?.[k]
    const a = after[k]
    if (b === a || (b == null && a == null)) continue
    const label = labels[k] || k
    const fmt = (v) => (v == null || v === '' ? '(없음)' : typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v))
    parts.push(`${label} ${fmt(b)} → ${fmt(a)}`)
  }
  return parts.join(' · ')
}

// 화면에서 쓰는 한글 표기
export const ACTION_LABEL = {
  create: '등록', update: '수정', delete: '삭제',
  upload: '업로드', merge: '병합', print: '출력',
}

export const ACTION_STYLE = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-amber-100 text-amber-700',
  delete: 'bg-rose-100 text-rose-700',
  upload: 'bg-indigo-100 text-indigo-700',
  merge:  'bg-violet-100 text-violet-700',
  print:  'bg-slate-100 text-slate-600',
}

export const TARGET_LABEL = {
  purchase_orders: '발주',
  stock_movements: '입출고',
  bom: 'BOM',
  items: '품목',
  vendors: '협력사',
  pm_quotes: '견적',
  pm_payment_plan: '결제계획',
  weekly_items: '주간보고',
  pm_ecount_purchases: '확정매입',
  customer_po: '고객사 PO',
  production: '생산관리',
  pm_profiles: '계정',
  cleanup: '데이터 정리',
}
