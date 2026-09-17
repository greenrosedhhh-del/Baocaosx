@echo off
chcp 65001 > nul
echo ===================================================
echo   VICO - PHÁT ĐƯỜNG DẪN TRỰC TUYẾN RA INTERNET
echo   (Dành cho ca trưởng dùng 4G hoặc truy cập từ xa)
echo ===================================================
echo.
echo [LƯU Ý]: Đảm bảo phần mềm máy chủ đã được bật qua file "start_app.bat".
echo.
echo Đang kết nối đường hầm trực tuyến bảo mật HTTPS...
echo Sau vài giây, hệ thống sẽ cung cấp đường link dạng:
echo   your url is: https://xxxx.loca.lt
echo.
npx -y localtunnel --port 8088
pause
