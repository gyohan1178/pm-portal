import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import {
  parseCodeWorkbook, mergeDetail, summarizeCodes, CS_PREFIX,
} from '../../lib/codeMap'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// ecount 품목관계리스트를 올려 기준코드(JS) ↔ 고객사코드 매핑을 적재한다.
// 적재 후 items 등록·고객사 코드 연결까지 단계별로 진행할 수 있다.
export default function CodeMapUpload() {
  const qc = useQueryClient()
  const [rel, setRel] = useState(null)      // 품목관계리스트 파싱 결과
  const [detail, setDetail] = useState(null) // 품목등록 상세
  const [files, setFiles] = useState({ rel: '', mst: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)

  // 현재 DB 상태
  const { data: status } = useQuery({
    queryKey: ['codeMapStatus'],
    queryFn: async () => {
      const [{ count: mapCount }, { count: itemCount }, { count: jsCount }] = await Promise.all([
        supabase.from('pm_code_map').select('*', { count: 'exact', head: true }),
        supabase.from('items').select('*', { count: 'exact', head: true }),
        supabase.from('items').select('*', { count: 'exact', head: true }).not('js_code', 'is', null),
      ])
      return { mapCount: mapCount || 0, itemCount: itemCount || 0, jsCount: jsCount || 0 }
    },
    staleTime: 10 * 1000,
  })

  const merged = useMemo(() => {
    if (!rel?.rows) return null
    const { rows, filled } = mergeDetail(rel.rows, detail)
    return { rows, filled, sum: summarizeCodes(rows) }
  }, [rel, detail])

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setErr(''); setResult(''); setBusy('read')
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const p = parseCodeWorkbook(wb, XLSX)
      if (p.kind === 'relation') {
        setRel(p); setFiles((v) => ({ ...v, rel: f.name }))
      } else if (p.kind === 'master') {
        setDetail(p.detail); setFiles((v) => ({ ...v, mst: f.name }))
      } else {
        throw new Error("'대표품목코드' 또는 '품목코드' 헤더가 있는 시트를 찾지 못했습니다.")
      }
    } catch (e2) {
      setErr(e2.message)
    } finally { setBusy(''); e.target.value = '' }
  }

  // STEP 1 — 매핑 적재
  async function saveMap() {
    if (!merged?.rows.length) return
    setBusy('map'); setErr(''); setProgress('')
    try {
      const rows = merged.rows
      const CH = 500
      for (let i = 0; i < rows.length; i += CH) {
        setProgress(`${Math.min(i + CH, rows.length)} / ${rows.length}`)
        const { error } = await supabase.from('pm_code_map')
          .upsert(rows.slice(i, i + CH), { onConflict: 'customer_code' })
        if (error) throw error
      }
      toastSuccess(`매핑 ${rows.length}건 적재 완료`)
      qc.invalidateQueries({ queryKey: ['codeMapStatus'] })
      setResult({ step: 'map', count: rows.length })
    } catch (e) {
      setErr(e.message); toastError('적재 실패: ' + e.message)
    } finally { setBusy(''); setProgress('') }
  }

  // STEP 2 — items 에 기준코드 채우기 (비어 있는 것만)
  async function fillJsCode() {
    setBusy('js'); setErr('')
    try {
      const { data, error } = await supabase.rpc('pm_fill_js_code')
      if (error) throw error
      toastSuccess(`기준코드 ${data ?? 0}건 채움`)
      qc.invalidateQueries({ queryKey: ['codeMapStatus'] })
      setResult({ step: 'js', count: data ?? 0 })
    } catch (e) {
      setErr(e.message); toastError('실패: ' + e.message)
    } finally { setBusy('') }
  }

  // STEP 3 — 미등록 품목 등록 (ED/CSK/VM)
  async function createItems() {
    if (!confirm('매핑에는 있고 품목에는 없는 것을 모두 등록합니다.\n계속할까요?')) return
    setBusy('items'); setErr('')
    try {
      const { data, error } = await supabase.rpc('pm_create_items_from_map')
      if (error) throw error
      toastSuccess(`품목 ${data ?? 0}건 등록`)
      qc.invalidateQueries({ queryKey: ['codeMapStatus'] })
      setResult({ step: 'items', count: data ?? 0 })
    } catch (e) {
      setErr(e.message); toastError('실패: ' + e.message)
    } finally { setBusy('') }
  }

  // STEP 4 — 고객사 코드 연결
  async function linkCodes() {
    setBusy('link'); setErr('')
    try {
      const { data, error } = await supabase.rpc('pm_link_customer_codes')
      if (error) throw error
      toastSuccess(`고객사 코드 ${data ?? 0}건 연결`)
      qc.invalidateQueries({ queryKey: ['codeMapStatus'] })
      setResult({ step: 'link', count: data ?? 0 })
    } catch (e) {
      setErr(e.message); toastError('실패: ' + e.message)
    } finally { setBusy('') }
  }

  const sum = merged?.sum

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🔢 기준코드 매핑</h1>
        <p className="text-xs text-slate-400">
          ecount <b>품목관계리스트</b>를 올려 기준코드(JS) ↔ 고객사코드 매핑을 갱신합니다.
          <b>품목등록</b> 파일을 함께 올리면 품명·규격이 보강됩니다.
        </p>
      </div>

      {/* 현재 상태 */}
      {status && (
        <div className="grid grid-cols-3 gap-3">
          {[
            ['매핑', status.mapCount, 'text-indigo-600'],
            ['품목', status.itemCount, 'text-slate-700'],
            ['기준코드 있음', status.jsCount, status.jsCount < status.itemCount ? 'text-amber-600' : 'text-emerald-600'],
          ].map(([label, v, cls]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className={`text-xl font-bold ${cls}`}>{n(v)}</p>
            </div>
          ))}
        </div>
      )}

      {/* 업로드 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <label className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg
          border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer ${busy ? 'opacity-50' : ''}`}>
          📤 {busy === 'read' ? '읽는 중…' : '엑셀 업로드'}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={!!busy} />
        </label>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className={files.rel ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
            {files.rel ? `✓ 품목관계리스트 — ${files.rel}` : '· 품목관계리스트 (필수)'}
          </span>
          <span className={files.mst ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
            {files.mst ? `✓ 품목등록 — ${files.mst}` : '· 품목등록 (선택 · 품명·규격 보강)'}
          </span>
        </div>
        <p className="text-[11px] text-slate-400">
          파일 종류는 자동으로 판별합니다. 두 개를 각각 한 번씩 올리세요.
        </p>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}

      {/* 미리보기 */}
      {sum && (
        <div className="bg-white rounded-xl border border-indigo-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="text-sm font-bold text-slate-800">{n(sum.total)}건</span>
            <span>고유 기준코드 <b>{n(sum.jsCount)}</b></span>
            {merged.filled > 0 && <span className="text-emerald-700">품명·규격 보강 {n(merged.filled)}</span>}
            {rel.skipped?.length > 0 && (
              <span className="text-amber-600" title={rel.skipped.map((s) => `${s.js} — ${s.why}`).join('\n')}>
                제외 {rel.skipped.length}건
              </span>
            )}
            {sum.noPrefix > 0 && <span className="text-rose-600">접두 미분류 {sum.noPrefix}</span>}
          </div>

          {/* 고객사별 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(sum.byPrefix).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-2">
                <div className="text-[11px] font-bold text-slate-500">
                  {k} {CS_PREFIX[k] && <span className="text-slate-300">→ {CS_PREFIX[k]}</span>}
                </div>
                <div className="text-sm font-bold text-slate-800">{n(v)}</div>
              </div>
            ))}
          </div>

          {/* 분류별 다음 채번 */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">분류별 다음 채번</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(sum.byCategory).sort().map(([k, v]) => (
                <span key={k} className="px-2 py-1 rounded bg-slate-100 text-[11px]">
                  <b className="font-mono text-indigo-600">JS-{k}{String(v.max + 1).padStart(4, '0')}</b>
                  <span className="text-slate-400 ml-1">({n(v.count)})</span>
                </span>
              ))}
            </div>
          </div>

          <button onClick={saveMap} disabled={!!busy}
            className="px-5 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy === 'map' ? `적재 중… ${progress}` : `💾 매핑 ${n(sum.total)}건 적재`}
          </button>
        </div>
      )}

      {/* 후속 단계 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-700 mb-1">적재 후 반영</p>
        <p className="text-[11px] text-slate-400 mb-3">
          위에서 매핑을 적재한 뒤 순서대로 실행하세요. 각 단계는 여러 번 눌러도 안전합니다(이미 반영된 건 건너뜁니다).
        </p>
        <div className="space-y-2">
          {[
            ['js', '① 품목에 기준코드 채우기', '고객사코드가 일치하는 품목의 빈 기준코드를 채웁니다', fillJsCode],
            ['items', '② 미등록 품목 등록', '매핑에는 있고 품목에는 없는 것(Edwards·CSK·VM)을 등록합니다', createItems],
            ['link', '③ 고객사 코드 연결', "품목 화면의 '+코드' 목록에 매핑을 반영합니다", linkCodes],
          ].map(([key, title, desc, fn]) => (
            <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex-1">
                <p className="text-xs font-bold text-slate-700">{title}</p>
                <p className="text-[11px] text-slate-400">{desc}</p>
              </div>
              <button onClick={fn} disabled={!!busy}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 whitespace-nowrap">
                {busy === key ? '처리 중…' : '실행'}
              </button>
            </div>
          ))}
        </div>
        {result && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 font-semibold">
            ✅ {result.step === 'map' ? '매핑 적재' : result.step === 'js' ? '기준코드 채움'
              : result.step === 'items' ? '품목 등록' : '고객사 코드 연결'} — {n(result.count)}건
          </div>
        )}
      </div>
    </div>
  )
}
