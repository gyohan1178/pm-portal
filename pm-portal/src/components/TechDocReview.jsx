// 기술 문서 · SOP 검토 칸 (v4.221.0) — 품질 › 기술 문서 상세 · 현장 › 작업 기준 보기에서 같이 씀
//   ✔ 검토 완료 / 검토 취소 = 품질 부서 · 팀장급 · 관리자   ·   💬 의견 = 편집 권한자 누구나
//   다시 올려 번역 Rev 가 바뀌면(또는 SOP 를 고치면) 자동으로 「검토 전」 + 이력에 남음 (lib/techDoc.js)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from './ux/ConfirmDialog'
import { toastError, toastSuccess } from '../lib/toast'
import { fetchReviews, addReview, approveDoc, unapproveDoc, canApprove, STATUS_TONE, TECHDOC_REVIEW_SQL } from '../lib/techDoc'

const KIND_LABEL = { comment: '💬 의견', approve: '✔ 검토 완료', unapprove: '↩ 검토 취소', reset: '↻ 다시 올림' }
const BTN = 'h-[32px] px-3 rounded-[9px] border text-[12.5px] font-bold disabled:opacity-40'

export default function TechDocReview({ doc, profile, editable, onChanged }) {
  const qc = useQueryClient()
  const [ask, confirmEl] = useConfirm()
  const key = doc?.doc_key
  const me = (profile?.name || '').trim() || profile?.email || ''
  const { data: list, isLoading } = useQuery({ queryKey: ['techDocReviews', key], queryFn: () => fetchReviews(key), enabled: !!key, staleTime: 30_000 })
  const approver = canApprove(profile)
  const done = doc?.status === '검토 완료'
  const sop = doc?.kind === 'sop'
  const noSql = list === null || !('reviewed_at' in (doc || {}))
  const refresh = () => { qc.invalidateQueries({ queryKey: ['techDocReviews', key] }); onChanged?.() }

  async function comment() {
    const m = await ask({ title: '의견 남기기', desc: '번역 오류 · 현장 질문 · 확인할 것을 이 문서에 붙여 둡니다. 검토 상태는 바뀌지 않습니다.', okText: '남기기', input: { label: '의견', required: true, rows: 3 } })
    if (!m) return
    try { await addReview(key, 'comment', m.value, me); toastSuccess('의견을 남겼습니다'); refresh() } catch (e) { toastError(e.message || String(e)) }
  }
  async function approve() {
    const m = await ask({ title: `${sop ? 'SOP 승인' : '검토 완료'} — ${doc.doc_no || key}`,
      desc: `${sop ? '이 SOP 를 현장 기준으로 승인합니다.' : '번역 · 요약을 확인했고 현장 기준으로 써도 된다는 표시입니다.'} 이름과 날짜가 남고, 작업 기준 화면에 「검토 완료」 로 보입니다. 다시 올려 Rev 가 바뀌면 자동으로 검토 전으로 돌아갑니다.`,
      okText: sop ? '승인' : '검토 완료', input: { label: '한마디 (선택)', required: false, rows: 2 } })
    if (!m) return
    try { await approveDoc(key, me, m.value); toastSuccess(sop ? '승인했습니다' : '검토 완료로 바꿨습니다'); refresh() } catch (e) { toastError(e.message || String(e)) }
  }
  async function unapprove() {
    const m = await ask({ title: '검토를 취소할까요?', desc: '「검토 전」 으로 돌아갑니다. 왜 취소하는지 남겨 주세요.', okText: '검토 취소', danger: true, input: { label: '사유', required: true, rows: 2 } })
    if (!m) return
    try { await unapproveDoc(key, me, m.value); toastSuccess('검토 전으로 돌렸습니다'); refresh() } catch (e) { toastError(e.message || String(e)) }
  }

  if (!doc) return null
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4" data-techdoc-review>
      {confirmEl}
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[14px] text-slate-800">{sop ? '검토 · 승인' : '검토'}</b>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_TONE[doc.status] || 'bg-slate-50 text-slate-400 border-slate-200'}`}>{doc.status || '—'}</span>
        <span className="text-[12px] text-slate-500">{done && doc.reviewed_by ? `${doc.reviewed_by} · ${String(doc.reviewed_at || '').slice(0, 10)}` : (doc.body?.review || '')}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {editable && !noSql && <button type="button" onClick={comment} className={`${BTN} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`} data-review-comment>💬 의견 남기기</button>}
          {approver && !noSql && !done && <button type="button" onClick={approve} className={`${BTN} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} data-review-approve>✔ {sop ? '승인' : '검토 완료'}</button>}
          {approver && !noSql && done && <button type="button" onClick={unapprove} className={`${BTN} border-slate-200 bg-white text-slate-500 hover:bg-slate-50`} data-review-unapprove>검토 취소</button>}
        </span>
      </div>
      {noSql && <p className="text-[12.5px] text-amber-800 mt-2">⚠ 검토 칸이 아직 없습니다 — 「{TECHDOC_REVIEW_SQL}」 SQL 을 먼저 실행하세요.</p>}
      {!noSql && !approver && !done && <p className="text-[12px] text-slate-400 mt-1.5">검토 완료는 품질 부서 · 팀장급 · 관리자가 누릅니다.</p>}
      {!noSql && (isLoading ? <p className="text-[12px] text-slate-400 mt-2">이력 불러오는 중…</p> : list?.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px] bg-white rounded-lg">
            <thead><tr className="text-left text-slate-400"><th className="px-2.5 py-1.5 font-bold w-[96px]">일시</th><th className="px-2.5 py-1.5 font-bold w-[110px]">누가</th><th className="px-2.5 py-1.5 font-bold w-[110px]">구분</th><th className="px-2.5 py-1.5 font-bold">내용</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-2.5 py-1.5 text-slate-400 whitespace-nowrap">{String(r.created_at || '').slice(0, 10)}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">{r.by_name || '—'}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap font-bold text-slate-600">{KIND_LABEL[r.kind] || r.kind}</td>
                <td className="px-2.5 py-1.5 text-slate-600 whitespace-pre-line">{r.body}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
