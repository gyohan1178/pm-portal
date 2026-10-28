// 도움말 / 신규사원 셀프 온보딩 페이지
// 전체 업무 플로우 + 시작 가이드 + 메뉴별 설명

// v4.106.0 — 지금 메뉴 이름 · 순서와 맞춤 (수주대장 · 매출견적 · 할 일 · 자료 요청 · 업무 흐름 · 품질 · 현장 화면 추가)
//   메뉴를 바꾸면 여기도 같이 고친다 (components/layout/Sidebar.jsx 의 메뉴와 같은 이름)
const FLOW = [
  { sys:'포털',     title:'고객사 PO 접수', desc:'수주대장 — 발주서 PDF 올리기(두웰 · 남일 같은 기타 업체 발주서도 읽음 · 스캔본은 직접 등록) · AXCELIS PO 엑셀 반영 · 직접 등록(동원파츠 · 동신 같은 업체는 고객사 「기타」 + 업체 이름). 같은 PO 를 다시 올리면 바뀐 것만 반영. 발주서의 적요 · 참고 사항은 「📝 특이사항 메모」로' },
  { sys:'포털',     title:'구매자재 확인 · 회신', desc:'수주대장에서 품번마다 가능 · 조건부 · 불가와 자재 준비일을 회신 → 영업 화면에 보임' },
  { sys:'포털',     title:'부족자재 산출', desc:'고객사 PO × BOM 소요 − (재고 + 입고예정). 포캐스트로 미리 보는 소요예측도 있음' },
  { sys:'포털',     title:'구매발주',    desc:'부족분을 체크해 발주 → 이카운트 발주서 양식 · 품의서로 내려받기' },
  { sys:'이카운트', title:'발주서 입력', desc:'내려받은 발주를 이카운트에 올리기' },
  { sys:'포털',     title:'입고',        desc:'들어온 물건을 발주에 맞춰 입고 → 재고 · 입고 현황에 바로 반영' },
  { sys:'포털',     title:'출고 · 불출',  desc:'ASSY 출고(BOM 단위) · 다품목 출고 · 자재 요청 불출. 못 준 부품은 결품 현황 · 미불출로 따라감' },
  { sys:'포털',     title:'납품 표시',    desc:'수주대장에서 납품한 품번을 「납품 표시」 — 구매자재 · 영업 누구나 (체크 → 「✓ 납품 표시」 또는 PO 상세의 납품 칸)' },
  { sys:'이카운트', title:'판매입력 · 대조', desc:'수주대장 › 이카운트 대조 탭 — 판매입력 파일 만들기 · 판매 자료 올려 맞추기' },
]

// 로트 관리 대상 품목의 별도 흐름
const LOT_FLOW = [
  { title:'입고 시 등록', desc:'박스 시리얼과 수량을 기록 — 제조 시기가 자동으로 채워집니다' },
  { title:'보증 만료일 계산', desc:'입고일(거래명세서 작성일) 기준으로 자동 산출' },
  { title:'불출 시 안내', desc:'오래된 로트부터 표시 — 화면과 불출표 인쇄물 모두' },
]

const START_STEPS = [
  '회원가입 신청 후 관리자 승인을 받으면 포털을 이용할 수 있다. (권한: 관리자 / 편집 / 조회 · 부서에 따라 보이는 메뉴와 수주대장 화면이 다르다)',
  '🧭 업무 흐름에서 부서마다 어떤 일이 어디에 쌓였는지 먼저 본다.',
  '📋 할 일에서 내 일을 확인한다 — 다른 사람이 맡긴 일은 「새로 받음」으로 뜬다.',
  '기준코드 DB를 익힌다 — JS 대표코드와 고객사 품번(AX- · ED- …)의 관계를 이해.',
  '📨 수주대장에서 고객사 PO 가 어떻게 들어오고 회신되는지 본다.',
  '부족자재 → 구매발주 → 입고 → 출고 순서로 자재가 도는 흐름을 따라가 본다.',
  '현장에서 자재가 필요하면 🙋 자재 요청, 고객사 자료(도면 · BOM · 사양서)가 필요하면 📎 자료 요청 — 권한과 무관하게 누구나 쓸 수 있다.',
  '처음 여는 화면에 뜨는 안내를 끝까지 보고, 나중에 다시 보려면 화면 위 「💡 안내」를 누른다.',
]

// 화면 공통 사용법 (v4.104.0 ~)
const TIPS = [
  { t:'ⓘ', d:'지표 숫자 옆 ⓘ 를 누르면 무엇을 세는지(기준 · 기간)가 나옵니다. 숫자가 이상해 보이면 먼저 눌러 보세요.' },
  { t:'되돌리기', d:'회신 · 납품 표시 · 할 일 완료처럼 바로 저장되는 일은 아래 검은 바에서 6초 안에 「되돌리기」를 누를 수 있습니다. 입고 · 출고처럼 재고가 움직이는 일은 저장 전에 묻습니다.' },
  { t:'확인 창', d:'지우기 · 불출 · 반려처럼 되돌리기 어려운 일은 무엇이 바뀌는지 줄 목록을 보여 주고 묻습니다. 창 바깥을 누르거나 Esc 를 누르면 「아니오」입니다.' },
  { t:'빠진 칸', d:'꼭 넣어야 하는 칸이 비었으면 저장하지 않고 그 칸 아래에 빨간 글씨로 알려 줍니다.' },
  { t:'메뉴 숫자', d:'메뉴 옆 빨간 숫자는 처리할 일 수입니다 — 할 일 · 자재 요청 · 자료 요청, 구매자재는 수주대장 미확인 PO · 구매발주 납기 지연도.' },
]

const MENU_GUIDE = [
  { group:'맨 위', items:[
    { name:'업무 흐름', desc:'부서마다 한 줄로, 일이 어디에 몇 건 쌓였는지 · 부서를 건너가는 일을 화살표로 봅니다' },
    { name:'관제탑 (홈)', desc:'품번 단위 자재 위험 — 입고 지연 · 발주 필요 · 재고 음수 등 무엇부터 처리할지' },
    { name:'할 일', desc:'내 일이 급한 순서로 · 사람을 누르면 그 사람 일만. 주간회의 안건 표시' },
    { name:'파일 올리기', desc:'어느 화면에 올릴지 몰라도 파일을 놓으면 종류를 판별해 안내' },
  ]},
  { group:'📦 자재', items:[
    { name:'통합 검색', desc:'전 고객사 품목 · BOM 통합 조회 — 기준코드로 고객사 품번 · 사용처를 함께 확인' },
    { name:'재고현황', desc:'품목별 현재고 · 위치 · 안전재고. 숫자가 틀리면 실사(붙여넣기 · QR 칸 실사 · 엑셀 업로드)로 바로잡음' },
    { name:'ASSY 출고', desc:'고객사 · 프로젝트를 고르면 BOM 단위로 필요한 부품을 한 번에 출고' },
    { name:'다품목 출고', desc:'여러 품목을 담아 한 번에 출고 · ASSY 는 하위로 전개' },
    { name:'출고 현황', desc:'ASSY 출고 · 다품목 출고 · 자재요청 불출 · 실사 조정 — 어디로, 누가 뺐는지' },
    { name:'창고 배치도', desc:'랙 배치와 보관 위치. 배치도 · 랙 안내판 인쇄' },
  ]},
  { group:'🛒 구매', items:[
    { name:'구매발주', desc:'발주 등록부터 입고까지 진행 상태 · 납기 지남 / 7일 안 임박 · 납기 이월 · 발주번호 · 이카운트 발주서' },
    { name:'입고', desc:'들어온 물건을 발주에 맞춰 입고. 선택 건 금액 합계로 명세표와 대조' },
    { name:'품목 단가 등록', desc:'협력사 견적 단가 등록 — 한 품목씩 또는 견적서 표 붙여넣기. 단가변동이력에 쌓임' },
    { name:'결제 계획', desc:'발주는 한 번, 결제는 나눠 하는 건 기록' },
    { name:'부족자재', desc:'고객사 PO 에 BOM 을 전개해 모자라는 부품을 찾고 바로 구매발주' },
    { name:'결품 현황', desc:'불출 못 한 부품 모아 보기 (전 고객사 · 완료 호기 제외)' },
  ]},
  { group:'🤝 영업', items:[
    { name:'수주대장', desc:'고객사 PO 를 PDF · AX 엑셀로 접수 → 구매자재 확인 · 회신 → 납품 표시. 영업은 체크해서 바로 자재 요청 · 나간 품목은 납품 표시. 이카운트 대조 · 코드 · BOM 정리 탭' },
    { name:'고객사 PO', desc:'고객사에서 받은 PO 줄을 납기 · REV · 도면과 같이 보기' },
    { name:'하네스 출도 · 불출', desc:'불출 안 한 하네스 PO 를 하네스 공정관리로 넘기고(작업지시서 · 도면 출력) 현장에 넘긴 것 표시' },
    { name:'매출견적', desc:'견적 요청 접수 → BOM · 단가 점검(없으면 구매자재에 단가 요청) → 견적서 작성 · 제출 · 수주/실주' },
    { name:'포캐스트', desc:'고객사 수요 예측 — 품번별 월 수량 · 직전 접수 대비 변화. LT 긴 자재를 PO 전에 준비' },
  ]},
  { group:'🙋 공통 요청', items:[
    { name:'자재 요청', desc:'현장에서 필요한 자재를 요청 — 누구나. 처리(확인 · 불출 · 발주 · 반려)는 구매자재 · 하네스팀. 미등록 품목은 품명만 적어도 됨' },
    { name:'자료 요청', desc:'도면 · BOM · 사양서 · CN 내역 등 고객사 자료를 영업에 요청. 모든 부서의 요청이 다 보여, 같은 자료를 이미 요청한 부서가 있으면 「같이 기다리기」' },
  ]},
  { group:'🏭 현장', items:[
    { name:'현장 검색', desc:'현장용 품목 정보 · 사용처 · BOM 조회 (큰 글씨)' },
    { name:'도면 조회', desc:'NAS 도면의 최신 REV 조회 — 파일은 읽기만' },
    { name:'생산 대시보드', desc:'전 고객사 호기 현황 — 납기 · 자재불출 중심' },
    { name:'생산 관리', desc:'호기별 가공물 입고 · 하네스 · 전장 진행과 미불출 파트. 고객사 PO 와 연동' },
    { name:'생산관리 대상', desc:'고객사마다 생산관리에서 운영할 품번 그룹 · 수주대장 PO 와 호기 연결 확인' },
    { name:'생산 전광판', desc:'현장 TV 용 공정 흐름 화면 (5분마다 자동 갱신)' },
  ]},
  { group:'🔬 품질', items:[
    { name:'초도품 진행관리', desc:'초도품 PO 접수 → 자재 → 제작 → 품질 인계 · 성적서 → 제출 · 승인 단계별 예정일 · 실적일' },
    { name:'초도품 자재 매칭', desc:'Axcelis Part Report 의 등록 제조사와 실제 구매한 제조사를 맞춰 판정' },
    { name:'설계변경(CN) 이력', desc:'CN Summary 를 올리면 리비전 · BOM 추가/변경/삭제 · 신규/단종 품번을 뽑아 저장' },
    { name:'도면 배포이력', desc:'외주 가공처 · 협력사에 도면을 보낼 때마다 한 줄 기록 (작성자 자동)' },
    { name:'로트 관리', desc:'시리얼 · 보증기간이 있는 품목 — 오래된 것부터 내보내기' },
  ]},
  { group:'📊 분석', items:[
    { name:'주간업무보고', desc:'구매자재 주간 보고 — 입고 · 불출 · 납기 지연 · 자재요청 대응' },
    { name:'매입 · 매출 대시보드', desc:'매입 = 이카운트 확정 + 결제 계획 / 매출 = 고객사 PO 납기월 기준 (CCN B 는 달러 × 환율)' },
    { name:'원가절감 실적 · 원가분석', desc:'입고 단가를 표준단가와 견준 절감액 / 상위 품번별 원자재 원가 · 권장 매출가' },
    { name:'자재요청 업무량 · 납품 일정 변경', desc:'요청 처리에 드는 손 / 전주 월요일 대비 납기가 바뀐 건' },
    { name:'What-if · 인사이트', desc:'입고 지연 · 수요 증감을 바꿔 미리 실험(실데이터 안 바뀜) / 단가 이상 · 공급처 평가 · 적시 납품률 (관리자)' },
  ]},
  { group:'⚙️ 기초자료 · 기타', items:[
    { name:'기준코드 DB', desc:'모든 품목의 기준코드(JS-) · 품명 · 제조사 · 구매처. 17* 처럼 입력하면 17로 시작하는 품번만' },
    { name:'BOM', desc:'고객사 어셈블리별 하위 부품. CSV · AXCELIS 리포트로 올리면 하위 ASSY BOM 도 같이' },
    { name:'협력사', desc:'구매처 · 가공 협력사 연락처 · 결제조건 · 해외 여부' },
    { name:'기준코드 매핑', desc:'이카운트 품목관계리스트로 기준코드 ↔ 고객사코드 매핑 갱신' },
    { name:'단가변동이력', desc:'품목별 견적 · 구매 단가가 언제 얼마로 바뀌었는지' },
    { name:'ERP 연동', desc:'포털 데이터를 이카운트 업로드용 엑셀로 추출' },
    { name:'활동 이력 · 용량 / 데이터 백업', desc:'누가 무엇을 바꿨는지 · DB 용량 / 포털 표 전부를 엑셀 · JSON 으로 내려받기 — 주 1회 권장 (관리자)' },
  ]},
]

function SysBadge({ sys }) {
  const isErp = sys === '이카운트'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0
      ${isErp ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'}`}>{sys}</span>
  )
}

export default function Help() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold text-slate-900">도움말 · 업무 안내</h1>
        <p className="page-desc text-xs text-slate-400 mt-1">신규 입사자를 위한 셀프 가이드 — 이 포털이 어떤 흐름으로 돌아가는지 정리했습니다.</p>
      </div>

      {/* 시작 가이드 */}
      <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
        <p className="text-sm font-bold text-indigo-700 mb-3">처음이라면 이 순서로</p>
        <ol className="space-y-2">
          {START_STEPS.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-xs text-slate-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[10px]">{i+1}</span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* 화면 공통 사용법 (v4.104.0) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4" data-help-tips>
        <p className="text-sm font-bold text-slate-800 mb-2">화면 공통 사용법</p>
        <div className="space-y-1.5">
          {TIPS.map((x) => (
            <div key={x.t} className="flex items-start gap-3 text-xs">
              <span className="w-16 flex-shrink-0 font-bold text-violet-700">{x.t}</span>
              <span className="text-slate-600 leading-relaxed">{x.d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 전체 업무 플로우 */}
      <section>
        <p className="text-sm font-bold text-slate-800 mb-1">전체 업무 플로우</p>
        <p className="text-xs text-slate-400 mb-3">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"/>이카운트</span>
          <span className="mx-2 inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500"/>포털</span>
          사이를 도는 닫힌 루프입니다.
        </p>
        <div className="space-y-1">
          {FLOW.map((f, i) => (
            <div key={i}>
              <div className={`rounded-xl border p-3 flex items-center gap-3
                ${f.sys==='이카운트' ? 'border-blue-200 bg-blue-50/40' : 'border-indigo-200 bg-indigo-50/30'}`}>
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-500 font-bold flex items-center justify-center text-[11px]">{i+1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">{f.title}</span>
                    <SysBadge sys={f.sys} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{f.desc}</p>
                </div>
              </div>
              {i < FLOW.length-1 && <div className="text-center text-slate-300 text-xs leading-none py-0.5">↓</div>}
            </div>
          ))}
          <div className="text-center text-xs text-slate-400 pt-1">↻ 판매입력까지 끝나면 다음 수주로 순환</div>
        </div>
      </section>

      {/* 로트 관리 — 대상 품목만 따로 도는 흐름 */}
      <section className="rounded-xl border border-teal-200 bg-teal-50/30 p-4">
        <p className="text-sm font-bold text-teal-800 mb-1">🏷 로트 관리 대상 품목</p>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          시리얼과 보증기간을 확인해야 하는 품목(BECKHOFF·ROOTECH·SCHISCHEK·KEYENCE)은
          위 흐름에 더해 아래를 함께 합니다. 오래된 재고가 투입되어 버전 호환 문제가 생긴 적이 있어 도입했습니다.
        </p>
        <div className="space-y-1.5">
          {LOT_FLOW.map((f, i) => (
            <div key={i} className="rounded-lg border border-teal-100 bg-white p-2.5 flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center text-[10px]">{i+1}</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">{f.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 메뉴별 설명 */}
      <section>
        <p className="text-sm font-bold text-slate-800 mb-3">메뉴별 설명</p>
        <div className="space-y-4">
          {MENU_GUIDE.map(g => (
            <div key={g.group}>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{g.group}</p>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {g.items.map(it => (
                  <div key={it.name} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-xs font-bold text-slate-700 w-40 flex-shrink-0">{it.name}</span>
                    <span className="text-xs text-slate-500 flex-1 leading-relaxed">{it.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-[11px] text-slate-300 pt-2">모르는 부분이 있으면 각 페이지를 직접 눌러보며 익히세요. 데이터는 이카운트에서 내려받아 올리고, 포털에서 만든 자료는 이카운트 양식으로 내보냅니다.</p>
    </div>
  )
}
