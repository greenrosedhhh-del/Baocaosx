# Auth, Phân Quyền & Triển Khai Online — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm hệ thống tài khoản đăng nhập (admin + ca trưởng) cho VICO Production Reporting System, khóa quyền theo vai trò, và chuẩn bị triển khai lên Render với dữ liệu bền vững.

**Architecture:** Giữ nguyên FastAPI + SQLite đơn khối hiện có. Tách `db.py` (kết nối/schema) và `auth.py` (hash mật khẩu + session dependency) ra khỏi `server.py`. Dùng `SessionMiddleware` của Starlette cho phiên đăng nhập (cookie ký, không cần store ngoài). Frontend thêm trang login riêng và gate role trên trang chính hiện có.

**Tech Stack:** FastAPI 0.141.1, Starlette `SessionMiddleware`, `bcrypt` 5.0.0 cho hash mật khẩu, SQLite (giữ nguyên), pytest 9.1.1 + `fastapi.testclient.TestClient` (httpx 0.28.1) cho test.

**Spec:** `docs/superpowers/specs/2026-09-17-auth-phan-quyen-deploy-design.md`

## Global Constraints

- Không đổi sang PostgreSQL — giữ SQLite, dùng persistent disk khi deploy.
- `shift_leader` (cột text trong bảng `shifts`) giữ nguyên định dạng — không đổi sang FK để không phá `excel_service.py`.
- Không xây dựng versioning đầy đủ — chỉ `created_by_user_id` / `updated_by_user_id`.
- Không tự động gửi báo cáo theo giờ — giữ nút thủ công hiện có.
- 2 vai trò cố định: `admin`, `leader`. Không làm hệ phân quyền granular hơn.
- Toàn bộ text hiển thị cho người dùng bằng tiếng Việt, khớp văn phong hiện có trong `static/index.html`/`app.js`.
- Mọi lệnh chạy test dùng `python -m pytest ...` (không dùng `pytest` trực tiếp — máy thực thi có cảnh báo script không nằm trong PATH).

---

## Task 1: Tách tầng database (`db.py`) + hạ tầng test

**Files:**
- Create: `db.py`
- Create: `requirements.txt`
- Create: `requirements-dev.txt`
- Create: `.gitignore`
- Create: `pytest.ini`
- Create: `tests/conftest.py`
- Create: `tests/test_schema.py`
- Modify: `server.py:1-111` (imports, xóa `DB_PATH`/`get_db`/`init_db`, thêm `lifespan`)

**Interfaces:**
- Produces: `db.get_db_path() -> str`, `db.get_db() -> sqlite3.Connection`, `db.init_schema() -> None` — mọi task sau dùng các hàm này thay cho `get_db()`/`init_db()` cũ trong `server.py`.
- Produces: fixture `client` trong `tests/conftest.py` — mọi test file sau đều dùng fixture này (nó set `VICO_DB_PATH` trỏ vào file DB tạm riêng cho từng test).

- [ ] **Step 1: Viết `db.py`**

```python
"""Database connection and schema management for the VICO reporting system."""
import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "vico_production.db")


def get_db_path() -> str:
    return os.environ.get("VICO_DB_PATH", DEFAULT_DB_PATH)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _table_has_column(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def init_schema() -> None:
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date TEXT NOT NULL,
        shift_num INTEGER NOT NULL,
        shift_leader TEXT NOT NULL,
        safety_ppe INTEGER DEFAULT 1,
        safety_equip INTEGER DEFAULT 1,
        staff_total INTEGER DEFAULT 5,
        staff_present INTEGER DEFAULT 5,
        leave_permitted INTEGER DEFAULT 0,
        leave_permitted_names TEXT,
        leave_unpermitted INTEGER DEFAULT 0,
        leave_unpermitted_names TEXT,
        issues TEXT,
        suggestions TEXT,
        start_time TEXT,
        end_time TEXT,
        created_at TEXT,
        UNIQUE(report_date, shift_num)
    )
    """)
    if not _table_has_column(cursor, "shifts", "created_by_user_id"):
        cursor.execute("ALTER TABLE shifts ADD COLUMN created_by_user_id INTEGER")
    if not _table_has_column(cursor, "shifts", "updated_by_user_id"):
        cursor.execute("ALTER TABLE shifts ADD COLUMN updated_by_user_id INTEGER")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS packaging_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        product_name TEXT,
        customer TEXT,
        from_val TEXT,
        to_val TEXT,
        weight_sorted REAL,
        weight_waste REAL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS basket_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        product_name TEXT,
        customer TEXT,
        from_val TEXT,
        to_val TEXT,
        steel_grade TEXT,
        basket_count REAL,
        total_weight REAL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tumbling_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        product_name TEXT,
        customer TEXT,
        m1 REAL,
        m2 REAL,
        total_weight REAL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE
    )
    """)

    conn.commit()
    conn.close()
```

- [ ] **Step 2: Sửa `server.py` để dùng `db.py`**

Trong `server.py`, xóa các đoạn sau (dòng 5-6, 19, 33-107, 110):
- Import `sqlite3` (dòng 6) — không còn dùng trực tiếp trong `server.py`.
- Hằng số `DB_PATH = os.path.join(...)` (dòng 19).
- Hàm `get_db()` (dòng 33-36).
- Hàm `init_db()` toàn bộ (dòng 39-107).
- Lời gọi `init_db()` ở top-level (dòng 110).

Thay bằng đầu file mới (dòng 1-30 mới):

```python
"""
VICO Production Report Management System - FastAPI Backend
Provides REST APIs for shift report entry, auto-aggregation across shifts, and Excel generation.
"""
import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import excel_service

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    yield


app = FastAPI(title="VICO Production Reporting System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Sau đó thay **mọi** lời gọi `get_db()` còn lại trong file (trong `save_shift_report`, `get_shifts`, `compute_daily_summary`, `get_history`) thành `db.get_db()`. Các hàm này giữ nguyên logic, chỉ đổi tên gọi.

- [ ] **Step 3: Tạo `requirements.txt`**

```
fastapi>=0.141.1
uvicorn[standard]>=0.52.4
pydantic>=2.13.5
openpyxl>=3.1.5
bcrypt>=5.0.0
itsdangerous>=2.2.0
```

- [ ] **Step 4: Tạo `requirements-dev.txt`**

```
-r requirements.txt
pytest>=9.1.1
httpx>=0.28.1
```

- [ ] **Step 5: Tạo `.gitignore`**

```
__pycache__/
*.pyc
.pytest_cache/
*.db
exports/
backups/
temp_day_report.xlsx
test_out.xlsx
BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx
.env
```

- [ ] **Step 6: Tạo `pytest.ini`**

```ini
[pytest]
testpaths = tests
```

- [ ] **Step 7: Tạo `tests/conftest.py`**

```python
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test_vico.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    monkeypatch.setenv("ADMIN_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
    monkeypatch.setenv("SECRET_KEY", "test-secret")

    with TestClient(server.app) as c:
        yield c
```

- [ ] **Step 8: Viết `tests/test_schema.py`**

```python
import db as db_module


def test_init_schema_is_idempotent(client):
    db_module.init_schema()
    db_module.init_schema()

    conn = db_module.get_db()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(shifts)")
    columns = {row[1] for row in cursor.fetchall()}
    conn.close()

    assert "created_by_user_id" in columns
    assert "updated_by_user_id" in columns
    assert "shift_leader" in columns


def test_users_table_exists(client):
    conn = db_module.get_db()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(users)")
    columns = {row[1] for row in cursor.fetchall()}
    conn.close()

    assert {"id", "username", "password_hash", "full_name", "role", "active"}.issubset(columns)
```

- [ ] **Step 9: Cài dependencies và chạy test**

Run: `python -m pip install -r requirements-dev.txt`
Run: `python -m pytest tests/test_schema.py -v`
Expected: 2 PASSED

- [ ] **Step 10: Kiểm tra server vẫn chạy được như cũ (chưa có auth)**

Run: `python -m pytest tests/ -v`
Expected: tất cả PASSED (chỉ có 2 test ở bước trên tại thời điểm này)

- [ ] **Step 11: Commit**

Bỏ qua bước git commit ở Task này — repo Git sẽ được khởi tạo một lần ở Task 8 (theo yêu cầu người dùng). Chỉ cần đảm bảo các file đã lưu trên đĩa.

---

## Task 2: `auth.py` — hash mật khẩu & dependency xác thực

**Files:**
- Create: `auth.py`
- Create: `tests/test_hash.py`

**Interfaces:**
- Consumes: `db.get_db()` (Task 1).
- Produces: `auth.hash_password(password: str) -> str`, `auth.verify_password(password: str, password_hash: str) -> bool`, `auth.get_current_user(request) -> Optional[dict]`, `auth.require_user(request) -> dict` (FastAPI dependency, raises 401), `auth.require_admin(user: dict = Depends(require_user)) -> dict` (FastAPI dependency, raises 403) — Task 3 dùng toàn bộ các hàm/dependency này trong `server.py`.

- [ ] **Step 1: Viết `tests/test_hash.py`**

```python
import auth


def test_hash_password_produces_different_hash_each_time():
    h1 = auth.hash_password("secret123")
    h2 = auth.hash_password("secret123")
    assert h1 != h2


def test_verify_password_accepts_correct_password():
    h = auth.hash_password("secret123")
    assert auth.verify_password("secret123", h) is True


def test_verify_password_rejects_wrong_password():
    h = auth.hash_password("secret123")
    assert auth.verify_password("wrong", h) is False
```

- [ ] **Step 2: Chạy test để xác nhận lỗi (chưa có `auth.py`)**

Run: `python -m pytest tests/test_hash.py -v`
Expected: FAIL với `ModuleNotFoundError: No module named 'auth'`

- [ ] **Step 3: Viết `auth.py`**

```python
"""Password hashing and session-based authentication for the VICO reporting system."""
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request

import db


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def get_current_user(request: Request) -> Optional[dict]:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, full_name, role, active FROM users WHERE id = ?",
        (user_id,),
    )
    row = cursor.fetchone()
    conn.close()
    if not row or not row["active"]:
        return None
    return dict(row)


def require_user(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin mới có quyền truy cập")
    return user
```

- [ ] **Step 4: Chạy lại test**

Run: `python -m pytest tests/test_hash.py -v`
Expected: 3 PASSED

- [ ] **Step 5: Commit**

Bỏ qua (chưa có git repo, xem Task 8).

---

## Task 3: Backend — session đăng nhập, bảo vệ route, quản lý tài khoản admin

**Files:**
- Modify: `server.py` (toàn bộ file — xem nội dung đầy đủ bên dưới)
- Create: `tests/test_auth.py`
- Create: `tests/test_admin_users.py`
- Create: `tests/test_shifts_auth.py`
- Delete: (không có file cũ nào cần xóa — đây là lần đầu thêm các test này)

**Interfaces:**
- Consumes: `db.get_db()`, `db.init_schema()` (Task 1); `auth.hash_password`, `auth.verify_password`, `auth.require_user`, `auth.require_admin` (Task 2).
- Produces:
  - `POST /api/auth/login` — body `{username, password}` → `{username, full_name, role}` hoặc 401.
  - `POST /api/auth/logout` → `{status: "ok"}`.
  - `GET /api/auth/me` → `{username, full_name, role}` hoặc 401.
  - `GET /api/admin/users` (admin) → danh sách `{id, username, full_name, role, active, created_at}`.
  - `POST /api/admin/users` (admin) — body `{username, full_name, password, role}` → `{status, id}`.
  - `PATCH /api/admin/users/{user_id}` (admin) — body `{full_name?, password?, active?}` → `{status}`.
  - `POST /api/shifts` giờ yêu cầu đăng nhập, không còn nhận `shift_leader` từ client (tự gán theo tài khoản), và chặn ghi đè báo cáo của người khác (403).
  - `GET /api/shifts`, `GET /api/daily-summary`, `GET /api/export-excel`, `POST /api/sync-to-master`, `GET /api/history`, `GET /api/presets` đều yêu cầu đăng nhập; 4 route sau chỉ admin.
  - Frontend Task 4/5/6 gọi các endpoint trên.

- [ ] **Step 1: Viết `tests/test_auth.py`**

```python
def test_login_fails_with_wrong_password(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_login_succeeds_with_bootstrap_admin(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "admin"
    assert data["username"] == "admin"


def test_me_requires_login(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_returns_current_user_after_login(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_logout_clears_session(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    client.post("/api/auth/logout")
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
```

- [ ] **Step 2: Viết `tests/test_admin_users.py`**

```python
def _login_admin(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200


def test_unauthenticated_cannot_list_users(client):
    resp = client.get("/api/admin/users")
    assert resp.status_code == 401


def test_create_and_list_user(client):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": "tan", "full_name": "Tân", "password": "leader123", "role": "leader"
    })
    assert resp.status_code == 200
    assert "id" in resp.json()

    resp = client.get("/api/admin/users")
    usernames = [u["username"] for u in resp.json()]
    assert "tan" in usernames


def test_create_user_rejects_duplicate_username(client):
    _login_admin(client)
    client.post("/api/admin/users", json={
        "username": "tan", "full_name": "Tân", "password": "leader123", "role": "leader"
    })
    resp = client.post("/api/admin/users", json={
        "username": "tan", "full_name": "Tân 2", "password": "abc12345", "role": "leader"
    })
    assert resp.status_code == 400


def test_admin_can_deactivate_user_and_blocks_their_login(client):
    _login_admin(client)
    create_resp = client.post("/api/admin/users", json={
        "username": "hai", "full_name": "Hải", "password": "leader123", "role": "leader"
    })
    user_id = create_resp.json()["id"]

    resp = client.patch(f"/api/admin/users/{user_id}", json={"active": False})
    assert resp.status_code == 200

    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"username": "hai", "password": "leader123"})
    assert resp.status_code == 401


def test_leader_account_cannot_manage_users(client):
    _login_admin(client)
    client.post("/api/admin/users", json={
        "username": "quang", "full_name": "Quang", "password": "leader123", "role": "leader"
    })
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "quang", "password": "leader123"})

    resp = client.get("/api/admin/users")
    assert resp.status_code == 403
```

- [ ] **Step 3: Viết `tests/test_shifts_auth.py`**

```python
def _login_admin(client):
    client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})


def _create_leader(client, username, full_name, password="leader123"):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": username, "full_name": full_name, "password": password, "role": "leader"
    })
    assert resp.status_code == 200
    client.post("/api/auth/logout")


def _login(client, username, password="leader123"):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200


SAMPLE_SHIFT = {
    "report_date": "2026-09-17",
    "shift_num": 1,
    "safety_ppe": True,
    "safety_equip": True,
    "staff_total": 5,
    "staff_present": 5,
    "leave_permitted": 0,
    "leave_permitted_names": "",
    "leave_unpermitted": 0,
    "leave_unpermitted_names": "",
    "issues": "",
    "suggestions": "",
    "start_time": "6h",
    "end_time": "14h",
    "packaging": [],
    "baskets": [],
    "tumbling": []
}


def test_unauthenticated_cannot_submit_shift(client):
    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 401


def test_shift_leader_name_is_forced_from_account(client):
    _create_leader(client, "tan", "Tân")
    _login(client, "tan")

    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 200

    _login_admin(client)
    resp = client.get("/api/shifts", params={"date": "2026-09-17"})
    shifts = resp.json()
    assert len(shifts) == 1
    assert shifts[0]["shift_leader"] == "Tân"


def test_leader_cannot_overwrite_another_leaders_shift(client):
    _create_leader(client, "tan", "Tân")
    _create_leader(client, "hai", "Hải")

    _login(client, "tan")
    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 200
    client.post("/api/auth/logout")

    _login(client, "hai")
    resp = client.post("/api/shifts", json=SAMPLE_SHIFT)
    assert resp.status_code == 403


def test_leader_can_edit_own_shift(client):
    _create_leader(client, "tan", "Tân")
    _login(client, "tan")

    client.post("/api/shifts", json=SAMPLE_SHIFT)
    edited = dict(SAMPLE_SHIFT, suggestions="Cần thêm bao tay")
    resp = client.post("/api/shifts", json=edited)
    assert resp.status_code == 200


def test_leader_only_sees_own_shifts_in_list(client):
    _create_leader(client, "tan", "Tân")
    _create_leader(client, "hai", "Hải")

    _login(client, "tan")
    client.post("/api/shifts", json=SAMPLE_SHIFT)
    client.post("/api/auth/logout")

    _login(client, "hai")
    shift2 = dict(SAMPLE_SHIFT, shift_num=2)
    client.post("/api/shifts", json=shift2)

    resp = client.get("/api/shifts", params={"date": "2026-09-17"})
    shifts = resp.json()
    assert len(shifts) == 1
    assert shifts[0]["shift_num"] == 2


def test_leader_cannot_access_daily_summary(client):
    _create_leader(client, "tan", "Tân")
    _login(client, "tan")
    resp = client.get("/api/daily-summary", params={"date": "2026-09-17"})
    assert resp.status_code == 403


def test_admin_can_access_daily_summary(client):
    _login_admin(client)
    resp = client.get("/api/daily-summary", params={"date": "2026-09-17"})
    assert resp.status_code == 200
```

- [ ] **Step 4: Chạy toàn bộ test mới để xác nhận lỗi**

Run: `python -m pytest tests/test_auth.py tests/test_admin_users.py tests/test_shifts_auth.py -v`
Expected: FAIL hàng loạt (404/422 do route/model chưa tồn tại)

- [ ] **Step 5: Viết lại toàn bộ `server.py`**

```python
"""
VICO Production Report Management System - FastAPI Backend
Provides REST APIs for shift report entry, auto-aggregation across shifts, and Excel generation.
"""
import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Query, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel

import auth
import db
import excel_service

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-insecure-secret-change-me")
IS_PRODUCTION = os.environ.get("ENV") == "production"
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:8088,http://127.0.0.1:8088"
).split(",")


def bootstrap_admin() -> None:
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as c FROM users")
    count = cursor.fetchone()["c"]
    if count == 0:
        username = os.environ.get("ADMIN_BOOTSTRAP_USERNAME", "admin")
        password = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
        cursor.execute(
            "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
            "VALUES (?, ?, ?, 'admin', 1, ?)",
            (username, auth.hash_password(password), "Quản trị viên",
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
    conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    bootstrap_admin()
    yield


app = FastAPI(title="VICO Production Reporting System", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    same_site="lax",
    https_only=IS_PRODUCTION,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- MODELS ----------------
class PackagingItemModel(BaseModel):
    product_name: str
    customer: str
    from_val: Optional[str] = ""
    to_val: Optional[str] = ""
    weight_sorted: Optional[float] = 0
    weight_waste: Optional[float] = 0
    notes: Optional[str] = ""


class BasketItemModel(BaseModel):
    product_name: str
    customer: str
    from_val: Optional[str] = ""
    to_val: Optional[str] = ""
    steel_grade: Optional[str] = ""
    basket_count: Optional[float] = 0
    total_weight: Optional[float] = None
    notes: Optional[str] = ""


class TumblingItemModel(BaseModel):
    product_name: str
    customer: str
    m1: Optional[float] = 0
    m2: Optional[float] = 0
    total_weight: Optional[float] = 0
    notes: Optional[str] = ""


class ShiftReportModel(BaseModel):
    report_date: str
    shift_num: int
    safety_ppe: bool = True
    safety_equip: bool = True
    staff_total: int = 5
    staff_present: int = 5
    leave_permitted: int = 0
    leave_permitted_names: Optional[str] = ""
    leave_unpermitted: int = 0
    leave_unpermitted_names: Optional[str] = ""
    issues: Optional[str] = ""
    suggestions: Optional[str] = ""
    start_time: Optional[str] = ""
    end_time: Optional[str] = ""
    packaging: List[PackagingItemModel] = []
    baskets: List[BasketItemModel] = []
    tumbling: List[TumblingItemModel] = []


class LoginModel(BaseModel):
    username: str
    password: str


class UserCreateModel(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "leader"


class UserUpdateModel(BaseModel):
    full_name: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None


# ---------------- AUTH ROUTES ----------------

@app.post("/api/auth/login")
def login(payload: LoginModel, request: Request):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (payload.username,))
    row = cursor.fetchone()
    conn.close()
    if not row or not row["active"] or not auth.verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
    request.session["user_id"] = row["id"]
    return {"username": row["username"], "full_name": row["full_name"], "role": row["role"]}


@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(user: dict = Depends(auth.require_user)):
    return {"username": user["username"], "full_name": user["full_name"], "role": user["role"]}


# ---------------- ADMIN: USER MANAGEMENT ----------------

@app.get("/api/admin/users")
def list_users(admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, full_name, role, active, created_at FROM users ORDER BY id")
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users


@app.post("/api/admin/users")
def create_user(payload: UserCreateModel, admin: dict = Depends(auth.require_admin)):
    if payload.role not in ("admin", "leader"):
        raise HTTPException(status_code=400, detail="role phải là 'admin' hoặc 'leader'")

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (payload.username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{payload.username}' đã tồn tại")

    cursor.execute(
        "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
        "VALUES (?, ?, ?, ?, 1, ?)",
        (payload.username, auth.hash_password(payload.password), payload.full_name, payload.role,
         datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
    )
    conn.commit()
    user_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "id": user_id}


@app.patch("/api/admin/users/{user_id}")
def update_user(user_id: int, payload: UserUpdateModel, admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")

    updates = []
    params = []
    if payload.full_name is not None:
        updates.append("full_name = ?")
        params.append(payload.full_name)
    if payload.password is not None:
        updates.append("password_hash = ?")
        params.append(auth.hash_password(payload.password))
    if payload.active is not None:
        updates.append("active = ?")
        params.append(int(payload.active))

    if updates:
        params.append(user_id)
        cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    conn.close()
    return {"status": "success"}


# ---------------- SHIFT REPORT ROUTES ----------------

@app.get("/api/presets")
def get_presets(user: dict = Depends(auth.require_user)):
    return {
        "products": ["D25", "D40", "D60", "D80"],
        "customers": ["Molycop", "Nhập TQ", "Khô dầu", "VICO"],
        "steel_grades": ["CR18", "18", "CR20", "B2"],
        "shift_hours": {
            1: {"start": "6h", "end": "14h"},
            2: {"start": "14h", "end": "22h"},
            3: {"start": "22h", "end": "6h"}
        }
    }


@app.post("/api/shifts")
def save_shift_report(report: ShiftReportModel, user: dict = Depends(auth.require_user)):
    conn = db.get_db()
    cursor = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        shift_leader_name = user["full_name"]

        cursor.execute(
            "SELECT id, created_by_user_id FROM shifts WHERE report_date = ? AND shift_num = ?",
            (report.report_date, report.shift_num)
        )
        existing = cursor.fetchone()

        if existing:
            owner_id = existing["created_by_user_id"]
            if owner_id is not None and owner_id != user["id"] and user["role"] != "admin":
                raise HTTPException(
                    status_code=403,
                    detail=f"Báo cáo Ca {report.shift_num} ngày {report.report_date} đã được ca trưởng khác nộp, bạn không có quyền sửa."
                )
            shift_id = existing["id"]
            cursor.execute("""
            UPDATE shifts SET
                shift_leader = ?, safety_ppe = ?, safety_equip = ?,
                staff_total = ?, staff_present = ?, leave_permitted = ?,
                leave_permitted_names = ?, leave_unpermitted = ?, leave_unpermitted_names = ?,
                issues = ?, suggestions = ?, start_time = ?, end_time = ?, created_at = ?,
                updated_by_user_id = ?
            WHERE id = ?
            """, (
                shift_leader_name, int(report.safety_ppe), int(report.safety_equip),
                report.staff_total, report.staff_present, report.leave_permitted,
                report.leave_permitted_names, report.leave_unpermitted, report.leave_unpermitted_names,
                report.issues, report.suggestions, report.start_time, report.end_time, now_str,
                user["id"],
                shift_id
            ))
            cursor.execute("DELETE FROM packaging_items WHERE shift_id = ?", (shift_id,))
            cursor.execute("DELETE FROM basket_items WHERE shift_id = ?", (shift_id,))
            cursor.execute("DELETE FROM tumbling_items WHERE shift_id = ?", (shift_id,))
        else:
            cursor.execute("""
            INSERT INTO shifts (
                report_date, shift_num, shift_leader, safety_ppe, safety_equip,
                staff_total, staff_present, leave_permitted, leave_permitted_names,
                leave_unpermitted, leave_unpermitted_names, issues, suggestions,
                start_time, end_time, created_at, created_by_user_id, updated_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                report.report_date, report.shift_num, shift_leader_name,
                int(report.safety_ppe), int(report.safety_equip),
                report.staff_total, report.staff_present, report.leave_permitted,
                report.leave_permitted_names, report.leave_unpermitted,
                report.leave_unpermitted_names, report.issues, report.suggestions,
                report.start_time, report.end_time, now_str, user["id"], user["id"]
            ))
            shift_id = cursor.lastrowid

        for p in report.packaging:
            if p.product_name or p.customer or p.weight_sorted:
                cursor.execute("""
                INSERT INTO packaging_items (
                    shift_id, product_name, customer, from_val, to_val, weight_sorted, weight_waste, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, p.product_name, p.customer, p.from_val, p.to_val, p.weight_sorted, p.weight_waste, p.notes))

        for b in report.baskets:
            if b.product_name or b.customer or b.basket_count:
                cursor.execute("""
                INSERT INTO basket_items (
                    shift_id, product_name, customer, from_val, to_val, steel_grade, basket_count, total_weight, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, b.product_name, b.customer, b.from_val, b.to_val, b.steel_grade, b.basket_count, b.total_weight, b.notes))

        for t in report.tumbling:
            if t.product_name or t.customer or t.m1 or t.m2 or t.total_weight:
                cursor.execute("""
                INSERT INTO tumbling_items (
                    shift_id, product_name, customer, m1, m2, total_weight, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, t.product_name, t.customer, t.m1, t.m2, t.total_weight, t.notes))

        conn.commit()
        return {"status": "success", "message": f"Báo cáo Ca {report.shift_num} ngày {report.report_date} đã được lưu thành công!", "shift_id": shift_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/api/shifts")
def get_shifts(date: str = Query(..., description="YYYY-MM-DD"), user: dict = Depends(auth.require_user)):
    conn = db.get_db()
    cursor = conn.cursor()
    if user["role"] == "admin":
        cursor.execute("SELECT * FROM shifts WHERE report_date = ? ORDER BY shift_num", (date,))
    else:
        cursor.execute(
            "SELECT * FROM shifts WHERE report_date = ? AND created_by_user_id = ? ORDER BY shift_num",
            (date, user["id"])
        )
    shifts = [dict(row) for row in cursor.fetchall()]

    for s in shifts:
        s_id = s["id"]
        cursor.execute("SELECT * FROM packaging_items WHERE shift_id = ?", (s_id,))
        s["packaging"] = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM basket_items WHERE shift_id = ?", (s_id,))
        s["baskets"] = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM tumbling_items WHERE shift_id = ?", (s_id,))
        s["tumbling"] = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return shifts


def compute_daily_summary(report_date: str) -> dict:
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM shifts WHERE report_date = ? ORDER BY shift_num", (report_date,))
    shifts = [dict(row) for row in cursor.fetchall()]

    if not shifts:
        conn.close()
        return {
            "report_date": report_date,
            "submitted_shifts": [],
            "packaging": [],
            "baskets": [],
            "tumbling": [],
            "issues": [],
            "suggestions": "KO",
            "attendance": {"total_staff": 15, "present": 0, "leave_notes": "Ko", "leave_detail": "", "unpermitted": "Ko"}
        }

    shift_ids = [s["id"] for s in shifts]
    submitted_nums = [s["shift_num"] for s in shifts]

    total_staff = sum([s["staff_total"] for s in shifts]) or 15
    total_present = sum([s["staff_present"] for s in shifts])

    leave_names_list = []
    unpermitted_names_list = []
    for s in shifts:
        if s["leave_permitted_names"]:
            leave_names_list.append(f"Ca {s['shift_num']}: {s['leave_permitted_names']}")
        if s["leave_unpermitted_names"]:
            unpermitted_names_list.append(f"Ca {s['shift_num']}: {s['leave_unpermitted_names']}")

    leave_notes = "Ko" if not leave_names_list else "; ".join(leave_names_list)
    unpermitted = "Ko" if not unpermitted_names_list else "; ".join(unpermitted_names_list)

    cursor.execute(f"""
        SELECT product_name, customer,
               SUM(weight_sorted) as sum_sorted,
               SUM(weight_waste) as sum_waste,
               GROUP_CONCAT(notes, '; ') as combined_notes
        FROM packaging_items
        WHERE shift_id IN ({','.join(['?']*len(shift_ids))})
        GROUP BY product_name, customer
        ORDER BY sum_sorted DESC
    """, shift_ids)

    packaging_rows = []
    packaging_notes = []
    for r in cursor.fetchall():
        p_name = r["product_name"] or ""
        c_name = r["customer"] or ""
        notes = r["combined_notes"] or ""
        if "nghiệm thu" in notes.lower() or "lò" in notes.lower() or "xếp kho" in notes.lower():
            packaging_notes.append(f" - {notes}")
            item_notes = ""
        else:
            item_notes = notes

        packaging_rows.append({
            "product_name": p_name,
            "customer": c_name,
            "weight_sorted": r["sum_sorted"] or 0,
            "weight_waste": r["sum_waste"] or 0,
            "notes": item_notes
        })

    cursor.execute(f"""
        SELECT product_name, customer, steel_grade,
               SUM(basket_count) as sum_baskets,
               SUM(total_weight) as sum_weight,
               GROUP_CONCAT(notes, '; ') as combined_notes
        FROM basket_items
        WHERE shift_id IN ({','.join(['?']*len(shift_ids))})
        GROUP BY product_name, customer, steel_grade
        ORDER BY sum_baskets DESC
    """, shift_ids)

    basket_rows = []
    for r in cursor.fetchall():
        b_count = r["sum_baskets"] or 0
        w = r["sum_weight"] or (b_count * 350)
        basket_rows.append({
            "product_name": r["product_name"] or "",
            "customer": r["customer"] or "",
            "steel_grade": r["steel_grade"] or "",
            "basket_count": b_count,
            "total_weight": w,
            "notes": r["combined_notes"] or ""
        })

    cursor.execute(f"""
        SELECT product_name, customer, notes,
               SUM(m1) as sum_m1,
               SUM(m2) as sum_m2,
               SUM(total_weight) as sum_weight
        FROM tumbling_items
        WHERE shift_id IN ({','.join(['?']*len(shift_ids))})
        GROUP BY product_name, customer, notes
        ORDER BY sum_weight DESC
    """, shift_ids)

    tumbling_rows = []
    for r in cursor.fetchall():
        tumbling_rows.append({
            "product_name": r["product_name"] or "",
            "customer": r["customer"] or "",
            "m1": r["sum_m1"] or 0,
            "m2": r["sum_m2"] or 0,
            "total_weight": r["sum_weight"] or 0,
            "notes": r["notes"] or ""
        })

    issues_list = []
    for s in shifts:
        if s["issues"] and s["issues"].strip() and s["issues"].strip().upper() != "KO":
            lines = [l.strip() for l in s["issues"].split("\n") if l.strip()]
            for l in lines:
                clean_l = l.lstrip("-*• ")
                issues_list.append(f"Ca {s['shift_num']} ({s['shift_leader']}): {clean_l}")

    sugg_list = []
    for s in shifts:
        if s["suggestions"] and s["suggestions"].strip() and s["suggestions"].strip().upper() != "KO":
            sugg_list.append(f"Ca {s['shift_num']}: {s['suggestions']}")
    final_sugg = "; ".join(sugg_list) if sugg_list else "KO"

    conn.close()

    return {
        "report_date": report_date,
        "submitted_shifts": submitted_nums,
        "shift_count": len(submitted_nums),
        "attendance": {
            "total_staff": total_staff,
            "present": total_present,
            "leave_notes": leave_notes,
            "leave_detail": f"{total_staff - total_present} người nghỉ" if (total_staff - total_present) > 0 else "",
            "unpermitted": unpermitted
        },
        "packaging": packaging_rows,
        "packaging_notes": packaging_notes,
        "baskets": basket_rows,
        "basket_notes": "",
        "tumbling": tumbling_rows,
        "issues": issues_list,
        "suggestions": final_sugg,
        "reporter_name": "Ngọc Quang"
    }


@app.get("/api/daily-summary")
def get_daily_summary(date: str = Query(..., description="YYYY-MM-DD"), admin: dict = Depends(auth.require_admin)):
    return compute_daily_summary(date)


@app.get("/api/export-excel")
def export_excel_report(date: str = Query(..., description="YYYY-MM-DD"), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(date)
    if not summary.get("submitted_shifts"):
        raise HTTPException(status_code=400, detail=f"Chưa có ca nào nộp báo cáo trong ngày {date} để xuất file!")

    file_path = excel_service.generate_excel_report(summary)
    dt_str = date.replace("-", "")
    return FileResponse(
        path=file_path,
        filename=f"BAO_CAO_TONG_HOP_{dt_str}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.post("/api/sync-to-master")
def sync_to_master(date: str = Query(..., description="YYYY-MM-DD"), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(date)
    if not summary.get("submitted_shifts"):
        raise HTTPException(status_code=400, detail=f"Chưa có ca nào nộp báo cáo trong ngày {date}!")

    result = excel_service.sync_to_master(summary)
    return result


@app.get("/api/history")
def get_history(admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT report_date,
               COUNT(id) as shift_count,
               GROUP_CONCAT(shift_num, ',') as shifts,
               GROUP_CONCAT(shift_leader, ', ') as leaders
        FROM shifts
        GROUP BY report_date
        ORDER BY report_date DESC
        LIMIT 30
    """)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


# Mount static files
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8088, reload=True)
```

- [ ] **Step 6: Chạy lại toàn bộ test**

Run: `python -m pytest tests/ -v`
Expected: tất cả PASSED (schema 2 + hash 3 + auth 5 + admin_users 5 + shifts_auth 7 = 22 test)

- [ ] **Step 7: Commit**

Bỏ qua (git repo khởi tạo ở Task 8).

---

## Task 4: Trang đăng nhập (`login.html`)

**Files:**
- Create: `static/login.html`
- Create: `static/login.js`
- Modify: `static/style.css` (thêm cuối file)

**Interfaces:**
- Consumes: `POST /api/auth/login` (Task 3).
- Produces: trang `login.html` mà Task 5 điều hướng người dùng chưa đăng nhập tới.

- [ ] **Step 1: Tạo `static/login.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Đăng Nhập - VICO Báo Cáo Sản Xuất</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body class="login-body">
  <div class="login-wrap">
    <div class="card login-card">
      <div class="brand" style="justify-content:center; margin-bottom: 1.5rem;">
        <div class="brand-badge">VICO</div>
        <div class="brand-info">
          <h1 style="color: var(--slate-900);">PX Nhiệt Luyện</h1>
          <p style="color: var(--slate-600);">Đăng nhập hệ thống báo cáo</p>
        </div>
      </div>
      <form id="loginForm">
        <div class="form-group mt-2">
          <label for="loginUsername">Tên đăng nhập</label>
          <input type="text" id="loginUsername" required autofocus>
        </div>
        <div class="form-group mt-2">
          <label for="loginPassword">Mật khẩu</label>
          <input type="password" id="loginPassword" required>
        </div>
        <div id="loginError" class="login-error" style="display:none;"></div>
        <button type="submit" class="btn btn-primary btn-lg mt-2" style="width:100%;">Đăng Nhập</button>
      </form>
    </div>
  </div>
  <script src="login.js"></script>
</body>
</html>
```

- [ ] **Step 2: Tạo `static/login.js`**

```js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        window.location.href = 'index.html';
      } else {
        const data = await res.json();
        errorBox.textContent = data.detail || 'Sai tên đăng nhập hoặc mật khẩu';
        errorBox.style.display = 'block';
      }
    } catch (err) {
      errorBox.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
      errorBox.style.display = 'block';
    }
  });
});
```

- [ ] **Step 3: Thêm CSS cuối `static/style.css`**

Thêm vào cuối file (sau khối `@media (max-width: 768px) { ... }` hiện có):

```css

/* LOGIN PAGE */
.login-body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
}

.login-wrap {
  width: 100%;
  max-width: 380px;
  padding: 1rem;
}

.login-card {
  padding: 2rem;
}

.login-error {
  background: var(--danger-light);
  color: var(--danger);
  padding: 0.6rem 0.85rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

/* READONLY FIELDS */
input[readonly] {
  background: var(--slate-100);
  color: var(--slate-700);
  cursor: not-allowed;
}
```

- [ ] **Step 4: Kiểm thử thủ công**

Run: `python server.py` (server chạy tại `http://localhost:8088`)
Mở trình duyệt tới `http://localhost:8088/login.html`, đăng nhập bằng `admin` / `admin123` (giá trị mặc định khi chưa set biến môi trường bootstrap). Xác nhận: sai mật khẩu hiện thông báo lỗi đỏ; đúng mật khẩu chuyển hướng sang `index.html`.
Dừng server bằng Ctrl+C sau khi xác nhận.

- [ ] **Step 5: Commit**

Bỏ qua (git repo khởi tạo ở Task 8).

---

## Task 5: Tích hợp đăng nhập vào trang chính (`index.html` / `app.js`)

**Files:**
- Modify: `static/index.html:22-28` (thêm khối hiển thị user + nút đăng xuất)
- Modify: `static/index.html:75-86` (đổi ô "Trưởng Ca" thành readonly)
- Modify: `static/app.js:3-4` (auth guard đầu file)
- Modify: `static/app.js:38` (thêm áp dụng user vào UI + ẩn tab theo role)
- Modify: `static/app.js:236-243` (bỏ validate `shiftLeader` nhập tay)
- Modify: `static/app.js:306-325` (bỏ field `shift_leader` khỏi payload gửi lên)

**Interfaces:**
- Consumes: `GET /api/auth/me`, `POST /api/auth/logout` (Task 3).
- Produces: mọi trang đã đăng nhập biết `currentUser.role`; Task 6 dùng biến `currentUser` và các phần tử `btnTabAdmin` được tạo ở đây.

- [ ] **Step 1: Sửa `static/index.html` — thêm khối user/logout trong header**

Tìm đoạn (dòng 22-28):

```html
      <div class="header-status">
        <span class="live-dot"></span>
        <span id="currentDateDisplay">Hôm nay: ...</span>
      </div>
    </div>
  </header>
```

Thay bằng:

```html
      <div class="header-status">
        <span class="live-dot"></span>
        <span id="currentDateDisplay">Hôm nay: ...</span>
      </div>
      <div class="header-status" id="userStatusBox" style="display:none;">
        <span id="currentUserName"></span>
        <button class="btn btn-sm btn-secondary" id="btnLogout" type="button">Đăng xuất</button>
      </div>
    </div>
  </header>
```

- [ ] **Step 2: Sửa `static/index.html` — thêm tab "Quản Lý Tài Khoản" (ẩn mặc định)**

Tìm đoạn (dòng 41-44):

```html
      <button class="tab-btn" data-tab="history-tab" id="btnTabHistory">
        <span class="tab-icon">🕒</span>
        <span class="tab-title">Lịch Sử & Tra Cứu</span>
      </button>
    </div>
  </nav>
```

Thay bằng:

```html
      <button class="tab-btn" data-tab="history-tab" id="btnTabHistory">
        <span class="tab-icon">🕒</span>
        <span class="tab-title">Lịch Sử & Tra Cứu</span>
      </button>
      <button class="tab-btn" data-tab="admin-tab" id="btnTabAdmin" style="display:none;">
        <span class="tab-icon">👤</span>
        <span class="tab-title">Quản Lý Tài Khoản</span>
      </button>
    </div>
  </nav>
```

- [ ] **Step 3: Sửa `static/index.html` — ô "Trưởng Ca" thành readonly**

Tìm đoạn (dòng 75-86):

```html
            <div class="form-group">
              <label for="shiftLeader">Trưởng Ca <span class="req">*</span></label>
              <div class="input-with-presets">
                <input type="text" id="shiftLeader" placeholder="Nhập tên trưởng ca" required list="leaderPresets">
                <datalist id="leaderPresets">
                  <option value="Trọng">
                  <option value="Hải">
                  <option value="Tân">
                  <option value="Quang">
                </datalist>
              </div>
            </div>
```

Thay bằng:

```html
            <div class="form-group">
              <label for="shiftLeader">Trưởng Ca</label>
              <input type="text" id="shiftLeader" readonly>
            </div>
```

- [ ] **Step 4: Thêm khung tab admin (rỗng, Task 6 sẽ điền nội dung JS) vào cuối `static/index.html`**

Tìm đoạn (dòng 328-332):

```html
    </section>

  </main>
```

Thay bằng:

```html
    </section>

    <!-- ================= TAB 4: QUẢN LÝ TÀI KHOẢN (ADMIN) ================= -->
    <section id="admin-tab" class="tab-content">
      <div class="card">
        <div class="section-header-flex">
          <h2>Thêm Tài Khoản Ca Trưởng</h2>
        </div>
        <form id="createUserForm" class="grid grid-4">
          <div class="form-group">
            <label for="newUsername">Tên đăng nhập</label>
            <input type="text" id="newUsername" required>
          </div>
          <div class="form-group">
            <label for="newFullName">Họ tên hiển thị</label>
            <input type="text" id="newFullName" required>
          </div>
          <div class="form-group">
            <label for="newPassword">Mật khẩu</label>
            <input type="text" id="newPassword" required>
          </div>
          <div class="form-group">
            <label for="newRole">Vai trò</label>
            <select id="newRole">
              <option value="leader">Ca trưởng</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="form-group" style="align-self: end;">
            <button type="submit" class="btn btn-primary">+ Tạo Tài Khoản</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="section-header-flex">
          <h2>Danh Sách Tài Khoản</h2>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tên đăng nhập</th>
                <th>Họ tên</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody id="tbodyUsers"></tbody>
          </table>
        </div>
      </div>
    </section>

  </main>
```

- [ ] **Step 5: Sửa `static/app.js` — thêm auth guard đầu file**

Tìm đoạn (dòng 3-4):

```js
document.addEventListener('DOMContentLoaded', async () => {
  // Elements
```

Thay bằng:

```js
document.addEventListener('DOMContentLoaded', async () => {
  // --- AUTH GUARD ---
  let currentUser = null;
  try {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) {
      window.location.href = 'login.html';
      return;
    }
    currentUser = await meRes.json();
  } catch (e) {
    window.location.href = 'login.html';
    return;
  }

  // Elements
```

- [ ] **Step 6: Sửa `static/app.js` — áp dụng user vào UI + ẩn tab theo role**

Tìm dòng (dòng 38, ngay trước `let presets = {`):

```js
  currentDateDisplay.textContent = `Hôm nay: ${formatDateDisplay(today)}`;

  let presets = {
```

Thay bằng:

```js
  currentDateDisplay.textContent = `Hôm nay: ${formatDateDisplay(today)}`;

  // --- APPLY CURRENT USER TO UI ---
  shiftLeaderInput.value = currentUser.full_name;

  const userStatusBox = document.getElementById('userStatusBox');
  const currentUserName = document.getElementById('currentUserName');
  const btnLogout = document.getElementById('btnLogout');
  userStatusBox.style.display = 'flex';
  currentUserName.textContent = `${currentUser.full_name} (${currentUser.role === 'admin' ? 'Admin' : 'Ca trưởng'})`;
  btnLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });

  const btnTabSummaryEl = document.getElementById('btnTabSummary');
  const btnTabHistoryEl = document.getElementById('btnTabHistory');
  const btnTabAdmin = document.getElementById('btnTabAdmin');
  if (currentUser.role !== 'admin') {
    btnTabSummaryEl.style.display = 'none';
    btnTabHistoryEl.style.display = 'none';
  } else {
    btnTabAdmin.style.display = 'flex';
  }

  let presets = {
```

- [ ] **Step 7: Sửa `static/app.js` — bỏ validate/field `shift_leader` nhập tay**

Tìm đoạn (dòng 236-243):

```js
    const reportDate = reportDateInput.value;
    const shiftNum = parseInt(shiftNumSelect.value, 10);
    const shiftLeader = shiftLeaderInput.value.trim();

    if (!reportDate || !shiftLeader) {
      showToast("Vui lòng điền đầy đủ ngày báo cáo và tên trưởng ca!");
      return;
    }
```

Thay bằng:

```js
    const reportDate = reportDateInput.value;
    const shiftNum = parseInt(shiftNumSelect.value, 10);

    if (!reportDate) {
      showToast("Vui lòng chọn ngày báo cáo!");
      return;
    }
```

Tìm đoạn (dòng 306-309):

```js
    const payload = {
      report_date: reportDate,
      shift_num: shiftNum,
      shift_leader: shiftLeader,
      safety_ppe: document.getElementById('safetyPpe').checked,
```

Thay bằng:

```js
    const payload = {
      report_date: reportDate,
      shift_num: shiftNum,
      safety_ppe: document.getElementById('safetyPpe').checked,
```

- [ ] **Step 8: Kiểm thử thủ công**

Run: `python server.py`
Mở `http://localhost:8088/` khi chưa đăng nhập → xác nhận tự chuyển hướng sang `login.html`.
Đăng nhập `admin`/`admin123` → xác nhận: ô "Trưởng Ca" hiển thị "Quản trị viên" (readonly, không sửa được), tất cả 4 tab hiện ra (kể cả "Quản Lý Tài Khoản" dù Task 6 chưa điền nội dung), nút "Đăng xuất" hoạt động và quay lại `login.html`.
Dừng server sau khi xác nhận.

- [ ] **Step 9: Commit**

Bỏ qua (git repo khởi tạo ở Task 8).

---

## Task 6: Giao diện quản lý tài khoản cho Admin

**Files:**
- Modify: `static/app.js` (thêm khối xử lý tab admin + sửa tab-switch listener)

**Interfaces:**
- Consumes: `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}` (Task 3); `btnTabAdmin`, `#tbodyUsers`, `#createUserForm` (Task 5).

- [ ] **Step 1: Sửa listener chuyển tab để gọi `loadUsers()`**

Tìm đoạn trong `static/app.js` (khối tab switching, hiện tại khoảng dòng 75-79):

```js
      if (targetId === 'summary-tab') {
        loadSummary();
      } else if (targetId === 'history-tab') {
        loadHistory();
      }
```

Thay bằng:

```js
      if (targetId === 'summary-tab') {
        loadSummary();
      } else if (targetId === 'history-tab') {
        loadHistory();
      } else if (targetId === 'admin-tab') {
        loadUsers();
      }
```

- [ ] **Step 2: Thêm khối quản lý tài khoản trước phần `// UTILITIES`**

Tìm đoạn cuối file (hiện tại ngay trước `// UTILITIES`, sau khối `async function loadHistory() { ... }`):

```js
  // UTILITIES
```

Thay bằng (chèn khối mới trước dòng đó):

```js
  // --- TAB 4: ADMIN USER MANAGEMENT ---
  const tbodyUsers = document.getElementById('tbodyUsers');
  const createUserForm = document.getElementById('createUserForm');

  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        username: document.getElementById('newUsername').value.trim(),
        full_name: document.getElementById('newFullName').value.trim(),
        password: document.getElementById('newPassword').value,
        role: document.getElementById('newRole').value
      };
      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Đã tạo tài khoản mới!');
          createUserForm.reset();
          loadUsers();
        } else {
          alert('Lỗi: ' + (data.detail || 'Không thể tạo tài khoản'));
        }
      } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
      }
    });
  }

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users');
      const users = await res.json();
      tbodyUsers.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.username}</td>
          <td>${u.full_name}</td>
          <td>${u.role === 'admin' ? 'Admin' : 'Ca trưởng'}</td>
          <td><span class="rate-badge ${u.active ? 'good' : 'bad'}">${u.active ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
          <td>
            <button class="btn btn-sm btn-outline btn-toggle-active">${u.active ? 'Khóa' : 'Mở khóa'}</button>
            <button class="btn btn-sm btn-outline btn-reset-password">Đổi mật khẩu</button>
          </td>
        `;
        tr.querySelector('.btn-toggle-active').addEventListener('click', async () => {
          await fetch(`/api/admin/users/${u.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: !u.active })
          });
          loadUsers();
        });
        tr.querySelector('.btn-reset-password').addEventListener('click', async () => {
          const newPassword = prompt(`Nhập mật khẩu mới cho ${u.full_name}:`);
          if (!newPassword) return;
          await fetch(`/api/admin/users/${u.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPassword })
          });
          showToast('Đã đổi mật khẩu!');
        });
        tbodyUsers.appendChild(tr);
      });
    } catch (e) {
      tbodyUsers.innerHTML = `<tr><td colspan="5" style="color:red;">Lỗi tải danh sách: ${e.message}</td></tr>`;
    }
  }

  // UTILITIES
```

- [ ] **Step 3: Kiểm thử thủ công**

Run: `python server.py`
Đăng nhập `admin`/`admin123` → mở tab "Quản Lý Tài Khoản" → tạo 1 tài khoản `role=leader` → xác nhận xuất hiện trong bảng → bấm "Khóa" → xác nhận trạng thái đổi thành "Đã khóa" → đăng xuất, thử đăng nhập bằng tài khoản vừa khóa → xác nhận bị từ chối.
Dừng server sau khi xác nhận.

- [ ] **Step 4: Commit**

Bỏ qua (git repo khởi tạo ở Task 8).

---

## Task 7: Script di trú dữ liệu cũ (`migrate_add_users.py`)

**Files:**
- Create: `migrate_add_users.py`
- Create: `tests/test_migrate_add_users.py`

**Interfaces:**
- Consumes: `db.init_schema()`, `db.get_db()` (Task 1); `auth.hash_password()` (Task 2).
- Produces: `migrate_add_users.migrate(db_path: Optional[str] = None) -> None` — chạy độc lập qua CLI, không được route nào gọi.

- [ ] **Step 1: Viết `tests/test_migrate_add_users.py`**

```python
import db
import migrate_add_users


def _insert_legacy_shift(conn, report_date, shift_num, shift_leader):
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO shifts (report_date, shift_num, shift_leader, created_at)
        VALUES (?, ?, ?, ?)
    """, (report_date, shift_num, shift_leader, "2026-09-10 08:00:00"))
    conn.commit()


def test_migrate_creates_leader_accounts_and_backfills_ownership(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    db.init_schema()

    conn = db.get_db()
    _insert_legacy_shift(conn, "2026-09-10", 1, "Tân")
    _insert_legacy_shift(conn, "2026-09-10", 2, "Hải")
    conn.close()

    migrate_add_users.migrate()

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, role FROM users WHERE full_name = 'Tân'")
    tan_user = cursor.fetchone()
    assert tan_user is not None
    assert tan_user["role"] == "leader"

    cursor.execute("SELECT created_by_user_id FROM shifts WHERE shift_leader = 'Tân'")
    assert cursor.fetchone()["created_by_user_id"] == tan_user["id"]
    conn.close()


def test_migrate_is_idempotent(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy2.db"
    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    db.init_schema()

    conn = db.get_db()
    _insert_legacy_shift(conn, "2026-09-11", 1, "Quang")
    conn.close()

    migrate_add_users.migrate()
    migrate_add_users.migrate()

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as c FROM users WHERE full_name = 'Quang'")
    assert cursor.fetchone()["c"] == 1
    conn.close()
```

- [ ] **Step 2: Chạy test để xác nhận lỗi**

Run: `python -m pytest tests/test_migrate_add_users.py -v`
Expected: FAIL với `ModuleNotFoundError: No module named 'migrate_add_users'`

- [ ] **Step 3: Viết `migrate_add_users.py`**

```python
"""One-off script: tạo tài khoản ca trưởng từ các giá trị shift_leader đã có
trong dữ liệu cũ, và gán created_by_user_id/updated_by_user_id cho các báo
cáo cũ tương ứng.

Usage:
    python migrate_add_users.py [path/to/vico_production.db]

An toàn khi chạy lại nhiều lần: bỏ qua tên đã có tài khoản tương ứng.
"""
import os
import secrets
import string
import sys
from datetime import datetime

import auth
import db


def _generate_temp_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def migrate(db_path: str = None) -> None:
    if db_path:
        os.environ["VICO_DB_PATH"] = db_path

    db.init_schema()

    conn = db.get_db()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT DISTINCT shift_leader FROM shifts WHERE shift_leader IS NOT NULL AND shift_leader != ''"
    )
    distinct_names = [row[0] for row in cursor.fetchall()]

    created = []
    for full_name in distinct_names:
        cursor.execute("SELECT id FROM users WHERE full_name = ?", (full_name,))
        existing = cursor.fetchone()
        if existing:
            user_id = existing["id"]
        else:
            base_username = full_name.lower().replace(" ", "")
            username = base_username
            suffix = 1
            while True:
                cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
                if not cursor.fetchone():
                    break
                suffix += 1
                username = f"{base_username}{suffix}"

            temp_password = _generate_temp_password()
            cursor.execute(
                "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
                "VALUES (?, ?, ?, 'leader', 1, ?)",
                (username, auth.hash_password(temp_password), full_name,
                 datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            )
            user_id = cursor.lastrowid
            created.append((username, full_name, temp_password))

        cursor.execute(
            "UPDATE shifts SET created_by_user_id = ?, updated_by_user_id = ? "
            "WHERE shift_leader = ? AND created_by_user_id IS NULL",
            (user_id, user_id, full_name),
        )

    conn.commit()
    conn.close()

    if created:
        print("Đã tạo tài khoản mới (đưa mật khẩu tạm cho từng ca trưởng, yêu cầu đổi khi đăng nhập lần đầu):")
        for username, full_name, temp_password in created:
            print(f"  - {full_name}: username={username}  password={temp_password}")
    else:
        print("Không có tài khoản mới nào cần tạo (đã tồn tại từ trước).")


if __name__ == "__main__":
    target_db = sys.argv[1] if len(sys.argv) > 1 else None
    migrate(target_db)
```

- [ ] **Step 4: Chạy lại test**

Run: `python -m pytest tests/test_migrate_add_users.py -v`
Expected: 2 PASSED

- [ ] **Step 5: Commit**

Bỏ qua (git repo khởi tạo ở Task 8).

---

## Task 8: Chuẩn bị triển khai (git, Render, runbook)

**Files:**
- Create: `render.yaml`
- Create: `DEPLOY.md`
- Modify: `.gitignore` (rà soát lại — nội dung đã đúng từ Task 1, chỉ xác nhận)

**Interfaces:**
- Consumes: `requirements.txt` (Task 1), `server.py` hoàn chỉnh (Task 3).
- Produces: repo Git sẵn sàng push lên GitHub/Render.

- [ ] **Step 1: Chạy toàn bộ test suite lần cuối trước khi đóng gói**

Run: `python -m pytest tests/ -v`
Expected: tất cả PASSED

- [ ] **Step 2: Tạo `render.yaml`**

```yaml
services:
  - type: web
    name: vico-baocao
    env: python
    plan: starter
    buildCommand: "pip install -r requirements.txt"
    startCommand: "uvicorn server:app --host 0.0.0.0 --port $PORT"
    disk:
      name: vico-data
      mountPath: /var/data
      sizeGB: 1
    envVars:
      - key: SECRET_KEY
        generateValue: true
      - key: ENV
        value: production
      - key: VICO_DB_PATH
        value: /var/data/vico_production.db
      - key: ALLOWED_ORIGINS
        sync: false
      - key: ADMIN_BOOTSTRAP_USERNAME
        sync: false
      - key: ADMIN_BOOTSTRAP_PASSWORD
        sync: false
```

- [ ] **Step 3: Tạo `DEPLOY.md`**

```markdown
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
```

- [ ] **Step 4: Xác nhận `.gitignore` (đã tạo ở Task 1) không bỏ sót**

Kiểm tra nội dung `.gitignore` hiện có bao gồm: `__pycache__/`, `*.db`, `exports/`, `backups/`, `test_out.xlsx`, `BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx`, `.env`. File `template_report.xlsx` **không** được liệt kê (cần thiết cho `excel_service.py`, phải được commit).

- [ ] **Step 5: Khởi tạo git repo và commit lần đầu**

Run: `git init`
Run: `git add server.py db.py auth.py excel_service.py requirements.txt requirements-dev.txt pytest.ini .gitignore migrate_add_users.py render.yaml DEPLOY.md static/ tests/ template_report.xlsx docs/ start_app.bat`
Run:
```bash
git commit -m "$(cat <<'EOF'
Thêm hệ thống đăng nhập, phân quyền admin/ca trưởng và chuẩn bị triển khai Render

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Xác nhận trạng thái repo**

Run: `git status`
Expected: working tree sạch, không còn file chưa track quan trọng (file `.db` thật, `exports/`, `backups/` bị bỏ qua bởi `.gitignore`).

---

## Ghi chú cho người thực thi

- Task 1-3 là backend thuần, có thể chạy `python -m pytest tests/ -v` sau mỗi task để xác nhận không có gì hỏng.
- Task 4-6 là frontend, không có test tự động (dự án hiện không có JS test framework) — bắt buộc kiểm thử tay bằng trình duyệt như mô tả trong từng Step.
- Sau khi hoàn thành Task 8, việc còn lại (đẩy code lên GitHub, tạo service trên Render, nhập biến môi trường) là thao tác trên giao diện web Render — không tự động hóa được trong plan này, làm theo `DEPLOY.md`.
- Khi chạy `python -m pytest`, có thể thấy cảnh báo `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated; install httpx2 instead`. Đây là cảnh báo vô hại từ phiên bản `starlette`/`httpx` hiện cài trong môi trường này (đã xác minh `TestClient` vẫn kích hoạt đúng `lifespan` startup/shutdown) — không phải lỗi cần sửa, bỏ qua.
