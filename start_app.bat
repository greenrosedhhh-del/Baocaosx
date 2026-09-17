@echo off
chcp 65001 > nul
echo ===================================================
echo   VICO - HỆ THỐNG BÁO CÁO SẢN XUẤT TRỰC TUYẾN
echo   Phân Xưởng Nhiệt Luyện (PX NLLT)
echo ===================================================
echo.
echo Đang khởi động máy chủ web...
cd /d "%~dp0"
start "" http://localhost:8088
python server.py
pause
