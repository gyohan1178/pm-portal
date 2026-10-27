// 수주대장 — 발주서 PDF 올리기 (v4.87.0)
//   PDF 여러 개를 끌어 놓으면 → 양식 · 고객사 판별 → 품목 줄 읽기 → 포털 품목 맞추기 → (같은 PO 가 있으면) 변경 비교 → 등록
import { useState, useRef } from 'react'
import { Stepper, ProgressBar } from '../../components/ux/Stepper'
import Spin from '../../components/ux/Spin'
import ItemPicker from '../../components/ItemPicker'
import { pdfLines, parsePO, FORMAT_LABEL } from '../../lib/poPdf'
import { packOf, ORDER_CUSTOMERS, matchLines, loadOrderByNo, diffOrder, saveOrder, lineKey, FIELD_LABEL, fetchPlanned, linkPlanned, planLabel, fillPlan } from '../../lib/orderIntake'
import { toastError, toastSuccess } from '../../lib/toast'

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))

// 품목 맞추기 · 이미 있는 PO 찾기 · 발주 예정 연결 (새 PO = 모든 줄, 이미 있는 PO = 새로 생긴 줄만, v4.90.6)
async function prepare(po, raw) {
  let lines = await matchLines(po.customer, raw)
  const existing = await loadOrderByNo(po.customer, po.po_no)
  const planned = await fetchPlanned(po.customer)
  let diff = null
  if (existing) {
    const added = new Set(diffOrder(existing.pm_order_line || [], lines).added)
    lines = linkPlanned(po, lines, planned, (l) => added.has(l))
    diff = diffOrder(existing.pm_order_line || [], lines)
  } else lines = linkPlanned(po, lines, planned)
  return { lines, existing, diff, planned }
}

// 파일 하나 읽기 — 실패해도 목록에는 남겨 알림을 보여준다
async function readFile(file, readLines = pdfLines) {
  try {
    const po = parsePO(await readLines(file))
    let lines = po.lines.map((l) => ({ ...l }))
    let existing = null, diff = null, planned = []
    if (po.customer && po.po_no) ({ lines, existing, diff, planned } = await prepare(po, lines))
    return { name: file.name, po, lines, existing, diff, planned, ok: true }
  } catch (e) {
    return { name: file.name, po: { kind: null, lines: [], warns: [`읽기 실패 — ${e.message}`] }, lines: [], ok: false }
  }
}

export default function OrderUpload({ onClose, onSaved, meName, readLines }) {
  const [files, setFiles] = useState([])        // [{ name, po, lines, existing, diff, saved, force, allDelivered }]
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [prog, setProg] = useState(null)       // { label, done, total } — 여러 개 읽기 · 한 번에 등록 진행 (v4.104.0)
  const inp = useRef(null)

  async function addFiles(list) {
    const pdfs = [...list].filter((f) => /\.pdf$/i.test(f.name))
    if (!pdfs.length) { toastError('PDF 파일만 올릴 수 있습니다'); return }
    setBusy(true)
    const out = []
    setProg({ label: 'PDF 읽고 점검하는 중', done: 0, total: pdfs.length })
    try {
      for (const f of pdfs) { out.push(await readFile(f, readLines)); setProg((p) => p && { ...p, done: out.length }) }
    } finally {
      if (out.length) setFiles((prev) => { const next = [...prev, ...out]; setSel(prev.length); return next })
      setProg(null); setBusy(false)
    }
  }

  const cur = files[sel]
  const setCur = (patch) => setFiles((fs) => fs.map((f, i) => (i === sel ? { ...f, ...patch } : f)))
  // 줄 고치기는 최신 상태 위에서 — 품목 고르기가 onSelect · onChange 를 연달아 불러 앞의 값이 덮이던 것을 막는다
  const setLine = (i, patch) => setFiles((fs) => fs.map((f, k) => (k === sel ? { ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : f)))

  async function changeCustomer(code) {
    setBusy(true)
    try {
      const po = { ...cur.po, customer: code, warns: cur.po.warns.filter((w) => !/고객사를 못 정함/.test(w)) }
      const r = po.po_no ? await prepare(po, cur.po.lines.map((l) => ({ ...l }))) : { lines: await matchLines(code, cur.po.lines.map((l) => ({ ...l }))), existing: null, diff: null, planned: [] }
      setCur({ po, ...r })
    } catch (e) { toastError('고객사 바꾸기 실패: ' + e.message) }
    finally { setBusy(false) }   // 실패해도 「읽는 중」에 멈추지 않게 (v4.90.6)
  }

  const blocked = (f) => !f.po.kind || !f.po.customer || !f.po.po_no || !f.lines.length || (f.po.warns.length > 0 && !f.force)
  // 이미 있는 PO — 바뀐 것이 없어도 빈 칸(납품처 · Rev · 품목 연결 …)을 채울 것이 있으면 저장 가능 (v4.90.1)
  const fillOf = (f) => (f?.existing && f.diff ? fillPlan(f.existing, f.po, f.lines, f.diff.pair) : null)
  const canSave = (f) => f && !f.saved && !blocked(f) && !(f.existing && f.diff?.same && !fillOf(f)?.any)

  async function save(f, idx) {
    const lines = f.lines.map((l) => ({ ...l, deliveredAll: l.deliveredAll || f.allDelivered }))
    // 등록 직전에 다시 찾는다 — 같은 PO 파일이 둘(「… (1).pdf」 등)이면 앞 파일이 먼저 등록해
    //   읽을 때는 없던 PO 가 지금은 있다. 그때 새로 넣으면 409(이미 있음)로 실패하므로 변경 반영으로 돌린다 (v4.90.5)
    const fresh = await loadOrderByNo(f.po.customer, f.po.po_no)
    const r = await saveOrder({ po: f.po, lines, existing: fresh, fileName: f.name, migrated: !fresh && (!!f.allDelivered || lines.some((l) => l.deliveredAll)), meName })
    const label = r.created ? '등록됨' : [r.changed ? `변경 ${r.changed}건 반영` : '', r.fills?.length ? '빈 칸 채움' : ''].filter(Boolean).join(' · ')
      || (!f.existing && fresh ? '같은 PO 앞 파일로 등록됨' : '바뀐 것 없음')
    setFiles((fs) => fs.map((x, i) => (i === idx ? { ...x, saved: label, err: null } : x)))
    return r
  }
  async function saveOne() {
    setBusy(true)
    try {
      const r = await save(cur, sel)
      toastSuccess(r.created ? `${cur.po.po_no} 등록 — 품목 ${r.lines}${r.linked ? ` (발주 예정 ${r.linked}건 확정)` : ''}`
        : [`${cur.po.po_no}`, r.changed ? `변경 ${r.changed}건 반영` : '', r.fills?.length ? `빈 칸 채움: ${r.fills.join(' · ')}` : ''].filter(Boolean).join(' — '))
      onSaved?.()
    }
    catch (e) { toastError('등록 실패: ' + e.message) }
    setBusy(false)
  }
  async function saveAllOk() {
    setBusy(true)
    let n = 0
    const bad = []
    const todo = files.map((f, i) => i).filter((i) => canSave(files[i]) && !files[i].po.warns.length)
    setProg({ label: '등록하는 중', done: 0, total: todo.length })
    // 한 파일이 실패해도 나머지는 계속 (v4.90.5)
    for (const i of todo) {
      setProg((p) => p && { ...p, done: n + bad.length })
      try { await save(files[i], i); n++ } catch (e) {
        bad.push(`${files[i].po.po_no}: ${e.message}`)
        setFiles((fs) => fs.map((x, k) => (k === i ? { ...x, err: e.message } : x)))
      }
    }
    setProg(null)
    if (n) { toastSuccess(`점검 통과 ${n}건 등록${bad.length ? ` · 실패 ${bad.length}건` : ''}`); onSaved?.() }
    if (bad.length) toastError(`등록 실패 ${bad.length}건 — ${bad.slice(0, 3).join(' / ')}`)
    setBusy(false)   // v4.90.5 에서 빠졌던 것 — 등록 뒤 「읽는 중」에 멈춰 있던 문제
  }

  const okCount = files.filter((f) => canSave(f) && !f.po.warns.length).length
  const cust = cur?.po.customer ? ORDER_CUSTOMERS[cur.po.customer] : null
  const unmatched = cur ? cur.lines.filter((l) => !l.item).length : 0
  const addedKeys = new Set((cur?.diff?.added || []).map(lineKey))
  const planOk = (l) => !cur.existing || addedKeys.has(lineKey(l))      // 이미 있는 PO 는 새로 생긴 줄만 발주 예정 연결
  const showPlan = !!cur && (cur.planned?.length > 0) && (!cur.existing || addedKeys.size > 0)
  const linkedN = cur ? cur.lines.filter((l) => l.plan).length : 0
  // 발주 예정 고르기 후보 — 같은 품목 먼저, 이 파일의 다른 줄이 이미 고른 것은 빼고
  const planOpts = (l) => {
    const taken = new Set(cur.lines.filter((x) => x !== l && x.plan).map((x) => x.plan.id))
    const all = (cur.planned || []).filter((p) => !taken.has(p.id))
    const same = l.item ? all.filter((p) => p.item_id === l.item.id) : []
    return (same.length ? same : all).slice().sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-2 md:p-4 overflow-y-auto" data-order-upload>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[1400px] my-2 md:my-4 min-w-0">
        <div className="flex items-start gap-3 px-4 md:px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-slate-800">📄 발주서 PDF 올리기</h2>
            <p className="text-xs text-slate-400">고객사 발주서 PDF 를 그대로 올리면 양식 · 고객사를 구분하고 품목 줄을 읽습니다. 같은 PO 를 다시 올리면 바뀐 것만 반영하고 변경 이력을 남깁니다.</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto shrink-0 whitespace-nowrap px-3 py-1.5 text-sm font-bold text-slate-500 hover:text-slate-800">✕ 닫기</button>
        </div>
        {/* 지금 어디쯤인지 — 고르기 → 읽고 점검 → 확인 · 고치기 → 등록 (v4.104.0) */}
        <div className="px-4 md:px-6 pt-4 space-y-3">
          <div className="max-w-[760px]"><Stepper steps={['PDF 고르기', '읽고 점검', '확인 · 고치기', '등록']}
            cur={!files.length ? (prog ? 1 : 0) : files.every((f) => f.saved) ? 4 : prog?.label === '등록하는 중' ? 3 : 2} /></div>
          {prog && prog.total > 1 && <div className="max-w-[760px]"><ProgressBar done={prog.done} total={prog.total} label={prog.label} unit="개" /></div>}
        </div>
        <div className="flex flex-col lg:flex-row gap-4 p-3 md:p-5">
          {/* 왼쪽 — 파일 목록 (휴대폰 · 좁은 화면은 위아래로, v4.90.7) */}
          <div className="w-full lg:w-[400px] shrink-0 space-y-2 min-w-0">
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
              onClick={() => inp.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer text-sm font-bold ${drag ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-violet-200 bg-violet-50/40 text-violet-600'}`}>
              {busy ? <span className="inline-flex items-center gap-2"><Spin />{prog?.label === '등록하는 중' ? '등록하는 중…' : '읽는 중…'}</span> : '⬇ PDF 를 끌어 놓거나 눌러서 고르세요 (여러 개)'}
              <input ref={inp} type="file" accept="application/pdf,.pdf" multiple className="hidden" data-pdf-input onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            </div>
            {files.map((f, i) => {
              const c = f.po.customer ? ORDER_CUSTOMERS[f.po.customer] : null
              const tag = f.err ? ['bg-red-50 text-red-600', '⚠ 등록 실패'] : f.saved ? ['bg-emerald-50 text-emerald-700', `✓ ${f.saved}`]
                : !f.po.kind ? ['bg-red-50 text-red-600', '⚠ 모르는 양식']
                : f.po.warns.length ? ['bg-amber-50 text-amber-700', `⚠ 확인 ${f.po.warns.length}`]
                : f.existing ? (f.diff?.same ? (fillOf(f)?.any ? ['bg-violet-50 text-violet-700', '빈 칸 채우기'] : ['bg-slate-100 text-slate-500', '변경 없음']) : ['bg-blue-50 text-blue-700', `변경 ${f.diff.changes.length + f.diff.added.length + f.diff.removed.length}`])
                : ['bg-emerald-50 text-emerald-700', '✓ 점검 통과']
              return (
                <button key={i} type="button" onClick={() => setSel(i)} data-file-row={i}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs ${i === sel ? 'border-violet-500 ring-2 ring-violet-100' : 'border-slate-200'} ${!f.po.kind ? 'bg-red-50/40' : 'bg-white'}`}>
                  <span className="font-mono font-bold text-slate-700 truncate flex-1" title={f.name}>{f.name}</span>
                  {c && <span className={`px-2 py-0.5 rounded-full font-bold ${c.badge}`}>{c.name}</span>}
                  <span className="text-slate-400 whitespace-nowrap">{f.lines.length}품목</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${tag[0]}`}>{tag[1]}</span>
                </button>
              )
            })}
            {files.length > 1 && (
              <button type="button" disabled={busy || !okCount} onClick={saveAllOk} data-save-all
                className="w-full px-4 py-2.5 rounded-xl text-sm font-bold bg-white border border-slate-200 text-slate-700 disabled:opacity-40">
                점검 통과한 {okCount}건 한 번에 등록
              </button>
            )}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-500">
              <b className="text-slate-600">자동 점검</b> — 하나라도 걸리면 ⚠<br />
              · 고객사 = 발행 회사 사업자번호 (Edwards · CSK 는 양식이 같음)<br />
              · 발주서 합계 = 읽은 줄 합계 (빠진 줄 잡기)<br />
              · PO번호 · 수량 · 단가 · 납기 빠짐 없음 · 분할 수량 합<br />
              · 스캔본(글자 없는 PDF)은 못 읽음 → 「모르는 양식」
            </div>
          </div>

          {/* 오른쪽 — 미리보기 */}
          <div className="flex-1 min-w-0">
            {!cur ? (
              <div className="h-full min-h-[300px] hidden lg:flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">왼쪽에 발주서 PDF 를 올리면 여기에 읽은 내용이 나옵니다</div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden" data-preview>
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
                  <b className="text-base font-mono">{cur.po.po_no || 'PO번호 없음'}</b>
                  <select value={cur.po.customer || ''} disabled={!cur.po.kind || busy || !!cur.saved} onChange={(e) => changeCustomer(e.target.value)} data-cust-select
                    className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1">
                    <option value="" disabled>고객사?</option>
                    {Object.entries(ORDER_CUSTOMERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                  </select>
                  <span className="text-xs text-slate-400">{cur.po.kind ? FORMAT_LABEL[cur.po.kind] : '양식 모름'}{cur.po.order_date ? ` · 발주일 ${cur.po.order_date}` : ''}{cur.po.currency ? ` · ${cur.po.currency}` : ''}{cur.po.ccn ? ` (CCN ${cur.po.ccn})` : ''}</span>
                  {cur.po.total != null && !cur.po.warns.some((w) => /합계/.test(w)) && <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">합계 {fmt(cur.po.total)} = 읽은 줄 합계</span>}
                </div>

                {cur.po.warns.length > 0 && (
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 space-y-1" data-warns>
                    {cur.po.warns.map((w, i) => <div key={i}>⚠ {w}</div>)}
                    {cur.po.kind && cur.po.customer && cur.po.po_no && cur.lines.length > 0 && !cur.saved && (
                      <label className="flex items-center gap-1.5 pt-1 font-bold"><input type="checkbox" checked={!!cur.force} onChange={(e) => setCur({ force: e.target.checked })} data-force /> 확인했고 그대로 등록</label>
                    )}
                  </div>
                )}
                {cur.po.dueChanged && <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700">발주서에 「납기일이 변경되었습니다」 표시가 있습니다{cur.existing ? '' : ' — 처음 등록하는 PO 라 비교할 이전 값은 없습니다'}</div>}

                {cur.existing && cur.diff && (
                  <div className="px-4 py-3 border-b border-slate-100 text-xs" data-diff>
                    {cur.diff.same ? <span className="text-slate-500">이미 등록된 PO — 바뀐 것이 없습니다</span> : (
                      <>
                        <b className="text-blue-700">이미 등록된 PO — 바뀐 것 {cur.diff.changes.length + cur.diff.added.length + cur.diff.removed.length}건</b>
                        <span className="text-slate-400"> · 반영하면 이력이 남고 구매자재 회신이 다시 필요합니다</span>
                        <div className="mt-2 max-h-36 overflow-y-auto space-y-0.5 font-mono">
                          {cur.diff.changes.map((c, i) => <div key={'c' + i}>{c.line_key} {FIELD_LABEL[c.field] || c.field}: <span className="line-through text-slate-400">{c.before_val || '—'}</span> → <b className="text-red-600">{c.after_val || '—'}</b></div>)}
                          {cur.diff.added.map((l, i) => <div key={'a' + i} className="text-emerald-700">{lineKey(l)} 줄 추가: {l.item?.std_code || l.pn || l.desc} ×{l.qty}</div>)}
                          {cur.diff.removed.map((o, i) => <div key={'r' + i} className="text-red-600">{lineKey(o)} 줄 빠짐: {o.items?.std_code || o.raw_pn || o.raw_desc} ×{o.qty}</div>)}
                        </div>
                      </>
                    )}
                    {fillOf(cur)?.any && !cur.saved && (
                      <div className="mt-2 px-3 py-2 rounded-lg bg-violet-50 text-violet-700" data-fill>
                        <b>빈 칸 채우기</b> — {fillOf(cur).labels.join(' · ')}
                        <div className="text-[10.5px] text-violet-500 mt-0.5">비어 있던 칸만 발주서 값으로 채웁니다. 이미 있는 값(구매자재가 고친 납품처 등)은 그대로 둡니다. 회신은 다시 받지 않습니다.</div>
                      </div>
                    )}
                  </div>
                )}

                {cur.lines.length > 0 && (
                  <div className="max-h-[52vh] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0"><tr className="text-slate-500">
                        <th className="px-2 py-2 text-left">줄</th><th className="px-2 text-left">발주서 품번 · 품명</th><th className="px-2 text-left">포털 품목</th>
                        <th className="px-2 text-left">Rev</th><th className="px-2 text-right">수량</th><th className="px-2 text-right">단가</th><th className="px-2 text-left">납기</th>
                        {cur.po.customer === 'AX' && <th className="px-2 text-left">구분</th>}
                        {showPlan && <th className="px-2 text-left" title="실제 발주가 오면 Plnd order number 로 「발주 예정」 줄을 찾아 이 PO 로 옮깁니다">발주 예정 연결</th>}
                        {!cur.existing && <th className="px-2 text-center">이미 납품</th>}
                      </tr></thead>
                      <tbody>
                        {cur.lines.map((l, i) => (
                          <tr key={i} className={`border-t border-slate-100 ${!l.item ? 'bg-amber-50/50' : ''}`} data-line={lineKey(l)}>
                            <td className="px-2 py-1.5 font-mono whitespace-nowrap">{l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''}</td>
                            <td className="px-2 py-1.5"><div className="font-mono">{l.pn || <span className="text-slate-400">품번 없음</span>}</div><div className="text-[10.5px] text-slate-400">{l.desc}{l.spec ? ` · ${l.spec}` : ''}</div></td>
                            <td className="px-2 py-1.5 min-w-[220px]">
                              {l.item && !l.editing ? (
                                <div className="flex items-center gap-1.5">
                                  <div><span className="font-mono font-bold text-indigo-600">{l.item.std_code}</span><div className="text-[10.5px] text-slate-400">{l.item.name}</div></div>
                                  {l.otherCust && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-bold text-[10px]">⚠ 다른 고객사 품목</span>}
                                  {l.how === '기억' && <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-bold text-[10px]">기억</span>}
                                  {!cur.saved && <button type="button" onClick={() => setLine(i, { editing: true, q: '' })} className="text-[10.5px] text-slate-400 hover:text-indigo-600">바꾸기</button>}
                                </div>
                              ) : cur.saved ? <span className="text-amber-700 font-bold">품목 미등록</span> : (
                                <div data-pick={i}>
                                  <ItemPicker value={l.q ?? ''} onChange={(v) => setLine(i, { q: v })} placeholder="🔍 품목 고르기 (안 고르면 미등록으로)"
                                    onSelect={(x) => setLine(i, { item: { id: x.id, std_code: x.std_code, name: x.name }, how: '직접', pickedByHand: true, otherCust: false, editing: false })} />
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5">{l.rev || '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{fmt(l.qty)}{packOf(l) && <div className="text-[10px] font-bold text-amber-700 whitespace-nowrap" data-pack>⚠ PK{packOf(l)} · 실제 {fmt((+l.qty || 0) * packOf(l))}개</div>}{l.delivered > 0 ? <div className="text-[10px] text-emerald-600">납품 {fmt(l.delivered)}</div> : null}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{fmt(l.price)}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{l.due || '—'}</td>
                            {cur.po.customer === 'AX' && <td className="px-2 py-1.5">{l.division}</td>}
                            {showPlan && (
                              <td className="px-2 py-1.5 min-w-[230px]" data-plan-cell={i}>
                                {!planOk(l) ? <span className="text-slate-300">—</span> : <>
                                <select value={l.plan?.id || ''} disabled={!!cur.saved} data-plan={i}
                                  onChange={(e) => { const p = (cur.planned || []).find((x) => String(x.id) === e.target.value) || null; setLine(i, { plan: p, planHow: p ? '직접' : null }) }}
                                  className={`w-full text-[11px] border rounded-lg px-1.5 py-1 ${l.plan ? 'border-violet-300 bg-violet-50 text-violet-700 font-bold' : 'border-slate-200 text-slate-500'}`}>
                                  <option value="">— 새 품목으로 —</option>
                                  {l.plan && !planOpts(l).some((p) => p.id === l.plan.id) && <option value={l.plan.id}>{planLabel(l.plan)}</option>}
                                  {planOpts(l).map((p) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
                                </select>
                                {l.plan && <div className="text-[10px] text-violet-500 mt-0.5">{l.planHow === '자동' ? 'Plnd 번호로 자동 연결' : '직접 연결'}</div>}
                                </>}
                              </td>
                            )}
                            {!cur.existing && <td className="px-2 py-1.5 text-center"><input type="checkbox" disabled={!!cur.saved} checked={!!(l.deliveredAll || cur.allDelivered)} onChange={(e) => setLine(i, { deliveredAll: e.target.checked })} data-delivered={i} /></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                  <span className="text-xs text-slate-500">
                    품목 {cur.lines.length} · 찾음 {cur.lines.length - unmatched}{unmatched ? <b className="text-amber-700"> · 미등록 {unmatched}</b> : ''}
                    {linkedN > 0 && <b className="text-violet-700" data-linked> · 발주 예정 {linkedN}건 확정</b>}
                    {cust ? ` · ${cust.name}` : ''}
                  </span>
                  {!cur.existing && cur.lines.length > 0 && !cur.saved && (
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600" title="지난 PO 를 옮겨 넣을 때 — 모든 줄을 납품 · 판매입력 완료로 넣어 할 일에 안 뜨게 합니다">
                      <input type="checkbox" checked={!!cur.allDelivered} onChange={(e) => setCur({ allDelivered: e.target.checked })} data-all-delivered /> 전부 이미 납품 (이관)
                    </label>
                  )}
                  <button type="button" disabled={busy || !canSave(cur)} onClick={saveOne} data-save
                    className="ml-auto px-5 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white disabled:opacity-40">
                    {cur.saved ? `✓ ${cur.saved}` : cur.existing ? (cur.diff?.same ? (fillOf(cur)?.any ? '빈 칸 채우기' : '바뀐 것 없음') : '변경 반영 → 구매자재에 알림') : '등록 → 구매자재에 알림'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
