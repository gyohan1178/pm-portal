// 🧭 업무 흐름 — 관제탑을 볼 수 없는 계정의 첫 화면 · 메뉴 「업무 흐름」 (v4.91.0)
import WorkFlow from '../components/WorkFlow'

export default function WorkFlowPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🧭 업무 흐름</h1>
        <p className="page-desc text-xs text-slate-400 mt-0.5">부서마다 일 순서입니다. 단계를 누르면 그 화면으로 가고, 숫자는 지금 처리할 건수입니다.</p>
      </div>
      <WorkFlow />
    </div>
  )
}
