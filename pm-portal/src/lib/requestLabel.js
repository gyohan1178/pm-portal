// 자재요청 → ZM400 라벨 (v4.81.0)
//   출고 라벨(lib/labelZpl.js)과 같은 모양 — NO · 위치 · 품번 · 제조사 · 제조사품번 · 수량
//   NO 는 「🖨 출력」 요청서의 번호와 같다 (요청서 인쇄 함수 pm_request_print 의 순서 = 위치순)
//   빠지는 줄: 기준코드 없는 줄(품명만 적은 요청) · 위치가 「라벨」인 라벨/스티커류 · 수량 0
//   수량: 불출한 줄은 불출 수량, 아직이면 요청 수량
export function requestLabelRows(printRows, checked) {
  const byKey = new Map((checked || []).map((c) => [`${c.req_no}|${c.std_code}`, c]))
  const labels = [], skipped = []
  ;(printRows || []).forEach((r, i) => {
    const c = byKey.get(`${r.req_no}|${r.std_code}`)
    const issued = Number(c?.issued_qty) || 0
    const qty = issued > 0 ? issued : Number(r.qty) || 0
    const why = !String(r.std_code || '').trim() ? '기준코드 없음'
      : String(r.location || '').trim() === '라벨' ? '라벨류'
      : !(qty > 0) ? '수량 0' : ''
    if (why) { skipped.push({ no: i + 1, code: r.std_code || r.item_name || '', why }); return }
    labels.push({
      no: i + 1, std_code: r.std_code, labelQty: qty,
      maker: r.maker || '', makerPn: r.maker_code || '', location: r.location || '',
    })
  })
  return { labels, skipped }
}

// Zebra Browser Print 로 보내기 — 성공하면 resolve, 아니면 알기 쉬운 문구로 reject
export function sendZplToPrinter(zpl) {
  return new Promise((resolve, reject) => {
    const BP = typeof window !== 'undefined' ? window.BrowserPrint : null
    if (!BP) { reject(new Error('Zebra Browser Print가 설치/실행되어 있지 않습니다. (PC에 설치 후 재시도)')); return }
    BP.getDefaultDevice('printer', (device) => {
      if (!device) { reject(new Error('기본 프린터를 찾을 수 없습니다. Browser Print에서 ZM400을 등록하세요.')); return }
      device.send(zpl, () => resolve(), (err) => reject(new Error('라벨 전송 실패: ' + err)))
    }, (err) => reject(new Error('프린터 연결 실패: ' + err)))
  })
}
