import { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toastError, toastSuccess } from '../lib/toast'
import Spin from './ux/Spin'
import { useMe, myAuthUser } from '../hooks/useProfile'
import {
  canPickDir, loadDir, saveDir, dirPermission, listPdfs, listFromInput, indexFiles,
  findOcr, findDwg, judge, buildPdf, recordPrinted, fillTokens,
  fetchDwgRecords, pickDwgRecord, commonDir, fileByPath, revKey,
} from '../lib/harnessPrint'

// 🖨 작업지시서 · 도면 출력 (v4.230.0) — 하네스 출도 · 불출에서 고른 AXCELIS 줄을 바로 출력
//   orders: [{ key, order, isNew }] — 부르는 쪽(HarnessRelease)이 공정관리 건과 맞춰 둔 것
//   mode 'ed' (v4.231.0) — Edwards: 작업지시서 없이 도면만. 파일은 도면 조회 자료(pm_drawings)의 NAS 경로로 바로 연다
//     ⚠ 지금은 PDF 만 (QR · 공정관리 기록 없음) — 실제 담당자가 따로 출도 중이라 형식만 갖춰 두고 확인 뒤 켠다
//   ⚠ 창은 닫기 버튼으로만 닫힌다 (바깥을 눌러도 안 닫힘)

const FOLDERS = [
  { key: 'ocr', t: '📄 작업지시서 (OCR) 폴더', hint: '파일명 도번_REV.pdf', path: '\\\\jinsuntech-nas\\1. 공용폴더\\♠ QR ♠\\3. AXCELIS_QR\\Axcelis_OCR\\※ Axcelis_[OCR 개별 지시서]' },
  { key: 'dwg', t: '📐 도면 (Conversion) 폴더', hint: '파일명 도번_REV[_판].pdf', path: '\\\\jinsuntech-nas\\1. 공용폴더\\1. 업체별 프로젝트\\3. AXCELIS\\1. 도면\\3. 하네스 도면\\2. Conversion 도면' },
]
const REC0 = { wo: 1, dwg: 1, first: 'wo' }
const HF0 = { header: { on: false, l: '', c: '{프로젝트} {도번} {REV}', r: '' }, footer: { on: false, l: '', c: '{페이지} / {전체}', r: '{수량} {납기}' } }
const kept = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ? { ...d, ...v } : d } catch { return d } }
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* 기억 못 해도 그대로 */ } }

function useFolder(key, deep = true) {
  const [st, setSt] = useState({ phase: 'load' })   // load · none · ask · scan · ready · err
  const handleRef = useRef(null)
  const scan = async (h, name) => {
    if (!deep) { setSt({ phase: 'ready', name, handle: h }); return }   // 경로로 바로 여는 폴더 — 훑지 않는다
    setSt({ phase: 'scan', name })
    try {
      const list = await listPdfs(h)
      setSt({ phase: 'ready', name, count: list.length, idx: indexFiles(list) })
    } catch (e) { setSt({ phase: 'err', name, msg: e.message }) }
  }
  useEffect(() => {
    let off = false
    ;(async () => {
      const h = canPickDir() ? await loadDir(key) : null
      if (off) return
      if (!h) { setSt({ phase: 'none' }); return }
      handleRef.current = h
      const p = await dirPermission(h)
      if (off) return
      if (p === 'granted') scan(h, h.name); else setSt({ phase: 'ask', name: h.name })
    })()
    return () => { off = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const allow = async () => {
    const h = handleRef.current; if (!h) return
    if ((await dirPermission(h, true)) === 'granted') scan(h, h.name)
  }
  const pick = async () => {
    try {
      const h = await window.showDirectoryPicker({ id: `hr-${key}`, mode: 'read' })
      handleRef.current = h; await saveDir(key, h); scan(h, h.name)
    } catch (e) { if (e?.name !== 'AbortError') toastError('폴더를 열지 못했습니다: ' + e.message) }
  }
  const fromInput = (files) => {
    const list = listFromInput(files || [])
    const name = (files?.[0]?.webkitRelativePath || '').split('/')[0] || '(폴더)'
    setSt({ phase: 'ready', name, count: list.length, idx: indexFiles(list), temp: true, files: [...(files || [])] })
  }
  return { st, allow, pick, fromInput }
}

function FolderCard({ f, fo }) {
  const s = fo.st
  const inRef = useRef(null)
  const tone = s.phase === 'ready' ? 'border-emerald-200 bg-emerald-50/50' : s.phase === 'ask' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50'
  const copyPath = async () => { try { await navigator.clipboard.writeText(f.path); toastSuccess('경로를 복사했습니다 — 폴더 고르는 창 주소칸에 붙여넣으세요') } catch { toastError('복사가 막혔습니다') } }
  return (
    <div className={`rounded-xl border p-3 text-xs ${tone}`} data-hp-folder={f.key}>
      <div className="font-bold text-slate-700">{f.t}</div>
      <div className="mt-1 min-h-[18px]">
        {s.phase === 'load' && <span className="text-slate-400">확인 중…</span>}
        {s.phase === 'scan' && <span className="inline-flex items-center gap-1.5 text-slate-500"><Spin />{s.name} 읽는 중… (파일이 많으면 조금 걸립니다)</span>}
        {s.phase === 'ready' && <span className="text-emerald-700 font-bold">✓ {s.name}{s.count != null ? ` · PDF ${s.count.toLocaleString('ko-KR')}개` : ' 연결됨'}{s.temp ? ' (이번만)' : ''}</span>}
        {s.phase === 'ask' && <button type="button" onClick={fo.allow} className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 font-bold text-amber-700">🔓 {s.name} 허용</button>}
        {s.phase === 'none' && <span className="text-slate-500">아직 연결 안 됨</span>}
        {s.phase === 'err' && <span className="text-rose-600 font-bold">읽기 실패 — {s.msg}</span>}
      </div>
      <div className="text-slate-400 mt-1.5 flex flex-wrap gap-x-2">
        <span>{f.hint}</span>
        {canPickDir()
          ? <button type="button" onClick={fo.pick} className="underline hover:text-slate-600">{s.phase === 'none' ? '폴더 고르기' : '다시 고르기'}</button>
          : <><button type="button" onClick={() => inRef.current?.click()} className="underline hover:text-slate-600">폴더 고르기</button>
              <input ref={inRef} type="file" webkitdirectory="" directory="" multiple className="hidden" onChange={(e) => { fo.fromInput(e.target.files); e.target.value = '' }} /></>}
        <button type="button" onClick={copyPath} className="underline hover:text-slate-600">NAS 경로 복사</button>
        {canPickDir() && <span>· 이 PC 에 기억</span>}
      </div>
    </div>
  )
}

export default function HarnessPrintModal(props) {
  return props.mode === 'ed' ? <EdPrint {...props} /> : <AxPrint {...props} />
}

function AxPrint({ orders, onClose, onDone }) {
  const qc = useQueryClient()
  const me = useMe()
  const ocr = useFolder('ocr'), dwg = useFolder('dwg')
  const [rec, setRec] = useState(() => kept('hr.print.rec', REC0))
  const [hf, setHf] = useState(() => kept('hr.print.hf', HF0))
  const [pick, setPick] = useState(null)        // 고른 줄 (처음엔 「준비」만)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState(null)        // { url, name, n, added, marked, recErr }
  useEffect(() => keep('hr.print.rec', rec), [rec])
  useEffect(() => keep('hr.print.hf', hf), [hf])

  const ready = ocr.st.phase === 'ready'
  const rows = useMemo(() => orders.map((x) => {
    const o = ready ? findOcr(ocr.st.idx, x.order) : null
    const d = dwg.st.phase === 'ready' ? findDwg(dwg.st.idx, x.order) : null
    return { ...x, ocr: o, dwg: d, j: judge(x.order, o, d) }
  }), [orders, ocr.st, dwg.st, ready])
  useEffect(() => { if (ready && pick === null) setPick(new Set(rows.filter((r) => r.j.status === 'ok').map((r) => r.key))) }, [ready, rows, pick])
  const sel = pick || new Set()
  const chosen = rows.filter((r) => sel.has(r.key) && r.ocr)
  const cnt = { ok: rows.filter((r) => r.j.status === 'ok').length, rev: rows.filter((r) => r.j.status === 'rev').length, no: rows.filter((r) => r.j.status === 'noOcr').length }
  const dwgSheets = chosen.filter((r) => r.dwg).length

  async function make() {
    if (!chosen.length) return
    const w = window.open('', '_blank')   // 누른 순간 창을 열어 둔다 (다 만든 뒤 열면 팝업이 막힌다)
    setBusy('PDF 만드는 중…')
    try {
      const { blob } = await buildPdf(chosen, rec, hf, (i, n) => setBusy(`PDF 만드는 중… ${i + 1} / ${n}`))
      const url = URL.createObjectURL(blob)
      const d = new Date(), p2 = (v) => String(v).padStart(2, '0')
      const name = `하네스출력_AXCELIS_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.pdf`
      if (w) w.location.href = url
      setBusy('공정관리에 기록하는 중…')
      let r = null, recErr = ''
      try {
        const au = await myAuthUser()
        r = await recordPrinted(chosen, { name: me?.name, email: au?.email }, name)
      } catch (e) { recErr = e.message }
      setDone({ url, name, n: chosen.length, added: r?.added || 0, marked: r?.marked || 0, recErr, opened: !!w })
      if (!recErr) toastSuccess(`${chosen.length}건 출력 — 공정관리 등록 ${r.added} · 출력 표시 ${r.marked}`)
      else toastError(recErr)
      qc.invalidateQueries({ queryKey: ['harnessRelease'], exact: false })
      onDone?.()
    } catch (e) {
      try { w?.close() } catch { /* 이미 닫힘 */ }
      toastError('출력 실패: ' + e.message)
    } finally { setBusy('') }
  }
  const missCopy = async () => {
    const t = rows.filter((r) => r.j.status === 'noOcr').map((r) => `${r.order.dwg_no}\t${r.order.rev}`).join('\n')
    try { await navigator.clipboard.writeText(t); toastSuccess('지시서 없는 도번을 복사했습니다') } catch { toastError('복사가 막혔습니다') }
  }
  const setHF = (k, patch) => setHf((v) => ({ ...v, [k]: { ...v[k], ...patch } }))
  const sample = orders[0]?.order || {}

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-harness-print>
      <div className="bg-white w-full max-w-5xl rounded-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
          <b className="text-base text-slate-800">🖨 작업지시서 · 도면 출력 — AXCELIS {orders.length}줄</b>
          <button type="button" onClick={onClose} disabled={!!busy} className="ml-auto px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-500 disabled:opacity-40">닫기 ✕</button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {!canPickDir() && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">이 브라우저는 폴더를 기억하지 못합니다 — 크롬 · 엣지에서 쓰면 한 번 고른 폴더를 기억합니다. 지금은 매번 고릅니다.</div>}
          <div className="grid md:grid-cols-2 gap-3">{FOLDERS.map((f) => <FolderCard key={f.key} f={f} fo={f.key === 'ocr' ? ocr : dwg} />)}</div>

          {!ready ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-400">작업지시서 폴더를 연결하면 줄마다 지시서 · 도면을 찾아 REV 를 대조합니다</div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-slate-500 text-[11px]">
                  <tr className="text-left">
                    <th className="px-3 py-2 w-8"><input type="checkbox" checked={rows.filter((r) => r.ocr).every((r) => sel.has(r.key)) && rows.some((r) => r.ocr)}
                      onChange={(e) => setPick(e.target.checked ? new Set(rows.filter((r) => r.ocr).map((r) => r.key)) : new Set())} /></th>
                    <th className="px-3 py-2">도번</th><th className="px-3 py-2">PO · 라인</th><th className="px-3 py-2 text-right">수량</th>
                    <th className="px-3 py-2">납기</th><th className="px-3 py-2">REV (PO · 지시서 · 도면)</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">공정관리</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const o = r.order, s = r.j.status
                    const tag = s === 'ok' ? (r.dwg || dwg.st.phase !== 'ready' ? ['✓ 준비', 'bg-emerald-50 text-emerald-700'] : ['지시서만 (도면 없음)', 'bg-sky-50 text-sky-700'])
                      : s === 'rev' ? ['⚠ REV 다름 (빼 둠)', 'bg-amber-50 text-amber-700'] : ['지시서 없음', 'bg-rose-50 text-rose-600']
                    const odd = (v) => v && o.rev && v !== '?' && v.toUpperCase() !== String(o.rev).toUpperCase()
                    return (
                      <tr key={r.key} className={`border-t border-slate-100 ${s === 'rev' ? 'bg-amber-50/40' : s === 'noOcr' ? 'bg-rose-50/30' : ''}`} data-hp-row={o.dwg_no}>
                        <td className="px-3 py-2"><input type="checkbox" disabled={!r.ocr} checked={sel.has(r.key)} onChange={() => setPick((v) => { const x = new Set(v || []); x.has(r.key) ? x.delete(r.key) : x.add(r.key); return x })} /></td>
                        <td className="px-3 py-2 font-mono font-bold">{o.dwg_no}</td>
                        <td className="px-3 py-2 font-mono">{o.po} · {o.ord_ln || '-'}/{o.del_ln || '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.qty}</td>
                        <td className="px-3 py-2 tabular-nums">{String(o.due || '').slice(5)}</td>
                        <td className="px-3 py-2 font-mono">{r.j.pr || '?'} · <span className={odd(r.j.wr) ? 'text-amber-700 font-bold' : ''}>{r.j.wr || '—'}</span> · <span className={odd(r.j.dr) ? 'text-amber-700 font-bold' : ''}>{dwg.st.phase === 'ready' ? (r.j.dr || '없음') : '—'}</span></td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${tag[1]}`}>{tag[0]}</span></td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.isNew ? '새로 등록' : '등록된 건'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-2" data-hp-opts>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-bold text-slate-500">부수</span>
              <label className="flex items-center gap-1">지시서 <input type="number" min="0" max="9" value={rec.wo} onChange={(e) => setRec((v) => ({ ...v, wo: Math.max(0, Math.min(9, +e.target.value || 0)) }))} className="w-12 px-1.5 py-0.5 border rounded text-right" /></label>
              <label className="flex items-center gap-1">도면 <input type="number" min="0" max="9" value={rec.dwg} onChange={(e) => setRec((v) => ({ ...v, dwg: Math.max(0, Math.min(9, +e.target.value || 0)) }))} className="w-12 px-1.5 py-0.5 border rounded text-right" /></label>
              <label className="flex items-center gap-1">순서
                <select value={rec.first} onChange={(e) => setRec((v) => ({ ...v, first: e.target.value }))} className="px-1.5 py-0.5 border rounded bg-white"><option value="wo">지시서 → 도면</option><option value="dwg">도면 → 지시서</option></select>
              </label>
              <span className="ml-auto text-slate-400">공정관리 AXCELIS 기본값 (지시서 1 · 도면 1 · 지시서 먼저)</span>
            </div>
            <HfRows hf={hf} setHF={setHF} sample={sample} />
            <div className="text-[11px] text-slate-400">쓸 수 있는 꼬리표: {'{프로젝트} {도번} {REV} {PO} {오더라인} {납품라인} {수량} {납기} {CCN} {불출일} {페이지} {전체}'} · 이 PC 에 기억</div>
          </div>

          {done && (
            <div className={`rounded-xl border px-4 py-3 ${done.recErr ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`} data-hp-done>
              <b className={done.recErr ? 'text-rose-700' : 'text-emerald-700'}>{done.recErr ? '⚠ PDF 는 만들었지만 공정관리 기록이 안 됐습니다' : `✅ ${done.n}건 출력 — 공정관리 새 등록 ${done.added} · 출력 표시 ${done.marked}`}</b>
              {done.recErr && <div className="text-rose-600 mt-1">{done.recErr} — 이 상태로 현장에서 스캔하면 「등록할까요?」가 뜹니다. 화면을 캡처해 알려 주세요.</div>}
              <div className="mt-2 flex gap-2">
                <a href={done.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-white border font-bold text-slate-700">📄 PDF 열기{done.opened ? ' (새 창에 열림)' : ''}</a>
                <a href={done.url} download={done.name} className="px-3 py-1.5 rounded-lg bg-white border font-bold text-slate-700">💾 저장</a>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-3 text-xs">
          <span className="text-slate-500">{ready ? <>준비 <b className="text-slate-800">{cnt.ok}</b> · REV 다름 {cnt.rev} · 지시서 없음 {cnt.no} → 고른 {chosen.length}건 = 지시서 {chosen.length * rec.wo}부 + 도면 {dwgSheets * rec.dwg}부</> : '폴더를 연결하세요'}</span>
          {cnt.no > 0 && <button type="button" onClick={missCopy} className="ml-auto px-3 py-2 rounded-lg border font-bold text-slate-600">📋 없는 도번 복사</button>}
          <button type="button" onClick={make} disabled={!chosen.length || !!busy || !!done} data-hp-make
            className={`${cnt.no > 0 ? '' : 'ml-auto '}inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6c5ce7] text-white font-bold disabled:opacity-40`}>
            {busy ? <><Spin />{busy}</> : done ? '✓ 출력함 — 다시 뽑으려면 창을 닫고 다시 여세요' : `🖨 PDF 만들기 (${chosen.length}건)`}
          </button>
        </div>
        <div className="px-5 pb-3 text-[11px] text-slate-400">만들면 PDF 가 새 창에 열리고, 공정관리에 건 등록(없으면) + 「출력됨」 표시 + 출력 이력이 남아 이 화면 「출력됨 · 불출 대기」로 넘어갑니다. 현장 폰 스캔은 지금과 같습니다.</div>
      </div>
    </div>
  )
}

// 머릿말 · 꼬리말 칸 (AXCELIS · Edwards 같이 씀)
function HfRows({ hf, setHF, sample }) {
  return [['header', '머릿말'], ['footer', '꼬리말']].map(([k, t]) => (
    <div key={k} className="flex items-center gap-2 flex-wrap">
      <label className="flex items-center gap-1 font-bold text-slate-500 w-16"><input type="checkbox" checked={!!hf[k].on} onChange={(e) => setHF(k, { on: e.target.checked })} />{t}</label>
      {['l', 'c', 'r'].map((p) => (
        <input key={p} value={hf[k][p] || ''} disabled={!hf[k].on} onChange={(e) => setHF(k, { [p]: e.target.value })} placeholder={{ l: '왼쪽', c: '가운데', r: '오른쪽' }[p]}
          className="flex-1 min-w-[140px] px-2 py-1 border rounded font-mono text-[11px] disabled:opacity-40" />
      ))}
      {hf[k].on && <span className="text-slate-400 basis-full pl-[72px]">예) {['l', 'c', 'r'].map((p) => fillTokens(hf[k][p], sample, 1, 2)).filter(Boolean).join('   |   ') || '(비어 있음)'}</span>}
    </div>
  ))
}

const ED_REC0 = { wo: 0, dwg: 1, first: 'dwg' }
const ED_HF0 = { header: { on: true, l: '{PO} {오더라인}/{납품라인}', c: '{도번} Rev {REV}', r: '' }, footer: { on: true, l: '', c: '{페이지} / {전체}', r: '수량 {수량} · 납기 {납기}' } }

// Edwards — 도면만 · PDF 만 (v4.231.0)
function EdPrint({ orders, onClose }) {
  const root = useFolder('edroot', false)
  const [recs, setRecs] = useState(null)        // pm_drawings 자료
  const [files, setFiles] = useState({})        // key → 연 파일 | null
  const [rec, setRec] = useState(() => kept('hr.print.rec.ed', ED_REC0))
  const [hf, setHf] = useState(() => kept('hr.print.hf.ed', ED_HF0))
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState(null)
  useEffect(() => keep('hr.print.rec.ed', rec), [rec])
  useEffect(() => keep('hr.print.hf.ed', hf), [hf])
  useEffect(() => {
    let off = false
    fetchDwgRecords([...new Set(orders.map((x) => x.order.std_code).filter(Boolean))])
      .then((r) => { if (!off) setRecs(r) }).catch((e) => { if (!off) { setRecs([]); toastError(e.message) } })
    return () => { off = true }
  }, [orders])
  const byCode = useMemo(() => { const m = {}; (recs || []).forEach((r) => { (m[r.std_code] ||= []).push(r) }); return m }, [recs])
  const rows = useMemo(() => orders.map((x) => ({ ...x, rec: pickDwgRecord(byCode[x.order.std_code], x.order.rev) })), [orders, byCode])
  const suggest = useMemo(() => commonDir(rows.map((r) => r.rec?.file_path)), [rows])
  // 연결한 폴더 안에서 경로대로 파일을 연다
  useEffect(() => {
    if (root.st.phase !== 'ready' || !recs) return
    let off = false
    ;(async () => {
      const m = {}
      for (const r of rows) {
        if (!r.rec) { m[r.key] = null; continue }
        if (root.st.handle) m[r.key] = await fileByPath(root.st.handle, r.rec.file_path)
        else {   // 폴더 접근이 안 되는 브라우저 — 고른 파일 목록에서 경로 끝이 같은 것
          const tail = String(r.rec.file_path).split('\\').slice(-2).join('/')
          const f = (root.st.files || []).find((x) => (x.webkitRelativePath || '').endsWith(tail))
          m[r.key] = f ? { name: f.name, get: async () => f } : null
        }
      }
      if (!off) setFiles(m)
    })()
    return () => { off = true }
  }, [root.st, recs, rows])
  const stOf = (r) => {
    if (!recs) return ['…', 'bg-slate-100 text-slate-400', 'wait']
    if (!r.rec) return ['도면 없음 (도면 조회에 없음)', 'bg-rose-50 text-rose-600', 'none']
    if (root.st.phase !== 'ready') return ['폴더 연결 필요', 'bg-slate-100 text-slate-500', 'wait']
    if (!(r.key in files)) return ['찾는 중…', 'bg-slate-100 text-slate-400', 'wait']
    if (!files[r.key]) return ['연결한 폴더 밖 / 파일 없음', 'bg-rose-50 text-rose-600', 'none']
    if (r.order.rev && revKey(r.order.rev) !== revKey(r.rec.rev)) return ['⚠ REV 다름 (빼 둠)', 'bg-amber-50 text-amber-700', 'rev']
    return ['✓ 준비', 'bg-emerald-50 text-emerald-700', 'ok']
  }
  const allReady = recs && (root.st.phase !== 'ready' || rows.every((r) => !r.rec || r.key in files))
  useEffect(() => { if (allReady && root.st.phase === 'ready' && pick === null) setPick(new Set(rows.filter((r) => stOf(r)[2] === 'ok').map((r) => r.key))) }, [allReady, files]) // eslint-disable-line react-hooks/exhaustive-deps
  const sel = pick || new Set()
  const chosen = rows.filter((r) => sel.has(r.key) && files[r.key])
  const setHF = (k, patch) => setHf((v) => ({ ...v, [k]: { ...v[k], ...patch } }))

  async function make() {
    if (!chosen.length) return
    const w = window.open('', '_blank')
    setBusy('PDF 만드는 중…')
    try {
      const targets = chosen.map((r) => ({ order: { ...r.order, rev: r.order.rev || r.rec.rev }, ocr: null, dwg: files[r.key] }))
      const { blob } = await buildPdf(targets, { wo: 0, dwg: Math.max(1, rec.dwg), first: 'dwg' }, hf, (i, n) => setBusy(`PDF 만드는 중… ${i + 1} / ${n}`))
      const url = URL.createObjectURL(blob)
      const d = new Date(), p2 = (v) => String(v).padStart(2, '0')
      const name = `도면출력_Edwards_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.pdf`
      if (w) w.location.href = url
      setDone({ url, name, n: chosen.length, opened: !!w })
      toastSuccess(`${chosen.length}건 도면 PDF`)
    } catch (e) { try { w?.close() } catch { /* 닫힘 */ } toastError('출력 실패: ' + e.message) } finally { setBusy('') }
  }
  const copySuggest = async () => { try { await navigator.clipboard.writeText(suggest); toastSuccess('경로를 복사했습니다 — 폴더 고르는 창 주소칸에 붙여넣으세요') } catch { toastError('복사가 막혔습니다') } }
  const sample = orders[0]?.order || {}

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-harness-print="ed">
      <div className="bg-white w-full max-w-5xl rounded-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
          <b className="text-base text-slate-800">🖨 도면 출력 — Edwards {orders.length}줄</b>
          <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold">시험 운영 · PDF 만 (공정관리 기록 · QR 없음)</span>
          <button type="button" onClick={onClose} disabled={!!busy} className="ml-auto px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-500 disabled:opacity-40">닫기 ✕</button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-600">
            작업지시서 없이 <b>도면만</b> 뽑습니다. 도면 파일은 「📐 도면 조회」와 같은 자료(NAS 스캔)로 경로를 알아 그 파일만 엽니다 — 폴더를 훑지 않습니다.
            실제 출도는 담당자가 따로 하고 있어 지금은 <b>형식 확인용</b>이고, 공정관리 등록 · QR 은 확인 뒤 켭니다.
          </div>
          <FolderCard f={{ key: 'edroot', t: '📐 Edwards 도면 폴더', hint: '아래 경로(또는 그 위 폴더)를 한 번 연결', path: suggest || '(도면 조회 자료를 읽는 중)' }} fo={root} />
          {suggest && <div className="text-[11px] text-slate-500 -mt-2">이 줄들의 도면이 있는 곳: <span className="font-mono">{suggest}</span> <button type="button" onClick={copySuggest} className="underline">복사</button></div>}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500 text-[11px]">
                <tr className="text-left">
                  <th className="px-3 py-2 w-8"><input type="checkbox" checked={rows.some((r) => files[r.key]) && rows.filter((r) => files[r.key]).every((r) => sel.has(r.key))}
                    onChange={(e) => setPick(e.target.checked ? new Set(rows.filter((r) => files[r.key]).map((r) => r.key)) : new Set())} /></th>
                  <th className="px-3 py-2">도번</th><th className="px-3 py-2">PO · 라인</th><th className="px-3 py-2 text-right">수량</th><th className="px-3 py-2">납기</th>
                  <th className="px-3 py-2">REV (PO · 도면)</th><th className="px-3 py-2">파일</th><th className="px-3 py-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const o = r.order, t = stOf(r)
                  return (
                    <tr key={r.key} className="border-t border-slate-100" data-hp-row={o.dwg_no}>
                      <td className="px-3 py-2"><input type="checkbox" disabled={!files[r.key]} checked={sel.has(r.key)} onChange={() => setPick((v) => { const x = new Set(v || []); x.has(r.key) ? x.delete(r.key) : x.add(r.key); return x })} /></td>
                      <td className="px-3 py-2 font-mono font-bold">{o.dwg_no}</td>
                      <td className="px-3 py-2 font-mono">{o.po} · {o.ord_ln || '-'}/{o.del_ln || '-'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.qty}</td>
                      <td className="px-3 py-2 tabular-nums">{String(o.due || '').slice(5)}</td>
                      <td className="px-3 py-2 font-mono">{o.rev || '?'} · {r.rec ? `${r.rec.rev}${r.rec.is_conv ? ' (컨버팅)' : ''}` : '—'}</td>
                      <td className="px-3 py-2 text-slate-500 truncate max-w-[220px]" title={r.rec?.file_path || ''}>{r.rec?.file_name || '—'}</td>
                      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${t[1]}`}>{t[0]}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-4">
              <span className="font-bold text-slate-500">부수</span>
              <label className="flex items-center gap-1">도면 <input type="number" min="1" max="9" value={rec.dwg} onChange={(e) => setRec((v) => ({ ...v, dwg: Math.max(1, Math.min(9, +e.target.value || 1)) }))} className="w-12 px-1.5 py-0.5 border rounded text-right" /></label>
              <span className="text-slate-400">도면은 A4 로 맞추고 회전을 바로 세웁니다</span>
            </div>
            <HfRows hf={hf} setHF={setHF} sample={sample} />
          </div>
          {done && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <b className="text-emerald-700">✅ 도면 {done.n}건 PDF — 공정관리에는 기록하지 않았습니다 (시험 운영)</b>
              <div className="mt-2 flex gap-2">
                <a href={done.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-white border font-bold text-slate-700">📄 PDF 열기{done.opened ? ' (새 창에 열림)' : ''}</a>
                <a href={done.url} download={done.name} className="px-3 py-1.5 rounded-lg bg-white border font-bold text-slate-700">💾 저장</a>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-3 text-xs">
          <span className="text-slate-500">고른 {chosen.length}건 = 도면 {chosen.length * rec.dwg}부</span>
          <button type="button" onClick={make} disabled={!chosen.length || !!busy} data-hp-make
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6c5ce7] text-white font-bold disabled:opacity-40">
            {busy ? <><Spin />{busy}</> : `🖨 도면 PDF 만들기 (${chosen.length}건)`}
          </button>
        </div>
      </div>
    </div>
  )
}
