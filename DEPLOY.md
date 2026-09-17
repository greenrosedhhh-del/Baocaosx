# Triển khai VICO Báo Cáo Sản Xuất lên Render

## 1. Chuẩn bị
1. Đẩy code lên GitHub (khuyến nghị repo **private** vì có dữ liệu sản xuất thật).
2. Tạo tài khoản Render (render.com), liên kết với GitHub.

## 2. Tạo Web Service
1. New > Web Service > chọn repo vừa đẩy lên (Render tự đọc `render.yaml` nếu có, hoặc cấu hình thủ công theo bảng dưới).
2. Runtime: Python 3.
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
5. Instance Type: chọn gói có hỗ trợ Persistent Disk (Starter trở lên — gói Free không gắn được disk).

## 3. Gắn Persistent Disk
Trong tab "Disks" của service: thêm 1 disk, Mount Path `/var/data`, dung lượng 1GB.

## 4. Biến môi trường (tab Environment)

| Key | Giá trị |
|---|---|
| `SECRET_KEY` | chuỗi ngẫu nhiên dài (Render có nút "Generate") |
| `ENV` | `production` |
| `VICO_DB_PATH` | `/var/data/vico_production.db` |
| `ALLOWED_ORIGINS` | URL thật của service, ví dụ `https://vico-baocao.onrender.com` |
| `ADMIN_BOOTSTRAP_USERNAME` | tên đăng nhập admin đầu tiên bạn muốn dùng |
| `ADMIN_BOOTSTRAP_PASSWORD` | mật khẩu admin đầu tiên (đổi ngay sau khi đăng nhập lần đầu qua tab Quản Lý Tài Khoản) |

## 5. Sau khi deploy lần đầu
1. Mở URL `.onrender.com` → đăng nhập bằng tài khoản admin bootstrap.
2. Vào tab "Quản Lý Tài Khoản" → tạo tài khoản cho từng ca trưởng.
3. (Tuỳ chọn, nếu muốn giữ dữ liệu cũ) Chạy `python migrate_add_users.py` cục bộ trỏ vào bản sao `vico_production.db` cũ để tạo tài khoản + backfill, rồi copy file `.db` kết quả lên đường dẫn disk (`/var/data/vico_production.db`) qua Render Shell trước khi service nhận traffic thật.
4. Mỗi ca trưởng đăng nhập bằng điện thoại tại URL trên, đổi mật khẩu tạm nếu có (đề nghị admin dùng "Đổi mật khẩu" ở tab Quản Lý Tài Khoản).

## 6. Kiểm tra sau deploy
- Đăng nhập ca trưởng → nộp thử 1 báo cáo ca → xác nhận dữ liệu hiện đúng.
- Trigger 1 lần "Manual Deploy" trên Render → xác nhận dữ liệu vừa nộp **không bị mất** (nhờ persistent disk).
- Đăng nhập admin → xem tab Tổng hợp, tải Excel thử, đồng bộ vào file gốc thử.
