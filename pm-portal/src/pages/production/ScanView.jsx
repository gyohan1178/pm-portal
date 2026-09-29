import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { toastError } from '../../lib/toast'
import QrScanner from '../../components/QrScanner'
import { isMainRow } from './mainPns'
import { bdMinus } from '../../lib/bizdays'
import { QR_STEPS, doneFromRow, nextStep, parseQr, scanRevCheck, revInfo, md } from '../../lib/prodFlow'

// 📱 공정 스캔 — 폰 전용 화면 (QR 공정 데모)
//
//   폰에서 할 일은 하나 — 작업지시서 QR 을 찍고, 뜬 공정 버튼을 한 번 누른다.
//   /scan (포털 틀 없이 꽉 찬 화면) 과 「QR 공정 데모」의 폰 화면 · 스캔 탭이 이 화면을 같이 쓴다.
//   글꼴은 포털 전체와 같은 Pretendard (index.html 에서 불러옴).
//
//   ⚠ 데모 — 생산관리 체크칸에는 쓰지 않는다. 기록은 이 폰(브라우저)에만 남는다.

const LS = 'pm_qr_demo_v1'
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } }
const save = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); return true } catch { return false } }
export const hm = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) }
const FONT = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
const calcElec = (r, qc) => r.elec_done || bdMinus(r.req_date, Math.max(1, Math.ceil(Number(qc) || 2)))

// 진행 중 AXCELIS PD 호기 (생산관리 · 읽기만)
async function fetchDemoRows() {
  const prod = await fetchAll(() => supabase.from('production')
    .select('id,pn,hogi,name,status,req_date,elec_done,arrival_date,machine_recv,harness_recv,part_issue,elec_recv,quality_recv,missing_parts,rev,brev,ccn,po_id,customer_code')
    .eq('customer_code', 'AX').neq('status', '완료').order('id'))
  const main = prod.filter((r) => isMainRow(r.pn, r.customer_code))
  const ids = [...new Set(main.map((r) => r.po_id).filter(Boolean))]
  const po = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = must(await supabase.from('purchase_orders').select('id,po_number').in('id', ids.slice(i, i + 200)), 'PO 조회') || []
    part.forEach((p) => { po[p.id] = p.po_number })
  }
  const items = must(await supabase.from('items').select('std_code,qc_md_days').like('std_code', 'AX-11%'), '품목 조회') || []
  const qc = Object.fromEntries(items.map((i) => [String(i.std_code).replace('AX-', ''), i.qc_md_days]))
  return main.map((r) => ({ ...r, _po: po[r.po_id] || '', _elec: calcElec(r, qc[r.pn]) }))
    .sort((a, b) => String(a.req_date || '9').localeCompare(String(b.req_date || '9')) || String(a.pn).localeCompare(String(b.pn)))
}
export const useDemoRows = () => useQuery({ queryKey: ['qrDemoRows'], queryFn: fetchDemoRows, staleTime: 60 * 1000 })

// 이 기기의 데모 기록 — { worker, events: [{ id, pid, step, at, by }] }
export function useDemoStore() {
  const [st, setSt] = useState(() => { const v = load(); return { worker: v.worker || '', events: Array.isArray(v.events) ? v.events : [] } })
  const put = useCallback((next) => { setSt(next); if (!save(next)) toastError('이 브라우저에 저장하지 못했습니다 (사생활 보호 모드?) — 새로고침하면 사라집니다') }, [])
  // 호기별 끝난 공정 = 생산관리 체크칸 + 데모 기록
  const doneOf = useCallback((r) => {
    const s = doneFromRow(r)
    st.events.filter((e) => String(e.pid) === String(r.id)).forEach((e) => s.add(e.step))
    return s
  }, [st.events])
  return { st, put, doneOf }
}

const Icon = {
  scan: (c = 'currentColor') => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" />
    </svg>),
  check: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>),
  play: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={c} aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>),
  alert: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>),
}

// 스캔 화면. store · rows 를 넘기면 그것을 쓰고(QR 공정 데모 안), 안 넘기면 직접 불러온다(/scan).
export default function ScanView({ store: outer, rows: outerRows, full }) {
  const own = useDemoStore()
  const { st, put, doneOf } = outer || own
  const q = useDemoRows()
  const rows = outerRows || q.data || []
  const [name, setName] = useState('')
  const [editName, setEditName] = useState(false)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(false)
  const [cur, setCur] = useState(null)      // { id, qrRev }
  const [last, setLast] = useState(null)    // 방금 기록 { ev, at }
  const [, tick] = useState(0)
  useEffect(() => { if (!last) return undefined; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [last])

  const onScan = useCallback((p) => {
    setOpen(false)
    if (!rows.some((r) => String(r.id) === String(p.id))) { toastError('진행 중인 PD 호기가 아닙니다 (완료됐거나 다른 QR)'); return }
    setCur({ id: p.id, qrRev: p.rev }); setLast(null); setPick(false)
  }, [rows])

  const r = cur ? rows.find((x) => String(x.id) === String(cur.id)) : null
  const done = r ? doneOf(r) : null
  const nx = done ? nextStep(done) : null
  const checks = r ? scanRevCheck(r, cur.qrRev) : []
  const doneN = done ? QR_STEPS.filter((s) => done.has(s.k)).length : 0

  function record() {
    if (!r || !nx || !st.worker) return
    const ev = { id: `${Date.now()}`, pid: String(r.id), step: nx.k, at: Date.now(), by: st.worker }
    put({ ...st, events: [...st.events, ev] })
    setLast({ ev, at: Date.now() })
  }
  function undo() {
    if (!last) return
    put({ ...st, events: st.events.filter((e) => e.id !== last.ev.id) })
    setLast(null)
  }
  const undoLeft = last ? Math.max(0, 8 - Math.floor((Date.now() - last.at) / 1000)) : 0
  // 찍은 직후 2초는 다음 버튼을 막는다 — 두 번 눌러 시작 · 완료가 같이 찍히지 않게
  const cool = !!last && Date.now() - last.at < 2000
  useEffect(() => { if (!cool) return undefined; const t = setTimeout(() => tick((x) => x + 1), 2050); return () => clearTimeout(t) }, [cool, last])
  const lastStep = last ? QR_STEPS.find((s) => s.k === last.ev.step) : null
  const mine = st.events.filter((e) => e.by === st.worker).slice(-5).reverse()
  const rowOf = (id) => rows.find((x) => String(x.id) === String(id))

  const needName = !st.worker || editName
  const saveName = () => { const v = name.trim(); if (!v) return; put({ ...st, worker: v }); setEditName(false) }

  return (
    <div data-scan-view style={{ fontFamily: FONT, letterSpacing: '-0.01em' }}
      className={`${full ? 'min-h-[100dvh]' : 'rounded-3xl'} bg-[#F3F4F6] text-slate-900`}>
      <div className="max-w-md mx-auto px-4 pb-8">
        {/* 머리 */}
        <div className="flex items-center gap-2 pt-4 pb-3">
          <span className="text-[19px] font-bold">공정 스캔</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">데모</span>
          {st.worker && !editName && (
            <button onClick={() => { setName(st.worker); setEditName(true) }}
              className="ml-auto flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full bg-white shadow-sm text-[14px] font-semibold text-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />{st.worker}<span className="text-slate-400 text-[12px]">바꾸기</span>
            </button>
          )}
        </div>

        {needName ? (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <div>
              <div className="text-[17px] font-bold">이 폰을 쓰는 사람</div>
              <div className="text-[13px] text-slate-500 mt-1">처음 한 번만 — 찍은 기록에 이 이름이 남습니다</div>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName() }}
              placeholder="이름" aria-label="이 폰 사용자" autoComplete="name"
              className="w-full h-12 px-4 rounded-xl bg-slate-100 text-[16px] outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex gap-2">
              {editName && <button onClick={() => setEditName(false)} className="h-12 px-5 rounded-xl bg-slate-100 text-[15px] font-semibold text-slate-600">취소</button>}
              <button onClick={saveName} disabled={!name.trim()}
                className="flex-1 h-12 rounded-xl bg-indigo-600 text-white text-[16px] font-semibold disabled:opacity-40">시작하기</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!r && (
              <div className="rounded-2xl bg-white shadow-sm p-6 flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">{Icon.scan('#4F46E5')}</div>
                <div className="text-[17px] font-bold">작업지시서 QR 을 찍으세요</div>
                <div className="text-[13px] text-slate-500 -mt-1">오른쪽 위 QR · 찍으면 그 호기의 다음 공정이 뜹니다</div>
              </div>
            )}

            {r && (
              <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4" data-scan-card>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[26px] font-bold tracking-tight tabular-nums">{r.pn}</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[15px] font-bold">{r.hogi}</span>
                  </div>
                  <div className="text-[14px] text-slate-500 truncate">{r.name}</div>
                  <div className="text-[12px] text-slate-400 mt-0.5 tabular-nums">납기 {md(r.req_date)} · 전장 완료예정 {md(r._elec)} · Rev {revInfo(r).b || '-'}</div>
                </div>

                {checks.map((c, i) => (
                  <div key={i} className="flex gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700 leading-snug">
                    <span className="shrink-0 mt-px">{Icon.alert('#E11D48')}</span><span>{c.t}</span>
                  </div>
                ))}

                <div>
                  <div className="flex gap-1" aria-hidden="true">
                    {QR_STEPS.map((s) => (
                      <span key={s.k} className={`h-1.5 flex-1 rounded-full ${done.has(s.k) ? 'bg-emerald-500' : nx?.k === s.k ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 text-[13px]">
                    <span className="text-slate-500">{doneN} / {QR_STEPS.length} 공정</span>
                    <span className="font-semibold text-slate-700">{nx ? `다음 · ${nx.l}` : '모든 공정 끝'}</span>
                  </div>
                </div>

                {last && lastStep && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                    {Icon.check('#059669')}
                    <span className="text-[14px] font-semibold text-emerald-800">{lastStep.l} 기록 · {hm(last.ev.at)}</span>
                    {undoLeft > 0 && <button onClick={undo} className="ml-auto text-[13px] font-semibold text-slate-500 underline underline-offset-2">되돌리기 {undoLeft}</button>}
                  </div>
                )}

                {nx && (
                  <button onClick={record} disabled={cool}
                    className={`w-full h-16 rounded-2xl text-white text-[19px] font-bold flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-40 ${nx.k === 'elec_start' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                    {nx.k === 'elec_start' ? Icon.play('#fff') : Icon.check('#fff')}
                    {nx.k === 'elec_start' ? '전장 시작' : nx.l.endsWith('완료') ? nx.l : `${nx.l} 완료`}
                  </button>
                )}
              </div>
            )}

            <button onClick={() => setOpen(true)}
              className={`w-full h-14 rounded-2xl text-[17px] font-semibold flex items-center justify-center gap-2 ${r ? 'bg-white text-slate-800 shadow-sm' : 'bg-indigo-600 text-white'}`}>
              {Icon.scan(r ? '#334155' : '#fff')}{r ? '다음 호기 찍기' : 'QR 찍기'}
            </button>

            {!pick ? (
              <button onClick={() => setPick(true)} className="w-full text-center text-[13px] text-slate-500 underline underline-offset-2">카메라 없이 호기 고르기</button>
            ) : (
              <select value={cur?.id || ''} aria-label="호기 고르기"
                onChange={(e) => { const x = rowOf(e.target.value); if (x) { setCur({ id: String(x.id), qrRev: revInfo(x).b }); setLast(null) } }}
                className="w-full h-12 px-3 rounded-xl bg-white shadow-sm text-[15px]">
                <option value="">호기 고르기</option>
                {rows.map((x) => <option key={x.id} value={x.id}>{x.pn} {x.hogi}</option>)}
              </select>
            )}

            {mine.length > 0 && (
              <div className="rounded-2xl bg-white shadow-sm px-4 py-3">
                <div className="text-[13px] font-semibold text-slate-500 mb-1">내가 찍은 것</div>
                {mine.map((e) => {
                  const x = rowOf(e.pid)
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-1.5 text-[14px] border-t border-slate-100 first:border-0">
                      <span className="w-11 text-slate-400 tabular-nums">{hm(e.at)}</span>
                      <span className="font-semibold tabular-nums">{x ? `${x.pn} ${x.hogi}` : e.pid}</span>
                      <span className="ml-auto text-slate-600">{QR_STEPS.find((s) => s.k === e.step)?.l}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="text-center text-[11px] text-slate-400 pt-1">데모 — 생산관리에는 기록되지 않고 이 폰에만 남습니다</p>
          </div>
        )}
      </div>

      {open && (
        <QrScanner onScan={onScan} onClose={() => setOpen(false)} parse={parseQr}
          hint="작업지시서 오른쪽 위 QR 을 비추세요" placeholder="직접 입력 (예: PD|123|E)" />
      )}
    </div>
  )
}

// /scan — 포털 틀 없이 폰 화면 가득
export function ScanPage() {
  return <ScanView full />
}
