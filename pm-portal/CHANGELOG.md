# PM Portal - 변경 이력

## [v0.2.0] - 2026-05-08
### 추가
- Dashboard: Supabase 연동, 납기지연/D-7/고객사별 현황 실시간 계산
- 발주현황 (PurchaseOrders): 고객사별 PO 목록, 이카운트 CSV 미리보기
- 부족자재 (Shortage): PO잔량 × BOM - 재고 자동계산, 발주목록 엑셀 추출
- 입고 (Inbound): 고객사/발주건 선택 후 입고처리, 재고 자동 반영
- 출고 (Outbound): 고객사/프로젝트 선택, BOM 소요량 조회, 자재불출 출력, 일괄출고
- 견적입력 (Quote): 품목 검색, 신규품목 DB 등록, 견적 이력
- 이슈 (Issues): 사내/고객사/협력사 구분, 우선순위/상태 관리
- Todo: 일/주/월/분기 단위 구분, 담당자 지정
- BOM: 고객사별 BOM 조회, ERP CSV 업로드
- 기준코드 DB (Items): 조회/검색/엑셀 추출
- 협력사 (Vendors): 추가/조회
- 단가이력 (PriceHistory): 연도별 단가 비교, 변동률 표시
- ERP 연동 (ERPExport): PO/입출고/재고 엑셀 추출

## [v0.1.0] - 2026-05-08
### 초기 세팅
- 프로젝트 구조 생성 (React + Vite + Tailwind)
- Supabase 스키마 확정 (테이블 14개, 트리거 3개)
- 사이드바 레이아웃 구성
- 라우팅 구성
