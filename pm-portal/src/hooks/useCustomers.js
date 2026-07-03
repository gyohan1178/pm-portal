import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// 고객사 코드(ax/ed/vm/csk)로 단일 고객사 조회. 캐시키 ['cs', code] 공유.
export function useCustomer(code) {
  return useQuery({
    queryKey: ['cs', code],
    enabled: !!code,
    queryFn: async () => {
      if (!code) return null
      const { data } = await supabase
        .from('customers')
        .select('id, code, name')
        .eq('code', String(code).toLowerCase())
        .maybeSingle()
      return data
    },
  })
}

// 전체 고객사 목록 (이름순). 캐시키 ['customers'] 공유.
export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, code, name')
        .order('name')
      return data || []
    },
  })
}
