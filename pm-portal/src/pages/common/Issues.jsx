import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const TYPES     = ['전체','할일','사내','고객사','협력사']
const STATUSES  = ['진행중','대기','완료']
const PRIORITIES= ['높음','중간','낮음']
const MEMBERS   = ['교한','황주현','남기문','충원']

const PRIORITY_STYLE = { '높음':'bg-red-50 text-red-600', '중간':'bg-amber-50 text-amber-700', '낮음':'bg-slate-100 text-slate-500' }
const STATUS_STYLE   = { '진행중':'bg-blue-50 text-blue-600', '대기':'bg-amber-50 text-amber-700', '완료':'bg-emerald-50 text-emerald-700' }

async function fetchIssues(type) {
  let q = supabase.from('issues').select('*, customers(name), vendors(name)').order('created_at', { ascending: false })
  if (type !== '전체') q = q.eq('issue_type', type)
  const { data } = await q
  return data || []
}
async function fetchCustomers() {
  const { data } = await supabase.from('customers').select('id, name')
  return data || []
}
async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id, name')
  return data || []
}

const EMPTY_FORM = { issue_type:'할일', title:'', content:'', priority:'중간', assigned_to:'교한', due_date:'', customer_id:'', vendor_id:'' }

export default function Issues() {
  const qc = useQueryClient()
  const [typeTab, setTypeTab] = useState('전체')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [statusFilter, setStatusFilter] = useState('진행중')

  const { data: issues = [] } = useQuery({ queryKey: ['issues', typeTab], queryFn: () => fetchIssues(typeTab) })
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors })

  const filtered = statusFilter === '전체' ? issues : issues.filter(i => i.status === statusFilter)

  const addMut = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('issues').insert({
        ...data,
        customer_id: data.customer_id || null,
        vendor_id: data.vendor_id || null,
        due_date: data.due_date || null,
      })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['issues']); setForm(EMPTY_FORM); setShowForm(false) },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('issues').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['issues']),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {TYPES.map(t => (
            <button key={t} onClick={() => setTypeTab(t)}
              className={`px-3 py-1.5 text-xs font-600 rounded-md transition-all
                ${typeTab===t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{t}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {['진행중','대기','완료','전체'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 text-[11px] font-600 rounded-full border transition-all
                ${statusFilter===s ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>{s}</button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-700 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
          ➕ 할일·이슈 등록
        </button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-700 text-slate-500 mb-1">구분 *</label>
              <select value={form.issue_type} onChange={e => setForm(f => ({...f, issue_type: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {['할일','사내','고객사','협력사'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-700 text-slate-500 mb-1">우선순위</label>
              <select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-700 text-slate-500 mb-1">담당자</label>
              <select value={form.assigned_to} onChange={e => setForm(f => ({...f, assigned_to: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {MEMBERS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-700 text-slate-500 mb-1">제목 *</label>
            <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))}
              placeholder="제목"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-[10px] font-700 text-slate-500 mb-1">내용</label>
            <textarea value={form.content} onChange={e => setForm(f => ({...f, content: e.target.value}))}
              rows={3} placeholder="상세 내용"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {form.issue_type === '고객사' && (
              <div>
                <label className="block text-[10px] font-700 text-slate-500 mb-1">고객사</label>
                <select value={form.customer_id} onChange={e => setForm(f => ({...f, customer_id: e.target.value}))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">선택</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {form.issue_type === '협력사' && (
              <div>
                <label className="block text-[10px] font-700 text-slate-500 mb-1">협력사</label>
                <select value={form.vendor_id} onChange={e => setForm(f => ({...f, vendor_id: e.target.value}))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">선택</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-700 text-slate-500 mb-1">마감일</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({...f, due_date: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
            <button onClick={() => addMut.mutate(form)} disabled={!form.title.trim() || addMut.isPending}
              className="px-4 py-2 text-xs font-700 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {addMut.isPending ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      )}

      {/* 이슈 목록 */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">할일·이슈가 없습니다</div>
        ) : filtered.map(issue => (
          <div key={issue.id} className="rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 ${PRIORITY_STYLE[issue.priority]}`}>
                    {issue.priority}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 bg-slate-100 text-slate-600">
                    {issue.issue_type}
                  </span>
                  {issue.customers?.name && (
                    <span className="text-[10px] text-slate-400">{issue.customers.name}</span>
                  )}
                  {issue.vendors?.name && (
                    <span className="text-[10px] text-slate-400">{issue.vendors.name}</span>
                  )}
                </div>
                <p className="text-sm font-600 text-slate-800">{issue.title}</p>
                {issue.content && <p className="text-xs text-slate-500 line-clamp-2">{issue.content}</p>}
                <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1">
                  <span>담당: {issue.assigned_to || '-'}</span>
                  {issue.due_date && <span>마감: {issue.due_date}</span>}
                  <span>{new Date(issue.created_at).toLocaleDateString('ko-KR')}</span>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => updateStatus.mutate({ id: issue.id, status: s })}
                    className={`px-2 py-1 text-[10px] font-700 rounded-lg border transition-all
                      ${issue.status === s ? STATUS_STYLE[s] + ' border-transparent' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
