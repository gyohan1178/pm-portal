# 화면 시험 (tests/screen)

화면을 실제로 띄워서 눌러 보는 자동 시험입니다. **실제 DB 는 건드리지 않습니다** — 가짜 DB(`mocksb2.js`)에 예시 자료(`entry_app.jsx`)를 넣어 화면만 돌립니다.

배포(Cloudflare `npm run build`)에는 들어가지 않습니다. 이 폴더는 화면 코드에서 불러오지 않습니다.

## 돌리는 법

```bash
bash tests/screen/run.sh            # 전부 (4개씩 동시에, 10분 넘게 걸림)
bash tests/screen/run.sh t129 t130  # 몇 개만
```

필요한 것: node · python3 · playwright(크롬 포함, 전역 설치) · `npm install` 된 저장소. 리눅스 기준입니다.

결과는 `/tmp/jsportal-test/out/_result.txt`, 시험별 자세한 내용은 같은 폴더의 `<시험이름>.log`.

## 파일

| 파일 | 하는 일 |
|---|---|
| `cases/t*.cjs` | 시험 하나하나. 맨 위 주석에 무엇을 확인하는지 적혀 있음 |
| `entry_app.jsx` | 시험용 앱 입구 — 예시 자료 · 주소 뒤 옵션(`?r=화면주소` · `?me=로그인한 사람` · `?cyc=1` 순환실사 예시 · `?mr=1` 자재요청 예시) |
| `mocksb2.js` | 가짜 DB. `window.__S` 로 자료 · 호출 기록 · 실패 흉내(`RPCFAIL` · `READFAIL`)를 다룸 |
| `build.mjs` · `run.sh` | 묶기 · 돌리기 |
| `known-failures.txt` | 원래부터 깨져 있는 시험 (오늘 날짜 · 요일에 따라 달라지는 것 등). 여기 없는 것이 깨지면 새로 생긴 문제 |
| `skipped.txt` | 고객사 원본 파일이 있어야 해서 저장소에 넣지 않은 시험 |

## 주의

- 시험 화면은 주소가 바뀌지 않습니다(메모리 라우터). 화면이 넘어갔는지는 화면 글자로 확인합니다.
- 요일 · 날짜에 따라 달라지는 화면은 `p.clock.setFixedTime(...)` 으로 날짜를 고정합니다.
- esbuild 문법 검사는 없는 이름(오타)을 못 잡습니다. 화면을 고치면 그 화면 시험을 꼭 돌립니다.
