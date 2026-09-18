# Triển khai VICO Báo Cáo Sản Xuất lên Render

## 1. Chuẩn bị
1. Đẩy code lên GitHub (khuyến nghị repo **private** vì có dữ liệu sản xuất thật).
2. Tạo tài khoản Render (render.com), liên kết với GitHub.

## 2. Tạo Web Service
**Cách nhanh:** New > Blueprint > chọn repo. Render đọc `render.yaml` (đã khai báo sẵn gói Starter, disk `/var/data` và các biến môi trường ở mục 4) — chỉ cần nhập `ADMIN_BOOTSTRAP_PASSWORD` khi được hỏi.

**Cách thủ công:**
1. New > Web Service > chọn repo vừa đẩy lên.
2. Runtime: Python 3.
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
5. Instance Type: chọn gói có hỗ trợ Persistent Disk (Starter trở lên — gói Free không gắn được disk, dữ liệu sẽ mất sau mỗi lần deploy/restart).

## 3. Gắn Persistent Disk
Trong tab "Disks" của service: thêm 1 disk, Mount Path `/var/data`, dung lượng 1GB. (Bỏ qua nếu dùng Blueprint.)

## 4. Biến môi trường (tab Environment)

| Key | Giá trị |
|---|---|
| `SECRET_KEY` | chuỗi ngẫu nhiên dài (Render có nút "Generate"). Nếu không đặt, hệ thống tự sinh và lưu vào file `.secret_key` cạnh database |
| `ENV` | `production` |
| `TZ` | `Asia/Ho_Chi_Minh` (để giờ "nộp lúc" hiển thị đúng giờ Việt Nam) |
| `VICO_DB_PATH` | `/var/data/vico_production.db` |
| `VICO_MASTER_PATH` | `/var/data/bao_cao_tong_hop.xlsx` (đường dẫn file Excel tổng hợp gốc trên disk) |
| `ALLOWED_ORIGINS` | URL thật của service, ví dụ `https://vico-baocao.onrender.com` |
| `ADMIN_BOOTSTRAP_USERNAME` | tên đăng nhập admin đầu tiên bạn muốn dùng |
| `ADMIN_BOOTSTRAP_PASSWORD` | mật khẩu admin đầu tiên (6 ký tự trở lên, tối đa 72 byte). Nếu để trống **hoặc không hợp lệ**, hệ thống tự sinh mật khẩu tạm, in ra mục Logs và bắt đổi ở lần đăng nhập đầu. Nếu tên `ADMIN_BOOTSTRAP_USERNAME` đã bị một tài khoản ca trưởng dùng, admin được tạo với tên khác (vd `admin2`) — xem Logs |
| `ENABLE_API_DOCS` | (không bắt buộc) đặt `1` để bật trang tài liệu API `/docs`, `/redoc`, `/openapi.json`. Mặc định **tắt** trên máy chủ thật |

## 5. Sau khi deploy lần đầu
1. Mở URL `.onrender.com` → đăng nhập bằng tài khoản admin bootstrap.
2. Vào tab "Quản Lý Tài Khoản" → tạo tài khoản cho từng ca trưởng.
3. (Tuỳ chọn, nếu muốn giữ dữ liệu cũ) Chạy `python migrate_add_users.py` cục bộ trỏ vào bản sao `vico_production.db` cũ để tạo tài khoản + backfill, rồi copy file `.db` kết quả lên đường dẫn disk (`/var/data/vico_production.db`) qua Render Shell trước khi service nhận traffic thật.
4. Mỗi ca trưởng đăng nhập bằng điện thoại tại URL trên với mật khẩu tạm admin đưa riêng — hệ thống **bắt buộc đổi mật khẩu** ngay ở lần đăng nhập đầu.

### Phiên đăng nhập (sau bản cập nhật bảo mật)
- Lần deploy đầu tiên có bản cập nhật này, **mọi người phải đăng nhập lại một lần** (cookie phiên cũ không còn được chấp nhận).
- Phiên đăng nhập có hiệu lực tối đa 7 ngày.
- Bấm **Đăng xuất**, đổi mật khẩu, admin đặt lại mật khẩu hoặc khóa tài khoản sẽ **đăng xuất tài khoản đó trên mọi thiết bị** (thiết bị vừa đổi mật khẩu vẫn giữ phiên). Cookie bị sao chép cũng mất hiệu lực ngay.

## 6. Kiểm tra sau deploy
- Đăng nhập ca trưởng → nộp thử 1 báo cáo ca → xác nhận dữ liệu hiện đúng.
- Trigger 1 lần "Manual Deploy" trên Render → xác nhận dữ liệu vừa nộp **không bị mất** (nhờ persistent disk).
- Đăng nhập admin → xem tab Tổng hợp, tải Excel ngày thử. (Chỉ thử "Đồng bộ vào file gốc" nếu đã đưa file gốc lên disk — xem mục 7.)

## 7. Lưu ý về file Excel
- Nút "Tải File Excel Báo Cáo Ngày" hoạt động bình thường trên Render: mỗi lần tải, file được tạo trong thư mục tạm của hệ điều hành rồi **tự xóa ngay sau khi gửi xong** (không còn ghi vào thư mục `exports` của ứng dụng).
- Nút "Đồng bộ vào file tổng hợp gốc" cần file Excel tổng hợp gốc nằm trên disk tại đường dẫn `VICO_MASTER_PATH`. Nếu chưa đưa file lên, nút này báo lỗi rõ ràng; các chức năng khác vẫn chạy bình thường. Muốn dùng thì phải chép file gốc lên disk (ví dụ qua SSH của Render — xem tài liệu SSH của Render), đặt đúng tên theo `VICO_MASTER_PATH`.
- Mỗi lần đồng bộ, hệ thống sao lưu 1 bản file gốc vào `/var/data/backups/` và **tự động chỉ giữ 10 bản mới nhất**, nên không lo đầy disk 1GB.
- Nếu file gốc đang bận (một lần đồng bộ khác đang chạy) hoặc đang bị khóa (ví dụ đang mở trong Excel), nút đồng bộ báo lỗi rõ lý do và **không ghi gì vào file**; đóng file / đợi xong rồi bấm lại.
- Mẫu báo cáo có số dòng cố định (bao gói 4, giỏ bi 4, bi xóc 6). Nếu một ngày có nhiều dòng hơn, các dòng dư được **gộp thành dòng "Khác"** (tổng số liệu vẫn đúng) và tab Tổng hợp hiện cảnh báo.
- Hiện chưa có nút tải file tổng hợp gốc từ server về máy — khi chạy online, nên dùng "Tải File Excel Báo Cáo Ngày" hằng ngày.
