import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { todayISO } from '../lib/utils'
import { toastError } from '../lib/toast'
import { QR_STEPS, qrText, revInfo, missingOf } from '../lib/prodFlow'

// PD 작업지시서 (A4 세로 한 장) — 생산관리(PD BOX)와 QR 공정 데모가 같이 쓴다.
//   ⚠ 한 장 297mm 에 맞춰 두었다 — 칸을 늘리면 다음 장으로 넘치지 않는지 인쇄해서 확인할 것
//
//   호기(row) 에 필요한 값: pn · hogi · name · rev(SREV) · brev · ccn · req_date · arrival_date · missing_parts
//     + _po (PO 번호) · _elec (전장 완료 예정) — 부르는 쪽에서 붙여 준다.
//   QR 내용은 lib/prodFlow.js 의 qrText — 「PD|호기번호|출력 당시 BREV」
//
//   인쇄 규칙은 body.printing-wo 일 때만 먹게 좁혀 둔다 (전역 body>* 규칙 금지 — 다른 화면이 깨진다).

// 호기들의 QR 그림 (data URL) — 내용이 같으면 다시 만들지 않는다
export function useWoQr(rows) {
  const [map, setMap] = useState({})
  const key = rows.map((r) => qrText(r)).join(',')
  useEffect(() => {
    let off = false
    const need = [...new Set(rows.map((r) => qrText(r)))].filter((t) => !map[t])
    if (!need.length) return undefined
    Promise.all(need.map(async (t) => [t, await QRCode.toDataURL(t, { width: 280, margin: 1, errorCorrectionLevel: 'M' })]))
      .then((pairs) => { if (!off) setMap((o) => ({ ...o, ...Object.fromEntries(pairs) })) })
      .catch((e) => { if (!off) setMap((o) => ({ ...o, _err: e.message })) })
    return () => { off = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return map
}

//   인쇄할 장들은 body 바로 아래(포털)에 둔다 → 인쇄 때 나머지 화면은 display:none 이라 빈 장이 붙지 않는다.
//   규칙은 body.printing-wo 일 때만 먹는다.
export function WoPrintStyle() {
  return (
    <style>{`
      .wo-print-area { display: none; }
      @media print {
        body.printing-wo > *:not(.wo-print-area) { display: none !important; }
        body.printing-wo .wo-print-area { display: block; background: #fff; }
        body.printing-wo .wo-sheet { page-break-after: always; break-after: page; box-shadow: none !important; margin: 0 !important; }
        body.printing-wo .wo-sheet:last-child { page-break-after: auto; break-after: auto; }
        @page { size: A4 portrait; margin: 0; }
      }
    `}</style>
  )
}

// 고른 호기들을 인쇄 — 띄우면 QR 을 만든 뒤 바로 인쇄 창을 열고, 인쇄 창이 닫히면 onDone
export function WorkOrderPrinter({ rows, onDone }) {
  const qr = useWoQr(rows)
  const ready = rows.length > 0 && rows.every((r) => qr[qrText(r)])
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    if (qr._err) { toastError('QR 을 만들지 못했습니다: ' + qr._err); doneRef.current?.(); return undefined }
    if (!ready) return undefined
    document.body.classList.add('printing-wo')
    const finish = () => { document.body.classList.remove('printing-wo'); window.removeEventListener('afterprint', finish); doneRef.current?.() }
    window.addEventListener('afterprint', finish)
    const t = setTimeout(() => window.print(), 80)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', finish); document.body.classList.remove('printing-wo') }
  }, [ready, qr._err])
  return (
    <>
      <WoPrintStyle />
      {createPortal(
        <div className="wo-print-area">
          {rows.map((r) => <WoSheet key={r.id} r={r} qr={qr[qrText(r)]} />)}
        </div>, document.body)}
    </>
  )
}

// 작업지시서 한 장
export function WoSheet({ r, qr }) {
  const rv = revInfo(r)
  const ms = missingOf(r)
  const blanks = Math.max(0, 10 - ms.length)   // 발행 뒤 늘어날 수 있으니 칸을 넉넉히
  const cell = { border: '1px solid #334155', padding: '1.4mm 2mm', fontSize: '10pt', lineHeight: 1.25 }
  const head = { ...cell, background: '#E2E8F0', fontWeight: 700, fontSize: '9pt' }
  return (
    <div className="wo-sheet" style={{ width: '210mm', height: '297mm', overflow: 'hidden', boxSizing: 'border-box', padding: '11mm 12mm 8mm', background: '#fff', color: '#0F172A', fontFamily: "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif", boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6mm' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '20pt', fontWeight: 800 }}>PD 작업지시서</div>
          <div style={{ fontSize: '9pt', color: '#475569', marginTop: '1mm' }}>진선테크 · 발행 {todayISO()} · QR 시범 운영</div>
          <div style={{ marginTop: '5mm', display: 'flex', alignItems: 'baseline', gap: '4mm' }}>
            <span style={{ fontSize: '26pt', fontWeight: 800, letterSpacing: '-0.01em' }}>{r.pn}</span>
            <span style={{ fontSize: '26pt', fontWeight: 800, color: '#1D4ED8' }}>{r.hogi}</span>
          </div>
          <div style={{ fontSize: '12pt', marginTop: '1mm' }}>{r.name}</div>
        </div>
        <div style={{ textAlign: 'center', width: '42mm' }}>
          {qr ? <img src={qr} alt={`QR ${qrText(r)}`} style={{ width: '40mm', height: '40mm', display: 'block', margin: '0 auto' }} />
            : <div style={{ width: '40mm', height: '40mm', border: '1px dashed #94A3B8', margin: '0 auto' }} />}
          <div style={{ fontSize: '7pt', color: '#475569', marginTop: '1mm', fontFamily: 'Consolas,monospace' }}>{qrText(r)}</div>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>폰으로 찍으세요</div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '5mm' }}>
        <tbody>
          <tr><td style={head}>PO 번호</td><td style={cell}>{r._po || '-'}</td><td style={head}>CCN</td><td style={cell}>{r.ccn || '-'}</td></tr>
          <tr><td style={head}>납기</td><td style={cell}>{r.req_date || '-'}</td><td style={head}>전장 완료 예정</td><td style={cell}>{r._elec || '-'}</td></tr>
          <tr><td style={head}>BREV (PO 발행)</td><td style={{ ...cell, fontWeight: 800 }}>{rv.b || '-'}</td><td style={head}>SREV (현재)</td><td style={{ ...cell, fontWeight: 800, color: rv.diff ? '#DC2626' : undefined }}>{rv.s || '-'}</td></tr>
          <tr><td style={head}>작업지시서 Rev</td><td style={cell}>{rv.b || '-'} (출력 기준)</td><td style={head}>가공물 입고 예정</td><td style={cell}>{r.arrival_date ? String(r.arrival_date).slice(0, 10) : '미입력'}</td></tr>
        </tbody>
      </table>
      {rv.diff && (
        <div style={{ marginTop: '2mm', border: '2px solid #DC2626', color: '#B91C1C', padding: '2mm 3mm', fontSize: '10pt', fontWeight: 700 }}>
          ⚠ SREV({rv.s}) ≠ BREV({rv.b}) — 최소 BREV {rv.b} 까지 맞추고, 도면 Rev {rv.s} 변경점 확인
        </div>
      )}

      <div style={{ marginTop: '4mm', fontSize: '11pt', fontWeight: 800 }}>공정 기록 <span style={{ fontSize: '8.5pt', fontWeight: 400, color: '#475569' }}>— QR 을 찍으면 자동 기록. 스캔이 안 될 때만 손으로 적으세요</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5mm' }}>
        <thead><tr>{['공정', '찍는 것', '날짜', '시간', '작업자', '확인'].map((h, i) => <th key={h} style={{ ...head, width: ['26%', '16%', '16%', '12%', '18%', '12%'][i] }}>{h}</th>)}</tr></thead>
        <tbody>
          {QR_STEPS.map((s) => (
            <tr key={s.k}>
              <td style={{ ...cell, fontWeight: 700 }}>{s.l}</td>
              <td style={{ ...cell, fontSize: '8.5pt', color: '#475569' }}>{s.k === 'elec_start' ? 'QR 시작' : 'QR 완료'}</td>
              <td style={cell} /><td style={cell} /><td style={cell} /><td style={cell} />
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '4mm', fontSize: '11pt', fontWeight: 800 }}>미불출 파트 <span style={{ fontSize: '8.5pt', fontWeight: 400, color: '#475569' }}>— 발행 뒤 생기면 아래 빈칸에</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5mm' }}>
        <thead><tr>{['품번', '품명', '수량', '입고 예정', '불출 확인'].map((h, i) => <th key={h} style={{ ...head, width: ['20%', '38%', '10%', '16%', '16%'][i] }}>{h}</th>)}</tr></thead>
        <tbody>
          {ms.map((m, i) => (
            <tr key={i}><td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{m.pn}</td><td style={cell}>{m.name}</td><td style={{ ...cell, textAlign: 'right' }}>{m.qty}</td><td style={cell}>{m.date || '미정'}</td><td style={cell} /></tr>
          ))}
          {Array.from({ length: blanks }).map((_, i) => <tr key={`b${i}`}>{[0, 1, 2, 3, 4].map((j) => <td key={j} style={{ ...cell, height: '5.6mm' }} />)}</tr>)}
        </tbody>
      </table>

      <div style={{ marginTop: '4mm', fontSize: '11pt', fontWeight: 800 }}>특이사항</div>
      <div style={{ border: '1px solid #334155', height: '22mm', marginTop: '1.5mm' }} />
    </div>
  )
}
