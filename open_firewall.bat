@echo off
chcp 65001 > nul
echo ===================================================
echo   VICO - MỞ CỔNG 8088 CHO MẠNG NỘI BỘ (WI-FI XƯỞNG)
echo ===================================================
echo.
echo Đang thêm quy tắc tường lửa cho cổng 8088...
netsh advfirewall firewall add rule name="VICO_PX_NLLT_8088" dir=in action=allow protocol=TCP localport=8088
if %errorlevel% equ 0 (
    echo.
    echo [THÀNH CÔNG] Đã mở cổng 8088 thành công!
    echo Các thiết bị cùng mạng Wi-Fi xưởng có thể truy cập ngay vào phần mềm.
) else (
    echo.
    echo [LƯU Ý] Vui lòng click chuột phải vào file này và chọn "Run as administrator" (Chạy dưới quyền Administrator).
)
echo.
pause
