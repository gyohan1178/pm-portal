// 전역 토스트 — React 밖(쿼리 캐시 onError 등)에서도 호출 가능
let listeners = []
let seq = 0

export function toast(message, type = 'info') {
  const t = { id: ++seq, message: String(message ?? ''), type }
  listeners.forEach(l => l(t))
  return t.id
}
export const toastError = (m) => toast(m, 'error')
export const toastSuccess = (m) => toast(m, 'success')

export function subscribeToast(cb) {
  listeners.push(cb)
  return () => { listeners = listeners.filter(l => l !== cb) }
}
