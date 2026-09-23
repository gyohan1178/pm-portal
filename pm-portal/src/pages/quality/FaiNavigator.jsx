import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { downloadSheet } from '../../lib/exportSheet'
import { ResizableTable } from '../../components/ResizableTable'
import { useRowSelect } from '../../hooks/useRowSelect'
import { buildFaiPpt, pickSaveTarget, saveBytes, pptName } from '../../lib/fai/pptBuild'
import { isDwgPart, pickDwg, indexDwg, walkDir, saveHandle, loadHandle, saveList, loadList, dirPermission, askDirPermission } from '../../lib/fai/drawings'
import {
  parseReport, buildRows, buildBuyIndex, normAx, V, CLS_LABEL, CLS_BADGE, qtyText, parentList,
} from '../../lib/fai/partReport'

// 초도품 자재 매칭 (FAI Navigator) — PM Portal 이식 1단계
//
//   Part Report(.htm) 를 올리면 품목표를 만들고, 품번별 발주 이력을 붙여 판정한다.
//   판단 로직은 lib/fai/partReport.js (v3.2 원본과 같은 결과가 나오는지 대조함).
//
//   「실제 사용 제조사」= 발주 줄의 mfr·mfr_code (v4.12.1~). 발주 줄이 비어 있으면 기준코드 DB(items) 값으로 대신한다.
//     발주 줄에 제조사 칸이 생기면(다음 단계) 그 값으로 바뀐다.
//   ⚠ 증빙 폴더·도면·판정 수정 저장은 다음 단계에서 옮긴다.
//   2단계 — 품목별 PPT (저장 위치 선택). 증빙은 포털 발주·입고 기록으로 그린 이카운트 구매전표 모양(금액 칸 없음).
//     16·17번대는 PC 도면 폴더를 연결하면 도면 1쪽이 붙는다 (lib/fai/drawings.js).
//     PPT 라이브러리는 버튼을 누를 때만 불러온다 (lib/fai/pptBuild.js).

const APP_VER = 'v3.2 (포털 2단계)'
const LS_OPT = 'pm_fai_opt'
const LS_REP = 'pm_fai_rep'
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

const BADGE = {
  'b-green': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'b-blue': 'bg-sky-50 text-sky-700 border-sky-200',
  'b-amber': 'bg-amber-50 text-amber-700 border-amber-200',
  'b-red': 'bg-rose-50 text-rose-700 border-rose-200',
  'b-gray': 'bg-slate-50 text-slate-500 border-slate-200',
  'b-pr': 'bg-violet-50 text-violet-700 border-violet-200',
}
const Badge = ({ b, children }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${BADGE[b] || BADGE['b-gray']}`}>{children}</span>
)

// 품번별 발주 이력 — AX- 품번으로 품목을 찾고, 그 품목의 구매발주를 모은다.
//   ⚠ 1,000행 제한이 있어 fetchAll 로 끝까지 받는다. 단가는 조회부터 뺀다(고객사로 나가는 자료).
async function fetchBuyRecs(pns) {
  const codes = [...new Set(pns.map((pn) => 'AX-' + normAx(pn)))]
  const items = []
  for (let i = 0; i < codes.length; i += 200) {
    const part = must(await supabase.from('items')
      .select('id,std_code,manufacturer,manufacturer_code')
      .in('std_code', codes.slice(i, i + 200)), '품목 조회') || []
    items.push(...part)
  }
  const byId = new Map(items.map((it) => [it.id, it]))
  const ids = items.map((it) => it.id)
  const pos = []
  for (let i = 0; i < ids.length; i += 200) {
    const part = await fetchAll(() => supabase.from('purchase_orders')
      .select('id,item_id,po_number,order_date,qty_ordered,status,mfr,mfr_code,vendors(name)')
      .eq('order_type', 'purchase').in('item_id', ids.slice(i, i + 200))
      .order('id'))
    pos.push(...part)
  }
  const recs = pos
    .filter((p) => p.status !== '취소')
    .map((p) => {
      const it = byId.get(p.item_id) || {}
      // 발주 줄에 제조사가 적혀 있으면 그 값(실제 산 것), 없으면 기준코드 DB
      const onPo = !!(p.mfr || p.mfr_code)
      return {
        poId: p.id, ax: normAx(it.std_code), mfrSrc: onPo ? 'po' : 'item',
        mfr: (onPo ? p.mfr : it.manufacturer) || '', mpn: (onPo ? p.mfr_code : it.manufacturer_code) || '',
        vendor: p.vendors?.name || '', date: p.order_date || '', qty: p.qty_ordered, doc: p.po_number || '',
      }
    })
  return { recs, itemCount: items.length, codeCount: codes.length }
}

const COLS = [
  { key: 'chk', label: '', defaultWidth: 36, sortable: false },
  { key: 'no', label: 'No', defaultWidth: 52 },
  { key: 'pn', label: 'Axcelis 품번 / 품명', defaultWidth: 200 },
  { key: 'rev', label: 'Rev', defaultWidth: 50, sortable: false },
  { key: 'qty', label: '소요량', defaultWidth: 84, sortable: false },
  { key: 'cls', label: '구분', defaultWidth: 104 },
  { key: 'v', label: '판정', defaultWidth: 150 },
  { key: 'reg', label: '등록 제조사 · 품번 (Part Report)', defaultWidth: 250, sortable: false },
  { key: 'act', label: '실제 사용 제조사 · 품번', defaultWidth: 200, sortable: false },
  { key: 'vendor', label: '거래처', defaultWidth: 110 },
  { key: 'date', label: '최근 발주일', defaultWidth: 96 },
  { key: 'doc', label: '발주번호', defaultWidth: 118, sortable: false },
  { key: 'par', label: '모품목', defaultWidth: 130, sortable: false },
]

const KPI_STYLE = {
  '': 'border-slate-200 bg-white',
  ok: 'border-emerald-200 bg-emerald-50/60',
  gen: 'border-sky-200 bg-sky-50/60',
  chk: 'border-rose-200 bg-rose-50/60',
  none: 'border-amber-200 bg-amber-50/60',
  cov: 'border-slate-200 bg-slate-50',
}
const KPI_NUM = { '': 'text-slate-800', ok: 'text-emerald-600', gen: 'text-sky-600', chk: 'text-rose-600', none: 'text-amber-600', cov: 'text-slate-600' }

export default function FaiNavigator() {
  const saved = lsGet(LS_REP, null)
  const [rep, setRep] = useState(() => {
    if (!saved?.txt) return null
    try { return Object.assign(parseReport(saved.txt), { fileName: saved.name }) } catch { return null }
  })
  const [opt, setOpt] = useState(() => Object.assign({ mode: 'uniq', incAssy: true, uncls: 'limited' }, lsGet(LS_OPT, {})))
  const setO = (p) => setOpt((o) => { const n = { ...o, ...p }; lsSet(LS_OPT, n); return n })
  const [filt, setFilt] = useState({ grp: null, cls: null, q: '' })
  const [sort, setSort] = useState({ k: 'no', d: 'asc' })
  const [sel, setSel] = useState({})
  const [open, setOpen] = useState({})
  const [drag, setDrag] = useState(false)
  const fileRef = useRef(null)
  const { rowProps } = useRowSelect(useCallback((u) => setSel(u), []))
  const [ppt, setPpt] = useState(null) // { i, n, txt } 만드는 중
  const [dwg, setDwg] = useState(null) // 연결한 도면 폴더 색인
  const [dwgBusy, setDwgBusy] = useState('')
  const [dwgLast, setDwgLast] = useState('') // 지난번 폴더 이름
  const [dwgHandle, setDwgHandle] = useState(null)
  const [dwgPerm, setDwgPerm] = useState('none') // granted | prompt | denied | none
  const canDir = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
  const stopRef = useRef(false)

  function loadFile(f) {
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const r = parseReport(rd.result)
        r.fileName = f.name
        setRep(r); setSel({}); setOpen({})
        // 다음에 열 때 다시 안 올려도 되게. 용량이 크면 저장을 건너뛴다.
        lsSet(LS_REP, { name: f.name, txt: rd.result })
        toastSuccess(`${r.top.pn} Rev ${r.top.rev} — 품번 ${r.parts.size.toLocaleString('ko-KR')}개를 읽었습니다`)
      } catch (e) { toastError(e.message) }
    }
    rd.onerror = () => toastError('파일을 읽지 못했습니다')
    rd.readAsText(f, 'utf-8')
  }

  // 리포트에 나온 품번 전부의 발주 이력 (한 번만 받고 옵션을 바꿔도 다시 받지 않는다)
  const pnKey = rep ? [...rep.parts.keys()].join(',') : ''
  const { data: buy, isFetching: buyLoading, error: buyErr } = useQuery({
    queryKey: ['faiBuy', pnKey],
    queryFn: () => fetchBuyRecs([...rep.parts.keys()]),
    enabled: !!rep,
    staleTime: 5 * 60 * 1000,
  })

  const rows = useMemo(() => {
    if (!rep) return []
    const ctx = { buyIdx: buildBuyIndex(buy?.recs || []), man: {}, uncls: opt.uncls }
    return buildRows(rep, opt, ctx)
  }, [rep, buy, opt])

  const base = rows.filter((r) => r.e.v !== 'ASSY')
  const cnt = (g) => base.filter((r) => V[r.e.v].grp === g).length
  const linked = base.filter((r) => r.e.act.src).length
  const dwgStat = useMemo(() => {
    const ps = [...new Map(rows.filter((r) => isDwgPart(r.P)).map((r) => [r.P.pn, r.P])).values()]
    const st = { n: ps.length, ok: 0, bad: 0, miss: 0 }
    if (dwg) for (const P of ps) { const k = pickDwg(P, dwg); if (k?.file) { st.ok++; if (k.status === 'mismatch') st.bad++ } else st.miss++ }
    return st
  }, [rows, dwg])
  const itemFallback = (buy?.recs || []).filter((x) => x.mfrSrc === 'item').length

  const view = useMemo(() => {
    const q = filt.q.trim().toUpperCase()
    let v = rows.filter((r) => {
      if (filt.grp && V[r.e.v].grp !== filt.grp) return false
      if (filt.cls && r.ck !== filt.cls) return false
      if (!q) return true
      const hay = [r.P.pn, r.P.name, ...r.P.mfrs.map((m) => m.mfr + ' ' + m.mpn), r.e.act.mfr, r.e.act.mpn, r.e.act.vendor].join(' ').toUpperCase()
      return hay.includes(q)
    })
    const dir = sort.d === 'asc' ? 1 : -1
    const key = {
      no: (r) => r.no, pn: (r) => r.P.pn, cls: (r) => CLS_LABEL[r.ck], v: (r) => V[r.e.v].ord,
      vendor: (r) => r.e.act.vendor || '', date: (r) => r.e.act.date || '',
    }[sort.k]
    if (key) v = [...v].sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * dir })
    return v
  }, [rows, filt, sort])

  const selRows = view.filter((r) => sel[r.key])
  const onSort = (k) => setSort((s) => (s.k === k ? { k, d: s.d === 'asc' ? 'desc' : 'asc' } : { k, d: 'asc' }))

  async function exportXlsx() {
    const out = selRows.length ? selRows : view
    try {
      await downloadSheet({
        title: `초도품 자재 확인표 — ${rep.top.pn} Rev ${rep.top.rev}`,
        sheetName: '초도품 자재',
        fileName: `초도품자재_${rep.top.pn}_${rep.top.rev}_${todayISO()}.xlsx`,
        meta: [
          ['명칭', rep.top.name], ['기준 Part Report', rep.fileName || ''],
          ['보기', opt.mode === 'uniq' ? '고유 품번 합산' : 'BOM 전개 순서'],
          ['실제 사용 제조사', '발주 줄의 제조사 (비어 있으면 기준코드 DB 제조사)'],
          ['작성', `${todayISO()} · FAI Navigator ${APP_VER} © 김교한`],
        ],
        rows: out.map((r, i) => {
          const P = r.P, a = r.e.act, assy = r.e.v === 'ASSY'
          return {
            No: opt.mode === 'uniq' ? i + 1 : r.no,
            'Axcelis P/N': (opt.mode === 'tree' ? '  '.repeat(Math.max(0, r.lv - 1)) : '') + P.pn,
            품명: P.name,
            모품목: parentList(r, rep.top.pn).join(', '),
            Rev: P.rev,
            소요량: qtyText(r),
            구분: CLS_LABEL[r.ck],
            '등록 제조사·품번 (Part Report)': assy ? '' : P.mfrs.map((m) => `${m.mfr} ${m.mpn} (${m.status})`).join(' / '),
            '실제 사용 제조사': assy ? '' : a.mfr,
            '실제 사용 제조사품번': assy ? '' : a.mpn,
            거래처: assy ? '' : a.vendor,
            '최근 발주일': assy ? '' : a.date,
            발주번호: assy ? '' : a.doc,
            판정: V[r.e.v].t.replace(/^[^\wㄱ-힣]+\s*/, ''),
            'Acceptance Criteria': assy ? '' : P.accept,
          }
        }),
      })
    } catch (e) { toastError('엑셀 내보내기 실패: ' + e.message) }
  }

  // 도면 폴더 — 파일은 올리지 않고 이 PC 에서만 읽는다. 폴더 위치는 브라우저가 기억(다음엔 「다시 연결」 한 번)
  useEffect(() => {
    let off = false
    ;(async () => {
      // 목록과 폴더 위치는 따로 담는다 — 하나가 안 담겨도 다른 하나는 쓸 수 있게
      let cached = null
      try { cached = await loadList('dwg') } catch { /* 목록 없음 */ }
      let h = null
      try { h = await loadHandle('dwg') } catch { /* 폴더 기억 없음 */ }
      if (off) return
      if (h) { setDwgLast(h.name); setDwgHandle(h) }
      if (cached?.files?.length) {
        // 지난번에 훑어 둔 목록이 있으면 폴더를 다시 안 훑는다 (수만 개면 몇 분 걸린다)
        const idx = indexDwg(cached.files, cached.name || h?.name || '')
        idx.at = cached.at; idx.root = h
        setDwg(idx)
      }
      if (h) setDwgPerm(await dirPermission(h))
    })()
    return () => { off = true }
  }, [])
  async function readDwg(dh, quiet) {
    const t0 = Date.now()
    setDwgBusy(`${dh.name} 폴더 훑는 중…`)
    try {
      const files = await walkDir(dh, (seen, n) => setDwgBusy(
        `${dh.name} 폴더 훑는 중… 파일 ${seen.toLocaleString('ko-KR')}개 · PDF ${n.toLocaleString('ko-KR')}개 (${Math.round((Date.now() - t0) / 1000)}초)`))
      const idx = indexDwg(files, dh.name)
      if (!idx.count) { toastError('PDF 도면이 없는 폴더입니다'); return }
      idx.at = todayISO(); idx.root = dh
      setDwg(idx); setDwgLast(dh.name); setDwgHandle(dh); setDwgPerm('granted')
      // 폴더 위치와 파일 목록을 기억해 둔다 (파일 내용은 저장하지 않는다)
      try { await saveHandle('dwg', dh) } catch { /* 폴더 위치를 못 담아도 이번엔 쓸 수 있다 */ }
      try { await saveList('dwg', { name: dh.name, at: idx.at, files }) } catch { /* 목록을 못 담아도 이번엔 쓸 수 있다 */ }
      if (!quiet) toastSuccess(`도면 폴더 ${dh.name} — PDF ${idx.count.toLocaleString('ko-KR')}개 (${Math.round((Date.now() - t0) / 1000)}초)`)
    } catch (e) { toastError('도면 폴더를 읽지 못했습니다: ' + (e?.message || e)) }
    finally { setDwgBusy('') }
  }
  async function chooseDwg() {
    try { await readDwg(await window.showDirectoryPicker({ id: 'pm-fai-dwg', mode: 'read' })) }
    catch (e) { if (e?.name !== 'AbortError') toastError('폴더를 열지 못했습니다: ' + (e?.message || e)) }
  }
  // 권한만 다시 받기 — 목록은 그대로 쓰므로 폴더를 다시 훑지 않는다 (몇 초면 끝)
  async function allowDwg() {
    const h = dwgHandle || await loadHandle('dwg')
    if (!h) return chooseDwg()
    const p = await askDirPermission(h)
    setDwgPerm(p); setDwgHandle(h)
    if (p !== 'granted') { toastError('폴더 읽기 권한이 없습니다'); return }
    if (!dwg) { const cached = await loadList('dwg'); if (cached?.files?.length) { const idx = indexDwg(cached.files, cached.name || h.name); idx.at = cached.at; idx.root = h; setDwg(idx); return } }
    if (dwg && !dwg.root) setDwg({ ...dwg, root: h })
    toastSuccess('도면 폴더를 쓸 수 있습니다')
  }
  // 폴더를 다시 훑는다 (도면이 새로 들어왔을 때)
  async function rescanDwg() {
    const h = dwgHandle || await loadHandle('dwg')
    if (!h) return chooseDwg()
    if ((await dirPermission(h)) !== 'granted' && (await askDirPermission(h)) !== 'granted') { toastError('폴더 읽기 권한이 없습니다'); return }
    setDwgPerm('granted')
    await readDwg(h)
  }

  // 품목별 PPT — 저장 위치를 먼저 고르고(버튼 누른 순간에만 창을 띄울 수 있다) 만든 뒤 그 자리에 쓴다
  async function makePpt() {
    if (ppt) return
    const out = selRows.length ? selRows : view
    if (!out.length) { toastError('내보낼 품목이 없습니다'); return }
    if (out.length > 150 && !window.confirm(`${out.length}건을 만듭니다. 몇 분 걸릴 수 있습니다. 계속할까요?\n(일부만 필요하면 표에서 골라서 다시 누르세요)`)) return
    const name = pptName(rep)
    const target = await pickSaveTarget(name)
    if (!target) return // 저장 창에서 취소
    stopRef.current = false
    setPpt({ i: 0, n: out.length, txt: '준비 중' })
    try {
      const res = await buildFaiPpt({
        rep, rows: out, dwgIdx: dwg,
        noOf: (r, i) => (opt.mode === 'uniq' ? i + 1 : r.no),
        onProgress: (i, n, txt) => setPpt({ i, n, txt }),
        askStop: async (i) => {
          if (!stopRef.current) return null
          stopRef.current = false
          return i && window.confirm(`${i}건까지 만들었습니다.\n\n[확인] 지금까지 만든 ${i}건만 PPT로 저장\n[취소] 저장하지 않고 멈춤`) ? 'save' : 'cancel'
        },
      })
      const saved = await saveBytes(target, res.blob, name)
      toastSuccess((res.stopped ? `중지 — ${res.done}건만 저장 · ` : '') + `PPT ${res.slides}장 저장 (${(res.size / 1048576).toFixed(1)}MB) — ${saved}`
        + (res.noRec ? ` · 발주 기록 없는 품목 ${res.noRec}건` : '')
        + (res.dwg.n ? ` · 도면 ${res.dwg.ok}/${res.dwg.n}장` + (dwg ? '' : ' (도면 폴더 미연결)') : ''))
    } catch (e) {
      if (e && e.cancel) toastSuccess('PPT 만들기를 멈췄습니다 (저장 안 함)')
      else toastError('PPT 만들기 실패: ' + (e?.message || e))
    } finally {
      setPpt(null)
    }
  }

  const kpis = [
    { g: null, s: '', t: '대상 품목', v: base.length, n: `${opt.mode === 'uniq' ? '고유 품번' : 'BOM 전개 줄'} · 자체제작 ${(rows.length - base.length).toLocaleString('ko-KR')}건 별도` },
    { g: 'ok', s: 'ok', t: '적합', v: cnt('ok'), n: '등록품 일치 · 승인이력 · 구매확인' },
    { g: 'gen', s: 'gen', t: 'Generic 자체판단', v: cnt('gen'), n: '스펙 문구와 대조만 하면 됨' },
    { g: 'chk', s: 'chk', t: '확인 필요', v: cnt('chk'), n: '승인이력 필요 · 사용금지 · 품번 불명' },
    { g: 'none', s: 'none', t: '이력 없음', v: cnt('none'), n: '발주 이력 없음 · 제조사 미등록품' },
    { g: '__cov', s: 'cov', t: '발주 이력 연결률', v: base.length ? Math.round((linked / base.length) * 100) + '%' : '—',
      n: buy ? `품목 ${buy.itemCount.toLocaleString('ko-KR')}/${buy.codeCount.toLocaleString('ko-KR')}개 등록 · 발주 ${buy.recs.length.toLocaleString('ko-KR')}줄` : (buyLoading ? '불러오는 중…' : '—') },
  ]
  const CLS_ORDER = ['generic', 'limited', 'sole', 'uncls', 'nomfr', 'assy']

  return (
    <div className="space-y-4">
      {/* 머리 */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">🔬 품질</p>
          <h1 className="text-xl font-extrabold text-slate-900">초도품 자재 매칭 <span className="text-sm font-bold text-slate-400">FAI Navigator</span></h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            Axcelis Part Report 를 올리면 품목마다 <b className="text-slate-500">등록된 제조사</b>와 <b className="text-slate-500">실제로 구매한 제조사</b>를 맞대어 판정합니다.
            초도품 제출 전에 구매팀이 먼저 점검하는 용도입니다.
          </p>
        </div>
        <p className="text-[10px] text-slate-400 text-right leading-relaxed">
          FAI Navigator {APP_VER}<br />Developed by 김교한 (Gyohan Kim) · © 2026 진선테크 구매자재팀<br />무단 수정·재배포 금지
        </p>
      </div>

      {/* 올리기 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); loadFile(e.dataTransfer.files?.[0]) }}
        className={`rounded-xl border-2 border-dashed p-4 flex items-center gap-4 flex-wrap transition-colors ${drag ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-[#f9fafc]'}`}>
        <div className="text-2xl">📄</div>
        <div className="flex-1 min-w-[240px]">
          <p className="text-sm font-bold text-slate-700">① Part Report (.htm)</p>
          {rep ? (
            <p className="text-xs text-emerald-700 mt-0.5">
              ✔ {rep.fileName || '(지난번 파일)'} — <b>{rep.top.pn}</b> Rev {rep.top.rev} · {rep.top.name} · 품번 {rep.parts.size.toLocaleString('ko-KR')}개
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">Windchill 에서 받은 Part report 파일을 끌어다 놓거나 선택하세요. 한 번 올리면 이 PC 에 기억됩니다.</p>
          )}
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
          {rep ? '다른 리포트' : '파일 선택'}
        </button>
        <input ref={fileRef} type="file" accept=".htm,.html" className="hidden"
          onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = '' }} />
      </div>

      {rep && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 flex-wrap">
          <div className="text-xl">📐</div>
          <div className="flex-1 min-w-[240px]">
            <p className="text-sm font-bold text-slate-700">② 도면 폴더 <span className="text-[11px] font-semibold text-slate-400">— PPT 의 16·17번대 도면 칸 (선택)</span></p>
            {dwgBusy ? <p className="text-xs text-indigo-600 mt-0.5">⏳ {dwgBusy}</p>
              : dwg ? (
                <p className="text-xs text-emerald-700 mt-0.5">
                  ✔ {dwg.name} — PDF {dwg.count.toLocaleString('ko-KR')}개 · 16·17번대 {dwgStat.n}개 중 <b>{dwgStat.ok}개 연결</b>
                  {dwgStat.bad > 0 && <span className="text-rose-600"> · ⚠ 리비전 불일치 {dwgStat.bad}</span>}
                  {dwgStat.miss > 0 && <span className="text-amber-600"> · 폴더에 없음 {dwgStat.miss}</span>}
                  {dwg.at && <span className="text-slate-400"> · {dwg.at} 읽은 목록</span>}
                  {dwgPerm !== 'granted' && <span className="text-amber-600 font-bold"> · 읽기 권한 필요</span>}
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-0.5">
                  {canDir ? 'Windchill 에서 받은 도면 PDF 폴더를 고르세요. 파일은 서버에 올라가지 않고 이 PC 에서만 읽습니다.' : '폴더 연결은 크롬·엣지에서만 됩니다.'}
                  {dwgStat.n > 0 && ` (이 리포트의 16·17번대 ${dwgStat.n}개)`}
                </p>
              )}
          </div>
          {canDir && dwgPerm !== 'granted' && (dwg || dwgLast) && (
            <button onClick={allowDwg} disabled={!!dwgBusy}
              title="폴더를 다시 훑지 않고 읽기 권한만 받습니다 — 몇 초면 끝납니다"
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-40">
              🔓 폴더 쓰기 허용{dwgLast ? `: ${dwgLast}` : ''}
            </button>
          )}
          {canDir && (dwg || dwgLast) && (
            <button onClick={rescanDwg} disabled={!!dwgBusy}
              title="도면이 새로 들어왔을 때만 누르세요. 파일이 많으면 몇 분 걸립니다"
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">↻ 다시 읽기</button>
          )}
          {canDir && (
            <button onClick={chooseDwg} disabled={!!dwgBusy}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">
              {dwg || dwgLast ? '다른 폴더' : '폴더 선택'}
            </button>
          )}
        </div>
      )}

      {!rep ? null : (
        <>
          {/* 옵션 */}
          <div className="flex items-center gap-4 flex-wrap text-xs">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {[['uniq', '고유 품번 합산'], ['tree', 'BOM 전개 순서']].map(([k, l]) => (
                <button key={k} onClick={() => setO({ mode: k })}
                  className={`px-3 py-1 rounded-md font-bold ${opt.mode === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
              ))}
            </div>
            {opt.mode === 'uniq' && (
              <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
                <input type="checkbox" checked={opt.incAssy} onChange={(e) => setO({ incAssy: e.target.checked })} /> 조립품도 목록에
              </label>
            )}
            <label className="flex items-center gap-1.5 text-slate-600">
              미분류(Class 표기 없음)는
              <select value={opt.uncls} onChange={(e) => setO({ uncls: e.target.value })}
                className="px-2 py-1 border border-slate-200 rounded-lg bg-white">
                <option value="limited">등록품만 인정</option>
                <option value="generic">Generic 처럼 자체판단</option>
              </select>
            </label>
          </div>

          {buyErr && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              발주 이력을 못 불러왔습니다 — {buyErr.message}. 판정이 모두 「이력 없음」으로 보일 수 있습니다.
            </div>
          )}
          {itemFallback > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              ⚠ 발주 {itemFallback.toLocaleString('ko-KR')}줄은 발주 줄에 제조사가 비어 있어 <b>기준코드 DB 의 제조사</b>로 대신 판정했습니다.
            </div>
          )}

          {/* 지표 */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {kpis.map((k) => {
              const on = k.g && k.g !== '__cov' && filt.grp === k.g
              return (
                <button key={k.t} disabled={k.g === '__cov'}
                  onClick={() => k.g !== '__cov' && setFilt((f) => ({ ...f, grp: f.grp === k.g ? null : k.g }))}
                  className={`text-left rounded-xl border p-3 transition ${KPI_STYLE[k.s]} ${on ? 'ring-2 ring-indigo-400' : ''} ${k.g === '__cov' ? 'cursor-default' : 'hover:shadow-sm'}`}>
                  <div className="text-[12px] font-semibold text-slate-400">{k.t}</div>
                  <div className={`text-2xl font-extrabold tabular-nums ${KPI_NUM[k.s]}`}>{typeof k.v === 'number' ? k.v.toLocaleString('ko-KR') : k.v}</div>
                  <div className="text-[10.5px] text-slate-400 leading-snug">{k.n}</div>
                </button>
              )
            })}
          </div>

          {/* 필터 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setFilt((f) => ({ ...f, cls: null }))}
              className={`px-3 py-1 rounded-full text-xs font-bold border ${!filt.cls ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>전체 구분</button>
            {CLS_ORDER.map((c) => {
              const n = rows.filter((r) => r.ck === c).length
              if (!n) return null
              return (
                <button key={c} onClick={() => setFilt((f) => ({ ...f, cls: f.cls === c ? null : c }))}
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${filt.cls === c ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {CLS_LABEL[c]} <span className="opacity-60">{n}</span>
                </button>
              )
            })}
            <input value={filt.q} onChange={(e) => setFilt((f) => ({ ...f, q: e.target.value }))}
              placeholder="품번·품명·제조사·제조사품번·거래처 검색"
              className="ml-auto px-3 py-1.5 text-sm border border-slate-200 rounded-[10px] w-72" />
          </div>

          {/* 선택 요약 + 내보내기 */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-slate-500">
              {view.length.toLocaleString('ko-KR')}줄 보임
              {selRows.length > 0 && <> · <b className="text-indigo-600">{selRows.length.toLocaleString('ko-KR')}줄 선택</b></>}
            </span>
            <button onClick={() => setSel(Object.fromEntries(view.map((r) => [r.key, true])))}
              className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">보이는 것 전체선택</button>
            {selRows.length > 0 && (
              <button onClick={() => setSel({})} className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">선택해제</button>
            )}
            <button onClick={exportXlsx} disabled={!view.length}
              className="ml-auto px-3 py-1.5 font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
              📑 엑셀 {selRows.length ? `(선택 ${selRows.length}줄)` : '(보이는 것)'}
            </button>
            <button onClick={makePpt} disabled={!view.length || !!ppt}
              title="저장할 곳을 고른 뒤 품목마다 한 장씩 만듭니다 (Part Report 발췌 · 16·17번대 도면 · 구매전표 — 금액 칸 없음)"
              className="px-3 py-1.5 font-bold rounded-lg border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-40">
              📊 PPT {selRows.length ? `(선택 ${selRows.length}줄)` : '(보이는 것)'}
            </button>
          </div>

          {ppt && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 flex items-center gap-3 text-xs">
              <span className="font-bold text-orange-700 whitespace-nowrap">PPT 만드는 중 <span className="font-normal text-orange-500">— 창을 닫지 마세요</span></span>
              <div className="flex-1 h-2 rounded-full bg-orange-100 overflow-hidden">
                <div className="h-full bg-orange-400 transition-all" style={{ width: `${ppt.n ? Math.round((ppt.i / ppt.n) * 100) : 0}%` }} />
              </div>
              <span className="tabular-nums text-orange-700 whitespace-nowrap">{ppt.i.toLocaleString('ko-KR')} / {ppt.n.toLocaleString('ko-KR')} · {ppt.txt}</span>
              <button onClick={() => { stopRef.current = true; setPpt((p) => p && { ...p, txt: '멈추는 중…' }) }}
                className="px-2.5 py-1 rounded-lg border border-orange-300 bg-white text-orange-700 font-bold hover:bg-orange-100">멈추기</button>
            </div>
          )}

          {/* 표 */}
          <ResizableTable cols={COLS} storageKey="fai-navigator-cols" sortKey={sort.k} sortDir={sort.d} onSort={onSort}>
            {() => (
              <tbody>
                {view.map((r) => {
                  const P = r.P, a = r.e.act, assy = r.e.v === 'ASSY', on = !!sel[r.key], isOpen = !!open[r.key]
                  const pars = parentList(r, rep.top.pn)
                  return (
                    <Fragment key={r.key}>
                      <tr {...rowProps(r.key, on)}
                        className={`border-t border-slate-100 align-top cursor-pointer ${on ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2"><input type="checkbox" checked={on} onChange={() => setSel((s) => ({ ...s, [r.key]: !on }))} /></td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.no}</td>
                        <td className="px-3 py-2 overflow-hidden" style={opt.mode === 'tree' ? { paddingLeft: 12 + Math.max(0, r.lv - 2) * 14 } : undefined}>
                          <button data-no-select onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}
                            className="font-mono font-semibold text-indigo-600 hover:underline whitespace-nowrap">
                            {isOpen ? '▾' : '▸'} {P.pn}
                          </button>
                          <div className="text-[11px] text-slate-400 truncate" title={P.name}>{P.name}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-500">{P.rev || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{qtyText(r)}{r.occ > 1 && <div className="text-[10px] text-slate-400">{r.occ}곳</div>}</td>
                        <td className="px-3 py-2"><Badge b={CLS_BADGE[r.ck]}>{CLS_LABEL[r.ck]}</Badge></td>
                        <td className="px-3 py-2"><Badge b={V[r.e.v].b}>{V[r.e.v].t}</Badge>
                          {r.e.note && <div className="text-[10px] text-slate-400 mt-0.5">{r.e.note}</div>}</td>
                        <td className="px-3 py-2 overflow-hidden">
                          {assy || !P.mfrs.length ? <span className="text-slate-300">—</span> : (
                            <div className="text-[11px] leading-snug">
                              {P.mfrs.slice(0, 2).map((m, i) => (
                                <div key={i} className="truncate" title={`${m.mfr} ${m.mpn} (${m.status})`}>
                                  <span className="text-slate-500">{m.mfr}</span> <b className="font-mono">{m.mpn}</b>
                                  {/Preferred/i.test(m.status) && <span className="text-amber-500"> ★</span>}
                                  {/Do Not Use/i.test(m.status) && <span className="text-rose-600 font-bold"> 금지</span>}
                                  {/OBS/i.test(m.status) && <span className="text-slate-400"> 단종</span>}
                                </div>
                              ))}
                              {P.mfrs.length > 2 && <div className="text-slate-400">+{P.mfrs.length - 2}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 overflow-hidden text-[11px]">
                          {assy ? <span className="text-slate-300">—</span> : (a.mfr || a.mpn) ? (
                            <div className="truncate" title={`${a.mfr} ${a.mpn}`}>
                              <span className="text-slate-500">{a.mfr}</span> <b className="font-mono">{a.mpn}</b>
                            </div>
                          ) : <span className="text-slate-300">—</span>}
                          {r.e.recs.length > 1 && <div className="text-[10px] text-slate-400">발주 {r.e.recs.length}건</div>}
                        </td>
                        <td className="px-3 py-2 truncate text-slate-600">{assy ? '' : a.vendor || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-500">{assy ? '' : a.date || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500 truncate">{assy ? '' : a.doc || <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500 truncate" title={pars.join(', ')}>
                          {pars.length ? pars[0] + (pars.length > 1 ? ` +${pars.length - 1}` : '') : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={COLS.length} className="px-4 py-3">
                            <div className="grid md:grid-cols-2 gap-4 text-[11px]">
                              <div>
                                <p className="font-bold text-slate-500 mb-1">Part Report 등록 제조사 ({P.mfrs.length})</p>
                                {P.mfrs.length ? (
                                  <table className="w-full"><tbody>
                                    {P.mfrs.map((m, i) => (
                                      <tr key={i} className={`border-t border-slate-200 ${r.e.hit === m ? 'bg-emerald-50' : ''}`}>
                                        <td className="py-1 pr-2 text-slate-500">{m.mfr}</td>
                                        <td className="py-1 pr-2 font-mono font-semibold">{m.mpn}</td>
                                        <td className="py-1 pr-2">{m.status}</td>
                                        <td className="py-1 text-slate-400">{[m.rohs && `RoHS ${m.rohs}`, m.cert].filter(Boolean).join(' · ')}</td>
                                      </tr>
                                    ))}
                                  </tbody></table>
                                ) : <p className="text-slate-400">등록된 제조사 없음</p>}
                                {P.accept && <p className="mt-2 text-slate-500"><b>Acceptance Criteria</b> — {P.accept}</p>}
                                {(P.dwgDocs?.length || P.cpsDocs?.length) ? (
                                  <p className="mt-1 text-slate-400">
                                    {P.dwgDocs?.length ? `도면 ${P.dwgDocs.map((d) => d.file).join(', ')}` : ''}
                                    {P.cpsDocs?.length ? ` · 사양서 ${P.cpsDocs.map((d) => d.file).join(', ')}` : ''}
                                  </p>
                                ) : null}
                              </div>
                              <div>
                                <p className="font-bold text-slate-500 mb-1">발주 이력 ({r.e.recs.length})</p>
                                {r.e.recs.length ? (
                                  <table className="w-full"><tbody>
                                    {r.e.recs.slice(0, 12).map((x, i) => (
                                      <tr key={i} className={`border-t border-slate-200 ${i === 0 ? 'font-semibold' : ''}`}>
                                        <td className="py-1 pr-2 tabular-nums">{x.date || '—'}</td>
                                        <td className="py-1 pr-2">{x.vendor || '—'}</td>
                                        <td className="py-1 pr-2 font-mono">{x.doc || '—'}</td>
                                        <td className="py-1 text-right tabular-nums">{x.qty != null ? Number(x.qty).toLocaleString('ko-KR') : ''}</td>
                                      </tr>
                                    ))}
                                  </tbody></table>
                                ) : <p className="text-slate-400">이 품번의 구매발주가 없습니다. (기준코드 DB 에 AX-{normAx(P.pn)} 가 없을 수도 있습니다)</p>}
                                {r.e.recs.length > 12 && <p className="text-slate-400 mt-1">… 외 {r.e.recs.length - 12}건</p>}
                                <p className="text-slate-400 mt-1">판정은 가장 최근 발주(굵게) 기준입니다.</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!view.length && (
                  <tr><td colSpan={COLS.length} className="py-10 text-center text-slate-400">조건에 맞는 품목이 없습니다.</td></tr>
                )}
              </tbody>
            )}
          </ResizableTable>
        </>
      )}
    </div>
  )
}
