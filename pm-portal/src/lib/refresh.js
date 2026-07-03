// 저장 후 관련 화면을 한 번에 갱신 — 쿼리키가 페이지마다 달라 생기는 "여긴 갱신 저긴 새로고침" 문제 해결.
// 발주/입고/출고 등 조달 데이터가 바뀌면 이 함수 하나만 호출하면 됨.
export function refreshProcurement(qc) {
  ;['purchase','shortage','shortageMonthly','reqbom','inventory','pendingPOs',
    'cpo','allpo','forecastShortage','inboundHistory','outboundHistory','picking']
    .forEach(k => qc.invalidateQueries({ queryKey: [k] }))
}

// 기초자료(품목·협력사·단가) 변경 시
export function refreshMasters(qc) {
  ;['items','vendors','price','priceHistory'].forEach(k => qc.invalidateQueries({ queryKey: [k] }))
}
