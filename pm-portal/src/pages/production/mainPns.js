// 주요 관리대상 PD BOX 품번 (2026-07-02 기준 16개)
// — 여기 있는 품번만: 가공물·하네스·전장 일정 체크 + 하네스 우선순위 대상
// — 나머지(sub assy)는 진행상태만 표시
// 품번 추가/제거는 이 목록만 고치면 전체 반영됨
export const MAIN_PNS = new Set([
  '110116240', // ASSY PWR DISTRIBUTION HEB PD
  '110132770', // Assembly Remote PD Standard LTI 208/480VAC
  '110134250', // ASSY LINAC PD
  '110140450', // ASSY CONTROLLER THREE-AXIS MANIPULATOR
  '110147240', // Assembly Remote PD Standard 208/480VAC
  '110153030', // ASSY MAIN PD
  '110158840', // ASSY EFEM PD
  '110167070', // Assembly End Station PD CVCF
  '110171800', // ASSY TERM PD 480VAC
  '110171970', // ASSY TERM PD 208VAC
  '110172280', // ASSY MAIN PD ELCB
  '110173200', // ASSY RM PD
  '110211211', // ASSY RMT PD PWR VACC 208/480VAC RT LOAD
  '110214084', // ASSY PWR DISTR LEB PD
  '110215107', // ASSY PD CONT REAR CORNER
  '110226948', // ASSY END STATION PD
])
export const isMainPn = (pn) => MAIN_PNS.has(String(pn || '').trim())
