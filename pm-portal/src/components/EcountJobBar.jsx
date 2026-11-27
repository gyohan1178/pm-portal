// ⚡ 이카운트 보낸 일 — 최근 보낸 것의 진행 · 결과와 중계(사무실 PC) 상태 (v4.253.0)
//   보내는 중인 것이 있을 때만 5초마다 새로 읽고, 없으면 화면에 들어올 때 · 창을 다시 볼 때만 읽는다 (부담 규칙)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { fetchEcountJobs } from '../lib/ecountSend'
import { toastSuccess, toastError } from '../lib/toast'

const KIND = { po: '발주서', buy: '구매입력' }
const ST = { wait: ['대기', 'bg-slate-100 text-slate-600'], run: ['보내는 중', 'bg-blue-50 text-blue-700'], done: ['완료', 'bg-emerald-50 text-emerald-700'], fail: ['실패', 'bg-rose-50 text-rose-700'], cancel: ['취소', 'bg-slate-100 text-slate-400'] }
const hm = (t) => (t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '')

export default function EcountJobBar({ onDone }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['ecountJobs'],
    queryFn: () => fetchEcountJobs(8),
    refetchInterval: (q) => ((q.state.data?.jobs || []).some((j) => j.status === 'wait' || j.status === 'run') ? 5000 : false),
    refetchIntervalInBackground: false,
  })
  // 보내는 중이던 것이 끝나면 알림 + 목록 새로 고침
  const prev = useRef(new Map())
  useEffect(() => {
    for (const j of data?.jobs || []) {
      const was = prev.current.get(j.id)
      if (was && (was === 'wait' || was === 'run') && (j.status === 'done' || j.status === 'fail')) {
        const ok = (j.result?.slips || []).filter((x) => x.ok)
        if (j.status === 'done' && ok.length === (j.slips || []).length) toastSuccess(`이카운트 ${KIND[j.kind]} ${ok.length}장 들어감 — ${ok.map((x) => x.no).filter(Boolean).slice(0, 3).join(', ')}${ok.length > 3 ? ' …' : ''}`)
        else toastError(`이카운트 ${KIND[j.kind]} — 성공 ${ok.length} / ${(j.slips || []).length}장. 「⚡ 이카운트 보낸 일」에서 확인해 주세요`)
        onDone?.(j)
        qc.invalidateQueries({ queryKey: ['purchase'], exact: false })
      }
      prev.current.set(j.id, j.status)
    }
  }, [data, onDone, qc])

  if (!data || data.missing) return null
  const jobs = data.jobs || []
  const seen = data.relay?.seen_at ? Date.parse(data.relay.seen_at) : 0
  const alive = seen && Date.now() - seen < 3 * 60_000
  const pending = jobs.filter((j) => j.status === 'wait' || j.status === 'run').length
  if (!jobs.length && alive) return null
  // 30분 안에 실패한 가장 최근 것 — 펼치지 않아도 이유를 보여 준다
  const lastFail = jobs.find((j) => j.status === 'fail' && Date.now() - Date.parse(j.done_at || j.created_at) < 30 * 60_000)
  const failMsgs = lastFail ? (lastFail.result?.slips || []).filter((x) => !x.ok).map((x) => {
    const sl = (lastFail.slips || []).find((s) => String(s.seq) === String(x.seq))
    const m = String(x.error || '').match(/미등록코드\[([^\]]+)\]/)
    return `${sl?.label || ''} — ${m ? `이카운트에 품목코드 ${m[1]} 가 없음 (이카운트 품목 등록 필요)` : x.error}`
  }) : []
  return (
    <div className="mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" data-ecount-jobs>
      <div className="flex items-center gap-2 flex-wrap">
        <b className="text-slate-700">⚡ 이카운트 보낸 일</b>
        <span className={`px-1.5 py-0.5 rounded font-bold ${alive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
          title="사무실 중계(교한 PC 의 Gyohan Studio)가 이카운트로 보냅니다. 꺼져 있으면 켜질 때까지 대기합니다.">
          {alive ? `중계 켜짐 · ${hm(data.relay.seen_at)}` : `중계 꺼짐${seen ? ` (마지막 ${hm(data.relay.seen_at)})` : ''} — 켜지면 차례로 보냄`}</span>
        {data.relay?.note && <span className="text-rose-600">{data.relay.note}</span>}
        {pending > 0 && <span className="text-blue-700 font-bold">보내는 중 {pending}건</span>}
        <button className="ml-auto text-slate-500 hover:text-slate-800" onClick={() => setOpen((o) => !o)}>{open ? '접기' : `최근 ${jobs.length}건 보기`}</button>
      </div>
      {!open && failMsgs.length > 0 && (
        <div className="mt-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2 py-1.5 text-rose-700">
          <b>방금 보낸 것 중 실패 {failMsgs.length}장</b>{failMsgs.slice(0, 3).map((t, i) => <div key={i}>✕ {t}</div>)}
        </div>
      )}
      {open && (
        <table className="w-full mt-2">
          <tbody>
            {jobs.map((j) => {
              const [lab, cls] = ST[j.status] || [j.status, '']
              const res = j.result?.slips || []
              return (
                <tr key={j.id} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-2 whitespace-nowrap text-slate-500">{hm(j.created_at)}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{KIND[j.kind]} · {(j.slips || []).length}장</td>
                  <td className="py-1 pr-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded font-bold ${cls}`}>{lab}</span></td>
                  <td className="py-1 pr-2 whitespace-nowrap text-slate-500">{j.requested_name || ''}</td>
                  <td className="py-1 text-slate-600">
                    {(j.slips || []).map((sl, i) => {
                      const r = res.find((x) => String(x.seq) === String(sl.seq))
                      return <div key={i}>{sl.label} {r ? (r.ok ? <b className="text-emerald-700">→ {r.no}</b> : <span className="text-rose-600">✕ {r.error}</span>) : null}</div>
                    })}
                    {j.error && <div className="text-rose-600">{j.error}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
