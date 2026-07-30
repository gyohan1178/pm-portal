import { useState, useRef, useEffect, useCallback } from 'react'

// QR 스캐너 — 위치 태그를 읽어 실사 화면으로 보낸다.
//
//   브라우저 내장 BarcodeDetector 를 먼저 쓰고, 없으면 jsQR 로 넘어간다.
//   (아이폰 Safari 는 내장 기능이 없어 jsQR 이 필요하다)
//
//   태그 QR 에는 위치 코드만 들어 있다 (예: A1-01-3).
//   라벨이 작아 URL 을 넣으면 QR 이 촘촘해져 인식이 어렵기 때문이다.
export default function QrScanner({ onScan, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const streamRef = useRef(null)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(false)
  const [manual, setManual] = useState('')
  const [last, setLast] = useState('')

  // 위치 코드만 뽑아낸다. URL 이 들어와도 뒤쪽 코드를 인식한다.
  const parseLoc = (text) => {
    const t = String(text || '').trim().toUpperCase()
    const m = t.match(/([A-Z]+[0-9]*-[0-9]+-[0-9]+)/)
    return m ? m[1] : null
  }

  // 한 번 인식하면 곧바로 멈춘다.
  // ref 로 막는 이유: setState 는 다음 렌더에 반영되어
  // 그 사이 프레임이 여러 번 돌며 중복 인식되기 때문이다.
  const doneRef = useRef(false)
  const handleHit = useCallback((text) => {
    if (doneRef.current) return
    const loc = parseLoc(text)
    if (!loc) return
    doneRef.current = true
    setLast(loc)
    if (navigator.vibrate) navigator.vibrate(60)
    onScan(loc)
  }, [onScan])

  useEffect(() => {
    let detector = null
    let jsQR = null
    let stopped = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (!v) return
        v.srcObject = stream
        await v.play()
        setReady(true)

        // 내장 기능 우선
        if ('BarcodeDetector' in window) {
          try {
            const fmts = await window.BarcodeDetector.getSupportedFormats()
            if (fmts.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] })
          } catch { /* 내장 실패 시 아래로 */ }
        }
        // 없으면 jsQR
        if (!detector) {
          const mod = await import('jsqr')
          jsQR = mod.default || mod
        }
        loop()
      } catch (e) {
        setErr(
          e.name === 'NotAllowedError' ? '카메라 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.'
          : e.name === 'NotFoundError' ? '카메라를 찾을 수 없습니다.'
          : '카메라를 열 수 없습니다: ' + e.message
        )
      }
    }

    async function loop() {
      if (stopped || doneRef.current) return
      const v = videoRef.current
      if (v && v.readyState === 4) {
        try {
          if (detector) {
            const codes = await detector.detect(v)
            if (codes?.length) handleHit(codes[0].rawValue)
          } else if (jsQR) {
            const c = canvasRef.current
            const w = v.videoWidth, h = v.videoHeight
            if (c && w && h) {
              c.width = w; c.height = h
              const ctx = c.getContext('2d', { willReadFrequently: true })
              ctx.drawImage(v, 0, 0, w, h)
              const img = ctx.getImageData(0, 0, w, h)
              const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
              if (r?.data) handleHit(r.data)
            }
          }
        } catch { /* 프레임 하나 실패는 넘어간다 */ }
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [handleHit])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* 카메라 */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted
          className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* 조준 틀 */}
        {ready && !err && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative" style={{ width: '62vw', height: '62vw', maxWidth: 300, maxHeight: 300 }}>
              {[['top-0 left-0', 'border-t-4 border-l-4'], ['top-0 right-0', 'border-t-4 border-r-4'],
                ['bottom-0 left-0', 'border-b-4 border-l-4'], ['bottom-0 right-0', 'border-b-4 border-r-4']]
                .map(([pos, b]) => (
                  <div key={pos} className={`absolute ${pos} w-10 h-10 ${b} border-white rounded-sm`} />
                ))}
            </div>
          </div>
        )}

        {!ready && !err && (
          <p className="absolute inset-0 flex items-center justify-center text-white text-sm">카메라 준비 중…</p>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-white text-sm text-center leading-relaxed">{err}</p>
          </div>
        )}

        <button onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 text-white text-xl">✕</button>
      </div>

      {/* 안내 · 직접 입력 */}
      <div className="bg-white p-4 space-y-3">
        <p className="text-xs text-slate-500 text-center">
          랙에 붙인 위치 태그를 비추면 자동으로 열립니다
        </p>
        <div className="flex gap-2">
          <input value={manual} onChange={e => setManual(e.target.value)}
            onKeyDown={e => { const l = parseLoc(manual); if (e.key === 'Enter' && l && !doneRef.current) { doneRef.current = true; onScan(l) } }}
            placeholder="직접 입력 (예: A1-01-3)"
            className="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-lg uppercase" />
          <button onClick={() => { const l = parseLoc(manual); if (l && !doneRef.current) { doneRef.current = true; onScan(l) } }}
            disabled={!parseLoc(manual)}
            className="px-4 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-30">
            이동
          </button>
        </div>
      </div>
    </div>
  )
}
