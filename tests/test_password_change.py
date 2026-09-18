import sqlite3

import db

SHIFT = {"report_date": "2026-09-17", "shift_num": 1}


def _login(client, username, password):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200
    return resp.json()


def _create_user_as_admin(client, username, password, role="leader"):
    _login(client, "admin", "admin123")
    resp = client.post("/api/admin/users", json={
        "username": username, "full_name": username.title(), "password": password, "role": role
    })
    assert resp.status_code == 200
    client.post("/api/auth/logout")
    return resp.json()["id"]


def test_new_account_must_change_password_before_using_app(client):
    _create_user_as_admin(client, "tan", "temp123")

    login_data = _login(client, "tan", "temp123")
    assert login_data["must_change_password"] is True
    assert client.get("/api/auth/me").json()["must_change_password"] is True

    resp = client.post("/api/shifts", json=SHIFT)
    assert resp.status_code == 403


def test_change_password_unlocks_account(client):
    _create_user_as_admin(client, "tan", "temp123")
    _login(client, "tan", "temp123")

    resp = client.post("/api/auth/change-password", json={
        "current_password": "temp123", "new_password": "moi12345"
    })
    assert resp.status_code == 200
    assert client.get("/api/auth/me").json()["must_change_password"] is False
    assert client.post("/api/shifts", json=SHIFT).status_code == 200

    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"username": "tan", "password": "temp123"}).status_code == 401
    _login(client, "tan", "moi12345")


def test_change_password_rejects_wrong_current_password(client):
    _create_user_as_admin(client, "tan", "temp123")
    _login(client, "tan", "temp123")
    resp = client.post("/api/auth/change-password", json={
        "current_password": "sai-mat-khau", "new_password": "moi12345"
    })
    assert resp.status_code == 400


def test_change_password_rejects_same_password(client):
    _create_user_as_admin(client, "tan", "temp123")
    _login(client, "tan", "temp123")
    resp = client.post("/api/auth/change-password", json={
        "current_password": "temp123", "new_password": "temp123"
    })
    assert resp.status_code == 400


def test_change_password_rejects_too_short_password(client):
    _create_user_as_admin(client, "tan", "temp123")
    _login(client, "tan", "temp123")
    resp = client.post("/api/auth/change-password", json={
        "current_password": "temp123", "new_password": "123"
    })
    assert resp.status_code == 400


def test_change_password_requires_login(client):
    resp = client.post("/api/auth/change-password", json={
        "current_password": "x", "new_password": "moi12345"
    })
    assert resp.status_code == 401


def test_admin_password_reset_forces_change_again(client):
    user_id = _create_user_as_admin(client, "tan", "temp123")
    _login(client, "tan", "temp123")
    client.post("/api/auth/change-password", json={"current_password": "temp123", "new_password": "moi12345"})
    client.post("/api/auth/logout")

    _login(client, "admin", "admin123")
    resp = client.patch(f"/api/admin/users/{user_id}", json={"password": "reset123"})
    assert resp.status_code == 200
    client.post("/api/auth/logout")

    assert _login(client, "tan", "reset123")["must_change_password"] is True


def test_bootstrap_admin_with_env_password_is_not_forced_to_change(client):
    assert _login(client, "admin", "admin123")["must_change_password"] is False


def test_existing_users_are_flagged_when_column_is_added(tmp_path, monkeypatch):
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        )
    """)
    conn.execute("INSERT INTO users (username, password_hash, full_name, role, created_at) "
                 "VALUES ('hai', 'x', 'Hải', 'leader', '2026-09-17 10:00:00')")
    conn.commit()
    conn.close()

    monkeypatch.setenv("VICO_DB_PATH", str(db_path))
    db.init_schema()

    conn = db.get_db()
    row = conn.execute("SELECT must_change_password FROM users WHERE username = 'hai'").fetchone()
    conn.close()
    assert row["must_change_password"] == 1
