# 이카운트 OAPI 연동 — 배포 가이드

## 1. 시크릿 등록 (절대 코드/프론트에 넣지 말 것)
Supabase Dashboard → Edge Functions → (또는 CLI) Secrets:

```
ECOUNT_COM_CODE = 회사코드(6자리)
ECOUNT_USER_ID  = 인증키 발급받은 이카운트 ID
ECOUNT_CERT_KEY = 테스트 인증키(API_CERT_KEY)
ECOUNT_ENV      = test     # 테스트(sboapi). 운영 전환 시 prod
```

CLI 예시:
```
supabase secrets set ECOUNT_COM_CODE=xxxxxx ECOUNT_USER_ID=GYOHAN ECOUNT_CERT_KEY=발급키 ECOUNT_ENV=test
```

## 2. 배포
```
supabase functions deploy ecount
```

## 3. IP 등록 (중요)
이카운트 ERP → Self-Customizing → 정보관리 → API인증키발급 → IP등록 에
**Edge Function이 나가는 IP**를 등록해야 함.

⚠️ **Supabase Edge Function은 고정 IP가 없음(서버리스).** 두 갈래:
- (A) 테스트(sbo) 단계에서 IP 검증이 느슨하면 → 그대로 진행, ping 성공하면 OK
- (B) `205 허용되지 않은 IP` 가 계속 뜨면 → 고정 IP 프록시(예: 작은 VPS/람다+NAT)를 한 단계 둬야 함

먼저 ping으로 확인 → 205 나오면 (B)로 전환.

## 4. 연결 점검
프론트에서:
```js
import { ecountPing } from './lib/ecountClient'
const r = await ecountPing()   // { ok:true, zone:'A', env:'test', sessionCached:true }
```
또는 직접:
```
POST https://<project>.supabase.co/functions/v1/ecount
Authorization: Bearer <anon key>
{ "action": "ecount-ping" }   // 실제로는 { "action":"ping" }
```

## 5. 차단정책 가드 (코드 내장)
- 연속 로그인 실패 5회 → **자동 중단 10분** (이카운트 기준 10회 차단 전에 선제 차단)
- SESSION_ID 25분 캐싱 → 매 호출 로그인 안 함
- `205`(IP)·`201`(키무효)·`204`(키환경)·`412`(횟수초과)는 재시도 무의미 → 즉시 보고
→ 개발 중 실수로 IP 통째 차단되는 사고 방지. **빈 인증정보로 ping 반복 금지.**

## 6. 다음 단계
- ping 성공 후 → 품목/거래처/발주서 등 **실제 API 명세** 받아서 `ecountCall('/OAPI/V2/...', payload)` 로 래핑
- 각 메뉴는 이카운트에서 **"검증"** 먼저 해야 열림 (API인증현황 화면)
