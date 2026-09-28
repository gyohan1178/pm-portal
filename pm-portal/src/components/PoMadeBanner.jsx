import { Link } from 'react-router-dom'
import { purchaseLink } from '../lib/createPO'

// 발주를 만든 뒤 띄우는 한 줄 — 누르면 구매발주 화면에서 방금 만든 것만 골라 보여 준다.
//   made: createPurchaseOrders 가 돌려준 목록 · csCode: ax / ed …
export default function PoMadeBanner({ made, csCode, skipped = 0, onClose }) {
  if (!made?.length) return null
  const nos = [...new Set(made.map(m => m.po_number).filter(Boolean))]
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
      <span className="text-xs font-bold text-emerald-700">
        ✅ 구매발주 {made.length}건을 만들었습니다{nos.length ? ` · ${nos.join(', ')}` : ''}
        {skipped > 0 && <span className="ml-1 font-normal text-amber-700">(수량 0 인 {skipped}줄은 뺐습니다)</span>}
      </span>
      <Link to={purchaseLink(csCode, made)}
        className="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
        구매발주 화면에서 보기 →
      </Link>
      <span className="text-[11px] text-emerald-600">발주번호·납기·단가를 채우고, 물건이 오면 거기서 바로 「입고 처리」</span>
      {onClose && <button onClick={onClose} className="ml-auto text-emerald-400 hover:text-emerald-600 text-sm px-1">✕</button>}
    </div>
  )
}
