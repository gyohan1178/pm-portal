@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   PM Portal - 미사용 파일 정리
echo ============================================
echo.

if not exist ".git" (
  echo [오류] 여기는 pm-portal 저장소 폴더가 아닙니다.
  echo.
  echo 이 파일을 아래 폴더에 넣고 다시 실행하세요.
  echo   C:\Users\JINSUN\Downloads\pm-portal-v0.2.0\pm-portal\
  echo   ^(그 안에 src 폴더와 package.json 이 보이는 곳^)
  echo.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo [오류] git 을 찾을 수 없습니다. GitHub Desktop 이 설치된 상태에서
  echo        Repository - Open in Command Prompt 로 열어 실행하세요.
  pause
  exit /b 1
)

echo 삭제 대상 16개 (앱에서 한 번도 사용되지 않는 파일)
echo.
echo  [중복 폴더 사본 9]
echo    src\src\components\layout\Sidebar.jsx
echo    src\src\lib\version.js
echo    src\src\pages\production\ProductionPDBox.jsx
echo    src\lib\lib\version.js
echo    src\lib\pages\common\Inbound.jsx
echo    src\lib\pages\customer\PurchasePage.jsx
echo    src\pages\lib\version.js
echo    src\pages\layout\Layout.jsx
echo    src\pages\pages\common\Inventory.jsx
echo.
echo  [구버전 페이지 2]
echo    src\pages\common\Issues.jsx
echo    src\pages\customer\PurchaseOrders.jsx
echo.
echo  [미사용 5]
echo    src\components\PasteBox.jsx
echo    src\components\layout\Login.jsx
echo    src\components\layout\ResizableTable.jsx
echo    src\lib\ecountClient.js
echo    src\lib\exportXlsx.js
echo.
echo  ※ src\lib\version-archive.js 는 보존합니다 (과거 이력 보관본)
echo  ※ git 이력에 남으므로 되돌릴 수 있습니다
echo.

set /p OK="진행할까요? (Y 입력 후 Enter / 그 외는 취소): "
if /i not "%OK%"=="Y" (
  echo.
  echo 취소했습니다. 아무것도 변경하지 않았습니다.
  pause
  exit /b 0
)

echo.
echo 삭제 중...

git rm -q --ignore-unmatch ^
 "src/src/components/layout/Sidebar.jsx" ^
 "src/src/lib/version.js" ^
 "src/src/pages/production/ProductionPDBox.jsx" ^
 "src/lib/lib/version.js" ^
 "src/lib/pages/common/Inbound.jsx" ^
 "src/lib/pages/customer/PurchasePage.jsx" ^
 "src/pages/lib/version.js" ^
 "src/pages/layout/Layout.jsx" ^
 "src/pages/pages/common/Inventory.jsx" ^
 "src/pages/common/Issues.jsx" ^
 "src/pages/customer/PurchaseOrders.jsx" ^
 "src/components/PasteBox.jsx" ^
 "src/components/layout/Login.jsx" ^
 "src/components/layout/ResizableTable.jsx" ^
 "src/lib/ecountClient.js" ^
 "src/lib/exportXlsx.js"

echo.
echo 변경 내역 확인:
git status --short
echo.

set /p OK2="커밋하고 푸시할까요? (Y / 그 외는 여기서 중단): "
if /i not "%OK2%"=="Y" (
  echo.
  echo 커밋하지 않았습니다.
  echo 되돌리려면:  git reset --hard HEAD
  pause
  exit /b 0
)

git add -A && git commit -m "chore: 미사용 파일 16개 정리 (중복 폴더 사본, 구버전 페이지)" && git push

if errorlevel 1 (
  echo.
  echo [실패] 위 오류 메시지를 확인하세요.
) else (
  echo.
  echo ============================================
  echo   완료. Cloudflare 자동 빌드가 시작됩니다.
  echo   빌드가 통과하면 정리가 안전했다는 뜻입니다.
  echo.
  echo   문제 생기면 되돌리기:  git revert HEAD
  echo ============================================
)
echo.
pause
