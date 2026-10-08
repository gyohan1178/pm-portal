import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

// 창고 배치도 3D 보기.
//   배치도(2D)와 같은 자료를 그대로 받아 그린다 — 새 조회·새 SQL 없음.
//     racks : pm_rack_usage  (code · grid_x/y/w/h · rows_cnt · levels_cnt · cells_used/total)
//     objs  : pm_floor_object (kind · label · color · grid_x/y/w/h)
//   상자 「개수」는 실제 사용 칸 수이고, 상자가 놓인 「자리」는 보기용이다.
//   (칸별 실제 품목은 랙을 누르면 오른쪽 창과 랙 구성표에서 본다)
//   three 는 이 파일에서만 쓴다. RackLayout 이 lazy 로 불러 첫 화면 번들에 안 들어간다.

const U = 0.75                 // 격자 1칸 = 3D 0.75
const LVH = 0.8                // 한 층 높이
const pctOf = (r) => {
  const t = Number(r.cells_total) || 0, u = Number(r.cells_used) || 0
  return t ? Math.round(u / t * 100) : 0
}
// 색 기준은 2D 배치도와 같다 (0 회색 · 40 미만 초록 · 75 미만 주황 · 그 이상 빨강)
const stOf = (p) => (p === 0 ? 'none' : p < 40 ? 'ok' : p < 75 ? 'warn' : 'bad')
const COL = {
  none: { b: 0x94a3b8, g: 0xeef1f5, label: '빈 랙', cls: 'bg-slate-100 text-slate-600' },
  ok: { b: 0x10b981, g: 0xd1fae5, label: '여유', cls: 'bg-emerald-100 text-emerald-700' },
  warn: { b: 0xf59e0b, g: 0xfef3c7, label: '주의', cls: 'bg-amber-100 text-amber-700' },
  bad: { b: 0xf43f5e, g: 0xffe4e6, label: '포화', cls: 'bg-rose-100 text-rose-700' },
}
const OBJ = {
  '기둥': { c: 0x1e293b, h: 4.4 },
  '벽': { c: 0x475569, h: 1.5 },
  '출입구': { c: 0x22c55e, h: 1.55 },
  '통로': { c: 0xfef3c7, h: 0.03 },
  '설비': { c: 0xfed7aa, h: 1.2 },
  '문서': { c: 0xe7e5e4, h: 0.4 },
  '기타': { c: 0xf1f5f9, h: 0.5 },
}
const BOXC = [0xd8b07c, 0xcfa46c, 0xe2bf8e, 0xc79a62, 0x8fb3e8, 0xe9e3d6]

// 랙 코드로 정해지는 난수 — 다시 그려도 상자 자리가 바뀌지 않게
function rng(str) {
  let s = 0
  for (const ch of String(str)) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function RackLayout3D({ racks = [], objs = [], gw = 80, gh = 62, sel = '', cells = [], onSelect, onOpenSheet }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const labelRef = useRef(null)
  const apiRef = useRef(null)
  const selRef = useRef(sel)
  const pickRef = useRef(onSelect)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('all')
  pickRef.current = onSelect
  selRef.current = sel

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current, labWrap = labelRef.current
    if (!wrap || !canvas || !labWrap) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch (e) {
      setErr('이 기기·브라우저에서는 3D 를 그릴 수 없습니다. 배치도 탭을 이용해 주세요.')
      return
    }
    setErr('')
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 1, 900)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9cde6, 2.5))
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1)
    sun.position.set(-28, 48, 26); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006
    const half = Math.max(gw, gh) * U * 0.75
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 160 })
    scene.add(sun)

    const disposables = []
    const lam = (c) => { const m = new THREE.MeshLambertMaterial({ color: c }); disposables.push(m); return m }
    const geo = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); disposables.push(g); return g }
    const box = (w, h, d, mat, x, y, z, parent, shadow = true) => {
      const m = new THREE.Mesh(geo(w, h, d), typeof mat === 'number' ? lam(mat) : mat)
      m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true
      ;(parent || scene).add(m); return m
    }
    const X = (g) => (g - gw / 2) * U, Z = (g) => (g - gh / 2) * U

    // 바닥 — 2D 배치도와 같은 격자 무늬
    const gc = document.createElement('canvas'); gc.width = gc.height = 64
    const g2 = gc.getContext('2d')
    g2.fillStyle = '#f8fafc'; g2.fillRect(0, 0, 64, 64)
    g2.strokeStyle = '#e2e8f0'; g2.lineWidth = 2; g2.strokeRect(0, 0, 64, 64)
    const gtex = new THREE.CanvasTexture(gc)
    gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(gw / 2, gh / 2)
    const floorMat = new THREE.MeshLambertMaterial({ map: gtex }); disposables.push(gtex, floorMat)
    box(gw * U, 0.2, gh * U, floorMat, 0, -0.1, 0, null, false)
    box(gw * U + 1.6, 0.5, gh * U + 1.6, 0xd9dcea, 0, -0.46, 0, null, false)

    const labels = []
    const addLabel = (text, x, y, z, rack) => {
      const el = document.createElement('div')
      el.textContent = text
      el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;pointer-events:none;border-radius:4px;padding:0 4px;'
        + (rack ? 'font:800 10px ui-monospace,Menlo,monospace;background:rgba(255,255,255,.9);color:#0f172a;'
          : 'font:500 10px system-ui,sans-serif;color:#64748b;')
      labWrap.appendChild(el)
      labels.push({ el, x, y, z, rack }); return el
    }

    // 바닥 시설물
    objs.forEach((o) => {
      const st = OBJ[o.kind] || OBJ['기타']
      const w = (Number(o.grid_w) || 1) * U, d = (Number(o.grid_h) || 1) * U
      const x = X((Number(o.grid_x) || 0) + (Number(o.grid_w) || 1) / 2), z = Z((Number(o.grid_y) || 0) + (Number(o.grid_h) || 1) / 2)
      let c = st.c
      if (o.color && o.kind !== '기둥' && o.kind !== '벽') { try { c = new THREE.Color(o.color).getHex() } catch (e) { c = st.c } }
      box(w, st.h, d, c, x, st.h / 2, z, null, st.h > 0.1)
      if (o.kind !== '기둥' && o.kind !== '벽' && (o.label || o.kind) && Number(o.grid_w) >= 3) addLabel(o.label || o.kind, x, st.h + 0.8, z, null)
    })

    // 랙 — 기둥·선반·상자
    const steel = lam(0x7f8bb0), board = lam(0xdfe3ee), boxMat = lam(0xffffff)
    const unit = geo(1, 1, 1), dummy = new THREE.Object3D()
    const inst = (g, mat, list, parent) => {
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, list.length))
      m.count = list.length
      list.forEach((p, i) => {
        dummy.position.set(p[0], p[1], p[2]); dummy.scale.set(p[3] || 1, p[4] || 1, p[5] || 1)
        dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix)
        if (p[6]) m.setColorAt(i, p[6])
      })
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m
    }
    const boxColors = BOXC.map((c) => new THREE.Color(c))
    const picks = [], rk = {}
    racks.forEach((r) => {
      const gwR = Number(r.grid_w ?? 2) || 2, ghR = Number(r.grid_h ?? 8) || 8
      const w = gwR * U, d = ghR * U, vert = d > w
      const L = Math.max(w, d) - 0.1, W = Math.max(0.3, Math.min(w, d) - 0.16)
      const LV = Math.min(8, Math.max(1, Number(r.levels_cnt) || 1))
      const NC = Math.min(60, Math.max(1, Number(r.rows_cnt) || 1))
      const H = LV * LVH + 0.3
      const pct = pctOf(r), st = stOf(pct), rnd = rng(r.code)
      const g = new THREE.Group()
      g.position.set(X((Number(r.grid_x) || 0) + gwR / 2), 0, Z((Number(r.grid_y) || 0) + ghR / 2))
      if (vert) g.rotation.y = Math.PI / 2
      scene.add(g)
      const pad = box(L + 0.1, 0.05, W + 0.16, lam(COL[st].g), 0, 0.025, 0, g, false)
      const nb = Math.max(1, Math.round(L / 2.3)), posts = []
      for (let i = 0; i <= nb; i++) for (const s of [-1, 1]) posts.push([-L / 2 + i * L / nb, H / 2, s * W / 2, 0.08, H, 0.08])
      for (const s of [-1, 1]) posts.push([0, H, s * W / 2, L, 0.08, 0.08])
      inst(unit, steel, posts, g)
      inst(unit, board, Array.from({ length: LV }, (_, i) => [0, 0.12 + i * LVH, 0, L, 0.05, W]), g)
      const slots = []
      for (let c = 0; c < NC; c++) for (let l = 0; l < LV; l++) slots.push({ c, l, k: l + rnd() * 1.7 })
      slots.sort((a, b) => a.k - b.k)
      const nFill = Math.min(slots.length, Math.round(pct / 100 * slots.length))
      const boxes = inst(unit, boxMat, slots.slice(0, nFill).map((q) => {
        const sy = LVH * (0.5 + rnd() * 0.32)
        return [-L / 2 + (q.c + 0.5) * L / NC, 0.15 + q.l * LVH + sy / 2, 0, L / NC * (0.66 + rnd() * 0.2), sy, W * 0.82, boxColors[Math.floor(rnd() * boxColors.length)]]
      }), g)
      // 상자가 하나도 없는 랙도 색 정보는 있어야 한다 (없으면 three r128~ 에서 화면 전체가 안 그려진다)
      if (!nFill) boxes.setColorAt(0, boxColors[0])
      const cap = box(L, 0.1, 0.2, COL[st].b, 0, H + 0.09, 0, g, false)
      const pickMat = new THREE.MeshBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0, depthWrite: false })
      disposables.push(pickMat)
      const pick = new THREE.Mesh(geo(L + 0.1, H + 0.2, W + 0.16), pickMat)
      pick.position.y = H / 2; pick.userData.code = r.code; g.add(pick); picks.push(pick)
      const lab = addLabel(r.code, g.position.x, H + 0.5, g.position.z, r.code)
      rk[r.code] = { st, pad, boxes, cap, pick, lab, H, g }
    })

    // 선택 · 필터 표시
    let edge = null, curSel = '', curFilter = 'all', dirty = true
    const paint = () => {
      if (edge) { edge.parent.remove(edge); edge.geometry.dispose(); edge.material.dispose(); edge = null }
      Object.entries(rk).forEach(([code, o]) => {
        const on = curFilter === 'all' || o.st === curFilter, s = code === curSel
        o.boxes.visible = on; o.cap.visible = on
        o.pad.material.color.setHex(on ? COL[o.st].g : 0xf1f5f9)
        o.pick.material.opacity = s ? 0.16 : 0
        o.lab.style.background = s ? '#4f46e5' : 'rgba(255,255,255,.9)'
        o.lab.style.color = s ? '#fff' : '#0f172a'
        o.lab.style.fontSize = s ? '12px' : '10px'
        o.lab.style.zIndex = s ? 2 : 0
        o.on = on
        if (s) {
          edge = new THREE.LineSegments(new THREE.EdgesGeometry(o.pick.geometry), new THREE.LineBasicMaterial({ color: 0x4f46e5 }))
          edge.position.y = o.H / 2; o.g.add(edge)
        }
      })
      dirty = true
    }

    // 카메라
    const V0 = { th: 1.3, ph: 0.78, zoom: 1 }
    let view = { ...V0 }, ppu = 10
    const applyCam = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      if (!w || !h) return
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false)
      const asp = w / h, halfH = Math.max(gh * U * 0.52, gw * U * 0.5 / asp)
      ppu = h / (2 * halfH) * view.zoom
      camera.aspect = asp; camera.updateProjectionMatrix()
      const R = halfH / Math.tan(14 * Math.PI / 180) / view.zoom
      camera.position.set(R * Math.sin(view.ph) * Math.cos(view.th), R * Math.cos(view.ph), R * Math.sin(view.ph) * Math.sin(view.th))
      camera.lookAt(0, 0, 0)
      dirty = true
    }
    const ro = new ResizeObserver(applyCam); ro.observe(wrap)

    let drag = null
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    const down = (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; try { canvas.setPointerCapture(e.pointerId) } catch (er) { /* 무시 */ } }
    const move = (e) => {
      if (!drag) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY
      view.th += dx * 0.006; view.ph = Math.min(1.4, Math.max(0.08, view.ph - dy * 0.005)); applyCam()
    }
    const up = (e) => {
      if (drag && drag.moved < 6) {
        const b = canvas.getBoundingClientRect()
        ndc.set((e.clientX - b.left) / b.width * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1)
        ray.setFromCamera(ndc, camera)
        const hit = ray.intersectObjects(picks)[0]
        if (hit && pickRef.current) pickRef.current(hit.object.userData.code)
      }
      drag = null
    }
    const cancel = () => { drag = null }
    const zoomBy = (f) => { view.zoom = Math.min(6, Math.max(0.6, view.zoom * f)); applyCam() }
    const wheel = (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 0.9) }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('wheel', wheel, { passive: false })

    // 바뀐 때만 다시 그린다 (움직이는 것이 없으므로 계속 그릴 이유가 없다)
    const v = new THREE.Vector3()
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!dirty) return
      dirty = false
      renderer.render(scene, camera)
      const w = wrap.clientWidth, h = wrap.clientHeight, small = ppu < 17
      labels.forEach((l) => {
        v.set(l.x, l.y, l.z).project(camera)
        l.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px'
        l.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px'
        if (l.rack) {
          const o = rk[l.rack], s = l.rack === curSel
          // 멀리서 보면 이름표가 겹친다 — 선택한 랙과 켜진 랙만, 작은 화면은 2번 면을 숨긴다
          l.el.style.display = (s || (o.on && !(small && /2$/.test(l.rack) && !/^W/i.test(l.rack)))) ? '' : 'none'
        }
      })
    }

    apiRef.current = {
      setSel: (c) => { curSel = c || ''; paint() },
      setFilter: (f) => { curFilter = f; paint() },
      zoom: zoomBy,
      reset: () => { view = { ...V0 }; applyCam() },
    }
    applyCam(); curSel = selRef.current || ''; paint(); frame()

    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel)
      canvas.removeEventListener('wheel', wheel)
      if (edge) { edge.geometry.dispose(); edge.material.dispose() }
      disposables.forEach((x) => x.dispose())
      scene.traverse((o) => { if (o.isInstancedMesh) o.dispose() })
      renderer.dispose()
      labWrap.innerHTML = ''
      apiRef.current = null
    }
  }, [racks, objs, gw, gh])

  useEffect(() => { apiRef.current?.setSel(sel) }, [sel, racks, objs])
  useEffect(() => { apiRef.current?.setFilter(filter) }, [filter, racks, objs])

  const rack = racks.find((r) => r.code === sel)
  const cnt = (s) => racks.filter((r) => stOf(pctOf(r)) === s).length
  const used = (cells || []).filter((c) => (Number(c.item_count) || 0) > 0 || (c.items || []).length || c.codes)
  const btn = 'w-8 h-8 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50'

  return (
    <div className="no-print space-y-2">
      <p className="text-[11px] text-slate-500">
        끌어서 돌리기 · 휠(또는 ＋ －)로 확대 · 랙을 누르면 칸별 현황이 보입니다.
        상자 <b>개수</b>는 실제 사용 칸 수, 상자가 놓인 <b>자리</b>는 보기용입니다.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {[['all', `전체 ${racks.length}`], ['bad', `포화 ${cnt('bad')}`], ['warn', `주의 ${cnt('warn')}`], ['ok', `여유 ${cnt('ok')}`], ['none', `빈 랙 ${cnt('none')}`]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1 text-xs font-bold rounded-full border ${filter === k ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-[1fr_280px]">
        <div ref={wrapRef} className="relative rounded-xl border-2 border-slate-300 overflow-hidden min-w-0"
          style={{ height: '68vh', minHeight: 380, background: 'linear-gradient(#f1f5f9,#e2e8f0)' }}>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
          <div ref={labelRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />
          <div className="absolute left-2 top-2 flex flex-col gap-1">
            <button className={btn} title="확대" onClick={() => apiRef.current?.zoom(1.25)}>＋</button>
            <button className={btn} title="축소" onClick={() => apiRef.current?.zoom(0.8)}>－</button>
            <button className={btn} title="처음 시점으로" onClick={() => apiRef.current?.reset()}>⟲</button>
          </div>
          {err && <div className="absolute inset-0 flex items-center justify-center p-6 text-sm text-slate-600 bg-white/90">{err}</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0 lg:max-h-[68vh] overflow-auto">
          {!rack ? (
            <p className="text-xs text-slate-500">랙을 누르면 여기에 사용률과 칸별 품목이 나옵니다.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold font-mono text-slate-900">{rack.code}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${COL[stOf(pctOf(rack))].cls}`}>{COL[stOf(pctOf(rack))].label}</span>
              </div>
              <div className="text-2xl font-extrabold tabular-nums text-slate-900">{pctOf(rack)}%</div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pctOf(rack)}%` }} />
              </div>
              <p className="text-xs text-slate-600">
                {rack.side ? `${rack.side} · ` : ''}{rack.rows_cnt}칸 {rack.levels_cnt}층 · 사용 {Number(rack.cells_used) || 0} / {Number(rack.cells_total) || 0}칸
              </p>
              {rack.memo && <p className="text-xs text-slate-500 whitespace-pre-wrap">{rack.memo}</p>}
              {onOpenSheet && (
                <button onClick={() => onOpenSheet(rack.code)}
                  className="w-full px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                  📋 랙 구성표 열기
                </button>
              )}
              <div className="text-[11px] font-bold text-slate-500 pt-1">품목이 있는 칸 {used.length}</div>
              <ul className="space-y-1">
                {used.slice(0, 40).map((c) => (
                  <li key={`${c.row_no}-${c.level_no}`} className="text-xs border-t border-slate-100 pt-1 flex gap-2">
                    <span className="font-mono font-bold text-slate-700 shrink-0">{c.row_no}-{c.level_no}</span>
                    <span className="text-slate-600 break-all">{(c.items || []).map((x) => x.std_code).join(', ') || c.codes || ''}</span>
                  </li>
                ))}
                {used.length > 40 && <li className="text-[11px] text-slate-400">… 외 {used.length - 40}칸 (랙 구성표에서 전체 보기)</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
