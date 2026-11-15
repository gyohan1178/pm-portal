// v4.186.1 — 저장해 둔 부품표(견적 접수 → 견적 작성)에 품목 마스터 L/T · MOQ 가 붙는지
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
  await p.goto('http://localhost:8765/app.html?r=/'); await p.waitForTimeout(1500)
  const r = await p.evaluate(async () => {
    const S = window.__S, q = window.__qpp
    S.DATA.items.push({ id: 'lt1', std_code: 'TMP-2611-0001', name: 'APC SMT750RM2UC', unit: 'EA', manufacturer: 'APC', manufacturer_code: 'SMT750RM2UC', purchase_price: 450000, lt_weeks: 2, moq: 5 },
                      { id: 'lt2', std_code: 'TMP-2611-0002', name: 'HPS C1F1C0WES', unit: 'EA', purchase_price: 548400, lt_weeks: 12 },
                      { id: 'lt3', std_code: 'TMP-2611-0003', name: 'NO LT', unit: 'EA', purchase_price: 100 })
    const pp = { labor: 0, parts: [
      { maker: 'APC', mpn: 'SMT750RM2UC', name: 'APC SMT750RM2UC', qty: 1, unit: 'EA', item_id: 'lt1', std_code: 'TMP-2611-0001', price: 450000, src: '구매 입력' },
      { maker: 'HPS', mpn: 'C1F1C0WES', name: 'HPS C1F1C0WES', qty: 1, unit: 'EA', item_id: 'lt2', std_code: 'TMP-2611-0002', price: 548400, src: '실적가' },
      { maker: '', mpn: 'X', name: 'NO LT', qty: 1, unit: 'EA', item_id: 'lt3', std_code: 'TMP-2611-0003', price: 100, src: '실적가' },
      { maker: 'ZZ', mpn: 'UNREG-1', name: '미등록', qty: 2, unit: 'EA', item_id: null, std_code: '', price: null, src: null }] }
    const before = q.partsFromPaste(q.pasteToMatched(pp)).map((x) => x.lt)
    const m = await q.hydratePasteItems(q.pasteToMatched(pp))
    const parts = q.partsFromPaste(m)
    const n0 = (S.READLOG || []).length; await q.hydratePasteItems(m); const again = (S.READLOG || []).length - n0
    return { before, lt: parts.map((x) => x.lt), moq: parts.map((x) => x.moq), price: parts.map((x) => x.buyKrw), names: parts.map((x) => x.name), again }
  })
  ok(r.before.every((x) => x == null), '고치기 전 재현 — 저장된 부품표는 L/T 가 전부 비어 있음', r.before)
  ok(JSON.stringify(r.lt) === '[2,12,null,null]', '품목 마스터 L/T 가 붙음 (2W · 12W · 없는 품목 · 미등록은 빈칸)', r.lt)
  ok(r.moq[0] === 5, 'MOQ 도 붙음', r.moq)
  ok(JSON.stringify(r.price) === '[450000,548400,100,null]' && r.names[3] === '미등록', '단가 · 이름 · 미등록 부품은 그대로', r)
  ok(r.again === 0, '이미 붙인 것은 다시 묻지 않음', r.again)
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t117 ${pass}/${pass + fail} 통과`); await b.close()
})()
