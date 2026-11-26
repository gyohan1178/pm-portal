@echo off
chcp 65001 >nul
rem 포털 → NAS 백업 (수주대장 · 생산관리 · 하네스 진도) — 작업 스케줄러가 하루 한 번 실행
rem 필요: 환경변수 SUPABASE_KEY (service_role 키)
cd /d "%~dp0.."
node scripts\nas_backup.js >> "%~dp0nas_backup.log" 2>&1
