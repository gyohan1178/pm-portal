import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CUSTOMERS } from '../lib/customers'

// Ctrl+D (또는 Ctrl+K) 빠른 실행창 — 어디서든 열어서 검색 후 이동. 분산된 메뉴 동선을 하나로.
// D 를 기본으로 둔 이유: 마우스를 쥔 채 왼손만으로 누를 수 있다.
function buildCommands() {
  const cmds = []
  const push = (group, label, to, keywords = '') => cmds.push({ group, label, to, keywords })

  // 일일 업무
  push('일일 업무', '입고', '/inbound', 'inbound ipgo')
  push('일일 업무', 'ASSY 출고', '/outbound', 'outbound chulgo assy')
  push('일일 업무', '다품목 출고', '/issue', 'issue bulchul dapummok 출고 작업 불출')
  push('일일 업무', '출고 현황', '/outbound-history', 'outbound history chulgo hyeonhwang 이력')
  push('일일 업무', '재고현황', '/inventory', 'inventory jaego stock')
  push('일일 업무', '통합 검색', '/search', 'search tonghap')
  push('일일 업무', '자재 요청', '/material-request', 'material request jajae yocheong')
  push('일일 업무', '자료 요청 (도면 · BOM → 영업)', '/doc-request', 'doc request jaryo yocheong drawing bom')
  push('일일 업무', '할 일', '/todo', 'todo hal il')
  push('일일 업무', '업무 흐름', '/flow', 'flow eommu heureum 부서')
  push('일일 업무', '파일 올리기', '/upload', 'upload file olligi 업로드')
  push('일일 업무', '현장 검색', '/field-search', 'field search hyeonjang')
  push('일일 업무', '창고 배치도', '/rack-layout', 'rack layout changgo baechido')
  // 소요·부족
  push('소요·부족', '소요예측 (포캐스트)', '/forecast-shortage', 'forecast shortage soyo 포캐스트')
  push('소요·부족', '결품 현황', '/missing', 'missing gyeolpum')
  // 고객사별
  CUSTOMERS.forEach(c => {
    push(c.name, `${c.name} · 구매발주`, `/customer/${c.id}/purchase`, `purchase balju ${c.id}`)
    push(c.name, `${c.name} · 소요량 조회`, `/customer/${c.id}/reqbom`, `reqbom soyoryang ${c.id}`)
    push(c.name, `${c.name} · 부족자재 (PO 확정)`, `/customer/${c.id}/short`, `shortage bujok po ${c.id}`)
    push(c.name, `${c.name} · 고객사 PO`, `/customer/${c.id}/cpo`, `cpo ${c.id}`)
    push(c.name, `${c.name} · BOM`, `/customer/${c.id}/bom`, `bom ${c.id}`)
    push(c.name, `${c.name} · 포캐스트`, `/customer/${c.id}/forecast`, `forecast ${c.id}`)
  })
  // 기초자료
  push('기초자료', '기준코드 DB', '/master/items', 'items gijun')
  push('기초자료', '협력사', '/master/vendors', 'vendors hyeopryeoksa')
  push('기초자료', '단가변동이력', '/master/price', 'price danga')
  push('기초자료', '품목 단가 등록', '/quote', 'quote gyeonjeok danga 견적입력')
  push('기초자료', '매출견적', '/sales-quote', 'sales quote maechul gyeonjeok')
  push('영업', '수주대장', '/orders', 'orders suju po balju')
  push('기초자료', '결제 계획', '/payment-plan', 'payment plan gyeolje')
  push('기초자료', 'ERP 연동', '/erp', 'erp')
  push('기초자료', '기준코드 매핑', '/master/codemap', 'codemap maeping 품목관계')
  // 주간 / 분석
  push('주간 / 분석', '주간업무보고', '/weekly', 'weekly jugan')
  push('주간 / 분석', '매출 대시보드', '/sales', 'sales maechul')
  push('주간 / 분석', '매입 대시보드', '/purchase-dashboard', 'purchase dashboard maeip 매입 현황')
  push('주간 / 분석', 'What-if 시뮬레이터', '/what-if', 'whatif')
  push('주간 / 분석', '원가분석', '/cost', 'cost wonga bunseok')
  push('주간 / 분석', '원가절감 실적', '/cost-saving', 'cost saving jeolgam')
  push('주간 / 분석', '자재요청 업무량', '/request-load', 'request load eommuryang')
  push('주간 / 분석', '납품 일정 변경', '/schedule-changes', 'schedule changes napgi ilJeong')
  push('주간 / 분석', '인사이트 (관리자)', '/insights', 'insights')
  // 생산
  push('생산', '생산 대시보드', '/production', 'production saengsan')
  push('생산', '생산 전광판', '/board', 'board jeongwangpan display')
  push('생산', '생산 관리', '/production/AX', 'production gwanri pdbox')
  push('생산', '도면 조회', '/drawings', 'drawing domyeon')
  push('생산', '하네스 출도 · 불출', '/production/harness-release', 'harness chuldo bulchul')
  push('생산', '생산관리 대상', '/production/targets', 'production targets daesang 품번 그룹')
  // 품질
  push('품질', '초도품 진행관리', '/quality/fa-progress', 'fa first article chodopum')
  push('품질', '초도품 자재 매칭', '/quality/fai', 'fai matching')
  push('품질', '설계변경(CN) 이력', '/quality/cn', 'cn ecn seolgye byeongyeong')
  push('품질', '도면 배포이력', '/quality/drawing-dist', 'drawing dist baepo')
  push('품질', '로트 관리', '/quality/lot', 'lot')
  // 전체
  push('전체', '관제탑 (홈)', '/', 'dashboard home control tower gwanjetop')
  push('전체', '도움말 · 업무 안내', '/help', 'help doummal 안내 신규')
  return cmds
}

const COMMANDS = buildCommands()

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    function onKey(e) {
      // 왼손만으로 열 수 있게 Ctrl+D 를 주 단축키로 둔다. Ctrl+K 도 계속 동작.
      //   D 는 브라우저 북마크 단축키지만 preventDefault 로 막힌다.
      //   (W·T·R 은 탭 닫기·새 탭·새로고침이라 가로챌 수 없어 피했다)
      const mod = e.metaKey || e.ctrlKey
      const k = (e.key || '').toLowerCase()
      if (mod && (k === 'd' || k === 'k')) {
        e.preventDefault(); setOpen(o => !o); setQ(''); setHi(0)
      } else if (e.key === 'Escape') { setOpen(false) }
    }
    function onOpen() { setOpen(true); setQ(''); setHi(0) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-command-palette', onOpen) }
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return COMMANDS
    return COMMANDS.filter(c => (c.label + ' ' + c.group + ' ' + c.keywords).toLowerCase().includes(s))
  }, [q])

  useEffect(() => { setHi(0) }, [q])

  if (!open) return null

  function go(cmd) { if (!cmd) return; nav(cmd.to); setOpen(false) }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, filtered.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); go(filtered[hi]) }
          }}
          placeholder="어디로 갈까요? (예: 발주, 입고, AX 소요량)"
          className="w-full px-4 py-3.5 text-sm border-b border-slate-100 focus:outline-none"/>
        <div className="max-h-[52vh] overflow-y-auto py-1">
          {filtered.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-400">결과 없음</div>}
          {filtered.map((c, i) => (
            <button key={c.to + c.label} type="button"
              onMouseEnter={() => setHi(i)} onClick={() => go(c)}
              className={`w-full text-left px-4 py-2 flex items-center gap-2 text-sm ${i === hi ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
              <span className="text-[10px] font-bold text-slate-400 w-24 shrink-0 truncate">{c.group}</span>
              <span className="font-semibold text-slate-700 flex-1 truncate">{c.label}</span>
              {i === hi && <span className="text-[10px] text-indigo-400">Enter ↵</span>}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 flex gap-3">
          <span>↑↓ 이동</span><span>Enter 이동</span><span>Esc 닫기</span><span className="ml-auto">Ctrl + D <span className="text-slate-300">또는 K</span></span>
        </div>
      </div>
    </div>
  )
}
