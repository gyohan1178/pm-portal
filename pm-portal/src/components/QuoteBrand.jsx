// 견적서 회사 로고 · 직인 (v4.181.0) — public/logo.png · public/seal.png
//   직인 파일이 아직 없으면 조용히 안 보인다 (onError). 매출 견적서에만 쓴다 (받은 견적에는 안 붙임)
import { useState } from 'react'

export const LOGO_URL = '/logo.png'
export const SEAL_URL = '/seal.png'

//   위치는 인라인 스타일로 — 인쇄(PDF)에서도 그대로 나오게
export function QuoteLogo() {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return <img src={LOGO_URL} alt="JINSUNTECH" onError={() => setOk(false)} data-quote-logo
    style={{ position: 'absolute', left: 0, top: 0, height: 44, width: 'auto', objectFit: 'contain' }} />
}

// 상호(회사 이름) 바로 오른쪽에 반쯤 겹쳐 찍는다 — 부모는 position: relative 인 이름 span
export function QuoteSeal() {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return <img src={SEAL_URL} alt="" onError={() => setOk(false)} data-quote-seal
    style={{ position: 'absolute', left: 'calc(100% - 38px)', top: -22, width: 64, height: 64, objectFit: 'contain', opacity: 0.92, pointerEvents: 'none', userSelect: 'none', zIndex: 1 }} />
}

// 회사 이름 + 직인
export function CompanyWithSeal({ name, seal }) {
  return <span style={{ position: 'relative', display: 'inline-block' }}><b className="text-slate-800">{name}</b>{seal && <QuoteSeal />}</span>
}
