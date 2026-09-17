import sys
import auth
import db

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

conn = db.get_db()
cur = conn.cursor()

# 1. Ensure admin exists
cur.execute("SELECT COUNT(*) FROM users WHERE username = 'admin'")
if cur.fetchone()[0] == 0:
    cur.execute(
        "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
        "VALUES ('admin', ?, 'Quản trị viên', 'admin', 1, '2026-09-17 10:00:00')",
        (auth.hash_password("admin123"),)
    )

# 2. Configure friendly leader accounts (non-accented username, default password 123456)
leaders = [
    ("hai", "Hải"),
    ("tan", "Tân"),
    ("trong", "Trọng")
]

for uname, fname in leaders:
    cur.execute("SELECT id FROM users WHERE username = ? OR username = ?", (uname, fname.lower()))
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE users SET username = ?, full_name = ?, password_hash = ? WHERE id = ?", (uname, fname, auth.hash_password("123456"), row[0]))
    else:
        cur.execute(
            "INSERT INTO users (username, password_hash, full_name, role, active, created_at) "
            "VALUES (?, ?, ?, 'leader', 1, '2026-09-17 10:00:00')",
            (uname, auth.hash_password("123456"), fname)
        )

conn.commit()

print("=== DANH SÁCH TÀI KHOẢN ĐĂNG NHẬP SẴN SÀNG ===")
cur.execute("SELECT id, username, full_name, role, active FROM users")
for r in cur.fetchall():
    print(f"ID: {r['id']} | Username: {r['username']} | Họ tên: {r['full_name']} | Vai trò: {r['role']}")

conn.close()
