import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'

// 🗄 데이터 백업 — Supabase 무료플랜용. 주요 테이블을 엑셀(시트별)로 원클릭 다운로드.
// 주 1회 클릭 → 파일을 회사 NAS/드라이브에 보관하는 루틴 권장.
const TABLES = [
  { name: 'items',              label: '품목 마스터' },
  { name: 'inventory',          label: '재고·위치' },
  { name: 'bom',                label: 'BOM' },
  { name: 'projects',           label: '프로젝트(어셈블리)' },
  { name: 'customers',          label: '고객사' },
  { name: 'purchase_orders',    label: '발주/PO' },
  { name: 'production',         label: '생산(호기)' },
  { name: 'stock_movements',    label: '입출고 이력' },
  { name: 'price_history',      label: '단가 이력' },
  { name: 'forecasts',          label: '포캐스트' },
  { name: 'confirmed_purchases',label: '확정 매입' },
  { name: 'customer_item_codes',label: '고객사 품번' },
  { name: 'weekly_reports',     label: '주간보고' },
  { name: 'pm_profiles',        label: '사용자' },
]

export default function Backup() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState([]) // {name,label,rows,status}
  const [done, setDone] = useState(null)

  async function runBackup() {
    setRunning(true); setDone(null)
    setProgress(TABLES.map(t => ({ ...t, rows: 0, status: '대기' })))
    const wb = XLSX.utils.book_new()
    let totalRows = 0, failed = []

    for (let i = 0; i < TABLES.length; i++) {
      const t = TABLES[i]
      setProgress(p => p.map((x, xi) => xi === i ? { ...x, status: '내려받는 중…' } : x))
      try {
        const rows = await fetchAll(() => supabase.from(t.name).select('*').order('created_at', { ascending: true }))
          .catch(() => fetchAll(() => supabase.from(t.name).select('*'))) // created_at 없는 테이블 대비
        const clean = (rows || []).map(r => {
          const o = {}
          for (const k in r) o[k] = (r[k] !== null && typeof r[k] === 'object') ? JSON.stringify(r[k]) : r[k]
          return o
        })
        const ws = XLSX.utils.json_to_sheet(clean.length ? clean : [{ '(빈 테이블)': '' }])
        XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31))
        totalRows += clean.length
        setProgress(p => p.map((x, xi) => xi === i ? { ...x, rows: clean.length, status: '완료' } : x))
      } catch (e) {
        failed.push(t.name)
        setProgress(p => p.map((x, xi) => xi === i ? { ...x, status: '실패: ' + e.message } : x))
      }
    }

    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `PM포털_백업_${stamp}.xlsx`)
    setDone({ totalRows, failed, stamp })
    setRunning(false)
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🗄 데이터 백업</h1>
        <p className="text-xs text-slate-400 mt-0.5">주요 테이블 전체를 엑셀 파일(시트별)로 다운로드합니다. <b className="text-slate-600">주 1회</b> 받아서 회사 드라이브/NAS에 보관하세요.</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-700">
        ⚠️ Supabase 무료 플랜은 자동 백업이 제한적입니다. 이 수동 백업이 데이터 사고(실수 삭제·서비스 장애) 시 유일한 복구 수단이 될 수 있어요.
        데이터가 늘면 다운로드에 1~2분 걸릴 수 있습니다.
      </div>

      <button onClick={runBackup} disabled={running}
        className="px-5 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
        {running ? '백업 생성 중…' : '📥 전체 백업 다운로드 (.xlsx)'}
      </button>

      {progress.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-400">
              <th className="px-3 py-2 text-left font-bold">테이블</th>
              <th className="px-3 py-2 text-left font-bold">내용</th>
              <th className="px-3 py-2 text-right font-bold">행 수</th>
              <th className="px-3 py-2 text-left font-bold">상태</th>
            </tr></thead>
            <tbody>
              {progress.map(t => (
                <tr key={t.name} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-mono text-indigo-600">{t.name}</td>
                  <td className="px-3 py-1.5 text-slate-600">{t.label}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-700">{t.rows ? t.rows.toLocaleString() : '-'}</td>
                  <td className={`px-3 py-1.5 ${t.status === '완료' ? 'text-emerald-600 font-semibold' : t.status.startsWith('실패') ? 'text-rose-500' : 'text-slate-400'}`}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {done && (
        <div className={`rounded-xl border px-4 py-3 text-xs font-semibold ${done.failed.length ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          ✅ 백업 완료 — 총 {done.totalRows.toLocaleString()}행 → PM포털_백업_{done.stamp}.xlsx
          {done.failed.length > 0 && <div className="mt-1">⚠️ 실패한 테이블: {done.failed.join(', ')} (다시 시도하거나 알려주세요)</div>}
          <div className="mt-1 font-normal text-[11px]">파일을 회사 드라이브/NAS 등 PC 외부에 보관하세요.</div>
        </div>
      )}
    </div>
  )
}
