@echo off
chcp 949 >nul
cd /d "%~dp0"
echo ============================================
echo   도면 폴더 파일 목록 뽑기 (읽기만 합니다)
echo ============================================
echo.
echo [1/3] EDWARDS ...
dir /s /b /a-d "\\jinsuntech-nas\1. 공용폴더\1. 업체별 프로젝트\1. EDWARDS\1. 통합도면" > "도면목록_ED.txt" 2> "도면목록_오류.txt"
echo [2/3] VM ...
dir /s /b /a-d "\\jinsuntech-nas\1. 공용폴더\1. 업체별 프로젝트\2. VM" > "도면목록_VM.txt" 2>> "도면목록_오류.txt"
echo [3/3] CSK ...
dir /s /b /a-d "\\jinsuntech-nas\1. 공용폴더\1. 업체별 프로젝트\4. CSK\1. 도면" > "도면목록_CSK.txt" 2>> "도면목록_오류.txt"
echo.
for %%f in ("도면목록_ED.txt" "도면목록_VM.txt" "도면목록_CSK.txt") do echo   %%~f  %%~zf bytes
echo.
echo 끝났습니다. 이 창을 닫고 Claude 에게 "뽑았어" 라고 알려주세요.
pause
