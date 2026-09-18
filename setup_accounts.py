"""Tạo các tài khoản đăng nhập cơ bản (admin + ca trưởng) nếu chưa có.

Usage:
    python setup_accounts.py

- Tài khoản mới được cấp mật khẩu tạm ngẫu nhiên (in ra màn hình) và bắt buộc
  đổi mật khẩu ở lần đăng nhập đầu tiên.
- Tài khoản đã tồn tại được giữ nguyên mật khẩu (chạy lại nhiều lần vẫn an toàn).
"""
import sys
from datetime import datetime

import auth
import db

DEFAULT_LEADERS = [
    ("hai", "Hải"),
    ("tan", "Tân"),
    ("trong", "Trọng"),
]


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _create_user(cur, username: str, full_name: str, role: str) -> str:
    temp_password = auth.generate_temp_password()
    cur.execute(
        "INSERT INTO users (username, password_hash, full_name, role, active, created_at, must_change_password) "
        "VALUES (?, ?, ?, ?, 1, ?, 1)",
        (username, auth.hash_password(temp_password), full_name, role, _now()),
    )
    return temp_password


def _free_username(cur, base: str) -> str:
    candidate = base
    suffix = 1
    while True:
        cur.execute("SELECT 1 FROM users WHERE username = ?", (candidate,))
        if not cur.fetchone():
            return candidate
        suffix += 1
        candidate = f"{base}{suffix}"


def setup(leaders=DEFAULT_LEADERS) -> list:
    """Trả về danh sách (username, full_name, mật khẩu tạm) của các tài khoản vừa tạo."""
    db.init_schema()
    conn = db.get_db()
    cur = conn.cursor()
    created = []
    try:
        cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        if cur.fetchone()[0] == 0:
            # Tên "admin" có thể đã bị một tài khoản ca trưởng dùng -> chọn tên trống (admin2, admin3...)
            admin_username = _free_username(cur, "admin")
            created.append((admin_username, "Quản trị viên",
                            _create_user(cur, admin_username, "Quản trị viên", "admin")))

        for username, full_name in leaders:
            cur.execute("SELECT id FROM users WHERE username = ?", (username,))
            if cur.fetchone():
                continue
            # Tài khoản cũ có thể được tạo với tên đăng nhập có dấu (vd: "hải") -> đổi sang không dấu
            cur.execute("SELECT id FROM users WHERE username = ?", (full_name.lower(),))
            legacy = cur.fetchone()
            if legacy:
                cur.execute("UPDATE users SET username = ? WHERE id = ?", (username, legacy[0]))
                continue
            created.append((username, full_name, _create_user(cur, username, full_name, "leader")))

        conn.commit()
    finally:
        conn.close()
    return created


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    created = setup()
    if created:
        print("=== TÀI KHOẢN MỚI (đưa mật khẩu tạm cho từng người, hệ thống sẽ bắt đổi khi đăng nhập lần đầu) ===")
        for username, full_name, password in created:
            print(f"  {full_name}: tên đăng nhập = {username}   mật khẩu tạm = {password}")
    else:
        print("Không có tài khoản mới nào cần tạo.")

    print("\n=== DANH SÁCH TÀI KHOẢN ===")
    conn = db.get_db()
    for r in conn.execute("SELECT id, username, full_name, role, active, must_change_password FROM users ORDER BY id"):
        status = "chờ đổi mật khẩu" if r["must_change_password"] else "đã đổi mật khẩu"
        print(f"ID: {r['id']} | Username: {r['username']} | Họ tên: {r['full_name']} | "
              f"Vai trò: {r['role']} | {'Hoạt động' if r['active'] else 'Đã khóa'} | {status}")
    conn.close()


if __name__ == "__main__":
    main()
