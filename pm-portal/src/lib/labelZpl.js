// ZM400 라벨 ZPL 생성 (63.5 x 31.75mm)
//
// ★ DPI 주의: 같은 좌표라도 203dpi와 300dpi에서 크기가 다르다.
//   좌표를 mm로 정의하고 프린터 DPI에 맞춰 dot으로 환산한다.
//   ZM400 300dpi 모델은 LABEL_DPI=300. 203dpi 모델이면 203으로 바꾸면 된다.
//
// 배치 (위→아래)
//   1줄  NO 박스 · QTY (우측)
//   2줄  품번 — 한 줄 전체를 쓴다 (길어도 겹치지 않게)
//   ───  구분선
//   3줄  제조사명
//   4줄  제조사품번            + LOC 박스(우측 고정)
export const LABEL_DPI = 300

const LABEL_W = 63.5
const LABEL_H = 31.75
const M_LEFT = 8      // 프린터 좌측이 잘려 여유를 크게
const M_TOP = 2.5
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

// ── 가로 ──
const NO_W = mm(7), NO_H = mm(6)
const QTY_W = mm(24)
// W7-06-2 처럼 W 가 들어가면 좁아서 잘렸다. 두 글자 더 들어갈 만큼 넓힌다.
const LOC_W = mm(26), LOC_H = mm(7.5)
const LOC_X = X1 - LOC_W
const MK_W = UW - LOC_W - mm(2)   // 제조사 영역 — LOC 박스와 안 겹치게

// ── 세로 ──
const ROW1_Y = Y0                 // NO 박스 · QTY
const PN_Y = Y0 + mm(6.8)         // 품번 (한 줄 전체)
const DIV_Y = Y0 + mm(13.2)       // 구분선
const MK_L1_Y = DIV_Y + mm(1.4)   // 제조사명
const MK_L2_Y = DIV_Y + mm(6.4)   // 제조사품번
const LOC_Y = DIV_Y + mm(1.2)     // LOC 박스

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
  const isAlt = !!row.isAlt          // 비고로 지정한 대체품

  // 글자가 길면 폰트를 줄여 잘리지 않게 한다 (15자까지는 그대로, 최소 55%)
  const fit = (text, base = 3.6, limit = 15) => {
    const n = String(text || '').length
    if (n <= limit) return mm(base)
    return mm(Math.max(base * 0.55, base * limit / n))
  }

  const out = [
    '^XA', '^CI28',
    `^PW${W}`, `^LL${H}`, '^LH0,0',

    // 1줄 — NO 박스(검정) + 흰 숫자
    `^FO${X0},${ROW1_Y}^GB${NO_W},${NO_H},${NO_H}^FS`,
    `^FO${X0},${ROW1_Y + mm(1.1)}^FR^A0N,${mm(4.0)},${mm(4.0)}^FB${NO_W},1,0,C^FD${no}^FS`,

    // QTY (우측) — 라벨과 값을 한 줄에
    `^FO${X1 - QTY_W},${ROW1_Y + mm(1.4)}^A0N,${mm(4.4)},${mm(4.4)}^FB${QTY_W},1,0,R^FD${qty} EA${part ? ` (${part})` : ''}^FS`,

    // 2줄 — 품번. 한 줄 전체를 써서 길어도 겹치지 않는다
    `^FO${X0},${PN_Y}^A0N,${mm(5.0)},${mm(5.0)}^FB${UW},1,0,L^FD${pn}^FS`,

    // 구분선
    `^FO${X0},${DIV_Y}^GB${UW},2,3^FS`,
  ]

  // 3·4줄 — 제조사명 / 제조사품번 (각각 다른 줄이라 길어도 안 겹침)
  // 대체품이면 MAKER 자리 옆에 배지를 찍어 현장에서 바로 구분되게 한다
  if (isAlt) {
    // 구분선 바로 위, 수량 왼쪽 빈 자리에 배지
    const bw = mm(12), bh = mm(3.2)
    const bx = X1 - QTY_W - bw - mm(2)
    const by = DIV_Y - bh - mm(0.8)
    out.push(
      `^FO${bx},${by}^GB${bw},${bh},${bh}^FS`,
      `^FO${bx},${by + mm(0.5)}^FR^A0N,${mm(2.2)},${mm(2.2)}^FB${bw},1,0,C^FD대체품^FS`,
    )
  }

  // 제조사명 / 제조사품번을 각각 다른 줄에. 15자를 넘으면 폰트를 자동 축소.
  if (maker) out.push(`^FO${X0},${MK_L1_Y}^A0N,${fit(maker)},${fit(maker)}^FB${MK_W},1,0,L^FD${maker}^FS`)
  if (makerPn) {
    // 제조사가 없으면(대체품 품번만) 위쪽 줄에 찍는다
    const y = maker ? MK_L2_Y : MK_L1_Y
    out.push(`^FO${X0},${y}^A0N,${fit(makerPn)},${fit(makerPn)}^FB${MK_W},1,0,L^FD${makerPn}^FS`)
  }
  if (!maker && !makerPn) out.push(`^FO${X0},${MK_L1_Y}^A0N,${mm(3.6)},${mm(3.6)}^FB${MK_W},1,0,L^FD ^FS`)

  // LOC 박스 (검정) — 우측 고정
  out.push(
    `^FO${LOC_X},${LOC_Y}^GB${LOC_W},${LOC_H},${LOC_H}^FS`,
    `^FO${LOC_X},${LOC_Y + mm(0.5)}^FR^A0N,${mm(1.8)},${mm(1.8)}^FB${LOC_W},1,0,C^FDLOC^FS`,
    `^FO${LOC_X},${LOC_Y + mm(2.6)}^FR^A0N,${mm(3.8)},${mm(3.8)}^FB${LOC_W},1,0,C^FD${loc}^FS`,
    '^XZ',
  )
  return out.join('')
}

export function buildLabelZpl(rows) {
  return rows.map((r, i) => labelZpl({ ...r, no: r.no ?? (i + 1) })).join('')
}
