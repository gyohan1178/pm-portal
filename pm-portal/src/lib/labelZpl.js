// ZM400 라벨 ZPL 생성 (63.5 x 31.75mm)
//
// ★ DPI 주의: 같은 좌표라도 203dpi와 300dpi에서 크기가 다르다.
//   좌표는 203dpi 기준으로 작성하고, 프린터 DPI에 맞춰 자동 스케일한다.
//   ZM400 300dpi 모델은 LABEL_DPI=300. 203dpi 모델이면 203으로 바꾸면 된다.
export const LABEL_DPI = 300

const BASE_DPI = 203
const K = LABEL_DPI / BASE_DPI     // 300 → 1.478
const s = (v) => Math.round(v * K) // 좌표·크기 스케일

// 값이 비면 '^FD^FS'가 되어 프린터가 거부(No value for name)하므로 공백으로.
const esc = (v) => {
  const t = String(v ?? '').replace(/[\^~]/g, ' ').trim()
  return t === '' ? ' ' : t
}

// 라벨 1장 ZPL. row = { no, std_code, labelQty|qty, part, maker, makerPn, location }
export function labelZpl(row) {
  const no = esc(row.no)
  const pn = esc(row.std_code)
  const qty = esc(row.labelQty ?? row.qty)
  const part = String(row.part || '').replace(/[\^~]/g, ' ')
  const maker = esc((String(row.maker || '') + ' ' + String(row.makerPn || '')).trim())
  const loc = esc(row.location)
  return [
    '^XA', '^CI28',
    `^PW${s(508)}`, `^LL${s(254)}`, '^LH0,0',
    // NO 박스 (검정) + 흰 숫자
    `^FO${s(8)},${s(8)}^GB${s(80)},${s(60)},${s(60)}^FS`,
    `^FO${s(8)},${s(20)}^FR^A0N,${s(44)},${s(44)}^FB${s(80)},1,0,C^FD${no}^FS`,
    // 품번
    `^FO${s(100)},${s(10)}^A0N,${s(24)},${s(24)}^FDPN^FS`,
    `^FO${s(100)},${s(34)}^A0N,${s(40)},${s(40)}^FD${pn}^FS`,
    // 수량 (우측)
    `^FO${s(360)},${s(10)}^A0N,${s(24)},${s(24)}^FB${s(140)},1,0,R^FDQTY${part ? ` (${part})` : ''}^FS`,
    `^FO${s(360)},${s(34)}^A0N,${s(44)},${s(44)}^FB${s(140)},1,0,R^FD${qty}^FS`,
    // 구분선
    `^FO${s(8)},${s(90)}^GB${s(492)},1,2^FS`,
    // 제조사·제조사품번
    `^FO${s(8)},${s(100)}^A0N,${s(20)},${s(20)}^FDMAKER^FS`,
    `^FO${s(8)},${s(124)}^A0N,${s(28)},${s(28)}^FB${s(360)},1,0,L^FD${maker}^FS`,
    // 위치 박스 (검정)
    `^FO${s(372)},${s(100)}^GB${s(128)},${s(60)},${s(60)}^FS`,
    `^FO${s(372)},${s(104)}^FR^A0N,${s(18)},${s(18)}^FB${s(128)},1,0,C^FDLOC^FS`,
    `^FO${s(372)},${s(124)}^FR^A0N,${s(32)},${s(32)}^FB${s(128)},1,0,C^FD${loc}^FS`,
    '^XZ',
  ].join('')
}

export function buildLabelZpl(rows) {
  return rows.map((r, i) => labelZpl({ ...r, no: r.no ?? (i + 1) })).join('')
}
