"""
VICO Production Report Management System - FastAPI Backend
Provides REST APIs for shift report entry, auto-aggregation across shifts, and Excel generation.
"""
import logging
import os
import re
import sqlite3
import tempfile
import unicodedata
from contextlib import asynccontextmanager
from datetime import date as Date, datetime, timedelta
from typing import Annotated, List, Literal, Optional

from annotated_types import Ge, Le
from fastapi import Depends, FastAPI, HTTPException, Path as PathParam, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AllowInfNan, BaseModel, BeforeValidator, StringConstraints, field_validator, model_validator
from starlette.background import BackgroundTask
from starlette.middleware.sessions import SessionMiddleware

import auth
import db
import excel_service

logger = logging.getLogger("vico")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

SECRET_KEY_PATH = os.environ.get(
    "VICO_SECRET_KEY_PATH",
    os.path.join(os.path.dirname(os.path.abspath(db.get_db_path())), ".secret_key"),
)
SECRET_KEY = auth.load_secret_key(SECRET_KEY_PATH)
IS_PRODUCTION = os.environ.get("ENV") == "production"
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:8088,http://127.0.0.1:8088"
).split(",")
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])

GENERIC_SERVER_ERROR = "Lỗi máy chủ. Vui lòng thử lại, nếu vẫn lỗi hãy báo quản trị viên."

# Giới hạn hợp lý cho số liệu nhập (tránh số vô hạn / quá lớn làm hỏng tổng hợp)
MAX_WEIGHT_KG = 10_000_000
MAX_COUNT = 100_000
MAX_STAFF = 1_000
MAX_SQLITE_ID = 2 ** 63 - 1
# Cho phép nộp trước tối đa 1 ngày (lệch múi giờ / Ca 3 qua đêm)
MAX_REPORT_DAYS_AHEAD = 1


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def server_today() -> Date:
    return datetime.now().date()


def api_docs_settings() -> dict:
    """/docs, /redoc, /openapi.json chỉ bật khi đặt ENABLE_API_DOCS=1."""
    if os.environ.get("ENABLE_API_DOCS") == "1":
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


def _ascii(text: str) -> str:
    return text.encode("ascii", "backslashreplace").decode("ascii")


def _free_username(conn, base: str) -> str:
    candidate = base
    suffix = 1
    while conn.execute("SELECT 1 FROM users WHERE username = ?", (candidate,)).fetchone():
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate


def bootstrap_admin() -> None:
    conn = db.get_db()
    try:
        count = conn.execute("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").fetchone()["c"]
        if count:
            return
        requested_username = (os.environ.get("ADMIN_BOOTSTRAP_USERNAME") or "admin").strip() or "admin"
        password = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD")
        notices = []
        must_change = 0
        if password and auth.password_problem(password):
            notices.append("ADMIN_BOOTSTRAP_PASSWORD khong hop le (can tu 6 ky tu va toi da 72 byte) -> da bo qua.")
            password = None
        if not password:
            password = auth.generate_temp_password(12)
            must_change = 1
        username = _free_username(conn, requested_username)
        if username != requested_username:
            notices.append(f"Ten dang nhap '{_ascii(requested_username)}' da duoc tai khoan khac dung.")

        conn.execute(
            "INSERT INTO users (username, password_hash, full_name, role, active, created_at, must_change_password) "
            "VALUES (?, ?, ?, 'admin', 1, ?, ?)",
            (username, auth.hash_password(password), "Quản trị viên", now_str(), must_change),
        )
        conn.commit()

        if must_change or notices:
            # Chỉ dùng ký tự ASCII để không lỗi khi console Windows không dùng UTF-8
            lines = ["=" * 60, "DA TAO TAI KHOAN ADMIN DAU TIEN"] + [f"  {n}" for n in notices]
            lines.append(f"  Ten dang nhap: {_ascii(username)}")
            if must_change:
                lines.append(f"  Mat khau tam : {password}")
                lines.append("  (Bat buoc doi mat khau o lan dang nhap dau tien)")
            else:
                lines.append("  Mat khau     : theo ADMIN_BOOTSTRAP_PASSWORD")
            lines.append("=" * 60)
            print("\n".join(lines), flush=True)
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    bootstrap_admin()
    auth.login_throttle.clear()
    yield


app = FastAPI(title="VICO Production Reporting System", version="2.0.0", lifespan=lifespan, **api_docs_settings())

app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    same_site="lax",
    https_only=IS_PRODUCTION,
    max_age=SESSION_MAX_AGE_SECONDS,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if not request.url.path.startswith("/api/"):
        # Luôn kiểm tra lại HTML/JS/CSS để điện thoại không dùng bản cũ sau khi cập nhật
        response.headers["Cache-Control"] = "no-cache"
    return response


# ---------------- VALIDATION MESSAGES ----------------

FIELD_LABELS = {
    "report_date": "Ngày báo cáo", "shift_num": "Ca", "expected_mode": "Chế độ lưu",
    "staff_total": "Tổng sĩ số", "staff_present": "Có mặt",
    "leave_permitted": "Nghỉ có phép", "leave_unpermitted": "Nghỉ không phép",
    "leave_permitted_names": "Tên người nghỉ phép", "leave_unpermitted_names": "Tên người nghỉ không phép",
    "issues": "Sự cố", "suggestions": "Đề xuất", "start_time": "Giờ bắt đầu", "end_time": "Giờ kết thúc",
    "packaging": "Bao gói", "baskets": "Giỏ bi", "tumbling": "Bi xóc",
    "product_name": "Tên sản phẩm", "customer": "Khách hàng", "steel_grade": "Mác thép",
    "from_val": "Từ", "to_val": "Đến",
    "weight_sorted": "KL phân loại", "weight_waste": "KL hủy", "basket_count": "Số giỏ",
    "total_weight": "Tổng khối lượng", "m1": "Máy xóc 1", "m2": "Máy xóc 2", "notes": "Ghi chú",
    "username": "Tên đăng nhập", "password": "Mật khẩu", "full_name": "Họ tên", "role": "Vai trò",
    "current_password": "Mật khẩu hiện tại", "new_password": "Mật khẩu mới", "date": "Ngày",
}


def _fmt_number(value) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return f"{value:,}".replace(",", ".") if isinstance(value, int) else str(value)


def _describe_location(loc) -> str:
    parts = []
    for part in loc:
        if part in ("body", "query", "path"):
            continue
        if isinstance(part, int) and parts:
            parts[-1] = f"{parts[-1]} #{part + 1}"
        else:
            parts.append(FIELD_LABELS.get(part, str(part)))
    return " - ".join(parts)


def _describe_error(err: dict) -> str:
    kind = err.get("type")
    ctx = err.get("ctx") or {}
    if kind == "value_error" and "error" in ctx:
        return str(ctx["error"])
    if kind in ("string_too_long", "too_long"):
        return f"tối đa {ctx.get('max_length')} ký tự"
    if kind == "less_than_equal":
        return f"không được lớn hơn {_fmt_number(ctx.get('le'))}"
    if kind == "greater_than_equal":
        return f"không được nhỏ hơn {_fmt_number(ctx.get('ge'))}"
    if kind == "finite_number":
        return "phải là số hữu hạn"
    if kind in ("float_parsing", "float_type", "int_parsing", "int_type"):
        return "phải là số"
    if kind == "int_from_float":
        return "phải là số nguyên"
    if kind == "missing":
        return "bắt buộc phải có"
    if kind == "json_invalid":
        return "dữ liệu gửi lên không đúng định dạng JSON"
    return err.get("msg", "")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    messages = []
    for err in exc.errors():
        loc = _describe_location(err.get("loc", []))
        msg = _describe_error(err)
        messages.append(f"{loc}: {msg}" if loc else msg)
    return JSONResponse(status_code=422, content={"detail": "Dữ liệu không hợp lệ - " + "; ".join(messages)})


@app.exception_handler(Exception)
async def unexpected_exception_handler(request: Request, exc: Exception):
    logger.error("Lỗi không mong đợi khi xử lý %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": GENERIC_SERVER_ERROR})


# ---------------- INPUT HELPERS ----------------

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}", flags=re.ASCII)
# Ký tự điều khiển (trừ \t \n \r), nửa cặp surrogate và U+FFFE/U+FFFF: làm hỏng file Excel/XML
_BAD_TEXT_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ud800-\udfff￾￿]")


def clean_text(value):
    if isinstance(value, str):
        return _BAD_TEXT_CHARS_RE.sub("", value)
    return value


def _parse_date_str(value) -> Date:
    if not isinstance(value, str) or not _DATE_RE.fullmatch(value):
        raise ValueError("ngày phải có dạng YYYY-MM-DD")
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("ngày không tồn tại")


def _check_date_str(value) -> str:
    _parse_date_str(value)
    return value


def valid_date(date: str = Query(..., description="YYYY-MM-DD")) -> str:
    try:
        return _check_date_str(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ngày không hợp lệ, cần có dạng YYYY-MM-DD")


def _display_date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return str(value)


def _text(max_length: int):
    return Annotated[str, BeforeValidator(clean_text), StringConstraints(max_length=max_length)]


NameText = _text(100)
NamesListText = _text(500)
LongText = _text(2000)
UsernameText = _text(auth.MAX_USERNAME_LENGTH)
PasswordText = Annotated[str, StringConstraints(max_length=auth.MAX_PASSWORD_INPUT_LENGTH)]

WeightKg = Annotated[float, AllowInfNan(False), Ge(0), Le(MAX_WEIGHT_KG)]
CountNum = Annotated[float, AllowInfNan(False), Ge(0), Le(MAX_COUNT)]
StaffNum = Annotated[int, Ge(0), Le(MAX_STAFF)]


# ---------------- MODELS ----------------
class PackagingItemModel(BaseModel):
    product_name: NameText
    customer: NameText
    from_val: Optional[NameText] = ""
    to_val: Optional[NameText] = ""
    weight_sorted: Optional[WeightKg] = 0
    weight_waste: Optional[WeightKg] = 0
    notes: Optional[LongText] = ""


class BasketItemModel(BaseModel):
    product_name: NameText
    customer: NameText
    from_val: Optional[NameText] = ""
    to_val: Optional[NameText] = ""
    steel_grade: Optional[NameText] = ""
    basket_count: Optional[CountNum] = 0
    total_weight: Optional[WeightKg] = None
    notes: Optional[LongText] = ""


class TumblingItemModel(BaseModel):
    product_name: NameText
    customer: NameText
    m1: Optional[CountNum] = 0
    m2: Optional[CountNum] = 0
    total_weight: Optional[WeightKg] = 0
    notes: Optional[LongText] = ""


class ShiftReportModel(BaseModel):
    report_date: str
    shift_num: Annotated[int, Ge(1), Le(3)]
    safety_ppe: bool = True
    safety_equip: bool = True
    staff_total: StaffNum = 5
    staff_present: StaffNum = 5
    leave_permitted: StaffNum = 0
    leave_permitted_names: Optional[NamesListText] = ""
    leave_unpermitted: StaffNum = 0
    leave_unpermitted_names: Optional[NamesListText] = ""
    issues: Optional[LongText] = ""
    suggestions: Optional[LongText] = ""
    start_time: Optional[NameText] = ""
    end_time: Optional[NameText] = ""
    packaging: List[PackagingItemModel] = []
    baskets: List[BasketItemModel] = []
    tumbling: List[TumblingItemModel] = []
    # "create": người dùng đang tạo báo cáo mới; "update": đang sửa báo cáo đã có.
    # Máy chủ từ chối (409) nếu trạng thái thực tế đã khác -> không ghi đè nhầm.
    expected_mode: Optional[Literal["create", "update"]] = None

    @field_validator("report_date")
    @classmethod
    def check_report_date(cls, value: str) -> str:
        parsed = _parse_date_str(value)
        latest = server_today() + timedelta(days=MAX_REPORT_DAYS_AHEAD)
        if parsed > latest:
            raise ValueError(f"không được chọn ngày sau {latest.strftime('%d/%m/%Y')}")
        return value

    @model_validator(mode="after")
    def check_attendance(self):
        if self.staff_present > self.staff_total:
            raise ValueError(
                f"Số người có mặt ({self.staff_present}) không được lớn hơn tổng sĩ số ({self.staff_total})"
            )
        on_leave = self.leave_permitted + self.leave_unpermitted
        if on_leave > self.staff_total:
            raise ValueError(
                f"Tổng số người nghỉ (có phép + không phép = {on_leave}) "
                f"không được lớn hơn tổng sĩ số ({self.staff_total})"
            )
        return self


class LoginModel(BaseModel):
    username: Annotated[str, StringConstraints(max_length=auth.MAX_USERNAME_LENGTH)]
    password: PasswordText


class ChangePasswordModel(BaseModel):
    current_password: PasswordText
    new_password: PasswordText


class UserCreateModel(BaseModel):
    username: UsernameText
    full_name: NameText
    password: PasswordText
    role: Annotated[str, StringConstraints(max_length=20)] = "leader"


class UserUpdateModel(BaseModel):
    full_name: Optional[NameText] = None
    password: Optional[PasswordText] = None
    active: Optional[bool] = None


def _raise_if_bad_password(password: str) -> None:
    problem = auth.password_problem(password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)


# ---------------- AUTH ROUTES ----------------

@app.post("/api/auth/login")
def login(payload: LoginModel, request: Request):
    throttle_key = payload.username.strip().lower()
    locked_seconds = auth.login_throttle.seconds_locked(throttle_key)
    if locked_seconds:
        minutes = max(1, (locked_seconds + 59) // 60)
        raise HTTPException(
            status_code=429,
            detail=f"Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau {minutes} phút.",
        )

    conn = db.get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    finally:
        conn.close()

    if not row or not row["active"]:
        # Vẫn chạy bcrypt để thời gian phản hồi không tiết lộ tài khoản có tồn tại hay không
        auth.burn_password_check(payload.password)
        password_ok = False
    else:
        password_ok = auth.verify_password(payload.password, row["password_hash"])

    if not password_ok:
        auth.login_throttle.record_failure(throttle_key)
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")

    auth.login_throttle.reset(throttle_key)
    auth.start_session(request, row["id"], row["session_version"])
    return {
        "username": row["username"],
        "full_name": row["full_name"],
        "role": row["role"],
        "must_change_password": bool(row["must_change_password"]),
    }


@app.post("/api/auth/logout")
def logout(request: Request):
    user = auth.get_current_user(request)
    if user:
        # Thu hồi cookie này (và các phiên khác của tài khoản): cookie bị sao chép cũng mất hiệu lực
        conn = db.get_db()
        try:
            auth.bump_session_version(conn, user["id"])
            conn.commit()
        finally:
            conn.close()
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(user: dict = Depends(auth.require_login)):
    return {
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "must_change_password": bool(user["must_change_password"]),
    }


@app.post("/api/auth/change-password")
def change_password(payload: ChangePasswordModel, request: Request, user: dict = Depends(auth.require_login)):
    conn = db.get_db()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not row or not auth.verify_password(payload.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng")
        _raise_if_bad_password(payload.new_password)
        if payload.new_password == payload.current_password:
            raise HTTPException(status_code=400, detail="Mật khẩu mới phải khác mật khẩu hiện tại")
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (auth.hash_password(payload.new_password), user["id"]),
        )
        # Đăng xuất mọi thiết bị khác, giữ phiên hiện tại
        new_version = auth.bump_session_version(conn, user["id"])
        conn.commit()
    finally:
        conn.close()
    request.session[auth.SESSION_VERSION_KEY] = new_version
    return {"status": "success"}


# ---------------- ADMIN: USER MANAGEMENT ----------------

@app.get("/api/admin/users")
def list_users(admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, full_name, role, active, created_at, must_change_password FROM users ORDER BY id"
    )
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return users


@app.post("/api/admin/users")
def create_user(payload: UserCreateModel, admin: dict = Depends(auth.require_admin)):
    if payload.role not in ("admin", "leader"):
        raise HTTPException(status_code=400, detail="role phải là 'admin' hoặc 'leader'")
    username = payload.username.strip()
    full_name = payload.full_name.strip()
    if not username or not full_name:
        raise HTTPException(status_code=400, detail="Tên đăng nhập và họ tên không được để trống")
    _raise_if_bad_password(payload.password)

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{username}' đã tồn tại")

    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, full_name, role, active, created_at, must_change_password) "
            "VALUES (?, ?, ?, ?, 1, ?, 1)",
            (username, auth.hash_password(payload.password), full_name, payload.role, now_str()),
        )
        conn.commit()
        user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{username}' đã tồn tại")
    conn.close()
    return {"status": "success", "id": user_id}


@app.patch("/api/admin/users/{user_id}")
def update_user(
    payload: UserUpdateModel,
    request: Request,
    user_id: int = PathParam(..., ge=1, le=MAX_SQLITE_ID),
    admin: dict = Depends(auth.require_admin),
):
    if payload.active is False and user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản đang đăng nhập")

    conn = db.get_db()
    try:
        if not conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")

        updates = []
        params = []
        revoke_sessions = False
        if payload.full_name is not None:
            full_name = payload.full_name.strip()
            if not full_name:
                raise HTTPException(status_code=400, detail="Họ tên không được để trống")
            updates.append("full_name = ?")
            params.append(full_name)
        if payload.password is not None:
            _raise_if_bad_password(payload.password)
            updates.append("password_hash = ?")
            params.append(auth.hash_password(payload.password))
            # Mật khẩu do admin đặt cho người khác là mật khẩu tạm -> bắt đổi ở lần đăng nhập sau
            updates.append("must_change_password = ?")
            params.append(0 if user_id == admin["id"] else 1)
            revoke_sessions = True
        if payload.active is not None:
            updates.append("active = ?")
            params.append(int(payload.active))
            if not payload.active:
                revoke_sessions = True

        if updates:
            params.append(user_id)
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            new_version = auth.bump_session_version(conn, user_id) if revoke_sessions else None
            conn.commit()
            if new_version is not None and user_id == admin["id"]:
                request.session[auth.SESSION_VERSION_KEY] = new_version
    finally:
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


def _has_content(numbers, notes) -> bool:
    """Một dòng chỉ được lưu khi có số liệu > 0 hoặc có ghi chú (bỏ qua thẻ trống mặc định)."""
    return any((n or 0) > 0 for n in numbers) or bool((notes or "").strip())


SHIFT_EXISTS_CONFLICT = "Ca này đã có báo cáo. Vui lòng kiểm tra lại trước khi lưu."
SHIFT_MISSING_CONFLICT = "Báo cáo ca này không còn trên hệ thống (có thể đã bị xóa). Vui lòng kiểm tra lại trước khi lưu."


@app.post("/api/shifts")
def save_shift_report(report: ShiftReportModel, user: dict = Depends(auth.require_user)):
    conn = db.get_db()
    cursor = conn.cursor()
    try:
        timestamp = now_str()

        cursor.execute(
            "SELECT id, created_by_user_id FROM shifts WHERE report_date = ? AND shift_num = ?",
            (report.report_date, report.shift_num)
        )
        existing = cursor.fetchone()

        if existing:
            owner_id = existing["created_by_user_id"]
            if user["role"] != "admin" and owner_id != user["id"]:
                if owner_id is None:
                    detail = (f"Báo cáo Ca {report.shift_num} ngày {report.report_date} chưa được gán ca trưởng "
                              "phụ trách, chỉ admin mới có quyền sửa.")
                else:
                    detail = (f"Báo cáo Ca {report.shift_num} ngày {report.report_date} đã được ca trưởng khác nộp, "
                              "bạn không có quyền sửa.")
                raise HTTPException(status_code=403, detail=detail)
            if report.expected_mode == "create":
                raise HTTPException(status_code=409, detail=SHIFT_EXISTS_CONFLICT)
            shift_id = existing["id"]
            # Giữ nguyên người nộp (shift_leader) và thời điểm nộp gốc (created_at)
            cursor.execute("""
            UPDATE shifts SET
                safety_ppe = ?, safety_equip = ?,
                staff_total = ?, staff_present = ?, leave_permitted = ?,
                leave_permitted_names = ?, leave_unpermitted = ?, leave_unpermitted_names = ?,
                issues = ?, suggestions = ?, start_time = ?, end_time = ?,
                updated_at = ?, updated_by_user_id = ?
            WHERE id = ?
            """, (
                int(report.safety_ppe), int(report.safety_equip),
                report.staff_total, report.staff_present, report.leave_permitted,
                report.leave_permitted_names, report.leave_unpermitted, report.leave_unpermitted_names,
                report.issues, report.suggestions, report.start_time, report.end_time,
                timestamp, user["id"],
                shift_id
            ))
            cursor.execute("DELETE FROM packaging_items WHERE shift_id = ?", (shift_id,))
            cursor.execute("DELETE FROM basket_items WHERE shift_id = ?", (shift_id,))
            cursor.execute("DELETE FROM tumbling_items WHERE shift_id = ?", (shift_id,))
            action_text = "cập nhật"
        else:
            if report.expected_mode == "update":
                raise HTTPException(status_code=409, detail=SHIFT_MISSING_CONFLICT)
            cursor.execute("""
            INSERT INTO shifts (
                report_date, shift_num, shift_leader, safety_ppe, safety_equip,
                staff_total, staff_present, leave_permitted, leave_permitted_names,
                leave_unpermitted, leave_unpermitted_names, issues, suggestions,
                start_time, end_time, created_at, created_by_user_id, updated_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                report.report_date, report.shift_num, user["full_name"],
                int(report.safety_ppe), int(report.safety_equip),
                report.staff_total, report.staff_present, report.leave_permitted,
                report.leave_permitted_names, report.leave_unpermitted,
                report.leave_unpermitted_names, report.issues, report.suggestions,
                report.start_time, report.end_time, timestamp, user["id"], user["id"]
            ))
            shift_id = cursor.lastrowid
            action_text = "lưu"

        for p in report.packaging:
            if _has_content([p.weight_sorted, p.weight_waste], p.notes):
                cursor.execute("""
                INSERT INTO packaging_items (
                    shift_id, product_name, customer, from_val, to_val, weight_sorted, weight_waste, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, p.product_name, p.customer, p.from_val, p.to_val, p.weight_sorted, p.weight_waste, p.notes))

        for b in report.baskets:
            if _has_content([b.basket_count, b.total_weight], b.notes):
                cursor.execute("""
                INSERT INTO basket_items (
                    shift_id, product_name, customer, from_val, to_val, steel_grade, basket_count, total_weight, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, b.product_name, b.customer, b.from_val, b.to_val, b.steel_grade, b.basket_count, b.total_weight, b.notes))

        for t in report.tumbling:
            if _has_content([t.m1, t.m2, t.total_weight], t.notes):
                cursor.execute("""
                INSERT INTO tumbling_items (
                    shift_id, product_name, customer, m1, m2, total_weight, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (shift_id, t.product_name, t.customer, t.m1, t.m2, t.total_weight, t.notes))

        conn.commit()
        return {
            "status": "success",
            "message": f"Báo cáo Ca {report.shift_num} ngày {report.report_date} đã được {action_text} thành công!",
            "shift_id": shift_id,
        }
    except HTTPException:
        conn.rollback()
        raise
    except sqlite3.IntegrityError:
        conn.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Ca {report.shift_num} ngày {report.report_date} vừa được người khác nộp. Vui lòng tải lại trang.",
        )
    except Exception:
        conn.rollback()
        logger.exception("Lỗi khi lưu báo cáo Ca %s ngày %s", report.shift_num, report.report_date)
        raise HTTPException(status_code=500, detail="Lỗi máy chủ khi lưu báo cáo. Vui lòng thử lại, "
                                                    "nếu vẫn lỗi hãy báo quản trị viên.")
    finally:
        conn.close()


@app.delete("/api/shifts")
def delete_shift_report(
    admin: dict = Depends(auth.require_admin),
    report_date: str = Depends(valid_date),
    shift_num: int = Query(..., ge=1, le=3, description="1, 2 or 3"),
):
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT id, shift_leader FROM shifts WHERE report_date = ? AND shift_num = ?", (report_date, shift_num)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Không tìm thấy báo cáo Ca {shift_num} ngày {_display_date(report_date)}",
            )
        shift_id = row["id"]
        conn.execute("DELETE FROM packaging_items WHERE shift_id = ?", (shift_id,))
        conn.execute("DELETE FROM basket_items WHERE shift_id = ?", (shift_id,))
        conn.execute("DELETE FROM tumbling_items WHERE shift_id = ?", (shift_id,))
        conn.execute("DELETE FROM shifts WHERE id = ?", (shift_id,))
        conn.commit()
        logger.info("Admin %s đã xóa báo cáo Ca %s ngày %s (%s)",
                    admin["username"], shift_num, report_date, row["shift_leader"])
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        logger.exception("Lỗi khi xóa báo cáo Ca %s ngày %s", shift_num, report_date)
        raise HTTPException(status_code=500, detail=GENERIC_SERVER_ERROR)
    finally:
        conn.close()
    return {
        "status": "success",
        "message": f"Đã xóa báo cáo Ca {shift_num} ngày {_display_date(report_date)} ({row['shift_leader']}).",
    }


def _load_shift_items(cursor, shift: dict) -> None:
    s_id = shift["id"]
    cursor.execute("SELECT * FROM packaging_items WHERE shift_id = ? ORDER BY id", (s_id,))
    shift["packaging"] = [dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT * FROM basket_items WHERE shift_id = ? ORDER BY id", (s_id,))
    shift["baskets"] = [dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT * FROM tumbling_items WHERE shift_id = ? ORDER BY id", (s_id,))
    shift["tumbling"] = [dict(r) for r in cursor.fetchall()]


@app.get("/api/shifts")
def get_shifts(report_date: str = Depends(valid_date), user: dict = Depends(auth.require_user)):
    conn = db.get_db()
    cursor = conn.cursor()
    if user["role"] == "admin":
        cursor.execute("SELECT * FROM shifts WHERE report_date = ? ORDER BY shift_num", (report_date,))
    else:
        cursor.execute(
            "SELECT * FROM shifts WHERE report_date = ? AND created_by_user_id = ? ORDER BY shift_num",
            (report_date, user["id"])
        )
    shifts = [dict(row) for row in cursor.fetchall()]

    for s in shifts:
        _load_shift_items(cursor, s)
    conn.close()
    return shifts


@app.get("/api/shifts/check-status")
def check_shift_status(
    report_date: str = Depends(valid_date),
    shift_num: int = Query(..., ge=1, le=3, description="1, 2 or 3"),
    user: dict = Depends(auth.require_user)
):
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM shifts WHERE report_date = ? AND shift_num = ?",
        (report_date, shift_num)
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"exists": False}

    s = dict(row)
    can_edit = (user["role"] == "admin" or s["created_by_user_id"] == user["id"])

    shift_data = None
    if can_edit:
        _load_shift_items(cursor, s)
        shift_data = s

    conn.close()
    return {
        "exists": True,
        "shift_leader": s["shift_leader"],
        "can_edit": can_edit,
        "created_at": s["created_at"],
        "updated_at": s["updated_at"],
        "shift_data": shift_data
    }


@app.get("/api/shifts/previous-template")
def get_previous_shift_template(user: dict = Depends(auth.require_user)):
    """Danh mục sản phẩm của ca nộp gần nhất. Chỉ trả về tên SP / khách hàng / mác thép,
    không trả ghi chú (có thể là ghi chú riêng của ca trưởng khác)."""
    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, report_date, shift_num, shift_leader FROM shifts ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"found": False}

    s_id = row["id"]
    cursor.execute("SELECT product_name, customer FROM packaging_items WHERE shift_id = ? ORDER BY id", (s_id,))
    packaging = [{"product_name": r["product_name"], "customer": r["customer"]} for r in cursor.fetchall()]

    cursor.execute("SELECT product_name, customer, steel_grade FROM basket_items WHERE shift_id = ? ORDER BY id", (s_id,))
    baskets = [{"product_name": r["product_name"], "customer": r["customer"], "steel_grade": r["steel_grade"]}
               for r in cursor.fetchall()]

    cursor.execute("SELECT product_name, customer FROM tumbling_items WHERE shift_id = ? ORDER BY id", (s_id,))
    tumbling = [{"product_name": r["product_name"], "customer": r["customer"]} for r in cursor.fetchall()]

    conn.close()
    return {
        "found": True,
        "from_shift": f"Ca {row['shift_num']} ngày {row['report_date']} ({row['shift_leader']})",
        "packaging": packaging,
        "baskets": baskets,
        "tumbling": tumbling
    }


# Ghi chú bao gói chứa các cụm từ này được đưa xuống phần ghi chú chung của mục bao gói.
# So khớp nguyên từ (không khớp "lò" trong "hài lòng").
_LETTER = r"[^\W\d_]"
PACKAGING_NOTE_KEYWORDS_RE = re.compile(
    rf"(?<!{_LETTER})(?:lò|nghiệm\s+thu|xếp\s+kho)(?!{_LETTER})", flags=re.IGNORECASE
)


def is_packaging_general_note(notes: str) -> bool:
    return bool(PACKAGING_NOTE_KEYWORDS_RE.search(unicodedata.normalize("NFC", notes or "")))


def _empty_safety() -> dict:
    return {"ppe_failed_shifts": [], "equip_failed_shifts": []}


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
            "attendance": {"total_staff": 15, "present": 0, "leave_notes": "Ko", "leave_detail": "", "unpermitted": "Ko"},
            "safety": _empty_safety(),
        }

    shift_ids = [s["id"] for s in shifts]
    placeholders = ",".join(["?"] * len(shift_ids))
    submitted_nums = [s["shift_num"] for s in shifts]

    total_staff = sum((s["staff_total"] or 0) for s in shifts) or 15
    total_present = sum((s["staff_present"] or 0) for s in shifts)

    leave_names_list = []
    unpermitted_names_list = []
    for s in shifts:
        if s["leave_permitted_names"]:
            leave_names_list.append(f"Ca {s['shift_num']}: {s['leave_permitted_names']}")
        if s["leave_unpermitted_names"]:
            unpermitted_names_list.append(f"Ca {s['shift_num']}: {s['leave_unpermitted_names']}")

    leave_notes = "Ko" if not leave_names_list else "; ".join(leave_names_list)
    unpermitted = "Ko" if not unpermitted_names_list else "; ".join(unpermitted_names_list)

    safety = {
        "ppe_failed_shifts": [s["shift_num"] for s in shifts if s["safety_ppe"] is not None and not s["safety_ppe"]],
        "equip_failed_shifts": [s["shift_num"] for s in shifts if s["safety_equip"] is not None and not s["safety_equip"]],
    }

    cursor.execute(f"""
        SELECT product_name, customer,
               SUM(weight_sorted) as sum_sorted,
               SUM(weight_waste) as sum_waste,
               GROUP_CONCAT(NULLIF(TRIM(notes), ''), '; ') as combined_notes
        FROM packaging_items
        WHERE shift_id IN ({placeholders})
        GROUP BY product_name, customer
        ORDER BY sum_sorted DESC
    """, shift_ids)

    packaging_rows = []
    packaging_notes = []
    for r in cursor.fetchall():
        notes = r["combined_notes"] or ""
        if notes and is_packaging_general_note(notes):
            packaging_notes.append(f" - {notes}")
            item_notes = ""
        else:
            item_notes = notes

        packaging_rows.append({
            "product_name": r["product_name"] or "",
            "customer": r["customer"] or "",
            "weight_sorted": r["sum_sorted"] or 0,
            "weight_waste": r["sum_waste"] or 0,
            "notes": item_notes
        })

    # Dòng không nhập khối lượng (NULL) tính theo 350 Kg/giỏ; khối lượng 0 được giữ nguyên là 0
    cursor.execute(f"""
        SELECT product_name, customer, steel_grade,
               SUM(basket_count) as sum_baskets,
               SUM(COALESCE(total_weight, basket_count * 350)) as sum_weight,
               GROUP_CONCAT(NULLIF(TRIM(notes), ''), '; ') as combined_notes
        FROM basket_items
        WHERE shift_id IN ({placeholders})
        GROUP BY product_name, customer, steel_grade
        ORDER BY sum_baskets DESC
    """, shift_ids)

    basket_rows = []
    for r in cursor.fetchall():
        basket_rows.append({
            "product_name": r["product_name"] or "",
            "customer": r["customer"] or "",
            "steel_grade": r["steel_grade"] or "",
            "basket_count": r["sum_baskets"] if r["sum_baskets"] is not None else 0,
            "total_weight": r["sum_weight"] if r["sum_weight"] is not None else 0,
            "notes": r["combined_notes"] or ""
        })

    cursor.execute(f"""
        SELECT product_name, customer, COALESCE(TRIM(notes), '') as notes_key,
               SUM(m1) as sum_m1,
               SUM(m2) as sum_m2,
               SUM(total_weight) as sum_weight
        FROM tumbling_items
        WHERE shift_id IN ({placeholders})
        GROUP BY product_name, customer, notes_key
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
            "notes": r["notes_key"] or ""
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
        "safety": safety,
        "reporter_name": "Ngọc Quang"
    }


@app.get("/api/daily-summary")
def get_daily_summary(report_date: str = Depends(valid_date), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(report_date)
    summary["excel_row_limits"] = dict(excel_service.ROW_LIMITS)
    return summary


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


@app.get("/api/export-excel")
def export_excel_report(report_date: str = Depends(valid_date), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(report_date)
    if not summary.get("submitted_shifts"):
        raise HTTPException(status_code=400, detail=f"Chưa có ca nào nộp báo cáo trong ngày {report_date} để xuất file!")

    # File tạm riêng cho từng lần tải (không ghi vào thư mục ứng dụng), xóa sau khi gửi xong
    fd, tmp_path = tempfile.mkstemp(prefix="vico_export_", suffix=".xlsx")
    os.close(fd)
    try:
        excel_service.generate_excel_report(summary, output_path=tmp_path)
    except Exception:
        _remove_quietly(tmp_path)
        logger.exception("Lỗi khi tạo file Excel ngày %s", report_date)
        raise HTTPException(status_code=500, detail="Không tạo được file Excel. Vui lòng thử lại, "
                                                    "nếu vẫn lỗi hãy báo quản trị viên.")

    dt_str = report_date.replace("-", "")
    return FileResponse(
        path=tmp_path,
        filename=f"BAO_CAO_TONG_HOP_{dt_str}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        background=BackgroundTask(_remove_quietly, tmp_path),
    )


@app.post("/api/sync-to-master")
def sync_to_master(report_date: str = Depends(valid_date), admin: dict = Depends(auth.require_admin)):
    summary = compute_daily_summary(report_date)
    if not summary.get("submitted_shifts"):
        raise HTTPException(status_code=400, detail=f"Chưa có ca nào nộp báo cáo trong ngày {report_date}!")

    try:
        result = excel_service.sync_to_master(summary)
    except FileNotFoundError:
        raise HTTPException(
            status_code=400,
            detail="Không tìm thấy file BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx trên máy chủ. Xem mục 'Lưu ý về file Excel' trong DEPLOY.md.",
        )
    except excel_service.MasterSyncError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception:
        logger.exception("Lỗi khi đồng bộ file tổng hợp gốc ngày %s", report_date)
        raise HTTPException(status_code=500, detail="Không đồng bộ được vào file tổng hợp gốc. Vui lòng thử lại, "
                                                    "nếu vẫn lỗi hãy báo quản trị viên.")
    return result


@app.get("/api/history")
def get_history(admin: dict = Depends(auth.require_admin)):
    conn = db.get_db()
    try:
        dates = [r[0] for r in conn.execute(
            "SELECT DISTINCT report_date FROM shifts ORDER BY report_date DESC LIMIT 30"
        ).fetchall()]
        if not dates:
            return []
        rows = conn.execute(
            f"SELECT report_date, shift_num, shift_leader FROM shifts "
            f"WHERE report_date IN ({','.join(['?'] * len(dates))}) "
            f"ORDER BY report_date DESC, shift_num",
            dates,
        ).fetchall()
    finally:
        conn.close()

    grouped = {d: [] for d in dates}
    for r in rows:
        grouped[r["report_date"]].append(r)
    return [
        {
            "report_date": d,
            "shift_count": len(items),
            "shifts": ",".join(str(r["shift_num"]) for r in items),
            "leaders": ", ".join(r["shift_leader"] or "" for r in items),
        }
        for d, items in grouped.items()
    ]


# Mount static files
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8088))
    # Chỉ bật tự nạp lại code khi phát triển: đặt RELOAD=1
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=os.environ.get("RELOAD") == "1")
