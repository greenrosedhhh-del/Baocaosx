"""Password hashing and session-based authentication for the VICO reporting system."""
import os
import secrets
import threading
import time
from collections import OrderedDict
from typing import Callable, Optional

import bcrypt
from fastapi import Depends, HTTPException, Request

import db

MIN_PASSWORD_LENGTH = 6
MAX_PASSWORD_BYTES = 72  # giới hạn của bcrypt
MAX_USERNAME_LENGTH = 64
MAX_PASSWORD_INPUT_LENGTH = 128  # độ dài tối đa chấp nhận ở ô nhập (trước khi kiểm tra 72 byte)
MUST_CHANGE_PASSWORD_DETAIL = "Bạn cần đổi mật khẩu trước khi tiếp tục sử dụng hệ thống"

SESSION_USER_KEY = "user_id"
SESSION_VERSION_KEY = "sv"


def load_secret_key(key_path: str) -> str:
    """Lấy SECRET_KEY từ biến môi trường; nếu không có thì sinh ngẫu nhiên và lưu
    vào file để phiên đăng nhập không bị mất khi khởi động lại máy chủ."""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key

    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            stored = f.read().strip()
        if stored:
            return stored

    key = secrets.token_urlsafe(48)
    os.makedirs(os.path.dirname(os.path.abspath(key_path)), exist_ok=True)
    with open(key_path, "w", encoding="utf-8") as f:
        f.write(key)
    return key


def generate_temp_password(length: int = 10) -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Mật khẩu dài hơn 72 byte hoặc hash hỏng: coi như sai mật khẩu
        return False


# Hash giả (cùng độ khó với hash thật) để đăng nhập với tên không tồn tại / tài khoản bị khóa
# vẫn tốn thời gian như sai mật khẩu -> không dò được tên đăng nhập qua thời gian phản hồi.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))


def burn_password_check(password: str) -> None:
    verify_password(password, _DUMMY_PASSWORD_HASH)


def password_problem(password: str) -> Optional[str]:
    """Trả về thông báo lỗi nếu mật khẩu mới không hợp lệ, None nếu hợp lệ."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Mật khẩu phải có ít nhất {MIN_PASSWORD_LENGTH} ký tự"
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return "Mật khẩu quá dài (tối đa 72 ký tự không dấu)"
    return None


class LoginThrottle:
    """Khóa tạm tên đăng nhập sau nhiều lần đăng nhập sai liên tiếp.

    Bộ nhớ có giới hạn cứng: tối đa `max_keys` tên đang đếm lần sai và tối đa `max_keys`
    tên đang bị khóa. Khi đầy, bỏ các mục đã hết hạn trước, sau đó bỏ mục cũ nhất.
    """

    MAX_TRACKED_KEYS = 5000

    def __init__(self, max_failures: int = 5, window_seconds: int = 900,
                 lockout_seconds: int = 300, clock: Callable[[], float] = time.monotonic,
                 max_keys: Optional[int] = None):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.lockout_seconds = lockout_seconds
        self.clock = clock
        self.max_keys = max_keys or self.MAX_TRACKED_KEYS
        self._failures = OrderedDict()  # key -> list of failure timestamps (cũ nhất ở đầu)
        self._locked_until = OrderedDict()  # key -> timestamp (khóa sớm hết hạn nhất ở đầu)
        self._lock = threading.Lock()

    def seconds_locked(self, key: str) -> int:
        with self._lock:
            until = self._locked_until.get(key)
            if until is None:
                return 0
            remaining = until - self.clock()
            if remaining <= 0:
                del self._locked_until[key]
                return 0
            return int(remaining) + 1

    def record_failure(self, key: str) -> None:
        with self._lock:
            now = self.clock()
            recent = [t for t in self._failures.pop(key, []) if now - t < self.window_seconds]
            recent.append(now)
            if len(recent) >= self.max_failures:
                self._locked_until.pop(key, None)
                self._make_room(self._locked_until, now)
                self._locked_until[key] = now + self.lockout_seconds
                return
            self._make_room(self._failures, now)
            self._failures[key] = recent

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()
            self._locked_until.clear()

    def stats(self) -> dict:
        with self._lock:
            return {"failure_keys": len(self._failures), "locked_keys": len(self._locked_until)}

    def _make_room(self, table: OrderedDict, now: float) -> None:
        if len(table) < self.max_keys:
            return
        self._prune(now)
        while len(table) >= self.max_keys:
            table.popitem(last=False)

    def _prune(self, now: float) -> None:
        for k in list(self._failures):
            if not any(now - t < self.window_seconds for t in self._failures[k]):
                del self._failures[k]
        for k in list(self._locked_until):
            if self._locked_until[k] <= now:
                del self._locked_until[k]


login_throttle = LoginThrottle()


def start_session(request: Request, user_id: int, session_version: int) -> None:
    request.session.clear()
    request.session[SESSION_USER_KEY] = user_id
    request.session[SESSION_VERSION_KEY] = session_version


def bump_session_version(conn, user_id: int) -> int:
    """Thu hồi mọi phiên đăng nhập hiện có của tài khoản; trả về phiên bản mới."""
    conn.execute("UPDATE users SET session_version = session_version + 1 WHERE id = ?", (user_id,))
    row = conn.execute("SELECT session_version FROM users WHERE id = ?", (user_id,)).fetchone()
    return row[0] if row else 0


def get_current_user(request: Request) -> Optional[dict]:
    user_id = request.session.get(SESSION_USER_KEY)
    session_version = request.session.get(SESSION_VERSION_KEY)
    if not user_id:
        return None
    if not isinstance(user_id, int) or not isinstance(session_version, int):
        # Cookie cũ (trước khi có session_version) hoặc dữ liệu lạ: bắt đăng nhập lại
        request.session.clear()
        return None
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT id, username, full_name, role, active, must_change_password, session_version "
            "FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not row["active"] or row["session_version"] != session_version:
        request.session.clear()
        return None
    return dict(row)


def require_login(request: Request) -> dict:
    """Đã đăng nhập (kể cả khi còn phải đổi mật khẩu)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    return user


def require_user(user: dict = Depends(require_login)) -> dict:
    """Đã đăng nhập và đã đổi mật khẩu tạm."""
    if user["must_change_password"]:
        raise HTTPException(status_code=403, detail=MUST_CHANGE_PASSWORD_DETAIL)
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Chỉ admin mới có quyền truy cập")
    return user
