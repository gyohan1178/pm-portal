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
// LOC 는 W7-06-2 처럼 일곱 자라 넓은 자리가 필요하다. 첫 줄 우측에 크게 둔다.
const LOC_W = mm(28), LOC_H = mm(6)
const LOC_X = X1 - LOC_W
// 수량은 '10 EA' 정도로 짧다. 제조사 줄 옆 좁은 자리로 옮긴다.
const QTY_W = mm(17)
const QTY_X = X1 - QTY_W
// 부족 표시 — NO 박스 오른쪽 (LOC 박스와 사이 빈 자리)
const SHORT_X = X0 + NO_W + mm(1.5)
const SHORT_W = mm(14)
const fmtN = (v) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100) }
const MK_W = UW - QTY_W - mm(3)   // 제조사 영역 — 수량과 안 겹치게 (여유 3mm)

// ── 세로 ──
const ROW1_Y = Y0                 // NO 박스 · LOC
const PN_Y = Y0 + mm(6.8)         // 품번 (한 줄 전체)
const DIV_Y = Y0 + mm(13.2)       // 구분선
const MK_L1_Y = DIV_Y + mm(1.4)   // 제조사명
const MK_L2_Y = DIV_Y + mm(6.4)   // 제조사품번
const QTY_Y = DIV_Y + mm(2.2)     // 수량 — 제조사 줄 옆
const ALT_Y = DIV_Y + mm(11.0)    // 맨 아래 — 고객사 승인 대체품 한 줄 (v4.236.0)

/**
 * 라벨 1장 ZPL
 * row = { no, std_code, labelQty|qty, part, maker, makerPn, location, alts? }
 */
export function labelZpl(row) {
  const no = esc(row.no)
  const pn = esc(row.std_code)
  const qty = esc(row.labelQty ?? row.qty)
  const part = String(row.part || '').replace(/[\^~]/g, ' ')
  const maker = raw(row.maker)
  const makerPn = raw(row.makerPn)
  const loc = esc(row.location)
  // ^A0N 글꼴은 폭이 높이의 약 0.55배다. 가운데 정렬에 쓴다.
  const locW = Math.round(loc.length * mm(4.0) * 0.55)
  const isAlt = !!row.isAlt          // 비고로 지정한 대체품
  const short = row.short || null    // 부족 라벨 (v4.239.0) — { need, out }

  // 글자가 길면 폰트를 줄여 잘리지 않게 한다 (15자까지는 그대로, 최소 55%)
  // 글자가 길면 크기를 줄여 넣는다.
  //   0.5 배까지 줄여야 30자 넘는 제조사품번도 들어간다.
  const fit = (text, base = 3.6, limit = 15) => {
    const n = String(text || '').length
    if (n <= limit) return mm(base)
    return mm(Math.max(base * 0.5, base * limit / n))
  }

  const out = [
    '^XA', '^CI28',
    `^PW${W}`, `^LL${H}`, '^LH0,0',

    // 1줄 — NO 박스(검정) + 흰 숫자
    `^FO${X0},${ROW1_Y}^GB${NO_W},${NO_H},${NO_H}^FS`,
    `^FO${X0},${ROW1_Y + mm(1.1)}^FR^A0N,${mm(4.0)},${mm(4.0)}^FB${NO_W},1,0,C^FD${no}^FS`,

    // LOC 박스 (검정) — 첫 줄 우측. 창고에서 가장 먼저 보는 값이다.
    `^FO${LOC_X},${ROW1_Y}^GB${LOC_W},${LOC_H},${LOC_H}^FS`,
    `^FO${LOC_X + Math.max(0, Math.round((LOC_W - locW) / 2))},${ROW1_Y + mm(1.1)}^FR^A0N,${mm(4.0)},${mm(4.0)}^FD${loc}^FS`,

    // 부족 라벨 — NO 와 LOC 사이 검정 「SHORT」 (v4.239.0)
    ...(short ? [
      `^FO${SHORT_X},${ROW1_Y}^GB${SHORT_W},${NO_H},${NO_H}^FS`,
      `^FO${SHORT_X},${ROW1_Y + mm(1.5)}^FR^A0N,${mm(3.2)},${mm(3.2)}^FB${SHORT_W},1,0,C^FDSHORT^FS`,
    ] : []),

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
    const bx = X1 - bw - mm(2)
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

  // 맨 아래 — 고객사 승인 대체품 (row.alts). 없으면 예전 라벨 그대로 (v4.236.0)
  const alts = raw(row.alts)
  if (alts) {
    // 라벨 기본 글꼴(^A0)에 한글 · 가운뎃점이 없을 수 있어 영문 ALT · 「/」 로 찍는다
    const t = `ALT ${alts.replace(/\s*·\s*/g, ' / ')}`
    const fs = t.length <= 34 ? mm(2.4) : mm(Math.max(1.5, 2.4 * 34 / t.length))
    out.push(`^FO${X0},${ALT_Y - mm(0.8)}^GB${UW},1,1^FS`, `^FO${X0},${ALT_Y}^A0N,${fs},${fs}^FB${UW},1,0,L^FD${t}^FS`)
  }

  // 부족 라벨 — 수량 아래 「NEED 10 / OUT 4」 (필요 · 출고 직전 재고로 나간 수)
  if (short) {
    const t = `NEED ${fmtN(short.need)} / OUT ${fmtN(short.out)}`
    const fs = mm(Math.min(2.4, 17 / (t.length * 0.55)))
    out.push(`^FO${QTY_X - mm(6)},${DIV_Y + mm(7.4)}^A0N,${fs},${fs}^FB${QTY_W + mm(6)},1,0,R^FD${t}^FS`)
  }

  // 수량 — 제조사 줄 오른쪽. 짧아서 좁은 자리로 충분하다.
  out.push(
    `^FO${QTY_X},${QTY_Y}^A0N,${mm(4.4)},${mm(4.4)}^FB${QTY_W},1,0,R^FD${qty} EA${part ? ` (${part})` : ''}^FS`,
    '^XZ',
  )
  return out.join('')
}

/**
 * 상위품번 라벨 (v4.239.0) — 라벨 묶음 맨 앞 1장. 어느 ASSY 묶음인지 구분용
 * h = { head: true, title, code, rev, name, units, po, date, items, range }
 *   title: 'ASSY ISSUE' | 'SHORT LIST' · 라벨 글꼴에 한글이 없을 수 있어 영문만 찍는다
 */
export function headerLabelZpl(h) {
  const bar = mm(7)
  const code = raw([h.code, h.rev].filter(Boolean).join(' '))
  // 글자가 한 줄 폭을 넘지 않게 — ^A0 글꼴 폭 ≈ 높이 × 0.55 (여유 0.6)
  const fitW = (n, base, min) => mm(Math.max(min, Math.min(base, (LABEL_W - M_LEFT - M_RIGHT) / (Math.max(1, n) * 0.6))))
  const cs = fitW(code.length, 5.4, 3.2)
  const name = raw(h.name).replace(/[^\x20-\x7E]/g, '').trim()
  const ns = fitW(name.length, 2.8, 1.6)
  const LY = Y0 + mm(19.6)
  const half = Math.round(UW / 2)
  const cell = (x, y, t) => `^FO${x},${y}^A0N,${mm(2.8)},${mm(2.8)}^FB${half},1,0,L^FD${esc(t)}^FS`
  return [
    '^XA', '^CI28', `^PW${W}`, `^LL${H}`, '^LH0,0',
    `^FO${X0},${Y0}^GB${UW},${bar},${bar}^FS`,
    `^FO${X0 + mm(1.5)},${Y0 + mm(1.5)}^FR^A0N,${mm(4.2)},${mm(4.2)}^FD${esc(h.title)}^FS`,
    `^FO${X0},${Y0 + mm(1.5)}^FR^A0N,${mm(4.2)},${mm(4.2)}^FB${UW - mm(1.5)},1,0,R^FD${esc(h.date)}^FS`,
    `^FO${X0},${Y0 + mm(8.4)}^A0N,${cs},${cs}^FB${UW},1,0,L^FD${esc(code)}^FS`,
    `^FO${X0},${Y0 + mm(15.2)}^A0N,${ns},${ns}^FB${UW},1,0,L^FD${esc(name)}^FS`,
    `^FO${X0},${LY}^GB${UW},2,3^FS`,
    cell(X0, LY + mm(1.4), `QTY ${fmtN(h.units)} SET`),
    cell(X0 + half, LY + mm(1.4), h.po ? `PO ${h.po}` : ' '),
    cell(X0, LY + mm(5.0), h.items),
    cell(X0 + half, LY + mm(5.0), h.range),
    '^XZ',
  ].join('')
}

export function buildLabelZpl(rows) {
  return rows.map((r, i) => (r.head ? headerLabelZpl(r) : labelZpl({ ...r, no: r.no ?? (i + 1) }))).join('')
}
