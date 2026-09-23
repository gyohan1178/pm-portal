// 예전 업데이트 이력 — 「이전 기록 더 보기」를 누를 때만 따로 받는다
export const loadChangelogOld = () => import('./changelogArchive').then(m => m.CHANGELOG_OLD)
