import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { toastError, toastSuccess } from '../../lib/toast'
import { useCanEdit, useMe } from '../../hooks/useProfile'
import { useDebounced } from '../../hooks/useDebounced'
import {
  parseCN, derive, decodeCN, summarize, searchText, repData, subTree,
  usDate, toKo, koName, DISP, TYPE_KO,
} from '../../lib/cnParse'

// 🔁 설계변경(CN) 이력 — 품질 (2026-10-14)
//   Axcelis 에서 받은 CN Summary(HTML)를 올리면 분석 결과를 DB 에 남겨 누구나 다시 본다.
//   부서 회신 · ECN 통보서는 넣지 않는다 — 부서별 확인은 생산기술팀이 따로 챙긴다.
//   생산기술팀은 목록 · 상세에서 「생기 리뷰」를 체크한다.

const AX_ID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'
const LIST_COLS = 'id,cn_no,title,file_name,version,summary,our_parts,date_from,date_to,memo,reviewed,reviewed_name,reviewed_at,created_name,created_at,updated_name,updated_at'
const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const yy = (d) => (d ? String(d).slice(2, 10) : '')
const axCode = (pn) => 'AX-' + String(pn || '').replace(/^AX-/i, '')
const isMfgPn = (pn) => /_[A-Z][A-Z0-9 .,&/-]{2,}$/.test(pn || '')
const thisMonth = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)
export const missingTable = (e) => /pm_cn_doc/.test(String(e?.message || e)) && /exist|schema cache|relation/i.test(String(e?.message || e))

const BADGE = {
  blue: 'bg-sky-50 text-sky-700 border-sky-200', red: 'bg-rose-50 text-rose-600 border-rose-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200', green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  gray: 'bg-slate-50 text-slate-500 border-slate-200', pr: 'bg-violet-50 text-violet-700 border-violet-200',
}
const CLS2TONE = { 'b-blue': 'blue', 'b-red': 'red', 'b-amber': 'amber', 'b-green': 'green', 'b-gray': 'gray', 'b-pr': 'pr' }
function Badge({ tone = 'gray', children, title }) {
  return <span title={title} className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${BADGE[tone]}`}>{children}</span>
}
function Kpi({ tone, label, value, note }) {
  const T = {
    pr: 'bg-violet-50 border-violet-200 text-violet-700', blue: 'bg-sky-50 border-sky-200 text-sky-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700', red: 'bg-rose-50 border-rose-200 text-rose-600',
    amber: 'bg-amber-50 border-amber-200 text-amber-700', '': 'bg-white border-slate-200 text-slate-900',
  }[tone || '']
  return (
    <div className={`rounded-xl border px-4 py-3 ${T}`}>
      <div className="text-[12px] font-bold text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold leading-tight">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  )
}
const Card = ({ title, sub, right, children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-slate-200 p-4 ${className}`}>
    {(title || right) && (
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          {title && <h2 className="text-[14px] font-extrabold text-slate-900">{title}</h2>}
          {sub && <p className="text-[12px] text-slate-400">{sub}</p>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
)
const Empty = ({ children }) => <p className="py-6 text-center text-[12px] text-slate-400">{children}</p>
const dispTone = (v) => ({ UAI: 'green', NEW: 'blue', NONE: 'gray', REWORK: 'amber', SCRAP: 'red', RTV: 'red' }[String(v || '').toUpperCase()] || 'gray')
const DispBadge = ({ v }) => v ? <Badge tone={dispTone(v)} title={DISP[String(v).toUpperCase()]?.[1] || ''}>{v}</Badge> : <span className="text-slate-300">—</span>
const Rev = ({ from, to }) => (
  <span className="font-mono font-extrabold whitespace-nowrap">{from || '-'}<span className="text-slate-300 font-normal mx-0.5">→</span><span className="text-violet-600">{to || '-'}</span></span>
)
const ActBadge = ({ act }) => act === 'ADD' ? <Badge tone="green">추가</Badge> : act === 'DEL' ? <Badge tone="red">삭제</Badge> : <Badge tone="amber">변경</Badge>
const PnCell = ({ pn, name }) => {
  const k = koName(name)
  return (
    <td className="px-2 py-1.5">
      <div className="font-mono font-bold text-indigo-600">{pn}</div>
      <div className="text-[11px] text-slate-400 truncate max-w-[360px]" title={name}>{name}{k ? ` · ${k}` : ''}</div>
    </td>
  )
}

// ── 파일 → 저장할 줄 ────────────────────────────────────────────────
export async function buildCnRow(buf, fileName) {
  const html = decodeCN(buf)
  if (!/FROM DESCRIPTION:/.test(html)) throw new Error('CN Summary 형식이 아닙니다 (FROM DESCRIPTION 이 없음)')
  const cn = parseCN(html, fileName)
  if (!cn.parts.length) throw new Error('변경 품목을 찾지 못했습니다')
  const d = derive(cn)
  // 자사 품번 = 고객사(AXCELIS) BOM 이 등록된 품번
  const codes = [...new Set(cn.parts.map(p => p.partNo).filter(pn => pn && !isMfgPn(pn)))].map(axCode)
  const ours = new Set()
  for (let i = 0; i < codes.length; i += 200) {
    const rows = must(await supabase.from('projects').select('code').eq('customer_id', AX_ID).in('code', codes.slice(i, i + 200)), '자사 품번 조회')
    ;(rows || []).forEach(r => ours.add(String(r.code).replace(/^AX-/i, '')))
  }
  const our_parts = cn.parts.map(p => p.partNo).filter(pn => ours.has(pn))
  return {
    row: {
      cn_no: cn.number, title: cn.title || null, file_name: fileName,
      parsed: JSON.parse(JSON.stringify(cn)), summary: summarize(cn, d), our_parts,
      search_text: searchText(cn), date_from: d.dateFrom || null, date_to: d.dateTo || null, raw_html: html,
    },
    cn, d,
  }
}

export default function CnHistory() {
  const [sp, setSp] = useSearchParams()
  const id = sp.get('id')
  return id
    ? <CnDetail id={id} onBack={() => setSp({})} />
    : <CnList onOpen={(x) => setSp({ id: x })} />
}

// ═════════════════════════════════ 목록 ═════════════════════════════════
function CnList({ onOpen }) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const me = useMe()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 300)
  const [f, setF] = useState('all')
  const [busy, setBusy] = useState(false)

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: ['cnDocs', dq],
    queryFn: () => fetchAll(() => {
      let x = supabase.from('pm_cn_docs').select(LIST_COLS)
      if (dq) x = x.ilike('search_text', `%${dq}%`)
      return x.order('created_at', { ascending: false }).order('id')
    }),
    staleTime: 60 * 1000,
  })

  // 이번 달 CN 의 신규 품번 등록 여부 · 단종 품번 재고/발주잔 — 지표 보조 숫자
  const month = thisMonth()
  const monthDocs = docs.filter(x => String(x.created_at || '').slice(0, 7) === month)
  const monNew = [...new Set(monthDocs.flatMap(x => x.summary?.newPns || []))]
  const monEol = [...new Set(monthDocs.flatMap(x => x.summary?.eolPns || []))]
  const { data: kx } = useQuery({
    queryKey: ['cnKpi', month, monNew.join(','), monEol.join(',')],
    enabled: !dq && (monNew.length + monEol.length) > 0,
    queryFn: async () => {
      const im = await itemMap([...monNew, ...monEol])
      const st = await stockOf(monEol.map(p => im[p]?.id).filter(Boolean))
      return {
        unreg: monNew.filter(p => !im[p]).length,
        live: monEol.filter(p => { const it = im[p]; return it && ((st.inv[it.id] || 0) > 0 || (st.po[it.id] || 0) > 0) }).length,
      }
    },
    staleTime: 60 * 1000,
  })

  const rows = useMemo(() => docs.filter(x =>
    f === 'all' ? true
      : f === 'ours' ? (x.our_parts || []).length > 0
      : f === 'new' ? (x.summary?.newPns || []).length > 0
      : f === 'eol' ? (x.summary?.eolPns || []).length > 0
      : f === 'review' ? !x.reviewed : true), [docs, f])

  async function upload(file) {
    if (!file) return
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const { row } = await buildCnRow(buf, file.name)
      const who = me?.name || me?.email || null
      const old = must(await supabase.from('pm_cn_docs').select('*').eq('cn_no', row.cn_no).maybeSingle(), 'CN 조회')
      if (old) {
        if (!confirm(`${row.cn_no} 은(는) 이미 있습니다 (${yy(old.created_at)} ${old.created_name || ''} · ${old.version}판).\n\n새 판으로 덮어쓸까요? 이전 판은 이력으로 남고, 메모 · 생기 리뷰는 그대로 둡니다.`)) return
        must(await supabase.from('pm_cn_doc_versions').insert({
          doc_id: old.id, cn_no: old.cn_no, version: old.version || 1, file_name: old.file_name,
          parsed: old.parsed, raw_html: old.raw_html, created_name: old.updated_name || old.created_name,
          created_at: old.updated_at || old.created_at, replaced_name: who,
        }), '이전 판 보관')
        must(await supabase.from('pm_cn_docs').update({
          ...row, version: (old.version || 1) + 1, updated_name: who, updated_at: new Date().toISOString(),
        }).eq('id', old.id), 'CN 갱신')
        toastSuccess(`${row.cn_no} 을(를) ${(old.version || 1) + 1}판으로 갱신했습니다`)
        qc.invalidateQueries({ queryKey: ['cnDocs'], exact: false })
        qc.invalidateQueries({ queryKey: ['cnDoc', old.id] })
        onOpen(old.id)
      } else {
        const ins = must(await supabase.from('pm_cn_docs').insert({ ...row, created_name: who, updated_name: who }).select('id').single(), 'CN 저장')
        toastSuccess(`${row.cn_no} 을(를) 올렸습니다 — 변경 품목 ${row.summary.parts} · BOM ${n(row.summary.bom)}행`)
        qc.invalidateQueries({ queryKey: ['cnDocs'], exact: false })
        onOpen(ins.id)
      }
    } catch (e) {
      toastError(missingTable(e) ? 'CN 이력 테이블이 아직 없습니다 — pm_cn_docs SQL 을 먼저 실행해 주세요' : '올리기 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  const yr = new Date().getFullYear()
  const thisYear = docs.filter(x => String(x.created_at || '').startsWith(String(yr))).length
  const pill = (k) => `px-3 py-1.5 rounded-full border text-xs font-bold ${f === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">🔬 품질 · AXCELIS</p>
          <h1 className="text-xl font-extrabold text-slate-900">🔁 설계변경(CN) 이력</h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            Axcelis 에서 받은 CN Summary(HTML)를 올려 두는 곳입니다. 올리면 리비전 · BOM 추가/변경/삭제 · 신규/단종 품번을 뽑아 저장하고, 누구나 같은 내용을 다시 볼 수 있습니다.
            생산기술팀은 검토한 CN 에 「생기 리뷰」를 체크합니다.
          </p>
        </div>
        {canEdit && (
          <label data-cn-upload className={`px-3 py-2 text-xs font-bold rounded-lg text-white cursor-pointer ${busy ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
            {busy ? '분석 중…' : '＋ CN 파일 올리기'}
            <input type="file" accept=".html,.htm" className="hidden" disabled={busy}
              onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; upload(fl) }} />
          </label>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {missingTable(error) ? '⚠ CN 이력 테이블이 아직 없습니다 — Supabase 에서 pm_cn_docs SQL 을 먼저 실행해 주세요.' : '⚠ 목록을 못 불러왔습니다: ' + error.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-cn-kpi>
        <Kpi label="등록된 CN" value={n(docs.length)} note={`${yr}년 ${n(thisYear)}건${dq ? ' · 검색 결과' : ''}`} />
        <Kpi tone="pr" label="이번 달" value={n(monthDocs.length)} note={`${+month.slice(5)}월에 올린 CN`} />
        <Kpi tone="blue" label="자사 품번 영향" value={n(docs.filter(x => (x.our_parts || []).length).length)} note="우리 BOM 품번이 걸린 CN" />
        <Kpi tone="green" label="신규 품번 (이번 달)" value={n(monNew.length)} note={kx ? `아직 품목 미등록 ${n(kx.unreg)}` : '이번 달 CN 기준'} />
        <Kpi tone="red" label="단종 품번 (이번 달)" value={n(monEol.length)} note={kx ? `재고·발주잔 있는 것 ${n(kx.live)}` : '이번 달 CN 기준'} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {[['all', '전체'], ['ours', '자사 품번 영향'], ['new', '신규 있음'], ['eol', '단종 있음'], ['review', '생기 리뷰 전']].map(([k, l]) => (
            <button key={k} data-cn-filter={k} onClick={() => setF(k)} className={pill(k)}>{l}</button>
          ))}
          <input data-cn-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="CN 번호 · 제목 · 품번 · 품명 검색"
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-72" />
          <span className="ml-auto text-xs text-slate-400">{n(rows.length)}건</span>
        </div>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">CN 번호 / 제목</th>
                <th className="px-2 py-2 text-left">올린 날</th>
                <th className="px-2 py-2 text-left">적용 시점</th>
                <th className="px-2 py-2 text-left">자사 품번</th>
                <th className="px-2 py-2 text-right">변경 품목</th>
                <th className="px-2 py-2 text-center">BOM <span className="font-normal text-slate-400">추가/변경/삭제</span></th>
                <th className="px-2 py-2 text-center">신규</th>
                <th className="px-2 py-2 text-center">단종</th>
                <th className="px-2 py-2 text-left">올린 사람</th>
                <th className="px-2 py-2 text-center">생기 리뷰</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10}><Empty>불러오는 중…</Empty></td></tr>}
              {!isLoading && !rows.length && <tr><td colSpan={10}><Empty>{docs.length ? '조건에 맞는 CN 이 없습니다.' : '아직 올린 CN 이 없습니다. 오른쪽 위 「＋ CN 파일 올리기」로 시작하세요.'}</Empty></td></tr>}
              {rows.map(x => {
                const s = x.summary || {}
                const ours = x.our_parts || []
                return (
                  <tr key={x.id} data-cn-row={x.cn_no} onClick={() => onOpen(x.id)} className="border-t border-slate-100 hover:bg-indigo-50/40 cursor-pointer">
                    <td className="px-2 py-2">
                      <div className="font-mono font-bold text-indigo-600">{x.cn_no}{x.version > 1 && <span className="ml-1 text-[10px] text-slate-400 font-normal">{x.version}판</span>}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[340px]" title={x.title}>{x.title || '—'}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{yy(x.created_at)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{x.date_from ? `${yy(x.date_from)}${x.date_to && x.date_to !== x.date_from ? ' ~ ' + yy(x.date_to) : ''}` : '—'}</td>
                    <td className="px-2 py-2">
                      {ours.length ? <span className="inline-flex flex-wrap gap-1">{ours.slice(0, 2).map(p => <Badge key={p} tone="pr">{p}</Badge>)}{ours.length > 2 && <Badge>외 {ours.length - 2}</Badge>}</span>
                        : <span className="text-[11px] text-slate-400">자사 품번 없음</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{n(s.parts)}</td>
                    <td className="px-2 py-2 text-center font-mono whitespace-nowrap">
                      <span className="text-emerald-600 font-bold">{n(s.add)}</span> / <span className="text-amber-600 font-bold">{n(s.chg)}</span> / <span className="text-rose-500 font-bold">{n(s.del)}</span>
                    </td>
                    <td className="px-2 py-2 text-center">{(s.newPns || []).length ? <Badge tone="green">{s.newPns.length}</Badge> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 text-center">{(s.eolPns || []).length ? <Badge tone="red">{s.eolPns.length}</Badge> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{x.updated_name || x.created_name || '—'}</td>
                    <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <ReviewBox doc={x} canEdit={canEdit} me={me} compact />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">줄을 누르면 상세가 열립니다 · 같은 CN 번호를 다시 올리면 확인 후 새 판으로 바꾸고, 이전 판은 이력으로 남깁니다.</p>
      </div>
    </div>
  )
}

// 생기 리뷰 체크 — 목록 · 상세 공용
function ReviewBox({ doc, canEdit, me, compact }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  async function toggle(v) {
    if (!canEdit) return
    if (!v && !confirm(`${doc.cn_no} 생기 리뷰 체크를 풀까요?`)) return
    setSaving(true)
    try {
      must(await supabase.from('pm_cn_docs').update({
        reviewed: v, reviewed_name: v ? (me?.name || me?.email || null) : null, reviewed_at: v ? new Date().toISOString() : null,
      }).eq('id', doc.id), '생기 리뷰 저장')
      qc.invalidateQueries({ queryKey: ['cnDocs'], exact: false })
      qc.invalidateQueries({ queryKey: ['cnDoc', doc.id] })
    } catch (e) { toastError(e.message) } finally { setSaving(false) }
  }
  return (
    <label data-cn-review={doc.cn_no} className={`inline-flex items-center gap-1.5 ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
      title={doc.reviewed ? `${doc.reviewed_name || ''} · ${yy(doc.reviewed_at)} 리뷰` : '생산기술팀이 검토하면 체크합니다'}>
      <input type="checkbox" checked={!!doc.reviewed} disabled={!canEdit || saving} onChange={(e) => toggle(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
      {doc.reviewed
        ? <span className="text-[11px] text-emerald-700 font-bold whitespace-nowrap">{doc.reviewed_name || '완료'}{!compact && ` · ${yy(doc.reviewed_at)}`}</span>
        : <span className="text-[11px] text-slate-400 whitespace-nowrap">{compact ? '대기' : '생기 리뷰 전'}</span>}
    </label>
  )
}

// ── 포털 조회 ─────────────────────────────────────────────────────────
async function itemMap(pns) {
  const codes = [...new Set(pns.filter(p => p && !isMfgPn(p)).map(axCode))]
  const out = {}
  for (let i = 0; i < codes.length; i += 200) {
    const rows = must(await supabase.from('items').select('id,std_code,name').in('std_code', codes.slice(i, i + 200)), '품목 조회')
    ;(rows || []).forEach(r => { out[String(r.std_code).replace(/^AX-/i, '')] = r })
  }
  return out
}
async function stockOf(ids) {
  const inv = {}, po = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const a = must(await supabase.from('inventory').select('item_id,qty').in('item_id', part), '재고 조회')
    ;(a || []).forEach(r => { inv[r.item_id] = (inv[r.item_id] || 0) + (Number(r.qty) || 0) })
    const b = must(await supabase.from('purchase_orders').select('item_id,qty_ordered,qty_received,qty_remaining,status')
      .in('item_id', part).eq('order_type', 'purchase').not('status', 'in', '(완료,취소)'), '발주잔 조회')
    ;(b || []).forEach(r => {
      const left = Number(r.qty_remaining ?? ((r.qty_ordered || 0) - (r.qty_received || 0))) || 0
      if (left > 0) po[r.item_id] = (po[r.item_id] || 0) + left
    })
  }
  return { inv, po }
}

// ═════════════════════════════════ 상세 ═════════════════════════════════
function CnDetail({ id, onBack }) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const me = useMe()
  const { data: doc, isLoading, error } = useQuery({
    queryKey: ['cnDoc', id],
    queryFn: async () => must(await supabase.from('pm_cn_docs').select(LIST_COLS + ',parsed').eq('id', id).maybeSingle(), 'CN 조회'),
    staleTime: 60 * 1000,
  })
  const { cn, d } = useMemo(() => {
    if (!doc?.parsed) return {}
    const c = JSON.parse(JSON.stringify(doc.parsed))
    return { cn: c, d: derive(c) }
  }, [doc?.parsed])

  const ours = useMemo(() => new Set(doc?.our_parts || []), [doc?.our_parts])
  const [target, setTarget] = useState(undefined)
  const [tab, setTab] = useState('part')
  useEffect(() => { if (doc && target === undefined) setTarget((doc.our_parts || [])[0] || null) }, [doc, target])
  const [withSub, setWithSub] = useState(true)

  // 포털 조회 — 품목 등록 · 재고 · 발주잔 (CN 전체 BOM 품번 기준, 한 번)
  const allPns = useMemo(() => d ? [...new Set(d.bom.map(b => b.pn))] : [], [d])
  const { data: portal } = useQuery({
    queryKey: ['cnPortal', id, allPns.length],
    enabled: allPns.length > 0,
    queryFn: async () => {
      const im = await itemMap(allPns)
      const delIds = [...new Set(d.del.map(b => im[b.pn]?.id).filter(Boolean))]
      const st = await stockOf(delIds)
      return { im, ...st }
    },
    staleTime: 60 * 1000,
  })
  // 우리 쪽 현황 — 생산관리에서 이 품번의 진행 호기 (SREV 별)
  const { data: prod } = useQuery({
    queryKey: ['cnProd', target],
    enabled: !!target,
    queryFn: async () => must(await supabase.from('production').select('id,pn,hogi,rev,brev,req_date,status,po_number')
      .eq('customer_code', 'AX').eq('pn', target).or('status.is.null,status.neq.완료'), '생산관리 조회'),
    staleTime: 60 * 1000,
  })

  const [memo, setMemo] = useState(null)
  useEffect(() => { if (doc) setMemo(doc.memo || '') }, [doc?.id, doc?.memo])
  async function saveMemo() {
    if (memo == null || memo === (doc.memo || '')) return
    try {
      must(await supabase.from('pm_cn_docs').update({ memo: memo || null }).eq('id', id), '메모 저장')
      toastSuccess('메모를 저장했습니다')
      qc.invalidateQueries({ queryKey: ['cnDoc', id] }); qc.invalidateQueries({ queryKey: ['cnDocs'], exact: false })
    } catch (e) { toastError(e.message) }
  }
  async function downloadRaw() {
    try {
      const r = must(await supabase.from('pm_cn_docs').select('raw_html,file_name').eq('id', id).single(), '원본 조회')
      if (!r.raw_html) { toastError('원본 HTML 이 저장돼 있지 않습니다'); return }
      const url = URL.createObjectURL(new Blob([r.raw_html], { type: 'text/html;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = r.file_name || `${doc.cn_no}.html`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch (e) { toastError(e.message) }
  }
  async function remove() {
    if (!confirm(`${doc.cn_no} 을(를) 삭제할까요?\n\n· 분석 결과 · 원본 · 메모 · 이전 판이 모두 지워집니다\n· 되돌릴 수 없습니다`)) return
    try {
      must(await supabase.from('pm_cn_docs').delete().eq('id', id), 'CN 삭제')
      toastSuccess(`${doc.cn_no} 삭제됨`)
      qc.invalidateQueries({ queryKey: ['cnDocs'], exact: false })
      onBack()
    } catch (e) { toastError(e.message) }
  }

  if (isLoading) return <Empty>불러오는 중…</Empty>
  if (error || !doc || !cn) return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-indigo-600">← 설계변경(CN) 이력</button>
      <Empty>{error ? (missingTable(error) ? 'CN 이력 테이블이 없습니다 — SQL 을 먼저 실행해 주세요' : error.message) : 'CN 을 찾을 수 없습니다 (삭제됐을 수 있음)'}</Empty>
    </div>
  )

  const R = target ? repData(cn, d, target) : null
  const subs = target ? subTree(cn, d, target) : []
  const chips = cn.parts
    .filter(p => ours.has(p.partNo) || (p.bomCnt.ADD + p.bomCnt.CHG + p.bomCnt.DEL) > 0)
    .sort((a, b) => (ours.has(b.partNo) - ours.has(a.partNo)) || a.partNo.localeCompare(b.partNo))
  const tabs = [['part', '품번 상세'], ['bom', 'BOM 변경', d.bom.length], ['nd', '신규 · 단종', d.newParts.length + d.delParts.length], ['all', '변경 품목 전체', cn.parts.length], ['raw', '원문']]
  const ctx = { cn, d, R, subs, target, portal, prod, ours, withSub, doc }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs font-bold text-indigo-600 hover:underline">← 설계변경(CN) 이력</button>

      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-mono font-extrabold text-violet-600">{doc.cn_no}{doc.version > 1 && <span className="ml-1 text-[11px] text-slate-400 font-normal">{doc.version}판</span>}</div>
            <div className="text-lg font-extrabold text-slate-900">{doc.title || '(제목 없음)'}</div>
            <div className="text-[12px] text-slate-400 mt-0.5">
              {doc.file_name} · {yy(doc.created_at)} {doc.created_name || ''}{doc.version > 1 ? ` · 갱신 ${yy(doc.updated_at)} ${doc.updated_name || ''}` : ''}
              {' '}· 변경 품목 {n(cn.parts.length)} · BOM {n(cn.totalBom)}행{d.dateFrom ? ` · 적용 ${yy(d.dateFrom)} ~ ${yy(d.dateTo)}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60"><ReviewBox doc={doc} canEdit={canEdit} me={me} /></div>
            <button data-cn-print onClick={() => printCn()} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">🖨 변경 상세내역</button>
            <button data-cn-excel onClick={() => excelCn(ctx).catch(e => toastError('엑셀 실패: ' + e.message))} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📊 엑셀</button>
            <button onClick={downloadRaw} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">📄 원본 HTML</button>
            {canEdit && <button onClick={remove} className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300">삭제</button>}
          </div>
        </div>
      </Card>

      <Card title="볼 품번" sub="이 CN 에 걸린 자사 품번(고객사 BOM 등록 기준)을 먼저 보여줍니다. 누르면 그 품번에 걸린 변경만 아래에 정리합니다.">
        <div className="flex flex-wrap gap-2">
          <button data-cn-target="" onClick={() => { setTarget(null); setTab('part') }}
            className={`px-3 py-1.5 rounded-lg border text-left ${!target ? 'bg-violet-50 border-violet-200' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
            <b className="text-[13px] text-indigo-600">🗂 CN 전체</b> <span className="text-[11px] text-slate-400">· {cn.parts.length}개 품목</span>
          </button>
          {chips.map(p => (
            <button key={p.partNo} data-cn-target={p.partNo} onClick={() => { setTarget(p.partNo); setTab('part') }}
              className={`px-3 py-1.5 rounded-lg border text-left ${target === p.partNo ? 'bg-violet-50 border-violet-200' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
              <b className={`block font-mono text-[13px] ${target === p.partNo ? 'text-violet-700' : 'text-indigo-600'}`}>{p.partNo}{ours.has(p.partNo) && <span className="ml-1 text-[10px] font-bold text-violet-600">자사</span>}</b>
              <span className="text-[11px] text-slate-400">{koName(p.toDesc) || p.toDesc} · REV {p.fromRev || '-'}→{p.toRev || '-'} · BOM {p.bomCnt.ADD + p.bomCnt.CHG + p.bomCnt.DEL}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([k, l, c]) => (
          <button key={k} data-cn-tab={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 rounded-lg border text-[13px] font-bold ${tab === k ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-slate-200 text-slate-600'}`}>
            {l}{c != null && <span className="ml-1 text-[11px] font-bold opacity-60">{n(c)}</span>}
          </button>
        ))}
      </div>

      {tab === 'part' && (R ? <PartView ctx={ctx} setTarget={setTarget} withSub={withSub} setWithSub={setWithSub} /> : <WholeView ctx={ctx} onPick={(pn) => { setTarget(pn); setTab('part') }} />)}
      {tab === 'bom' && <BomView ctx={ctx} />}
      {tab === 'nd' && <NewDelView ctx={ctx} />}
      {tab === 'all' && <AllPartsView ctx={ctx} onPick={(pn) => { setTarget(pn); setTab('part') }} />}
      {tab === 'raw' && <RawView cn={cn} />}

      <Card title="메모" sub="이력용 메모 — 확인한 내용 · 고객 회신 등을 남깁니다. 인쇄 · 엑셀에 같이 나갑니다.">
        <textarea data-cn-memo value={memo ?? ''} onChange={(e) => setMemo(e.target.value)} onBlur={saveMemo} disabled={!canEdit}
          placeholder="예) 10/14 생기 공유 완료 · REV C 3대는 구도면으로 납품 합의"
          className="w-full min-h-[64px] px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-violet-400" />
      </Card>

      <CnPrint ctx={ctx} memo={memo} />
    </div>
  )
}

// ── CN 전체 요약 (품번을 고르지 않았을 때) ─────────────────────────────
function WholeView({ ctx, onPick }) {
  const { cn, d, ours } = ctx
  const ourRows = cn.parts.filter(p => ours.has(p.partNo))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="변경 품목" value={n(cn.parts.length)} note="CN 에 포함된 전체" />
        <Kpi tone="pr" label="자사 품번" value={n(ourRows.length)} note="고객사 BOM 등록 품번" />
        <Kpi tone="green" label="신규 품번" value={n(d.newParts.length)} note="처음 릴리즈" />
        <Kpi tone="red" label="단종 품번" value={n(d.eol.length)} note="DIS · OBS" />
        <Kpi tone="amber" label="BOM 변경" value={n(cn.totalBom)} note={`추가 ${n(d.add.length)} · 변경 ${n(d.chg.length)} · 삭제 ${n(d.del.length)}`} />
      </div>
      <Card title="자사 품번 변경" sub="품번을 누르면 그 품번에 걸린 변경만 봅니다">
        {!ourRows.length ? <Empty>이 CN 에 걸린 자사 품번이 없습니다.</Empty> : <PartsTable rows={ourRows} onPick={onPick} />}
      </Card>
      <Card title="변경 사유 · 해결 방안 (원문)" sub="Axcelis 가 적은 REASON FOR CHANGE / SOLUTION">
        <pre className="whitespace-pre-wrap text-[12.5px] text-slate-700 bg-slate-50 rounded-lg p-3 font-sans">{cn.reason || '—'}</pre>
        <pre className="mt-2 whitespace-pre-wrap text-[12.5px] text-slate-700 bg-slate-50 rounded-lg p-3 font-sans">{cn.solution || '—'}</pre>
      </Card>
    </div>
  )
}

function PartsTable({ rows, onPick }) {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr>
          <th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">구분</th><th className="px-2 py-2 text-left">REV</th>
          <th className="px-2 py-2 text-center">재공</th><th className="px-2 py-2 text-center">미착</th><th className="px-2 py-2 text-center">재고</th>
          <th className="px-2 py-2 text-center">BOM +/△/-</th><th className="px-2 py-2 text-left">상위 사용처</th>
        </tr></thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.partNo} data-cn-part={p.partNo} onClick={() => onPick(p.partNo)} className="border-t border-slate-100 hover:bg-indigo-50/40 cursor-pointer">
              <PnCell pn={p.partNo} name={p.toDesc || p.fromDesc} />
              <td className="px-2 py-1.5"><Badge tone={CLS2TONE[p.kind?.cls] || 'gray'}>{p.kind?.label}</Badge></td>
              <td className="px-2 py-1.5"><Rev from={p.fromRev} to={p.toRev} /></td>
              <td className="px-2 py-1.5 text-center"><DispBadge v={p.dispWip} /></td>
              <td className="px-2 py-1.5 text-center"><DispBadge v={p.dispOo} /></td>
              <td className="px-2 py-1.5 text-center"><DispBadge v={p.dispInv} /></td>
              <td className="px-2 py-1.5 text-center font-mono">{p.bomCnt.ADD}/{p.bomCnt.CHG}/{p.bomCnt.DEL}</td>
              <td className="px-2 py-1.5 text-slate-500 truncate max-w-[220px]">{(p.sections.whereUsed || []).map(w => w.pn).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 품번 상세 ─────────────────────────────────────────────────────────
const DEXP = { UAI: '있는 그대로 사용', NEW: '신규 — 기존 물량 없음', NONE: '해당 물량 없음', REWORK: '신규 사양으로 재작업', SCRAP: '기존 물량 폐기', RTV: '반품' }
function prodGroups(prod, p) {
  const g = new Map()
  ;(prod || []).forEach(r => { const k = String(r.rev || '').trim() || '(미기재)'; const e = g.get(k) || []; e.push(r); g.set(k, e) })
  return [...g.entries()].sort().map(([rv, list]) => {
    const ds = list.map(x => x.req_date).filter(Boolean).sort()
    const U = (s) => String(s || '').trim().toUpperCase()
    const judge = U(rv) === U(p.fromRev) ? 'old' : U(rv) === U(p.toRev) ? 'new' : 'chk'
    return { rv, list, from: ds[0], to: ds[ds.length - 1], judge }
  })
}

function PartView({ ctx, setTarget, withSub, setWithSub }) {
  const { R, subs, portal, prod, d } = ctx
  const p = R.p
  const reg = (pn) => portal ? (portal.im[pn] ? <Badge tone="green">등록됨</Badge> : <Badge tone="amber">미등록</Badge>) : <span className="text-slate-300">…</span>
  const stock = (pn, k) => { const it = portal?.im[pn]; if (!portal) return '…'; if (!it) return '—'; const v = portal[k][it.id] || 0; return v ? n(v) : '0' }
  const newCnt = R.add.filter(b => b.fromType === 'NEW' || b.fromRev === '-' || b.fromRev === '').length
  const eolCnt = R.del.filter(b => /DIS|OBS/.test(b.toType)).length
  const pg = prodGroups(prod, p)
  return (
    <div className="space-y-4" data-cn-partview={p.partNo}>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi tone="pr" label="도면 리비전" value={`${p.fromRev || '-'}→${p.toRev || '-'}`} note="개정 전 → 개정 후" />
        <Kpi tone="green" label="자재 추가" value={n(R.add.length)} note={`신규 품번 ${newCnt} · 기존 ${R.add.length - newCnt}`} />
        <Kpi tone="amber" label="수량 변경" value={n(R.chg.length)} note="소요량만 바뀜" />
        <Kpi tone="red" label="자재 삭제" value={n(R.del.length)} note={`단종 ${eolCnt} · BOM 제외 ${R.del.length - eolCnt}`} />
        <Kpi label="적용일" value={yy(R.effTo) || '—'} note={R.effFrom && R.effFrom !== R.effTo ? `구자재 삭제 ${yy(R.effFrom)}` : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="기존 물량 처분 (DISP)" sub="개정 시점에 있던 물량을 Axcelis 가 어떻게 하라고 했는지">
          <div className="grid grid-cols-3 gap-2">
            {[['재공 WIP', p.dispWip], ['미착 On Order', p.dispOo], ['재고 Inventory', p.dispInv]].map(([l, v]) => (
              <div key={l} className={`rounded-lg border px-3 py-2 ${{ green: 'bg-emerald-50 border-emerald-200', red: 'bg-rose-50 border-rose-200', amber: 'bg-amber-50 border-amber-200', blue: 'bg-sky-50 border-sky-200', gray: 'bg-slate-50 border-slate-200' }[dispTone(v)]}`}>
                <div className="text-[11px] font-bold text-slate-400">{l}</div>
                <div className="text-lg font-extrabold text-slate-800">{v || '—'}</div>
                <div className="text-[11px] text-slate-500">{DEXP[String(v || '').toUpperCase()] || '지정 없음'}</div>
              </div>
            ))}
          </div>
          {String(p.dispOo || '').toUpperCase() === 'UAI' && (
            <p className="mt-2 text-[11.5px] text-slate-500">미착이 UAI 이므로 기준일 전에 받은 PO 는 REV {p.fromRev || '-'} 그대로 납품할 수 있습니다. 최종 판정은 PO 의 리비전(SREV)으로 합니다.</p>
          )}
        </Card>
        <Card title={<>우리 쪽 현황 <span className="ml-1 text-[10px] font-bold text-violet-600 border border-violet-200 rounded px-1">포털 자동</span></>}
          sub="생산관리에서 이 품번의 진행 중 호기를 리비전(SREV)별로 나눴습니다">
          {!prod ? <Empty>불러오는 중…</Empty> : !pg.length ? <Empty>생산관리에 진행 중인 호기가 없습니다.</Empty> : (
            <table className="w-full text-xs" data-cn-prod>
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-1.5 text-left">PO REV</th><th className="px-2 py-1.5 text-right">호기</th><th className="px-2 py-1.5 text-left">납품일</th><th className="px-2 py-1.5 text-left">판정</th></tr></thead>
              <tbody>{pg.map(g => (
                <tr key={g.rv} className="border-t border-slate-100" title={g.list.map(x => `${x.hogi || ''} ${x.po_number || ''}`).join('\n')}>
                  <td className="px-2 py-1.5 font-mono font-extrabold">{g.rv}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{g.list.length}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{g.from ? `${yy(g.from)}${g.to !== g.from ? ' ~ ' + yy(g.to) : ''}` : '—'}</td>
                  <td className="px-2 py-1.5">{g.judge === 'old' ? <Badge tone="green">REV {g.rv} 그대로 납품</Badge> : g.judge === 'new' ? <Badge tone="blue">REV {g.rv} 신사양</Badge> : <Badge tone="amber">확인 필요</Badge>}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title={`추가되는 자재 (${R.add.length})`} sub="새로 들어가는 품목 — 신규 품번은 품목 등록 여부를 같이 보여줍니다">
        {!R.add.length ? <Empty>해당 없음</Empty> : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">REV</th><th className="px-2 py-2 text-right">수량</th><th className="px-2 py-2 text-left">구분</th><th className="px-2 py-2 text-left">품목 등록</th><th className="px-2 py-2 text-left">적용일</th></tr></thead>
            <tbody>{R.add.map((b, i) => { const isNew = b.fromType === 'NEW' || b.fromRev === '-' || b.fromRev === ''; return (
              <tr key={b.pn + i} className="border-t border-slate-100" data-cn-add={b.pn}>
                <PnCell pn={b.pn} name={b.name} />
                <td className="px-2 py-1.5"><Rev from={b.fromRev} to={b.toRev} /></td>
                <td className="px-2 py-1.5 text-right font-mono">{b.toQty}</td>
                <td className="px-2 py-1.5">{isNew ? <Badge tone="green">신규 품번</Badge> : <Badge>기존 품번</Badge>}</td>
                <td className="px-2 py-1.5">{reg(b.pn)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{yy(usDate(b.begin))}</td>
              </tr>) })}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`빠지는 자재 (${R.del.length})`} sub="단종은 재고 · 발주잔을 같이 봅니다">
          {!R.del.length ? <Empty>해당 없음</Empty> : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">구분</th><th className="px-2 py-2 text-right">재고</th><th className="px-2 py-2 text-right">발주잔</th></tr></thead>
              <tbody>{R.del.map((b, i) => { const eol = /DIS|OBS/.test(b.toType); return (
                <tr key={b.pn + i} className="border-t border-slate-100" data-cn-del={b.pn}>
                  <PnCell pn={b.pn} name={b.name} />
                  <td className="px-2 py-1.5">{eol ? <Badge tone="red">{TYPE_KO[b.toType] || b.toType}</Badge> : <Badge>BOM 제외</Badge>}</td>
                  <td className="px-2 py-1.5 text-right font-mono" data-cn-inv>{stock(b.pn, 'inv')}</td>
                  <td className="px-2 py-1.5 text-right font-mono" data-cn-po>{stock(b.pn, 'po')}</td>
                </tr>) })}</tbody>
            </table></div>
          )}
        </Card>
        <Card title={`수량이 바뀌는 자재 (${R.chg.length})`} sub="품번은 그대로 · 소요량만 변경">
          {!R.chg.length ? <Empty>해당 없음</Empty> : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-right">전</th><th className="px-2 py-2 text-right">후</th><th className="px-2 py-2 text-right">증감</th></tr></thead>
              <tbody>{R.chg.map((b, i) => { const dq = (Number(b.toQty) || 0) - (Number(b.fromQty) || 0); return (
                <tr key={b.pn + i} className="border-t border-slate-100">
                  <PnCell pn={b.pn} name={b.name} />
                  <td className="px-2 py-1.5 text-right font-mono">{b.fromQty}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">{b.toQty}</td>
                  <td className={`px-2 py-1.5 text-right font-mono font-extrabold ${dq > 0 ? 'text-emerald-600' : dq < 0 ? 'text-rose-500' : 'text-slate-400'}`}>{dq > 0 ? '+' : ''}{dq}</td>
                </tr>) })}</tbody>
            </table></div>
          )}
        </Card>
      </div>

      <Card title={`구 → 신 교체 (${R.repl.length})`} sub="변경 문장과 BOM 추가 · 삭제를 맞춰 뽑았습니다">
        <p className="text-[12px] font-bold text-amber-600 mb-2">⚠ 자동 추출입니다. 아래 「도면 변경 내용」 원문과 대조하세요.</p>
        {!R.repl.length ? <Empty>문장에서 뽑힌 교체 관계가 없습니다.</Empty> : (
          <table className="w-full text-xs"><tbody>{R.repl.map(x => {
            const nm = (pn) => (d.bom.find(b => b.pn === pn) || {}).name || ''
            return <tr key={x.from + x.to} className="bg-amber-50/60 border-t border-amber-100">
              <td className="px-2 py-1.5"><span className="font-mono font-bold text-indigo-600">{x.from}</span> <span className="text-slate-400">{nm(x.from)}</span></td>
              <td className="px-2 py-1.5 text-center">→</td>
              <td className="px-2 py-1.5"><span className="font-mono font-bold text-indigo-600">{x.to}</span> <span className="text-slate-400">{nm(x.to)}</span></td>
            </tr>
          })}</tbody></table>
        )}
      </Card>

      {subs.length > 0 && (
        <Card title={`같이 확인할 하위품목 (${subs.length})`} sub="이 품번 BOM 에 걸린 품목 중 이번 CN 에서 자체 변경건이 따로 있는 것입니다 — 신규 하네스는 자기 BOM(전선 · 단자)까지 봐야 제작이 됩니다"
          right={<label className="flex items-center gap-1.5 text-[11.5px] text-slate-500"><input type="checkbox" checked={withSub} onChange={(e) => setWithSub(e.target.checked)} />인쇄 · 엑셀에 포함</label>}>
          <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2">단계</th><th className="px-2 py-2">상위에서</th><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">REV</th><th className="px-2 py-2 text-center">재공/미착/재고</th><th className="px-2 py-2 text-center">자체 BOM +/△/-</th><th></th></tr></thead>
            <tbody>{subs.map(x => {
              const c = { ADD: 0, CHG: 0, DEL: 0 }; x.own.forEach(z => { c[z.act] = (c[z.act] || 0) + 1 })
              return <tr key={x.pn} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-center">{x.depth}차</td>
                <td className="px-2 py-1.5 text-center"><ActBadge act={x.act} /></td>
                <PnCell pn={x.pn} name={x.name} />
                <td className="px-2 py-1.5"><Rev from={x.p?.fromRev} to={x.p?.toRev} /></td>
                <td className="px-2 py-1.5 text-center font-mono">{[x.p?.dispWip, x.p?.dispOo, x.p?.dispInv].map(v => v || '-').join('/')}</td>
                <td className="px-2 py-1.5 text-center font-mono">{x.own.length ? `${c.ADD}/${c.CHG}/${c.DEL}` : '—'}</td>
                <td className="px-2 py-1.5 text-center"><button onClick={() => setTarget(x.pn)} className="px-2 py-0.5 text-[11px] rounded border border-slate-200 hover:bg-slate-50">보기</button></td>
              </tr>
            })}</tbody>
          </table></div>
        </Card>
      )}

      <Card title="도면 변경 내용" sub="CHANGE COMMENTS 를 줄마다 한국어로 옮기고 원문을 옆에 둡니다">
        <p className="text-[12px] font-bold text-amber-600 mb-2">⚠ 규칙 기반 번역입니다. 애매하면 오른쪽 원문을 보세요.</p>
        <CommentTable text={p.comments} />
        {(p.rework || p.planner) && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
            {p.rework && <div><div className="font-bold text-slate-600 mb-1">재작업 지시 (REWORK)</div><pre className="whitespace-pre-wrap bg-slate-50 rounded p-2 font-sans">{p.rework}</pre></div>}
            {p.planner && <div><div className="font-bold text-slate-600 mb-1">플래너 코멘트</div><pre className="whitespace-pre-wrap bg-slate-50 rounded p-2 font-sans">{p.planner}</pre></div>}
          </div>
        )}
      </Card>

      <Card title="문서 변경 · 영향 상위" sub="도면 · 참조 규격 · 이 품번이 들어가는 상위 모듈">
        <div className="space-y-1 text-[12.5px]">
          {[['describedBy', '도면'], ['refDoc', '참조 문서']].flatMap(([k, l]) => (p.sections[k] || []).map((r, i) => (
            <div key={k + i}><ActBadge act={r.cells[0]} /> <span className="text-[11px] text-slate-400">{l}</span> <span className="font-mono font-bold text-indigo-600">{r.cells[1]}</span> {r.cells[2]}{koName(r.cells[2]) ? <span className="text-slate-400"> · {koName(r.cells[2])}</span> : ''}{r.cells[3] ? <span className="text-slate-400"> · {r.cells[3]}</span> : ''}</div>
          )))}
          {(p.sections.whereUsed || []).length > 0 && (
            <div className="pt-1">상위: {(p.sections.whereUsed || []).map(w => <span key={w.pn} className="mr-2"><span className="font-mono font-bold text-indigo-600">{w.pn}</span> <span className="text-slate-500">{w.name}</span></span>)}</div>
          )}
          {!(p.sections.describedBy || []).length && !(p.sections.refDoc || []).length && !(p.sections.whereUsed || []).length && <Empty>해당 없음</Empty>}
        </div>
      </Card>
    </div>
  )
}

function CommentTable({ text }) {
  const lines = String(text || '').split('\n').filter(x => x.trim())
  if (!lines.length) return <Empty>변경 문장이 없습니다.</Empty>
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden"><table className="w-full text-[12.5px]"><tbody>
      {lines.map((line, i) => { const ko = toKo(line); const hd = /^▣/.test(ko); return (
        <tr key={i} className={`border-t border-slate-100 first:border-t-0 ${hd ? 'bg-slate-100 font-extrabold text-slate-800' : ''}`}>
          <td className="px-3 py-1.5 align-top w-[52%] text-slate-800" colSpan={hd ? 2 : 1}>{ko}</td>
          {!hd && <td className="px-3 py-1.5 align-top text-[11.5px] text-slate-400">{line.replace(/^[-•]\s*/, '')}</td>}
        </tr>) })}
    </tbody></table></div>
  )
}

// ── BOM 변경 (CN 전체) ─────────────────────────────────────────────────
function BomView({ ctx }) {
  const { d, target } = ctx
  const [act, setAct] = useState('all')
  const [assy, setAssy] = useState(target || '')
  const [q, setQ] = useState('')
  const assys = [...new Set(d.bom.map(b => b.assy))].sort()
  const kw = q.trim().toLowerCase()
  const rows = d.bom.filter(b => (act === 'all' || b.act === act) && (!assy || b.assy === assy) &&
    (!kw || `${b.pn} ${b.name}`.toLowerCase().includes(kw)))
  const pill = (k) => `px-3 py-1.5 rounded-full border text-xs font-bold ${act === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600'}`
  return (
    <Card title="BOM 변경" sub="CN 의 BOM SUMMARY 전체입니다. 상위품번 · 구분으로 걸러 봅니다">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[['all', `전체 ${d.bom.length}`], ['ADD', `추가 ${d.add.length}`], ['CHG', `변경 ${d.chg.length}`], ['DEL', `삭제 ${d.del.length}`]].map(([k, l]) => (
          <button key={k} onClick={() => setAct(k)} className={pill(k)}>{l}</button>))}
        <select value={assy} onChange={(e) => setAssy(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
          <option value="">상위품번 전체</option>{assys.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 품명 검색" className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56" />
        <span className="ml-auto text-xs text-slate-400">{n(rows.length)}행</span>
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[640px] overflow-y-auto"><table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr><th className="px-2 py-2 text-left">상위품번</th><th className="px-2 py-2">구분</th><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">REV</th><th className="px-2 py-2 text-right">수량 전→후</th><th className="px-2 py-2 text-left">유형</th><th className="px-2 py-2 text-left">적용일</th></tr></thead>
        <tbody>{rows.map((b, i) => (
          <tr key={i} className="border-t border-slate-100">
            <td className="px-2 py-1.5 font-mono text-slate-500">{b.assy}</td>
            <td className="px-2 py-1.5 text-center"><ActBadge act={b.act} /></td>
            <PnCell pn={b.pn} name={b.name} />
            <td className="px-2 py-1.5"><Rev from={b.fromRev} to={b.toRev} /></td>
            <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{b.fromQty || '-'} → <b>{b.toQty || '-'}</b></td>
            <td className="px-2 py-1.5 text-slate-500">{[b.fromType, b.toType].filter(Boolean).map(t => TYPE_KO[t] || t).join(' → ') || '—'}</td>
            <td className="px-2 py-1.5 whitespace-nowrap">{yy(usDate(b.begin))}</td>
          </tr>))}
        </tbody>
      </table></div>
    </Card>
  )
}

// ── 신규 · 단종 ───────────────────────────────────────────────────────
function NewDelView({ ctx }) {
  const { d, portal } = ctx
  const reg = (pn) => portal ? (portal.im[pn] ? <Badge tone="green">등록됨</Badge> : <Badge tone="amber">미등록</Badge>) : '…'
  const stock = (pn, k) => { const it = portal?.im[pn]; if (!portal) return '…'; if (!it) return '—'; return n(portal[k][it.id] || 0) }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title={`신규 품번 (${d.newParts.length})`} sub="이번 CN 에서 처음 릴리즈된 품번 — 품목 등록 여부">
        {!d.newParts.length ? <Empty>없음</Empty> : (
          <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">REV</th><th className="px-2 py-2 text-left">들어가는 곳</th><th className="px-2 py-2 text-left">등록</th></tr></thead>
            <tbody>{d.newParts.map(x => (
              <tr key={x.pn} className="border-t border-slate-100" data-cn-new={x.pn}>
                <PnCell pn={x.pn} name={x.name} />
                <td className="px-2 py-1.5 font-mono">{x.rev || '-'}</td>
                <td className="px-2 py-1.5 font-mono text-slate-500">{x.assy.join(', ')}</td>
                <td className="px-2 py-1.5">{reg(x.pn)}</td>
              </tr>))}</tbody></table>
        )}
      </Card>
      <Card title={`빠지는 품번 (${d.delParts.length})`} sub="단종(DIS · OBS)과 단순 BOM 제외 — 재고 · 발주잔">
        {!d.delParts.length ? <Empty>없음</Empty> : (
          <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2 text-left">품번 / 품명</th><th className="px-2 py-2 text-left">구분</th><th className="px-2 py-2 text-right">재고</th><th className="px-2 py-2 text-right">발주잔</th></tr></thead>
            <tbody>{d.delParts.map(x => { const eol = /DIS|OBS/.test(x.toType); return (
              <tr key={x.pn} className="border-t border-slate-100">
                <PnCell pn={x.pn} name={x.name} />
                <td className="px-2 py-1.5">{eol ? <Badge tone="red">{TYPE_KO[x.toType] || x.toType}</Badge> : <Badge>BOM 제외</Badge>}</td>
                <td className="px-2 py-1.5 text-right font-mono">{stock(x.pn, 'inv')}</td>
                <td className="px-2 py-1.5 text-right font-mono">{stock(x.pn, 'po')}</td>
              </tr>) })}</tbody></table>
        )}
      </Card>
    </div>
  )
}

function AllPartsView({ ctx, onPick }) {
  const { cn, ours } = ctx
  const [f, setF] = useState('all')
  const rows = cn.parts.filter(p => f === 'all' ? true : f === 'ours' ? ours.has(p.partNo) : f === 'rev' ? p.revChanged : (p.bomCnt.ADD + p.bomCnt.CHG + p.bomCnt.DEL) > 0)
  const pill = (k) => `px-3 py-1.5 rounded-full border text-xs font-bold ${f === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600'}`
  return (
    <Card title="변경 품목 전체" sub="CN 에 포함된 품목입니다. 줄을 누르면 그 품번 상세로 갑니다">
      <div className="flex gap-2 mb-3">{[['all', '전체'], ['ours', '자사 품번'], ['rev', '리비전 변경'], ['bom', 'BOM 변경 있음']].map(([k, l]) => <button key={k} onClick={() => setF(k)} className={pill(k)}>{l}</button>)}</div>
      {!rows.length ? <Empty>해당 품목이 없습니다.</Empty> : <PartsTable rows={rows} onPick={onPick} />}
    </Card>
  )
}

function RawView({ cn }) {
  return (
    <div className="space-y-4">
      <Card title="변경 사유 (REASON FOR CHANGE)"><pre className="whitespace-pre-wrap text-[12.5px] text-slate-700 font-sans">{cn.reason || '—'}</pre></Card>
      <Card title="해결 방안 (SOLUTION)"><pre className="whitespace-pre-wrap text-[12.5px] text-slate-700 font-sans">{cn.solution || '—'}</pre></Card>
      <Card title="품목별 변경 문장 (CHANGE COMMENTS 원문)">
        <div className="space-y-3">{cn.parts.filter(p => p.comments).map(p => (
          <div key={p.partNo}><div className="font-mono font-bold text-indigo-600 text-[12.5px]">{p.partNo} <span className="font-sans font-normal text-slate-400">{p.toDesc}</span></div>
            <pre className="whitespace-pre-wrap text-[12px] text-slate-600 bg-slate-50 rounded-lg p-2 font-sans">{p.comments}</pre></div>))}
          {!cn.parts.some(p => p.comments) && <Empty>없음</Empty>}
        </div>
      </Card>
    </div>
  )
}

// ── 인쇄 · 엑셀 ───────────────────────────────────────────────────────
function printCn() {
  document.body.classList.add('printing-cn')
  const done = () => { document.body.classList.remove('printing-cn'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 60)
}

function CnPrint({ ctx, memo }) {
  const { cn, d, R, subs, target, doc, withSub } = ctx
  const T = ({ head, rows }) => (
    <table className="cnp-t"><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={head.length}>해당 없음</td></tr>}</tbody></table>
  )
  const bomRows = (list, kind) => list.map(b => kind === 'chg'
    ? [b.pn, b.name, b.fromQty, b.toQty, yy(usDate(b.begin))]
    : [b.pn, b.name, `${b.fromRev || '-'}→${b.toRev || '-'}`, kind === 'add' ? b.toQty : b.fromQty,
       kind === 'add' ? ((b.fromType === 'NEW' || b.fromRev === '-') ? '신규' : '기존') : (/DIS|OBS/.test(b.toType) ? (TYPE_KO[b.toType] || b.toType) : 'BOM 제외'), yy(usDate(b.begin))])
  // body 바로 밑에 붙여 인쇄 때 나머지 화면을 통째로 숨긴다 (보이지만 않게 하면 빈 쪽이 따라 나온다)
  return createPortal(
    <div className="cn-print-area">
      <style>{`
        .cn-print-area{display:none}
        @media print{
          body.printing-cn > :not(.cn-print-area){display:none !important}
          body.printing-cn .cn-print-area{display:block;width:100%;padding:10mm;background:#fff;color:#000;font-size:10px}
          @page{size:A4;margin:0}
          .cnp-h{font-size:17px;font-weight:800}.cnp-m{font-size:10px;color:#444;margin:2px 0 6px}
          .cnp-s{font-size:12px;font-weight:800;border-bottom:1.5px solid #000;margin:10px 0 4px;padding-bottom:2px}
          .cnp-t{width:100%;border-collapse:collapse;margin-bottom:4px}
          .cnp-t th{background:#eee;border:1px solid #999;padding:3px 4px;text-align:left}
          .cnp-t td{border:1px solid #bbb;padding:2px 4px;vertical-align:top;word-break:break-word}
          .cnp-t tr{page-break-inside:avoid}
          .cnp-box{display:flex;border:1px solid #999;margin:6px 0}.cnp-box div{flex:1;padding:4px 7px;border-right:1px solid #ccc}.cnp-box div:last-child{border-right:0}
          .cnp-box b{display:block;font-size:8.5px;color:#666}
        }
      `}</style>
      <div className="cnp-h">설계변경(CN) 변경 상세내역 — {doc.cn_no}</div>
      <div className="cnp-m">{doc.title} · 올린 날 {yy(doc.created_at)} {doc.created_name || ''} · 출력 {yy(new Date().toISOString())}</div>
      <div className="cnp-box">
        <div><b>대상</b>{target ? `${target} ${R?.p.toDesc || ''}` : 'CN 전체'}</div>
        <div><b>리비전</b>{R ? `${R.p.fromRev || '-'} → ${R.p.toRev || '-'}` : '—'}</div>
        <div><b>적용</b>{R ? `${yy(R.effFrom) || '-'} ~ ${yy(R.effTo) || '-'}` : `${yy(d.dateFrom) || '-'} ~ ${yy(d.dateTo) || '-'}`}</div>
        <div><b>생기 리뷰</b>{doc.reviewed ? `☑ ${doc.reviewed_name || ''} ${yy(doc.reviewed_at)}` : '☐ 리뷰 전'}</div>
      </div>
      {R ? (<>
        <div className="cnp-s">처분 지침</div>
        <div>재공 {R.p.dispWip || '-'} · 미착 {R.p.dispOo || '-'} · 재고 {R.p.dispInv || '-'}</div>
        <div className="cnp-s">추가되는 자재 ({R.add.length})</div><T head={['품번', '품명', 'REV', '수량', '구분', '적용일']} rows={bomRows(R.add, 'add')} />
        <div className="cnp-s">수량이 바뀌는 자재 ({R.chg.length})</div><T head={['품번', '품명', '전', '후', '적용일']} rows={bomRows(R.chg, 'chg')} />
        <div className="cnp-s">빠지는 자재 ({R.del.length})</div><T head={['품번', '품명', 'REV', '수량', '구분', '적용일']} rows={bomRows(R.del, 'del')} />
        {R.repl.length > 0 && (<><div className="cnp-s">구 → 신 교체 (자동 추출)</div><T head={['기존', '신규']} rows={R.repl.map(x => [x.from, x.to])} /></>)}
        {withSub && subs.filter(x => x.own.length).map(x => (
          <div key={x.pn}><div className="cnp-s">하위 {x.pn} {x.name} — 자체 BOM ({x.own.length})</div>
            <T head={['구분', '품번', '품명', '수량 전→후']} rows={x.own.map(b => [b.act, b.pn, b.name, `${b.fromQty || '-'}→${b.toQty || '-'}`])} /></div>
        ))}
        <div className="cnp-s">도면 변경 내용</div>
        <T head={['한글', '원문']} rows={String(R.p.comments || '').split('\n').filter(x => x.trim()).map(l => [toKo(l), l.replace(/^[-•]\s*/, '')])} />
      </>) : (<>
        <div className="cnp-s">변경 품목 ({cn.parts.length})</div>
        <T head={['품번', '품명', 'REV', '재공/미착/재고', 'BOM +/△/-']} rows={cn.parts.map(p => [p.partNo, p.toDesc, `${p.fromRev || '-'}→${p.toRev || '-'}`, [p.dispWip, p.dispOo, p.dispInv].map(v => v || '-').join('/'), `${p.bomCnt.ADD}/${p.bomCnt.CHG}/${p.bomCnt.DEL}`])} />
        <div className="cnp-s">변경 사유</div><div style={{ whiteSpace: 'pre-wrap' }}>{cn.reason || '—'}</div>
      </>)}
      {memo && (<><div className="cnp-s">메모</div><div style={{ whiteSpace: 'pre-wrap' }}>{memo}</div></>)}
    </div>, document.body)
}

async function excelCn({ cn, d, R, subs, target, doc, withSub, portal }) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  add('개요', [['CN', doc.cn_no], ['제목', doc.title || ''], ['올린 날', yy(doc.created_at)], ['올린 사람', doc.created_name || ''],
    ['생기 리뷰', doc.reviewed ? `${doc.reviewed_name || ''} ${yy(doc.reviewed_at)}` : '리뷰 전'], ['적용', `${d.dateFrom || ''} ~ ${d.dateTo || ''}`],
    ['메모', doc.memo || ''], [], ['변경 사유', cn.reason || ''], ['해결 방안', cn.solution || '']])
  add('변경품목', [['품번', '품명(전)', '품명(후)', 'REV 전', 'REV 후', '재공', '미착', '재고', 'BOM 추가', 'BOM 변경', 'BOM 삭제'],
    ...cn.parts.map(p => [p.partNo, p.fromDesc, p.toDesc, p.fromRev, p.toRev, p.dispWip, p.dispOo, p.dispInv, p.bomCnt.ADD, p.bomCnt.CHG, p.bomCnt.DEL])])
  add('BOM변경', [['상위품번', '구분', '품번', '품명', 'REV 전', 'REV 후', '유형 전', '유형 후', '수량 전', '수량 후', '적용일'],
    ...d.bom.map(b => [b.assy, b.act, b.pn, b.name, b.fromRev, b.toRev, b.fromType, b.toType, b.fromQty, b.toQty, usDate(b.begin)])])
  add('신규품번', [['품번', '품명', 'REV', '들어가는 곳', '품목 등록'], ...d.newParts.map(x => [x.pn, x.name, x.rev, x.assy.join(', '), portal ? (portal.im[x.pn] ? '등록됨' : '미등록') : ''])])
  add('빠지는품번', [['품번', '품명', '구분', '재고', '발주잔'], ...d.delParts.map(x => { const it = portal?.im[x.pn]; return [x.pn, x.name, /DIS|OBS/.test(x.toType) ? (TYPE_KO[x.toType] || x.toType) : 'BOM 제외', it ? (portal.inv[it.id] || 0) : '', it ? (portal.po[it.id] || 0) : ''] })])
  if (R) {
    const rows = [['구분', '품번', '품명', 'REV', '수량 전', '수량 후', '적용일']]
    R.bom.forEach(b => rows.push([b.act, b.pn, b.name, `${b.fromRev || '-'}→${b.toRev || '-'}`, b.fromQty, b.toQty, usDate(b.begin)]))
    if (withSub) subs.filter(x => x.own.length).forEach(x => { rows.push([], [`하위 ${x.pn} ${x.name}`]); x.own.forEach(b => rows.push([b.act, b.pn, b.name, `${b.fromRev || '-'}→${b.toRev || '-'}`, b.fromQty, b.toQty, usDate(b.begin)])) })
    add(`상세_${target}`.slice(0, 31), rows)
    add('도면변경', [['한글', '원문'], ...String(R.p.comments || '').split('\n').filter(x => x.trim()).map(l => [toKo(l), l])])
  }
  XLSX.writeFile(wb, `CN_${doc.cn_no}${target ? '_' + target : ''}.xlsx`)
}
