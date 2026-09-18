import sqlite3

from fastapi.testclient import TestClient

import auth
import server


def _login_admin(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200


# ---------- SECRET KEY ----------

def test_secret_key_is_generated_and_persisted_when_env_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    key_file = tmp_path / "secret_key"

    first = auth.load_secret_key(str(key_file))
    second = auth.load_secret_key(str(key_file))

    assert first == second
    assert len(first) >= 32
    assert first != "dev-insecure-secret-change-me"
    assert key_file.read_text(encoding="utf-8").strip() == first


def test_secret_key_prefers_env_variable(tmp_path, monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "from-env-secret")
    assert auth.load_secret_key(str(tmp_path / "secret_key")) == "from-env-secret"


def test_server_does_not_use_hardcoded_default_secret():
    assert server.SECRET_KEY != "dev-insecure-secret-change-me"


# ---------- BOOTSTRAP ADMIN ----------

def test_bootstrap_admin_without_env_password_does_not_use_admin123(tmp_path, monkeypatch):
    monkeypatch.setenv("VICO_DB_PATH", str(tmp_path / "fresh.db"))
    monkeypatch.delenv("ADMIN_BOOTSTRAP_PASSWORD", raising=False)

    with TestClient(server.app) as c:
        resp = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert resp.status_code == 401

    conn = sqlite3.connect(str(tmp_path / "fresh.db"))
    must_change = conn.execute(
        "SELECT must_change_password FROM users WHERE username = 'admin'"
    ).fetchone()[0]
    conn.close()
    assert must_change == 1


# ---------- LOGIN THROTTLING ----------

def test_login_locked_after_repeated_failures(client):
    for _ in range(5):
        resp = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert resp.status_code == 401

    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 429


def test_login_success_resets_failure_counter(client):
    for _ in range(4):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    _login_admin(client)
    client.post("/api/auth/logout")

    for _ in range(4):
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    _login_admin(client)


def test_login_throttle_unlocks_after_lockout_period():
    now = [1000.0]
    throttle = auth.LoginThrottle(max_failures=2, window_seconds=60, lockout_seconds=30, clock=lambda: now[0])

    throttle.record_failure("admin")
    throttle.record_failure("admin")
    assert throttle.seconds_locked("admin") > 0
    assert throttle.seconds_locked("other") == 0

    now[0] += 31
    assert throttle.seconds_locked("admin") == 0


# ---------- PASSWORD LENGTH ----------

def test_verify_password_returns_false_for_overlong_password():
    h = auth.hash_password("secret123")
    assert auth.verify_password("a" * 80, h) is False


def test_login_with_overlong_password_returns_401(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "a" * 80})
    assert resp.status_code == 401


def test_create_user_rejects_overlong_password(client):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": "longpw", "full_name": "Long", "password": "a" * 80, "role": "leader"
    })
    assert resp.status_code == 400


def test_create_user_rejects_too_short_password(client):
    _login_admin(client)
    resp = client.post("/api/admin/users", json={
        "username": "shortpw", "full_name": "Short", "password": "12345", "role": "leader"
    })
    assert resp.status_code == 400


# ---------- SECURITY HEADERS ----------

def test_static_pages_send_security_headers(client):
    resp = client.get("/login.html")
    assert resp.status_code == 200
    csp = resp.headers.get("content-security-policy", "")
    assert "script-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("cache-control") == "no-cache"
