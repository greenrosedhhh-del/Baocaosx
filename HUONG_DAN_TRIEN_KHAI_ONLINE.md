# CẨM NANG HƯỚNG DẪN ĐẨY HỆ THỐNG LÊN ONLINE CHO NGƯỜI DÙNG
**Hệ Thống Báo Cáo Sản Xuất Trực Tuyến - PX Nhiệt Luyện (VICO)**

Tài liệu này cung cấp **3 phương án triển khai** từ đơn giản nhất (dùng ngay trong ngày) đến chuyên nghiệp (chạy 24/7 trên máy chủ đám mây), tùy theo nhu cầu và hạ tầng của công ty.

---

## BẢNG SO SÁNH NHANH 3 PHƯƠNG ÁN

| Tiêu Chí | Phương Án 1: Wi-Fi Phân Xưởng (LAN) | Phương Án 2: Đường Hầm Online (Cloudflare/Tunnel) | Phương Án 3: Máy Chủ Đám Mây (Cloud/VPS) |
| :--- | :--- | :--- | :--- |
| **Chi phí** | **0 đồng (Miễn phí)** | **0 đồng (Miễn phí)** | Render gói Starter (có phí, cần để giữ dữ liệu) hoặc VPS ~100.000đ/tháng |
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

> [!WARNING]
> Khi phát đường link ra Internet, **bất kỳ ai có link đều mở được trang đăng nhập**. Trước khi gửi link:
> 1. Đảm bảo mọi tài khoản đã đổi mật khẩu tạm (tab "Quản Lý Tài Khoản" không còn nhãn **"Chờ đổi mật khẩu"**).
> 2. Không gửi mật khẩu chung vào nhóm Zalo; đưa mật khẩu tạm riêng cho từng người.

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

### Cách 1: Đưa lên Render.com
> [!IMPORTANT]
> **Gói Free của Render không dùng được cho hệ thống này**: gói Free không gắn được ổ đĩa lưu trữ, nên toàn bộ báo cáo đã nộp **bị xóa sau mỗi lần deploy hoặc khởi động lại**, và máy chủ tự "ngủ" khi không có người dùng. Cần dùng gói **Starter (có phí)** kèm ổ đĩa.

Dự án đã cấu hình sẵn file `render.yaml` (gói Starter + ổ đĩa 1GB + các biến môi trường cần thiết):
1. Tạo tài khoản tại [Render.com](https://render.com).
2. Đưa mã nguồn `D:\Disa` lên kho chứa GitHub cá nhân (chọn chế độ **Private**).
3. Trên Render: Bấm **New** -> **Blueprint** -> chọn kho GitHub vừa tạo. Render đọc `render.yaml` và tạo service.
4. Khi được hỏi `ADMIN_BOOTSTRAP_PASSWORD`, nhập mật khẩu admin đầu tiên (hoặc để trống: hệ thống tự sinh mật khẩu tạm và in trong mục **Logs**).
5. Render cấp tên miền dạng `https://vico-baocao-nllt.onrender.com`. Xem chi tiết các bước trong file `DEPLOY.md`.

### Cách 2: Thuê Cloud VPS Việt Nam (Viettel IDC, VNPT, FPT, TinoHost)
- Thuê gói VPS giá rẻ (~80.000đ - 120.000đ/tháng) cài Windows Server hoặc Ubuntu.
- Copy thư mục `Disa` lên VPS và chạy file `start_app.bat`.
- Gắn tên miền chính thức của công ty (ví dụ: `baocao.vico.com.vn`).

---

## TÀI KHOẢN ĐĂNG NHẬP & MẬT KHẨU

| Tài Khoản | Vai Trò | Phạm Vi Sử Dụng |
| :--- | :--- | :--- |
| **admin** | Quản trị viên | Xem bảng tổng hợp, xuất file Excel, quản lý/thêm tài khoản |
| **hai**, **tan**, **trong** | Trưởng ca | Nhập và sửa báo cáo ca của mình |

**Quy tắc mật khẩu (bảo mật):**
- Mật khẩu **không được ghi trong tài liệu này**. Admin tạo tài khoản với **mật khẩu tạm** và đưa riêng cho từng người.
- Ở lần đăng nhập đầu tiên (hoặc sau khi admin đặt lại mật khẩu), hệ thống **bắt buộc đổi mật khẩu** trước khi dùng các chức năng khác. Mật khẩu mới phải có ít nhất 6 ký tự.
- Các tài khoản cũ từng dùng mật khẩu mặc định cũng sẽ được yêu cầu đổi mật khẩu ở lần đăng nhập tới.
- Mỗi người có thể tự đổi mật khẩu bất cứ lúc nào bằng nút **"Đổi mật khẩu"** ở góc trên màn hình.
- Đăng nhập sai 5 lần liên tiếp, tài khoản bị tạm khóa đăng nhập 5 phút.
- Phiên đăng nhập tự hết hạn sau 7 ngày. Bấm **Đăng xuất**, đổi mật khẩu, hoặc khi admin đặt lại mật khẩu / khóa tài khoản, tài khoản đó bị **đăng xuất trên mọi thiết bị** (điện thoại vừa đổi mật khẩu vẫn giữ đăng nhập). Sau lần cập nhật phần mềm này, mọi người cần đăng nhập lại một lần.
- Nếu quên mật khẩu: admin vào tab **"Quản Lý Tài Khoản"** → **"Đổi mật khẩu"** để đặt mật khẩu tạm mới.
- Để tạo nhanh các tài khoản cơ bản trên máy mới: chạy `python setup_accounts.py` (in ra mật khẩu tạm ngẫu nhiên; tài khoản đã có sẽ **không** bị đổi mật khẩu). Nếu chưa có admin mà tên `admin` đã bị một ca trưởng dùng, script tạo admin với tên khác (vd `admin2`) và in ra màn hình.
- Biến môi trường `ADMIN_BOOTSTRAP_PASSWORD` phải có ít nhất 6 ký tự (tối đa 72 byte); nếu không hợp lệ, hệ thống bỏ qua và tạo mật khẩu tạm (in ra cửa sổ máy chủ / Logs), bắt đổi ở lần đăng nhập đầu.

---

## LƯU Ý KHI NHẬP BÁO CÁO (CA TRƯỞNG & ADMIN)

- **Nút gửi chỉ bấm được sau khi hệ thống kiểm tra xong ngày/ca đang chọn.** Khi vừa đổi ngày hoặc ca, nút hiện "ĐANG KIỂM TRA..."; nếu mạng lỗi, khung cảnh báo hiện nút **"Thử lại"** và nút gửi tạm khóa để không ghi nhầm vào báo cáo của ngày/ca khác.
- Nếu trong lúc bạn nhập, ca đó đã được nộp từ máy khác (hoặc báo cáo bị xóa), máy chủ từ chối lưu, báo lỗi và trang tự kiểm tra lại trạng thái ca.
- Ngày báo cáo không được sau ngày mai. Số người có mặt không được lớn hơn tổng sĩ số; tổng số người nghỉ (có phép + không phép) không được lớn hơn tổng sĩ số.
- Nhấn **Enter / "Tiếp"** trên bàn phím điện thoại chỉ chuyển sang ô kế tiếp, **không** gửi báo cáo. Muốn gửi phải bấm nút **GỬI BÁO CÁO CA / CẬP NHẬT BÁO CÁO CA**.
- Nháp tự lưu trên điện thoại (kể cả khi chỉ nhập phần chấm công). Nếu phiên đăng nhập hết hạn khi đang **sửa báo cáo đã nộp**, nội dung đang sửa được giữ tạm trên máy; đăng nhập lại và mở đúng ngày/ca đó, hệ thống sẽ hỏi có khôi phục không.
- **"Sao chép từ ca trước"** chỉ chép tên sản phẩm, khách hàng, mác thép; không chép ghi chú và **không xóa** các dòng bạn đã nhập số liệu. Các dòng mẫu để trống sẽ không được lưu.
- Để trang mở qua đêm: nếu chưa nhập gì, ngày báo cáo tự chuyển sang ngày mới (Ca 3 buổi sáng vẫn giữ ngày bắt đầu ca).
- **Admin xóa báo cáo nộp nhầm ca:** ở tab "Ca Trưởng Nhập Báo Cáo", chọn đúng ngày/ca → khi báo cáo được nạp, bấm **"🗑 Xóa báo cáo ca này"** và xác nhận. Sau khi xóa, ca trưởng đúng có thể nộp lại vào ca đó. Thao tác không thể hoàn tác.
