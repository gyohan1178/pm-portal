import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { downloadSheet } from '../../lib/exportSheet'
import { useCanEdit, useMe } from '../../hooks/useProfile'

// 도면 배포이력대장 — 「외주품 도면 배포 관리 지침」(에드워드 오디트 6.1.2 대응)
//
//   ① 배포할 때마다 한 줄 남긴다. 누가 적었는지는 로그인 계정으로 자동 기록된다.
//   ② 협력사는 포털 거래처와 연결한다. 없으면 이 화면에서 바로 등록할 수 있다.
//   ③ 담당자(수신자)는 거래처마다 여러 명 둘 수 있다. 고르면 이메일이 따라온다.
//   ④ 팀장이 나중에 여러 건을 체크해 「전결 승인」한다 (사전승인·사후기록 모두).
//   ⑤ 설계변경 때는 도면번호로 기존 배포처를 한 번에 뽑아 폐기통보일을 적는다 (지침 5항).

const REASON = ['견적요청', '신규발주', '설계변경', '재발행', '검사/입고', '기타']
const FORM = ['PDF', 'CAD(dwg/dxf)', '3D(step/x_t)', '실물/샘플']
const APPROVAL = ['사후기록', '사전승인']
const DEPT = ['구매자재팀', '영업팀', '전장팀', '하네스팀', '품질팀']

// 지침 7항 — 배포 메일 본문 하단에 넣는 문구
const MAIL_NOTE = `[기밀 유지 안내]
본 도면은 진선테크 및 고객사의 기밀자료입니다. 제공 목적(견적 / 제작) 외의 사용, 복제, 제3자 제공을 금하며, 목적 완료 후 폐기하여 주시기 바랍니다. 도면의 최신 Rev는 당사 통보 기준을 따릅니다.`

const n = (v) => Number(v || 0).toLocaleString('ko-KR')

const fetchDist = () => fetchAll(() => supabase.from('pm_drawing_dist').select('*').order('seq', { ascending: false }))
const fetchVendors = () => fetchAll(() => supabase.from('vendors').select('id,name,contact,email').order('name'))
const fetchContacts = () => fetchAll(() => supabase.from('pm_vendor_contact').select('*').order('id'))

const EMPTY = {
  dist_date: todayISO(), dept: '구매자재팀', requester: '', reason: '견적요청',
  vendor_id: '', vendor_name: '', contact_id: '', contact_name: '', contact_email: '',
  drawing_no: '', item_name: '', issue_no: '', dist_form: 'PDF', approval_type: '사후기록', memo: '',
}

const Chip = ({ on, tone = 'slate', children, ...p }) => (
  <button {...p} className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${on
    ? { slate: 'border-slate-400 bg-slate-100 text-slate-700', rose: 'border-rose-300 bg-rose-50 text-rose-700', emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700' }[tone]
    : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}>{children}</button>
)

export default function DrawingDist() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const me = useMe()

  const [q, setQ] = useState('')
  const [only, setOnly] = useState('')          // '' | 대기 | 사전승인 | 미폐기통보
  const [form, setForm] = useState(null)        // 등록·수정 모달
  const [sel, setSel] = useState(new Set())     // 전결 승인 체크
  const [scrapFor, setScrapFor] = useState('')  // 폐기통보 — 도면번호
  const [newVendor, setNewVendor] = useState('')    // 즉석 거래처 등록
  const [newContact, setNewContact] = useState(null) // 즉석 담당자 등록

  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['drawDist'], queryFn: fetchDist })
  const { data: vendors = [] } = useQuery({ queryKey: ['vendorsAll'], queryFn: fetchVendors, staleTime: 5 * 60 * 1000 })
  const { data: contacts = [] } = useQuery({ queryKey: ['vendorContacts'], queryFn: fetchContacts })

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['drawDist'] })
    qc.invalidateQueries({ queryKey: ['vendorContacts'] })
    qc.invalidateQueries({ queryKey: ['vendorsAll'] })
  }

  const view = useMemo(() => {
    const k = q.trim().toUpperCase()
    return rows.filter((r) => {
      if (only === '대기' && r.status !== '대기') return false
      if (only === '사전승인' && r.approval_type !== '사전승인') return false
      if (only === '미폐기통보' && r.scrap_notified_at) return false
      if (!k) return true
      return [r.drawing_no, r.item_name, r.vendor_name, r.contact_name, r.memo, r.requester]
        .some((x) => String(x || '').toUpperCase().includes(k))
    })
  }, [rows, q, only])

  const waiting = rows.filter((r) => r.status === '대기')
  const contactsOf = (vid) => contacts.filter((c) => c.vendor_id === vid)
  // 같은 도면을 받아 간 곳 — 설계변경 때 폐기통보 대상
  const sameDrawing = useMemo(
    () => (scrapFor ? rows.filter((r) => r.drawing_no === scrapFor) : []), [rows, scrapFor])

  /* ---- 저장 ---- */
  async function save() {
    const f = form
    if (!f.vendor_name?.trim()) { toastError('협력사를 고르세요'); return }
    if (!f.drawing_no?.trim()) { toastError('도면번호를 적으세요'); return }
    const payload = {
      dist_date: f.dist_date, dept: f.dept, requester: f.requester || me?.name || null,
      reason: f.reason,
      vendor_id: f.vendor_id || null, vendor_name: f.vendor_name.trim(),
      contact_id: f.contact_id || null, contact_name: f.contact_name || null, contact_email: f.contact_email || null,
      drawing_no: f.drawing_no.trim().toUpperCase(), item_name: f.item_name || null,
      issue_no: f.issue_no || null, dist_form: f.dist_form, approval_type: f.approval_type,
      memo: f.memo || null, updated_at: new Date().toISOString(),
    }
    try {
      if (f.id) {
        must(await supabase.from('pm_drawing_dist').update(payload).eq('id', f.id), '배포이력 수정')
      } else {
        must(await supabase.from('pm_drawing_dist').insert({ ...payload, created_name: me?.name || null }), '배포이력 등록')
      }
      reload(); setForm(null); toastSuccess(f.id ? '고쳤습니다' : '대장에 남겼습니다')
    } catch (e) { toastError(e.message) }
  }

  async function del(id) {
    if (!window.confirm('이 줄을 지울까요? 대장은 증적이라 지우면 되돌릴 수 없습니다.')) return
    try {
      must(await supabase.from('pm_drawing_dist').delete().eq('id', id), '배포이력 삭제')
      reload(); toastSuccess('지웠습니다')
    } catch (e) { toastError(e.message) }
  }

  /* ---- 전결 승인 ---- */
  async function approve(ids, ok = true) {
    if (!ids.length) return
    try {
      must(await supabase.from('pm_drawing_dist').update({
        status: ok ? '승인' : '반려',
        approved_by: me?.id || null, approved_name: me?.name || null,
        approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).in('id', ids), '전결 승인')
      reload(); setSel(new Set()); toastSuccess(`${n(ids.length)}건 ${ok ? '승인' : '반려'}했습니다`)
    } catch (e) { toastError(e.message) }
  }

  /* ---- 폐기통보 (지침 5항) ---- */
  async function notifyScrap(ids) {
    if (!ids.length) return
    try {
      must(await supabase.from('pm_drawing_dist').update({
        scrap_notified_at: todayISO(),
        scrap_memo: `${todayISO()} 구버전 폐기 통보 (${me?.name || ''})`,
        updated_at: new Date().toISOString(),
      }).in('id', ids), '폐기통보 기재')
      reload(); toastSuccess(`${n(ids.length)}건에 폐기통보일을 적었습니다`)
    } catch (e) { toastError(e.message) }
  }

  /* ---- 거래처·담당자 즉석 등록 ---- */
  async function addVendor() {
    const name = newVendor.trim()
    if (!name) return
    try {
      const r = must(await supabase.from('vendors').insert({ name, category: '자재' }).select('id,name').single(), '거래처 등록')
      qc.invalidateQueries({ queryKey: ['vendorsAll'] })
      setForm((f) => ({ ...f, vendor_id: r.id, vendor_name: r.name, contact_id: '', contact_name: '', contact_email: '' }))
      setNewVendor(''); toastSuccess(`거래처 「${r.name}」 등록`)
    } catch (e) { toastError(e.message) }
  }
  async function addContact() {
    const c = newContact
    if (!c?.name?.trim()) { toastError('담당자 이름을 적으세요'); return }
    if (!form?.vendor_id) { toastError('먼저 거래처를 고르세요'); return }
    try {
      const r = must(await supabase.from('pm_vendor_contact').insert({
        vendor_id: form.vendor_id, name: c.name.trim(), email: c.email?.trim() || null, phone: c.phone?.trim() || null,
      }).select('*').single(), '담당자 등록')
      qc.invalidateQueries({ queryKey: ['vendorContacts'] })
      setForm((f) => ({ ...f, contact_id: r.id, contact_name: r.name, contact_email: r.email || '' }))
      setNewContact(null); toastSuccess(`담당자 「${r.name}」 등록`)
    } catch (e) { toastError(e.message) }
  }

  async function exportXlsx() {
    if (!view.length) { toastError('내보낼 줄이 없습니다'); return }
    try {
      await downloadSheet({
        title: '도면 배포이력대장', sheetName: '배포이력', fileName: `도면배포이력대장_${todayISO()}.xlsx`,
        meta: [['줄수', String(view.length)], ['작성', `${todayISO()} · 진선테크 구매자재팀`]],
        rows: view.map((r) => ({
          연번: r.seq, 배포일자: r.dist_date, 요청부서: r.dept, 요청자: r.requester || '',
          배포사유: r.reason, 협력사명: r.vendor_name, 수신자: r.contact_name || '', '수신 이메일': r.contact_email || '',
          도면번호: r.drawing_no, 품명: r.item_name || '', 'ISSUE NO': r.issue_no || '',
          배포형식: r.dist_form, 승인구분: r.approval_type, 상태: r.status,
          승인자: r.approved_name || '', 승인일: r.approved_at ? String(r.approved_at).slice(0, 10) : '',
          폐기통보일: r.scrap_notified_at || '', 작성자: r.created_name || '',
          비고: r.memo || '',
        })),
      })
    } catch (e) { toastError('엑셀 내보내기 실패: ' + e.message) }
  }

  const copyMailNote = async () => {
    try { await navigator.clipboard.writeText(MAIL_NOTE); toastSuccess('기밀 유지 문구를 복사했습니다') }
    catch { toastError('복사하지 못했습니다') }
  }

  const toggle = (id) => setSel((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">🧾 품질</p>
          <h1 className="text-xl font-extrabold text-slate-900">도면 배포이력대장</h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            외주 가공처·협력사에 도면을 보낼 때마다 한 줄 남깁니다. 누가 적었는지는 로그인 계정으로 자동 기록됩니다.
            설계변경 때는 도면번호로 기존 배포처를 뽑아 폐기통보를 남기세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyMailNote} title="배포 메일 본문 하단에 넣는 문구 (지침 7항)"
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">📋 기밀 문구</button>
          <button onClick={exportXlsx}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📑 엑셀</button>
          {canEdit && (
            <button onClick={() => { setForm({ ...EMPTY, requester: me?.name || '' }); setNewContact(null) }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">＋ 배포 기록</button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">대장을 못 불러왔습니다 — {error.message}</div>}

      {/* 지표 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          ['전체 배포', n(rows.length) + '건', `도면 ${n(new Set(rows.map((r) => r.drawing_no)).size)}종 · 협력사 ${n(new Set(rows.map((r) => r.vendor_name)).size)}곳`, ''],
          ['승인 대기', n(waiting.length) + '건', waiting.length ? '아래에서 체크해 전결 승인하세요' : '모두 처리됨', waiting.length ? 'warn' : ''],
          ['사전승인 대상', n(rows.filter((r) => r.approval_type === '사전승인').length) + '건', 'CAD 원본·신규 협력사·고객도면 제3자 제공', ''],
          ['거래처 연결 안 됨', n(rows.filter((r) => !r.vendor_id).length) + '건', '줄을 열어 거래처를 골라 주세요', rows.some((r) => !r.vendor_id) ? 'warn' : ''],
        ].map(([t, v, s, tone]) => (
          <div key={t} className={`rounded-xl border p-3 ${tone === 'warn' ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-white'}`}>
            <div className="text-[12px] font-semibold text-slate-400">{t}</div>
            <div className={`text-2xl font-extrabold tabular-nums ${tone === 'warn' ? 'text-rose-600' : 'text-slate-800'}`}>{v}</div>
            <div className="text-[10.5px] text-slate-400 leading-snug">{s}</div>
          </div>
        ))}
      </div>

      {/* 검색 · 전결 승인 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="도면번호 · 품명 · 협력사 · 수신자 · 비고"
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-72" />
        <Chip on={only === '대기'} tone="rose" onClick={() => setOnly(only === '대기' ? '' : '대기')}>승인 대기만</Chip>
        <Chip on={only === '사전승인'} onClick={() => setOnly(only === '사전승인' ? '' : '사전승인')}>사전승인 대상만</Chip>
        <Chip on={only === '미폐기통보'} onClick={() => setOnly(only === '미폐기통보' ? '' : '미폐기통보')}>폐기통보 안 한 것</Chip>
        <span className="text-xs text-slate-400">{n(view.length)}건</span>
        {canEdit && sel.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-bold text-indigo-600">{n(sel.size)}건 고름</span>
            <button onClick={() => approve([...sel], true)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">✅ 전결 승인</button>
            <button onClick={() => approve([...sel], false)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50">반려</button>
            <button onClick={() => setSel(new Set())} className="text-xs text-slate-400 underline">해제</button>
          </div>
        )}
      </div>

      {/* 대장 */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-400">
            <tr className="text-left">
              {canEdit && (
                <th className="px-2 py-2 w-8">
                  <input type="checkbox" checked={view.length > 0 && view.every((r) => sel.has(r.id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(view.map((r) => r.id)) : new Set())} />
                </th>
              )}
              <th className="px-2 py-2">연번</th>
              <th className="px-2 py-2">배포일자</th>
              <th className="px-2 py-2">협력사 / 수신자</th>
              <th className="px-2 py-2">도면번호 / 품명</th>
              <th className="px-2 py-2">Rev</th>
              <th className="px-2 py-2">형식</th>
              <th className="px-2 py-2">사유</th>
              <th className="px-2 py-2">승인</th>
              <th className="px-2 py-2">폐기통보</th>
              <th className="px-2 py-2">작성자</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={12} className="py-10 text-center text-slate-400">불러오는 중…</td></tr>}
            {!isLoading && !view.length && <tr><td colSpan={12} className="py-10 text-center text-slate-400">해당하는 줄이 없습니다.</td></tr>}
            {view.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                {canEdit && <td className="px-2 py-2"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td className="px-2 py-2 tabular-nums text-slate-400">{r.seq}</td>
                <td className="px-2 py-2 tabular-nums text-slate-600">{r.dist_date}</td>
                <td className="px-2 py-2">
                  <span className="font-semibold text-slate-700">{r.vendor_name}</span>
                  {!r.vendor_id && <span className="ml-1 text-[10px] text-rose-500">미연결</span>}
                  <div className="text-[10.5px] text-slate-400">{r.contact_name || '-'} {r.contact_email ? `· ${r.contact_email}` : ''}</div>
                </td>
                <td className="px-2 py-2">
                  <button onClick={() => setScrapFor(r.drawing_no)} title="이 도면을 받아 간 곳 전체 보기"
                    className="font-mono text-indigo-600 hover:underline">{r.drawing_no}</button>
                  <div className="text-[10.5px] text-slate-400 truncate max-w-[200px]">{r.item_name || '-'}</div>
                </td>
                <td className="px-2 py-2 text-slate-500">{r.issue_no || '-'}</td>
                <td className="px-2 py-2 text-slate-500">{r.dist_form}</td>
                <td className="px-2 py-2 text-slate-500">{r.reason}</td>
                <td className="px-2 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.status === '승인' ? 'bg-emerald-50 text-emerald-600'
                    : r.status === '반려' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                  <div className="text-[10px] text-slate-400">
                    {r.approval_type}{r.approved_name ? ` · ${r.approved_name}` : ''}
                  </div>
                </td>
                <td className="px-2 py-2 tabular-nums text-slate-500">{r.scrap_notified_at || '-'}</td>
                <td className="px-2 py-2 text-slate-500">{r.created_name || '-'}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {canEdit && (
                    <>
                      <button onClick={() => { setForm({ ...r }); setNewContact(null) }} className="text-[11px] text-slate-400 hover:text-indigo-600">수정</button>
                      <button onClick={() => del(r.id)} className="ml-2 text-[11px] text-slate-300 hover:text-rose-600">✕</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 도면별 배포처 — 설계변경 폐기통보 (지침 5항) */}
      {scrapFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setScrapFor('')}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-3xl max-h-[85vh] overflow-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">📐 {scrapFor} — 이 도면을 받아 간 곳</h3>
              <p className="text-[12px] text-slate-400 mt-0.5">
                설계변경(ECO/CN)이 나면 여기 있는 곳 전체에 구버전 폐기 요청 메일을 보내고, 아래 버튼으로 폐기통보일을 적습니다.
                재배포 건은 새 줄로 추가하세요.
              </p>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-left border-b border-slate-200">
                <th className="py-1">배포일</th><th className="py-1">협력사 / 수신자</th><th className="py-1">Rev</th>
                <th className="py-1">형식</th><th className="py-1">폐기통보일</th>
              </tr></thead>
              <tbody>
                {sameDrawing.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-1.5 tabular-nums text-slate-500">{r.dist_date}</td>
                    <td className="py-1.5">
                      <b className="text-slate-700">{r.vendor_name}</b>
                      <div className="text-[10.5px] text-slate-400">{r.contact_name} {r.contact_email ? `· ${r.contact_email}` : ''}</div>
                    </td>
                    <td className="py-1.5 text-slate-500">{r.issue_no || '-'}</td>
                    <td className="py-1.5 text-slate-500">{r.dist_form}</td>
                    <td className={`py-1.5 tabular-nums ${r.scrap_notified_at ? 'text-slate-500' : 'text-rose-500'}`}>
                      {r.scrap_notified_at || '아직'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-400">
              수신 이메일 {sameDrawing.filter((r) => r.contact_email).length}곳 —{' '}
              <button className="text-indigo-500 font-bold underline decoration-dotted"
                onClick={async () => {
                  const list = [...new Set(sameDrawing.map((r) => r.contact_email).filter(Boolean))].join('; ')
                  try { await navigator.clipboard.writeText(list); toastSuccess('수신 이메일을 복사했습니다') } catch { toastError('복사하지 못했습니다') }
                }}>이메일 한꺼번에 복사</button>
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setScrapFor('')} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">닫기</button>
              {canEdit && (
                <button onClick={() => notifyScrap(sameDrawing.filter((r) => !r.scrap_notified_at).map((r) => r.id))}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">오늘 날짜로 폐기통보 기재</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 등록·수정 */}
      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-2xl max-h-[88vh] overflow-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900">{form.id ? '배포이력 수정' : '배포 기록 남기기'}</h3>

            <div className="grid grid-cols-3 gap-3">
              <L t="배포일자"><input type="date" value={form.dist_date || ''} onChange={(e) => setForm({ ...form, dist_date: e.target.value })} className={INP} /></L>
              <L t="요청부서"><select value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} className={INP}>{DEPT.map((d) => <option key={d}>{d}</option>)}</select></L>
              <L t="요청자"><input value={form.requester || ''} onChange={(e) => setForm({ ...form, requester: e.target.value })} placeholder="황주현" className={INP} /></L>
            </div>

            {/* 협력사 */}
            <L t="협력사">
              <div className="flex gap-2">
                <select value={form.vendor_id || ''}
                  onChange={(e) => {
                    const v = vendors.find((x) => x.id === e.target.value)
                    setForm({ ...form, vendor_id: v?.id || '', vendor_name: v?.name || '', contact_id: '', contact_name: '', contact_email: '' })
                  }} className={INP + ' flex-1'}>
                  <option value="">— 고르세요 —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                {form.vendor_name && !form.vendor_id && (
                  <span className="text-[11px] text-rose-500 self-center whitespace-nowrap">{form.vendor_name} (미연결)</span>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-2 mt-1.5">
                  <input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="목록에 없으면 여기에 새 거래처 이름"
                    className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                  <button onClick={addVendor} disabled={!newVendor.trim()}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40">＋ 거래처 등록</button>
                </div>
              )}
            </L>

            {/* 수신자 */}
            <L t="수신자">
              <select value={form.contact_id || ''}
                onChange={(e) => {
                  const c = contacts.find((x) => x.id === e.target.value)
                  setForm({ ...form, contact_id: c?.id || '', contact_name: c?.name || '', contact_email: c?.email || '' })
                }} className={INP} disabled={!form.vendor_id}>
                <option value="">{form.vendor_id ? '— 고르세요 —' : '거래처를 먼저 고르세요'}</option>
                {contactsOf(form.vendor_id).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <input value={form.contact_name || ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value, contact_id: '' })}
                  placeholder="수신자 이름" className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <input value={form.contact_email || ''} onChange={(e) => setForm({ ...form, contact_email: e.target.value, contact_id: '' })}
                  placeholder="수신 이메일" className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
              </div>
              {canEdit && form.vendor_id && (
                newContact ? (
                  <div className="flex gap-2 mt-1.5">
                    <input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} placeholder="이름"
                      className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    <input value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} placeholder="이메일"
                      className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    <button onClick={addContact} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">저장</button>
                    <button onClick={() => setNewContact(null)} className="text-xs text-slate-400">취소</button>
                  </div>
                ) : (
                  <button onClick={() => setNewContact({ name: form.contact_name || '', email: form.contact_email || '', phone: '' })}
                    className="mt-1.5 text-[11px] text-indigo-500 font-bold underline decoration-dotted">＋ 이 거래처 담당자로 등록해 두기</button>
                )
              )}
            </L>

            <div className="grid grid-cols-3 gap-3">
              <L t="도면번호"><input value={form.drawing_no || ''} onChange={(e) => setForm({ ...form, drawing_no: e.target.value })} placeholder="NRYBVU400" className={INP + ' font-mono'} /></L>
              <L t="품명"><input value={form.item_name || ''} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className={INP} /></L>
              <L t="ISSUE NO (Rev)"><input value={form.issue_no || ''} onChange={(e) => setForm({ ...form, issue_no: e.target.value })} placeholder="A" className={INP} /></L>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <L t="배포사유"><select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={INP}>{REASON.map((x) => <option key={x}>{x}</option>)}</select></L>
              <L t="배포형식"><select value={form.dist_form} onChange={(e) => setForm({ ...form, dist_form: e.target.value })} className={INP}>{FORM.map((x) => <option key={x}>{x}</option>)}</select></L>
              <L t="승인구분"><select value={form.approval_type} onChange={(e) => setForm({ ...form, approval_type: e.target.value })} className={INP}>{APPROVAL.map((x) => <option key={x}>{x}</option>)}</select></L>
            </div>

            {form.dist_form !== 'PDF' && form.approval_type !== '사전승인' && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                ⚠ 지침 3항 — CAD 원본·3D 파일 제공은 <b>사전승인 대상</b>입니다. 승인구분을 「사전승인」으로 두고 사유를 비고에 적어 주세요.
              </p>
            )}

            <L t="비고 (메일 제목 등)">
              <input value={form.memo || ''} onChange={(e) => setForm({ ...form, memo: e.target.value })}
                placeholder="[진선테크] 견적 요청의 件 (HALO Project)" className={INP} />
            </L>

            <p className="text-[11px] text-slate-400">
              작성자 <b className="text-slate-500">{me?.name || '(로그인 계정)'}</b> 로 기록됩니다.
              승인은 팀장이 대장에서 체크해 전결로 처리합니다.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">취소</button>
              <button onClick={save} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">저장</button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        지침 3항 — 사전승인 대상: ①신규 협력사 최초 배포 ②CAD 원본·3D 제공 ③고객 도면을 제3자에게 제공.
        그 밖의 기존 거래처·기존 품목 PDF 재배포는 사후기록 대상입니다. 보존 2년.
      </p>
    </div>
  )
}

const INP = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg'
const L = ({ t, children }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-400 mb-1">{t}</label>
    {children}
  </div>
)
