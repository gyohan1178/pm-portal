import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { S, client } from './mocksb2.js'
client.auth.getSession = async () => ({ data: { session: { user: new URLSearchParams(location.search).get('asbae') ? { id: 'u-bae', email: 'bae@jinsuntech.co.kr' } : { id: 'u1', email: 'gyohan@jinsuntech.co.kr' } } } })
import App from '../../src/App.jsx'
import Toaster from '../../src/components/Toaster.jsx'
import * as __sameItem from '../../src/lib/sameItem.js'
import * as __cellAux from '../../src/lib/cellAux.js'
import * as __stockLookup from '../../src/lib/stockLookup.js'
import * as __issueAssy from '../../src/lib/issueAssy.js'
window.__ia = __issueAssy
import * as __qpp from '../../src/lib/quotePartsPaste.js'
window.__qpp = __qpp
import * as __usage from '../../src/lib/usage.js'
window.__usage = __usage
const ME = { id: 'u1', email: 'gyohan@jinsuntech.co.kr', name: '김교한', role: 'admin', status: 'approved', menu_scope: null, dept: '구매자재', is_lead: true }
if (new URLSearchParams(location.search).get('fav')) ME.menu_favorites = ['/', '/inbound']
if (new URLSearchParams(location.search).get('ctonly')) ME.menu_scope = ['home', 'buy', '-flow']
if (new URLSearchParams(location.search).get('asbae')) Object.assign(ME, { id: 'u-bae', email: 'bae@jinsuntech.co.kr', name: '배솔', is_lead: false, role: 'editor' })
const _me = new URLSearchParams(location.search).get('me'); if (_me) Object.assign(ME, JSON.parse(_me))
// 로그인 · 로그아웃 흉내 — ?authsim=1 (v4.115.1 확인용)
if (new URLSearchParams(location.search).get('authsim')) {
  let sess = null; const subs = new Set(); window.__authCalls = { getUser: 0, getSession: 0 }
  const users = { 'gyohan@jinsuntech.co.kr': 'u1', 'nam@jinsuntech.co.kr': 'u2' }
  const fire = (ev) => subs.forEach((cb) => cb(ev, sess))
  Object.assign(client.auth, {
    getSession: async () => { window.__authCalls.getSession++; return { data: { session: sess } } },
    getUser: async () => { window.__authCalls.getUser++; return { data: { user: sess?.user || null } } },
    onAuthStateChange: (cb) => { subs.add(cb); return { data: { subscription: { unsubscribe() { subs.delete(cb) } } } } },
    signInWithPassword: async ({ email, password }) => { const id = users[email]; if (!id || password !== 'pw') return { data: {}, error: { message: 'Invalid login credentials' } }; sess = { user: { id, email } }; setTimeout(() => fire('SIGNED_IN'), 0); return { data: { session: sess }, error: null } },
    signOut: async () => { sess = null; setTimeout(() => fire('SIGNED_OUT'), 0); return { error: null } },
  })
  window.__authsim = true
}
const _slow = new URLSearchParams(location.search).get('slow'); if (_slow) S.DELAY = +_slow   // 느린 연결 흉내 (스켈레톤 확인)
const now = new Date().toISOString()
const items = [
  { id: 'a1', std_code: 'AX-110153030', name: 'ASSY MAIN PD', js_code: 'JS-AS0001', category: '조립도_도면', type: '자재', unit: 'EA', manufacturer: '진선테크', manufacturer_code: 'ECK114161001' },
  { id: 'a2', std_code: 'AX-110158840', name: 'ASSY PWR DIST EFEM', js_code: 'JS-AS0002', category: '조립도_도면', type: '자재', unit: 'EA' },
  { id: 'p1', std_code: 'AX-5100052', name: 'SCREW PAN HD M4X8', js_code: 'JS-HW0001', category: '부품', type: '자재', unit: 'EA', manufacturer: 'MISUMI', manufacturer_code: 'SPHS-M4-8', purchase_price: 50 },
  { id: 'p2', std_code: 'AX-6200111', name: 'CIRCUIT BREAKER 3P 20A', js_code: 'JS-BK0001', category: '부품', type: '자재', unit: 'EA', manufacturer: 'LS산전', manufacturer_code: 'BKN-3P-20A', purchase_price: 32000 },
]
S.DATA = {
  pm_profiles: [ME, ...(new URLSearchParams(location.search).get('authsim') ? [{ id: 'u2', email: 'nam@jinsuntech.co.kr', name: '남기문', role: 'viewer', status: 'approved', dept: '구매자재', menu_scope: null, is_lead: false }] : [])], items, customers: [{ id: 'cid-ax', code: 'ax', name: 'AXCELIS', color: '#8b5cf6' }, { id: 'cid-ed', code: 'ed', name: 'Edwards' }, { id: 'cid-vm', code: 'vm', name: 'VM' }, { id: 'cid-csk', code: 'csk', name: 'CSK' }],
  pm_settings: [{ key: 'quote_margin', value: { sellRate: 1400 } }],
  pm_order: [
    { id: 'o1', customer_code: 'AX', po_no: '47894KF', ccn: 'K', ship_to: '평택 MFK', registered_at: now, registered_name: '김교한', currency: 'KRW', source: 'pdf', confirmed_at: now, kind: 'po' },
    { id: 'o2', customer_code: 'VM', po_no: 'PO2610000242', ship_to: '이천', registered_at: '2026-10-10T01:00:00Z', currency: 'KRW', source: 'pdf', kind: 'po' },
  ],
  pm_order_line: [
    { id: 'l1', order_id: 'o1', line_no: '2', del_line: '1', item_id: 'a1', rev: 'P', qty: 3, delivered_qty: 0, due_date: '2026-12-30', unit_price: 1000000, reply: '조건부', reply_memo: 'EFEM 판금 11/27 입고' },
    { id: 'l2', order_id: 'o2', line_no: '1', del_line: '1', item_id: null, raw_pn: '790-3003-320', raw_desc: 'EDA PC ETHERNET', qty: 11, delivered_qty: 0, due_date: '2026-11-20', unit_price: 48000 },
  ],
  purchase_orders: [{ id: 'po1', customer_id: 'cid-ax', item_id: 'p2', order_type: 'purchase', po_number: 'JS-261020-01', qty_ordered: 10, qty_received: 0, qty_remaining: 10, unit_price: 32000, promise_date: '2026-11-03', status: '진행중', order_date: '2026-10-20', vendor_id: 'v1' },
    ...(new URLSearchParams(location.search).get('d13') ? [] : []),
    { id: 'po2', customer_id: 'cid-ax', item_id: 'p1', order_type: 'purchase', po_number: 'JS-261008-03', qty_ordered: 50, qty_received: 0, qty_remaining: 50, unit_price: 65, promise_date: '2026-10-21', status: '진행중', order_date: '2026-10-08', vendor_id: 'v2' },
    { id: 'po3', customer_id: 'cid-ax', item_id: 'p1', order_type: 'purchase', po_number: 'JS-261009-01', qty_ordered: 30, qty_received: 0, qty_remaining: 30, unit_price: 50, promise_date: '2026-10-20', status: '진행중', order_date: '2026-10-09', vendor_id: 'v2', vendor_date: '2099-11-04', vendor_date_reason: '제조사 백오더' }],
  price_history: [{ id: 'ph1', item_id: 'p1', price: 50, recorded_at: '2026-09-01T00:00:00Z' }, { id: 'ph2', item_id: 'p2', price: 32000, recorded_at: '2026-09-01T00:00:00Z' }],
  pm_po_date_log: [],
  vendors: [{ id: 'v1', name: '파워일렉' }, { id: 'v2', name: '로이코' }],
  inventory: [{ id: 'iv1', item_id: 'p1', qty: 120, location: 'A-01-02' }, { id: 'iv2', item_id: 'p2', qty: 3, location: 'B-02-01' }],
  projects: [{ id: 'pj1', customer_id: 'cid-ax', code: 'AX-110153030', name: 'ASSY MAIN PD', rev: 'B' }],
  bom: [{ id: 'b1', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'p1', level: 1, qty_per_unit: 4, seq: 1 }, { id: 'b2', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'p2', level: 1, qty_per_unit: 1, seq: 2 }],
  production: [{ id: 'pd1', customer_code: 'AX', pn: 'AX-110153030', name: 'ASSY MAIN PD', hogi: '#12', status: '제작중', req_date: '2026-11-05', missing_parts: [] }],
  pm_material_request: [{ id: 'mr1', status: '요청', requester_name: '천석훈', dept: '하네스', created_at: now, items: [] }],
  pm_doc_request: [
    { id: 1, kind: '도면', customer_code: 'AX', item_id: 'a2', part_no: 'AX-110158840', item_name: 'ASSY PWR DIST EFEM', rev: 'C', need_date: '2026-10-28', from_dept: '구매자재', also_depts: [], requester_name: '김교한', status: 1, cancelled: false, history: [], created_at: '2026-10-22T01:00:00Z' },
    { id: 2, kind: 'BOM', customer_code: 'ED', item_id: null, part_no: 'ED-NRYBVU400', item_name: 'SAG CONTROL RACK', need_date: '2026-10-30', from_dept: '구매자재', also_depts: [], status: 0, cancelled: false, history: [], created_at: '2026-10-23T01:00:00Z' },
    { id: 3, kind: '도면', customer_code: 'AX', item_id: null, part_no: 'AX-5102060', item_name: 'SHELL 9P', rev: 'B', need_date: '2026-10-27', from_dept: '품질', also_depts: [], status: 0, cancelled: false, history: [], created_at: '2026-10-24T01:00:00Z' },
    { id: 4, kind: '사양서', customer_code: 'AX', item_id: 'p2', part_no: 'AX-6200111', item_name: 'CIRCUIT BREAKER 3P 20A', need_date: '2026-11-05', from_dept: '생산기술', also_depts: [], status: 2, cancelled: false, recv_note: 'NAS/사양서/6200111.pdf', history: [], created_at: '2026-10-20T01:00:00Z' },
    { id: 5, kind: '도면', customer_code: 'CSK', item_id: null, part_no: 'CS-SCS0195S', item_name: 'CSK 하네스', rev: '2', need_date: '2026-10-20', from_dept: '제조', also_depts: [], status: 1, cancelled: false, history: [], created_at: '2026-10-15T01:00:00Z' },
  ],
  pm_drawing_dist: [{ id: 'dd1', seq: 1, drawing_no: '110158840', item_name: 'EFEM', rev: 'B', vendor_name: '컴윈스', dist_date: '2026-10-20', status: '대기', approval_type: '사후기록', dept: '구매자재팀' }],
}
const _qs = new URLSearchParams(location.search)
// ⑬ · 자료 요청 예시는 그 시험에서만 (예전 시험의 기준 숫자가 바뀌지 않게) — ?d13=1 · ?doc=1
if (!_qs.get('d13')) S.DATA.purchase_orders = S.DATA.purchase_orders.filter((p) => p.id === 'po1')
if (_qs.get('duemock')) { const P = S.DATA.purchase_orders; const a3 = P.find((x) => x.id === 'po3'); if (a3) a3.vendor_date = '2026-11-03'; const a2 = P.find((x) => x.id === 'po2'); if (a2) { a2.vendor_date = '2026-10-25'; a2.vendor_date_reason = '운송 지연' } }
if (!_qs.get('doc')) S.DATA.pm_doc_request = []
// v4.171.0 품목 승인 제조사 · REV — ?imeta=1
if (_qs.get('imeta')) {
  S.DATA.pm_item_mfr = [
    { id: 1, item_id: 'p1', mfr: 'MISUMI', mfr_pn: 'SPHS-M4-8', status: 'Preferred', active: true, src_code: '110153030 M.40', src_ver: 'B.3', last_seen: '2026-11-10' },
    { id: 2, item_id: 'p1', mfr: 'NBK', mfr_pn: 'SPS-M4X8', status: 'Approved', active: true, src_code: '110153030 M.40', src_ver: 'B.3', last_seen: '2026-11-10' },
    { id: 3, item_id: 'p1', mfr: 'OLD CO', mfr_pn: 'OLD-1', status: 'Approved', active: false, off_on: '2026-11-10' },
    { id: 4, item_id: 'p2', mfr: 'EATON', mfr_pn: 'FAZ-C20/3', status: 'Approved', active: true },
    { id: 5, item_id: 'a1', mfr: 'NBK', mfr_pn: 'SPS-M4X8', status: 'Approved', active: true },
  ]
  S.DATA.pm_item_rev = [
    { id: 1, item_id: 'p1', ver: 'B.3', vkey: '1B000003', src_code: '110153030 M.40', first_seen: '2026-11-10' },
    { id: 2, item_id: 'p1', ver: 'A.9', vkey: '1A000009', src_code: '기존 BOM', first_seen: null },
  ]
}
if (_qs.get('ptmiss')) S.MISSING = ['pm_prod_group', 'pm_prod_target', 'pm_prod_order_v', 'pm_prod_link_sum_v', 'pm_line_prod_v']
// 1000행 제한 흉내 — ?cap=1 : 한 번에 1000행까지만 · pm_sales 2,500행(2026년 · 100만원씩 = 25억)
if (_qs.get('cap')) {
  S.MAXROWS = 1000
  S.DATA.pm_sales = Array.from({ length: 2500 }, (_, i) => ({ id: 'ps' + String(i).padStart(5, '0'), part_no: '110153030', qty: 1, unit_price: 1000000, ccn: 'K', promise_date: '2026-0' + (1 + (i % 9)) + '-15', status_note: '', customer_code: 'AX', updated_at: now }))
}
// v4.102.0 생산관리 대상 · 매칭 — ?pt=1
if (_qs.get('pt')) {
  S.DATA.pm_prod_group = [{ id: 1, customer_code: 'AX', name: '주요품목', color: 'violet', sort: 1 }, { id: 2, customer_code: 'AX', name: 'Sub 품목', color: 'blue', sort: 2 }, { id: 3, customer_code: 'AX', name: '3rd party', color: 'amber', sort: 3 }, { id: 4, customer_code: 'CSK', name: '주요품목', color: 'violet', sort: 1 }]
  S.DATA.pm_prod_target = [{ id: 11, customer_code: 'AX', item_id: 'a1', pn: 'AX-110153030', group_id: 1, active: true }]
  S.DATA.purchase_orders.push(
    { id: 'cp1', customer_id: 'cid-ax', item_id: 'a1', order_type: 'customer_po', po_number: '47894KF', order_line: '2', del_line: '1', qty_ordered: 3, status: '진행중', promise_date: '2026-12-30' },
    { id: 'cp2', customer_id: 'cid-ax', item_id: 'a2', order_type: 'customer_po', po_number: '47900KF', order_line: '1', del_line: '1', qty_ordered: 2, status: '진행중', promise_date: '2027-01-10' })
  S.DATA.production.push(
    { id: 'pd2', customer_code: 'AX', pn: '110153030', name: 'ASSY MAIN PD', hogi: '#13', status: 'PO접수', req_date: '2026-12-30', po_id: 'cp1', missing_parts: [] },
    { id: 'pd3', customer_code: 'AX', pn: '110158840', name: 'ASSY PWR DIST EFEM', hogi: '#1', status: 'PO접수', req_date: '2027-01-10', po_id: null, missing_parts: [] },
    { id: 'pc1', customer_code: 'CSK', pn: 'CS-MCK14340-00', name: 'Gas Sensor', hogi: 'JS2609-18', status: '제작중', csk: { plnd: 'PL001' }, missing_parts: [] },
    { id: 'pv1', customer_code: 'VM', pn: 'Nardo', name: '3by2', hogi: 'EM3A76', status: '자재발주', missing_parts: [] })
  S.DATA.production.push(
    { id: 'pe1', customer_code: 'ED', pn: 'Gen2 Plus Hynix', name: 'Gen2 Plus Hynix', hogi: '#29', status: 'PO접수', part: 'EUV', missing_parts: [] },
    { id: 'pe2', customer_code: 'ED', pn: 'Gen2 Plus SS Nova PPM', name: 'Gen2 Plus SS Nova PPM', hogi: '#13', status: 'PO접수', part: 'EUV', missing_parts: [] },
    { id: 'pe3', customer_code: 'ED', pn: 'BLENDER BOX Rev.3 OMT', name: 'BLENDER BOX Rev.3 OMT', hogi: '#12', status: 'PO접수', part: 'MFM', missing_parts: [] })
  S.DATA.pm_prod_link_sum_v = [
    { id: 'pd1', customer_code: 'AX', n_lines: 1, pos: '47894KF', guess: false }, { id: 'pd2', customer_code: 'AX', n_lines: 1, pos: '47894KF', guess: false },
    { id: 'pe1', customer_code: 'ED', n_lines: 120, pos: '6001207741, 6001207742', guess: false }, { id: 'pe2', customer_code: 'ED', n_lines: 14, pos: '6001300001', guess: true }]
  S.DATA.pm_line_prod_v = [{ id: 'l1', customer_code: 'AX', hogis: '#13 #12', n_prod: 2, any_open: true, guess: false, prod_pns: '110153030' }]
}
// v4.101.0 자료 요청 직접 입력 — ?docetc=1 : 품번 없는 「CN 내역」 요청 (사유 긴 글)
if (_qs.get('docetc')) S.DATA.pm_doc_request.push({ id: 9, kind: '기타', kind_label: 'CN 내역', customer_code: 'AX', item_id: null, part_no: '', need_date: '2026-11-05', reason: 'EFEM PD 리뉴얼 설계변경 이력 확인 — 초도품 성적서에 넣어야 함. 110158840 → 110219638 변경점 전체', from_dept: '품질', also_depts: [], requester_name: '박품질', status: 0, cancelled: false, history: [], created_at: '2026-10-26T01:00:00Z' })
// v4.198.0 수주대장 미확인 PO 기준 — ?unconf=1 : Edwards PO 2건(납기 먼 것 · 7주 안) · 기타 PO 2건(4주 안 · 먼 것) · AX PO 1건
if (_qs.get('unconf')) {
  const reg = '2026-11-02T01:00:00Z'
  const mk = (id, cust, po, extra = {}) => S.DATA.pm_order.push({ id, customer_code: cust, po_no: po, registered_at: reg, order_date: '2026-11-02', currency: 'KRW', source: 'pdf', kind: 'po', confirmed_at: null, migrated: false, planned: false, ...extra })
  const ln = (id, oid, n, due) => S.DATA.pm_order_line.push({ id, order_id: oid, line_no: String(n), del_line: '1', item_id: null, raw_pn: 'UC-' + id, raw_desc: 'UNCONF ' + id, qty: 2, delivered_qty: 0, due_date: due, unit_price: 1000 })
  mk('uo1', 'ED', 'UC-ED-FAR'); for (let i = 1; i <= 20; i++) ln('ue1_' + i, 'uo1', i, '2027-02-26')      // 납기 − 49 = 2027-01-08 → 확인 예정
  mk('uo2', 'ED', 'UC-ED-NEAR'); for (let i = 1; i <= 15; i++) ln('ue2_' + i, 'uo2', i, '2026-12-28')     // 납기 − 49 = 2026-11-09 → 미확인
  mk('uo3', 'ETC', 'UC-ETC-NEAR', { customer_name: '남일' }); for (let i = 1; i <= 3; i++) ln('ux3_' + i, 'uo3', i, '2026-12-01')   // 4주 안 → 미확인
  mk('uo4', 'ETC', 'UC-ETC-FAR', { customer_name: '두웰' }); for (let i = 1; i <= 2; i++) ln('ux4_' + i, 'uo4', i, '2027-01-20')    // 확인 예정
  mk('uo5', 'AX', 'UC-AX-1'); ln('ua5_1', 'uo5', 1, '2027-03-01')                                          // AX 는 납기와 상관없이 미확인
}
// v4.101.0 수주대장 특이사항 확인 — ?odd=1 : 같은 품목(a1)의 앞선 PO(Rev N · 단가 80만) → l1 이 Rev N→P · 단가 +25%
if (_qs.get('odd')) {
  S.DATA.pm_order.push({ id: 'o0', customer_code: 'AX', po_no: '47001KF', ccn: 'K', registered_at: '2026-08-01T01:00:00Z', order_date: '2026-08-01', currency: 'KRW', source: 'pdf', kind: 'po' })
  S.DATA.pm_order_line.push({ id: 'l0', order_id: 'o0', line_no: '1', del_line: '1', item_id: 'a1', rev: 'N', qty: 1, delivered_qty: 1, due_date: '2026-09-01', unit_price: 800000 })
}
// v4.103.0 수주대장 빠르게 — ?fastx=1 : 납품 끝난 줄 · 취소 줄 · 다 끝난 PO 더함 · ?proj=1 고른 칸만 · ?nov=1 보기 없음(SQL 전) · ?nocol=1 확인 · BREV 칸 없음
if (_qs.get('fastx')) {
  S.DATA.pm_order_line.push(
    { id: 'l1b', order_id: 'o1', line_no: '3', del_line: '1', item_id: 'a2', rev: 'C', qty: 2, delivered_qty: 2, due_date: '2026-10-01', unit_price: 500000, reply: '가능' },
    { id: 'l1c', order_id: 'o1', line_no: '4', del_line: '1', item_id: 'p1', qty: 5, delivered_qty: 0, due_date: '2026-11-01', unit_price: 50, cancelled: true })
  S.DATA.pm_order.push({ id: 'o3', customer_code: 'VM', po_no: 'PO-DONE-1', ship_to: '이천', registered_at: '2026-05-01T01:00:00Z', order_date: '2026-05-01', currency: 'KRW', source: 'pdf', kind: 'po' })
  S.DATA.pm_order_line.push({ id: 'l3', order_id: 'o3', line_no: '1', del_line: '1', item_id: null, raw_pn: '790-1111-000', raw_desc: 'OLD CABLE', qty: 1, delivered_qty: 1, due_date: '2026-06-01', unit_price: 70000 })
  const l1 = S.DATA.pm_order_line.find((l) => l.id === 'l1'); l1.brev = 'B7'
  if (_qs.get('okd')) { l1.odd_ok = 'R:N>P|P:800000>1000000'; l1.odd_ok_name = '김교한'; l1.odd_ok_at = now }
}
// v4.103.0 BOM 목록 빠르게 — ?bomx=1 : AXCELIS 어셈블리 1,200개 (한 번에 1,000행 제한 흉내)
if (_qs.get('bomx')) {
  S.MAXROWS = 1000
  const asm = Array.from({ length: 1200 }, (_, i) => ({ id: 'pj' + String(i).padStart(5, '0'), code: 'AX-11' + String(i).padStart(7, '0'), name: '', rev: 'A', created_at: '2026-01-01T00:00:00Z', item_count: 3 }))
  window.__bomAsm = asm
  S.DATA.projects = asm.map((a) => ({ id: a.id, customer_id: 'cid-ax', code: a.code, start_date: '2026-10-0' + (1 + (+a.id.slice(2) % 9)) }))
  S.DATA.items.push(...asm.map((a, i) => ({ id: 'ai' + i, std_code: a.code, name: 'ASSY ' + i })))
}
// v4.110.0 수주대장 납품 → CSK 생산관리 — ?csk=1
if (_qs.get('csk')) {
  S.DATA.pm_order.push(
    { id: 'oc1', customer_code: 'CSK', po_no: '6001363811', ship_to: '안성', registered_at: '2026-10-20T01:00:00Z', currency: 'KRW', source: 'pdf', kind: 'po' },
    { id: 'oc2', customer_code: 'CSK', po_no: '6001363812', ship_to: '안성', registered_at: '2026-10-20T01:00:00Z', currency: 'KRW', source: 'pdf', kind: 'po' },
    { id: 'ocp', customer_code: 'CSK', po_no: 'PLAN-11', registered_at: '2026-10-01T01:00:00Z', currency: 'KRW', source: 'manual', kind: 'planned', planned: true })
  S.DATA.pm_order_line.push(
    { id: 'lc1', order_id: 'oc1', line_no: '00010', del_line: '1', item_id: null, raw_pn: 'SCS0195S-0L1-ON055', raw_desc: 'CSK KIT', qty: 1, delivered_qty: 0, due_date: '2026-11-10', unit_price: 3502200, plnd_no: 'PLX1' },
    { id: 'lc2', order_id: 'oc2', line_no: '00010', del_line: '1', item_id: null, raw_pn: 'SCS0195S-0L1-ON055', raw_desc: 'CSK KIT', qty: 1, delivered_qty: 0, due_date: '2026-11-10', unit_price: 3502200, plnd_no: 'PLX2' },
    { id: 'lcp', order_id: 'ocp', line_no: '1', del_line: '1', item_id: null, raw_pn: 'SCS0195S-0L1-ON055', qty: 1, delivered_qty: 0, due_date: '2026-11-10', plnd_no: 'PLX1' })
  S.DATA.production.push(
    { id: 'pcx1', customer_code: 'CSK', pn: 'SCS0195S-0L1-ON055', name: 'CSK KIT', hogi: 'JS2610-46', status: 'PO접수', csk: { plnd: 'PLX1' }, changes: [], missing_parts: [] },
    { id: 'pcx2', customer_code: 'CSK', pn: 'SCS0195S-0L1-ON055', name: 'CSK KIT', hogi: 'JS2610-47', status: '완료', shipped_date: '2026-10-25', csk: { plnd: 'PLX2' }, changes: null, missing_parts: [] },
    { id: 'pvx1', customer_code: 'VM', pn: 'Nardo', name: '3by2', hogi: 'EM3A80', status: '납품대기', vm: { project: 'PO2610000242' }, missing_parts: [] })
}
// v4.112.0 입고 현황 → 이카운트 구매입력 — ?ecp=1
if (_qs.get('ecp')) {
  const V = (id, name, code) => ({ vendor_id: id, vendors: { name, ecount_code: code } })
  const DS = V('vds', '(주)동신이앤티', '1408105980'), ED = V('ved', '(주)이디에스', '6058174188'), BAO = V('vbao', '(주)바오산전', '1758800637')
  const mv = (id, d, code, name, qty, price, po, x = {}) => ({ id, movement_type: '입고', movement_date: d, qty, unit_price: price, memo: x.memo ?? null, po_id: po ? 'po-' + id : null, customer_id: x.cust ?? null,
    ecount_purchase_at: x.at ?? null, ecount_purchase_by: x.at ? 'gyohan@jinsuntech.co.kr' : null,
    items: { std_code: code, name, unit: 'EA', manufacturer: x.imfr ?? null, manufacturer_code: x.impn ?? null },
    purchase_orders: po ? { po_number: x.pon ?? null, memo: null, mfr: x.mfr ?? null, mfr_code: x.mpn ?? null, item_rev: null, customer_id: x.pcust ?? 'cid-ax', fx_currency: null, projects: null, customers: (x.pcust ?? 'cid-ax') === 'cid-csk' ? { name: 'CSK', code: 'csk' } : { name: 'AXCELIS', code: 'ax' }, ...po } : null })
  const M1 = '거래명세서 동신이앤티 No.2026/09/08-2'
  S.DATA.stock_movements = [
    mv('m1', '2026-10-13', 'AX-170153525', 'PLATE CONDUIT ADAPTER', 4, 18000, DS, { mpn: 'REV D', memo: M1 }),
    mv('m2', '2026-10-13', 'AX-170165047', 'ENCL END STATION PD', 4, 706000, DS, { mpn: 'REV B', memo: M1 }),
    mv('m3', '2026-10-13', 'AX-1774220', 'BUS BAR INSUL', 6, 63000, DS, { mpn: 'REV E', memo: M1 }),
    mv('m4', '2026-10-13', 'AX-1774210', 'BUS BAR 31 POS', 8, 48000, DS, { mpn: 'REV G', memo: M1 }),
    mv('m5', '2026-10-27', 'AX-5001240', 'FERRULE LUG 14AWG', 200, 268, ED, { mfr: 'PHOENIX', mpn: '3200069', pon: 'JS-261012-01', memo: '거래명세서 이디에스 20261023-24' }),
    mv('m6', '2026-11-02', 'AX-500001934', 'CONTACTOR 3P 18A', 40, 24570, BAO, { mfr: 'LS', mpn: 'MC-18B', memo: '거래명세서 바오산전 2026-11-02' }),
    mv('m7', '2026-11-02', 'CS-ECK1', 'NOISE FILTER', 3, 12700, BAO, { pcust: 'cid-csk', mfr: '오리엔트', mpn: 'RNS-2020-DIN' }),
    mv('m8', '2026-10-23', 'AX-170176397', 'CHUCK WAND', 10, 150000, null, { cust: 'cid-ax' }),
    mv('m9', '2026-10-20', 'AX-5100052', 'SCREW PAN HD M4X8', 50, 65, ED, { pon: 'JS-261008-03', at: '2026-10-21T02:00:00Z' }),
  ]
}
// v4.114.0 순환 실사 보류 — ?cyc=1
if (_qs.get('cyc')) {
  S.DATA.pm_rack = [{ code: 'N2', rows_cnt: 3, levels_cnt: 3, zone: 'N', sort_no: 1 }]
  S.DATA.pm_rack_owner = [{ rack_code: 'N2', owner_name: '김교한', late: false }]
  S.DATA.pm_cell_check = [{ id: 1, location: 'N2-01-1', check_date: '2026-10-20', item_cnt: 1, diff_cnt: 0, empty: false, created_at: '2026-10-20T01:00:00Z' }]
  S.DATA.pm_stock_audit = []
  S.DATA.inventory.push({ id: 'ivn1', item_id: 'p1', qty: -16, location: 'N2-01-2' }, { id: 'ivn2', item_id: 'p2', qty: -26, location: 'N2-01-2' }, { id: 'ivn3', item_id: 'a1', qty: 5, location: 'N2-01-3' })
  S.DATA.holds = []
}
// v4.120.0 순환 실사 사람별 하루 목표 · 도우미 — ?cycp=1 (cyc=1 과 같이) · ?cyd=하루 목표(김교한)
if (_qs.get('cycp')) {
  const t = new Date().toISOString().slice(0, 10)
  S.DATA.pm_settings = [...(S.DATA.pm_settings || []).filter((x) => x.key !== 'cycle_people'),
    { key: 'cycle_people', value: { daily: { 김교한: Number(_qs.get('cyd') || 10), 배솔: 2 }, helpers: { 배솔: ['김교한'] } } }]
  // 오늘 김교한이 2칸 셈 (배솔이 아님)
  S.DATA.pm_cell_check.push({ id: 2, location: 'N2-02-1', check_date: t, checked_by: 'u1', item_cnt: 0, diff_cnt: 0, empty: true, created_at: t + 'T01:00:00Z' },
    { id: 3, location: 'N2-02-2', check_date: t, checked_by: 'u1', item_cnt: 0, diff_cnt: 0, empty: true, created_at: t + 'T01:00:00Z' })
  // v4.125.0 — ?baecnt=1 : 배솔도 오늘 2칸 셈 (거꾸로 → N2 맨 뒤 칸)
  if (_qs.get('baecnt')) S.DATA.pm_cell_check.push(
    { id: 4, location: 'N2-03-3', check_date: t, checked_by: 'u-bae', item_cnt: 0, diff_cnt: 0, empty: true, created_at: t + 'T02:00:00Z' },
    { id: 5, location: 'N2-03-2', check_date: t, checked_by: 'u-bae', item_cnt: 0, diff_cnt: 0, empty: true, created_at: t + 'T02:00:00Z' })
}
// v4.155.0 수주대장으로 미리 만든 호기 — ?pol=1 : ol1 은 PO 없이 수주대장 PO 번호 · ol2 는 붙음(adopted) · ?pol=notbl 은 표 없음(SQL 전)
if (_qs.get('pol')) {
  S.DATA.purchase_orders = S.DATA.purchase_orders || []
  S.DATA.purchase_orders.push({ id: 'polpo', po_number: '47001KF', customer_id: 'c-ax', order_type: 'customer_po', status: '진행중' })
  S.DATA.production.push(
    { id: 'ol1', customer_code: 'AX', pn: '110173680', name: 'ASSY TEST PD', hogi: '#3', status: 'PO접수', req_date: '2026-12-17', rev: 'B', changes: [], missing_parts: [] },
    { id: 'ol2', customer_code: 'AX', pn: '110173680', name: 'ASSY TEST PD', hogi: '#4', status: 'PO접수', req_date: '2026-12-20', po_id: 'polpo', changes: [], missing_parts: [] },
    ...(_qs.get('poline') ? [{ id: 'ol5', customer_code: 'AX', pn: '110173680', name: 'ASSY TEST PD', hogi: '#5', status: 'PO접수', req_date: '2026-12-30', po_id: null, order_line_id: 'l1', changes: [], missing_parts: [] }] : []))
  if (_qs.get('pol') === 'notbl') S.MISSING = [...(S.MISSING || []), 'pm_prod_order_link']
  else S.DATA.pm_prod_order_link = [
    { production_id: 'ol1', po_no: 'PE081612KK', adopted_at: null, order_line_id: _qs.get('dellk') ? 'l1' : 'lx' },
    { production_id: 'ol2', po_no: 'OLDPO', adopted_at: '2026-11-06T00:00:00Z' }]
}
// v4.116.0 VM · CSK 검수 · 상태 자동 — ?qcv=1 (CSK 는 ?csk=1 과 같이)
if (_qs.get('qcv')) {
  S.DATA.production.push({ id: 'v1', customer_code: 'VM', pn: 'Nardo', name: '3by2', hogi: 'EM3A71', status: 'PO접수', req_date: '2026-11-20', arrival_date: '2026-10-20', vm: { esc: null, ac: '완료', ut: '완료', st: '대기', pm: '완료', etc: '완료' }, changes: [], missing_parts: [] })
  S.DATA.pm_prod_qc = []
  S.DATA.production.push({ id: 'ax1', customer_code: 'AX', pn: 'AX-110153030', name: 'ASSY MAIN PD', hogi: '#13', status: 'PO접수', req_date: '2026-11-25', changes: [], missing_parts: [] })
}
// v4.117.0 수주대장 ↔ 자재불출 — ?iss=1 (pt=1 과 같이) : l1 고객사 PO 불출 · l2(VM) 생산관리 자재불출 · ?iss=nofn 은 함수 없음(SQL 전)
if (_qs.get('iss')) {
  S.DATA.pm_line_issue_v = [{ id: 'l1', customer_code: 'AX', issued: true, src: '고객사 PO 불출' }]   // AXCELIS 만 (VM 은 보기에 없음)
  { const l1 = S.DATA.pm_order_line.find((x) => x.id === 'l1'); l1.reply = null; l1.reply_memo = null }
  window.__issCalls = 0
}
// v4.118.0 Edwards ← 수주대장 — ?edsync=1 (pt=1 과 같이) · ?edsync=nofn 은 함수 없음(SQL 전)
if (_qs.get('edsync')) {
  S.DATA.production.push(
    { id: 'pe4', customer_code: 'ED', pn: 'Gen2 Plus Hynix', name: 'Gen2 Plus Hynix', hogi: '#29', status: '제작중', part: 'H2D', part2: 'H2D LH', req_date: '2026-11-05', harness_recv: true, missing_parts: [{ pn: 'X1', qty: 1 }] },
    { id: 'pe5', customer_code: 'ED', pn: 'Gen2 Plus Hynix', name: 'Gen2 Plus Hynix', hogi: '#29', status: 'PO접수', part: 'MFM', req_date: '2026-11-20', missing_parts: [] })
  { const e1 = S.DATA.production.find((x) => x.id === 'pe1'); if (e1) e1.req_date = '2026-12-30' }
  window.__edGroups = [
    { proj: 'Gen2 Plus_Hynix', hogi: '29', part: 'EUV', sub: null, pos: ['6001369289', '6001369294'], n_lines: 122, amt: 251622235, due: '2026-11-10', due_last: '2026-12-01', guessed: 0 },
    { proj: 'Gen2 Plus_SS H2D', hogi: '20', part: 'EUV', sub: null, pos: ['6001380369'], n_lines: 92, amt: 200629875, due: '2026-11-19', due_last: '2026-12-10', guessed: 15 },
    { proj: 'Vizeon_TSMC 6S 9N Dummy TW', hogi: '3', part: 'H2D', sub: 'H2D HP', pos: ['6001368102'], n_lines: 60, amt: 36083114, due: '2026-11-16', due_last: '2026-11-16', guessed: 0 },
    { proj: 'ASML WTR', hogi: '3,4', part: 'EUV', sub: null, pos: ['6001384957'], n_lines: 1, amt: 110766, due: '2026-11-01', due_last: '2026-11-01', guessed: 1 },
    { proj: 'IS Spare _ WARDEN', hogi: null, part: 'SIC', sub: null, pos: ['6001349773-1'], n_lines: 16, amt: 55727200, due: '2026-11-24', due_last: '2026-11-24', guessed: 0 },
    { proj: 'IS Factored', hogi: null, part: '단품', sub: null, pos: ['6001344066'], n_lines: 35, amt: 14970500, due: '2026-10-30', due_last: '2027-04-13', guessed: 0 },
  ]
}
if (_qs.get('proj')) S.PROJECT = 1
// v4.126.0 견적 구매/자작 — ?qsup=1 (미정) · ?qsup=buy (BODY 구매 지정됨)
// v4.131.0 같은품목 묶음 — ?same=1 : p9(AX-5100052VM) 는 p1(AX-5100052) 묶음
if (_qs.get('same')) {
  S.DATA.items.push({ id: 'p9', std_code: 'AX-5100052VM', name: 'SCREW PAN HD M4X8 (VM)', js_code: 'JS-HW0001', category: '부품', type: '자재', unit: 'EA', manufacturer: 'MISUMI', manufacturer_code: 'SPHS-M4-8', purchase_price: 50 })
  S.DATA.inventory.push({ id: 'iv9', item_id: 'p9', qty: 0, location: null })
  S.DATA.pm_item_same = [{ item_id: 'p1', rep_item_id: 'p1', js_code: 'JS-HW0001' }, { item_id: 'p9', rep_item_id: 'p1', js_code: 'JS-HW0001' }]
  if (_qs.get('same') !== 'pre') S.DATA.pm_item_same_merge = [{ id: 1, item_id: 'p9', rep_item_id: 'p1', qty: 0 }]
  else S.MISSING = [...(S.MISSING || []), 'pm_item_same_merge']
  S.DATA.bom.push({ id: 'b9', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'p9', level: 1, qty_per_unit: 2, seq: 3 })
}
// v4.133.0 재고현황 — 재고금액 분포 · 안전재고 미달 발주 여부 — ?inv2=1 (same=1 과 같이 써도 됨)
if (_qs.get('inv2')) {
  const it = (id) => S.DATA.items.find((x) => x.id === id)
  it('p1').safety_stock = 200; it('p2').safety_stock = 10
  S.DATA.items.push({ id: 'e1', std_code: 'ED-NKB932435', name: 'NKBSP1888', type: '자재', unit: 'EA', manufacturer: 'Edwards', purchase_price: 15000, safety_stock: 20 })
  S.DATA.inventory.push({ id: 'ive1', item_id: 'e1', qty: 4, location: 'E-1' })
  S.DATA.pm_po_cart = []
  if (_qs.get('same')) S.DATA.purchase_orders.push({ id: 'po9', customer_id: 'cid-ax', item_id: 'p9', order_type: 'purchase', po_number: 'JS-261101-02', qty_ordered: 100, qty_received: 0, qty_remaining: 100, promise_date: '2026-10-30', status: '진행중', order_date: '2026-10-20', vendor_id: 'v1' })
}
// v4.139.0 견적 이력 고객사 거르기 — ?qh=1
if (_qs.get('qh')) {
  const Q = (id, kind, cid, to, d) => ({ id, quote_no: 'S' + id, quote_kind: kind, quote_date: d, currency: 'USD', project_name: 'P' + id, issued_to: to, customer_id: cid, total_amount: 100, status: 'sent', created_at: d + 'T01:00:00Z' })
  S.DATA.pm_quotes = [Q('q1', 'sales', 'cid-ax', 'AXCELIS', '2026-10-01'), Q('q2', 'sales', 'cid-vm', 'VM', '2026-10-02'), Q('q3', 'sales', null, 'VM', '2025-05-01'), Q('q4', 'sales', null, '남일인스트루먼트', '2026-10-03'), Q('q5', 'purchase', null, '파워일렉', '2026-10-04')]
  const I = (qid, code) => ({ id: qid + code, quote_id: qid, line_no: 1, std_code: code, description: code + ' D', unit: 'EA', qty: 1, unit_price: 10, line_kind: 'item' })
  S.DATA.pm_quote_items = [I('q1', 'AX-1003-0027-0006'), I('q2', 'VM-309-1701-007'), I('q3', 'VM-501-0148-193'), I('q4', 'ED-NK1'), I('q5', 'AX-5100052')]
}
// v4.137.0 미불출 일괄 — ?mbulk=1 : 110158840 #71~#74 (72~74 에 RELAY 3 이 이미 걸려 있음 · #73 은 출고 연동 모양)
if (_qs.get('mbulk')) {
  S.DATA.items.push({ id: 'mb1', std_code: 'AX-5102060', name: 'SHELL 9P', manufacturer: 'AMPHENOL', manufacturer_code: 'S9P' }, { id: 'mb2', std_code: 'AX-4021187', name: 'RELAY 24VDC', manufacturer: 'OMRON', manufacturer_code: 'G2R' })
  const relay = { pn: '4021187', name: 'RELAY 24VDC', maker: 'OMRON', qty: 3, date: '' }
  S.DATA.production.push(
    { id: 'mh1', customer_code: 'AX', pn: '110158840', name: 'ASSY EFEM PD', hogi: '#71', status: '자재불출', req_date: '2026-11-20', changes: [], missing_parts: [] },
    { id: 'mh2', customer_code: 'AX', pn: '110158840', name: 'ASSY EFEM PD', hogi: '#72', status: '자재불출', req_date: '2026-11-21', changes: [], missing_parts: [{ ...relay }] },
    { id: 'mh3', customer_code: 'AX', pn: '110158840', name: 'ASSY EFEM PD', hogi: '#73', status: '자재불출', req_date: '2026-11-22', changes: [], missing_parts: [{ std_code: 'AX-4021187', name: 'RELAY 24VDC', qty: 3, item_id: 'mb2' }, { std_code: 'AX-9999', name: 'KEEP', qty: 1 }] },
    { id: 'mh4', customer_code: 'AX', pn: '110158840', name: 'ASSY EFEM PD', hogi: '#74', status: '자재불출', req_date: '2026-11-23', changes: [], missing_parts: [{ ...relay }] })
}
// v4.144.0 하네스 출도 기록 붙여넣어 불출 — ?hrp=1
if (_qs.get('hrp')) {
  const AXID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'
  const it = (id, code) => { if (!S.DATA.items.find((x) => x.id === id)) S.DATA.items.push({ id, std_code: code, name: 'HARNESS ' + code, category: '하네스', type: '자재', unit: 'EA' }) }
  it('h1', 'AX-160024189'); it('h2', 'AX-160022758'); it('h3', 'AX-160014240'); it('h4', 'AX-160099999')
  const PO = (id, po, ol, dl, item_id, x = {}) => ({ id, customer_id: AXID, order_type: 'customer_po', po_number: po, order_line: ol, del_line: dl, item_id, division: '하네스', qty_ordered: 10, qty_received: 0, qty_remaining: 10, promise_date: '2026-11-20', status: '진행중', material_issued: false, ...x })
  S.DATA.purchase_orders.push(PO('hp1', '824470', '7', '1', 'h1', { qty_remaining: 29 }), PO('hp2', 'KNSE48259', '4', '3', 'h2', { material_issued: true }), PO('hp3', 'KNSE48259', '4', '2', 'h2', { status: '완료' }),
    PO('hp4', 'LM778185', '58', '6', 'h4', { qty_remaining: 30 }), PO('hp5', 'KNSE48259', '4', '1', 'h2', { qty_remaining: 1 }))
  S.DATA.production.push({ id: 'hpr1', customer_code: 'AX', pn: 'X', hogi: '#1', status: 'PO접수', po_id: 'hp1', part_issue: false, missing_parts: [] })
  S.DATA.harness_orders = []; S.DATA.harness_qr_history = []
  if (_qs.get('hrx')) {   // v4.146.0 출도 대상 품번 — 12번대 구매품 줄
    it('x1', 'AX-120220971'); it('x2', 'AX-120220974'); it('x3', 'AX-120299999')
    S.DATA.purchase_orders.push(PO('hx1', '824470', '9', '1', 'x1', { division: '구매품' }), PO('hx2', '824470', '10', '1', 'x2', { division: '구매품' }), PO('hx3', '824470', '11', '1', 'x3', { division: '구매품' }), PO('hx4', '824470', '12', '1', 'x1', { division: '구매품', status: '완료' }))
    if (_qs.get('hrx') === 'set') S.DATA.pm_settings = [{ key: 'harness_release_extra', value: { codes: ['120220971'] } }]
  }
}
// v4.153.0 출고 보기 — ?obv=1 : pj1 BOM 에 소요 0 줄 · 하네스 줄 · 불출 미대상 줄
if (_qs.get('obv')) {
  S.DATA.items.push({ id: 'z0a', std_code: 'AX-8600001', name: 'SPEC DOC A', unit: 'EA' }, { id: 'z0b', std_code: 'AX-8600002', name: 'SPEC DOC B', unit: 'EA' },
    { id: 'hh1', std_code: 'AX-160011112', name: 'HARNESS SUB X', unit: 'EA' }, { id: 'ex1', std_code: 'AX-5000999', name: 'TIE WRAP', unit: 'EA', manufacturer: 'HELLERMANN', manufacturer_code: 'T18R' })
  S.DATA.bom.push({ id: 'bz1', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'z0a', level: 1, qty_per_unit: 0, seq: 3 }, { id: 'bz2', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'z0b', level: 1, qty_per_unit: 0, seq: 4 },
    { id: 'bh1', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'hh1', level: 1, qty_per_unit: 2, seq: 5 }, { id: 'be1', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'ex1', level: 1, qty_per_unit: 3, seq: 6 })
  S.DATA.pm_stock_audit = [...(S.DATA.pm_stock_audit || []), { id: 'au1', item_id: 'hh1', location: 'B3-2-1', audit_date: '2026-10-20' }, { id: 'au2', item_id: 'hh1', location: 'B9-9-9', audit_date: '2026-09-01' }]
  S.DATA.pm_bom_notes = [...(S.DATA.pm_bom_notes || []), { customer_id: 'cid-ax', project_id: 'pj1', item_id: 'hh1', make_type: 'harness', note: '' }, { customer_id: 'cid-ax', project_id: 'pj1', item_id: 'ex1', make_type: 'exclude', note: '' }]
}
// v4.152.1 휴대폰 구매발주 입고 완료 — ?pdone=1
if (_qs.get('pdone')) {
  S.DATA.purchase_orders.push({ id: 'pd-done', customer_id: 'cid-ax', item_id: 'p1', order_type: 'purchase', po_number: 'JS-261028-02', qty_ordered: 20, qty_received: 20, qty_remaining: 0, unit_price: 50, promise_date: '2026-11-01', status: '완료', order_date: '2026-10-28', vendor_id: 'v1' },
    { id: 'pd-part', customer_id: 'cid-ax', item_id: 'p1', order_type: 'purchase', po_number: 'JS-261029-01', qty_ordered: 10, qty_received: 4, qty_remaining: 6, unit_price: 50, promise_date: '2026-11-20', status: '진행중', order_date: '2026-10-29', vendor_id: 'v1' })
  S.DATA.stock_movements = [...(S.DATA.stock_movements || []), { id: 'smd1', po_id: 'pd-done', item_id: 'p1', movement_type: '입고', movement_date: '2026-11-02', qty: 20 }, { id: 'smd2', po_id: 'pd-part', item_id: 'p1', movement_type: '입고', movement_date: '2026-11-04', qty: 4 }]
}
// v4.151.0 생산관리 3rd party 줄 — ?subp=1
if (_qs.get('subp')) S.DATA.production.push({ id: 'tp1', customer_code: 'AX', company: '동원파츠', pn: '110018390', name: 'INTERLOCK SWITCH ASSEMBLY', hogi: '10EA', status: '제작대기', req_date: '2026-11-20', missing_parts: [] })
// v4.150.0 하네스 출도 — 구매품 제조사 · 발주 담기 · 구분 바꾸기 — ?hrp=1&hrx=1&hrc=1
if (_qs.get('hrc')) {
  const AXID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'
  Object.assign(S.DATA.items.find((x) => x.id === 'x1'), { name: 'TERMINAL BLOCK', manufacturer: 'PHOENIX', manufacturer_code: 'PT 1,5/S' })
  S.DATA.items.push({ id: 'hb1', std_code: 'AX-100139060', name: 'CABLE ASSY EFEM SIGNAL', unit: 'EA' },
    { id: 'hk1', std_code: 'AX-5102060', name: 'SHELL 9P', unit: 'EA', manufacturer: 'AMPHENOL', manufacturer_code: 'S9P' },
    { id: 'hk2', std_code: 'AX-7700039', name: 'CA RG59B/U', unit: 'M' }, { id: 'hk3', std_code: 'AX-160011111', name: 'HARNESS SUB', unit: 'EA' })
  S.DATA.purchase_orders.push({ id: 'hc1', customer_id: AXID, order_type: 'customer_po', po_number: '900100', order_line: '1', del_line: '1', item_id: 'hb1', division: '구매품', qty_ordered: 2, qty_received: 0, qty_remaining: 2, promise_date: '2026-11-25', status: '진행중', material_issued: false })
  S.DATA.projects = [...(S.DATA.projects || []), { id: 'pjh1', customer_id: AXID, code: 'AX-100139060', name: 'CABLE ASSY EFEM SIGNAL', bom: [{ count: 3 }] }, { id: 'pjh4', customer_id: AXID, code: 'AX-160099999', name: 'HARNESS', bom: [{ count: 2 }] }]
  window.__expl = []
  window.__explFn = (a) => { const it = a.p_items[0]; window.__expl.push(it.code); const q = Number(it.qty)
    if (it.code === 'AX-100139060') return [{ item_id: 'hk1', std_code: 'AX-5102060', name: 'SHELL 9P', qty: 2 * q, make_type: 'normal' }, { item_id: 'hk2', std_code: 'AX-7700039', name: 'CA RG59B/U', qty: 1.5 * q, make_type: 'normal' }, { item_id: 'hk3', std_code: 'AX-160011111', name: 'HARNESS SUB', qty: q, make_type: 'harness' }]
    if (it.code === 'AX-160099999') return [{ item_id: 'hk1', std_code: 'AX-5102060', name: 'SHELL 9P', qty: q, make_type: 'normal' }]
    return [] }
}
// v4.143.0 Edwards 납기 = 수주대장 PO 납기 — ?eddue=1 (edsync=1 과 같이)
if (_qs.get('eddue')) S.DATA.production.push(
  { id: 'pd3', customer_code: 'ED', company: 'Edwards', pn: 'Vizeon TSMC 6S 9N Dummy TW', name: 'Vizeon TSMC 6S 9N Dummy TW', hogi: '#3', status: 'PO접수', part: 'H2D', part2: 'H2D HP', po_received: true, req_date: '2026-10-20', arrival_date: '2026-10-08', missing_parts: [], changes: [{ type: '수주대장 불러오기', at: '2026-10-29T01:00:00Z' }] },
  { id: 'pd4', customer_code: 'ED', company: 'Edwards', pn: 'ASML WTR', name: 'ASML WTR', hogi: '#3,4', status: 'PO접수', part: 'EUV', po_received: false, req_date: '2026-10-29', fc_to: '2026-12-15', missing_parts: [], changes: [] })
// v4.134.0 Edwards 협력사(남일 · 두웰) 발주 → Edwards 생산관리 — ?edpt=1 (edsync=1 과 같이)
if (_qs.get('edpt')) {
  S.DATA.items.push({ id: 'en1', std_code: 'ED-NKB909712', name: 'EXP PROOF EXTRACT SENSOR' }, { id: 'ed1', std_code: 'ED-IE0501600', name: 'GAS CAL ANALOG CABLE1' }, { id: 'ed2', std_code: 'ED-IE0501601', name: 'GAS CAL ANALOG CABLE2' })
  S.DATA.pm_order.push(
    { id: 'on1', customer_code: 'ETC', customer_name: '남일인스트루먼트', po_no: 'NI2K-RQ-250303-0029', source: 'manual', registered_at: now },
    { id: 'od1', customer_code: 'ETC', customer_name: '두웰', po_no: 'DW2K-PO-43496-00475', source: 'manual', registered_at: now },
    { id: 'ox1', customer_code: 'ETC', customer_name: '동원파츠', po_no: 'DW-2610-01', source: 'manual', registered_at: now })
  S.DATA.pm_order_line.push(
    { id: 'ln1', order_id: 'on1', line_no: '1', del_line: '1', item_id: 'en1', qty: 4, delivered_qty: 0, due_date: '2026-12-07' },
    { id: 'ld1', order_id: 'od1', line_no: '1', del_line: '1', item_id: 'ed1', qty: 1, delivered_qty: 0, due_date: '2026-11-03' },
    { id: 'ld2', order_id: 'od1', line_no: '2', del_line: '1', item_id: 'ed2', qty: 1, delivered_qty: 1, due_date: '2026-11-03' },
    { id: 'lx1', order_id: 'ox1', line_no: '1', del_line: '1', item_id: 'a1', qty: 2, delivered_qty: 0, due_date: '2026-12-15' })
}
// v4.135.0 생산관리 자동 불러오기 기록 — ?asl=1 (없으면 표 없음)
if (_qs.get('asl')) {
  const h = (d) => new Date(Date.now() - d * 3600e3).toISOString()
  S.DATA.pm_prod_autosync_log = [
    { id: 1, cs: 'AX', run_at: h(3), ok: true, result: { created: 1, matched: 0, updated: 2, done: 1, tp: { created: 1, updated: 0, unlinked: 0 } }, trigger: 'cron' },
    { id: 2, cs: 'ED', run_at: h(3), ok: false, error: 'function public.pm_ed_order_groups() does not exist', trigger: 'cron' },
    { id: 3, cs: 'AX', run_at: h(27), ok: true, result: { created: 0 }, trigger: 'cron' },
  ]
} else S.MISSING = [...(S.MISSING || []), 'pm_prod_autosync_log']
if (_qs.get('qsup')) {
  S.DATA.items.push(
    { id: 'gb', std_code: 'AX-GBODY01', name: 'Generator Rack Body', category: '부품', type: '자재', unit: 'EA', purchase_price: 1250000 },
    { id: 'gk1', std_code: 'AX-GK0001', name: 'Ground Bus bar', category: '부품', type: '자재', unit: 'EA', purchase_price: null },
    { id: 'gk2', std_code: 'AX-GK0002', name: 'Generator Pad 5t', category: '부품', type: '자재', unit: 'EA', purchase_price: null },
    { id: 'gh', std_code: 'AX-GHOSE01', name: 'SS-PB8TA8PM8-52CM-RD', category: '부품', type: '자재', unit: 'EA', purchase_price: 68400 })
  S.DATA.projects.push({ id: 'pj9', customer_id: 'cid-ax', code: 'AX-990000001', name: 'Generator Rack', rev: 'A' })
  S.DATA.bom.push(
    { id: 'g1', customer_id: 'cid-ax', project_id: 'pj9', item_id: 'gb', level: 1, qty_per_unit: 1, seq: 1, quote_excluded: false },
    { id: 'g2', customer_id: 'cid-ax', project_id: 'pj9', item_id: 'gk1', level: 2, qty_per_unit: 1, seq: 2, quote_excluded: false },
    { id: 'g3', customer_id: 'cid-ax', project_id: 'pj9', item_id: 'gk2', level: 2, qty_per_unit: 4, seq: 3, quote_excluded: false },
    { id: 'g4', customer_id: 'cid-ax', project_id: 'pj9', item_id: 'gh', level: 1, qty_per_unit: 1, seq: 4, quote_excluded: false })
  S.DATA.pm_item_supply = _qs.get('qsup') === 'buy' ? [{ item_id: 'gb', mode: 'buy' }] : []
}
if (_qs.get('qn') === '0') S.MISSING = [...(S.MISSING || []), 'pm_item_quote_note']   // v4.176.0 견적 특이사항 SQL 전
// 실제 크기 흉내 — ?big=1 : PO 1560 · 줄 14156 (진행 1867) · 호기 연결 1353
if (_qs.get('big')) {
  const cs = ['AX', 'ED', 'VM', 'CSK', 'ETC']
  for (let i = 0; i < 1560; i++) S.DATA.pm_order.push({ id: 'bo' + i, customer_code: cs[i % 5], po_no: 'BIG' + i, registered_at: new Date(Date.UTC(2025, 0, 1) + i * 3600e3 * 7).toISOString(), currency: i % 5 === 0 ? 'USD' : 'KRW', source: 'pdf', kind: 'po', ccn: i % 2 ? 'K' : 'B', memo: 'Gen2 Plus #' + (i % 30) })
  const its = S.DATA.items
  for (let k = 0; k < 14156; k++) {
    const o = 'bo' + (k % 1560), live = k % 7.58 < 1
    S.DATA.pm_order_line.push({ id: 'bl' + String(k).padStart(6, '0'), order_id: o, line_no: String(1 + Math.floor(k / 1560)), del_line: '1', item_id: its[k % its.length].id, rev: 'A', qty: 5, delivered_qty: live ? 0 : 5, due_date: '2026-' + String(1 + k % 12).padStart(2, '0') + '-15', unit_price: 1000 + k, note: k % 3 ? null : 'PROJECT Gen2 Plus #' + (k % 30) })
  }
  S.DATA.pm_line_prod_v = S.DATA.pm_order_line.filter((l) => l.delivered_qty < l.qty).slice(0, 1353).map((l, j) => ({ id: l.id, customer_code: 'ED', hogis: '#' + (j % 30), n_prod: 1, any_open: true, guess: false, prod_pns: 'Gen2' }))
}
// v4.185.0 수주대장 예상 매출은 기본 접힘 — 예전 시험은 펼친 상태로 (?moneyoff=1 이면 기본 그대로)
try { if (_qs.get('moneyoff')) localStorage.removeItem('pm.oi.money'); else localStorage.setItem('pm.oi.money', '1') } catch {}
if (_qs.get('livefail')) S.READFAIL = { pm_order_line_live_v: +_qs.get('livefail') }
if (_qs.get('moneyfail')) S.RPCFAIL = { pm_order_money: +_qs.get('moneyfail') }
window.__S = S
if (_qs.get('nov')) S.MISSING = [...(S.MISSING || []), 'pm_order_line_live_v', 'pm_order_line_hist_v', 'pm_order_money']
if (_qs.get('nocol')) S.NOCOLS = ['odd_ok', 'brev']
// v4.99.0 단가 제외 · 기타 고객사 · 견적 접수 근거 — ?q99=1
if (_qs.get('q99')) {
  S.DATA.items.push(
    { id: 'c1', std_code: 'AX-7700039', name: 'CA RG59B/U', category: '와이어_케이블', type: '자재', unit: 'M', purchase_price: 600, vendor_id: null },
    { id: 'd1', std_code: 'AX-8606757', name: 'HARNESS CABLES WORKMANSHIP STANDARD', category: '문서', type: '자재', unit: 'EA', purchase_price: null },
    { id: 'd2', std_code: 'AX-880001200', name: 'TEST SPEC PROG VFD HEAT EXCHANGER', category: null, type: '자재', unit: 'EA', purchase_price: null },
    { id: 'z1', std_code: 'AX-5000472', name: 'TIE WRAP BLK 7.4IN NYL NF', category: '부품', type: '자재', unit: 'EA', purchase_price: null },
    { id: 'n1', std_code: 'AX-5109999', name: 'CONN HOUSING 12P', category: '부품', type: '자재', unit: 'EA', purchase_price: null })
  S.DATA.bom.push(
    { id: 'b3', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'd1', level: 1, qty_per_unit: 0, seq: 3, quote_excluded: false },
    { id: 'b4', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'd2', level: 1, qty_per_unit: 1, seq: 4, quote_excluded: false },
    { id: 'b5', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'z1', level: 1, qty_per_unit: 0, seq: 5, quote_excluded: false },
    { id: 'b6', customer_id: 'cid-ax', project_id: 'pj1', item_id: 'n1', level: 1, qty_per_unit: 2, seq: 6, quote_excluded: false })
  S.DATA.pm_rfq = [{ id: 'r1', seq: 1, customer_code: 'ax', customer_id: 'cid-ax', title: 'LE Spare', due_date: '2026-10-23', status: '진행', owner_name: '김동호', price_req_at: '2026-10-23T01:00:00Z', price_req_by: '김교한', created_at: '2026-10-23T01:00:00Z', updated_at: '2026-10-23T01:00:00Z' }, { id: 'r2', seq: 2, customer_code: 'ax', customer_id: 'cid-ax', title: '7700039 WIRE 단품 견적', due_date: '2026-10-28', status: '진행', owner_name: '김동호', created_at: '2026-10-25T01:00:00Z', updated_at: '2026-10-25T01:00:00Z' }]
  S.DATA.pm_rfq_line = [{ id: 'rk1', rfq_id: 'r1', line_no: 1, pn: '100174500', name: 'KIT EFEM AX8 FFU PROGRAMMING TOOL', qty: 1, kind: 'assy', part_count: 40, noprice_count: 2, noprice_codes: ['AX-5109999', 'AX-5000472'], checked_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T01:00:00Z' },
    { id: 'rk2', rfq_id: 'r1', line_no: 2, pn: 'AX-5100052', name: 'SCREW', qty: 1, kind: 'item', item_id: 'p1', part_count: 1, noprice_count: 0, checked_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T01:00:00Z' },
    { id: 'rk3', rfq_id: 'r1', line_no: 3, pn: 'AX-6200111', name: 'CB', qty: 1, kind: 'item', item_id: 'p2', part_count: 1, noprice_count: 0, checked_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T01:00:00Z' },
{ id: 'rl1', rfq_id: 'r2', line_no: 1, pn: '7700039', name: null, qty: 1, created_at: '2026-10-25T01:00:00Z' },
    { id: 'rl2', rfq_id: 'r2', line_no: 2, pn: '110153030', name: 'ASSY MAIN PD', qty: 2, created_at: '2026-10-25T01:00:00Z' }]
  // v4.127.0 구매 견적 불가 — ?nq1=1 : 같은 부품(AX-5109999)만 단가 없는 한 품목짜리 접수 r3
  if (_qs.get('nq1')) {
    S.DATA.pm_rfq.push({ id: 'r3', seq: 3, customer_code: 'ax', customer_id: 'cid-ax', title: 'FFU 단품 키트', due_date: '2026-11-10', status: _qs.get('nq1') === 'closed' ? '불가' : '진행', owner_name: '김동호', price_req_at: '2026-10-30T01:00:00Z', price_req_by: '이정민', created_at: '2026-10-30T01:00:00Z', updated_at: '2026-10-30T01:00:00Z' })
    S.DATA.pm_rfq_line.push({ id: 'rk9', rfq_id: 'r3', line_no: 1, pn: '100174599', name: 'KIT FFU CONN', qty: 2, kind: 'assy', part_count: 3, noprice_count: 1, noprice_codes: ['AX-5109999'], checked_at: '2026-10-30T01:00:00Z', created_at: '2026-10-30T01:00:00Z' })
    if (_qs.get('nqcol') !== '0') S.DATA.pm_rfq_line.forEach((l) => { l.nq_parts = [] })   // v4.128.0 칸 (SQL 후) · ?nqcol=0 은 SQL 전
  }
}
const _dm = (id, to, note) => { const r = S.DATA.pm_doc_request.find((x) => x.id === id); if (!r) return null; r.history = [...(r.history || []), { at: new Date().toISOString(), by: ME.name, from: r.status, to, note }]; r.status = to; if (to >= 2) r.recv_note = note || r.recv_note; else r.recv_note = null; return { ...r } }

S.RPCFN = { pm_process_inbound: () => null,
  pm_doc_request_move: (a) => _dm(a.p_id, a.p_to, a.p_note),
  pm_doc_request_cancel: (a) => { const r = S.DATA.pm_doc_request.find((x) => x.id === a.p_id); r.cancelled = true; return { ...r } },
  pm_doc_request_follow: (a) => { const r = S.DATA.pm_doc_request.find((x) => x.id === a.p_id); if (!r.also_depts.includes(a.p_dept)) r.also_depts = [...r.also_depts, a.p_dept]; return { ...r } },
  pm_doc_request_autorecv: () => 0,
  pm_po_set_vendor_date: (a) => { let n = 0; for (const p of S.DATA.purchase_orders) if (a.p_ids.includes(p.id) && p.vendor_date !== a.p_date) { S.DATA.pm_po_date_log.push({ id: S.DATA.pm_po_date_log.length + 1, po_id: p.id, kind: '협력사 변경', old_date: p.vendor_date || null, new_date: a.p_date, reason: a.p_reason, at: new Date().toISOString() }); p.vendor_date = a.p_date; p.vendor_date_reason = a.p_date ? a.p_reason : null; n++ } return n },
  pm_po_set_need_date: (a) => { let n = 0; for (const p of S.DATA.purchase_orders) if (a.p_ids.includes(p.id) && p.promise_date !== a.p_date) { S.DATA.pm_po_date_log.push({ id: S.DATA.pm_po_date_log.length + 1, po_id: p.id, kind: '필요일 변경', old_date: p.promise_date, new_date: a.p_date, reason: a.p_reason, at: new Date().toISOString() }); p.promise_date = a.p_date; n++ } return n },
  pm_vendor_scorecard: () => [{ vendor_id: 'v2', vendor: '로이코', lines: 41, on_time: 34, late: 7, avg_late_days: 4.2, kept_vendor_date: 5, vendor_changes: 3, open_late: 1 }, { vendor_id: 'v1', vendor: '파워일렉', lines: 12, on_time: 12, late: 0, avg_late_days: null, kept_vendor_date: 0, vendor_changes: 0, open_late: 0 }],
  get_weekly_portal_all: () => ({ inbound: [], plan: [], outbound: [], purchase: [], pending: [], delay: [
    { id: 'auto-po2', customer: 'AXCELIS', pn: 'AX-5100052', vendor: '로이코', name: 'SCREW', qty: 50, target_date: '2026-10-21' },
    { id: 'auto-po3', customer: 'AXCELIS', pn: 'AX-5100052', vendor: '로이코', name: 'SCREW', qty: 30, target_date: '2026-10-20', vendor_date: '2099-11-04', vendor_reason: '제조사 백오더' },
    { id: 'auto-po4', customer: 'Edwards', pn: 'ED-1', vendor: '컴윈스', name: 'BRKT', qty: 8, target_date: '2026-10-23', vendor_date: '2026-10-01', vendor_reason: '운송 지연' } ] }), pm_flow_counts: () => ({ ord_unconfirmed: 1, ord_waiting: 5, ord_risk: 2, ord_late: 3, ord_month: 4, req_open: 53, req_doing: 36, dist_wait: 41, prod_wait: 36, prod_making: 41, prod_quality: 20, prod_ship: 15 }) }
// 할 일 (v4.104.0 시험)
S.DATA.pm_todo = [
  { id: 1, title: 'EFEM 판금 견적 회신 확인', status: '대기', priority: '높음', owner: '김교한', owner_id: 'u1', due_date: '2026-10-26', agenda: false, comment_cnt: 0, created_at: '2026-10-20T01:00:00Z' },
  { id: 2, title: '2027 순차매입 발주 등록', status: '진행중', priority: '보통', owner: '김교한', owner_id: 'u1', due_date: '2026-10-29', agenda: true, comment_cnt: 1, created_at: '2026-10-21T01:00:00Z' },
  { id: 3, title: '로트 관리 운영안내 배포', status: '대기', priority: '보통', owner: '남기문', owner_id: 'u2', due_date: '2026-11-03', agenda: false, comment_cnt: 0, created_at: '2026-10-22T01:00:00Z' }]
S.DATA.pm_todo_comment = S.DATA.pm_todo_comment || []
// ?sched=1 — 부서별 할 일 · 일정 SQL 을 돌린 뒤의 DB 흉내 (v4.197.0). 새 칸이 있고, 새로 적으면 부서 · 기본값이 붙는다
if (_qs.get('sched')) {
  const base = { dept: '구매자재', scope: 'dept', to_dept: null, kind: 'todo', end_date: null, room: false, time_from: null, time_to: null, repeat: null, reject_reason: null }
  S.DATA.pm_todo = [
    ...S.DATA.pm_todo.map((r) => ({ ...base, ...r })),
    { ...base, id: 10, title: '팀원 A 오전 반차', kind: 'note', status: '대기', priority: '보통', due_date: '2026-11-16', created_by: 'u2', created_at: '2026-11-13T01:00:00Z', comment_cnt: 0 },
    { ...base, id: 11, title: '영업 주간 미팅', kind: 'note', scope: 'all', dept: '영업', room: true, time_from: '14:00:00', time_to: '15:00:00', status: '대기', priority: '보통', due_date: '2026-11-16', created_by: 'u9', created_at: '2026-11-13T01:00:00Z', comment_cnt: 0 },
    { ...base, id: 12, title: '품질 심사 준비', kind: 'note', scope: 'all', dept: '품질', room: true, time_from: '15:30:00', time_to: '16:30:00', status: '대기', priority: '보통', due_date: '2026-11-19', created_by: 'u8', created_at: '2026-11-13T01:00:00Z', comment_cnt: 0 },
    { ...base, id: 13, title: '11/20 납품분 납기 확인 부탁', scope: 'req', dept: '영업', to_dept: '구매자재', status: '대기', priority: '보통', owner: null, owner_id: null, due_date: '2026-11-17', created_by: 'u9', created_at: '2026-11-14T01:00:00Z', comment_cnt: 0 },
    { ...base, id: 14, title: '성적서 회신', scope: 'req', dept: '구매자재', to_dept: '품질', status: '대기', priority: '보통', owner: '김교한', owner_id: 'u1', due_date: '2026-11-18', created_by: 'u1', created_at: '2026-11-14T01:00:00Z', comment_cnt: 0, seen_at: '2026-11-14T01:00:00Z' },
    { ...base, id: 15, title: '주간업무보고 확인', repeat: 'weekly', status: '대기', priority: '보통', owner: '김교한', owner_id: 'u1', due_date: '2026-11-16', created_by: 'u1', created_at: '2026-11-09T01:00:00Z', comment_cnt: 0, seen_at: '2026-11-09T01:00:00Z' },
    { ...base, id: 16, title: '팀원 B 휴가 — Edwards 입고 대신 확인', kind: 'note', status: '대기', priority: '보통', due_date: '2026-11-24', end_date: '2026-11-27', created_by: 'u1', created_at: '2026-11-13T01:00:00Z', comment_cnt: 0 },
  ]
  S.DEF = { ...(S.DEF || {}), pm_todo: () => ({ ...base, dept: ME.dept || '기타', status: '대기', priority: '보통', comment_cnt: 0 }) }
  if (_qs.get('noseen')) S.DATA.pm_todo.forEach((r) => { delete r.seen_at })
}
// v4.198.1 — ?flowc=1 : 예전 집계(줄 기준 679 · 679) · ?oc=1 : 새 PO 기준 요약 함수가 있는 DB
if (_qs.get('flowc')) S.RPCFN.pm_flow_counts = () => ({ ord_unconfirmed: 679, ord_waiting: 679, req_open: 52, rfq_price: 2 })
if (_qs.get('oc')) S.RPCFN.pm_order_confirm_summary = () => ({ unconf_po: 3, unconf_lines: 19, later_po: 2, waiting_po: 1 })
if (_qs.get('cyc')) Object.assign(S.RPCFN, {
  pm_cell_hold_active: () => S.DATA.holds.map((h) => ({ ...h, neg_cnt: S.DATA.inventory.filter((i) => i.location === h.location && i.qty < 0).length })),
  pm_cell_hold_set: (a) => { const loc = a.p_loc.toUpperCase(); const auto = S.DATA.inventory.some((i) => i.location === loc && i.qty < 0); const ex = S.DATA.holds.find((h) => h.location === loc); if (ex) ex.reason = a.p_reason; else S.DATA.holds.push({ location: loc, reason: a.p_reason, auto_neg: auto, held_date: new Date().toISOString().slice(0, 10), held_name: '김교한' }); return [] },
  pm_cell_hold_release: (a) => { const n = S.DATA.holds.length; S.DATA.holds = S.DATA.holds.filter((h) => h.location !== a.p_loc.toUpperCase()); return n - S.DATA.holds.length },
  pm_cell_items: (a) => S.DATA.inventory.filter((i) => i.location === a.p_loc).map((i) => { const it = S.DATA.items.find((x) => x.id === i.item_id); return { item_id: i.item_id, std_code: it.std_code, name: it.name, qty: i.qty, unit: 'EA', location: i.location } }),
})
if (_qs.get('cycp')) S.RPCFN.pm_cycle_save = (a) => { const t = new Date().toISOString().slice(0, 10); S.DATA.pm_cell_check.push({ id: 100 + S.DATA.pm_cell_check.length, location: a.p_loc, check_date: t, checked_by: ME.id, item_cnt: (a.p_rows || []).length, diff_cnt: 0, empty: !(a.p_rows || []).length, created_at: new Date().toISOString() }); return [{ saved_cnt: (a.p_rows || []).length, diff_cnt: 0 }] }
if (_qs.get('ecp')) S.RPCFN.pm_movement_ecount_mark = (a) => { if (S.FAIL.ecmark) throw new Error(S.FAIL.ecmark); let n = 0; for (const r of S.DATA.stock_movements) if (a.p_ids.includes(r.id) && r.movement_type === '입고') { r.ecount_purchase_at = a.p_clear ? null : new Date().toISOString(); r.ecount_purchase_by = a.p_clear ? null : 'gyohan@jinsuntech.co.kr'; n++ } return n }
if (_qs.get('iss') && _qs.get('iss') !== 'nofn') S.RPCFN.pm_order_issue_reply = () => { window.__issCalls++; let n = 0; for (const v of S.DATA.pm_line_issue_v) { const l = S.DATA.pm_order_line.find((x) => x.id === v.id); if (v.issued && l && l.reply == null) { l.reply = '가능'; l.reply_memo = '자재불출 완료 — 자동 회신'; l.replied_name = '자동(자재불출)'; n++ } } return n }
if (_qs.get('iss') === 'nofn') S.MISSING = [...(S.MISSING || []), 'pm_line_issue_v']
if (_qs.get('edsync') && _qs.get('edsync') !== 'nofn') S.RPCFN.pm_ed_order_groups = () => window.__edGroups.map((g) => ({ ...g }))
// v4.121.0 CSK ← 수주대장 — ?cskimp=1 (csk=1 과 같이) · ?cskimp=nofn 은 함수 없음(SQL 전)
if (_qs.get('cskimp') && _qs.get('cskimp') !== 'nofn') S.RPCFN.pm_csk_order_units = () => [
  { mgmt: 'JS2610-46', po_no: '6001400001', planned: false, order_date: '2026-10-28', spec: 'SCS0195S-0L1-ON055', model: 'SCSB116055AC', pre_assy: 'ECK03433-50', qty: 1, due: '2026-11-10', plnd: 'PLX1', prod: '8700001' },
  { mgmt: 'JS2610-47', po_no: '', planned: true, order_date: null, spec: 'SCS0195S-0L1-ON055', model: 'SCSB116055AC', pre_assy: null, qty: 1, due: '2026-11-10', plnd: 'PLX2', prod: null },
  { mgmt: 'JS2611-90', po_no: '발주 예정', planned: true, order_date: null, spec: 'SCS0195S-0T1-ON028', model: 'SCSB124028AF', pre_assy: 'ECK03431-32', qty: 1, due: '2026-11-20', plnd: '505999', prod: '8709999' }]
// v4.156.0 — 부족 계산 실패 알림 확인: ?shok=1 이면 정상 응답 (없으면 mock 이 「no fn」 에러)
if (_qs.get('shok')) Object.assign(S.RPCFN, {
  get_shortage: () => [{ item_id: 'p2', std_code: 'AX-6200111', name: 'CIRCUIT BREAKER 3P 20A', type: '자재', unit: 'EA', lt_weeks: 4, dept: null, manufacturer: 'LS산전', manufacturer_code: 'BKN-3P-20A', vendor_id: 'v1', vendor_name: '파워일렉', total_need: 12, stock: 3, pending: 0, other_qty: 0, other_names: null, parents: 'AX-110153030' }],
  get_shortage_monthly: () => [{ item_id: 'p2', std_code: 'AX-6200111', name: 'CIRCUIT BREAKER 3P 20A', type: '자재', unit: 'EA', lt_weeks: 4, dept: null, manufacturer: 'LS산전', manufacturer_code: 'BKN-3P-20A', vendor_id: 'v1', vendor_name: '파워일렉', current_stock: 3, year_month: '2026-11', demand: 12, incoming: 0 }],
})
// v4.158.0 하네스 출도 — 수주대장 줄 RPC 흉내: 고객사 PO 줄을 그 PO 와 같은 줄(id = cpo_id)로 본다 (1단계 옮김과 같은 모양)
if (!_qs.get('nofn4')) S.RPCFN.pm_ax_order_lines = (a) => {
  const D = S.DATA
  ;(D.production || []).forEach((r) => { if (r.po_id && !r.order_line_id) r.order_line_id = r.po_id })
  D.pm_order_line = D.pm_order_line || []
  const nos = a?.p_po_nos ? new Set(a.p_po_nos.map((x) => String(x).trim().toUpperCase())) : null
  return (D.purchase_orders || []).filter((p) => p.order_type === 'customer_po' && p.po_number)
    .filter((p) => (nos ? nos.has(String(p.po_number).trim().toUpperCase()) : !['완료', '취소'].includes(p.status)))
    .map((p) => ({ id: p.id, item_id: p.item_id, po_number: p.po_number, ccn: p.ccn || null, order_line: p.order_line, del_line: p.del_line || '1',
      division: p.division || null, item_rev: p.item_rev || null, item_brev: p.item_brev || null, qty_ordered: p.qty_ordered, qty_received: p.qty_received || 0,
      qty_remaining: p.qty_remaining ?? ((p.qty_ordered || 0) - (p.qty_received || 0)), promise_date: p.promise_date, status: p.status || '진행중',
      material_issued: !!p.material_issued, plan_exc: p.plan_exc || null, customer_code: 'AX', cpo_id: p.id,
      in_prod: (D.production || []).some((r) => r.po_id === p.id) }))
}
// v4.162.0 판매 실적가 — ?salep=1 (같은 고객사 실적가 : HOSE 부품 90,000 · GK0001 단품 5,000)
if (_qs.get('salep')) {
  S.DATA.pm_sale_price_hist = [
    { id: 'sp1', cust_key: 'cid-ax', code_key: 'AX-GHOSE01', kind: 'part', currency: 'KRW', unit_price: 90000, quote_no: 'S261001-003', quote_date: '2026-10-01', detail_sent: true, parent_code: 'AX-990000777' },
    { id: 'sp2', cust_key: 'cid-ax', code_key: 'AX-GK0001', kind: 'item', currency: 'KRW', unit_price: 5000, quote_no: 'S261002-001', quote_date: '2026-10-02', detail_sent: true },
    { id: 'sp3', cust_key: 'cid-ax', code_key: 'AX-GBODY01', kind: 'part', currency: 'KRW', unit_price: 1, quote_no: 'S261003-001', quote_date: '2026-10-03', detail_sent: false },
    { id: 'sp4', cust_key: 'cid-ax', code_key: 'AX-GHOSE01', kind: 'part', currency: 'KRW', unit_price: 80000, quote_no: 'AX 단가표 25년', quote_date: '2025-01-01', detail_sent: true, source: 'import' },
    { id: 'sp5', cust_key: 'cid-ax', code_key: 'AX-990000777', kind: 'assy', currency: 'KRW', unit_price: 1500000, quote_no: 'S261001-003', quote_date: '2026-10-01', detail_sent: true },
    { id: 'sp6', cust_key: 'cid-ax', code_key: 'AX-GK0002', kind: 'item', currency: 'USD', unit_price: 12.5, quote_no: 'S260901-002', quote_date: '2026-09-01', detail_sent: true },
  ].map((r) => ({ source: 'quote', std_code: r.kind === 'assy' ? null : r.code_key, created_at: r.quote_date + 'T09:00:00Z', ...r }))
  S.RPCFN.pm_last_sale_price = (a) => {
    const m = {}
    for (const h of S.DATA.pm_sale_price_hist) {
      if (h.cust_key !== a.p_cust_key || h.currency !== a.p_currency || !a.p_keys.includes(h.code_key)) continue
      if (!(h.kind === 'item' || (h.kind === 'part' && h.detail_sent))) continue
      const o = m[h.code_key]; if (!o || String(h.quote_date) > String(o.quote_date)) m[h.code_key] = h
    }
    return Object.values(m).map((h) => ({ ...h }))
  }
  S.RPCFN.pm_next_quote_no = () => 'S261109-001'
}
S.RPCFN.pm_todo_items = () => S.DATA.pm_todo.map((r) => ({ ...r }))
S.RPCFN.pm_todo_people = () => [{ id: 'u1', name: '김교한' }, { id: 'u2', name: '남기문' }]
if (_qs.get('cycp') && !_qs.get('nobae')) { const _pp = S.RPCFN.pm_todo_people; S.RPCFN.pm_todo_people = () => [..._pp(), { id: 'u-bae', name: '배솔' }] }
// 자재 요청 목록 (v4.104.0 시험) — ?mr=1
if (_qs.get('mr')) {
  const base = { urgency: '보통', purpose: 'LEB PD 조립', product_code: 'AX-110153030', product_name: 'ASSY MAIN PD', unit_no: '#12', unit: 'EA', req_date: '2026-10-24', reason: null, handler: null, handle_type: null, handle_memo: null, customer_code: 'AX', is_mine: false, po_id: null, check_dept: '구매자재팀', handled_at: null, issued_qty: 0, stock_qty: 120, stock_loc: 'A-01-02', po_pending: 0, req_kind: null, cut_mm: null, notice_msg: null, notice_by: null, notice_at: null, notice_seen_at: null, ready_date: null, strip_l_mm: null, strip_r_mm: null }
  S.DATA.mr_rows = [
    { ...base, id: 101, req_no: 'MR-261024-01', status: '요청', item_id: 'p1', std_code: 'AX-5100052', item_name: 'SCREW PAN HD M4X8', maker: 'MISUMI', maker_code: 'SPHS-M4-8', qty: 20, need_date: '2026-10-25', requester: '천석훈' },
    { ...base, id: 102, req_no: 'MR-261024-01', status: '요청', item_id: 'p2', std_code: 'AX-6200111', item_name: 'CIRCUIT BREAKER 3P 20A', maker: 'LS산전', maker_code: 'BKN-3P-20A', qty: 2, need_date: '2026-10-25', requester: '천석훈' },
    { ...base, id: 103, req_no: 'MR-261026-02', status: '요청', urgency: '긴급', item_id: null, std_code: null, item_name: 'TERMINAL RING 5.5-4', maker: null, maker_code: null, qty: 100, need_date: '2026-11-03', requester: '이정민', check_dept: '구매자재팀' }]
  const mrSet = (ids, patch) => { let n = 0; S.DATA.mr_rows.forEach((r) => { if (ids.includes(r.id)) { Object.assign(r, patch); n++ } }); return n }
  Object.assign(S.RPCFN, {
    pm_request_list: () => S.DATA.mr_rows.map((r) => ({ ...r })),
    pm_request_history: () => [
      { ...base, req_no: 'MR-261030-02', req_date: '2026-10-30', status: '처리중', std_code: 'ED-E21914660', item_name: 'CONTACTOR', qty: 1, requester: '윤재선' },
      { ...base, req_no: 'MR-261029-03', req_date: '2026-10-29', status: '완료', std_code: 'CS-MCK03381-00', item_name: 'Tube', qty: 2, requester: '윤재선' },
      { ...base, req_no: 'MR-261029-05', req_date: '2026-10-29', status: '완료', std_code: 'ED-NKB932435', item_name: 'NKBSP1888', qty: 3, requester: '윤재선' },
      { ...base, req_no: 'MR-261029-03', req_date: '2026-10-29', status: '완료', std_code: 'CS-MCK14340-00', item_name: 'Gas Sensor', qty: 4, requester: '윤재선' },
      { ...base, req_no: 'MR-261028-04', req_date: '2026-10-28', status: '반려', std_code: 'ED-NKB932879', item_name: 'NKB932879', qty: 15, requester: '윤재선', handle_memo: '재고 없음' },
      { ...base, req_no: 'MR-261031-01', req_date: '2026-10-28', status: '완료', std_code: 'ED-NRE188710', item_name: 'CABLE TIE', qty: 9, requester: '윤재선' }],
    pm_request_update: (a) => [{ updated: mrSet(a.p_ids, a.p_status === '요청' ? { status: '요청', handler: null, handled_at: null } : { status: a.p_status, handle_memo: a.p_memo ?? null, handler: a.p_status === '요청' ? null : '김교한', notice_msg: a.p_status === '반려' ? '반려 — ' + (a.p_memo || '사유 없음') : null }), skipped: 0, skipped_note: null }],
    pm_request_undo: (a) => [{ done: mrSet(a.p_ids.filter((id) => S.DATA.mr_rows.find((r) => r.id === id)?.status === '반려'), { status: '요청', handler: null, handle_memo: null }), skipped: 0, note: null }],
    pm_request_notice_seen: (a) => { if (a.p_clear) mrSet(a.p_ids, { notice_msg: null, notice_at: null }); return null },
    pm_request_cancel: () => 'ok',
    pm_request_notice_count: () => 0,
    // 부분 불출 (v4.123.0 시험) — DB 함수와 같은 규칙
    ...(() => {
      const stock = { p1: 15, p2: 10 }; S.DATA.mr_stock = stock; S.DATA.mr_moves = []
      const part = (a) => {
        const r = S.DATA.mr_rows.find((x) => x.id === a.p_id)
        if (['완료', '반려'].includes(r.status)) throw new Error('이미 ' + r.status + ' 된 요청입니다')
        const left = r.qty - (r.issued_qty || 0), q = Number(a.p_qty)
        if (!(q > 0)) throw new Error('불출 수량은 0보다 커야 합니다')
        if (q > left) throw new Error('남은 수량(' + left + ')보다 많이 불출할 수 없습니다')
        if ((stock[r.item_id] || 0) < q && !a.p_force) return [{ done: 0, failed: 1, forced: 0, note: r.std_code + ' 재고 부족(' + (stock[r.item_id] || 0) + '/' + q + ')', issued: r.issued_qty || 0, remain: left }]
        stock[r.item_id] = (stock[r.item_id] || 0) - q; S.DATA.mr_moves.push({ id: r.id, q })
        const nw = (r.issued_qty || 0) + q
        if (nw >= r.qty) Object.assign(r, { status: '완료', handle_type: '불출', issued_qty: r.qty })
        else Object.assign(r, { status: r.status === '요청' ? '확인' : r.status, issued_qty: nw })
        return [{ done: 1, failed: 0, forced: a.p_force ? 1 : 0, note: null, issued: Math.min(nw, r.qty), remain: Math.max(r.qty - nw, 0) }]
      }
      const bulk = (a) => { let d = 0; for (const id of a.p_ids) { const r = S.DATA.mr_rows.find((x) => x.id === id); if (!r || ['완료', '반려'].includes(r.status) || !r.item_id) continue; const need = r.qty - (r.issued_qty || 0); stock[r.item_id] -= need; S.DATA.mr_moves.push({ id, q: need }); Object.assign(r, { status: '완료', handle_type: '불출', issued_qty: r.qty }); d++ } return [{ done: d, failed: 0, forced: 0, note: null }] }
      const undo = (a) => { let u = 0, sb = 0; for (const id of a.p_ids) { const r = S.DATA.mr_rows.find((x) => x.id === id); if (!(r.status === '완료' || (r.status !== '반려' && (r.issued_qty || 0) > 0))) continue; S.DATA.mr_moves.filter((m) => m.id === id).forEach((m) => { stock[r.item_id] += m.q; sb++ }); S.DATA.mr_moves = S.DATA.mr_moves.filter((m) => m.id !== id); Object.assign(r, { status: '확인', handle_type: null, issued_qty: null }); u++ } return [{ undone: u, stock_back: sb, skipped: 0, note: null }] }
      return { pm_request_issue_part: part, pm_request_issue: bulk, pm_request_undo_done: undo }
    })(),
  })
}
// 처음 안내(코치마크)는 ?coach=1 일 때만 — 다른 시험이 안내 창에 막히지 않게 (v4.104.0)
if (!new URLSearchParams(location.search).get('coach')) { try { ['orders-sales', 'todo', 'sales-quote', 'doc-request', 'material-request', 'field-search'].forEach((id) => localStorage.setItem('pm_coach_seen_' + id, '1')) } catch { /* */ } }
const _fc = new URLSearchParams(location.search).get('fc')
// v4.149.0 부품표 단가 요청 — ?pq=1 : 빈 견적 접수 + BOM 없는 품목 하나(rq2 · 코드 부여 전)
if (_qs.get('pq')) {
  S.DATA.pm_rfq = S.DATA.pm_rfq || []; S.DATA.pm_rfq_line = S.DATA.pm_rfq_line || []
  S.DATA.pm_rfq.push({ id: 'rq2', seq: 21, customer_code: 'ax', customer_id: 'cid-ax', title: '신규 제어반 (코드 전)', due_date: '2026-11-20', status: '진행', owner_name: '이정민', created_at: '2026-11-03T01:00:00Z', updated_at: '2026-11-03T01:00:00Z' })
  S.DATA.pm_rfq_line.push({ id: 'rp1', rfq_id: 'rq2', line_no: 1, pn: 'CTRL-BOX-NEW', name: 'CONTROL BOX (신규)', qty: 3, kind: 'none', part_count: 0, noprice_count: 0, noprice_codes: [], checked_at: '2026-11-03T01:00:00Z', nq_parts: [], created_at: '2026-11-03T01:00:00Z' })
}
// v4.160.0 견적 임시코드 — ?tmpq=1 : 등록 안 된 단품 부품 4줄 (하나는 제조사품번으로 있는 품목)
if (_qs.get('tmpq')) {
  S.DATA.pm_rfq = S.DATA.pm_rfq || []; S.DATA.pm_rfq_line = S.DATA.pm_rfq_line || []
  S.DATA.pm_rfq.push({ id: 'rq9', seq: 31, customer_code: 'ax', customer_id: 'cid-ax', title: 'HRS INTERIM PART 견적', due_date: '2026-11-12', status: '진행', owner_name: '박웅진', created_at: '2026-11-04T01:00:00Z', updated_at: '2026-11-04T01:00:00Z' })
  ;[['APC SMT750RM2UC', 1], ['WAGO 221-412', 2], ['SCHURTERRC320-10', 3], ['LS BKN 3P 20A', 4]].forEach(([pn, i]) =>
    S.DATA.pm_rfq_line.push({ id: 'rt' + i, rfq_id: 'rq9', line_no: i, pn, name: '', qty: 1, kind: 'none', part_count: 0, noprice_count: 0, noprice_codes: [], checked_at: '2026-11-04T01:00:00Z', nq_parts: [], created_at: '2026-11-04T01:00:00Z' }))
}
// v4.160.0 임시코드 정식 전환 — ?tmpi=1 : TMP 품목 2개 + 그 코드를 쓰는 견적 부품표
if (_qs.get('tmpi')) {
  S.DATA.items.push({ id: 'tm1', std_code: 'TMP-2611-0001', name: 'UPS 750VA', type: '자재', unit: 'EA', manufacturer: 'APC', manufacturer_code: 'SMT750RM2UC', purchase_price: 410000, stock_managed: false, memo: '견적용 임시코드 — HRS' },
    { id: 'tm2', std_code: 'TMP-2611-0002', name: 'BREAKER', type: '자재', unit: 'EA', manufacturer: 'LS', manufacturer_code: 'BKN 3P 20A', purchase_price: 30000, stock_managed: false, memo: '견적용 임시코드 — HRS' })
  S.DATA.pm_rfq = S.DATA.pm_rfq || []; S.DATA.pm_rfq_line = S.DATA.pm_rfq_line || []
  S.DATA.pm_rfq.push({ id: 'rq8', seq: 30, customer_code: 'ax', customer_id: 'cid-ax', title: 'HRS', status: '진행', created_at: '2026-11-04T01:00:00Z', updated_at: '2026-11-04T01:00:00Z' })
  S.DATA.pm_rfq_line.push({ id: 'ru1', rfq_id: 'rq8', line_no: 1, pn: 'APC SMT750RM2UC', qty: 1, kind: 'assy', nq_parts: [], paste_parts: { labor: 0, parts: [{ maker: 'APC', mpn: 'SMT750RM2UC', qty: 1, item_id: 'tm1', std_code: 'TMP-2611-0001', price: 410000, src: '구매 입력' }] } },
    { id: 'ru2', rfq_id: 'rq8', line_no: 2, pn: 'LS BKN 3P 20A', qty: 1, kind: 'assy', nq_parts: [], paste_parts: { labor: 0, parts: [{ maker: 'LS', mpn: 'BKN 3P 20A', qty: 1, item_id: 'tm2', std_code: 'TMP-2611-0002', price: 30000, src: '구매 입력' }] } })
}
// v4.161.0 담기함 고객사 — ?cartcs=1 : 고객사 없는 줄 2 + 있는 줄 1
if (_qs.get('cartcs')) S.DATA.pm_po_cart = [
  { id: 'pc1', item_id: 'p1', customer_id: null, vendor_id: 'v1', qty: 5, promise_date: '2026-11-13', unit_price: 100, memo: '자재요청 MR-1', created_at: '2026-11-09T01:00:00Z' },
  { id: 'pc2', item_id: 'p2', customer_id: null, vendor_id: 'v1', qty: 3, promise_date: '2026-11-13', unit_price: 100, memo: '자재요청 MR-2', created_at: '2026-11-09T01:00:01Z' },
  { id: 'pc3', item_id: 'p2', customer_id: 'cid-ax', vendor_id: 'v1', qty: 1, promise_date: '2026-11-13', unit_price: 100, memo: '', created_at: '2026-11-09T01:00:02Z' }]
// v4.165.0 공정 현황판 — ?pboard=1 : 고객사별 진행 호기 + 스캔 기록 1건 (pb1 전장 시작)
if (_qs.get('pboard')) {
  const now = new Date().toISOString()
  S.DEF = { ...(S.DEF || {}), pm_prod_scan: () => ({ at: new Date().toISOString() }) }
  S.DATA.production = [
    { id: 'pb1', customer_code: 'AX', pn: '110153030', name: 'ASSY MAIN PD', hogi: '#14', status: '제작중', req_date: '2026-11-06', machine_recv: true, harness_recv: true, part_issue: true, order_line_id: 'pbl1', rev: 'E', brev: 'E', missing_parts: [{ pn: 'AX-5102060', name: 'SHELL 9P', qty: 2, date: '2026-11-12' }], changes: [] },
    { id: 'pb2', customer_code: 'AX', pn: '110153030', name: 'ASSY MAIN PD', hogi: '#15', status: 'PO접수', req_date: '2026-11-20', order_line_id: 'pbl2', missing_parts: [], changes: [] },
    { id: 'pb3', customer_code: 'AX', pn: '110018390', name: 'INTERLOCK SWITCH ASSEMBLY', hogi: '#3', status: '제작대기', req_date: '2026-11-12', part_issue: true, missing_parts: [{ pn: '5102060', name: 'SHELL 9P', maker: 'MOLEX', makerPn: '39-01-2090', qty: '3', date: '' }, { pn: 'AX-6000111', name: 'RELAY', qty: 1, date: '2026-11-15' }], changes: [] },
    { id: 'pb4', customer_code: 'VM', pn: 'Nardo', name: '3by2', hogi: 'EM3A71', status: 'PO접수', req_date: '2026-11-13', vm: { esc: '완료', ac: '완료', ut: '완료', st: '완료', pm: '완료', etc: '완료' }, missing_parts: [], changes: [] },
    { id: 'pb5', customer_code: 'CSK', pn: 'CSK-PD-100', name: 'CSK POWER BOX', hogi: 'C1', status: '제작대기', req_date: '2026-11-30', part_issue: true, missing_parts: [], changes: [] },
    { id: 'pb6', customer_code: 'ED', pn: 'A12345678', name: 'EDWARDS PD', hogi: '#2', part: '전장', status: '제작중', req_date: '2026-11-25', due_fix: '2026-11-10', machine_recv: true, missing_parts: [], changes: [] },
    { id: 'pb8', customer_code: 'AX', pn: '110132770', name: 'Assembly Remote PD', hogi: '#4', status: '납품대기', req_date: '2026-11-15', machine_recv: true, harness_recv: true, part_issue: true, elec_recv: true, quality_recv: true, missing_parts: [], changes: [] },
    { id: 'pb9', customer_code: 'CSK', pn: 'CSK-PD-200', name: 'CSK POWER BOX 2', hogi: 'C2', status: '품질검수', req_date: '2026-11-28', part_issue: true, elec_recv: true, missing_parts: [], changes: [] },
    { id: 'pb7', customer_code: 'AX', pn: '110153030', name: 'ASSY MAIN PD', hogi: '#13', status: '완료', req_date: '2026-11-01', missing_parts: [], changes: [] },
  ]
  S.DATA.pm_order.push({ id: 'pbo1', customer_code: 'AX', po_no: 'PB-PO-1', registered_at: now, order_date: '2026-10-01', currency: 'KRW', source: 'pdf', kind: 'po' })
  S.DATA.pm_order_line = S.DATA.pm_order_line || []
  S.DATA.pm_order_line.push({ id: 'pbl1', order_id: 'pbo1', item_id: null, qty: 1, due_date: '2026-11-06' }, { id: 'pbl2', order_id: 'pbo1', item_id: null, qty: 1, due_date: '2026-11-20' })
  S.DATA.pm_prod_scan = [{ id: 1, production_id: 'pb1', step: 'make', kind: 'start', by_name: '천석훈', device: '폰', at: now }]
  if (_qs.get('pboard') === 'noscan') S.MISSING = [...(S.MISSING || []), 'pm_prod_scan']
}
// v4.166.0 다품목 출고 장바구니 — ?pick=1 : p1 두 호기 + p2 직접
if (_qs.get('pick')) S.DATA.pm_picking = [
  { id: 'pk1', customer_id: 'cid-ax', item_id: 'p1', std_code: 'AX-5100052', name: 'SCREW PAN HD M4X8', unit: 'EA', qty: 4, issue_qty: 4, source: 'hogi', pn: '110153030', hogi: '#14', created_at: '2026-11-10T01:00:00Z' },
  { id: 'pk2', customer_id: 'cid-ax', item_id: 'p1', std_code: 'AX-5100052', name: 'SCREW PAN HD M4X8', unit: 'EA', qty: 2, issue_qty: 2, source: 'hogi', pn: '110153030', hogi: '#15', created_at: '2026-11-10T01:00:01Z' },
  { id: 'pk3', customer_id: 'cid-ax', item_id: 'p2', std_code: 'AX-6200111', name: 'CIRCUIT BREAKER 3P 20A', unit: 'EA', qty: 1, issue_qty: 1, source: 'direct', created_at: '2026-11-10T01:00:02Z' }]
if (window.__bomAsm) S.RPCFN.get_bom_assemblies = () => window.__bomAsm
if (window.__explFn) S.RPCFN.pm_explode_assy = window.__explFn
// v4.186.2 — ?prodall=1 : 호기 연결 한 번에 주는 함수가 있는 상태
if (_qs.get('prodall')) S.RPCFN.pm_line_prod_all = () => ({ prod: (S.DATA.pm_line_prod_v || []).map((r) => ({ ...r })), iss: (S.DATA.pm_line_issue_v || []).map((r) => ({ id: r.id, issued: r.issued, src: r.src })) })
if (_fc) { const _base = S.RPCFN.pm_flow_counts(); S.RPCFN.pm_flow_counts = () => ({ ..._base, ...JSON.parse(_fc) }) }
const r = new URLSearchParams(location.search).get('r') || '/'
const __qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }); window.__qc = __qc; window.__S = S; window.__same = { ...__sameItem, ...__cellAux, ...__stockLookup }
createRoot(document.getElementById('root')).render(<QueryClientProvider client={__qc}><MemoryRouter initialEntries={[r]}><App /><Toaster /></MemoryRouter></QueryClientProvider>)
