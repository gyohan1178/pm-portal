// 🧭 업무 흐름 — 관제탑을 볼 수 없는 계정의 첫 화면 · 메뉴 「업무 흐름」 (v4.91.0)
//   v4.98.0 — PC 는 「흐름 지도」(모든 부서 한 장 · 숫자는 내 부서와 나와 관련된 것만)가 기본, 「부서별 상세」는 탭으로.
//   휴대폰은 지도 대신 부서별 상세(요약 카드 · 단계 목록) 그대로.
import { useState, useEffect } from 'react'
import WorkFlow from '../components/WorkFlow'
import FlowMap from '../components/FlowMap'

const KEY = 'pm.flowTab'
const pcNow = () => { try { return window.matchMedia('(min-width: 640px)').matches } catch { return true } }
const readTab = () => { try { return localStorage.getItem(KEY) === 'detail' ? 'detail' : 'map' } catch { return 'map' } }

export default function WorkFlowPage() {
  const [tab, setTab] = useState(readTab)
  // 휴대폰 · PC 를 나눠 하나만 그린다 — 숨긴 부서별 상세가 「봤음」 기준을 몰래 저장하지 않게
  const [pc, setPc] = useState(pcNow)
  useEffect(() => {
    let mq
    try { mq = window.matchMedia('(min-width: 640px)') } catch { return undefined }
    const h = () => setPc(mq.matches)
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h) }
  }, [])
  const pick = (t) => { setTab(t); try { localStorage.setItem(KEY, t) } catch { /* 저장 안 되는 브라우저 */ } }
  return (
    <div className="sm:space-y-4">
      <div className="hidden sm:flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <h1 className="text-lg font-bold text-slate-900">업무 흐름</h1>
          <p className="page-desc text-xs text-slate-400 mt-0.5">
            {tab === 'map'
              ? '부서마다 한 줄, 왼쪽부터 일의 순서입니다. 부서를 건너가는 일은 화살표로 이었고, 순서 없이 생기는 곁일은 오른쪽에 모았습니다. 칸을 누르면 그 흐름만 진하게 보이고 화면으로 갈 수 있습니다.'
              : '부서마다 일 순서입니다. 단계 아래 버튼은 사이드바 메뉴 이름과 같습니다. 누르면 그 화면으로 가고, 숫자는 지금 처리할 건수입니다.'}
          </p>
        </div>
        <div className="inline-flex gap-1 p-1 rounded-lg bg-[#e9ebf2]" role="tablist" data-flow-pagetab>
          {[['map', '흐름 지도'], ['detail', '부서별 상세']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => pick(k)} data-flow-pagetab-item={k}
              className={`px-3 py-1.5 rounded-md text-[12.5px] font-bold ${tab === k ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {pc && tab === 'map' ? <FlowMap /> : <WorkFlow hero />}
    </div>
  )
}
