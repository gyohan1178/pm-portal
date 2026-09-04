import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toastError } from '../../lib/toast'
import { ResizableTable } from '../../components/ResizableTable'
import { downloadCostExcel } from '../../lib/costExcel'

const won = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR')
const n0 = n => (Number(n) || 0).toLocaleString('ko-KR')

// 상위품번 한 줄씩. BOM 이 2만 행이라 브라우저로 받아 세면 잘린다 —
// DB 함수가 숫자만 계산해 돌려준다.
async function fetchSummary(csId) {
  if (!csId) return []
  const { data, error } = await supabase.rpc('pm_cost_summary', { p_customer_id: csId })
  if (error) throw error
  return data || []
}
async function fetchDetail(csId, projectId) {
  if (!csId || !projectId) return []
  const { data, error } = await supabase.rpc('pm_cost_detail',
    { p_customer_id: csId, p_project_id: projectId })
  if (error) throw error
  return data || []
}

const SUM_COLS = [
  { key: 'code',   label: '상위품번',   defaultWidth: 150 },
  { key: 'name',   label: '어셈블리명', defaultWidth: 200 },
  { key: 'rows',   label: 'BOM행',     defaultWidth: 66, style: { textAlign: 'right' } },
  { key: 'kinds',  label: '품목종수',   defaultWidth: 76, style: { textAlign: 'right' } },
  { key: 'part',   label: '파트',       defaultWidth: 108, style: { textAlign: 'right' } },
  { key: 'mach',   label: '가공물',     defaultWidth: 108, style: { textAlign: 'right' } },
  { key: 'etc',    label: '기타',       defaultWidth: 100, style: { textAlign: 'right' } },
  { key: 'total',  label: '원자재 합계', defaultWidth: 126, style: { textAlign: 'right' } },
  { key: 'cover',  label: '단가 반영률', defaultWidth: 96, style: { textAlign: 'right' } },
  { key: 'harn',   label: '하네스',     defaultWidth: 72, style: { textAlign: 'right' } },
]

const DET_COLS = [
  { key: 'grp',    label: '분류',       defaultWidth: 72 },
  { key: 'std',    label: '품번',       defaultWidth: 140 },
  { key: 'name',   label: '품명',       defaultWidth: 230 },
  { key: 'maker',  label: '제조사',     defaultWidth: 120 },
  { key: 'mkpn',   label: '제조사품번', defaultWidth: 150 },
  { key: 'qty',    label: '소요',       defaultWidth: 64, style: { textAlign: 'right' } },
  { key: 'unit',   label: '단위',       defaultWidth: 50 },
  { key: 'price',  label: '매입단가',   defaultWidth: 96, style: { textAlign: 'right' } },
  { key: 'amt',    label: '금액',       defaultWidth: 108, style: { textAlign: 'right' } },
  { key: 'vendor', label: '구매처',     defaultWidth: 110 },
  { key: 'reason', label: '합산 제외 사유', defaultWidth: 240 },
]

const GRP_CLS = {
  '파트':   'bg-sky-100 text-sky-700',
  '가공물': 'bg-amber-100 text-amber-700',
  '어셈블리': 'bg-violet-100 text-violet-700',
  '하네스': 'bg-emerald-100 text-emerald-700',
  '제외':   'bg-slate-100 text-slate-500',
  '미분류': 'bg-rose-100 text-rose-600',
}

export default function CostSummary({ csId, csName }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)      // { id, code, name }
  const [xlBusy, setXlBusy] = useState(false)

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['cost-summary', csId],
    queryFn: () => fetchSummary(csId),
    enabled: !!csId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: detail = [], isFetching: dBusy } = useQuery({
    queryKey: ['cost-detail', csId, open?.id],
    queryFn: () => fetchDetail(csId, open?.id),
    enabled: !!csId && !!open?.id,
    staleTime: 5 * 60 * 1000,
  })

  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return rows
    return rows.filter(r =>
      String(r.project_code || '').toLowerCase().includes(k) ||
      String(r.project_name || '').toLowerCase().includes(k))
  }, [rows, q])

  // 합계 — 화면에 보이는 것만
  const sum = useMemo(() => list.reduce((a, r) => ({
    rows:  a.rows  + Number(r.bom_rows || 0),
    part:  a.part  + Number(r.part_krw || 0),
    mach:  a.mach  + Number(r.mach_krw || 0),
    etc:   a.etc   + Number(r.etc_krw || 0),
    total: a.total + Number(r.total_krw || 0),
    noPrice: a.noPrice + Number(r.no_price_kinds || 0),
    priced:  a.priced  + Number(r.priced_kinds || 0),
  }), { rows: 0, part: 0, mach: 0, etc: 0, total: 0, noPrice: 0, priced: 0 }), [list])

  const cover = (r) => {
    const p = Number(r.priced_kinds || 0), n = Number(r.no_price_kinds || 0)
    return p + n === 0 ? null : p / (p + n)
  }
  const coverAll = sum.priced + sum.noPrice === 0 ? null : sum.priced / (sum.priced + sum.noPrice)

  // 매입단가·구매처는 영업팀에 나가면 안 된다. 만들 때부터 가른다.
  //   손으로 지우는 방식은 한 번만 깜빡해도 그대로 나간다.
  const [xlAsk, setXlAsk] = useState(false)

  async function exportXlsx(withPrice) {
    if (!list.length) { toastError('내보낼 것이 없습니다'); return }
    setXlAsk(false)
    setXlBusy(true)
    try {
      const d = new Date()
      const p2 = x => String(x).padStart(2, '0')
      const asOf = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
      await downloadCostExcel({
        head: { csName, asOf, rowCount: list.length, sum, cover: coverAll },
        rows: list,
        detail: open && detail.length
          ? { code: open.code, name: open.name, rows: detail }
          : null,
        withPrice,
        fileName: `원가총괄_${csName}${withPrice ? '' : '_영업팀용'}_`
                  + `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.xlsx`,
      })
    } catch (e) {
      toastError('내보내기 실패: ' + e.message)
    } finally { setXlBusy(false) }
  }

  if (!csId) return <p className="text-center text-slate-400 text-sm py-12">고객사를 골라 주세요.</p>

  return (
    <div className="space-y-3">
      {/* 지표 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="원자재 매입 합계" value={won(sum.total) + '원'}
              sub={`상위품번 ${n0(list.length)}개 · BOM ${n0(sum.rows)}행`} accent="slate" />
        <Card label="파트" value={won(sum.part) + '원'}
              sub={sum.total > 0 ? `${Math.round(sum.part / sum.total * 100)}%` : '—'} accent="sky" />
        <Card label="가공물" value={won(sum.mach) + '원'}
              sub={sum.total > 0 ? `${Math.round(sum.mach / sum.total * 100)}%` : '—'} accent="amber" />
        <Card label="단가 반영률"
              value={coverAll == null ? '—' : `${(coverAll * 100).toFixed(1)}%`}
              sub={`등록 ${n0(sum.priced)}종 · 미등록 ${n0(sum.noPrice)}종`}
              accent={coverAll != null && coverAll >= 0.9 ? 'emerald' : 'rose'} />
      </div>

      {/* 반영률이 낮으면 숫자를 믿을 수 없다는 것을 먼저 알린다 */}
      {coverAll != null && coverAll < 0.9 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-800">
            ⚠️ 단가가 없는 품목이 {n0(sum.noPrice)}종입니다 — 위 합계는 실제 원가보다 적습니다
          </p>
          <p className="text-xs text-rose-600 mt-0.5">
            단가를 채운 만큼만 더해진 숫자입니다. 견적 근거로 쓰기 전에 반영률을 먼저 보세요.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="상위품번 · 어셈블리명 검색"
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 w-64" />
        <span className="text-xs text-slate-400">{n0(list.length)}개</span>
        {isFetching && <span className="text-xs text-slate-400">불러오는 중…</span>}
        <button onClick={() => setXlAsk(true)} disabled={xlBusy || !list.length}
          title="표지와 총괄표가 있는 제출용 엑셀. 세부를 열어 두면 그 시트도 함께 나옵니다"
          className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 whitespace-nowrap">
          {xlBusy ? '…' : '📥 엑셀'}
        </button>
      </div>

      {/* 어떤 걸로 내려받을지. 매입단가가 실수로 나가는 것을 막는다. */}
      {xlAsk && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setXlAsk(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3"
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">📥 어떤 걸로 내려받을까요</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                표지와 총괄표가 들어갑니다.
                {open && detail.length > 0 && ` 열어 둔 ${open.code} 세부도 함께 나옵니다.`}
              </p>
            </div>

            <button onClick={() => exportXlsx(true)} disabled={xlBusy}
              className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
              <p className="text-sm font-bold text-slate-800">전체</p>
              <p className="text-xs text-slate-400 mt-0.5">매입단가·구매처 포함 · 사내 보관용</p>
            </button>

            <button onClick={() => exportXlsx(false)} disabled={xlBusy}
              className="w-full text-left px-4 py-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
              <p className="text-sm font-bold text-emerald-800">영업팀용</p>
              <p className="text-xs text-emerald-600 mt-0.5">매입단가·구매처 빼고 · 파일 이름에 표시됨</p>
            </button>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              ⚠️ 매입단가와 구매처는 협상에 쓰이는 값입니다. 사외로 나가면 곤란하므로
              영업팀용에는 아예 담기지 않습니다.
            </p>

            <button onClick={() => setXlAsk(false)}
              className="w-full py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-500">
              취소
            </button>
          </div>
        </div>
      )}

      {!isFetching && !list.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-3xl mb-2">💵</p>
          <p className="text-sm font-bold text-slate-600">BOM 이 등록된 상위품번이 없습니다</p>
        </div>
      )}

      {list.length > 0 && (
        <ResizableTable cols={SUM_COLS} storageKey="cost_summary_cols">
          {() => (
            <tbody>
              {list.map(r => {
                const cv = cover(r)
                const on = open?.id === r.project_id
                return (
                  <tr key={r.project_id}
                    onClick={() => setOpen(on ? null : {
                      id: r.project_id, code: r.project_code, name: r.project_name })}
                    className={`border-b border-slate-100 cursor-pointer ${on ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden font-mono font-bold text-indigo-600">
                      {on ? '▾ ' : '▸ '}{r.project_code}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-600" title={r.project_name || ''}>
                      {r.project_name || <span className="text-slate-300">(이름 없음)</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-slate-400">{n0(r.bom_rows)}</td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-slate-500">{n0(r.item_kinds)}</td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-sky-700">{won(r.part_krw)}</td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-amber-700">{won(r.mach_krw)}</td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-slate-500">{won(r.etc_krw)}</td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right font-bold text-slate-900">{won(r.total_krw)}</td>
                    <td className={`px-3 py-2 whitespace-nowrap overflow-hidden text-right font-bold ${
                      cv == null ? 'text-slate-300' : cv >= 0.9 ? 'text-emerald-600' : cv >= 0.5 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {cv == null ? '—' : (cv * 100).toFixed(0) + '%'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-emerald-600">
                      {Number(r.harness_kinds) > 0 ? n0(r.harness_kinds) + '종' : ''}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-100 font-bold">
                <td className="px-3 py-2.5 text-slate-800">합계</td>
                <td className="px-3 py-2.5 text-slate-400">{n0(list.length)}개 상위품번</td>
                <td className="px-3 py-2.5 text-right text-slate-500">{n0(sum.rows)}</td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5 text-right text-sky-700">{won(sum.part)}</td>
                <td className="px-3 py-2.5 text-right text-amber-700">{won(sum.mach)}</td>
                <td className="px-3 py-2.5 text-right text-slate-500">{won(sum.etc)}</td>
                <td className="px-3 py-2.5 text-right text-slate-900">{won(sum.total)}</td>
                <td className="px-3 py-2.5 text-right text-slate-500">
                  {coverAll == null ? '—' : (coverAll * 100).toFixed(0) + '%'}
                </td>
                <td className="px-3 py-2.5"></td>
              </tr>
            </tbody>
          )}
        </ResizableTable>
      )}

      {/* 세부 */}
      {open && (
        <div className="rounded-xl border-2 border-indigo-200 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 border-b border-indigo-200 flex-wrap">
            <span className="font-mono font-bold text-indigo-800">{open.code}</span>
            <span className="text-xs text-slate-500">{open.name || '(이름 없음)'}</span>
            <span className="text-xs text-slate-400">· {n0(detail.length)}행</span>
            {dBusy && <span className="text-xs text-slate-400">불러오는 중…</span>}
            <button onClick={() => setOpen(null)}
              className="ml-auto px-2 py-1 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-500">
              닫기
            </button>
          </div>
          {!dBusy && detail.length > 0 && (
            <div className="p-2">
              <ResizableTable cols={DET_COLS} storageKey="cost_detail_cols">
                {() => (
                  <tbody>
                    {detail.map((d, i) => (
                      <tr key={`${d.std_code}-${i}`}
                        className={`border-b border-slate-100 ${d.counted ? '' : 'bg-slate-50/60'}`}>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${GRP_CLS[d.grp] || 'bg-slate-100 text-slate-500'}`}>
                            {d.grp}
                          </span>
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap overflow-hidden font-mono ${d.counted ? 'text-slate-700' : 'text-slate-400'}`}>{d.std_code}</td>
                        <td className={`px-3 py-2 whitespace-nowrap overflow-hidden ${d.counted ? 'text-slate-700' : 'text-slate-400'}`} title={d.item_name}>{d.item_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{d.manufacturer || ''}</td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden font-mono text-slate-500">{d.maker_code || ''}</td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-right text-slate-600">{n0(d.qty)}</td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-400">{d.unit}</td>
                        <td className={`px-3 py-2 whitespace-nowrap overflow-hidden text-right ${d.price == null || Number(d.price) === 0 ? 'text-rose-400' : 'text-slate-600'}`}>
                          {d.price == null || Number(d.price) === 0 ? '미등록' : won(d.price)}
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap overflow-hidden text-right font-bold ${d.counted ? 'text-slate-900' : 'text-slate-300'}`}>
                          {d.counted ? won(d.amount) : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-slate-500">{d.vendor || ''}</td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-[11px] text-slate-400" title={d.reason}>{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </ResizableTable>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">
        · <b>파트</b> 전장·커넥터·케이블·하드웨어·기타 &nbsp;·&nbsp; <b>가공물</b> 판금·브라켓 &nbsp;·&nbsp; <b>기타</b> 사 오는 어셈블리·미분류<br />
        · <b>하네스</b>는 우리가 만드는 것이라 매입원가에 넣지 않습니다. 종수만 보여 줍니다.<br />
        · 그 자체가 상위품번인 어셈블리는 <b>하위 부품이 BOM 에 이미 들어 있어</b> 합계에서 뺍니다 (이중계산 방지).<br />
        · <b>단가 반영률</b>이 낮으면 합계가 실제보다 적습니다. 상위품번을 눌러 어떤 품목이 빠졌는지 확인하세요.
      </p>
    </div>
  )
}

function Card({ label, value, sub, accent }) {
  const ac = { emerald: 'text-emerald-600', rose: 'text-rose-600', sky: 'text-sky-600',
               amber: 'text-amber-600', slate: 'text-slate-900' }[accent] || 'text-slate-800'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${ac}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}
