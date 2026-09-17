# CẨM NANG HƯỚNG DẪN ĐẨY HỆ THỐNG LÊN ONLINE CHO NGƯỜI DÙNG
**Hệ Thống Báo Cáo Sản Xuất Trực Tuyến - PX Nhiệt Luyện (VICO)**

Tài liệu này cung cấp **3 phương án triển khai** từ đơn giản nhất (dùng ngay trong ngày) đến chuyên nghiệp (chạy 24/7 trên máy chủ đám mây), tùy theo nhu cầu và hạ tầng của công ty.

---

## BẢNG SO SÁNH NHANH 3 PHƯƠNG ÁN

| Tiêu Chí | Phương Án 1: Wi-Fi Phân Xưởng (LAN) | Phương Án 2: Đường Hầm Online (Cloudflare/Tunnel) | Phương Án 3: Máy Chủ Đám Mây (Cloud/VPS) |
| :--- | :--- | :--- | :--- |
| **Chi phí** | **0 đồng (Miễn phí)** | **0 đồng (Miễn phí)** | Miễn phí hoặc ~100.000đ/tháng |
| **Thiết bị truy cập** | Điện thoại kết nối Wi-Fi xưởng | Bất kỳ đâu (4G, Wi-Fi nhà, công tác) | Bất kỳ đâu (4G, Wi-Fi nhà, công tác) |
| **Bảo mật dữ liệu** | Tuyệt đối (nội bộ trong xưởng) | Rất cao (Mã hóa HTTPS bảo mật) | Cao (Cloud tiêu chuẩn quốc tế) |
| **Yêu cầu máy tính** | Máy tính tại xưởng bật khi có ca | Máy tính tại xưởng bật khi có ca | **Chạy 24/7 không cần bật máy tính xưởng** |
| **Thời gian thiết lập** | **2 phút (Có thể dùng ngay)** | **3 phút** | 15 - 30 phút |

---

## PHƯƠNG ÁN 1: DÙNG NGAY QUA MẠNG WI-FI PHÂN XƯỞNG (KHUYÊN DÙNG NHẤT)

> [!TIP]
> **Ưu điểm lớn nhất**: Không phụ thuộc đường truyền internet cáp quang bên ngoài bị đứt, dữ liệu phân xưởng không lọt ra ngoài, miễn phí 100%.

### Bước 1: Mở cổng tường lửa Windows (Chỉ làm 1 lần duy nhất)
1. Vào thư mục phần mềm `D:\Disa`.
2. Click chuột phải vào file **`open_firewall.bat`** chọn **"Run as administrator"** (Chạy dưới quyền Admin).
3. Màn hình hiện thông báo `[THÀNH CÔNG] Đã mở cổng 8088 thành công!` là xong.

### Bước 2: Bật phần mềm trên máy tính xưởng
- Click đúp vào file **`start_app.bat`** để khởi động hệ thống.

### Bước 3: Ca trưởng truy cập trên điện thoại
- Địa chỉ IP nội bộ của máy tính hiện tại là:
  ```
  http://192.168.88.194:8088
  ```
- **Cách vào:**
  1. Điện thoại ca trưởng kết nối vào Wi-Fi của công ty/phân xưởng.
  2. Mở trình duyệt (Safari/Chrome) trên điện thoại và gõ: `http://192.168.88.194:8088`
  3. Đăng nhập tài khoản cá nhân và bắt đầu nộp báo cáo.

### Mẹo thực tế cho phân xưởng: Tạo mã QR dán ở bảng tin
1. Vào trang web tạo mã QR miễn phí: [me-qr.com](https://me-qr.com) hoặc [qr-code-generator.com](https://www.qr-code-generator.com).
2. Dán link `http://192.168.88.194:8088` vào để tạo mã QR.
3. In mã QR này ra giấy A4 ép plastic, dán tại **Bàn làm việc ca trưởng / Bảng giao ban xưởng**.
4. Đến giờ giao ca, ca trưởng chỉ cần mở Zalo hoặc Camera điện thoại quét mã là vào ngay!

---

## PHƯƠNG ÁN 2: TRUY CẬP ONLINE QUA INTERNET BẰNG 4G (MIỄN PHÍ)

Thích hợp khi ca trưởng muốn nộp báo cáo bằng mạng 4G di động cá nhân, hoặc Ban Giám Đốc muốn xem tổng hợp trên điện thoại khi ở nhà/đi công tác.

### Cách 1: Dùng script phát đường hầm có sẵn (`start_online_tunnel.bat`)
1. Bật máy chủ bằng file `start_app.bat`.
2. Click đúp vào file **`start_online_tunnel.bat`** trong thư mục `D:\Disa`.
3. Cửa sổ hiện ra dòng chữ:
   ```
   your url is: https://vico-xxx.loca.lt
   ```
4. Gửi link này vào nhóm Zalo phân xưởng. Ca trưởng ở bất kỳ đâu bật 4G cũng có thể truy cập được.

### Cách 2: Dùng Cloudflare Tunnel (Tốc độ cao & Ổn định nhất thế giới)
Bạn đã có sẵn file `cloudflared.exe` trong thư mục `D:\Disa`. Bạn có thể chạy theo 1 trong 2 cách:
- **Cách đơn giản nhất**: Nhấp đúp chuột vào file **`start_cloudflare.bat`** (được tạo sẵn).
- **Cách gõ lệnh trong PowerShell**: Vì PowerShell yêu cầu tiền tố `.\` khi chạy file trong thư mục hiện tại, hãy gõ:
  ```powershell
  .\cloudflared tunnel --url http://localhost:8088
  ```
- Sau khi chạy, hãy nhìn trên cửa sổ sẽ có 1 dòng chứa link dạng:
  ```text
  https://xxxx-xxxx-xxxx.trycloudflare.com
  ```
- Sao chép đường link này gửi vào Zalo phân xưởng hoặc mở trên điện thoại (4G) là có thể truy cập ngay lập tức với chứng chỉ bảo mật HTTPS màu xanh!

---

## PHƯƠNG ÁN 3: ĐƯA LÊN MÁY CHỦ ĐÁM MÂY (CHẠY ĐỘC LẬP 24/7)

Thích hợp khi công ty muốn hệ thống hoạt động hoàn toàn tự động trên Cloud mà không cần giữ máy tính ở xưởng bật máy.

### Cách 1: Đưa lên Render.com (Hỗ trợ gói Miễn Phí vĩnh viễn)
Dự án đã được cấu hình sẵn file `Dockerfile` và `requirements.txt`:
1. Tạo tài khoản miễn phí tại [Render.com](https://render.com).
2. Đưa mã nguồn `D:\Disa` lên kho chứa GitHub cá nhân (chọn chế độ Private để bảo mật nội bộ).
3. Trên Render: Bấm **New** -> **Web Service** -> Chọn kho GitHub vừa tạo.
4. Render sẽ tự động nhận diện `Dockerfile`, build và cấp cho công ty một tên miền riêng:
   ```
   https://vico-baocao-nllt.onrender.com
   ```
5. Hệ thống sẽ online 24/24/7 ngày trong tuần.

### Cách 2: Thuê Cloud VPS Việt Nam (Viettel IDC, VNPT, FPT, TinoHost)
- Thuê gói VPS giá rẻ (~80.000đ - 120.000đ/tháng) cài Windows Server hoặc Ubuntu.
- Copy thư mục `Disa` lên VPS và chạy file `start_app.bat`.
- Gắn tên miền chính thức của công ty (ví dụ: `baocao.vico.com.vn`).

---

## TÀI KHOẢN MẶC ĐỊNH HỆ THỐNG ĐỂ BÀN GIAO CHO NGƯỜI DÙNG

| Tài Khoản | Mật Khẩu Mặc Định | Vai Trò | Phạm Vi Sử Dụng |
| :--- | :--- | :--- | :--- |
| **admin** | `admin123` | Quản trị viên | Xem bảng tổng hợp, xuất file Excel, quản lý/thêm tài khoản |
| **hai** | `123456` | Trưởng ca (Hải) | Nhập và sửa báo cáo ca của mình |
| **tan** | `123456` | Trưởng ca (Tân) | Nhập và sửa báo cáo ca của mình |
| **trong** | `123456` | Trưởng ca (Trọng) | Nhập và sửa báo cáo ca của mình |

*(Lưu ý: Quản trị viên có thể vào tab "Quản Lý Tài Khoản" để đổi mật khẩu hoặc tạo thêm tài khoản cho ca trưởng mới bất cứ lúc nào).*
