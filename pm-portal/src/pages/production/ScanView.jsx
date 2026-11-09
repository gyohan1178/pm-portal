import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toastError } from '../../lib/toast'
import QrScanner from '../../components/QrScanner'
import ScanFlash from '../../components/ScanFlash'
import { parseQr, scanRevCheck, revInfo, md } from '../../lib/prodFlow'
import { qcIndex } from '../../lib/prodAuto'
import { progressOf, scanIndex, applyScan, undoScan, CUST_NAME, ACTIONS, STAGES } from '../../lib/prodSteps'
import { useBoardData } from '../../lib/prodBoard'
import { kst, todayISO } from '../../lib/utils'

// 📱 공정 스캔 — 폰 화면 (v4.165.0 정식 — 예전 「QR 공정 데모」)
//
//   폰에서 할 일은 하나 — 작업지시서 QR 을 찍고, 뜬 버튼을 한 번 누른다 (제조 시작 → 제조 완료 → 검수 완료).
//   /scan (포털 틀 없이 꽉 찬 화면) · 공정 현황판(폰으로 열거나 「📷 스캔」)이 이 화면을 같이 쓴다.
//   · 찍은 기록은 pm_prod_scan 에 남고(누가 · 언제), 완료는 생산관리 체크칸(전장/제작 완료 · 품질)도 켠다 → 공정 현황판에 바로 보임
//   · 불출은 생산관리 체크(구매팀) · 납품대기 다음은 수주대장 납품(영업팀) — 폰으로 찍지 않는다
//   · 포털을 공용 계정으로 쓰니 「이 폰 사용자」 이름을 한 번 정해 두면 기록에 그 이름이 남는다
//   · 전 고객사 — 공정 단계는 lib/prodSteps.js

const WK = 'pm_scan_worker'
const loadWorker = () => { try { return localStorage.getItem(WK) || JSON.parse(localStorage.getItem('pm_qr_demo_v1') || '{}').worker || '' } catch { return '' } }
const saveWorker = (v) => { try { localStorage.setItem(WK, v) } catch { /* 사생활 보호 모드 — 이번만 */ } }
export const hm = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) }
const FONT = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"

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

// 스캔 화면
export default function ScanView({ full, onClose }) {
  const qc = useQueryClient()
  const { data, isLoading } = useBoardData()
  const rows = useMemo(() => data?.rows || [], [data])
  const scans = useMemo(() => scanIndex(data?.scans), [data?.scans])
  const qcLatest = useMemo(() => qcIndex(data?.qc).latest, [data?.qc])
  const [worker, setWorker] = useState(loadWorker)
  const [name, setName] = useState('')
  const [editName, setEditName] = useState(false)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(false)
  const [cur, setCur] = useState(null)      // { id, qrRev }
  const [last, setLast] = useState(null)    // 방금 기록 { scan, patch, step, at }
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { if (!last) return undefined; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [last])

  const [flash, setFlash] = useState(null)
  const onScan = useCallback((p) => {
    setOpen(false)
    const hit = rows.find((r) => String(r.id) === String(p.id))
    if (!hit) { setFlash({ ok: false, title: '진행 중인 호기가 아닙니다', sub: '완료됐거나 다른 QR 입니다' }); return }
    setFlash({ ok: true, title: `${hit.hogi || ''} ${hit.pn || ''}`.trim(), sub: hit.name || '' })
    setCur({ id: p.id, qrRev: p.rev }); setLast(null); setPick(false)
  }, [rows])

  const r = cur ? rows.find((x) => String(x.id) === String(cur.id)) : null
  const pg = r ? progressOf(r, scans, qcLatest) : null
  const nx = pg?.next ? { k: pg.next, ...ACTIONS[pg.next] } : null
  const checks = r ? scanRevCheck(r, cur.qrRev) : []
  const refresh = () => { qc.invalidateQueries({ queryKey: ['processBoard'] }); qc.invalidateQueries({ queryKey: ['production'], exact: false }) }

  async function record() {
    if (!r || !nx || !worker || busy) return
    setBusy(true)
    try {
      const res = await applyScan(r, nx.k, worker, { qcLatest, device: window.innerWidth < 768 ? '폰' : 'PC' })
      setLast({ ...res, step: nx, row: r, at: Date.now() })
      setFlash({ ok: true, title: `${nx.l} 기록`, sub: `${r.hogi || ''} ${r.pn || ''}${res.msg ? ` · ${res.msg}` : ''}`.trim() })
      refresh()
    } catch (e) {
      setFlash({ ok: false, title: '기록하지 못했습니다', sub: e?.message || String(e) })
    } finally { setBusy(false) }
  }
  async function undo() {
    if (!last || busy) return
    setBusy(true)
    try { await undoScan(last.row, last.scan, last.patch); setLast(null); refresh() }
    catch (e) { toastError('되돌리지 못했습니다 — ' + (e?.message || e)) }
    finally { setBusy(false) }
  }
  const undoLeft = last ? Math.max(0, 8 - Math.floor((Date.now() - last.at) / 1000)) : 0
  // 찍은 직후 2초는 다음 버튼을 막는다 — 두 번 눌러 시작 · 완료가 같이 찍히지 않게
  const cool = !!last && Date.now() - last.at < 2000
  useEffect(() => { if (!cool) return undefined; const t = setTimeout(() => tick((x) => x + 1), 2050); return () => clearTimeout(t) }, [cool, last])
  const today = todayISO()
  const mine = (data?.scans || []).filter((e) => e.by_name === worker && kst(e.at).slice(0, 10) === today).slice(-5).reverse()
  const rowOf = (id) => rows.find((x) => String(x.id) === String(id))
  const stepName = (e) => `${e.step === 'make' ? '제조' : e.step === 'qc' ? '검수' : e.step} ${e.kind === 'start' ? '시작' : '완료'}`

  const needName = !worker || editName
  const saveName = () => { const v = name.trim(); if (!v) return; saveWorker(v); setWorker(v); setEditName(false) }
  const isStart = nx?.kind === 'start'

  return (
    <div data-scan-view style={{ fontFamily: FONT, letterSpacing: '-0.01em' }}
      className={`${full ? 'min-h-[100dvh]' : 'rounded-3xl'} bg-[#F3F4F6] text-slate-900`}>
      <div className="max-w-md mx-auto px-4 pb-8">
        <div className="flex items-center gap-2 pt-4 pb-3">
          <span className="text-[19px] font-bold">공정 스캔</span>
          {onClose && <button onClick={onClose} className="text-[13px] text-slate-500 underline underline-offset-2">닫기</button>}
          {worker && !editName && (
            <button onClick={() => { setName(worker); setEditName(true) }}
              className="ml-auto flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full bg-white shadow-sm text-[14px] font-semibold text-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />{worker}<span className="text-slate-400 text-[12px]">바꾸기</span>
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
                {isLoading && <div className="text-[12px] text-slate-400">호기 목록 불러오는 중…</div>}
              </div>
            )}

            {r && pg && (
              <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4" data-scan-card>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[26px] font-bold tracking-tight tabular-nums">{String(r.pn || '').replace(/^AX-/, '')}</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[15px] font-bold">{r.hogi}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[12px] font-bold">{CUST_NAME[r.customer_code] || r.customer_code}</span>
                  </div>
                  <div className="text-[14px] text-slate-500 truncate">{r.name}{r.part ? ` · ${r.part}` : ''}</div>
                  <div className="text-[12px] text-slate-400 mt-0.5 tabular-nums">납기 {md(r._due)}{r._elec ? ` · 전장 완료예정 ${md(r._elec)}` : ''} · Rev {revInfo(r).b || revInfo(r).s || '-'}</div>
                </div>

                {checks.map((c, i) => (
                  <div key={i} className="flex gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700 leading-snug">
                    <span className="shrink-0 mt-px">{Icon.alert('#E11D48')}</span><span>{c.t}</span>
                  </div>
                ))}

                {!pg.mat.done && (
                  <div className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800 leading-snug" data-scan-matwarn>
                    <span className="shrink-0 mt-px">{Icon.alert('#B45309')}</span>
                    <span>불출이 아직 안 끝났습니다 — {pg.mat.parts.filter((x) => !x.done).map((x) => x.l).join(' · ')} 대기 (구매팀)</span>
                  </div>
                )}

                <div>
                  <div className="flex gap-1" aria-hidden="true">
                    {STAGES.map((s) => {
                      const done = s.k === 'mat' ? pg.mat.done : s.k === 'make' ? pg.make.done : s.k === 'qc' ? pg.qc.done : false
                      const doing = s.k === 'make' && pg.make.started
                      return <span key={s.k} className={`h-1.5 flex-1 rounded-full ${done ? 'bg-blue-600' : doing ? 'bg-amber-400' : pg.cur === s.k ? 'bg-slate-800' : 'bg-slate-200'}`} />
                    })}
                  </div>
                  <div className="flex justify-between mt-1 text-[11px] text-slate-400">{STAGES.map((s) => <span key={s.k} className={pg.cur === s.k ? 'font-bold text-slate-700' : ''}>{s.l}</span>)}</div>
                  <div className="flex justify-between mt-1.5 text-[13px]">
                    <span className="text-slate-500">지금 {STAGES.find((s) => s.k === pg.cur)?.team} 차례</span>
                    <span className="font-semibold text-slate-700">{nx ? `다음 · ${nx.l}` : '검수 끝 — 납품대기 (영업팀)'}</span>
                  </div>
                </div>

                {last && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                    {Icon.check('#059669')}
                    <span className="text-[14px] font-semibold text-emerald-800">{last.step.l} 기록 · {hm(last.scan.at)}</span>
                    {undoLeft > 0 && <button onClick={undo} disabled={busy} className="ml-auto text-[13px] font-semibold text-slate-500 underline underline-offset-2">되돌리기 {undoLeft}</button>}
                  </div>
                )}

                {nx && (
                  <button onClick={record} disabled={cool || busy} data-scan-record={nx.k}
                    className={`w-full h-16 rounded-2xl text-white text-[19px] font-bold flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-40 ${isStart ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                    {isStart ? Icon.play('#fff') : Icon.check('#fff')}
                    {nx.l}
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
              <select value={cur?.id || ''} aria-label="호기 고르기" data-scan-pick
                onChange={(e) => { const x = rowOf(e.target.value); if (x) { setCur({ id: String(x.id), qrRev: revInfo(x).b }); setLast(null) } }}
                className="w-full h-12 px-3 rounded-xl bg-white shadow-sm text-[15px]">
                <option value="">호기 고르기</option>
                {rows.map((x) => <option key={x.id} value={x.id}>{CUST_NAME[x.customer_code] || x.customer_code} · {String(x.pn || '').replace(/^AX-/, '')} {x.hogi}{x.part ? ` ${x.part}` : ''}</option>)}
              </select>
            )}

            {mine.length > 0 && (
              <div className="rounded-2xl bg-white shadow-sm px-4 py-3">
                <div className="text-[13px] font-semibold text-slate-500 mb-1">오늘 내가 찍은 것</div>
                {mine.map((e) => {
                  const x = rowOf(e.production_id)
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-1.5 text-[14px] border-t border-slate-100 first:border-0">
                      <span className="w-11 text-slate-400 tabular-nums">{hm(e.at)}</span>
                      <span className="font-semibold tabular-nums">{x ? `${String(x.pn || '').replace(/^AX-/, '')} ${x.hogi}` : '완료된 호기'}</span>
                      <span className="ml-auto text-slate-600">{stepName(e)}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-center text-[11px] text-slate-400 pt-1">찍은 기록은 공정 현황판 · 생산관리에 바로 반영됩니다</p>
          </div>
        )}
      </div>

      <ScanFlash value={flash} onDone={() => setFlash(null)} />
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
