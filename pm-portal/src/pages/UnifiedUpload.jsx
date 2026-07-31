import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'

// 업로드 창구를 하나로.
//
//   지금까지는 주간보고·ecount·PO·BOM·포캐스트를 각각 다른 화면에서 올려야 했다.
//   실무자는 "이 파일을 어디에 올리지?" 를 매번 생각해야 한다.
//
//   여기서는 파일을 던지면 내용을 보고 종류를 판별해 해당 화면으로 보낸다.
//   판별 근거를 함께 보여주므로, 틀렸을 때 사람이 바로잡을 수 있다.

// 판별 규칙 — 파일명과 시트 헤더를 함께 본다.
// 헤더가 결정적이므로 파일명만으로 단정하지 않는다.
const RULES = [
  {
    id: 'ecount', name: '확정매입 (ecount)', icon: '💳', to: '/weekly',
    hint: '주간업무보고 → 확정매입 탭',
    fileHints: ['ecount', '이카운트', '구매', '매입'],
    headers: [['구매번호', '거래처', '품목'], ['일자', '거래처명', '공급가액']],
  },
  {
    id: 'weekly', name: '주간업무보고', icon: '📄', to: '/weekly',
    hint: '주간업무보고 → 담당자 엑셀',
    fileHints: ['주간', '업무보고', '입고', '진행'],
    headers: [['입고요청일자', '품번'], ['P/N', '입고일자'], ['발주일', '입고예정']],
  },
  {
    id: 'customer_po', name: '고객사 PO', icon: '📑', to: '/customer/AX/po-upload',
    hint: '고객사 PO 업로드',
    fileHints: ['po', 'order', '발주서', '수주'],
    headers: [['PO Number', 'Item'], ['PO NO', 'Part'], ['CCN', 'Promise Date']],
  },
  {
    id: 'forecast', name: '포캐스트', icon: '📈', to: '/customer/AX/forecast',
    hint: '포캐스트 업로드',
    fileHints: ['forecast', '포캐스트', '예측', 'fcst'],
    headers: [['Part Number', 'Month'], ['품번', '수량', '년월']],
  },
  {
    id: 'sales', name: '매출 자료', icon: '💼', to: '/customer/AX/sales-upload',
    hint: '매출 업로드',
    fileHints: ['매출', 'sales', '출하'],
    headers: [['출하일', '금액'], ['매출일자', '공급가']],
  },
  {
    id: 'codemap', name: '기준코드 매핑', icon: '🔢', to: '/master/codemap',
    hint: '기준코드 매핑 업로드',
    fileHints: ['품목관계', '코드', '매핑', '품목등록'],
    headers: [['품목코드', '관계품목'], ['자품목', '모품목']],
  },
  {
    id: 'bom', name: 'BOM 리포트', icon: '🧬', to: '/customer/AX/bom',
    hint: 'BOM 업로드 (HTM 파일)',
    fileHints: ['bom', 'report', '리포트'],
    ext: ['htm', 'html'],
  },
]

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-()]/g, '')

export default function UnifiedUpload() {
  const nav = useNavigate()
  const [items, setItems] = useState([])   // 판별 결과
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  // 파일 하나를 살펴 종류를 판별한다.
  async function inspect(file) {
    const fname = norm(file.name)
    const ext = file.name.split('.').pop().toLowerCase()
    const scores = {}
    let headers = []

    // 파일명 단서
    RULES.forEach(r => {
      let s = 0
      ;(r.fileHints || []).forEach(h => { if (fname.includes(norm(h))) s += 2 })
      if (r.ext && r.ext.includes(ext)) s += 3
      scores[r.id] = s
    })

    // 엑셀이면 헤더까지 확인 — 이쪽이 파일명보다 확실하다
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      try {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { sheetRows: 12 })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        // 앞쪽 행 중 가장 많은 값이 채워진 줄을 헤더로 본다
        let best = [], bestN = 0
        rows.slice(0, 10).forEach(r => {
          const n = r.filter(c => String(c).trim()).length
          if (n > bestN) { bestN = n; best = r }
        })
        headers = best.map(c => String(c).trim()).filter(Boolean)
        const hset = new Set(headers.map(norm))

        RULES.forEach(r => {
          ;(r.headers || []).forEach(set => {
            const hit = set.filter(h => [...hset].some(x => x.includes(norm(h)))).length
            if (hit === set.length) scores[r.id] += 6      // 전부 일치
            else if (hit > 0) scores[r.id] += hit * 2
          })
        })
      } catch { /* 못 읽으면 파일명 단서만 쓴다 */ }
    }

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const [topId, topScore] = ranked[0]
    const rule = RULES.find(r => r.id === topId)

    return {
      file, name: file.name, size: file.size, ext, headers,
      rule: topScore > 0 ? rule : null,
      score: topScore,
      confident: topScore >= 6,
      alt: ranked.slice(1, 3).filter(([, s]) => s > 0).map(([id]) => RULES.find(r => r.id === id)),
    }
  }

  const handleFiles = useCallback(async (files) => {
    setBusy(true)
    const out = []
    for (const f of files) out.push(await inspect(f))
    setItems(prev => [...prev, ...out])
    setBusy(false)
  }, [])

  const onDrop = (e) => {
    e.preventDefault(); setOver(false)
    handleFiles([...e.dataTransfer.files])
  }

  const setRule = (i, rule) => setItems(v => v.map((x, k) => k === i ? { ...x, rule, confident: true } : x))
  const remove = (i) => setItems(v => v.filter((_, k) => k !== i))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">📥 파일 올리기</h1>
        <p className="text-xs text-slate-400">
          어느 화면에 올려야 할지 고르지 않아도 됩니다. 파일을 놓으면 종류를 판별해 안내합니다.
        </p>
      </div>

      {/* 놓는 곳 */}
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
          over ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}>
        <p className="text-4xl mb-2">📂</p>
        <p className="text-sm font-bold text-slate-700">파일을 여기에 놓으세요</p>
        <p className="text-xs text-slate-400 mt-1">
          주간보고 · 확정매입 · 고객사 PO · 포캐스트 · 매출 · BOM · 기준코드 — 여러 개 한 번에 가능
        </p>
        <input ref={inputRef} type="file" multiple className="hidden"
          accept=".xlsx,.xls,.csv,.htm,.html"
          onChange={e => { handleFiles([...e.target.files]); e.target.value = '' }} />
      </div>

      {busy && <p className="text-center text-sm text-slate-400 py-2">확인 중…</p>}

      {/* 판별 결과 */}
      {items.map((it, i) => (
        <div key={i} className={`bg-white rounded-xl border p-4 ${
          it.confident ? 'border-emerald-200' : it.rule ? 'border-amber-300' : 'border-rose-300'}`}>
          <div className="flex items-start gap-3">
            <span className="text-2xl">{it.rule?.icon || '❓'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{it.name}</p>
              <p className="text-[11px] text-slate-400">
                {(it.size / 1024).toFixed(0)} KB · {it.ext.toUpperCase()}
                {it.headers.length > 0 && ` · 열 ${it.headers.length}개`}
              </p>

              {it.rule ? (
                <div className="mt-2">
                  <p className="text-sm">
                    <span className={`font-bold ${it.confident ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {it.rule.name}
                    </span>
                    <span className="text-slate-400 text-xs"> 으로 판별{it.confident ? '' : ' (확실하지 않음)'}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">{it.rule.hint}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-rose-600 font-semibold">종류를 알 수 없습니다</p>
              )}

              {/* 판별 근거 */}
              {it.headers.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-slate-400 cursor-pointer">판별 근거 — 읽어낸 열</summary>
                  <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                    {it.headers.slice(0, 15).join(' · ')}
                    {it.headers.length > 15 && ` 외 ${it.headers.length - 15}개`}
                  </p>
                </details>
              )}

              {/* 다른 후보 · 직접 지정 */}
              {(!it.confident || it.alt.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400">
                    {it.rule ? '아니라면' : '직접 지정'}
                  </span>
                  {(it.alt.length ? it.alt : RULES.filter(r => r.id !== it.rule?.id)).slice(0, 4).map(r => (
                    <button key={r.id} onClick={() => setRule(i, r)}
                      className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600">
                      {r.icon} {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              {it.rule && (
                <button onClick={() => nav(it.rule.to)}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap">
                  화면 열기
                </button>
              )}
              <button onClick={() => remove(i)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600">
                제외
              </button>
            </div>
          </div>
        </div>
      ))}

      {items.length > 0 && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
          <p className="text-xs text-slate-500">
            판별된 화면에서 실제 업로드를 진행합니다. 파일 형식·중복 검사는 각 화면에서 이루어집니다.
          </p>
        </div>
      )}
    </div>
  )
}
