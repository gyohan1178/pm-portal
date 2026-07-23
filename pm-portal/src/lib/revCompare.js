import { supabase } from './supabase'
import { fetchAll } from './paginate'

// REV 알파벳 순서: 1글자 A~Z = 1~26, 2글자 AA~ZZ = 27~
// 스캐너(도면_적재.js)의 revRank 와 동일한 규칙이어야 한다.
export function revRank(rev) {
  const r = String(rev ?? '').trim().toUpperCase()
  if (!/^[A-Z]{1,2}$/.test(r)) return null
  return r.length === 1
    ? r.charCodeAt(0) - 64
    : (r.charCodeAt(0) - 64) * 26 + (r.charCodeAt(1) - 64) + 26
}

// 도면이 존재하는 품번대만 대조 (11 조립도 / 12 모듈 / 16 하네스 / 17 가공물)
// 볼트(44*)·부품(5*)까지 대조하면 "도면 없음"이 도배된다.
export const hasDrawingCode = (code) => {
  const d = String(code || '').replace(/^AX-/, '')
  return d.length >= 8 && ['11', '12', '16', '17'].includes(d.slice(0, 2))
}

// 품번 → 최신 도면 1건 맵
export async function fetchDrawingRevs(codes) {
  const list = [...new Set((codes || []).filter((c) => c && hasDrawingCode(c)))]
  const map = {}
  for (let i = 0; i < list.length; i += 200) {
    const rows = await fetchAll(() => supabase
      .from('pm_drawings')
      .select('std_code,rev,edition,rev_order,file_path,file_name,is_conv')
      .in('std_code', list.slice(i, i + 200))
      .is('missing_since', null)
      .eq('is_latest', true))
    for (const r of rows) {
      const cur = map[r.std_code]
      // 같은 REV면 현장이 쓰는 컨버팅 도면을 대표로
      if (!cur || r.rev_order > cur.rev_order || (r.rev_order === cur.rev_order && r.is_conv)) {
        map[r.std_code] = r
      }
    }
  }
  return map
}

export const REV_STATE = {
  match: { dot: '🟢', label: '일치',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ask:   { dot: '🟠', label: '도면 요청',   cls: 'bg-orange-50 text-orange-700 border-orange-300' },
  old:   { dot: '🟡', label: '구버전',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  none:  { dot: '🔴', label: '도면 없음',   cls: 'bg-rose-50 text-rose-600 border-rose-200' },
}

// 요구 REV vs NAS 최신 REV
//   같으면 일치 / 요구가 높으면 신도면 미수령(요청 필요) / 낮으면 구버전
//   비교 불가(REV 미부여 등)면 null → 배지 없음
export function compareRev(wantRev, drawing) {
  if (!drawing) return 'none'
  const a = revRank(wantRev)
  const b = revRank(drawing.rev)
  if (a === null || b === null) return null
  if (a === b) return 'match'
  return a > b ? 'ask' : 'old'
}
