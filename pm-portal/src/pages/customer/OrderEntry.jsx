// 수주대장 — 직접 등록 · 엑셀로 여러 건 (v4.94.0)
//   PDF 가 없는 주문(정식 PO · 구두 발주 · 선진행 · 발주 예정)을 한 건씩 또는 엑셀 양식으로 여러 건 올린다.
//   품번은 포털 코드로 바로 찾고(matchLines), 못 찾으면 「미등록」으로 들어가 「코드 · BOM 정리」 탭에서 코드를 준다.
import { useState, useEffect, useRef } from 'react'
import { ORDER_CUSTOMERS, matchLines, isManualCust } from '../../lib/orderIntake'
import { KINDS, KIND_HELP, CHANNELS, parseEntryPaste, parseEntryWorkbook, templateWorkbook, registerEntry, fetchEtcNames, ETC_NAME_SEED } from '../../lib/orderEntry'
import { toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))
const inCls = 'w-full h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-violet-500'
const Label = ({ children, req }) => <span className="block text-[12.5px] font-bold text-slate-800 mb-1">{children}{req && <span className="text-red-500"> *</span>}</span>
const Help = ({ children }) => <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">{children}</p>

export async function downloadTemplate() {
  const XLSX = await import('xlsx')
  XLSX.writeFile(templateWorkbook(XLSX), '수주등록_양식.xlsx')
}

export default function OrderEntry({ mode = 'one', onClose, onSaved, meName }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/25 overflow-y-auto p-3 md:p-8" onClick={onClose} data-entry-modal={mode}>
      <div className="w-full max-w-[1100px] bg-[#f7f8fb] rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {mode === 'excel' ? <ExcelEntry onClose={onClose} onSaved={onSaved} meName={meName} /> : <OneEntry onClose={onClose} onSaved={onSaved} meName={meName} />}
      </div>
    </div>
  )
}

// ── 한 건 ────────────────────────────────────────────────
function OneEntry({ onClose, onSaved, meName }) {
  const [kind, setKind] = useState('verbal')
  const [cust, setCust] = useState('VM')
  const [f, setF] = useState({ po_no: '', slip_no: '', order_date: todayISO(), ship_to: '', req_channel: '메일', req_person: '', po_due: '', customer_name: '' })
  // 기타 고객사 (동원파츠 · 동신 · 두웰 …) — 업체 이름 직접 입력 · 전에 쓴 이름은 고르기 목록 (v4.107.0)
  const etc = isManualCust(cust)
  const [etcNames, setEtcNames] = useState(ETC_NAME_SEED)
  const [tried, setTried] = useState(false)
  useEffect(() => { if (etc) fetchEtcNames().then(setEtcNames).catch(() => {}) }, [etc])
  const pickCust = (c) => { setCust(c); if (isManualCust(c) && kind === 'planned') setKind('po') }
  const [paste, setPaste] = useState('')
  const [lines, setLines] = useState([])         // matchLines 결과
  const [one, setOne] = useState({ pn: '', qty: '', price: '', due: '', desc: '', plnd: '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const temp = kind === 'verbal' || kind === 'advance'

  // 고객사가 바뀌면 품번을 다시 찾는다
  const match = async (raw, c = cust) => (raw.length ? matchLines(c, raw) : [])
  useEffect(() => { let on = true; if (lines.length) match(lines.map(({ item, how, ...l }) => l)).then((r) => { if (on) setLines(r) }).catch(() => {}); return () => { on = false } }, [cust]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addPaste() {
    const raw = parseEntryPaste(paste)
    if (!raw.length) { toastError('붙여 넣은 줄에서 품번 · 수량을 못 읽었습니다'); return }
    try { setLines([...lines, ...(await match(raw))]); setPaste('') } catch (e) { toastError('품번 찾기 실패: ' + e.message) }
  }
  async function addOne() {
    if (!one.pn.trim() || !(Number(one.qty) > 0)) { toastError('품번과 수량을 넣으세요'); return }
    const raw = [{ pn: one.pn.trim(), qty: Number(one.qty), price: one.price === '' ? null : Number(String(one.price).replace(/,/g, '')), due: one.due || null, desc: one.desc, plnd: one.plnd || null }]
    try { setLines([...lines, ...(await match(raw))]); setOne({ pn: '', qty: '', price: '', due: '', desc: '', plnd: '' }) } catch (e) { toastError('품번 찾기 실패: ' + e.message) }
  }
  const amount = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0)
  const unreg = lines.filter((l) => !l.item).length

  async function save() {
    if (etc && !f.customer_name.trim()) { setTried(true); return }
    setBusy(true)
    try {
      const r = await registerEntry({ kind, cust, ...f, customer_name: etc ? f.customer_name : null, lines }, meName)
      toastSuccess(`${KINDS[kind]} 등록 — ${r.po_no} · 품목 ${r.lines}`)
      onSaved?.(r); onClose()
    } catch (e) { toastError(e.message) }
    setBusy(false)
  }

  return (
    <div data-entry-one>
      <div className="px-5 py-4 border-b border-slate-200 bg-white rounded-t-2xl flex items-baseline gap-3">
        <h2 className="text-[16px] font-extrabold text-slate-900">직접 등록</h2>
        <span className="text-[12.5px] text-slate-500">발주서 PDF 없이 한 건씩 — 여러 건은 「엑셀로 여러 건 올리기」</span>
        <button type="button" onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">✕ 닫기</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_230px] gap-4 p-4 md:p-5">
        <div className="space-y-4 min-w-0">
          <div>
            <Label req>이 주문은</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(KINDS).map(([k, l]) => {
                const off = etc && k === 'planned'     // 발주 예정은 4개 고객사만
                return (
                <button key={k} type="button" onClick={() => setKind(k)} data-kind={k} disabled={off} title={off ? '발주 예정은 AXCELIS · Edwards · CSK · VM 만' : undefined}
                  className={`text-left rounded-xl px-3 py-2.5 bg-white border disabled:opacity-40 ${kind === k ? 'border-2 border-violet-600' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className={`text-[13px] font-extrabold ${kind === k ? 'text-violet-700' : 'text-slate-800'}`}>{l}</div>
                  <div className="text-[11.5px] text-slate-500 mt-0.5">{off ? '4개 고객사만' : KIND_HELP[k]}</div>
                </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 bg-[#f9fafc]">
            <div>
              <Label req>고객사</Label>
              <select value={cust} onChange={(e) => pickCust(e.target.value)} className={inCls} data-entry-cust>
                {Object.entries(ORDER_CUSTOMERS).map(([k, v]) => <option key={k} value={k}>{v.manual ? '기타 — 업체 직접 입력' : v.name}</option>)}
              </select>
            </div>
            {etc && (
              <div>
                <Label req>업체 이름</Label>
                <input value={f.customer_name} onChange={(e) => set('customer_name', e.target.value)} list="etc-cust-names" data-entry-cust-name
                  placeholder="예: 동원파츠" className={`${inCls} ${tried && !f.customer_name.trim() ? 'border-rose-400' : ''}`} />
                <datalist id="etc-cust-names">{etcNames.map((n) => <option key={n} value={n} />)}</datalist>
                {tried && !f.customer_name.trim()
                  ? <p className="text-[11px] font-bold text-rose-600 mt-1" data-field-error="customer_name">업체 이름을 넣으세요</p>
                  : <Help>전에 쓴 이름은 칸을 누르면 고를 수 있습니다. 같은 업체는 같은 이름으로 써야 수주대장에서 한 업체로 묶입니다.</Help>}
              </div>
            )}
            {kind !== 'planned' && (
              <div>
                <Label req={kind === 'po'}>PO 번호</Label>
                <input value={f.po_no} onChange={(e) => set('po_no', e.target.value)} className={`${inCls} font-mono`} data-entry-po placeholder={temp ? `비우면 ${kind === 'verbal' ? '구두' : '선진'}-${cust}-YYMM-01` : '예: PO2610000311'} />
                {temp && <Help>비워 두면 임시 번호를 붙입니다. 정식 PO 가 오면 PO 상세에서 그 번호로 바꿉니다.</Help>}
              </div>
            )}
            {kind !== 'planned' && (
              <div>
                <Label req={kind === 'verbal'}>이카운트 명세서번호</Label>
                <input value={f.slip_no} onChange={(e) => set('slip_no', e.target.value)} className={`${inCls} font-mono`} data-entry-slip placeholder="예: 2026/10/23-4" />
                <Help>{kind === 'verbal' ? '구두 발주는 필수 — 이 번호로 마감 여부를 보고 월말에 이카운트 판매 자료와 맞춥니다.' : 'PO 당 하나. 나중에 PO 상세에서 넣어도 됩니다.'}</Help>
              </div>
            )}
            {kind !== 'planned' && (
              <div>
                <Label>발주일</Label>
                <input type="date" value={f.order_date} onChange={(e) => set('order_date', e.target.value)} className={inCls} data-entry-date />
              </div>
            )}
            <div>
              <Label>납품처</Label>
              <input value={f.ship_to} onChange={(e) => set('ship_to', e.target.value)} className={inCls} placeholder="예: 아산 · 평택 · 안성" />
            </div>
            {temp && (
              <>
                <div>
                  <Label req>받은 경로</Label>
                  <div className="flex gap-1.5">
                    {CHANNELS.map((c) => <button key={c} type="button" onClick={() => set('req_channel', c)} data-channel={c} className={`px-3 h-9 rounded-full text-[12px] font-bold border ${f.req_channel === c ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{c}</button>)}
                  </div>
                </div>
                <div>
                  <Label>요청한 사람 (고객사)</Label>
                  <input value={f.req_person} onChange={(e) => set('req_person', e.target.value)} className={inCls} data-entry-person placeholder="예: VM 구매 박책임" />
                </div>
                <div>
                  <Label>정식 PO 받을 날</Label>
                  <input type="date" value={f.po_due} onChange={(e) => set('po_due', e.target.value)} className={inCls} data-entry-podue />
                  <Help>이 날이 지나도 정식 PO 가 없으면 업무 흐름 「정식 PO 대기 지남」에 뜹니다.</Help>
                </div>
              </>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
              <Label req>품목</Label>
              <span className="text-[11.5px] text-slate-500">엑셀에서 「품번 · 수량 · 단가 · 납기 · 품명」 순서로 복사해 붙여 넣거나 한 줄씩 넣으세요 — 품번은 포털 코드로 바로 찾습니다</span>
            </div>
            <div className="flex gap-2 mb-2">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} data-entry-paste
                placeholder={'790-3003-320\t11\t48000\t2026-11-20\tEDA PC ETHERNET'}
                className="flex-1 min-w-0 px-2.5 py-2 text-[12px] font-mono border border-slate-200 rounded-lg bg-white" />
              <button type="button" onClick={addPaste} disabled={!paste.trim()} data-entry-paste-add className="px-3 rounded-lg text-xs font-bold bg-white border border-slate-300 disabled:opacity-40">붙여넣기 반영</button>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
                  <th className="px-3 py-2 font-bold w-8">#</th><th className="px-3 font-bold">고객사 품번</th><th className="px-3 font-bold">포털 코드</th><th className="px-3 font-bold">품명</th>
                  {kind === 'planned' && <th className="px-3 font-bold">Plnd 번호</th>}
                  <th className="px-3 font-bold text-right">수량</th><th className="px-3 font-bold text-right">단가</th><th className="px-3 font-bold">납기</th><th className="px-2 w-8" />
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100" data-entry-line={l.pn}>
                      <td className="px-3 py-2 font-mono text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 font-mono">{l.pn}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.item ? <span className="font-mono text-[#5b6ee8]">{l.item.std_code}</span> : <span className="px-1.5 py-[1px] rounded bg-red-50 text-red-600 text-[10.5px] font-bold" data-unreg>미등록</span>}</td>
                      <td className="px-3 py-2 text-slate-600">{l.item?.name || l.desc || '—'}</td>
                      {kind === 'planned' && <td className="px-3 py-2 font-mono">{l.plnd || '—'}</td>}
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(l.qty)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(l.price)}</td>
                      <td className="px-3 py-2 font-mono">{l.due || '—'}</td>
                      <td className="px-2 text-center"><button type="button" onClick={() => setLines(lines.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-500" aria-label="빼기">✕</button></td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-100 bg-slate-50/50" data-entry-add-row>
                    <td className="px-3 py-2 text-slate-400">+</td>
                    <td className="px-2 py-1.5"><input value={one.pn} onChange={(e) => setOne({ ...one, pn: e.target.value })} placeholder="품번" data-one-pn className="w-full h-8 px-2 text-xs font-mono border border-slate-200 rounded" /></td>
                    <td className="px-2" />
                    <td className="px-2 py-1.5"><input value={one.desc} onChange={(e) => setOne({ ...one, desc: e.target.value })} placeholder="품명 (선택)" className="w-full h-8 px-2 text-xs border border-slate-200 rounded" /></td>
                    {kind === 'planned' && <td className="px-2 py-1.5"><input value={one.plnd} onChange={(e) => setOne({ ...one, plnd: e.target.value })} placeholder="Plnd" data-one-plnd className="w-24 h-8 px-2 text-xs font-mono border border-slate-200 rounded" /></td>}
                    <td className="px-2 py-1.5"><input value={one.qty} onChange={(e) => setOne({ ...one, qty: e.target.value })} placeholder="수량" data-one-qty className="w-16 h-8 px-2 text-xs text-right border border-slate-200 rounded" /></td>
                    <td className="px-2 py-1.5"><input value={one.price} onChange={(e) => setOne({ ...one, price: e.target.value })} placeholder="단가" data-one-price className="w-24 h-8 px-2 text-xs text-right border border-slate-200 rounded" /></td>
                    <td className="px-2 py-1.5"><input type="date" value={one.due} onChange={(e) => setOne({ ...one, due: e.target.value })} data-one-due className="h-8 px-1.5 text-xs border border-slate-200 rounded" /></td>
                    <td className="px-2"><button type="button" onClick={addOne} data-one-add className="text-[#5b6ee8] font-bold whitespace-nowrap">추가</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="bg-white border border-slate-200 rounded-xl p-4 h-max lg:sticky lg:top-4">
          <h3 className="text-[14px] font-extrabold mb-2.5">등록 요약</h3>
          <div className="space-y-2">
            <div className="bg-slate-50 rounded-lg px-3 py-2"><div className="text-[11.5px] text-slate-500">구분</div><div className="text-[16px] font-extrabold text-violet-700" data-sum-kind>{KINDS[kind]}</div></div>
            <div className="bg-slate-50 rounded-lg px-3 py-2"><div className="text-[11.5px] text-slate-500">고객사</div><div className="text-[15px] font-extrabold text-slate-800 truncate" data-sum-cust>{etc ? (f.customer_name.trim() ? `${f.customer_name.trim()}` : <span className="text-slate-400">업체 이름 —</span>) : ORDER_CUSTOMERS[cust]?.name}{etc && <span className="ml-1.5 px-1.5 py-[1px] rounded bg-slate-200 text-slate-600 text-[10.5px] align-middle">기타</span>}</div></div>
            <div className="bg-slate-50 rounded-lg px-3 py-2"><div className="text-[11.5px] text-slate-500">품목</div><div className="text-[22px] font-extrabold font-mono" data-sum-lines>{lines.length}</div></div>
            <div className="bg-slate-50 rounded-lg px-3 py-2"><div className="text-[11.5px] text-slate-500">미등록 품번</div><div className={`text-[22px] font-extrabold font-mono ${unreg ? 'text-red-500' : 'text-slate-800'}`} data-sum-unreg>{unreg}</div></div>
            <div className="bg-slate-50 rounded-lg px-3 py-2"><div className="text-[11.5px] text-slate-500">금액</div><div className="text-[17px] font-extrabold font-mono">₩{Math.round(amount).toLocaleString('ko-KR')}</div></div>
          </div>
          <p className="text-[11.5px] text-slate-500 leading-relaxed mt-3">등록하면 구매자재 「수주 확인」에 올라가고, 회신 · 발주는 정식 PO 와 똑같이 진행합니다. 미등록 품번은 등록 뒤 「코드 · BOM 정리」에서 코드를 줘도 됩니다.</p>
          <button type="button" onClick={save} disabled={busy || !lines.length} data-entry-save className="mt-3 w-full h-10 rounded-lg text-[13px] font-bold bg-violet-600 text-white disabled:opacity-40">{busy ? '등록 중…' : `${KINDS[kind]}로 등록`}</button>
        </aside>
      </div>
    </div>
  )
}

// ── 엑셀로 여러 건 ───────────────────────────────────────
function ExcelEntry({ onClose, onSaved, meName }) {
  const [pv, setPv] = useState(null)            // { fileName, orders:[{...order, lines(matched), result}], errors }
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  async function read(file) {
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsArrayBuffer(file) })
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const { orders, errors } = parseEntryWorkbook(XLSX, wb)
      const matched = []
      for (const o of orders) matched.push({ ...o, lines: await matchLines(o.cust, o.lines) })
      setPv({ fileName: file.name, orders: matched, errors })
    } catch (e) { toastError('양식 읽기 실패: ' + e.message) }
    setBusy(false)
  }
  async function run() {
    setBusy(true)
    const out = []
    for (const o of pv.orders) {
      if (o.result?.ok) { out.push(o); continue }
      try { const r = await registerEntry(o, meName); out.push({ ...o, result: { ok: true, po_no: r.po_no, lines: r.lines } }) } catch (e) { out.push({ ...o, result: { ok: false, msg: e.message } }) }
    }
    setPv({ ...pv, orders: out })
    const ok = out.filter((o) => o.result?.ok).length
    if (ok) { toastSuccess(`엑셀 등록 — ${ok}건`); onSaved?.() }
    if (out.some((o) => !o.result?.ok)) toastError(`등록 못 한 건 ${out.filter((o) => !o.result?.ok).length} — 사유를 보세요`)
    setBusy(false)
  }
  const done = pv && pv.orders.every((o) => o.result?.ok)

  return (
    <div data-entry-excel>
      <div className="px-5 py-4 border-b border-slate-200 bg-white rounded-t-2xl flex items-baseline gap-3">
        <h2 className="text-[16px] font-extrabold text-slate-900">엑셀로 여러 건 올리기</h2>
        <span className="text-[12.5px] text-slate-500">수주등록 양식 — 한 줄 = 품목 하나, 같은 PO번호 줄은 한 PO 로 묶습니다</span>
        <button type="button" onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">✕ 닫기</button>
      </div>
      <div className="p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadTemplate} data-template className="h-9 px-3 rounded-lg text-xs font-bold bg-white border border-slate-300">양식 받기 (수주등록_양식.xlsx)</button>
          <button type="button" onClick={() => ref.current?.click()} disabled={busy} data-excel-pick className="h-9 px-4 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{busy && !pv ? '읽는 중…' : '채운 양식 고르기'}</button>
          <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" data-excel-file onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
          {pv && <span className="text-[12px] text-slate-500 font-mono">{pv.fileName}</span>}
        </div>
        {pv?.errors?.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700" data-excel-errors>
            <b>들어가지 않는 줄 {pv.errors.length}</b> — 고친 뒤 다시 올리세요
            <ul className="mt-1 list-disc pl-5 space-y-0.5">{pv.errors.slice(0, 30).map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        {pv && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
                <th className="px-3 py-2 font-bold">구분</th><th className="px-3 font-bold">고객사</th><th className="px-3 font-bold">PO 번호</th><th className="px-3 font-bold">명세서번호</th>
                <th className="px-3 font-bold text-right">품목</th><th className="px-3 font-bold text-right">미등록</th><th className="px-3 font-bold">결과</th>
              </tr></thead>
              <tbody>
                {pv.orders.map((o, i) => (
                  <tr key={i} className="border-t border-slate-100" data-excel-order={o.po_no || `${o.kind}|${o.cust}`}>
                    <td className="px-3 py-2 font-bold">{KINDS[o.kind]}</td>
                    <td className="px-3 py-2">{o.customer_name ? <>{o.customer_name}<span className="ml-1.5 px-1.5 py-[1px] rounded bg-slate-100 text-slate-500 text-[10.5px]" data-excel-etc>기타</span></> : ORDER_CUSTOMERS[o.cust]?.name}</td>
                    <td className="px-3 py-2 font-mono">{o.result?.po_no || o.po_no || <span className="text-slate-400">{o.kind === 'planned' ? '발주 예정' : '임시 번호 자동'}</span>}</td>
                    <td className="px-3 py-2 font-mono">{o.slip_no || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{o.lines.length}</td>
                    <td className={`px-3 py-2 text-right font-mono ${o.lines.some((l) => !l.item) ? 'text-red-500 font-bold' : ''}`}>{o.lines.filter((l) => !l.item).length}</td>
                    <td className="px-3 py-2">{o.result ? (o.result.ok ? <span className="text-emerald-700 font-bold">등록됨</span> : <span className="text-red-600">{o.result.msg}</span>) : <span className="text-slate-400">등록 전</span>}</td>
                  </tr>
                ))}
                {!pv.orders.length && <tr><td colSpan={7} className="p-6 text-center text-slate-400">등록할 줄이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {pv && pv.orders.length > 0 && (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-bold bg-white border border-slate-300">{done ? '닫기' : '취소'}</button>
            {!done && <button type="button" onClick={run} disabled={busy} data-excel-run className="h-9 px-4 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{busy ? '등록 중…' : `${pv.orders.filter((o) => !o.result?.ok).length}건 등록`}</button>}
          </div>
        )}
      </div>
    </div>
  )
}
