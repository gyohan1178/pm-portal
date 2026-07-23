import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { useCustomer } from '../../hooks/useCustomers'

// ── 품번 정규화: 접두 AX- 자동 처리 ──
const AX = (s) => {
  const t = String(s ?? '').trim().replace(/^AX-/i, '').replace(/\.0$/, '')
  return t ? 'AX-' + t : ''
}

// ── 도면 조회 대상 품번: 11(조립도) 12(모듈) 16(하네스) 17(가공물), 8자리 이상 ──
// 볼트(44*)·부품(5*)·벤더 파트번호를 걸러 "도면 없음" 노이즈를 제거한다.
const isTarget = (code) => {
  const d = String(code || '').replace(/^AX-/, '')
  return d.length >= 8 && ['11', '12', '16', '17'].includes(d.slice(0, 2))
}

const fmtRev = (rev, ed) => `${rev}_${String(ed ?? 0).padStart(2, '0')}`
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '-')

// 파일 용량 (재스캔 전 기존 행은 null → '-')
const fmtSize = (b) => {
  if (b == null) return '-'
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
  return Math.max(1, Math.round(b / 1024)) + ' KB'
}

// ── BOM 전 레벨 전개 ────────────────────────────────
// projects(어셈블리) 1건 = bom 직계 자식들 구조.
// 하위 품번이 다시 projects.code 로 존재하면 그 아래로 계속 내려간다.
// 순환 참조·중복은 seen 으로 차단.
async function expandBOM(customerId, rootCode, maxDepth = 10) {
  const seen = new Map([[rootCode, { level: 0, name: '' }]])
  let frontier = [rootCode]

  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    // 1) 이번 단계 품번들 중 어셈블리인 것 찾기
    const projs = []
    for (let i = 0; i < frontier.length; i += 200) {
      const { data } = await supabase
        .from('projects')
        .select('id, code, name')
        .eq('customer_id', customerId)
        .in('code', frontier.slice(i, i + 200))
      projs.push(...(data || []))
    }
    if (!projs.length) break

    // 어셈블리 이름 보강
    projs.forEach((p) => {
      const cur = seen.get(p.code)
      if (cur && !cur.name) cur.name = p.name || ''
    })

    // 2) 그 어셈블리들의 BOM 하위 품목
    const ids = projs.map((p) => p.id)
    const rows = []
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const part = await fetchAll(() =>
        supabase
          .from('bom')
          .select('project_id, qty_per_unit, level, seq, items!bom_item_id_fkey(std_code, name)')
          .in('project_id', chunk)
          .order('seq'))
      rows.push(...part)
    }

    // 3) 다음 단계 후보
    const next = []
    for (const r of rows) {
      const code = r.items?.std_code
      if (!code || seen.has(code)) continue
      seen.set(code, { level: depth, name: r.items?.name || '' })
      next.push(code)
    }
    frontier = next
  }
  return seen
}

// ── 도면 조회 ───────────────────────────────────────
async function fetchDrawings(codes) {
  if (!codes.length) return []
  const out = []
  for (let i = 0; i < codes.length; i += 150) {
    const chunk = codes.slice(i, i + 150)
    const part = await fetchAll(() =>
      supabase
        .from('pm_drawings')
        .select('std_code, rev, edition, rev_order, file_name, file_path, file_mtime, is_latest, missing_since, category, naming_ok, is_conv, file_size')
        .in('std_code', chunk)
        .order('rev_order', { ascending: false }))
    out.push(...part)
  }
  return out
}

// ── 검색 실행 ───────────────────────────────────────
async function runSearch(customerId, rawCode) {
  const root = AX(rawCode)
  if (!root) return null

  const seen = await expandBOM(customerId, root)
  const codes = [...seen.keys()]

  // 품명 보강 (BOM 에서 못 얻은 것 = 최상위 자신 등)
  const missingName = codes.filter((c) => !seen.get(c).name)
  for (let i = 0; i < missingName.length; i += 200) {
    const { data } = await supabase
      .from('items')
      .select('std_code, name')
      .in('std_code', missingName.slice(i, i + 200))
    ;(data || []).forEach((it) => {
      const cur = seen.get(it.std_code)
      if (cur) cur.name = it.name || ''
    })
  }

  const drawings = await fetchDrawings(codes)

  // 품번별 묶기
  const byCode = {}
  for (const d of drawings) (byCode[d.std_code] ||= []).push(d)

  const rows = codes.map((code) => {
    const files = (byCode[code] || []).slice().sort((a, b) => b.rev_order - a.rev_order)
    const live = files.filter((f) => !f.missing_since)

    // 최신 REV 파일들 중 대표 1건 — 현장이 실제로 쓰는 컨버팅 도면을 우선한다.
    // (같은 REV 로 원본·컨버팅이 공존하는 품번이 151개 있어 기준이 없으면 결과가 들쭉날쭉함)
    const topOrder = live.length ? Math.max(...live.map((f) => f.rev_order)) : null
    const latestFiles = topOrder == null ? [] : live.filter((f) => f.rev_order === topOrder)
    const top = latestFiles.find((f) => f.is_conv) || latestFiles[0] || null

    // 컨버팅 지연: 컨버팅 도면은 있는데 원본보다 REV 가 낮음 → 컨버팅 갱신 필요
    const convOrders = live.filter((f) => f.is_conv).map((f) => f.rev_order)
    const origOrders = live.filter((f) => !f.is_conv).map((f) => f.rev_order)
    const convMax = convOrders.length ? Math.max(...convOrders) : null
    const origMax = origOrders.length ? Math.max(...origOrders) : null
    const convLag = convMax != null && origMax != null && origMax > convMax
    const convRev = convMax == null ? null : live.find((f) => f.is_conv && f.rev_order === convMax)
    const origRev = origMax == null ? null : live.find((f) => !f.is_conv && f.rev_order === origMax)
    return {
      code,
      name: seen.get(code)?.name || '',
      level: seen.get(code)?.level ?? 0,
      files,
      latest: top,
      latestFiles,
      missingCount: files.filter((f) => f.missing_since).length,
      badNaming: files.some((f) => !f.naming_ok),
      convLag, convRev, origRev,
      hasConv: convMax != null,
    }
  })

  return { root, rows }
}

// ── 경로 복사 ───────────────────────────────────────
async function copyText(text, onDone) {
  try {
    await navigator.clipboard.writeText(text)
    onDone?.('복사됨')
  } catch {
    // 클립보드 API 차단 환경 대비
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); onDone?.('복사됨') }
    catch { onDone?.('복사 실패') }
    document.body.removeChild(ta)
  }
}

export default function DrawingSearch() {
  const { data: cs } = useCustomer('ax')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [onlyTarget, setOnlyTarget] = useState(true)
  const [onlyMissingDrawing, setOnlyMissingDrawing] = useState(false)
  const [onlyConvLag, setOnlyConvLag] = useState(false)
  const [open, setOpen] = useState({})
  const [toast, setToast] = useState('')

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 1500) }

  // 소실 파일 배너 (전체 기준)
  const { data: missingAll } = useQuery({
    queryKey: ['drawingsMissing'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pm_drawings')
        .select('std_code, file_name, missing_since')
        .not('missing_since', 'is', null)
        .order('missing_since', { ascending: false })
        .limit(50)
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })

  // 마지막 스캔 시각
  const { data: lastScan } = useQuery({
    queryKey: ['drawingsLastScan'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pm_drawings')
        .select('scanned_at')
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data?.scanned_at || null
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data, isFetching, error } = useQuery({
    queryKey: ['drawingSearch', cs?.id, query],
    enabled: !!cs?.id && !!query,
    queryFn: () => runSearch(cs.id, query),
    staleTime: 60 * 1000,
  })

  const rows = useMemo(() => {
    let r = data?.rows || []
    if (onlyTarget) r = r.filter((x) => x.level === 0 || isTarget(x.code))
    if (onlyMissingDrawing) r = r.filter((x) => !x.latest)
    if (onlyConvLag) r = r.filter((x) => x.convLag)
    return r.slice().sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))
  }, [data, onlyTarget, onlyMissingDrawing, onlyConvLag])

  const stat = useMemo(() => {
    const all = data?.rows || []
    const t = all.filter((x) => x.level === 0 || isTarget(x.code))
    return {
      total: t.length,
      has: t.filter((x) => x.latest).length,
      none: t.filter((x) => !x.latest).length,
      lag: t.filter((x) => x.convLag).length,
    }
  }, [data])

  const submit = (e) => {
    e?.preventDefault()
    setQuery(input.trim())
    setOpen({})
  }

  const copyAllPaths = () => {
    const lines = rows
      .filter((r) => r.latest)
      .map((r) => `${r.code}\t${fmtRev(r.latest.rev, r.latest.edition)}\t${r.latest.file_path}`)
    if (!lines.length) return say('복사할 경로가 없습니다')
    copyText(lines.join('\r\n'), say)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">📐 도면 조회</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            NAS 도면의 최신 REV를 조회합니다. 파일은 이동·수정하지 않고 읽기만 합니다.
          </p>
        </div>
        {lastScan && (
          <div className="text-xs text-slate-500">
            마지막 스캔 <span className="font-semibold text-slate-700">{new Date(lastScan).toLocaleString('ko-KR')}</span>
          </div>
        )}
      </div>

      {/* 소실 배너 */}
      {!!missingAll?.length && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-800">
            ⚠ NAS 에서 사라진 도면 {missingAll.length}건{missingAll.length >= 50 ? '+' : ''}
          </p>
          <p className="text-xs text-amber-700 mt-1">
            최근: {missingAll.slice(0, 5).map((m) => m.file_name).join(', ')}
            {missingAll.length > 5 && ` 외 ${missingAll.length - 5}건`}
          </p>
        </div>
      )}

      {/* 검색 */}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="품번 입력 (예: 110029610 또는 AX-110029610)"
          className="flex-1 min-w-[240px] px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          disabled={!cs?.id}
        >
          조회
        </button>
        {!!rows.length && (
          <button
            type="button"
            onClick={copyAllPaths}
            className="px-3 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            전체 경로 복사
          </button>
        )}
      </form>

      {/* 필터 */}
      {!!data && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyTarget} onChange={(e) => setOnlyTarget(e.target.checked)} />
            도면 대상 품번만 (11·12·16·17)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyMissingDrawing} onChange={(e) => setOnlyMissingDrawing(e.target.checked)} />
            도면 없는 것만
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer" title="컨버팅 도면이 고객사 원본보다 REV가 낮음 = 컨버팅 갱신 필요">
            <input type="checkbox" checked={onlyConvLag} onChange={(e) => setOnlyConvLag(e.target.checked)} />
            ⚠ 컨버팅 갱신 필요 {stat.lag > 0 && `(${stat.lag})`}
          </label>
          <span className="ml-auto">
            대상 <b className="text-slate-800">{stat.total}</b> · 도면있음{' '}
            <b className="text-emerald-600">{stat.has}</b> · 없음 <b className="text-rose-600">{stat.none}</b>
          </span>
        </div>
      )}

      {isFetching && <p className="text-sm text-slate-500">조회 중...</p>}
      {error && <p className="text-sm text-rose-600">조회 실패: {error.message}</p>}

      {/* 결과 */}
      {!!rows.length && (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left w-14">LV</th>
                <th className="px-3 py-2 text-left">품번</th>
                <th className="px-3 py-2 text-left">품명</th>
                <th className="px-3 py-2 text-center w-20">구분</th>
                <th className="px-3 py-2 text-center w-24">최신 REV</th>
                <th className="px-3 py-2 text-center w-28">수정일</th>
                <th className="px-3 py-2 text-center w-16">파일</th>
                <th className="px-3 py-2 text-center w-24">경로</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FragmentRow
                  key={r.code}
                  r={r}
                  isOpen={!!open[r.code]}
                  onToggle={() => setOpen((o) => ({ ...o, [r.code]: !o[r.code] }))}
                  onCopy={(t) => copyText(t, say)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!data && !rows.length && !isFetching && (
        <p className="text-sm text-slate-500">해당 조건의 품번이 없습니다.</p>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-800 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── 행 (본문 + 펼침 상세) ───────────────────────────
function FragmentRow({ r, isOpen, onToggle, onCopy }) {
  const lv = r.level
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-t border-slate-100 cursor-pointer hover:bg-indigo-50/40 ${
          lv === 0 ? 'bg-indigo-50/60 font-semibold' : lv >= 3 ? 'bg-slate-50/60' : ''
        }`}
      >
        <td className="px-3 py-2 text-slate-400 text-xs">{lv === 0 ? 'LV0' : `L${lv}`}</td>
        <td className="px-3 py-2 font-mono text-xs text-slate-700" style={{ paddingLeft: 12 + lv * 12 }}>
          {r.code}
          {r.badNaming && <span className="ml-1 text-amber-500" title="Conversion 폴더 명명규칙 위반">⚠</span>}
          {r.convLag && (
            <span className="ml-1 text-orange-600 font-bold"
              title={`컨버팅 갱신 필요 — 원본 ${r.origRev?.rev}_${String(r.origRev?.edition ?? 0).padStart(2,'0')} / 컨버팅 ${r.convRev?.rev}_${String(r.convRev?.edition ?? 0).padStart(2,'0')}`}>
              ⚠컨버팅
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-slate-600 max-w-[280px] truncate">{r.name || '-'}</td>
        <td className="px-3 py-2 text-center">
          {r.latest ? (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
              r.latest.is_conv
                ? 'bg-sky-50 text-sky-700 border-sky-200'
                : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
              {r.latest.is_conv ? '컨버팅' : '원본'}
            </span>
          ) : <span className="text-slate-300">-</span>}
        </td>
        <td className="px-3 py-2 text-center">
          {r.latest ? (
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono text-xs font-bold">
              {fmtRev(r.latest.rev, r.latest.edition)}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-600 text-xs font-bold">없음</span>
          )}
        </td>
        <td className="px-3 py-2 text-center text-xs text-slate-500">
          {r.latest ? fmtDate(r.latest.file_mtime) : '-'}
        </td>
        <td className="px-3 py-2 text-center text-xs text-slate-500" title={r.latest ? `대표 파일 ${fmtSize(r.latest.file_size)}` : ''}>
          {r.files.length || '-'}
          {r.latestFiles.length > 1 && (
            <span className="ml-1 text-amber-600" title={`최신 REV 가 ${r.latestFiles.length}곳에 복사되어 있음`}>
              ×{r.latestFiles.length}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-center">
          {r.latest && (
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(r.latest.file_path) }}
              className="px-2 py-1 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50"
            >
              복사
            </button>
          )}
        </td>
      </tr>

      {isOpen && !!r.files.length && (
        <tr className="bg-slate-50/80">
          <td colSpan={8} className="px-4 py-3">
            <p className="text-xs font-bold text-slate-500 mb-2">REV 이력 · 파일 {r.files.length}건</p>
            {r.convLag && (
              <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1.5 mb-2">
                ⚠ 컨버팅 갱신 필요 — 고객사 원본은 <b>{r.origRev?.rev}_{String(r.origRev?.edition ?? 0).padStart(2,'0')}</b> 인데
                컨버팅 도면은 <b>{r.convRev?.rev}_{String(r.convRev?.edition ?? 0).padStart(2,'0')}</b> 에 머물러 있습니다.
              </p>
            )}
            <div className="space-y-1">
              {r.files.map((f) => (
                <div key={f.file_path} className="flex items-center gap-2 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono font-bold ${
                      f.missing_since
                        ? 'bg-slate-200 text-slate-400 line-through'
                        : f.is_latest
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {fmtRev(f.rev, f.edition)}
                  </span>
                  <span className={`px-1 py-0.5 rounded text-[10px] font-bold shrink-0 w-12 text-center ${
                    f.is_conv ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-500'}`}>
                    {f.is_conv ? '컨버팅' : '원본'}
                  </span>
                  <span className="text-slate-400 w-20 shrink-0">{fmtDate(f.file_mtime)}</span>
                  <span className="text-slate-400 w-16 shrink-0 text-right tabular-nums">{fmtSize(f.file_size)}</span>
                  <span className={`flex-1 truncate ${f.missing_since ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                    {f.file_name}
                  </span>
                  {!f.naming_ok && <span className="text-amber-500 shrink-0" title="명명규칙 위반">⚠</span>}
                  {f.missing_since && <span className="text-rose-500 shrink-0">소실</span>}
                  <button
                    onClick={() => onCopy(f.file_path)}
                    className="px-2 py-0.5 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50 shrink-0"
                  >
                    경로
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              경로를 복사한 뒤 탐색기 주소창에 붙여넣으면 열립니다. (브라우저는 보안상 NAS 경로를 직접 열 수 없습니다)
            </p>
          </td>
        </tr>
      )}
    </>
  )
}
