#!/bin/bash
# 화면 시험 돌리기 — 실제 DB 를 건드리지 않는다 (가짜 DB 로 화면만 띄워 눌러 본다)
#   전부:        bash tests/screen/run.sh
#   몇 개만:     bash tests/screen/run.sh t129 t130
#   필요한 것:   node · python3 · playwright(크롬 포함, 전역 설치) · 저장소 node_modules (npm install)
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; W=/tmp/jsportal-test; PORT=8765
mkdir -p $W/site $W/out; ln -sfn "$ROOT" $W/repo
cp -r "$ROOT"/public/* $W/site/ 2>/dev/null; cp "$HERE/app.html" $W/site/; cp "$HERE"/fixtures/* $W/out/ 2>/dev/null
(cd "$ROOT" && node tests/screen/build.mjs && npx tailwindcss -c tailwind.config.js -i src/index.css -o $W/site/app.css 2>/dev/null) || { echo "묶음 실패"; exit 1; }
if ! curl -s -o /dev/null "http://localhost:$PORT/app.html"; then (python3 -m http.server $PORT --directory $W/site >/dev/null 2>&1 &) ; STARTED=1; for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$PORT/app.html" && break; python3 -c "import time; time.sleep(0.3)"; done; fi
export NODE_PATH="$(npm root -g):$ROOT/node_modules"
if [ $# -gt 0 ]; then LIST=$(for t in "$@"; do echo "$HERE/cases/${t%.cjs}.cjs"; done); else LIST=$(ls "$HERE"/cases/t[0-9]*.cjs | sort -V); fi
one() { t=$1; o=$(cd /tmp/jsportal-test/out && timeout 300 node "$t" 2>&1); r=$(echo "$o" | grep -cE "^\s*✗"); e=$(echo "$o" | grep -cE "TimeoutError|^\S*Error:"); n=$(basename "$t" .cjs); echo "$n fail=$r err=$e"; echo "$o" > /tmp/jsportal-test/out/$n.log; }
export -f one
echo "$LIST" | xargs -P 4 -n 1 bash -c 'one "$0"' | sort -V | tee $W/out/_result.txt
BAD=$(grep -v "fail=0 err=0" $W/out/_result.txt | awk '{print $1}')
NEW=""; for b in $BAD; do grep -q "^$b\b" "$HERE/known-failures.txt" 2>/dev/null || NEW="$NEW $b"; done
echo "──────────"; echo "시험 $(wc -l < $W/out/_result.txt)개 · 통과 $(grep -c 'fail=0 err=0' $W/out/_result.txt)개"
echo "알려진 실패 말고 새로 깨진 것:${NEW:- 없음}"; echo "자세한 내용: $W/out/<시험이름>.log"
[ -n "$STARTED" ] && pkill -f "http.server $PORT --directory $W/site" 2>/dev/null
[ -z "$NEW" ]
