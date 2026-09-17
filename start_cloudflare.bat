@echo off
chcp 65001 > nul
echo ===================================================
echo   VICO - PHÁT ĐƯỜNG DẪN TRỰC TUYẾN QUA CLOUDFLARE
echo ===================================================
echo.
echo [LƯU Ý]: Hãy đảm bảo máy chủ đã được bật (start_app.bat đang chạy).
echo Đang kết nối tới mạng lưới bảo mật Cloudflare toàn cầu...
echo.
echo Hãy tìm dòng có chứa đường link dạng:
echo   https://xxxxxxxx.trycloudflare.com
echo và gửi link đó cho ca trưởng hoặc mở trên điện thoại (4G)!
echo.
echo ===================================================
echo.
cd /d "%~dp0"
cloudflared.exe tunnel --url http://localhost:8088
pause
