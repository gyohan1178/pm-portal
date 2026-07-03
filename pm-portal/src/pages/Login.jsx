import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('login')   // login | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('이메일 또는 비밀번호가 올바르지 않습니다.')
    setLoading(false)
  }

  async function handleSignup(e) {
    e.preventDefault()
    setLoading(true); setError('')
    if (password.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); setLoading(false); return }
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name, app: 'pm' } }
    })
    if (error) {
      setError(error.message.includes('already') ? '이미 가입된 이메일입니다.' : '가입 신청 중 오류가 발생했습니다.')
    } else {
      setDone(true)
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-base font-bold text-slate-900 mb-2">가입 신청 완료</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            관리자 승인 후 이용하실 수 있습니다.<br />
            승인되면 입력하신 이메일로 로그인하세요.
          </p>
          <button onClick={() => { setDone(false); setMode('login'); setPassword('') }}
            className="mt-6 w-full py-2.5 text-sm font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            로그인 화면으로
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="flex flex-col items-center mb-8">
            <img src="/pm-portal/logo.png" alt="진선테크" className="h-10 object-contain mb-3" />
            <h1 className="text-base font-bold text-slate-900">구매/자재 포털</h1>
            <p className="text-xs text-slate-400 mt-1">진선테크 내부 시스템</p>
          </div>

          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-6">
            <button onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${mode==='login'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>로그인</button>
            <button onClick={() => { setMode('signup'); setError('') }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${mode==='signup'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>회원가입 신청</button>
          </div>

          <form onSubmit={mode==='login'?handleLogin:handleSignup} className="space-y-4">
            {mode==='signup' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">이름</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="이름 입력" required
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">이메일</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="이메일 입력" required autoFocus={mode==='login'}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">비밀번호</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode==='signup'?'6자 이상':'비밀번호 입력'} required
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 font-semibold">{error}</div>
            )}

            <button type="submit" disabled={loading || !email || !password || (mode==='signup' && !name)}
              className="w-full py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors mt-2">
              {loading ? '처리 중...' : (mode==='login' ? '로그인' : '가입 신청')}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          {mode==='login' ? '계정이 없으신가요? 회원가입 신청 후 관리자 승인을 받으세요.' : '가입 신청 후 관리자 승인이 필요합니다.'}
        </p>
      </div>
    </div>
  )
}
