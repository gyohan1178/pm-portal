// ZM400 라벨 ZPL 생성 (63.5 x 31.75mm)
//
// ★ DPI 주의: 같은 좌표라도 203dpi와 300dpi에서 크기가 다르다.
//   좌표를 mm로 정의하고 프린터 DPI에 맞춰 dot으로 환산한다.
//   ZM400 300dpi 모델은 LABEL_DPI=300. 203dpi 모델이면 203으로 바꾸면 된다.
export const LABEL_DPI = 300

// 용지·여백 (mm) — 프린터 좌측이 잘려 왼쪽 여백을 크게 준다
const LABEL_W = 63.5
const LABEL_H = 31.75
const M_LEFT = 8
const M_TOP = 3
const M_RIGHT = 3

const mm = (v) => Math.round(v * LABEL_DPI / 25.4)

const W = mm(LABEL_W)
const H = mm(LABEL_H)
const X0 = mm(M_LEFT)
const Y0 = mm(M_TOP)
const X1 = W - mm(M_RIGHT)
const UW = X1 - X0

// 값이 비면 '^FD^FS'가 되어 프린터가 거부(No value for name)하므로 공백으로.
const esc = (v) => {
  const t = String(v ?? '').replace(/[\^~]/g, ' ').trim()
  return t === '' ? ' ' : t
}
const raw = (v) => String(v ?? '').replace(/[\^~]/g, ' ').trim()

// ── 배치 ──
const NO_W = mm(6), NO_H = mm(5.2)
const QTY_W = mm(13)
const LOC_W = mm(14.5), LOC_H = mm(5.2)

const PN_LBL_Y = Y0
const PN_VAL_Y = Y0 + mm(2.2)
const DIV_Y = Y0 + mm(7.2)
const ROW2_Y = DIV_Y + mm(1.2)
const MK_L1_Y = ROW2_Y + mm(2.0)
const MK_L2_Y = ROW2_Y + mm(5.0)

const MK_W = UW - LOC_W - mm(2)   // 제조사 영역 — LOC 박스와 겹치지 않게
const LOC_X = X1 - LOC_W

/**
 * 라벨 1장 ZPL
 * row = { no, std_code, labelQty|qty, part, maker, makerPn, location }
 */
export function labelZpl(row) {
  const no = esc(row.no)
  const pn = esc(row.std_code)
  const qty = esc(row.labelQty ?? row.qty)
  const part = String(row.part || '').replace(/[\^~]/g, ' ')
  const maker = raw(row.maker)
  const makerPn = raw(row.makerPn)
  const loc = esc(row.location)

  const out = [
    '^XA', '^CI28',
    `^PW${W}`, `^LL${H}`, '^LH0,0',

    // 1행 — NO 박스(검정) + 흰 숫자
    `^FO${X0},${Y0}^GB${NO_W},${NO_H},${NO_H}^FS`,
    `^FO${X0},${Y0 + mm(1.1)}^FR^A0N,${mm(3.4)},${mm(3.4)}^FB${NO_W},1,0,C^FD${no}^FS`,

    // 품번
    `^FO${X0 + NO_W + mm(2)},${PN_LBL_Y}^A0N,${mm(1.9)},${mm(1.9)}^FDPN^FS`,
    `^FO${X0 + NO_W + mm(2)},${PN_VAL_Y}^A0N,${mm(3.2)},${mm(3.2)}^FB${UW - NO_W - QTY_W - mm(4)},1,0,L^FD${pn}^FS`,

    // 수량 (우측 정렬)
    `^FO${X1 - QTY_W},${PN_LBL_Y}^A0N,${mm(1.9)},${mm(1.9)}^FB${QTY_W},1,0,R^FDQTY${part ? ` (${part})` : ''}^FS`,
    `^FO${X1 - QTY_W},${PN_VAL_Y}^A0N,${mm(3.5)},${mm(3.5)}^FB${QTY_W},1,0,R^FD${qty}^FS`,

    // 구분선
    `^FO${X0},${DIV_Y}^GB${UW},1,2^FS`,

    // 2행 — MAKER
    `^FO${X0},${ROW2_Y}^A0N,${mm(1.6)},${mm(1.6)}^FDMAKER^FS`,
  ]

  // 제조사명과 제조사품번을 각각 다른 줄에 (길어도 겹치지 않음)
  if (maker) out.push(`^FO${X0},${MK_L1_Y}^A0N,${mm(2.4)},${mm(2.4)}^FB${MK_W},1,0,L^FD${maker}^FS`)
  if (makerPn) out.push(`^FO${X0},${MK_L2_Y}^A0N,${mm(2.4)},${mm(2.4)}^FB${MK_W},1,0,L^FD${makerPn}^FS`)
  if (!maker && !makerPn) out.push(`^FO${X0},${MK_L1_Y}^A0N,${mm(2.4)},${mm(2.4)}^FB${MK_W},1,0,L^FD ^FS`)

  // 위치 박스 (검정) — 우측 고정
  out.push(
    `^FO${LOC_X},${ROW2_Y}^GB${LOC_W},${LOC_H},${LOC_H}^FS`,
    `^FO${LOC_X},${ROW2_Y + mm(0.4)}^FR^A0N,${mm(1.5)},${mm(1.5)}^FB${LOC_W},1,0,C^FDLOC^FS`,
    `^FO${LOC_X},${ROW2_Y + mm(2.2)}^FR^A0N,${mm(2.6)},${mm(2.6)}^FB${LOC_W},1,0,C^FD${loc}^FS`,
    '^XZ',
  )
  return out.join('')
}

export function buildLabelZpl(rows) {
  return rows.map((r, i) => labelZpl({ ...r, no: r.no ?? (i + 1) })).join('')
}
