# Thiết kế: Tài khoản ca trưởng, phân quyền & triển khai online

- **Ngày:** 2026-09-17
- **Trạng thái:** Đã duyệt bởi người dùng, chờ lập kế hoạch triển khai
- **Phạm vi:** `D:\Disa` — hệ thống "VICO Production Reporting System" (FastAPI + SQLite + JS thuần)

## 1. Bối cảnh & vấn đề

Hệ thống hiện tại (`server.py`, `excel_service.py`, `static/`) cho phép ca trưởng nhập báo cáo sản xuất theo ca (3 ca/ngày), tự động tổng hợp thành báo cáo ngày và xuất Excel. Hệ thống chạy local qua `start_app.bat`, chưa có xác thực người dùng.

Chủ hệ thống muốn:
1. Cấp tài khoản riêng cho từng ca trưởng để họ tự đăng nhập và nhập báo cáo.
2. Triển khai hệ thống lên internet để nhập liệu bằng điện thoại từ xưởng.

Rủi ro nếu triển khai nguyên trạng: trường `shift_leader` là text tự do — bất kỳ ai truy cập URL public đều có thể mạo danh, ghi đè báo cáo của người khác; CORS mở toàn bộ (`allow_origins=["*"]`) kết hợp credentials là cấu hình không an toàn; SQLite trên hosting có filesystem tạm thời sẽ mất dữ liệu sau mỗi lần deploy lại.

## 2. Mục tiêu & ngoài phạm vi

**Mục tiêu:**
- Đăng nhập bằng tài khoản/mật khẩu, 2 vai trò: `admin` và `leader`.
- Ca trưởng chỉ nhập/sửa báo cáo của chính mình; trường "Trưởng ca" tự khóa theo tài khoản đăng nhập, không gõ tay nữa.
- Admin xem được toàn bộ báo cáo mọi ca trưởng, xuất Excel, đồng bộ, quản lý tài khoản ca trưởng (tạo/khóa/đổi mật khẩu).
- Triển khai lên Render (Web Service + persistent disk giữ nguyên SQLite), có HTTPS, truy cập được bằng điện thoại.
- Vá các lỗ hổng cấu hình hiện có (CORS, mật khẩu, cookie).

**Ngoài phạm vi (không làm ở giai đoạn này):**
- Không đổi sang PostgreSQL (SQLite + persistent disk là đủ ở quy mô 3-5 tài khoản).
- Không tự động gửi báo cáo qua email/Zalo theo giờ cố định (người dùng đã xác nhận nút "xem/tải thủ công" là đủ).
- Không làm hệ thống nhắc nhở ca trưởng nộp trễ.
- Không xây dựng lịch sử phiên bản đầy đủ (versioning) cho từng lần sửa báo cáo — chỉ ghi nhận người sửa cuối/thời điểm sửa cuối.
- Không đăng nhập qua OTP/SMS.

## 3. Kiến trúc tổng quan

Giữ nguyên kiến trúc FastAPI đơn khối + SQLite + static JS/HTML hiện có, không tách microservice. Thêm:
- Tầng xác thực session-cookie (Starlette `SessionMiddleware`, cookie ký bằng `SECRET_KEY`, `httponly=True`, `secure=True` khi chạy production qua HTTPS).
- Bảng `users` mới trong cùng SQLite DB.
- Dependency FastAPI `get_current_user` / `require_admin` bảo vệ route.
- Một trang đăng nhập tĩnh (`/login`) tách biệt khỏi `index.html`; `app.js` gọi `/api/auth/me` khi tải trang để biết vai trò và điều hướng.

```
Trình duyệt (điện thoại/PC)
      │  HTTPS
      ▼
Render Web Service (uvicorn server:app)
      │
      ├── SessionMiddleware (đọc/ghi cookie phiên đăng nhập)
      ├── FastAPI routes (auth, shifts, admin, export)
      └── SQLite (vico_production.db trên persistent disk)
```

## 4. Mô hình dữ liệu

### Bảng mới: `users`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| username | TEXT UNIQUE NOT NULL | dùng để đăng nhập |
| password_hash | TEXT NOT NULL | bcrypt (qua `passlib`) |
| full_name | TEXT NOT NULL | tên hiển thị, đổ vào `shift_leader` |
| role | TEXT NOT NULL | `'admin'` hoặc `'leader'` |
| active | INTEGER NOT NULL DEFAULT 1 | admin có thể khóa tài khoản (đặt 0) thay vì xóa |
| created_at | TEXT NOT NULL | |

### Sửa bảng `shifts`

Thêm 2 cột:
- `created_by_user_id INTEGER` — FK tới `users.id`, ghi nhận ai tạo báo cáo ca.
- `updated_by_user_id INTEGER` — ghi nhận ai sửa lần cuối.

Cột `shift_leader` (text) **giữ nguyên** để không phá vỡ `excel_service.py` và các query tổng hợp hiện có — khi tạo/sửa báo cáo, backend tự set `shift_leader = current_user.full_name` (không nhận giá trị này từ client nữa), đảm bảo tương thích ngược với toàn bộ logic tổng hợp/xuất Excel.

### Quy tắc ghi dữ liệu

- `POST /api/shifts`: nếu bản ghi `(report_date, shift_num)` đã tồn tại và `created_by_user_id` khác với user hiện tại và user hiện tại không phải admin → từ chối (403), tránh ca trưởng này ghi đè báo cáo ca trưởng khác cùng ca/cùng ngày.
- Admin có thể sửa bất kỳ báo cáo nào (dùng khi cần chỉnh sửa hộ).

## 5. API thay đổi

### Xác thực

- `POST /api/auth/login` — body `{username, password}` → set session cookie, trả `{username, full_name, role}`.
- `POST /api/auth/logout` — xóa session.
- `GET /api/auth/me` — trả thông tin user hiện tại hoặc 401.

### Bảo vệ route hiện có

| Route | Quyền |
|---|---|
| `POST /api/shifts` | leader (chỉ ca của mình) hoặc admin |
| `GET /api/shifts` | leader chỉ xem ca của mình trong ngày đã chọn; admin xem tất cả |
| `GET /api/daily-summary` | admin only |
| `GET /api/export-excel` | admin only |
| `POST /api/sync-to-master` | admin only |
| `GET /api/history` | admin only |
| `GET /api/presets` | mọi user đã đăng nhập (bỏ danh sách `leaders` cứng — không cần nữa vì tên lấy từ tài khoản) |

### Quản lý tài khoản (admin only)

- `GET /api/admin/users` — danh sách tài khoản ca trưởng.
- `POST /api/admin/users` — tạo tài khoản mới `{username, full_name, password, role}`.
- `PATCH /api/admin/users/{id}` — đổi mật khẩu / khóa-mở tài khoản / đổi tên hiển thị.

## 6. Thay đổi frontend

- Trang mới `static/login.html` (+ `login.js`): form username/password, gọi `/api/auth/login`, điều hướng sang `/` khi thành công.
- `app.js`: khi tải, gọi `/api/auth/me`; nếu 401 → chuyển hướng `/login.html`. Nếu role `leader` → ẩn tab "Tổng hợp" và "Lịch sử", chỉ hiện tab "Nhập báo cáo"; ô "Trưởng ca" đổi từ input tự do sang text tĩnh hiển thị `full_name`, không gửi giá trị này lên nữa (backend tự gán).
- Thêm nút "Đăng xuất" ở header, gọi `/api/auth/logout` rồi quay về `/login.html`.
- Admin: thêm màn hình đơn giản (có thể là 1 tab mới "Quản lý tài khoản") để tạo/khóa tài khoản ca trưởng — form tối giản, không cần thiết kế phức tạp.

## 7. Bảo mật cần vá kèm

- `CORSMiddleware`: bỏ `allow_origins=["*"]` khi có `allow_credentials=True`; đặt origin cụ thể theo domain Render sau khi deploy (ví dụ `https://vico-baocao.onrender.com`). Khi chạy local dev vẫn cho phép `http://localhost:8088`.
- Mật khẩu: hash bằng `passlib[bcrypt]`, không lưu plaintext.
- `SECRET_KEY` cho session: đọc từ biến môi trường, không hardcode trong code.
- Cookie session: `secure=True` khi `ENV=production` (chạy sau HTTPS của Render), `samesite="lax"`.
- Route ghi dữ liệu/export không còn nhận `shift_leader` tự do từ client — loại bỏ vector giả mạo hiện tại.

## 8. Triển khai (Render)

- 1 **Web Service** build từ repo Git, start command `uvicorn server:app --host 0.0.0.0 --port $PORT`.
- Gắn **Persistent Disk** (gói trả phí thấp nhất hỗ trợ disk) mount vào thư mục chứa `vico_production.db`, để dữ liệu không mất khi redeploy.
- Biến môi trường cần cấu hình trên Render:
  - `SECRET_KEY` — chuỗi ngẫu nhiên dài, ký session cookie.
  - `ENV=production` — bật `secure` cookie, giới hạn CORS.
  - `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` — dùng một lần khi khởi tạo DB rỗng để tự tạo tài khoản admin đầu tiên (script `init_db()` kiểm tra nếu bảng `users` rỗng thì tạo user admin từ 2 biến này).
- HTTPS tự động theo domain `*.onrender.com`; có thể gắn domain riêng sau nếu cần.
- Cần khởi tạo git repo cho `D:\Disa` (hiện chưa có) trước khi Render có thể build từ đó — sẽ làm ở bước triển khai thực tế, không phải lúc viết spec này.

## 9. Di trú dữ liệu cũ

Viết script `migrate_add_users.py` chạy 1 lần khi lên hệ thống mới:
1. `ALTER TABLE shifts ADD COLUMN created_by_user_id INTEGER`, tương tự `updated_by_user_id`.
2. Tạo bảng `users`.
3. Với mỗi giá trị `shift_leader` duy nhất đã tồn tại trong `shifts`, tạo 1 tài khoản `leader` tương ứng (username sinh tự động, mật khẩu tạm được thông báo cho admin để đổi lại), rồi gán `created_by_user_id` cho các bản ghi cũ theo tên khớp.
4. Dữ liệu cũ được giữ làm dữ liệu test/tham khảo theo yêu cầu người dùng — không bắt buộc phải khớp chính xác 100%, sai lệch nhỏ chấp nhận được.

## 10. Kiểm thử

- Unit/API test (dùng `TestClient` của FastAPI):
  - Đăng nhập sai mật khẩu → 401.
  - Leader tạo báo cáo ca của mình → thành công, `shift_leader` tự gán đúng theo tài khoản.
  - Leader cố ghi đè báo cáo ca trưởng khác cùng `(date, shift_num)` → 403.
  - Leader gọi `/api/daily-summary`, `/api/export-excel`, `/api/history` → 403.
  - Admin gọi các route trên → 200, thấy dữ liệu mọi ca trưởng.
  - Admin tạo tài khoản mới, tài khoản đó đăng nhập được ngay.
- Kiểm thử tay trên trình duyệt thật (điện thoại) sau khi deploy: đăng nhập, nhập 1 báo cáo ca, admin đăng nhập xem tổng hợp và tải Excel.

## 11. Rủi ro & đánh đổi đã cân nhắc

- **SQLite thay vì Postgres**: chấp nhận giới hạn ghi đồng thời (không đáng lo ở quy mô vài request/ca), đổi lại giữ nguyên toàn bộ logic SQL hiện có, giảm rủi ro triển khai.
- **Không có versioning đầy đủ**: chỉ ghi `updated_by_user_id`/timestamp thay vì lưu lịch sử từng lần sửa — đủ để biết "ai sửa cuối" mà không cần thêm bảng audit phức tạp; có thể bổ sung sau nếu phát sinh nhu cầu tranh chấp dữ liệu.
- **`shift_leader` vẫn là cột text** thay vì chuyển hẳn sang FK `user_id` trong các bảng tổng hợp — giữ tương thích với `excel_service.py` và mẫu Excel gốc, tránh phải viết lại tầng xuất báo cáo.
