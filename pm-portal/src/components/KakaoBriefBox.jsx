// 설정(⚙) — 카톡 아침 알림 (v4.205.0): 연결 · 켜고 끄기 · 지금 보내 보기 · 보낼 글 미리보기
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { kakaoStatus, kakaoPreview, kakaoSetEnabled, kakaoUnlink, kakaoTest, kakaoStartLink, KAKAO_SQL } from '../lib/kakaoBrief'
import { kstDT } from '../lib/utils'
import { toastError, toastSuccess } from '../lib/toast'

const BTN = 'h-8 px-3 rounded-lg text-xs font-bold border disabled:opacity-40'
export default function KakaoBriefBox() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState('')
  const [showPv, setShowPv] = useState(false)
  const { data: st, isLoading } = useQuery({ queryKey: ['kakaoStatus'], queryFn: kakaoStatus, staleTime: 30 * 1000 })
  const { data: pv } = useQuery({ queryKey: ['kakaoPreview'], queryFn: kakaoPreview, enabled: showPv && !!st && !st.noSql })
  const run = async (k, fn, ok) => {
    setBusy(k)
    try { await fn(); if (ok) toastSuccess(ok); qc.invalidateQueries({ queryKey: ['kakaoStatus'] }) } catch (e) { toastError(e.message) } finally { setBusy('') }
  }
  return (
    <div className="space-y-2" data-kakao-box>
      <label className="text-sm font-semibold text-slate-700">📱 카톡 아침 알림</label>
      <p className="text-xs text-slate-400">평일(공휴일 빼고) 아침 8시 50분에 「오늘 챙길 일」(입고 · 수주 미확인 · 자재 요청 · 내 할 일 · 오늘 일정)을 내 카카오톡 「나와의 채팅」으로 보냅니다. 발주 숫자는 위 맨 위 고객사 기준입니다.</p>
      {isLoading ? <div className="h-9 rounded-lg pm-skel" />
        : st?.noSql ? <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">⚠ {KAKAO_SQL} 실행 후 쓸 수 있습니다</p>
        : !st?.linked ? (
          <button type="button" data-kakao-link disabled={!!busy} onClick={() => run('link', kakaoStartLink)}
            className="w-full h-10 rounded-lg bg-[#FEE500] text-[#191919] text-sm font-bold hover:brightness-95 disabled:opacity-50">{busy === 'link' ? '여는 중…' : '카카오톡 연결하기'}</button>
        ) : (
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 space-y-2" data-kakao-linked={st.enabled ? 'on' : 'off'}>
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full font-bold border ${st.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>{st.enabled ? '켜짐' : '꺼짐'}</span>
              <span className="text-slate-600 font-semibold truncate">{st.nickname || '연결됨'}</span>
              <span className="ml-auto text-slate-400">{st.last_sent_at ? `마지막 ${kstDT(st.last_sent_at)}` : '아직 안 보냄'}</span>
            </div>
            {st.last_error && <p className="text-[11px] text-rose-600 break-keep" data-kakao-err>⚠ {st.last_error}</p>}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={`${BTN} border-violet-200 bg-violet-50 text-violet-700`} disabled={!!busy} data-kakao-test
                onClick={() => run('test', kakaoTest, '카톡으로 보냈습니다 — 「나와의 채팅」을 보세요')}>{busy === 'test' ? '보내는 중…' : '지금 보내 보기'}</button>
              <button type="button" className={`${BTN} border-slate-200 text-slate-600`} disabled={!!busy} data-kakao-toggle
                onClick={() => run('tg', () => kakaoSetEnabled(!st.enabled), st.enabled ? '아침 알림을 껐습니다' : '아침 알림을 켰습니다')}>{st.enabled ? '끄기' : '켜기'}</button>
              <button type="button" className={`${BTN} border-slate-200 text-slate-600`} onClick={() => setShowPv((v) => !v)} data-kakao-pv>보낼 글 {showPv ? '접기' : '보기'}</button>
              <button type="button" className={`${BTN} border-slate-200 text-slate-400 ml-auto`} disabled={!!busy} data-kakao-unlink
                onClick={() => run('ul', kakaoUnlink, '연결을 끊었습니다')}>연결 끊기</button>
            </div>
            {showPv && <pre className="text-[11.5px] leading-5 whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-slate-700 font-sans" data-kakao-preview>{pv || '…'}</pre>}
          </div>
        )}
    </div>
  )
}
