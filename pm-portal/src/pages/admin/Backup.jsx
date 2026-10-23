import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'
import { todayISO } from '../../lib/utils'

// 🗄 데이터 백업 — Supabase 무료플랜용. PM 포털 표를 한 번에 내려받는다.
// 주 1회 클릭 → 파일을 회사 NAS/드라이브에 보관하는 루틴 권장.
//
//   v4.90.3  대상 표 정리 (14 → 64): 수주대장 · 견적 · 매출 · 도면 · CN · 초도품 · 로트 · 창고 등 그동안 새로 생긴 표 추가
//            · 엑셀 칸 하나는 32,767자까지라 긴 칸(BOM 버전 · CN 문서 · 되돌리기 스냅샷)은 엑셀에서 잘린다
//              → 잘림 없는 원본을 JSON 파일로 함께 내려받는다 (복구는 JSON 으로)
//            · 페이지 나눠 읽을 때 기본 키 순서로 읽어 빠지거나 겹치는 행이 없게
//   넣지 않는 표: ax_* · harness_*(다른 시스템) · profiles · *_backup_* / *_bak_*(작업 전 임시 백업) · 다시 계산되는 캐시
const G = (group, list) => list.map(([name, label, order]) => ({ name, label, group, order }))
export const BACKUP_TABLES = [
  ...G('기준 · 자재', [
    ['items', '품목 마스터'], ['vendors', '협력사'], ['customers', '고객사'], ['customer_item_codes', '고객사 품번'],
    ['pm_code_map', '기준코드 매핑'], ['pm_code_category', '기준코드 분류', ['code']], ['pm_item_supply', '품목 공급 구분', ['item_id']],
    ['pm_item_avl', '품목 승인 제조사'], ['pm_std_price', '표준 단가'], ['price_history', '단가 이력'],
    ['inventory', '재고 · 위치'], ['stock_movements', '입출고 이력'], ['pm_outbound_project_fill', '출고 프로젝트 보정', ['sm_id']],
    ['pm_stock_audit', '재고 실사'], ['pm_lot', '로트'], ['pm_lot_use', '로트 사용'],
    ['pm_rack', '창고 랙', ['code']], ['pm_rack_owner', '랙 담당', ['rack_code']], ['pm_floor_object', '창고 배치도'], ['pm_rack_snapshot', '랙 스냅샷'],
  ]),
  ...G('구매', [
    ['purchase_orders', '발주 · 고객사 PO'], ['pm_po_cart', '발주 장바구니'], ['pm_payment_plan', '결제 계획'],
    ['pm_ecount_purchases', '확정매입 (이카운트)'], ['confirmed_purchases', '확정 매입 (예전)'], ['pm_vendor_contact', '협력사 담당자'],
    ['pm_cost_saving', '원가절감'], ['pm_cost_saving_skip', '원가절감 제외'], ['pm_labor_costs', '인건비'],
  ]),
  ...G('BOM · 생산', [
    ['bom', 'BOM'], ['projects', '프로젝트(어셈블리)'], ['pm_bom_notes', 'BOM 메모', ['customer_id', 'project_id', 'item_id']], ['pm_bom_version', 'BOM 버전'],
    ['production', '생산(호기)'], ['pm_material_request', '자재 요청'], ['pm_picking', '피킹'], ['forecasts', '포캐스트'],
    ['pm_ed_demand', 'Edwards 소요', null], ['pm_cell_aux', '셀 보조 정보'], ['pm_cell_check', '셀 점검'],
  ]),
  ...G('영업', [
    ['pm_order', '수주대장 PO'], ['pm_order_line', '수주대장 품목'], ['pm_order_change', '수주대장 변경 이력'], ['pm_order_alias', '수주대장 품명 기억', ['customer_code', 'alias_key']], ['pm_order_pn_flag', '수주대장 비품목 표시'], ['pm_bom_need', 'BOM 필요 · 요청', ['item_id']], ['pm_rfq', '견적 접수'], ['pm_rfq_line', '견적 접수 품목'],
    ['pm_quotes', '견적'], ['pm_quote_items', '견적 품목'], ['pm_quote_drafts', '견적 임시저장'], ['quotes', '견적 (예전)'], ['pm_sales', '매출'],
  ]),
  ...G('품질 · 도면', [
    ['pm_drawings', '도면'], ['pm_drawing_dist', '도면 배포 이력'], ['pm_dwg_int', '사내 도면 배포'], ['pm_dwg_int_rcpt', '사내 도면 배포 부서 수령'], ['pm_cn_docs', 'CN 문서'], ['pm_cn_doc_versions', 'CN 문서 버전'],
    ['pm_fa', '초도품'], ['pm_fa_log', '초도품 이력'], ['pm_fai_review', '초도품 자재 매칭 검토'],
  ]),
  ...G('기타', [
    ['weekly_reports', '주간보고'], ['weekly_items', '주간보고 항목'], ['pm_todo', '할 일'], ['pm_todo_comment', '할 일 댓글'],
    ['pm_settings', '설정', ['key']], ['pm_profiles', '사용자'], ['pm_activity_log', '활동 이력'], ['pm_snapshot', '되돌리기 스냅샷'],
  ]),
]
const XLSX_CELL_MAX = 32000

// 표 하나 전부 — 기본 키 순서로 (페이지 경계에서 빠짐 · 겹침 방지)
async function readTable(t) {
  const keys = t.order === undefined ? ['id'] : t.order
  const run = (ks) => fetchAll(() => ks.reduce((q, k) => q.order(k, { ascending: true }), supabase.from(t.name).select('*')))
  try { return await run(keys || []) } catch (e) {
    if (keys && keys.length) return run([])     // 키 이름이 다르면 정렬 없이
    throw e
  }
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export default function Backup() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState([]) // {name,label,group,rows,status,cut}
  const [done, setDone] = useState(null)

  async function runBackup() {
    setRunning(true); setDone(null)
    setProgress(BACKUP_TABLES.map(t => ({ ...t, rows: 0, status: '대기', cut: 0 })))
    const wb = XLSX.utils.book_new()
    const full = {}
    let totalRows = 0, cutCells = 0
    const failed = []

    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const t = BACKUP_TABLES[i]
      setProgress(p => p.map((x, xi) => xi === i ? { ...x, status: '내려받는 중…' } : x))
      try {
        const rows = await readTable(t)
        full[t.name] = rows
        let cut = 0
        const clean = rows.map(r => {
          const o = {}
          for (const k in r) {
            let v = (r[k] !== null && typeof r[k] === 'object') ? JSON.stringify(r[k]) : r[k]
            if (typeof v === 'string' && v.length > XLSX_CELL_MAX) { v = v.slice(0, XLSX_CELL_MAX) + ' …(엑셀 칸 한도로 잘림 — JSON 파일에 전체)'; cut++ }
            o[k] = v
          }
          return o
        })
        const ws = XLSX.utils.json_to_sheet(clean.length ? clean : [{ '(빈 테이블)': '' }])
        XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31))
        totalRows += clean.length; cutCells += cut
        setProgress(p => p.map((x, xi) => xi === i ? { ...x, rows: clean.length, cut, status: '완료' } : x))
      } catch (e) {
        failed.push(t.name)
        setProgress(p => p.map((x, xi) => xi === i ? { ...x, status: '실패: ' + e.message } : x))
      }
    }

    const stamp = todayISO()
    XLSX.writeFile(wb, `PM포털_백업_${stamp}.xlsx`)
    // 잘림 없는 원본 — 복구용
    const json = JSON.stringify({ made_at: new Date().toISOString(), app: 'PM Portal', tables: full })
    await new Promise(r => setTimeout(r, 600))          // 두 번째 다운로드가 막히지 않게 잠깐 쉼
    download(new Blob([json], { type: 'application/json' }), `PM포털_백업_${stamp}.json`)
    try { localStorage.setItem('pm_last_backup', new Date().toISOString()) } catch {}
    setDone({ totalRows, failed, stamp, cutCells, jsonMb: Math.round(json.length / 1e5) / 10 })
    setRunning(false)
  }

  const groups = [...new Set(BACKUP_TABLES.map(t => t.group))]

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🗄 데이터 백업</h1>
        <p className="page-desc text-xs text-slate-400 mt-0.5">PM 포털 표 {BACKUP_TABLES.length}개를 엑셀(보기용)과 JSON(복구용 원본) 두 파일로 내려받습니다. <b className="text-slate-600">주 1회</b> 받아서 회사 드라이브/NAS에 보관하세요.</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-700 space-y-1">
        <div>⚠️ Supabase 무료 플랜은 자동 백업이 제한적입니다. 이 수동 백업이 데이터 사고(실수 삭제·서비스 장애) 시 유일한 복구 수단이 될 수 있어요. 데이터가 늘면 1~3분 걸릴 수 있습니다.</div>
        <div>· 엑셀 칸 하나에는 32,767자까지만 들어가서 BOM 버전 · CN 문서 · 되돌리기 스냅샷의 긴 칸은 엑셀에서 잘립니다. <b>잘림 없는 원본은 JSON 파일</b>에 있으니 두 파일을 같이 보관하세요.</div>
        <div>· 브라우저가 「여러 파일 다운로드」를 물으면 허용을 누르세요.</div>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs" data-backup-list>
        <summary className="font-bold text-slate-700 cursor-pointer">백업하는 표 {BACKUP_TABLES.length}개 보기</summary>
        <div className="mt-2 space-y-1.5 text-slate-600">
          {groups.map(g => (
            <div key={g}><b className="text-slate-700">{g}</b> — {BACKUP_TABLES.filter(t => t.group === g).map(t => t.label).join(' · ')}</div>
          ))}
          <div className="text-slate-400 pt-1">넣지 않는 것: AXCELIS 통합관리(ax_) · 하네스 공정관리(harness_) 표 · 작업 전 임시 백업 표(_backup_ · _bak_) · 다시 계산되는 부족 캐시</div>
        </div>
      </details>

      <button onClick={runBackup} disabled={running}
        className="px-5 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
        {running ? '백업 생성 중…' : '📥 전체 백업 다운로드 (.xlsx + .json)'}
      </button>

      {progress.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-400">
              <th className="px-3 py-2 text-left font-bold">구분</th>
              <th className="px-3 py-2 text-left font-bold">테이블</th>
              <th className="px-3 py-2 text-left font-bold">내용</th>
              <th className="px-3 py-2 text-right font-bold">행 수</th>
              <th className="px-3 py-2 text-left font-bold">상태</th>
            </tr></thead>
            <tbody>
              {progress.map(t => (
                <tr key={t.name} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 text-slate-400">{t.group}</td>
                  <td className="px-3 py-1.5 font-mono text-indigo-600">{t.name}</td>
                  <td className="px-3 py-1.5 text-slate-600">{t.label}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-700 tabular-nums">{t.rows ? t.rows.toLocaleString() : '-'}</td>
                  <td className={`px-3 py-1.5 ${t.status === '완료' ? 'text-emerald-600 font-semibold' : t.status.startsWith('실패') ? 'text-rose-500' : 'text-slate-400'}`}>
                    {t.status}{t.cut ? <span className="ml-1 text-amber-600 font-normal">(엑셀 잘림 {t.cut}칸 · JSON 전체)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {done && (
        <div className={`rounded-xl border px-4 py-3 text-xs font-semibold ${done.failed.length ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`} data-backup-done>
          ✅ 백업 완료 — 총 {done.totalRows.toLocaleString()}행 → PM포털_백업_{done.stamp}.xlsx + .json ({done.jsonMb}MB)
          {done.cutCells > 0 && <div className="mt-1 font-normal">엑셀에서 잘린 긴 칸 {done.cutCells.toLocaleString()}개 — JSON 파일에는 전부 들어 있습니다.</div>}
          {done.failed.length > 0 && <div className="mt-1">⚠️ 실패한 테이블: {done.failed.join(', ')} (다시 시도하거나 알려주세요)</div>}
          <div className="mt-1 font-normal text-[11px]">두 파일을 회사 드라이브/NAS 등 PC 외부에 보관하세요.</div>
        </div>
      )}
    </div>
  )
}
