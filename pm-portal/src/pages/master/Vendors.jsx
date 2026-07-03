import { useState, useRef } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ResizableTable } from '../../components/ResizableTable'
import * as XLSX from 'xlsx'

const EMPTY = { name:'', category:'자재', contact:'', phone:'', email:'', payment_terms:'', ecount_code:'', memo:'' }

const COLS = [
  { key:'name',          label:'협력사명',     defaultWidth:150 },
  { key:'category',      label:'구분',         defaultWidth:64 },
  { key:'contact',       label:'담당자',       defaultWidth:90 },
  { key:'phone',         label:'연락처',       defaultWidth:120 },
  { key:'email',         label:'이메일',       defaultWidth:170 },
  { key:'payment_terms', label:'결제조건',     defaultWidth:120 },
  { key:'ecount_code',   label:'이카운트코드', defaultWidth:100 },
  { key:'memo',          label:'메모',         defaultWidth:140 },
  { key:'_act',          label:'',             defaultWidth:90 },
]

async function fetchVendors(search) {
  let q = supabase.from('vendors').select('*').order('name')
  if (search) q = q.ilike('name', `%${search}%`)
  const { data } = await q
  return data || []
}

export default function Vendors() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const fileRef = useRef(null)
  const [importMsg, setImportMsg] = useState('')

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['vendors', search], queryFn: () => fetchVendors(search),
  })

  const saveMut = useMutation({
    mutationFn: async (data) => {
      if (editId) {
        const { error } = await supabase.from('vendors').update(data).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('vendors').insert(data)
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries(['vendors']); setForm(EMPTY); setShowForm(false); setEditId(null) },
    onError: (e) => toastError('오류: ' + e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (id) => {
      // 참조 중이면 삭제 막기 (발주/견적/이슈)
      const [po, qt, is, it] = await Promise.all([
        supabase.from('purchase_orders').select('id', { count:'exact', head:true }).eq('vendor_id', id),
        supabase.from('quotes').select('id', { count:'exact', head:true }).eq('vendor_id', id),
        supabase.from('issues').select('id', { count:'exact', head:true }).eq('vendor_id', id),
        supabase.from('items').select('id', { count:'exact', head:true }).eq('vendor_id', id),
      ])
      const used = (po.count||0) + (qt.count||0) + (is.count||0) + (it.count||0)
      if (used > 0) throw new Error(`사용 중(발주/견적/이슈/품목 ${used}건)이라 삭제할 수 없어요. 먼저 연결을 정리하세요.`)
      const { error } = await supabase.from('vendors').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['vendors']),
    onError: (e) => toastError(e.message),
  })

  // 미사용 협력사 일괄 정리 (어디에도 안 쓰인 것만 서버에서 정확히 삭제)
  const cleanupMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('pm_delete_unused_vendors')
      if (error) throw error
      return data
    },
    onSuccess: (n) => { qc.invalidateQueries(['vendors']); toastError(`미사용 협력사 ${n ?? 0}곳을 삭제했습니다.`) },
    onError: (e) => toastError('정리 오류: ' + e.message),
  })

  // 이카운트 거래처정보 업로드 → vendors upsert (ecount_code 기준)
  const importMut = useMutation({
    mutationFn: async (rows) => {
      // ecount_code 기준 50건씩 upsert
      const chunk = 100
      for (let i=0; i<rows.length; i+=chunk) {
        const { error } = await supabase.from('vendors')
          .upsert(rows.slice(i,i+chunk), { onConflict:'ecount_code' })
        if (error) throw error
      }
      return rows.length
    },
    onSuccess: (n) => { qc.invalidateQueries(['vendors']); setImportMsg(`✅ ${n}개 반영 완료`) },
    onError: (e) => setImportMsg('❌ 오류: '+e.message),
  })

  function pick(row, keys) {
    for (const k of keys) {
      const hit = Object.keys(row).find(c => String(c).replace(/\s|\n/g,'') === k.replace(/\s/g,''))
      if (hit && row[hit] != null && String(row[hit]).trim() !== '') return String(row[hit]).trim()
    }
    return ''
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    setImportMsg('읽는 중...')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type:'array' })
      const ws = wb.Sheets[wb.SheetNames.find(n=>n.includes('거래처')) || wb.SheetNames[0]]
      // 헤더가 2번째 행(회사명 안내행 다음)
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })
      let hi = aoa.findIndex(r => r.some(c => String(c).replace(/\s/g,'')==='거래처코드'))
      if (hi < 0) hi = 1
      const headers = aoa[hi].map(c=>String(c).replace(/\n/g,'').trim())
      const body = aoa.slice(hi+1)
      const rows = []
      for (const r of body) {
        const row = Object.fromEntries(headers.map((h,i)=>[h, r[i]]))
        const code = pick(row, ['거래처코드'])
        const name = pick(row, ['거래처명'])
        if (!code || !name) continue
        if (name.includes('사용금지')) continue        // (사용금지) 제외
        const use = pick(row, ['사용구분'])
        if (use && use.toUpperCase() === 'NO') continue  // 미사용 제외
        // 담당자1 / "휴대폰 / 이메일" 분리
        const hpEmail = pick(row, ['휴대폰/이메일','휴대폰 / 이메일'])
        const parts = hpEmail.split('/').map(s=>s.trim()).filter(Boolean)
        const phoneFromHp = parts.find(p=>/[0-9-]{9,}/.test(p)) || ''
        const emailFromHp = parts.find(p=>p.includes('@')) || ''
        rows.push({
          ecount_code: code,
          name,
          contact: pick(row, ['담당자1']),
          phone:   pick(row, ['전화','모바일']) || phoneFromHp,
          email:   pick(row, ['Email','email']) || emailFromHp,
          category: '자재',
        })
      }
      if (rows.length === 0) { setImportMsg('❌ 인식된 행이 없습니다'); return }
      // 중복 코드 제거(마지막 우선)
      const dedup = [...new Map(rows.map(r=>[r.ecount_code, r])).values()]
      importMut.mutate(dedup)
    } catch (err) {
      setImportMsg('❌ 읽기 오류: '+err.message)
    } finally {
      e.target.value = ''
    }
  }

  function handleEdit(v) {
    setForm({ name:v.name||'', category:v.category||'자재', contact:v.contact||'',
      phone:v.phone||'', email:v.email||'', payment_terms:v.payment_terms||'',
      ecount_code:v.ecount_code||'', memo:v.memo||'' })
    setEditId(v.id); setShowForm(true)
  }

  const f = (k) => e => setForm(prev => ({...prev, [k]: e.target.value}))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="협력사명 검색"
          className="w-56 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex-1" />
        {importMsg && <span className="text-xs font-semibold text-slate-500">{importMsg}</span>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
        <button onClick={()=>fileRef.current?.click()} disabled={importMut.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">
          {importMut.isPending ? '반영 중...' : '📤 거래처정보 업로드'}
        </button>
        <button onClick={() => { if (window.confirm('어디에도 연결 안 된 미사용 협력사를 모두 삭제할까요?\n(발주/견적/이슈에 쓰인 협력사는 안 지워집니다.)')) cleanupMut.mutate() }}
          disabled={cleanupMut.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 bg-white hover:border-red-300 hover:text-red-500 disabled:opacity-40">
          {cleanupMut.isPending ? '정리 중...' : '🧹 미사용 정리'}
        </button>
        <button onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(!showForm) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
          ➕ 협력사 추가
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">{editId ? '협력사 수정' : '협력사 추가'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-bold text-slate-500 mb-1">협력사명 *</label>
              <input value={form.name} onChange={f('name')} placeholder="협력사명"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">구분</label>
              <select value={form.category} onChange={f('category')}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option>자재</option><option>가공</option><option>기타</option></select></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">담당자</label>
              <input value={form.contact} onChange={f('contact')} placeholder="담당자"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">연락처</label>
              <input value={form.phone} onChange={f('phone')} placeholder="연락처"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">이메일</label>
              <input value={form.email} onChange={f('email')} placeholder="이메일"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">결제조건</label>
              <input value={form.payment_terms} onChange={f('payment_terms')} placeholder="예: 월말정산 60일"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">이카운트 코드</label>
              <input value={form.ecount_code} onChange={f('ecount_code')} placeholder="이카운트 코드"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">메모</label>
              <input value={form.memo} onChange={f('memo')} placeholder="메모"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
            <button onClick={() => saveMut.mutate(form)} disabled={!form.name.trim() || saveMut.isPending}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {saveMut.isPending ? '저장 중...' : editId ? '수정 완료' : '저장'}
            </button>
          </div>
        </div>
      )}

      <ResizableTable cols={COLS} storageKey="vendors-cols">
        {() => (
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
            ) : vendors.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-slate-400">협력사를 추가해주세요</td></tr>
            ) : vendors.map(v => (
              <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50 group">
                <td className="px-3 py-2 font-semibold text-slate-800 truncate" title={v.name}>{v.name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold
                    ${v.category==='가공'?'bg-indigo-50 text-indigo-600':v.category==='자재'?'bg-blue-50 text-blue-600':'bg-slate-100 text-slate-500'}`}>
                    {v.category}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600 truncate" title={v.contact||''}>{v.contact||'-'}</td>
                <td className="px-3 py-2 text-slate-500 truncate" title={v.phone||''}>{v.phone||'-'}</td>
                <td className="px-3 py-2 text-slate-500 truncate" title={v.email||''}>{v.email||'-'}</td>
                <td className="px-3 py-2 text-slate-600 truncate" title={v.payment_terms||''}>{v.payment_terms||'-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500 truncate" title={v.ecount_code||''}>{v.ecount_code||'-'}</td>
                <td className="px-3 py-2 text-slate-400 truncate" title={v.memo||''}>{v.memo||'-'}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(v)}
                      className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">수정</button>
                    <button onClick={() => { if(window.confirm('삭제할까요?')) deleteMut.mutate(v.id) }}
                      className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500">삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </ResizableTable>
    </div>
  )
}
