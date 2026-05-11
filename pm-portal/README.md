# PM Portal

진선테크 구매/자재팀 전용 관리 포털

## 기술 스택
- React 18 + Vite
- Tailwind CSS
- Supabase (DB + Auth)
- React Query
- React Router v6

## 로컬 실행

```bash
# 패키지 설치
npm install

# 환경변수 설정
cp .env.example .env.local
# .env.local에 Supabase URL, anon key 입력

# 개발 서버 실행
npm run dev
```

## 배포 (GitHub Pages)

```bash
npm run deploy
```

## 버전 이력
[CHANGELOG.md](./CHANGELOG.md) 참고
