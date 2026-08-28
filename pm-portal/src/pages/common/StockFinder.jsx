import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

// 창고 입구 검색대.
//
//   창고 위치는 A1-05-1 처럼 이미 좌표다. 그 형식을 화면의 뼈대로 삼아,
//   랙에 붙은 태그와 같은 얼굴(모노스페이스)로 크게 보여준다.
//   화면에서 본 것을 랙에서 그대로 찾을 수 있어야 하기 때문이다.
//
//   서서 쓰는 화면이라 답(위치) 하나에 집중하고 나머지는 물러나게 했다.
export default function StockFinder() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const timer = useRef(null)
  const inputRef = useRef(null)

  const search = useCallback((v) => {
    setQ(v)
    clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); setDone(false); return }
    setBusy(true)
    timer.current = setTimeout(async () => {
      const t = v.trim()
      const { data: items } = await supabase.from('items')
        .select('id,std_code,name,unit,manufacturer,manufacturer_code')
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%,spec.ilike.%${t}%`)
        .order('std_code')
        .limit(20)

      // 재고는 따로 가져온다.
      //   items 에서 inventory(...) 로 딸려 오게 하면
      //   위치가 있는데도 빈 값이 오는 경우가 있었다.
      const ids = (items || []).map(x => x.id)
      const invMap = {}
      if (ids.length) {
        const { data: inv } = await supabase.from('inventory')
          .select('item_id,qty,location').in('item_id', ids)
        ;(inv || []).forEach(r => { invMap[r.item_id] = r })
      }
      const data = (items || []).map(x => ({
        ...x,
        inventory: invMap[x.id] ? [invMap[x.id]] : [],
      }))
      // 위치가 있는 것을 먼저 — 찾으러 온 사람에게 필요한 답이다
      const rows = (data || []).sort((a, b) => {
        const al = a.inventory?.[0]?.location ? 0 : 1
        const bl = b.inventory?.[0]?.location ? 0 : 1
        return al - bl || String(a.std_code).localeCompare(String(b.std_code))
      })
      setHits(rows); setBusy(false); setDone(true)
    }, 350)
  }, [])

  function reset() {
    setQ(''); setHits([]); setDone(false)
    inputRef.current?.focus()
  }

  // 앞뒤 공백이 섞여 들어오면 못 읽어 '위치 미지정' 으로 보였다
  const parseLoc = (loc) => {
    const m = String(loc || '').trim().match(/^([A-Z]+\d*)\s*-\s*(\d+)\s*-\s*(\d+)$/i)
    return m ? { rack: m[1].toUpperCase(), cell: m[2], lv: m[3] } : null
  }

  const outLink = (h, kind) => {
    const key = (h.manufacturer_code || '').trim()
      ? `${h.manufacturer || ''} ${h.manufacturer_code}`.trim()
      : (h.name || h.std_code)
    const s = encodeURIComponent(key)
    return kind === 'img'
      ? `https://www.google.com/search?tbm=isch&q=${s}`
      : `https://www.google.com/search?q=${s}`
  }

  return (
    <div className="min-h-[85vh] -mx-4 -mt-4 px-4 pt-4" style={{ background: '#FAFAF8' }}>
      {/* 검색 */}
      <div className="max-w-2xl mx-auto pt-3 pb-5">
        <div className="flex items-baseline gap-2.5 mb-3">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight" style={{ color: '#1A1A1A' }}>
            자재 위치 찾기
          </h1>
          <span className="text-[11px] sm:text-xs" style={{ color: '#8A8A82' }}>
            품번 · 품명 · 제조사품번
          </span>
        </div>

        <div className="relative">
          <input ref={inputRef} value={q} onChange={e => search(e.target.value)} autoFocus
            placeholder="검색어 입력"
            className="w-full px-4 sm:px-5 py-3.5 sm:py-4 text-lg sm:text-xl font-semibold
              bg-white focus:outline-none"
            style={{ border: '2px solid #1A1A1A', fontFamily: MONO, letterSpacing: '0.02em' }} />
          {q && (
            <button onClick={reset} aria-label="지우기"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9
                flex items-center justify-center text-lg"
              style={{ color: '#8A8A82' }}>
              ✕
            </button>
          )}
        </div>

        {busy && <p className="text-xs mt-2.5" style={{ color: '#8A8A82' }}>찾는 중…</p>}
        {done && hits.length > 0 && (
          <p className="text-xs mt-2.5" style={{ color: '#8A8A82' }}>
            {n(hits.length)}건 · 위치가 확인된 것부터
          </p>
        )}
      </div>

      {/* 결과 */}
      <div className="max-w-2xl mx-auto pb-10 space-y-2.5">
        {hits.map(h => {
          const inv = h.inventory?.[0]
          const loc = parseLoc(inv?.location)
          const qty = Number(inv?.qty) || 0
          return (
            <article key={h.id} className="bg-white" style={{ border: '1px solid #E5E3DD' }}>

              {/* 좌표 — 답이므로 맨 위에, 랙 태그와 같은 얼굴로 */}
              {loc ? (
                <div className="px-4 py-3.5 flex items-center justify-between gap-3"
                  style={{ background: '#0F5F4C' }}>
                  <div>
                    <div className="flex items-baseline gap-1" style={{ fontFamily: MONO }}>
                      <span className="text-3xl sm:text-4xl font-bold text-white leading-none">{loc.rack}</span>
                      <span className="text-2xl sm:text-3xl leading-none" style={{ color: '#7FBFAE' }}>-</span>
                      <span className="text-3xl sm:text-4xl font-bold text-white leading-none">{loc.cell}</span>
                      <span className="text-2xl sm:text-3xl leading-none" style={{ color: '#7FBFAE' }}>-</span>
                      <span className="text-3xl sm:text-4xl font-bold text-white leading-none">{loc.lv}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] font-semibold tracking-wide"
                      style={{ color: '#7FBFAE' }}>
                      {loc.rack}랙 · {Number(loc.cell)}번칸 · {loc.lv}층
                    </p>
                  </div>
                  <button onClick={() => nav(`/rack-layout?code=${loc.rack}`)}
                    className="px-3 py-2 text-xs font-bold text-white whitespace-nowrap hover:bg-white/10"
                    style={{ border: '1px solid #7FBFAE' }}>
                    배치도 ↗
                  </button>
                </div>
              ) : (
                <div className="px-4 py-3" style={{ background: '#F0EFEA' }}>
                  <p className="text-sm font-bold" style={{ color: '#6B6B63' }}>보관 위치 미지정</p>
                  <p className="text-[11px] mt-0.5" style={{ color: '#8A8A82' }}>구매자재팀에 문의하세요</p>
                </div>
              )}

              {/* 품목 */}
              <div className="px-4 py-3.5">
                <p className="text-sm font-bold" style={{ fontFamily: MONO, color: '#0F5F4C' }}>
                  {h.std_code}
                </p>
                <p className="text-[15px] leading-snug mt-0.5" style={{ color: '#1A1A1A' }}>
                  {h.name}
                </p>

                <dl className="mt-2.5 space-y-0.5 text-[13px]">
                  {h.manufacturer && (
                    <div className="flex gap-2">
                      <dt className="w-14 flex-shrink-0" style={{ color: '#A5A39B' }}>제조사</dt>
                      <dd style={{ color: '#4A4A44' }}>{h.manufacturer}</dd>
                    </div>
                  )}
                  {h.manufacturer_code && (
                    <div className="flex gap-2">
                      <dt className="w-14 flex-shrink-0" style={{ color: '#A5A39B' }}>품번</dt>
                      <dd className="break-all" style={{ fontFamily: MONO, color: '#4A4A44' }}>
                        {h.manufacturer_code}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="w-14 flex-shrink-0" style={{ color: '#A5A39B' }}>재고</dt>
                    <dd className="font-bold" style={{ color: qty > 0 ? '#1A1A1A' : '#A5A39B' }}>
                      {n(qty)} {h.unit || 'EA'}
                      {qty === 0 && <span className="ml-1.5 font-normal text-[11px]">없음</span>}
                    </dd>
                  </div>
                </dl>

                <div className="flex gap-2 mt-3">
                  {[['img', '사진'], ['web', '사양']].map(([k, l]) => (
                    <a key={k} href={outLink(h, k)} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:bg-black/5"
                      style={{ border: '1px solid #D6D3CC', color: '#4A4A44' }}>
                      {l} 검색 ↗
                    </a>
                  ))}
                </div>
              </div>
            </article>
          )
        })}

        {done && !hits.length && (
          <div className="text-center py-14">
            <p className="text-base font-bold" style={{ color: '#4A4A44' }}>찾는 자재가 없습니다</p>
            <p className="text-xs mt-1.5" style={{ color: '#8A8A82' }}>
              품번 일부만 넣어도 찾을 수 있습니다
            </p>
          </div>
        )}

        {!q && (
          <div className="py-16 text-center">
            <p className="text-4xl sm:text-5xl mb-4 font-bold tracking-tight"
              style={{ fontFamily: MONO, color: '#E5E3DD' }}>
              A1-05-1
            </p>
            <p className="text-sm" style={{ color: '#8A8A82' }}>
              찾을 자재를 입력하면 보관 위치를 알려드립니다
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
