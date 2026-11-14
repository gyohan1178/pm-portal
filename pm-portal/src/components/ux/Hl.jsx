// 검색어 강조 (v4.192.0) — 결과에서 맞은 글자를 표시한다. 품번이 비슷한 게 많아 어디가 맞았는지 바로 보이게
//   검색이 띄어쓰기 · 하이픈을 무시하므로 강조도 무시하고 맞춘다 (「db 25」 → 「DB-25」)
const norm = (s) => String(s || '').toUpperCase().replace(/[\s\-_/.]/g, '')
// 계산만 (시험용) — [시작, 끝) 범위 목록 (겹치면 합침)
export function hlRanges(text, q) {
  const src = String(text ?? ''), toks = String(q || '').split(/\s+/).map(norm).filter((t) => t.length >= 2)
  if (!src || !toks.length) return []
  const map = []; let n = ''
  for (let i = 0; i < src.length; i++) { const c = src[i]; if (/[\s\-_/.]/.test(c)) continue; n += c.toUpperCase(); map.push(i) }
  const rs = []
  for (const t of toks) {
    let at = n.indexOf(t)
    while (at >= 0) { rs.push([map[at], map[at + t.length - 1] + 1]); at = n.indexOf(t, at + t.length) }
  }
  rs.sort((a, b) => a[0] - b[0])
  const out = []
  for (const r of rs) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push([...r]) }
  return out
}
export default function Hl({ text, q }) {
  const src = String(text ?? ''), rs = hlRanges(src, q)
  if (!rs.length) return src
  const parts = []; let p = 0
  rs.forEach(([a, b], i) => { if (a > p) parts.push(src.slice(p, a)); parts.push(<mark key={i} data-hl className="bg-amber-200/70 text-inherit rounded-[2px] px-[1px]">{src.slice(a, b)}</mark>); p = b })
  if (p < src.length) parts.push(src.slice(p))
  return <>{parts}</>
}
