import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// 창고 입구 검색대.
//
//   도서관 검색대처럼 품번을 넣으면 어디에 있는지 크게 보여준다.
//   서서 보는 화면이라 글자를 키우고, 결과는 위치 하나에 집중했다.
//   재고현황은 표가 촘촘해 이 용도에 맞지 않는다.
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
      const { data } = await supabase.from('items')
        .select('id,std_code,name,unit,manufacturer,manufacturer_code, inventory(qty,location)')
        .or(`std_code.ilike.%${t}%,name.ilike.%${t}%,manufacturer_code.ilike.%${t}%,manufacturer.ilike.%${t}%`)
        .limit(20)
      // 위치가 있는 것을 먼저 — 찾으러 온 사람에게 필요한 정보다
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

  // 외부 검색 — 제조사품번이 있으면 그것으로, 없으면 품명으로 찾는다.
  //   사진이나 사양을 확인해야 할 때 쓴다. 이미지를 직접 보관하지 않아
  //   용량 부담이 없고 항상 최신 정보를 본다.
  function outLink(h, kind) {
    const key = (h.manufacturer_code || '').trim()
      ? `${h.manufacturer || ''} ${h.manufacturer_code}`.trim()
      : (h.name || h.std_code)
    const q = encodeURIComponent(key)
    return kind === 'img'
      ? `https://www.google.com/search?tbm=isch&q=${q}`
      : `https://www.google.com/search?q=${q}`
  }

  // 위치를 랙·칸·층으로 나눈다
  function parseLoc(loc) {
    const m = String(loc || '').match(/^([A-Z]+\d*)-(\d+)-(\d+)$/i)
    if (!m) return null
    return { rack: m[1], cell: m[2], lv: m[3] }
  }

  return (
    <div className="min-h-[80vh]">
      {/* 검색창 — 크게 */}
      <div className="text-center py-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">🔍 자재 위치 찾기</h1>
        <p className="text-sm text-slate-400 mb-5">품번 · 품명 · 제조사품번 어느 것으로도 찾을 수 있습니다</p>

        <div className="relative max-w-2xl mx-auto">
          <input ref={inputRef} value={q} onChange={e => search(e.target.value)} autoFocus
            placeholder="검색어를 입력하세요 (2자 이상)"
            className="w-full px-6 py-5 text-xl border-4 border-slate-300 rounded-2xl
              focus:outline-none focus:border-indigo-500 text-center font-semibold" />
          {q && (
            <button onClick={reset}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full
                bg-slate-200 text-slate-500 text-xl hover:bg-slate-300">
              ✕
            </button>
          )}
        </div>
      </div>

      {busy && <p className="text-center text-lg text-slate-400 py-8">찾는 중…</p>}

      {done && !hits.length && (
        <div className="text-center py-16">
          <p className="text-5xl mb-3">🤔</p>
          <p className="text-lg font-bold text-slate-600">찾는 자재가 없습니다</p>
          <p className="text-sm text-slate-400 mt-1">품번 일부만 넣어도 찾을 수 있습니다</p>
        </div>
      )}

      {/* 결과 */}
      <div className="max-w-3xl mx-auto space-y-3 pb-8">
        {hits.map(h => {
          const inv = h.inventory?.[0]
          const loc = parseLoc(inv?.location)
          const qty = Number(inv?.qty) || 0
          return (
            <div key={h.id}
              className={`rounded-2xl border-2 p-5 ${loc ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-start gap-5 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-lg font-bold text-indigo-600">{h.std_code}</p>
                  <p className="text-base text-slate-700 leading-snug">{h.name}</p>
                  <p className="text-sm text-slate-400 mt-1">
                    {h.manufacturer}
                    {h.manufacturer && h.manufacturer_code ? ' · ' : ''}
                    <span className="font-mono">{h.manufacturer_code}</span>
                  </p>
                  <p className={`text-base font-bold mt-2 ${qty > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    재고 {n(qty)} {h.unit || 'EA'}
                  </p>
                  <div className="flex gap-1.5 mt-2.5">
                    <a href={outLink(h, 'img')} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300
                        text-slate-600 bg-white hover:bg-slate-50">
                      🖼 사진 검색
                    </a>
                    <a href={outLink(h, 'web')} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300
                        text-slate-600 bg-white hover:bg-slate-50">
                      🔎 사양 검색
                    </a>
                  </div>
                </div>

                {/* 위치 — 가장 크게 */}
                {loc ? (
                  <div className="text-center">
                    <div className="rounded-2xl border-4 border-indigo-500 bg-indigo-50 px-6 py-4">
                      <p className="font-mono text-3xl font-bold text-indigo-700 leading-none">
                        {inv.location}
                      </p>
                      <p className="text-xs text-indigo-500 mt-2 font-semibold">
                        {loc.rack}랙 · {Number(loc.cell)}번칸 · {loc.lv}층
                      </p>
                    </div>
                    <button onClick={() => nav(`/rack-layout?code=${loc.rack}`)}
                      className="mt-2 px-4 py-2 text-sm font-bold rounded-lg
                        border border-slate-300 text-slate-600 bg-white hover:bg-slate-50">
                      🗺 배치도에서 보기
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border-2 border-dashed border-slate-300 px-6 py-5 text-center">
                    <p className="text-base font-bold text-slate-400">위치 미지정</p>
                    <p className="text-xs text-slate-400 mt-1">담당자에게 문의하세요</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!q && (
        <div className="text-center py-10 text-slate-300">
          <p className="text-5xl mb-3">📦</p>
          <p className="text-base">찾을 자재를 입력하세요</p>
        </div>
      )}
    </div>
  )
}
