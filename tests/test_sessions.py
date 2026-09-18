"""#4: phiên đăng nhập phải thu hồi được (đăng xuất, đổi mật khẩu, admin đặt lại mật khẩu, khóa tài khoản)."""
import sqlite3

from fastapi.testclient import TestClient

import db
import server
from helpers import ADMIN_PASSWORD, create_active_user, login, login_admin


def _session_cookie(client):
    value = client.cookies.get("session")
    assert value, "chưa có cookie phiên"
    return value


def _me_status_with_cookie(cookie):
    other = TestClient(server.app)
    return other.get("/api/auth/me", headers={"Cookie": f"session={cookie}"}).status_code


def _second_device():
    return TestClient(server.app)


def test_replayed_cookie_is_rejected_after_logout(client):
    login_admin(client)
    cookie = _session_cookie(client)
    assert _me_status_with_cookie(cookie) == 200

    assert client.post("/api/auth/logout").status_code == 200
    assert _me_status_with_cookie(cookie) == 401


def test_password_change_on_other_device_revokes_old_sessions_but_keeps_current(client):
    create_active_user(client, "tan", "Tân", password="tan12345")
    login(client, "tan", "tan12345")  # thiết bị 1

    device2 = _second_device()
    login(device2, "tan", "tan12345")
    resp = device2.post("/api/auth/change-password", json={
        "current_password": "tan12345", "new_password": "moi12345"
    })
    assert resp.status_code == 200

    assert client.get("/api/auth/me").status_code == 401
    assert device2.get("/api/auth/me").status_code == 200
    assert device2.post("/api/shifts", json={"report_date": "2026-09-17", "shift_num": 1}).status_code == 200


def test_admin_password_reset_revokes_user_sessions(client):
    user_id = create_active_user(client, "hai", "Hải", password="hai12345")
    device = _second_device()
    login(device, "hai", "hai12345")
    assert device.get("/api/auth/me").status_code == 200

    login_admin(client)
    assert client.patch(f"/api/admin/users/{user_id}", json={"password": "reset123"}).status_code == 200
    assert device.get("/api/auth/me").status_code == 401


def test_deactivate_then_reactivate_does_not_revive_old_session(client):
    user_id = create_active_user(client, "hai", "Hải", password="hai12345")
    device = _second_device()
    login(device, "hai", "hai12345")
    cookie = _session_cookie(device)

    login_admin(client)
    assert client.patch(f"/api/admin/users/{user_id}", json={"active": False}).status_code == 200
    assert client.patch(f"/api/admin/users/{user_id}", json={"active": True}).status_code == 200

    assert _me_status_with_cookie(cookie) == 401


def test_admin_resetting_own_password_keeps_current_session(client):
    login_admin(client)
    me_id = next(u["id"] for u in client.get("/api/admin/users").json() if u["username"] == "admin")
    assert client.patch(f"/api/admin/users/{me_id}", json={"password": "admin456"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_fresh_login_after_logout_works(client):
    login_admin(client)
    client.post("/api/auth/logout")
    login(client, "admin", ADMIN_PASSWORD)
    assert client.get("/api/auth/me").status_code == 200


def test_session_cookie_max_age_is_seven_days(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert "Max-Age=604800" in resp.headers.get("set-cookie", "")


def test_users_table_gets_session_version_column_on_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "old_users.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
            must_change_password INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("INSERT INTO users (username, password_hash, full_name, role, created_at) "
                 "VALUES ('hai', 'x', 'Hải', 'leader', '2026-09-17 10:00:00')")
    conn.commit()
    conn.close()

    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    db.init_schema()
    db.init_schema()

    conn = db.get_db()
    row = conn.execute("SELECT session_version FROM users WHERE username = 'hai'").fetchone()
    conn.close()
    assert row["session_version"] == 0
