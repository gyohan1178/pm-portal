import { useState } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { downloadCsvTemplate, TEMPLATES } from '../../lib/csvTemplate'

// 헤더 유연 매칭
const pick = (row, keys) => {
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (keys.some(t => kn.includes(t))) return row[k]
  }
  return undefined
}
const s = v => (v == null ? '' : String(v).trim())
const keyOf = (po, ol, dl) => `${po}|${ol}|${dl}`
const dnorm = v => {
  if (v == null || v === '') return null
  // Date 객체 (cellDates:true 결과)
  if (v instanceof Date && !isNaN(v)) {
    // 정오 보정: 엑셀 날짜가 시간대(한국 구식 오프셋 +8:27:52 포함) 때문에 전날 23:2x로 파싱되는 문제 차단
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  }
  // 엑셀 날짜 일련번호 (예: 46183)
  if (typeof v === 'number' || /^\d{4,6}$/.test(String(v).trim())) {
    const serial = Number(v)
    if (serial > 20000 && serial < 80000) {   // 1954~2119 범위만 날짜로 간주
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
      if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
    }
  }
  const t = s(v); const m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : (t || null)
}

export default function CustomerPOUpload({ csId, csCode, onClose }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState([])
  const [diff, setDiff] = useState(null)   // { news, changes, sames }
  const [receivedSet, setReceivedSet] = useState(new Set())
  const [disCheck, setDisCheck] = useState({})   // 사라진 PO 체크 (기본 적용)
  const [result, setResult] = useState(null)
  const [sheetUsed, setSheetUsed] = useState('')

  function parseFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
      // AXCELIS 양식이면 'Current Data' 시트 우선, 없으면 첫 시트
      const sheetName = wb.SheetNames.find(n => /current\s*data/i.test(n)) || wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const parsed = json.map(r => {
        const pn = s(pick(r, ['item', '품번', 'partno', '품목코드'])).replace(/\.0$/, '')
        return {
          po_number: s(pick(r, ['ordernumber', 'order number', 'po', '오더번호', '발주번호'])),
          order_line: s(pick(r, ['orderlines', 'order lines', '오더라인'])).replace(/\.0$/, ''),
          del_line: s(pick(r, ['delline', 'del line', '납품라인'])).replace(/\.0$/, ''),
          ccn: s(pick(r, ['ccn'])),
          pn,
          item_rev: s(pick(r, ['srev', 'rev', '리비전'])),   // SRev 기준
          qty: parseFloat(s(pick(r, ['quantity', '수량', 'qty', '발주량'])).replace(/,/g, '')) || 0,
          promise_date: dnorm(pick(r, ['promisedate', 'promise date', '약속일', '납기'])),
          division: pn.startsWith('16') ? '하네스' : pn.startsWith('11') ? '전장' : '구매품',   // 16*=하네스, 11*=전장, 그외=구매품
        }
      }).filter(r => r.pn && r.po_number)

      // Received 시트 → 납품 완료 키 집합 (사라진 PO 분류용)
      const rcvSheet = wb.SheetNames.find(n => /received|receive/i.test(n))
      const receivedKeys = new Set()
      if (rcvSheet) {
        const rjson = XLSX.utils.sheet_to_json(wb.Sheets[rcvSheet], { defval: '' })
        rjson.forEach(r => {
          const pn = s(pick(r, ['item', '품번'])).replace(/\.0$/, '')
          const po = s(pick(r, ['order number', 'ordernumber', 'po']))
          const ol = s(pick(r, ['order lines', 'orderlines'])).replace(/\.0$/, '')
          const dl = s(pick(r, ['del line', 'delline'])).replace(/\.0$/, '')
          if (pn && po) receivedKeys.add(keyOf(po, ol, dl))
        })
      }
      setReceivedSet(receivedKeys)
      setRows(parsed); setDiff(null); setResult(null); setSheetUsed(sheetName)
    }
    reader.readAsArrayBuffer(file)
  }

  // 업로드 분석: 기존 PO와 (po+오더라인+DEL라인+품번) 키로 매칭 → 변경 감지
  const analyzeMut = useMutation({
    mutationFn: async () => {
      // 기존 customer_po 적재 (키 비교용)
      const all = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('purchase_orders')
          .select('id,po_number,order_line,del_line,item_rev,qty_ordered,promise_date,division,changes, items!purchase_orders_item_id_fkey(std_code)')
          .eq('customer_id', csId).eq('order_type', 'customer_po')
          .range(from, from + 999)
        if (error) throw error
        all.push(...(data || [])); if (!data || data.length < 1000) break
      }
      const existMap = {}
      all.forEach(e => { existMap[keyOf(e.po_number, e.order_line, e.del_line)] = e })

      const news = [], changes = [], sames = []
      const curKeys = new Set()
      for (const r of rows) {
        const code = 'AX-' + r.pn
        curKeys.add(keyOf(r.po_number, r.order_line, r.del_line))
        const ex = existMap[keyOf(r.po_number, r.order_line, r.del_line)]
        if (!ex) { news.push({ ...r, code }); continue }
        const chg = []
        if (code !== (ex.items?.std_code || '')) chg.push({ field: 'item', from: ex.items?.std_code || '-', to: code, _newCode: code })
        if (r.item_rev && r.item_rev !== (ex.item_rev || '')) chg.push({ field: 'item_rev', from: ex.item_rev || '-', to: r.item_rev })
        if (r.promise_date && r.promise_date !== (ex.promise_date || '')) chg.push({ field: 'promise_date', from: ex.promise_date || '-', to: r.promise_date })
        if (r.qty && r.qty !== ex.qty_ordered) chg.push({ field: 'qty_ordered', from: ex.qty_ordered, to: r.qty })
        if (r.division && r.division !== (ex.division || '')) chg.push({ field: 'division', from: ex.division || '-', to: r.division })
        if (chg.length) changes.push({ ...r, code, id: ex.id, prevChanges: ex.changes || [], chg })
        else sames.push(r)
      }

      // 사라진 PO: 기존 진행중인데 이번 Current Data에 없는 것 → Received면 납품, 아니면 취소
      const disappeared = []
      for (const e of all) {
        const k = keyOf(e.po_number, e.order_line, e.del_line)
        if (curKeys.has(k)) continue              // 이번에도 있음 → 패스
        if (e.status === '완료' || e.status === '취소') continue   // 이미 처리됨
        const delivered = receivedSet.has(k)
        disappeared.push({
          id: e.id, code: e.items?.std_code, po_number: e.po_number,
          order_line: e.order_line, del_line: e.del_line, qty_ordered: e.qty_ordered,
          kind: delivered ? '납품' : '취소',
        })
      }

      // 미등록 품목 + BOM 등록여부 점검
      const allCodes = [...new Set(rows.map(r => 'AX-' + r.pn))]
      const regItems = {}, bomCodes = new Set()
      for (let i = 0; i < allCodes.length; i += 300) {
        const slice = allCodes.slice(i, i + 300)
        const { data: its } = await supabase.from('items').select('std_code').in('std_code', slice)
        ;(its || []).forEach(x => { regItems[x.std_code] = true })
      }
      // 16*/11* 의 BOM(projects) 등록 여부
      const asmCodes = allCodes.filter(c => /^AX-1[61]/.test(c))
      for (let i = 0; i < asmCodes.length; i += 300) {
        const slice = asmCodes.slice(i, i + 300)
        const { data: pjs } = await supabase.from('projects').select('code').in('code', slice)
        ;(pjs || []).forEach(x => bomCodes.add(x.code))
      }
      const unregistered = allCodes.filter(c => !regItems[c]).map(c => ({
        code: c, isAsm: /^AX-1[61]/.test(c), hasBom: bomCodes.has(c),
        name: rows.find(r => 'AX-' + r.pn === c)?.pn || '',
      }))
      const noBomAsm = asmCodes.filter(c => !bomCodes.has(c))   // ASSY인데 BOM 없는 것

      // 사라진 PO 과다 경고 (전체 진행중의 40% 넘으면 의심)
      const disappearWarn = all.length > 0 && disappeared.length / all.length > 0.4

      return { news, changes, sames, unregistered, noBomAsm, disappeared, disappearWarn, existCount: all.length }
    },
    onSuccess: (d) => {
      setDiff(d)
      // 취소 항목은 기본 체크 해제(안전), 납품만 기본 체크
      const init = {}
      ;(d.disappeared || []).forEach(x => { if (x.kind === '취소') init[x.id] = false })
      setDisCheck(init)
    },
    onError: e => toastError('분석 오류: ' + e.message),
  })

  // 적용: 변경분은 update + 이력 누적, 신규는 insert
  const applyMut = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString()
      // 변경 적용
      for (const c of diff.changes) {
        const patch = {}
        for (const x of c.chg) {
          if (x.field === 'item') {
            // 품번 변경 → item_id 교체 (없으면 생성)
            let { data: it } = await supabase.from('items').select('id').eq('std_code', x._newCode).maybeSingle()
            if (!it) {
              const { data: m, error: mErr } = await supabase.from('items').insert({ std_code: x._newCode, name: '', type: '자재', unit: 'EA' }).select('id').single()
              if (mErr) throw new Error('신규 품번 생성 실패(' + x._newCode + '): ' + mErr.message)
              it = m
            }
            if (it) patch.item_id = it.id
          } else {
            patch[x.field] = x.to
          }
        }
        const history = [...(c.prevChanges || []), ...c.chg.map(x => ({ field: x.field, from: x.from, to: x.to, at: now }))]
        patch.changes = history
        const { error } = await supabase.from('purchase_orders').update(patch).eq('id', c.id)
        if (error) throw error
      }
      // 신규 insert (품목 없으면 자동 생성)
      let inserted = 0, created = 0
      for (const n of diff.news) {
        let { data: item } = await supabase.from('items').select('id,type').eq('std_code', n.code).maybeSingle()
        if (!item) {
          // 미등록 품목 자동 생성
          const { data: made, error: ce } = await supabase.from('items')
            .insert({ std_code: n.code, name: '', type: '자재', unit: 'EA' })
            .select('id,type').single()
          if (ce) throw ce
          item = made; created++
        }
        const { error } = await supabase.from('purchase_orders').insert({
          customer_id: csId, item_id: item.id, order_type: 'customer_po',
          po_number: n.po_number, ccn: n.ccn || null, order_line: n.order_line || null,
          del_line: n.del_line || null, item_rev: n.item_rev || null,
          qty_ordered: Math.round(n.qty), qty_received: 0,
          promise_date: n.promise_date, type: item.type || '자재',
          division: n.division || '전장',
          status: '진행중', changes: [],
        })
        if (error) throw error
        inserted++
      }
      // 사라진 PO 처리 (체크된 것만): 납품→완료, 취소→취소
      let done = 0, canceled = 0
      const dis = (diff.disappeared || []).filter(d => disCheck[d.id] !== false)  // 기본 체크
      for (const d of dis) {
        const newStatus = d.kind === '납품' ? '완료' : '취소'
        const { error } = await supabase.from('purchase_orders')
          .update({ status: newStatus, issued: d.kind === '납품', issued_at: d.kind === '납품' ? now : null })
          .eq('id', d.id)
        if (error) throw error
        if (d.kind === '납품') done++; else canceled++
      }
      return { changed: diff.changes.length, inserted, created, done, canceled }
    },
    onSuccess: (r) => {
      setResult(`적용 완료 — 변경 ${r.changed}건, 신규 ${r.inserted}건${r.created ? `, 자동등록 ${r.created}건` : ''}${r.done ? `, 납품완료 ${r.done}건` : ''}${r.canceled ? `, 취소 ${r.canceled}건` : ''}`)
      setRows([]); setDiff(null); setDisCheck({})
      qc.invalidateQueries(['cpo']); qc.invalidateQueries(['shortage'])
    },
    onError: e => toastError('적용 오류: ' + e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">고객사 PO 업로드 — 변경 감지 ({csCode})</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold">✅ {result}</div>
          )}

          <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center">
            <input type="file" accept=".xlsx,.xlsm,.xls,.csv" id="cpo-file" className="hidden"
              onChange={e => e.target.files[0] && parseFile(e.target.files[0])} />
            <label htmlFor="cpo-file" className="cursor-pointer text-sm text-indigo-600 font-semibold">📁 PO 엑셀/CSV 선택</label>
            <p className="text-xs text-slate-400 mt-1">AXCELIS PO관리(.xlsm) Current Data 시트 자동 인식 · CCN·라인·SRev·약속일</p>
            <button onClick={()=>downloadCsvTemplate(TEMPLATES.customerPO.filename, TEMPLATES.customerPO.headers, TEMPLATES.customerPO.samples)}
              className="mt-2 text-xs text-indigo-500 font-semibold hover:underline">⬇ CSV 양식 다운로드</button>
            {rows.length > 0 && <p className="text-xs text-slate-600 mt-2 font-semibold">{rows.length}행 읽음 {sheetUsed && <span className="text-slate-400">· [{sheetUsed}] 시트</span>}</p>}
          </div>

          {rows.length > 0 && !diff && (
            <button onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending}
              className="w-full py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {analyzeMut.isPending ? '분석 중...' : '변경 감지 분석'}
            </button>
          )}

          {diff && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <p className="text-xs font-bold text-emerald-500">신규</p><p className="text-xl font-bold text-emerald-700">{diff.news.length}</p></div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                  <p className="text-xs font-bold text-amber-500">변경</p><p className="text-xl font-bold text-amber-700">{diff.changes.length}</p></div>
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-xs font-bold text-slate-400">동일</p><p className="text-xl font-bold text-slate-600">{diff.sames.length}</p></div>
              </div>

              {/* 미등록 품목 알림 */}
              {diff.unregistered?.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
                  <div className="px-3 py-2 text-xs font-bold text-blue-700 border-b border-blue-200">
                    🆕 미등록 품목 {diff.unregistered.length}건 — 적용 시 자동 등록됩니다
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-blue-100">
                    {diff.unregistered.map((u, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs flex items-center gap-2">
                        <span className="font-mono text-blue-600">{u.code}</span>
                        {u.isAsm && (u.hasBom
                          ? <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 text-[10px] font-bold">BOM 있음</span>
                          : <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-bold">⚠ BOM 없음</span>)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BOM 없는 ASSY 경고 (등록은 됐지만 BOM 미등록 = 부족자재 전개 불가) */}
              {diff.noBomAsm?.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                  ⚠️ <span className="font-bold">BOM 미등록 ASSY {diff.noBomAsm.length}건</span> — 부족자재 전개가 안 됩니다. BOM 등록 필요:
                  <div className="mt-1 font-mono text-[11px] text-red-500 max-h-20 overflow-y-auto">
                    {diff.noBomAsm.slice(0, 30).join(', ')}{diff.noBomAsm.length > 30 && ` 외 ${diff.noBomAsm.length - 30}건`}
                  </div>
                </div>
              )}

              {/* 사라진 PO — 납품/취소 검토 */}
              {diff.disappeared?.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 overflow-hidden">
                  <div className="px-3 py-2 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-violet-700">
                      📦 사라진 PO {diff.disappeared.length}건 — 납품 {diff.disappeared.filter(d=>d.kind==='납품').length} · 취소 {diff.disappeared.filter(d=>d.kind==='취소').length}
                    </span>
                    <span className="text-[11px] text-violet-400">체크된 것만 처리 (납품→완료, 취소→취소)</span>
                  </div>
                  {diff.disappearWarn && (
                    <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-[11px] text-red-600 font-semibold">
                      ⚠️ 사라진 PO가 전체의 40%를 넘습니다 ({diff.disappeared.length}/{diff.existCount}). 잘못된 파일이거나 품번이 대량 변경됐을 수 있어요. 취소 항목은 신중히 확인하세요.
                    </div>
                  )}
                  <div className="max-h-52 overflow-y-auto divide-y divide-violet-100">
                    {diff.disappeared.map((d, i) => (
                      <label key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-violet-50/50">
                        <input type="checkbox" checked={disCheck[d.id] !== false}
                          onChange={e => setDisCheck(c => ({ ...c, [d.id]: e.target.checked }))} />
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${d.kind==='납품'?'bg-emerald-100 text-emerald-600':'bg-rose-100 text-rose-600'}`}>{d.kind}</span>
                        <span className="font-mono text-slate-500">{d.po_number}</span>
                        <span className="font-mono text-indigo-600">{d.code}</span>
                        {d.order_line && <span className="text-slate-400">L{d.order_line}/{d.del_line}</span>}
                        <span className="text-slate-400 ml-auto">{d.qty_ordered}개</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {diff.changes.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-amber-50 text-xs font-bold text-amber-700 border-b border-slate-200">변경 감지 항목</div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {diff.changes.map((c, i) => (
                      <div key={i} className="px-3 py-2 text-xs">
                        <div className="font-mono text-slate-500 mb-1">{c.po_number} · {c.code} {c.order_line && `· L${c.order_line}`}</div>
                        {c.chg.map((x, j) => (
                          <div key={j} className="flex items-center gap-2 ml-2">
                            <span className="text-slate-400 w-16">{x.field === 'promise_date' ? '납기' : x.field === 'item_rev' ? 'REV' : x.field === 'division' ? '구분' : '수량'}</span>
                            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 line-through">{x.from}</span>
                            <span className="text-slate-300">→</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-semibold">{x.to}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => applyMut.mutate()} disabled={applyMut.isPending || (diff.news.length === 0 && diff.changes.length === 0 && (diff.disappeared?.length || 0) === 0)}
                className="w-full py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                {applyMut.isPending ? '적용 중...' : `적용 (신규 ${diff.news.length} · 변경 ${diff.changes.length})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
