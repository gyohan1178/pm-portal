import { useState, useEffect } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ROLE_LABEL } from '../../hooks/useProfile'
import { ResizableTable } from '../../components/ResizableTable'
import { useTableSort } from '../../hooks/useTableSort'

const USER_COLS = [
  { key:'name',       label:'이름',   defaultWidth:120 },
  { key:'email',      label:'이메일', defaultWidth:220 },
  { key:'role',       label:'권한',   defaultWidth:140, style:{textAlign:'center'}, sortable:false },
  { key:'created_at', label:'신청일', defaultWidth:110, style:{textAlign:'center'} },
  { key:'_act',       label:'관리',   defaultWidth:130, style:{textAlign:'center'}, sortable:false },
]

const ROLES = ['admin', 'editor', 'viewer']

async function fetchProfiles() {
  const { data, error } = await supabase
    .from('pm_profiles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export default function UserManagement() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('pending')
  const [myId, setMyId] = useState(null)
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyId(data?.user?.id)) }, [])
  const { data: profiles = [], isLoading } = useQuery({ queryKey: ['profiles'], queryFn: fetchProfiles })

  const mut = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('pm_profiles').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['profiles']),
    onError: (e) => toastError('변경 오류: ' + e.message),
  })

  const approve = (id) => mut.mutate({ id, patch: { status: 'approved', approved_at: new Date().toISOString() } })
  const reject = (id) => mut.mutate({ id, patch: { status: 'rejected' } })
  const setRole = (id, role) => mut.mutate({ id, patch: { role } })

  const pending = profiles.filter(p => p.status === 'pending')
  const active = profiles.filter(p => p.status === 'approved')
  const rejected = profiles.filter(p => p.status === 'rejected')
  const list = tab === 'pending' ? pending : tab === 'active' ? active : rejected
  const { sorted, sortKey, sortDir, onSort } = useTableSort(list, { defaultKey:'created_at', defaultDir:'desc' })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">👥 회원 관리</h1>
        <p className="text-xs text-slate-400 mt-0.5">가입 신청 승인 · 권한 설정 (관리자 / 편집 / 조회)</p>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['pending', `승인 대기 ${pending.length}`], ['active', `활성 ${active.length}`], ['rejected', `거절 ${rejected.length}`]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${tab === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div> :
        list.length === 0 ? <div className="text-center py-12 text-slate-300 text-sm">해당 회원이 없습니다</div> : (
        <>
          {/* 모바일: 카드 */}
          <div className="sm:hidden space-y-2">
            {list.map(p => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{p.name || '(이름 없음)'}</p>
                    <p className="text-xs text-slate-400 truncate">{p.email}</p>
                  </div>
                  {tab === 'pending' ? (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => approve(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white">승인</button>
                      <button onClick={() => reject(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">거절</button>
                    </div>
                  ) : tab === 'rejected' ? (
                    <button onClick={() => approve(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white flex-shrink-0">승인</button>
                  ) : null}
                </div>
                {tab === 'active' && (
                  <div className="flex items-center gap-2 mt-2">
                    {p.id === myId ? (
                      <span className="text-xs text-indigo-500 font-bold">{ROLE_LABEL[p.role]} (본인)</span>
                    ) : (
                      <select value={p.role} onChange={e => setRole(p.id, e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* PC: 테이블 */}
          <div className="hidden sm:block rounded-xl border border-slate-200 overflow-x-auto">
            <ResizableTable cols={USER_COLS} storageKey="users_cols" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
              {() => (
              <tbody className="divide-y divide-slate-100">
                {sorted.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap overflow-hidden truncate">{p.name || '-'}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap overflow-hidden truncate">{p.email}</td>
                    <td className="px-3 py-2 text-center">
                      {tab === 'active' ? (
                        p.id === myId
                          ? <span className="text-indigo-500 font-bold">{ROLE_LABEL[p.role]} (본인)</span>
                          : <select value={p.role} onChange={e => setRole(p.id, e.target.value)}
                              className="px-2 py-1 text-xs border border-slate-200 rounded-lg">
                              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                            </select>
                      ) : <span className="text-slate-400">{ROLE_LABEL[p.role]}</span>}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-400 whitespace-nowrap">{p.created_at?.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {tab === 'pending' ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => approve(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">승인</button>
                          <button onClick={() => reject(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">거절</button>
                        </div>
                      ) : tab === 'rejected' ? (
                        <button onClick={() => approve(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">승인</button>
                      ) : (
                        p.id === myId
                          ? <span className="text-xs text-slate-300">-</span>
                          : <button onClick={() => reject(p.id)} className="px-2.5 py-1 text-xs font-bold rounded-lg border border-red-200 text-red-500 hover:bg-red-50">비활성</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              )}
            </ResizableTable>
          </div>
        </>
      )}
    </div>
  )
}
