// ─────────────────────────────────────────────────────────────
// AI 쇼티지 브리핑 — Supabase Edge Function (Deno)
// 쇼티지 캐시 데이터 + 사용자 질문 → Claude API → 자연어 브리핑
//
// 시크릿 (Supabase Dashboard > Edge Functions > Secrets):
//   ANTHROPIC_API_KEY   Anthropic API 키
// ─────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { question, shortageData, customerName } = await req.json()

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY 미설정' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // 쇼티지 데이터를 컴팩트하게 정리 (토큰 절약)
    const rows = (shortageData || []).slice(0, 200).map((r: any) =>
      `${r.std_code} ${r.name?.slice(0, 30) || ''} | 재고 ${r.current_stock} | ${r.year_month} 예상 ${r.projected} (소요 ${r.demand}, 입고 ${r.incoming})`
    ).join('\n')

    const systemPrompt = `당신은 진선테크 구매자재 담당자를 돕는 자재 분석 비서입니다.
${customerName || 'AXCELIS'} 고객사의 쇼티지(부족자재) 예측 데이터를 보고, 구매 담당자가 바로 행동할 수 있게 브리핑합니다.

원칙:
- 한국어로, 간결하고 실무적으로.
- "지금 발주해야 할 것"을 가장 먼저, 가장 중요하게.
- 품번과 함께 왜 급한지(언제 마이너스 되는지) 설명.
- 표가 아니라 사람이 말하듯 브리핑. 핵심 3~5개만 짚고, 나머지는 요약.
- 데이터에 없는 건 지어내지 말 것.
- projected(예상재고)가 음수면 그 시점에 재고가 바닥난다는 뜻.`

    const userPrompt = `질문: ${question || '지금 발주 우선순위를 브리핑해줘'}

쇼티지 예측 데이터 (품번 | 현재고 | 월별 예상재고):
${rows || '(데이터 없음)'}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    const data = await resp.json()
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || 'API 오류' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    return new Response(JSON.stringify({ briefing: text }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
