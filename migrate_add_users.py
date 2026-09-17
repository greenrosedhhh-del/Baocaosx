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

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


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
