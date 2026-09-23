import { useMemo } from 'react'
import { CUST_NAME } from '../../lib/costSaving'

// 경영진 보고용 한 장 — 화면에서 그대로 보고, 🖨 버튼으로 A4 한 장에 인쇄한다.
//
//   보고의 틀 : ① 구매 규모  ② 단가가 얼마나 움직였나  ③ 왜 움직였나  ④ 우리가 한 일  ⑤ 다음에 할 일
//   ⚠ 「절감율」이라 부르지 않는다. 자재가가 오르는 해에는 반드시 마이너스가 나오고,
//     그 숫자 하나만 보면 구매팀이 못한 것처럼 읽힌다. 「구매단가 변동률」로 적고,
//     통제할 수 있었던 몫과 없었던 몫을 갈라서 보여 준다.
//   ⚠ 인쇄 CSS 는 body.printing-costreport 로 좁혀 둔다 (전역 body>* 규칙 금지 — 다른 화면이 깨진다)

const n = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const eok = (v) => {
  const x = Number(v) || 0
  if (Math.abs(x) >= 1e8) return (x / 1e8).toFixed(2) + '억'
  if (Math.abs(x) >= 1e4) return n(x / 1e4) + '만'
  return n(x)
}
const pctS = (v, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + '%')

// PDF 로 저장할 때의 파일 이름은 브라우저가 document.title 로 짓는다.
//   그냥 인쇄하면 탭 이름(JS 통합포털…)이 그대로 파일명이 되므로, 인쇄하는 동안만 바꿔 준다.
export function printCostReport(name) {
  const title = document.title
  document.title = name || '구매자재팀 원가 실적 보고'
  document.body.classList.add('printing-costreport')
  const done = () => {
    document.body.classList.remove('printing-costreport')
    document.title = title
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 60)
}

export default function CostReport({
  year, start, basisLabel, buy, st, cover, fixed, goal,
  custs, topItems, kindSum, ledger, susp, today, monthly,
}) {
  // 오른 것·내린 것 각각 큰 순서로 다섯 개
  const up = useMemo(() => topItems.filter((t) => t.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5), [topItems])
  const down = useMemo(() => topItems.filter((t) => t.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5), [topItems])
  const upSum = up.reduce((a, t) => a + t.diff, 0)
  const upShare = st.loss ? (-upSum / st.loss) * 100 : 0
  const mon = monthly || []
  const maxBuy = Math.max(1, ...mon.map((m) => m.buy))

  const Row = ({ t, children }) => (
    <div className="mb-3">
      <p className="text-[12px] font-extrabold text-slate-700 border-b border-slate-300 pb-1 mb-1.5">{t}</p>
      {children}
    </div>
  )

  return (
    <div className="costreport-area bg-white rounded-xl border border-slate-200 p-6 text-slate-800">
      <style>{`
        @media print {
          body.printing-costreport * { visibility: hidden !important; }
          body.printing-costreport .costreport-area,
          body.printing-costreport .costreport-area * { visibility: visible !important; }
          body.printing-costreport .costreport-area {
            position: absolute !important; left: 0; top: 0; width: 100%;
            border: 0 !important; padding: 0 !important;
          }
          body.printing-costreport .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 12mm; }
        }
      `}</style>

      {/* 머리말 */}
      <div className="flex items-end justify-between border-b-2 border-slate-700 pb-2 mb-4">
        <div>
          <h2 className="text-[19px] font-extrabold tracking-tight">구매자재팀 원가 실적 보고</h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">
            집계 기간 {start} ~ {today} · 기준단가 {basisLabel} · {year}년
          </p>
        </div>
        <p className="text-[11px] text-slate-400 text-right">진선테크 지원본부<br />구매자재팀</p>
      </div>

      {/* ① 한눈에 */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          ['구매액', eok(buy) + '원', `${n(st.n)}건 · 기준 적용 ${cover.toFixed(0)}%`],
          ['구매단가 변동률', pctS(st.chg), '기준단가 대비 · 플러스면 올랐다는 뜻'],
          ['단가 변동액', eok(st.net) + '원', `내린 품목 +${eok(st.save)} · 오른 품목 −${eok(st.loss)}`],
          ['절감 활동 실적', eok(fixed) + '원', goal ? `연간 목표 ${eok(goal)} 대비 ${Math.round((fixed / goal) * 100)}%` : '업체변경·대체품 등'],
        ].map(([t, v, s]) => (
          <div key={t} className="border border-slate-200 rounded-lg px-3 py-2">
            <p className="text-[10.5px] font-bold text-slate-400">{t}</p>
            <p className={`text-[20px] font-extrabold tabular-nums leading-tight ${
              t === '구매단가 변동률' ? (st.chg > 0 ? 'text-rose-600' : 'text-emerald-600')
                : t === '단가 변동액' ? (st.net >= 0 ? 'text-emerald-600' : 'text-rose-600')
                  : 'text-slate-800'}`}>{v}</p>
            <p className="text-[9.5px] text-slate-400 leading-snug">{s}</p>
          </div>
        ))}
      </div>

      {/* ② 요약 문장 — 그대로 읽으면 되는 세 줄 */}
      <Row t="요약">
        <ul className="text-[12px] leading-relaxed list-disc pl-4 space-y-0.5">
          <li>
            집계 기간 구매액 <b>{eok(buy)}원</b> 중 기준단가로 견줄 수 있는 <b>{cover.toFixed(0)}%</b>를 놓고 보면,
            구매단가는 <b className={st.chg > 0 ? 'text-rose-600' : 'text-emerald-600'}>{pctS(st.chg)}</b> 움직였습니다
            (금액으로 {eok(Math.abs(st.net))}원 {st.net >= 0 ? '절감' : '증가'}).
          </li>
          <li>
            오른 품목 전체 <b className="text-rose-600">{eok(st.loss)}원</b> 가운데 상위 5품목이
            <b className="text-rose-600"> {eok(-upSum)}원({upShare.toFixed(0)}%)</b>으로, 상승분이 소수 품목에 몰려 있습니다.
            같은 기간 단가가 내린 품목도 <b className="text-emerald-600">{eok(st.save)}원</b> 있습니다.
          </li>
          <li>
            절감 활동(업체변경·대체품·단가인하 등)으로 <b className="text-emerald-600">{eok(fixed)}원</b>을 확보했습니다.
            {susp?.length ? ` 단가 검증이 필요한 ${n(susp.length)}건은 지표에서 제외했습니다.` : ''}
          </li>
        </ul>
      </Row>

      {/* ③ 월별 추이 */}
      <Row t="월별 추이">
        {mon.length ? (
          <>
            <div className="flex items-end gap-2 h-[92px] px-1">
              {mon.map((m) => {
                const h = Math.max(3, Math.round((m.buy / maxBuy) * 78))
                return (
                  <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-0.5">
                    <span className={`text-[9px] font-bold tabular-nums ${m.chg == null ? 'text-slate-300' : m.chg > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {pctS(m.chg)}
                    </span>
                    <div className="w-full rounded-t bg-indigo-400" style={{ height: h }} />
                    <span className="text-[9px] text-slate-400 tabular-nums">{eok(m.buy)}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2 px-1 mt-0.5">
              {mon.map((m) => (
                <span key={m.key} className="flex-1 text-center text-[10px] font-semibold text-slate-500">{m.key.slice(5)}월</span>
              ))}
            </div>
            <p className="text-[9.5px] text-slate-400 mt-1">막대 = 구매액 · 위 숫자 = 그 달의 구매단가 변동률(플러스면 올랐다는 뜻)</p>
          </>
        ) : <p className="text-[11.5px] text-slate-400">집계 기간에 입고가 없습니다.</p>}
      </Row>

      {/* ④ 고객사별 */}
      <Row t="고객사별">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-slate-400 text-left border-b border-slate-200">
              <th className="py-1">고객사</th><th className="py-1 text-right">구매액</th>
              <th className="py-1 text-right">단가 변동액</th><th className="py-1 text-right">변동률</th>
              <th className="py-1 text-right">기준 적용률</th>
            </tr>
          </thead>
          <tbody>
            {custs.slice(0, 6).map((c) => (
              <tr key={c.key} className="border-b border-slate-100">
                <td className="py-1 font-semibold">{CUST_NAME[c.key] || c.key}</td>
                <td className="py-1 text-right tabular-nums">{eok(c.buy)}</td>
                <td className={`py-1 text-right tabular-nums font-bold ${c.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{eok(c.net)}</td>
                <td className={`py-1 text-right tabular-nums font-bold ${c.chg == null ? 'text-slate-300' : c.chg > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{pctS(c.chg)}</td>
                <td className="py-1 text-right tabular-nums text-slate-400">{c.cover.toFixed(0)}%</td>
              </tr>
            ))}
            {!custs.length && <tr><td colSpan={5} className="py-4 text-center text-slate-400">자료 없음</td></tr>}
          </tbody>
        </table>
      </Row>

      {/* ⑤ 오른 품목 · 내린 품목 */}
      <div className="grid grid-cols-2 gap-4">
        <Row t="단가가 오른 품목 (상위 5)">
          <table className="w-full text-[11px]">
            <tbody>
              {up.map((t) => (
                <tr key={t.item_id} className="border-b border-slate-100">
                  <td className="py-1">
                    <span className="font-mono text-slate-600">{t.std_code}</span>
                    <div className="text-[9.5px] text-slate-400 truncate max-w-[160px]">{t.name}</div>
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-500">{eok(t.buy)}</td>
                  <td className="py-1 text-right tabular-nums font-bold text-rose-600">{eok(t.diff)}</td>
                </tr>
              ))}
              {!up.length && <tr><td className="py-4 text-center text-slate-400">없음</td></tr>}
            </tbody>
          </table>
        </Row>
        <Row t="단가가 내린 품목 (상위 5)">
          <table className="w-full text-[11px]">
            <tbody>
              {down.map((t) => (
                <tr key={t.item_id} className="border-b border-slate-100">
                  <td className="py-1">
                    <span className="font-mono text-slate-600">{t.std_code}</span>
                    <div className="text-[9.5px] text-slate-400 truncate max-w-[160px]">{t.name}</div>
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-500">{eok(t.buy)}</td>
                  <td className="py-1 text-right tabular-nums font-bold text-emerald-600">{eok(t.diff)}</td>
                </tr>
              ))}
              {!down.length && <tr><td className="py-4 text-center text-slate-400">없음</td></tr>}
            </tbody>
          </table>
        </Row>
      </div>

      {/* ⑥ 절감 활동 */}
      <Row t="절감 활동 실적">
        {kindSum.length ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] mb-1.5">
            {kindSum.map(([k, v]) => (
              <span key={k}><b className="text-slate-600">{k}</b> <span className="tabular-nums text-emerald-600 font-bold">{eok(v)}원</span></span>
            ))}
          </div>
        ) : <p className="text-[11.5px] text-slate-400 mb-1.5">아직 등록된 활동이 없습니다 — 실적 대장에 등록하면 여기 쌓입니다.</p>}
        <table className="w-full text-[11px]">
          <tbody>
            {ledger.slice(0, 6).map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-1 text-slate-400 w-16">{l.ym}</td>
                <td className="py-1 w-20 font-semibold text-slate-600">{l.kind}</td>
                <td className="py-1"><span className="font-mono text-slate-500">{l.std_code}</span> <span className="text-slate-400">{l.item_name}</span></td>
                <td className="py-1 text-right tabular-nums font-bold text-emerald-600">{eok(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Row>

      {/* ⑦ 기준 설명 — 경영진이 「그 기준이 뭐냐」 물었을 때의 답 */}
      <div className="mt-3 pt-2 border-t border-slate-200 text-[10px] text-slate-400 leading-relaxed">
        <b className="text-slate-500">기준단가</b> — {basisLabel}.
        품목마다 「작년 이맘때 같은 물건을 얼마에 샀나」를 수량 가중평균으로 잡고, 이번 입고 단가와 견줍니다.
        집계 시작일({start}) 이후 입고만 세며, 그 뒤 구매는 기준에 넣지 않습니다.
        기준단가와 5배 넘게 벌어진 건은 단위·환율·품번이 어긋난 것으로 보고 지표에서 제외합니다.
        <br />
        <b className="text-slate-500">구매단가 변동률</b> — (실구매 금액 − 기준 금액) ÷ 기준 금액. 플러스면 단가가 올랐다는 뜻입니다.
        <span className="ml-2">· 작성 {today} · PM Portal 자동 집계</span>
      </div>
    </div>
  )
}
