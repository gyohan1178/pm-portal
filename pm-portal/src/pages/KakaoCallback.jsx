// 카카오 로그인에서 돌아오는 곳 (v4.205.0) — ?code= 를 서버 함수에 넘겨 연결을 저장하고 확인 메시지를 보낸다
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { kakaoConnect } from '../lib/kakaoBrief'

export default function KakaoCallback() {
  const [sp] = useSearchParams()
  const [st, setSt] = useState({ k: 'wait' })
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    const code = sp.get('code'), err = sp.get('error_description') || sp.get('error')
    if (err) { setSt({ k: 'err', msg: `카카오에서 취소되었거나 실패했습니다 — ${err}` }); return }
    if (!code) { setSt({ k: 'err', msg: '카카오가 돌려준 값이 없습니다 — 설정(⚙)에서 다시 연결해 주세요' }); return }
    kakaoConnect(code).then((r) => setSt({ k: 'ok', name: r?.nickname }), (e) => setSt({ k: 'err', msg: e.message }))
  }, [sp])
  return (
    <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center p-4" data-kakao-cb={st.k}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-center">
        <div className="text-3xl">{st.k === 'ok' ? '✅' : st.k === 'err' ? '⚠️' : '⏳'}</div>
        <h1 className="text-lg font-extrabold text-slate-800">카톡 아침 알림 연결</h1>
        {st.k === 'wait' && <p className="text-sm text-slate-500">카카오와 연결하는 중입니다…</p>}
        {st.k === 'ok' && <p className="text-sm text-slate-600">연결됐습니다{st.name ? ` (${st.name})` : ''}. 카톡 「나와의 채팅」에 확인 메시지가 갔는지 보세요.<br />평일 아침 8시 50분에 「오늘 챙길 일」이 옵니다.</p>}
        {st.k === 'err' && <p className="text-sm text-rose-600 break-keep">{st.msg}</p>}
        <Link to="/todo" className="inline-flex h-10 items-center px-4 rounded-lg bg-[#6c5ce7] text-white text-sm font-bold">포털로 돌아가기</Link>
      </div>
    </div>
  )
}
