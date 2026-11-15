// 아주 작은 Supabase 흉내 — 표 이름별 배열 · eq/in/not in/order/range/limit/single/maybeSingle · insert/update/delete
export const S = { DATA: {}, WRITES: [], RPC: [], UNIQUE: {}, FAIL: {}, SEQ: 0 }
// 묶어 읽기 흉내 — items(…) · items!fk(…) · pm_order_line(*, items(…))
function embed(table, rows, cols) {
  if (!cols) return rows
  const itemsOf = (r) => (S.DATA.items || []).find((x) => x.id === r.item_id) || null
  return rows.map((r) => {
    let o = { ...r }
    if (/items(!\w+)?\(/.test(cols) && 'item_id' in r) o.items = itemsOf(r)
    if (/(^|[,\s])pm_order\(/.test(cols) && 'order_id' in r) o.pm_order = (S.DATA.pm_order || []).find((x) => x.id === r.order_id) || null
    if (/pm_order_line\(/.test(cols)) o.pm_order_line = (S.DATA.pm_order_line || []).filter((l) => l.order_id === r.id).map((l) => ({ ...l, items: itemsOf(l) }))
    return o
  })
}
const getPath = (r, c) => c.replace('->>', '.').split('.').reduce((o, k) => (o == null ? o : o[k]), r)
// 보기(view) 흉내 — 수주대장 빠르게 (v4.103.0). 실제 SQL 과 같은 기준 (지난 줄은 넉넉히 전부 — 결과는 같다)
const liveOf = (l, o) => !l.cancelled && !o?.cancelled && !((+l.qty || 0) > 0 && (+l.delivered_qty || 0) >= +l.qty)
const obMap = () => new Map((S.DATA.pm_order || []).map((o) => [o.id, o]))
export const VIEWS = {
  pm_order_line_live_v: () => { const ob = obMap(), im = new Map((S.DATA.items || []).map((i) => [i.id, i])); return (S.DATA.pm_order_line || []).filter((l) => ob.has(l.order_id) && liveOf(l, ob.get(l.order_id))).map((r) => { const i = im.get(r.item_id); return { item_std_code: i?.std_code ?? null, item_name: i?.name ?? null, item_js_code: i?.js_code ?? null, ...r } }) },
  pm_order_line_hist_v: () => { const ob = obMap(); return (S.DATA.pm_order_line || []).filter((l) => ob.has(l.order_id) && !liveOf(l, ob.get(l.order_id))).map((r) => ({ ...r })) },
  pm_order_money_v: (pq) => {
    const ob = obMap(), m = new Map(), im = new Map((S.DATA.items || []).map((i) => [i.id, i])), K = String(pq || '').trim().toUpperCase()
    for (const l of S.DATA.pm_order_line || []) {
      const o = ob.get(l.order_id); if (!o || l.cancelled || o.cancelled) continue
      if (K) { const i = im.get(l.item_id) || {}; if (![o.po_no, o.file_name, o.ship_to, i.std_code, i.name, l.raw_pn, l.raw_desc, l.note, l.plnd_no, l.prod_no].some((v) => String(v || '').toUpperCase().includes(K))) continue }
      const usd = o.currency === 'USD' || o.ccn === 'B', y = l.due_date ? +String(l.due_date).slice(0, 4) : null
      const k = `${o.customer_code}|${usd}|${y}`
      const r = m.get(k) || { customer_code: o.customer_code, usd, y, amt: 0, done: 0, no_price: 0, n: 0 }
      r.amt += (+l.qty || 0) * (+l.unit_price || 0); r.done += Math.min(+l.delivered_qty || 0, +l.qty || 0) * (+l.unit_price || 0)
      if (!(+l.unit_price > 0)) r.no_price++; r.n++; m.set(k, r)
    }
    return [...m.values()]
  },
}
function q(table) {
  const st = { cols: null, f: [], write: null, single: false, maybe: false, head: false, range: null, limit: null }
  const run = () => {
    if (!st.write) (S.READLOG ||= []).push(table)
    if (!st.write && st.range && S.READFAIL && S.READFAIL[table] > 0) { S.READFAIL[table]--; return { data: null, error: { code: '57014', message: S.READFAILMSG || 'canceling statement due to statement timeout' } } }
    if (S.MISSING && S.MISSING.includes(table)) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }
    let rows = (S.DATA[table] || (VIEWS[table] && !st.write ? VIEWS[table]() : []) || []).filter((r) => st.f.every((fn) => fn(r)))
    if (st.write) {
      if (S.FAIL[table + ':' + st.write.op]) return { data: null, error: { message: S.FAIL[table + ':' + st.write.op] } }
      if (st.write.op === 'insert') {
        const uq = S.UNIQUE[table]
        if (uq && !st.write.conflict) {
          const incoming = Array.isArray(st.write.v) ? st.write.v : [st.write.v]
          const all = [...(S.DATA[table] || [])]
          for (const x of incoming) { if (all.some((r) => uq.every((c) => r[c] === x[c]))) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }; all.push(x) }
        }
        if (st.write.conflict) {
          const cols = st.write.conflict.split(',').map((c) => c.trim())
          const incoming = Array.isArray(st.write.v) ? st.write.v : [st.write.v]
          S.DATA[table] = (S.DATA[table] || []).filter((r) => !incoming.some((x) => cols.every((c) => r[c] === x[c])))
        }
        const arr = (Array.isArray(st.write.v) ? st.write.v : [st.write.v]).map((x, i) => ({ id: `${table}-${++S.SEQ}`, created_at: new Date().toISOString(), ...(S.DEF && S.DEF[table] ? S.DEF[table]() : {}), ...x }))
        S.DATA[table] = [...(S.DATA[table] || []), ...arr]; S.WRITES.push({ op: 'insert', table, rows: arr })
        return { data: st.single || st.maybe ? arr[0] : arr, error: null }
      }
      if (st.write.op === 'update') {
        const before = rows.map((r) => ({ ...r }))
        rows.forEach((r) => Object.assign(r, st.write.v))
        const uq = S.UNIQUE[table]
        if (uq) {   // 실제 DB 처럼 unique 위반이면 되돌리고 오류
          const seen = new Set()
          const dup = (S.DATA[table] || []).some((r) => { const k = uq.map((c) => r[c]).join('|'); if (seen.has(k)) return true; seen.add(k); return false })
          if (dup) { rows.forEach((r, i) => Object.assign(r, before[i])); return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint (update)' } } }
        }
        S.WRITES.push({ op: 'update', table, n: rows.length, patch: st.write.v }); return { data: rows, error: null }
      }
      if (st.write.op === 'delete') { S.DATA[table] = (S.DATA[table] || []).filter((r) => !rows.includes(r)); S.WRITES.push({ op: 'delete', table, n: rows.length }); return { data: null, error: null } }
    }
    const total = rows.length
    S.READS = S.READS || {}; S.READS[table] = (S.READS[table] || 0) + 1
    S.SELS = S.SELS || {}; if (!st.head) (S.SELS[table] ||= []).push(st.cols || '*')
    if (S.NOCOLS && !st.head && st.cols) { const bad = S.NOCOLS.find((c) => new RegExp('(^|,)\\s*' + c + '\\s*(,|$)').test(st.cols)); if (bad) return { data: null, error: { code: '42703', message: `column ${table}.${bad} does not exist` } } }
    if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1)
    if (st.limit != null) rows = rows.slice(0, st.limit)
    if (S.MAXROWS && !st.write && !st.head) rows = rows.slice(0, S.MAXROWS)   // Supabase 처럼 한 번에 최대 N행
    if (st.head) return { data: null, error: null, count: total }
    rows = embed(table, rows, st.cols)
    // ?proj — 고른 칸만 돌려준다 (실제 Supabase 처럼 · 「*」 나 묶어 읽기가 없을 때만)
    if (S.PROJECT && st.cols && !/[*(]/.test(st.cols)) { const cs = st.cols.split(',').map((c) => c.trim()).filter(Boolean); rows = rows.map((r) => Object.fromEntries(cs.map((c) => [c, r[c] ?? null]))) }
    if (st.single || st.maybe) return { data: rows[0] ?? null, error: null }
    return { data: rows, error: null, count: total }
  }
  const api = {
    select(c, o) { st.cols = c; if (o?.head) st.head = true; return api },
    eq(c, v) { st.f.push((r) => getPath(r, c) === v); return api },
    neq(c, v) { st.f.push((r) => getPath(r, c) !== v); return api },
    in(c, vs) { st.f.push((r) => vs.includes(getPath(r, c))); return api },
    not(c, op, v) { if (op === 'in') { const vs = String(v).replace(/[()]/g, '').split(','); st.f.push((r) => !vs.includes(getPath(r, c))) } else if (op === 'is') st.f.push((r) => getPath(r, c) != null); return api },
    is(c, v) { st.f.push((r) => (getPath(r, c) ?? null) === v); return api },
    gt(c, v) { st.f.push((r) => getPath(r, c) > v); return api }, gte(c, v) { st.f.push((r) => getPath(r, c) >= v); return api },
    lt(c, v) { st.f.push((r) => getPath(r, c) < v); return api }, lte(c, v) { st.f.push((r) => getPath(r, c) <= v); return api },
    like(c, pat) { const re = new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$'); st.f.push((r) => re.test(String(getPath(r, c) ?? ''))); return api },
    // or('a.lt.x,and(b.is.null,c.lt.y)') — PostgREST 모양 흉내 (lt · lte · gt · gte · eq · neq · is.null · ilike)
    or(expr) {
      const split = (t) => { const out = []; let d = 0, cur = ''; for (const ch of t) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = '' } else cur += ch } if (cur) out.push(cur); return out }
      const one = (t) => {
        const m = /^(and|or)\((.*)\)$/.exec(t)
        if (m) { const parts = split(m[2]).map(one); return m[1] === 'and' ? (r) => parts.every((f) => f(r)) : (r) => parts.some((f) => f(r)) }
        const [c, op, ...rest] = t.split('.'); const v = rest.join('.')
        return (r) => { const x = getPath(r, c); if (op === 'is') return v === 'null' ? x == null : String(x) === v; if (x == null) return false
          return op === 'lt' ? x < v : op === 'lte' ? x <= v : op === 'gt' ? x > v : op === 'gte' ? x >= v : op === 'eq' ? String(x) === v : op === 'neq' ? String(x) !== v : op === 'ilike' ? (() => { const vv = /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v; return new RegExp('^' + vv.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', 'i').test(String(x)) })() : true }
      }
      if (typeof expr === 'string' && expr) { const fs = split(expr).map(one); st.f.push((r) => fs.some((f) => f(r))) }
      return api
    }, order() { return api },
    ilike(c, pat) { const re = new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i'); st.f.push((r) => re.test(String(getPath(r, c) ?? ''))); return api },
    // jsonb 포함(@>) 흉내 — 배열은 「각 항목이 어떤 항목에 포함」 (v4.160.0 시험)
    contains(c, v) { const sub = (x, y) => (Array.isArray(y) ? Array.isArray(x) && y.every((yy) => x.some((xx) => sub(xx, yy))) : y && typeof y === 'object' ? x && typeof x === 'object' && Object.entries(y).every(([k, vv]) => sub(x[k], vv)) : x === y); st.f.push((r) => sub(getPath(r, c), v)); return api },
    range(a, b) { st.range = [a, b]; return api }, limit(n) { st.limit = n; return api },
    single() { st.single = true; return api }, maybeSingle() { st.maybe = true; return api },
    insert(v) { st.write = { op: 'insert', v }; return api }, upsert(v, o) { st.write = { op: 'insert', v, conflict: o?.onConflict }; return api },
    update(v) { st.write = { op: 'update', v }; return api }, delete() { st.write = { op: 'delete' }; return api },
    then(res, rej) { return (S.DELAY ? new Promise((r) => setTimeout(r, S.DELAY)).then(run) : Promise.resolve(run())).then(res, rej) },
  }
  return api
}
const auth = { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b' } } }), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }
const rpcRun = async (fn, args) => { S.RPC.push({ fn, args }); if (S.RPCFAIL && S.RPCFAIL[fn] > 0) { S.RPCFAIL[fn]--; return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } } if (S.RPCFN && S.RPCFN[fn]) return { data: S.RPCFN[fn](args), error: null }; if (fn === 'pm_order_money' && !(S.MISSING || []).includes('pm_order_money')) return { data: VIEWS.pm_order_money_v(args?.p_q), error: null }; return { data: null, error: { code: 'PGRST202', message: 'mock no fn ' + fn } } }
// rpc 도 실제처럼 .order() · .range() 를 붙일 수 있게 (한 번에 S.MAXROWS 행까지)
const rpcB = (fn, args) => { const st = { range: null, ord: [] }; const b = {
  order(c, o) { st.ord.push([c, o?.ascending !== false]); return b }, range(x, y) { st.range = [x, y]; return b }, eq() { return b },
  then(res, rej) { return rpcRun(fn, args).then((r) => { if (Array.isArray(r.data)) { let d = [...r.data]; if (st.ord.length) d.sort((p, q2) => { for (const [c, asc] of st.ord) { const A = p[c], B = q2[c]; if (A === B) continue; return (A > B ? 1 : -1) * (asc ? 1 : -1) } return 0 }); if (st.range) d = d.slice(st.range[0], st.range[1] + 1); if (S.MAXROWS) d = d.slice(0, S.MAXROWS); r = { ...r, data: d } } return r }).then(res, rej) } }; return b }
export const client = { from: q, rpc: rpcB, auth, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel() {} }
export function createClient() { return client }
