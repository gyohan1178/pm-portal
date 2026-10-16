import { useCallback, useEffect, useState } from 'react'

// 화면에 남은 높이만큼 칸을 채운다 (v4.63.0) — 표가 남은 높이를 다 쓰고 페이지는 스크롤되지 않게.
//   노트북처럼 낮은 화면에서 「위에 칸이 많아 표가 두세 줄만 보이던」 화면에 쓴다.
//   const [ref, h] = useFillHeight(enabled, 420)  →  <div ref={ref} style={{ height: h || undefined }}>
//   기준은 가장 가까운 <main>(포털 본문) — 그 안에서 칸 위쪽부터 바닥(여백 빼고)까지.
//   ref 는 「붙는 순간」을 알 수 있게 콜백 ref 다 — 불러오는 중이라 칸이 나중에 생겨도 잰다 (v4.64.0)
//   reserve: 칸 아래에 더 붙는 것(바깥 카드 여백 등) 만큼 빼고 잰다
export function useFillHeight(enabled = true, min = 420, reserve = 0) {
  const [node, setNode] = useState(null)
  const ref = useCallback((n) => setNode(n), [])
  const [h, setH] = useState(0)
  useEffect(() => {
    if (!enabled || !node) return
    const fit = () => {
      const main = node.closest('main')
      if (!main) { setH(0); return }
      const pad = parseFloat(getComputedStyle(main).paddingBottom) || 0
      const nb = node.getBoundingClientRect()
      const top = nb.top - main.getBoundingClientRect().top + main.scrollTop
      // 칸 아래에 붙은 것(바깥 카드 여백 · 안내 줄 등)도 화면 안에 들어오게 그만큼 뺀다 (v4.65.0)
      //   v4.66.0: 예전엔 main.scrollHeight 로 쟀는데, 내용이 화면보다 짧으면 scrollHeight 가 화면 높이가 돼
      //   「남은 빈칸」까지 아래 것으로 잡혀 칸이 최소 높이에 갇혔다 (불러오는 중에 처음 잰 화면 — 입고 처리 등)
      //   → 칸에서 위로 올라가며 「진짜로 아래에 있는 형제 칸 + 부모 아래 여백」만 더한다
      let below = 0
      let el = node
      while (el && el !== main && el.parentElement) {
        const parent = el.parentElement
        const eb = el.getBoundingClientRect().bottom
        let last = eb
        for (let s = el.nextElementSibling; s; s = s.nextElementSibling) {
          const cs = getComputedStyle(s)
          if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue
          const r = s.getBoundingClientRect()
          if (r.height > 0 && r.top >= eb - 1) last = Math.max(last, r.bottom + (parseFloat(cs.marginBottom) || 0))
        }
        below += last - eb
        if (parent === main) break   // main 아래 여백은 pad 로 따로 뺀다
        const ps = getComputedStyle(parent)
        below += (parseFloat(ps.paddingBottom) || 0) + (parseFloat(ps.borderBottomWidth) || 0)
        el = parent
      }
      setH(Math.max(min, Math.floor(main.clientHeight - top - pad - Math.max(0, below) - reserve)))
    }
    fit()
    // 화면 크기(글자 비율)가 바뀌면 위쪽 칸 높이도 바뀐다 — 한 박자 뒤에 다시 잰다
    const t = setTimeout(fit, 120)
    window.addEventListener('resize', fit)
    window.addEventListener('pm:viewscale', fit)
    // 위쪽에 안내 줄이 생기거나 사라지면(출고 완료 · 되돌리기 등) 다시 잰다
    let ro = null, raf = 0
    const page = node.closest('main')?.firstElementChild
    const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16)
    const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout
    if (page && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { cancel(raf); raf = later(fit) })
      ro.observe(page)
    }
    return () => { clearTimeout(t); cancel(raf); ro?.disconnect(); window.removeEventListener('resize', fit); window.removeEventListener('pm:viewscale', fit) }
  }, [enabled, min, reserve, node])
  return [ref, enabled ? h : 0]
}
