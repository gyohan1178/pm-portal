import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

async function fetchNotionData(type) {
  const { data, error } = await supabase.functions.invoke('notion-proxy', { body: { type } })
  if (error) throw error
  return data
}

function getStr(props, ...keys) {
  for (const k of keys) {
    const p = props[k]
    if (!p) continue
    if (p.title?.[0]?.plain_text) return p.title[0].plain_text
    if (p.rich_text?.[0]?.plain_text) return p.rich_text[0].plain_text
    if (p.select?.name) return p.select.name
    if (p.multi_select?.length) return p.multi_select.map(s=>s.name).join(', ')
    if (p.date?.start) return p.date.start
    if (p.people?.[0]?.name) return p.people[0].name
    if (p.formula?.string) return p.formula.string
  }
  return '-'
}

function dday(dateStr) {
  if (!dateStr || dateStr === '-') return null
  const diff = Math.round((new Date(dateStr) - new Date()) / 86400000)
  return diff
}

function DDayBadge({ dateStr }) {
  const d = dday(dateStr)
  if (d === null) return <span className="text-slate-300">-</span>
  if (d < 0) return <span className="text-xs font-bold text-red-600">D+{Math.abs(d)}</span>
  if (d === 0) return <span className="text-xs font-bold text-red-500">오늘</span>
  if (d <= 3) return <span className="text-xs font-bold text-amber-600">D-{d}</span>
  return <span className="text-xs text-slate-400">D-{d}</span>
}

const STATUS_COLOR = {
  '처리중': 'bg-amber-50 text-amber-700',
  '완료':   'bg-emerald-50 text-emerald-700',
  '답변대기':'bg-red-50 text-red-700',
  '진행중': 'bg-blue-50 text-blue-700',
  '대기':   'bg-slate-100 text-slate-500',
  'Done':   'bg-emerald-50 text-emerald-700',
  'In Progress': 'bg-blue-50 text-blue-700',
  'Not Started': 'bg-slate-100 text-slate-500',
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLOR[status]||'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  )
}

function PriorityDot({ priority }) {
  const map = { '높음':'bg-red-500','중간':'bg-amber-400','낮음':'bg-slate-300',High:'bg-red-500',Medium:'bg-amber-400',Low:'bg-slate-300' }
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${map[priority]||'bg-slate-300'}`}/>
}

function ExpandableText({ text, maxLen = 40 }) {
  const [open, setOpen] = useState(false)
  if (!text || text === '-') return <span className="text-slate-300">-</span>
  if (text.length <= maxLen) return <span className="text-slate-500">{text}</span>
  return (
    <span>
      <span className="text-slate-500">{open ? text : text.slice(0, maxLen) + '...'}</span>
      <button onClick={() => setOpen(v=>!v)} className="ml-1 text-indigo-400 hover:text-indigo-600 text-xs font-semibold">
        {open ? '접기' : '더보기'}
      </button>
    </span>
  )
}

export default function AdminDashboard() {
  const [tab, setTab] = useState('comms')
  const [search, setSearch] = useState('')
  const [filterCS, setFilterCS] = useState('전체')
  const [filterStatus, setFilterStatus] = useState('전체')
  const [filterDir, setFilterDir] = useState('전체')

  const { data: actions, isLoading: aLoading, error: aError, refetch: aRefetch } = useQuery({
    queryKey:['notion-actions'], queryFn:()=>fetchNotionData('actions'), retry:1,
  })
  const { data: comms, isLoading: cLoading, error: cError, refetch: cRefetch } = useQuery({
    queryKey:['notion-comms'], queryFn:()=>fetchNotionData('comms'), retry:1,
  })

  const commItems = comms?.results || []
  const actionItems = actions?.results || []

  // 커뮤니케이션 필터 옵션
  const csOptions = useMemo(()=>['전체',...new Set(commItems.map(r=>getStr(r.properties,'고객사')).filter(v=>v&&v!=='-'))],[commItems])
  const statusOptions = useMemo(()=>['전체',...new Set(commItems.map(r=>getStr(r.properties,'상태')).filter(v=>v&&v!=='-'))],[commItems])
  const dirOptions = useMemo(()=>['전체',...new Set(commItems.map(r=>getStr(r.properties,'방향')).filter(v=>v&&v!=='-'))],[commItems])

  const filteredComms = useMemo(()=>{
    return commItems.filter(r=>{
      const p = r.properties||{}
      const title = getStr(p,'제목')
      const cs = getStr(p,'고객사')
      const status = getStr(p,'상태')
      const dir = getStr(p,'방향')
      const summary = getStr(p,'요약')
      if (search && ![title,cs,summary].some(v=>v.toLowerCase().includes(search.toLowerCase()))) return false
      if (filterCS!=='전체' && cs!==filterCS) return false
      if (filterStatus!=='전체' && status!==filterStatus) return false
      if (filterDir!=='전체' && dir!==filterDir) return false
      return true
    }).sort((a,b)=>{
      // 답변대기 먼저
      const sa = getStr(a.properties,'상태'), sb = getStr(b.properties,'상태')
      if (sa==='답변대기' && sb!=='답변대기') return -1
      if (sb==='답변대기' && sa!=='답변대기') return 1
      return 0
    })
  },[commItems,search,filterCS,filterStatus,filterDir])

  const pendingCount = commItems.filter(r=>getStr(r.properties,'상태')==='답변대기').length

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-slate-50 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">교</div>
        <div>
          <p className="text-sm font-bold text-slate-900">내 대시보드</p>
          <p className="text-xs text-slate-400 mt-0.5">Notion 연동 · Admin 전용</p>
        </div>
        {pendingCount > 0 && (
          <div className="ml-2 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200">
            <p className="text-xs font-bold text-red-600">⚠️ 답변대기 {pendingCount}건</p>
          </div>
        )}
        <button onClick={()=>{ aRefetch(); cRefetch() }}
          className="ml-auto text-xs text-indigo-500 hover:text-indigo-700 font-semibold px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50">
          🔄 새로고침
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[['comms','💬 커뮤니케이션 이력'],['actions','⚡ 액션 아이템']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {/* 커뮤니케이션 이력 */}
      {tab==='comms' && (
        <div className="space-y-3">
          {cLoading && <div className="text-center py-12 text-slate-400 text-sm">Notion 불러오는 중...</div>}
          {cError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              <p className="font-bold mb-1">연결 오류</p>
              <p className="text-xs">{cError.message}</p>
            </div>
          )}
          {comms && (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체</p><p className="text-xl font-bold text-slate-900">{commItems.length}</p></div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">답변대기</p><p className="text-xl font-bold text-red-600">{pendingCount}</p></div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">처리중</p><p className="text-xl font-bold text-amber-700">{commItems.filter(r=>getStr(r.properties,'상태')==='처리중').length}</p></div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">완료</p><p className="text-xl font-bold text-emerald-700">{commItems.filter(r=>getStr(r.properties,'상태')==='완료').length}</p></div>
              </div>

              {/* 필터 */}
              <div className="flex items-center gap-2 flex-wrap">
                <input value={search} onChange={e=>setSearch(e.target.value)}
                  placeholder="제목, 고객사, 요약 검색..."
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"/>
                <select value={filterCS} onChange={e=>setFilterCS(e.target.value)}
                  className="px-2 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none">
                  {csOptions.map(v=><option key={v}>{v}</option>)}
                </select>
                <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
                  className="px-2 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none">
                  {statusOptions.map(v=><option key={v}>{v}</option>)}
                </select>
                <select value={filterDir} onChange={e=>setFilterDir(e.target.value)}
                  className="px-2 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none">
                  {dirOptions.map(v=><option key={v}>{v}</option>)}
                </select>
                {(search||filterCS!=='전체'||filterStatus!=='전체'||filterDir!=='전체') && (
                  <button onClick={()=>{setSearch('');setFilterCS('전체');setFilterStatus('전체');setFilterDir('전체')}}
                    className="text-xs text-slate-400 hover:text-slate-600">✕ 초기화</button>
                )}
                <span className="ml-auto text-xs text-slate-400">{filteredComms.length}건</span>
              </div>

              {/* 테이블 */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50 border-b border-slate-200">
                      {['날짜','제목','고객사','담당자','방향','상태','요약','후속액션','Notion'].map(h=>(
                        <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {filteredComms.length===0
                        ? <tr><td colSpan={9} className="text-center py-8 text-slate-400">이력이 없습니다</td></tr>
                        : filteredComms.map(r=>{
                          const p = r.properties||{}
                          const status = getStr(p,'상태')
                          const isUrgent = status==='답변대기'
                          return (
                            <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 ${isUrgent?'bg-red-50/30':''}`}>
                              <td className="px-3 py-2 text-slate-500 whitespace-nowrap font-mono">{getStr(p,'날짜')}</td>
                              <td className="px-3 py-2 font-semibold text-slate-800 max-w-[200px] truncate">
                                {isUrgent && <span className="mr-1">🔴</span>}
                                {getStr(p,'제목')}
                              </td>
                              <td className="px-3 py-2 text-slate-500">{getStr(p,'고객사')}</td>
                              <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{getStr(p,'담당자')}</td>
                              <td className="px-3 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getStr(p,'방향')==='발신'?'bg-purple-50 text-purple-600':'bg-blue-50 text-blue-600'}`}>
                                  {getStr(p,'방향')}
                                </span>
                              </td>
                              <td className="px-3 py-2"><StatusBadge status={status}/></td>
                              <td className="px-3 py-2 max-w-[200px]"><ExpandableText text={getStr(p,'요약')}/></td>
                              <td className="px-3 py-2 max-w-[200px]"><ExpandableText text={getStr(p,'후속액션')}/></td>
                              <td className="px-3 py-2">
                                <a href={r.url} target="_blank" rel="noreferrer"
                                  className="text-indigo-400 hover:text-indigo-600 text-xs font-semibold">↗</a>
                              </td>
                            </tr>
                          )
                        })
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 액션 아이템 */}
      {tab==='actions' && (
        <div className="space-y-3">
          {aLoading && <div className="text-center py-12 text-slate-400 text-sm">Notion 불러오는 중...</div>}
          {aError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
              <p className="font-bold mb-1">연결 오류</p>
              <p className="text-xs">{aError.message}</p>
            </div>
          )}
          {actions && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체</p><p className="text-xl font-bold text-slate-900">{actionItems.length}</p></div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-1">진행중</p><p className="text-xl font-bold text-blue-700">{actionItems.filter(r=>['진행중','In Progress'].includes(getStr(r.properties,'상태','Status'))).length}</p></div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">우선순위 높음</p><p className="text-xl font-bold text-red-600">{actionItems.filter(r=>['높음','High'].includes(getStr(r.properties,'우선순위','Priority'))).length}</p></div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['','제목','담당','우선순위','상태','마감일','D-day','Notion'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {actionItems.length===0
                      ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">액션 아이템이 없습니다</td></tr>
                      : actionItems.sort((a,b)=>{
                          const da = dday(getStr(a.properties,'마감일','Due'))
                          const db = dday(getStr(b.properties,'마감일','Due'))
                          if (da===null) return 1
                          if (db===null) return -1
                          return da - db
                        }).map(r=>{
                        const p = r.properties||{}
                        const priority = getStr(p,'우선순위','Priority')
                        const status = getStr(p,'상태','Status')
                        const due = getStr(p,'마감일','Due')
                        return (
                          <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2"><PriorityDot priority={priority}/></td>
                            <td className="px-3 py-2 font-semibold text-slate-800 max-w-xs truncate">{getStr(p,'이름','Name','제목')}</td>
                            <td className="px-3 py-2 text-slate-500">{getStr(p,'담당자','Assignee')}</td>
                            <td className="px-3 py-2 text-slate-500">{priority}</td>
                            <td className="px-3 py-2"><StatusBadge status={status}/></td>
                            <td className="px-3 py-2 text-slate-500 font-mono">{due}</td>
                            <td className="px-3 py-2"><DDayBadge dateStr={due}/></td>
                            <td className="px-3 py-2">
                              <a href={r.url} target="_blank" rel="noreferrer"
                                className="text-indigo-400 hover:text-indigo-600 text-xs font-semibold">↗</a>
                            </td>
                          </tr>
                        )
                      })
                    }
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
