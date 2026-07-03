import { supabase } from '../lib/supabase'

export default function PendingApproval({ profile }) {
  const rejected = profile?.status === 'rejected'
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="text-4xl mb-4">{rejected ? '🚫' : '⏳'}</div>
        <h1 className="text-base font-bold text-slate-900 mb-2">
          {rejected ? '가입이 거절되었습니다' : '승인 대기 중입니다'}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          {rejected
            ? '계정 가입이 거절되었습니다. 자세한 사항은 관리자에게 문의하세요.'
            : <>관리자 승인 후 이용하실 수 있습니다.<br />승인되면 다시 로그인해 주세요.</>}
        </p>
        {profile?.email && (
          <p className="text-xs text-slate-400 mt-4">{profile.email}</p>
        )}
        <button onClick={() => supabase.auth.signOut()}
          className="mt-6 w-full py-2.5 text-sm font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          로그아웃
        </button>
      </div>
    </div>
  )
}
