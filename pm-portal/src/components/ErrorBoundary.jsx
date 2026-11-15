// 화면 안전장치 (v4.196.0) — 한 화면에서 오류가 나도 포털 전체가 흰 화면이 되지 않게
//   · 메뉴 · 위 줄은 그대로 두고, 죽은 화면 자리에만 안내를 띄운다 (다른 메뉴는 계속 쓸 수 있다)
//   · 오류는 errorLog 로 남긴다 (언제 · 누가 · 어느 화면)
//   · 배포 직후 조각을 못 찾는 오류는 고장이 아니므로 한 번 자동 새로고침
//   full: 메뉴 바깥(앱 전체)에서 잡았을 때 — 화면 가운데에 띄운다
import { Component } from 'react'
import { reportError, isChunkErr } from '../lib/errorLog'

const RELOAD_KEY = 'pm_chunk_reload'

// 시험용 — sessionStorage 'pm_crash_test' 가 있으면 한 번 일부러 죽는다 (안전장치가 실제로 뜨는지 확인)
//   React 는 오류가 나면 같은 화면을 한 번 더 그려 보므로, 안전장치가 잡을 때까지는 계속 죽어야 한다
let armed = false
export function CrashProbe() {
  if (!armed) {
    try { if (sessionStorage.getItem('pm_crash_test') === '1') { sessionStorage.removeItem('pm_crash_test'); armed = true } } catch { /* 저장소 못 쓰는 브라우저 */ }
  }
  if (armed) throw new Error('안전장치 시험용 오류')
  return null
}

export default class ErrorBoundary extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    armed = false
    if (isChunkErr(err)) {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
        if (Date.now() - last > 30000) { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); window.location.reload(); return }
      } catch { /* 저장소 못 쓰면 안내만 */ }
    }
    reportError(err, { kind: 'render', page: this.props.page, where: (info?.componentStack || '').split('\n').slice(1, 4).map(s => s.trim()).join(' < ') })
  }
  render() {
    const { err } = this.state
    if (!err) return this.props.children
    const chunk = isChunkErr(err)
    const box = (
      <div data-error-boundary role="alert" className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
        <div className="text-3xl mb-2">⚠</div>
        <h2 className="text-base font-bold text-slate-900">{chunk ? '새 버전이 올라왔습니다' : '이 화면을 여는 중 문제가 생겼습니다'}</h2>
        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
          {chunk ? '새로고침하면 최신 화면으로 열립니다.' : <>저장하던 내용이 있었다면 반영됐는지 다시 확인해 주세요.<br />{this.props.full ? '새로고침해도 같으면 관리자에게 알려 주세요.' : '다른 메뉴는 그대로 쓸 수 있습니다.'}</>}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {!chunk && <button type="button" data-error-retry onClick={() => this.setState({ err: null })} className="h-9 px-4 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50">다시 열기</button>}
          <button type="button" data-error-reload onClick={() => window.location.reload()} className="h-9 px-4 rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-700">새로고침</button>
        </div>
        {!chunk && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs text-slate-400">오류 내용 보기 (관리자에게 전달용)</summary>
            <pre data-error-msg className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">{String(err?.message || err)}</pre>
          </details>
        )}
      </div>
    )
    return this.props.full ? <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">{box}</div> : <div className="py-10">{box}</div>
  }
}
