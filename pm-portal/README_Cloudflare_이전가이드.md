# Cloudflare Pages 이전 — 따라하기 (30분)

## 0. 이 zip 적용 (프로젝트 루트에 풀기)
- src/main.jsx        → basename이 자동으로 배포경로를 따라가게 수정
- vite.config.js      → base: '/' (기존 파일 덮어쓰기 — 만약 기존에 proxy 등
                        다른 설정이 있었다면 base: '/' 부분만 옮겨 적기!)
- public/_redirects   → 새로고침 시 404 방지 (SPA 라우팅 필수)

적용 후 커밋/푸시:  git add -A && git commit -m "cloudflare" && git push

## 1. Cloudflare 가입 & 프로젝트 생성
1) https://dash.cloudflare.com 가입 (무료, 카드 불필요)
2) 좌측 Workers & Pages → Create → Pages → "Connect to Git"
3) GitHub 인증 → pm-portal 리포 선택

## 2. 빌드 설정 (이대로 입력)
- Framework preset : Vite  (자동 감지될 것)
- Build command    : npm run build
- Build output     : dist
- 환경변수         : 필요 없음 (Supabase 키는 코드에 이미 있음)
→ Save and Deploy

## 3. 확인
- 2~3분 후 https://pm-portal-XXX.pages.dev 주소 발급
- 접속 → 로그인 → 대시보드/생산관리/전광판(/board) 정상 확인
- 새로고침(F5)해도 404 안 뜨는지 확인 (_redirects 동작 체크)

## 4. 리포 비공개 전환 (⚠️ 반드시 3번 정상 확인 후!)
GitHub → pm-portal 리포 → Settings → 맨 아래 Danger Zone
→ Change repository visibility → Private
→ 이 순간 기존 gyohan1178.github.io/pm-portal 은 죽음 (정상)

## 5. 공지
- 팀/현장 test 계정에 새 주소 전달
- 전광판 PC 시작페이지도 새 주소로 변경
- 앞으로 배포 = git push 만 하면 자동 (gh-pages 명령 불필요)

## 문제 생기면
- 흰 화면: vite.config.js의 base가 '/'인지 확인
- 새로고침 404: public/_redirects 파일이 빌드에 포함됐는지 (dist 안에 _redirects 있어야)
- 로그인 안 됨: Supabase → Authentication → URL Configuration에
  새 주소(https://….pages.dev)를 Site URL/Redirect에 추가
