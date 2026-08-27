// 창고 배치도에서 그 랙이 어디인지 별표로 짚어 준다.
//
//   위치가 'W7-05-3' 처럼 글자로만 나와
//   창고에 서서 W7 이 어디인지부터 찾아야 했다.
//
//   배치도 화면(RackLayout)은 끌어 옮기고 인쇄까지 하는 큰 화면이라
//   여기서는 보여 주기만 하는 작은 것을 따로 그린다.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const GW = 80, GH = 62      // 배치도 격자 크기 (RackLayout 과 같아야 한다)

export function useRackMap() {
  return useQuery({
    queryKey: ['rackMiniMap'],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      // 배치도 화면(RackLayout)이 쓰는 것과 같은 자료
      const [{ data: racks }, { data: objs }] = await Promise.all([
        supabase.rpc('pm_rack_usage'),
        supabase.from('pm_floor_object').select('*').order('id'),
      ])
      return { racks: racks || [], objs: objs || [] }
    },
    retry: 1,
  })
}

/**
 * @param code   짚어 줄 랙 코드 ('W7')
 * @param racks  pm_rack 목록
 * @param objs   기둥·통로 등 (없어도 된다)
 * @param width  그릴 너비(px)
 */
export default function RackMiniMap({ code, racks = [], objs = [], width = 380 }) {
  if (!racks.length) return null

  const CELL = width / GW
  const H = GH * CELL
  const target = String(code || '').toUpperCase()

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 overflow-hidden">
      <div className="relative mx-auto" style={{ width, height: H }}>
        {/* 기둥·통로 — 어디쯤인지 가늠하는 데 필요하다 */}
        {objs.map((o, i) => (
          <div key={`o${i}`}
            className="absolute rounded-sm"
            style={{
              left: (o.grid_x || 0) * CELL, top: (o.grid_y || 0) * CELL,
              width: (o.grid_w || 1) * CELL, height: (o.grid_h || 1) * CELL,
              background: o.color || '#e2e8f0', opacity: 0.5,
            }} />
        ))}

        {racks.map(r => {
          const hit = r.code === target
          return (
            <div key={r.code}
              className={`absolute rounded-sm flex items-center justify-center ${
                hit ? 'ring-2 ring-rose-400' : ''}`}
              style={{
                left: (r.grid_x || 0) * CELL, top: (r.grid_y || 0) * CELL,
                width: (r.grid_w || 2) * CELL, height: (r.grid_h || 8) * CELL,
                background: hit ? '#f43f5e' : '#cbd5e1',
                color: hit ? '#fff' : '#64748b',
                fontSize: Math.max(7, CELL * 1.1),
                fontWeight: hit ? 700 : 500,
              }}>
              {hit ? '★' : r.code}
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-1">
        창고 배치도 · <b className="text-rose-500">{target}</b> 위치
      </p>
    </div>
  )
}
